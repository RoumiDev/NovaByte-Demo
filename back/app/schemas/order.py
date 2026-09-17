"""Esquemas Pydantic para Pedido y PedidoDetalle.

Principio central (ver hallazgo H-10 del informe de auditoría original y
M-02 de la revisión de app/models): el cliente NUNCA envía precio_unitario,
subtotal ni total_pedido. Esos valores los calcula siempre el backend,
en el servicio que cree el pedido, a partir del precio_venta vigente de
cada Producto en el momento de la compra — nunca de un valor recibido.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.order import EstadoOrden

# Letras de comprobante contempladas (AFIP). Ampliar acá si se suman tipos
# nuevos: mantiene tipo_factura acotado a un valor conocido, algo que el
# modelo (CHAR sin longitud explícita) no garantiza por sí solo.
_TIPOS_FACTURA_VALIDOS = {"A", "B", "C", "M"}

# Tope superior de cantidad por línea: no es un límite de negocio real, es
# una defensa barata contra errores de carga o pedidos absurdos accidentales.
_CANTIDAD_MAXIMA_POR_LINEA = 1000
_MAX_LINEAS_POR_PEDIDO = 100


class PedidoDetalleCreate(BaseModel):
    """Lo único que pide el cliente por cada línea: qué producto y cuánto.

    precio_unitario y subtotal no forman parte de este schema a propósito.
    """

    producto_id: int = Field(gt=0)
    cantidad: int = Field(gt=0, le=_CANTIDAD_MAXIMA_POR_LINEA)


class PedidoDetalleProductoResumen(BaseModel):
    """Datos mínimos del producto de una línea -- para mostrar qué se
    compró (nombre, imagen) sin tener que pedir cada producto aparte."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    imagen_url: Optional[str] = None


class PedidoDetalleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    cantidad: int
    precio_unitario: Decimal
    subtotal: Decimal
    producto: PedidoDetalleProductoResumen


class PedidoCreate(BaseModel):
    """Alta de un pedido.

    estado y total_pedido tampoco vienen del cliente: el pedido nace en
    estado "pendiente" y el total se calcula server-side como la suma de
    los subtotales de cada línea.
    """

    tipo_factura: Optional[str] = Field(default=None, min_length=1, max_length=1)
    detalles: list[PedidoDetalleCreate] = Field(min_length=1, max_length=_MAX_LINEAS_POR_PEDIDO)

    @field_validator("tipo_factura")
    @classmethod
    def _validar_tipo_factura(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip().upper()
        if value not in _TIPOS_FACTURA_VALIDOS:
            raise ValueError(f"tipo_factura debe ser uno de: {', '.join(sorted(_TIPOS_FACTURA_VALIDOS))}.")
        return value


class PedidoEstadoUpdate(BaseModel):
    """Cambio de estado de un pedido (endpoint administrativo o de pago).

    Solo valida que sea un estado conocido del enum; qué transiciones son
    válidas (por ejemplo, no volver de "enviado" a "pendiente") debe
    controlarse en la capa de servicio, no en el schema.
    """

    estado: EstadoOrden


class PedidoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    estado: EstadoOrden
    total_pedido: Decimal
    tipo_factura: Optional[str] = None
    created_at: datetime
    detalles: list[PedidoDetalleRead] = []


class PedidoUsuarioResumen(BaseModel):
    """Datos mínimos del comprador -- solo para el listado administrativo
    de pedidos (ver PedidoAdminRead)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    razon_social: str


class PedidoAdminRead(PedidoRead):
    """Igual que PedidoRead, pero con los datos del comprador. Separado de
    PedidoRead a propósito: en las demás rutas (checkout, "mis pedidos") el
    pedido siempre es del propio usuario autenticado, así que no hace
    falta el dato y evita una carga (lazy-load) de más por cada pedido.
    Solo lo usa GET /pedidos/todos (admin/ayudante)."""

    usuario: PedidoUsuarioResumen


class PedidoAdminListado(BaseModel):
    """Respuesta paginada de GET /pedidos/todos: la página de pedidos que
    corresponde a (skip, limit) más el total de pedidos que hay en la base
    SIN paginar. El total viaja aparte porque el frontend lo necesita para
    calcular cuántas páginas hay en total (y no puede deducirlo del tamaño
    de "items", que siempre es como mucho "limit")."""

    items: list[PedidoAdminRead]
    total: int
