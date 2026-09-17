"""agrega tabla de productos relacionados

Tabla nueva productos_relacionados: la sección "También vas a necesitar"
de la ficha de producto (ProductoDetalle.jsx) -- ej. vincular una
impresora con su tóner, cartucho y hojas. Es una tabla de unión
self-referential producto<->producto -- ver ProductoRelacionado en
app/models/product.py y los endpoints GET/POST/DELETE
/productos/{id}/relacionados en router/products.py.

El vínculo es bidireccional por diseño (pedido puntual del dueño de la
tienda): cargarlo una sola vez, desde cualquiera de los dos productos,
alcanza para que aparezca en las dos fichas. Para lograrlo sin guardar el
mismo par dos veces (A-B y B-A), se fuerza un orden canónico con el
CheckConstraint de abajo -- producto_id_a siempre es el id más chico de
los dos -- y el endpoint ordena los ids con sorted(...) antes de guardar.
Ese mismo CheckConstraint de paso impide que un producto quede
"relacionado consigo mismo" (ningún id es menor que sí mismo).

ondelete='CASCADE' en las dos FK, mismo criterio que favoritos
(b8f14ac2e6d5): si alguno de los dos productos se borra físicamente
alguna vez, el vínculo no tiene sentido colgado de la nada.

Revision ID: f7e2c58a9d14
Revises: d3a67f2c91be
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7e2c58a9d14'
down_revision: Union[str, Sequence[str], None] = 'd3a67f2c91be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'productos_relacionados',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('producto_id_a', sa.Integer(), nullable=False),
        sa.Column('producto_id_b', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.CheckConstraint('producto_id_a < producto_id_b', name='ck_productos_relacionados_orden_canonico'),
        sa.ForeignKeyConstraint(['producto_id_a'], ['productos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['producto_id_b'], ['productos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('producto_id_a', 'producto_id_b', name='uq_productos_relacionados_par'),
    )
    op.create_index(op.f('ix_productos_relacionados_id'), 'productos_relacionados', ['id'], unique=False)
    op.create_index(
        op.f('ix_productos_relacionados_producto_id_a'), 'productos_relacionados', ['producto_id_a'], unique=False
    )
    op.create_index(
        op.f('ix_productos_relacionados_producto_id_b'), 'productos_relacionados', ['producto_id_b'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_productos_relacionados_producto_id_b'), table_name='productos_relacionados')
    op.drop_index(op.f('ix_productos_relacionados_producto_id_a'), table_name='productos_relacionados')
    op.drop_index(op.f('ix_productos_relacionados_id'), table_name='productos_relacionados')
    op.drop_table('productos_relacionados')
