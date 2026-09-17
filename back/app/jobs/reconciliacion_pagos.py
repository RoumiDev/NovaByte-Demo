"""Procesamiento automático de pedidos "pendiente": confirma contra
Mercado Pago los que sí se pagaron, y cancela (reponiendo stock) los que
quedaron abandonados sin pagar.

Dos problemas, un solo job -- porque están relacionados y resolverlos por
separado abre una carrera entre ellos (ver más abajo):

1. Red de seguridad para cuando el webhook de Mercado Pago nunca llega --
   por ejemplo, el túnel público de desarrollo estaba caído, o el servidor
   se reinició justo en medio de la notificación. Sin esto, un pedido que
   Mercado Pago sí cobró pero cuyo webhook se perdió queda "pendiente"
   para siempre.

2. El stock de un producto se reserva (se descuenta) ni bien se crea el
   pedido, no cuando se confirma el pago (ver create_order() en
   app/router/orders.py) -- así se evita que dos compradores paguen por la
   misma última unidad. El costo de eso es que un pedido que nunca se
   paga deja ese stock trabado para siempre, bloqueando a otros
   compradores. Este job cancela esos pedidos abandonados y repone el
   stock, el mismo efecto que ya tiene cancelar un pedido a mano
   (PATCH /pedidos/{id}/estado).

Por qué van juntos: si se cancelara un pedido por antigüedad sin volver a
preguntarle a Mercado Pago, existe la carrera de que el comprador termine
de pagar justo en el momento en que el pedido se cancela por timeout --
ahí Mercado Pago ya cobró un pedido que en la base quedó "cancelado". Por
eso, antes de cancelar por abandono, este job siempre vuelve a consultar
a Mercado Pago si en el medio se aprobó un pago: solo cancela si la
respuesta es "no hay pago aprobado".

Corre solo, en segundo plano (ver el scheduler en app/main.py), sin
depender de que nadie lo dispare.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.database import SessionLocal
from app.models.order import EstadoOrden, Pedido
from app.models.product import Producto
from app.services.mercadopago_service import MercadoPagoError, buscar_pago_aprobado
from app.services.order_notification_service import notificar_compra_confirmada

logger = logging.getLogger("app.reconciliacion")

# No revisar pedidos más nuevos que esto: recién se creó, todavía ni tuvo
# tiempo de terminar el checkout en Mercado Pago -- consultar la API para
# un pedido de hace 10 segundos es gastar cupo para nada.
_MINUTOS_GRACIA_ANTES_DE_REVISAR = 1

# A partir de esta antigüedad, un pedido "pendiente" sin pago aprobado se
# considera abandonado: se cancela y se repone el stock. 5 minutos alcanza
# para un pago con tarjeta (el caso de uso actual); si el día de mañana se
# suman medios de pago lentos (efectivo, transferencia), esos pedidos van
# a necesitar quedar afuera de este corte o tener uno propio más largo.
_MINUTOS_ABANDONO = 5

# No seguir revisando pedidos más viejos que esto: es un techo de
# seguridad nada más -- en operación normal, ningún pedido debería llegar
# a esta antigüedad todavía "pendiente" (a los _MINUTOS_ABANDONO ya se
# cancela). Cubre el caso de que el job haya estado parado un tiempo largo.
_HORAS_MAXIMAS_A_REVISAR = 48

# Tope de pedidos por corrida: con un backlog grande, es mejor ir de a
# tandas en cada corrida que bloquear el worker consultando miles de
# pedidos de una sola vez. Lo que no entra en esta corrida entra en la
# siguiente (corre cada 1 minuto, ver app/main.py).
_MAX_PEDIDOS_POR_CORRIDA = 200


def procesar_pedidos_pendientes() -> None:
    """Para cada pedido "pendiente" dentro de la ventana a revisar,
    preguntarle a Mercado Pago si ya se pagó. Si se pagó, confirmarlo. Si
    no, y ya pasó el tiempo de abandono, cancelarlo y reponer el stock.

    Pensado para correr en un scheduler periódico, no para llamarse desde
    un endpoint HTTP -- por eso abre y cierra su propia sesión de DB en vez
    de recibir una por Depends(get_db).
    """
    ahora = datetime.now(timezone.utc)
    desde = ahora - timedelta(hours=_HORAS_MAXIMAS_A_REVISAR)
    hasta = ahora - timedelta(minutes=_MINUTOS_GRACIA_ANTES_DE_REVISAR)
    limite_abandono = ahora - timedelta(minutes=_MINUTOS_ABANDONO)

    db = SessionLocal()
    try:
        pedidos_orm = (
            db.execute(
                select(Pedido)
                .options(selectinload(Pedido.detalles))
                .where(
                    Pedido.estado == EstadoOrden.pendiente,
                    Pedido.created_at >= desde,
                    Pedido.created_at <= hasta,
                )
                .order_by(Pedido.created_at.asc())
                .limit(_MAX_PEDIDOS_POR_CORRIDA)
            )
            .scalars()
            .all()
        )

        if not pedidos_orm:
            return

        # Se saca del ORM únicamente lo que hace falta (id, fecha, líneas)
        # antes de empezar a commitear en el medio del loop -- la sesión
        # expira los objetos cargados en cada commit() (comportamiento por
        # defecto de SQLAlchemy), así que trabajar con datos planos evita
        # cualquier sorpresa de relecturas a mitad de la corrida.
        pedidos_a_revisar = [
            {
                "id": pedido.id,
                "created_at": pedido.created_at,
                "lineas": [(d.producto_id, d.cantidad) for d in pedido.detalles],
            }
            for pedido in pedidos_orm
        ]

        logger.info("Procesamiento automatico: revisando %s pedido(s) pendiente(s).", len(pedidos_a_revisar))
        confirmados = 0
        cancelados = 0

        for pedido in pedidos_a_revisar:
            pedido_id = pedido["id"]
            try:
                pago = buscar_pago_aprobado(pedido_id)
            except MercadoPagoError:
                # Falla transitoria hablando con Mercado Pago para este
                # pedido puntual: no aborta toda la corrida, se reintenta
                # en la próxima. Importante: NUNCA cancelar un pedido
                # porque falló la consulta -- eso sería cancelar a ciegas,
                # justo el escenario que se quiere evitar.
                logger.warning("Procesamiento automatico: no se pudo consultar el pedido %s, se reintenta despues.", pedido_id)
                continue

            if pago is not None:
                # Mismo patrón atómico que usa el webhook: si dos caminos
                # confirman el mismo pedido casi al mismo tiempo, solo uno
                # de los dos UPDATE encuentra la fila todavía en
                # "pendiente" y gana.
                result = db.execute(
                    update(Pedido)
                    .where(Pedido.id == pedido_id, Pedido.estado == EstadoOrden.pendiente)
                    .values(estado=EstadoOrden.pagado, mp_payment_id=str(pago["id"]))
                )
                db.commit()
                if result.rowcount == 1:
                    confirmados += 1
                    logger.info(
                        "Procesamiento automatico: pedido %s marcado como pagado (mp_payment_id=%s).",
                        pedido_id,
                        pago["id"],
                    )
                    # Best-effort, ver order_notification_service.py -- un
                    # fallo mandando este mail no debe frenar el resto de la
                    # corrida ni afectar pedidos ya confirmados.
                    notificar_compra_confirmada(db, pedido_id)
                continue

            # No hay pago aprobado. Si todavía no pasó el tiempo de
            # abandono, se deja como está -- todavía puede estar
            # completando el pago en Mercado Pago en este momento.
            if pedido["created_at"] > limite_abandono:
                continue

            # Transición atómica pendiente -> cancelado, condicionada al
            # estado leído: si en el medio se confirmó el pago por otro
            # camino (webhook, o el botón "Ya pagué, verificar" del
            # comprador), esta UPDATE no encuentra la fila en "pendiente"
            # y no cancela nada.
            result = db.execute(
                update(Pedido)
                .where(Pedido.id == pedido_id, Pedido.estado == EstadoOrden.pendiente)
                .values(estado=EstadoOrden.cancelado)
            )
            if result.rowcount == 1:
                for producto_id, cantidad in pedido["lineas"]:
                    db.execute(
                        update(Producto)
                        .where(Producto.id == producto_id)
                        .values(stock=Producto.stock + cantidad)
                    )
                db.commit()
                cancelados += 1
                logger.info(
                    "Procesamiento automatico: pedido %s cancelado por abandono (sin pago tras %s minutos), stock repuesto.",
                    pedido_id,
                    _MINUTOS_ABANDONO,
                )
            else:
                db.rollback()

        if confirmados or cancelados:
            logger.info(
                "Procesamiento automatico: %s pedido(s) confirmados, %s cancelado(s) por abandono.",
                confirmados,
                cancelados,
            )
    finally:
        db.close()
