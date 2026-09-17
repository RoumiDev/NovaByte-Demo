"""Favoritos: productos que un usuario marcó para encontrarlos rápido
después (la estrella de la ficha de producto -- ver ProductoDetalle.jsx en
el frontend y los endpoints /productos/{id}/favorito en router/products.py).

Es una tabla de unión simple usuario<->producto, con un UniqueConstraint
para que marcar como favorito un producto que ya lo era no duplique filas
-- router/products.py además la trata como upsert idempotente (marcar dos
veces seguidas no rompe, ni tampoco sacar un favorito que ya no estaba).
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class Favorito(Base):
    __tablename__ = "favoritos"
    __table_args__ = (
        UniqueConstraint("usuario_id", "producto_id", name="uq_favoritos_usuario_producto"),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    # ondelete=CASCADE a propósito, a diferencia de PedidoDetalle.producto_id
    # (ver models/order.py): un favorito no es un registro histórico que
    # tenga que sobrevivir a un producto que ya no existe, es solo una
    # preferencia del usuario -- no tiene sentido dejarlo huérfano.
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario", back_populates="favoritos")
    producto = relationship("Producto", back_populates="favoritos")
