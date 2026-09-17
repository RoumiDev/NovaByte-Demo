"""Endpoints de pedidos: checkout, consulta propia y administración de estado.

Principio central de este router (ver hallazgo H-10 del informe de auditoría
original y M-01/M-02 de la revisión de app/models): el cliente nunca decide
precio_unitario, subtotal, total_pedido, estado inicial ni si hay stock
suficiente. Todo eso lo calcula y controla el backend en create_order().
"""

from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.core.pagination import Limit, Skip
from app.dependencies.auth import get_current_user, require_admin, require_admin_o_ayudante
from app.models.order import EstadoOrden, Pedido, PedidoDetalle
from app.models.product import Producto
from app.models.user import Usuario
from app.schemas.order import PedidoAdminListado, PedidoCreate, PedidoEstadoUpdate, PedidoRead
from app.schemas.payment import PedidoPagoResponse
from app.services.mercadopago_service import MercadoPagoError, buscar_pago_aprobado, crear_preferencia

router = APIRouter()

# Transiciones de estado permitidas. enviado y cancelado son terminales: un
# pedido cancelado no puede "revivir" ni uno enviado retroceder a pendiente.
# Es una regla de negocio de base razonable; ajustarla si el flujo real difiere.
_TRANSICIONES_VALIDAS: dict[EstadoOrden, set[EstadoOrden]] = {
    EstadoOrden.pendiente: {EstadoOrden.pagado, EstadoOrden.cancelado},
    EstadoOrden.pagado: {EstadoOrden.enviado, EstadoOrden.cancelado},
    EstadoOrden.enviado: set(),
    EstadoOrden.cancelado: set(),
}


def _pedido_query():
    """Traer siempre los detalles -- y el producto de cada detalle -- junto
    con el pedido (evita N+1 al serializar). El producto hace falta porque
    PedidoDetalleRead ahora expone su nombre/imagen (ver schemas/order.py),
    no solo producto_id."""
    return select(Pedido).options(selectinload(Pedido.detalles).selectinload(PedidoDetalle.producto))


@router.post("/", response_model=PedidoRead, status_code=status.HTTP_201_CREATED)
def create_order(
    body: PedidoCreate,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Pedido:
    """Crear un pedido (checkout) para el usuario autenticado.

    Todo o nada: si falta stock de cualquier producto, se revierte el
    pedido completo (no se dejan líneas "a medias"). El stock se descuenta
    con un UPDATE atómico condicionado (WHERE stock >= cantidad), así dos
    checkouts concurrentes no pueden sobrevender el mismo producto.
    """
    # Agrupar cantidades por producto: si el cliente repite el mismo
    # producto en dos líneas, un solo UPDATE atómico por producto evita que
    # dos decrementos "válidos" por separado terminen sumando más de lo que
    # había en stock.
    cantidades_por_producto: dict[int, int] = {}
    for linea in body.detalles:
        cantidades_por_producto[linea.producto_id] = (
            cantidades_por_producto.get(linea.producto_id, 0) + linea.cantidad
        )

    productos = {
        p.id: p
        for p in db.execute(
            select(Producto).where(Producto.id.in_(cantidades_por_producto.keys()))
        ).scalars()
    }

    faltantes = sorted(set(cantidades_por_producto) - set(productos))
    if faltantes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Producto(s) inexistente(s): {faltantes}",
        )
    inactivos = sorted(pid for pid, p in productos.items() if not p.is_active)
    if inactivos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Producto(s) no disponible(s): {inactivos}",
        )

    pedido = Pedido(usuario_id=current_user.id, tipo_factura=body.tipo_factura, total_pedido=Decimal("0.00"))
    db.add(pedido)
    db.flush()  # asigna pedido.id sin cerrar todavía la transacción

    total = Decimal("0.00")
    for producto_id, cantidad in cantidades_por_producto.items():
        result = db.execute(
            update(Producto)
            .where(Producto.id == producto_id, Producto.stock >= cantidad)
            .values(stock=Producto.stock - cantidad)
        )
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Stock insuficiente para el producto {producto_id}.",
            )

        precio_unitario = productos[producto_id].precio_venta
        subtotal = (precio_unitario * cantidad).quantize(Decimal("0.01"))
        total += subtotal
        db.add(
            PedidoDetalle(
                pedido_id=pedido.id,
                producto_id=producto_id,
                cantidad=cantidad,
                precio_unitario=precio_unitario,
                subtotal=subtotal,
            )
        )

    pedido.total_pedido = total
    db.commit()

    return db.execute(_pedido_query().where(Pedido.id == pedido.id)).scalar_one()


@router.get("/", response_model=list[PedidoRead])
def list_my_orders(
    skip: Skip = 0,
    limit: Limit = 20,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Pedido]:
    """Listar los pedidos del usuario autenticado (nunca los de otro)."""
    query = (
        _pedido_query()
        .where(Pedido.usuario_id == current_user.id)
        .order_by(Pedido.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.execute(query).scalars())


@router.get("/todos", response_model=PedidoAdminListado, dependencies=[Depends(require_admin_o_ayudante)])
def list_all_orders(
    skip: Skip = 0,
    limit: Limit = 50,
    db: Session = Depends(get_db),
) -> dict:
    """Listar los pedidos de TODOS los usuarios (admin y ayudante), paginados.

    Declarada antes de GET /{pedido_id} a propósito: si quedara después,
    Starlette intentaría matchear "todos" como un pedido_id (mismo
    problema que ya se dio con /productos/marcas vs /productos/{id}).
    Incluye los datos básicos del comprador y de cada producto
    (selectinload(Pedido.usuario) / selectinload(...Producto)) porque
    PedidoAdminRead/PedidoDetalleRead los necesitan -- ver schemas/order.py.

    Paginación real: "items" nunca trae más de "limit" filas -- el recorte
    lo hace la base de datos con OFFSET/LIMIT en la consulta, no Python
    después de traer todo. "total" sale de un COUNT(*) aparte (sin
    selectinload, sin joins) para que el frontend pueda calcular cuántas
    páginas hay sin tener que traer todos los pedidos para contarlos.
    """
    total = db.execute(select(func.count()).select_from(Pedido)).scalar_one()

    query = (
        select(Pedido)
        .options(
            selectinload(Pedido.detalles).selectinload(PedidoDetalle.producto),
            selectinload(Pedido.usuario),
        )
        .order_by(Pedido.id.desc())
        .offset(skip)
        .limit(limit)
    )
    items = list(db.execute(query).scalars())
    return {"items": items, "total": total}


@router.get("/{pedido_id}", response_model=PedidoRead)
def get_order(
    pedido_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Pedido:
    """Ver un pedido propio (o cualquiera, si sos admin o ayudante).

    Devuelve 404 -- no 403 -- cuando el pedido es de otro usuario, para que
    esta ruta no sirva para confirmar por descarte qué IDs de pedido existen
    (protección IDOR/BOLA, ver hallazgo H-10 del informe de auditoría original).
    """
    pedido = db.execute(_pedido_query().where(Pedido.id == pedido_id)).scalar_one_or_none()
    if pedido is None or (
        pedido.usuario_id != current_user.id and current_user.role not in ("admin", "ayudante")
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")
    return pedido


@router.post("/{pedido_id}/pago", response_model=PedidoPagoResponse)
def crear_pago_pedido(
    pedido_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Generar el link de pago de Mercado Pago (Checkout Pro) para un pedido propio.

    Mismo criterio IDOR que get_order: 404 (no 403) si el pedido es de otro
    usuario. Solo se puede pedir un link mientras el pedido siga
    "pendiente" -- no tiene sentido volver a cobrar uno ya pagado,
    cancelado o enviado. Se puede llamar más de una vez sobre el mismo
    pedido pendiente (por ejemplo si el comprador cerró la pestaña de pago
    sin completar): cada llamada genera una preferencia nueva y
    reemplaza el link anterior.
    """
    pedido = db.execute(
        select(Pedido)
        .options(selectinload(Pedido.detalles).selectinload(PedidoDetalle.producto))
        .where(Pedido.id == pedido_id)
    ).scalar_one_or_none()
    if pedido is None or (pedido.usuario_id != current_user.id and current_user.role != "admin"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")

    if pedido.estado != EstadoOrden.pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El pedido está en estado '{pedido.estado.value}', no se puede generar un pago.",
        )

    try:
        preferencia = crear_preferencia(pedido)
    except MercadoPagoError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo generar el link de pago. Intentá de nuevo en unos minutos.",
        )

    pedido.mp_preference_id = preferencia["id"]
    db.commit()

    return {"init_point": preferencia["init_point"], "preference_id": preferencia["id"]}


@router.post("/{pedido_id}/verificar-pago", response_model=PedidoRead)
def verificar_pago_pedido(
    pedido_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Pedido:
    """Reconciliar manualmente el estado de un pedido contra Mercado Pago.

    Red de seguridad para cuando el webhook nunca llegó (por ejemplo, en
    desarrollo local, si el túnel público estaba caído justo cuando se
    completó el pago): el comprador ya pagó según Mercado Pago, pero el
    pedido quedó "pendiente" en la base porque nadie le avisó al backend.
    Este endpoint consulta directamente a Mercado Pago por external_reference
    y, si encuentra un pago aprobado, aplica la misma transición atómica
    pendiente -> pagado que usa el webhook. Se puede llamar las veces que
    haga falta: si el pedido ya no está pendiente, no hace nada y devuelve
    el pedido tal cual está.

    Mismo criterio IDOR que get_order y crear_pago_pedido: 404 (no 403) si
    el pedido es de otro usuario.
    """
    pedido = db.execute(_pedido_query().where(Pedido.id == pedido_id)).scalar_one_or_none()
    if pedido is None or (pedido.usuario_id != current_user.id and current_user.role != "admin"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")

    if pedido.estado != EstadoOrden.pendiente:
        return pedido

    try:
        pago = buscar_pago_aprobado(pedido_id)
    except MercadoPagoError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo consultar el estado del pago. Intentá de nuevo en unos minutos.",
        )

    if pago is not None:
        # Mismo patrón atómico que el webhook: si en el medio ya se
        # actualizó (por ejemplo el webhook llegó tarde, después de todo),
        # esta segunda escritura no encuentra la fila en "pendiente" y no
        # hace nada -- no hay forma de marcar dos veces el mismo pedido.
        db.execute(
            update(Pedido)
            .where(Pedido.id == pedido_id, Pedido.estado == EstadoOrden.pendiente)
            .values(estado=EstadoOrden.pagado, mp_payment_id=str(pago["id"]))
        )
        db.commit()
        db.refresh(pedido)

    return pedido


@router.patch("/{pedido_id}/estado", response_model=PedidoRead, dependencies=[Depends(require_admin)])
def update_order_status(pedido_id: int, body: PedidoEstadoUpdate, db: Session = Depends(get_db)) -> Pedido:
    """Cambiar el estado de un pedido (administración/pago). Valida que la
    transición sea válida y repone stock automáticamente si se cancela.

    El UPDATE que fija el nuevo estado está condicionado a que el estado
    todavía sea el que acabamos de leer (WHERE ... AND estado = <leído>): si
    dos requests administrativos concurrentes intentan cancelar el mismo
    pedido al mismo tiempo, solo uno gana la transición y solo ese repone
    stock. Sin esto, ambos podían terminar reponiendo el stock por
    duplicado para una sola cancelación (hallazgo R-03 del informe de
    auditoría).
    """
    pedido = db.execute(_pedido_query().where(Pedido.id == pedido_id)).scalar_one_or_none()
    if pedido is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")

    estado_actual = pedido.estado
    if body.estado != estado_actual and body.estado not in _TRANSICIONES_VALIDAS.get(estado_actual, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede pasar de '{estado_actual.value}' a '{body.estado.value}'.",
        )

    # Reclamar la transición de forma atómica: si otra request ya cambió el
    # estado entre la lectura de arriba y este UPDATE, rowcount va a ser 0.
    result = db.execute(
        update(Pedido)
        .where(Pedido.id == pedido_id, Pedido.estado == estado_actual)
        .values(estado=body.estado)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El pedido cambió de estado en paralelo; volvé a intentarlo.",
        )

    if body.estado == EstadoOrden.cancelado and estado_actual != EstadoOrden.cancelado:
        for detalle in pedido.detalles:
            db.execute(
                update(Producto)
                .where(Producto.id == detalle.producto_id)
                .values(stock=Producto.stock + detalle.cantidad)
            )

    db.commit()
    db.refresh(pedido)
    return pedido