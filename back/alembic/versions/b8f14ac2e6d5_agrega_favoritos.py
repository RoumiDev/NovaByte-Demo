"""agrega tabla de favoritos

Tabla nueva favoritos: la estrella de la ficha de producto
(ProductoDetalle.jsx) para que un usuario marque productos y los encuentre
rápido después. Es una tabla de unión simple usuario<->producto -- ver
Favorito en app/models/favorite.py y los endpoints /productos/{id}/favorito
y /productos/favoritos en router/products.py.

usuario_id y producto_id llevan ondelete='CASCADE' (a diferencia de
pedido_detalles.producto_id, que a propósito NO lo tiene -- ver
102a93be4c44): un favorito no es un registro histórico que tenga que
sobrevivir si el usuario o el producto desaparecen, es solo una
preferencia. El UniqueConstraint evita que el mismo usuario termine con
dos filas de favorito para el mismo producto (ver marcar_favorito en
router/products.py, que además lo trata como upsert idempotente).

Revision ID: b8f14ac2e6d5
Revises: c9b47a1e0f3d
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8f14ac2e6d5'
down_revision: Union[str, Sequence[str], None] = 'c9b47a1e0f3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'favoritos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('producto_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['producto_id'], ['productos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('usuario_id', 'producto_id', name='uq_favoritos_usuario_producto'),
    )
    op.create_index(op.f('ix_favoritos_id'), 'favoritos', ['id'], unique=False)
    op.create_index(op.f('ix_favoritos_usuario_id'), 'favoritos', ['usuario_id'], unique=False)
    op.create_index(op.f('ix_favoritos_producto_id'), 'favoritos', ['producto_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_favoritos_producto_id'), table_name='favoritos')
    op.drop_index(op.f('ix_favoritos_usuario_id'), table_name='favoritos')
    op.drop_index(op.f('ix_favoritos_id'), table_name='favoritos')
    op.drop_table('favoritos')
