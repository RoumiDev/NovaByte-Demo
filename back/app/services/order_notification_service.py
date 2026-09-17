"""Aviso a la propia tienda cuando se confirma una compra (pago aprobado).

Se llama desde los dos únicos lugares que confirman un pago -- el webhook
de Mercado Pago (router/payments.py) y el job de reconciliación
(jobs/reconciliacion_pagos.py) -- justo después de que la transición
pendiente->pagado gana la carrera (result.rowcount == 1 en el UPDATE
atómico de cada uno). Como ese chequeo ya garantiza que solo UNO de los dos
caminos "gana" por pedido, enganchar el aviso ahí mismo asegura que nunca
se mande más de un mail por la misma compra, sin importar cuál de los dos
la haya confirmado.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.order import Pedido, PedidoDetalle
from app.services.email_service import enviar_notificacion_nueva_compra

logger = logging.getLogger("app")


def notificar_compra_confirmada(db: Session, pedido_id: int) -> None:
    """Carga el pedido con lo necesario para armar el mail (comprador y
    líneas con el nombre de cada producto) y lo manda a la tienda.

    Best-effort, mismo criterio que el resto de los envíos de mail de esta
    app: si algo falla acá (pedido no encontrado, SMTP caído, etc.) queda
    logueado pero NO interrumpe el flujo que lo llama -- el pago ya se
    confirmó y guardó antes de esta llamada, esa parte no debe depender de
    que el aviso por mail salga bien.
    """
    pedido = db.execute(
        select(Pedido)
        .options(
            selectinload(Pedido.usuario),
            selectinload(Pedido.detalles).selectinload(PedidoDetalle.producto),
        )
        .where(Pedido.id == pedido_id)
    ).scalar_one_or_none()

    if pedido is None:
        # No debería pasar (se llama con el id de un pedido que se acaba de
        # confirmar en la misma transacción/sesión) -- red de contención
        # nada más.
        logger.warning("notificar_compra_confirmada: pedido %s no encontrado, no se manda aviso.", pedido_id)
        return

    enviar_notificacion_nueva_compra(pedido)
