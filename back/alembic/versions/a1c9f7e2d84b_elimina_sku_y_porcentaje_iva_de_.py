"""elimina sku y porcentaje_iva de productos

El dueño de la tienda va a cargar el precio de venta ya con el IVA
incluido, así que el porcentaje de IVA por separado deja de tener sentido.
El SKU también se da de baja (no se usa en ningún otro lado de la app:
ni en pedidos, ni en pagos, ni en el carrito -- ver búsqueda hecha antes
de esta migración).

ADVERTENCIA: esta migración es destructiva. Cualquier valor de sku o
porcentaje_iva ya cargado en productos existentes se pierde para siempre
al aplicarla -- no hay forma de "deshacer" el downgrade y recuperar esos
datos, downgrade() solo vuelve a crear las columnas vacías.

Revision ID: a1c9f7e2d84b
Revises: 3b6bbd6be94c
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9f7e2d84b'
down_revision: Union[str, Sequence[str], None] = '3b6bbd6be94c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint('ck_productos_porcentaje_iva_range', 'productos', type_='check')
    op.drop_index(op.f('ix_productos_sku'), table_name='productos')
    op.drop_column('productos', 'porcentaje_iva')
    op.drop_column('productos', 'sku')


def downgrade() -> None:
    """Downgrade schema.

    Recrea las columnas vacías (nullable=True acá a propósito, ya que no
    hay forma de reconstruir los valores originales de sku/porcentaje_iva
    que se perdieron en el upgrade -- ver advertencia arriba). Si hace
    falta volver a usarlas en serio, hay que recargar los datos a mano.
    """
    op.add_column('productos', sa.Column('sku', sa.String(), nullable=True))
    op.add_column('productos', sa.Column('porcentaje_iva', sa.Numeric(precision=5, scale=2), nullable=True))
    op.create_index(op.f('ix_productos_sku'), 'productos', ['sku'], unique=True)
    op.create_check_constraint(
        'ck_productos_porcentaje_iva_range',
        'productos',
        'porcentaje_iva >= 0 AND porcentaje_iva <= 100',
    )
