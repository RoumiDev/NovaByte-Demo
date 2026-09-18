from sqlalchemy import CheckConstraint, Column, Integer, Numeric, ForeignKey, DateTime, CHAR, Enum, String, func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum

class EstadoOrden(enum.Enum):
    pendiente = "pendiente"
    pagado = "pagado"
    enviado = "enviado"
    cancelado = "cancelado"

class Pedido(Base):
    __tablename__ = "pedidos"
    __table_args__ = (
        CheckConstraint(
            "total_pedido >= 0",
            name="ck_pedidos_total_pedido_non_negative",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    estado = Column(Enum(EstadoOrden), default=EstadoOrden.pendiente)  # pendiente, pagado, enviado, cancelado
    total_pedido = Column(Numeric(10, 2), nullable=False, default=0.0)
    tipo_factura = Column(CHAR, nullable=True)  # A, B, C, etc.
    # Rastreo del pago con Mercado Pago (Checkout Pro). mp_preference_id se
    # graba al pedir el link de pago; se puede regenerar si el usuario
    # reintenta, por eso no es unique. mp_payment_id recién se completa
    # cuando el webhook confirma un pago real, y sí es unique: un mismo pago
    # de Mercado Pago no debe poder asociarse a más de un pedido.
    mp_preference_id = Column(String(64), nullable=True)
    mp_payment_id = Column(String(64), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # FEATURE (17/09/2026, pedido del cliente): "accesos temporales a la
    # demo, aislados entre visitantes" -- se completa (create_order, ver
    # router/orders.py) con el tenant_id del usuario que hace el pedido,
    # tanto para poder filtrar por tenant sin tener que salir a buscarlo en
    # usuarios (mismo criterio que Producto.tenant_id/Categoria.tenant_id),
    # como -- más importante todavía -- para que borrar un DemoTenant
    # vencido (ver app/models/demo.py) borre también en cascada sus
    # pedidos: Pedido.usuario_id (acá arriba) NO tiene ondelete="CASCADE" a
    # propósito (un pedido es un registro histórico que no debe desaparecer
    # sólo porque la cuenta se borró), así que sin esta columna propia,
    # borrar el Usuario de un tenant vencido fallaría por violar esa FK
    # mientras sus pedidos todavía existieran.
    tenant_id = Column(
        Integer, ForeignKey("demo_tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )

    usuario = relationship("Usuario", back_populates="pedidos")
    detalles = relationship("PedidoDetalle", back_populates="pedido", cascade="all, delete-orphan")


class PedidoDetalle(Base):
    __tablename__ = "pedido_detalles"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_pedido_detalles_cantidad_positive"),
        CheckConstraint(
            "precio_unitario >= 0",
            name="ck_pedido_detalles_precio_unitario_non_negative",
        ),
        CheckConstraint(
            "subtotal >= 0",
            name="ck_pedido_detalles_subtotal_non_negative",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    cantidad = Column(Integer, nullable=False, default=1)
    precio_unitario = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)

    pedido = relationship("Pedido", back_populates="detalles")
    producto = relationship("Producto", back_populates="detalles_pedido")
