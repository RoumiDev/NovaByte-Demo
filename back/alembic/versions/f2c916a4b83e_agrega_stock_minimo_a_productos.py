"""agrega stock_minimo a productos

Antes el punto de corte de "stock crítico" (pantalla Stock del panel
admin) era un número fijo en el frontend, igual para todo el catálogo.
Ahora cada producto tiene el suyo, cargado desde el formulario de
Productos -- "crítico" pasa a ser stock <= stock_minimo (0 incluido).

server_default='5' para que los productos que ya existen en la base
arranquen con el mismo valor que tenía la constante fija que reemplaza,
en vez de terminar en NULL/0. nullable=False, igual que la columna
"stock" que ya tenía esa restricción.

Revision ID: f2c916a4b83e
Revises: e5b8f2a9d316
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2c916a4b83e'
down_revision: Union[str, Sequence[str], None] = 'e5b8f2a9d316'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'productos',
        sa.Column('stock_minimo', sa.Integer(), nullable=False, server_default='5'),
    )
    op.create_check_constraint(
        'ck_productos_stock_minimo_non_negative',
        'productos',
        'stock_minimo >= 0',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_productos_stock_minimo_non_negative', 'productos', type_='check')
    op.drop_column('productos', 'stock_minimo')
