"""categorias: saca descripcion, agrega imagen_url

Reemplaza el campo "descripcion" de categorías (no se usaba en ninguna
pantalla) por "imagen_url": la foto de la categoría para la tarjeta con
imagen del menú de "Catálogo" -- ver Categoria en app/models/product.py y
el endpoint POST /categorias/imagenes en router/categories.py, mismo
patrón que Producto.imagen_url.

downgrade() vuelve a agregar "descripcion" pero SIN recuperar los valores
que tuviera antes -- se pierden al hacer upgrade(), igual que cualquier
downgrade que sigue a un drop_column con datos reales cargados. Ninguna
categoría tenía descripcion cargada en producción al momento de esta
migración (campo sin pantalla que lo edite), así que no hay pérdida de
datos real en la práctica.

Revision ID: d3a67f2c91be
Revises: b8f14ac2e6d5
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3a67f2c91be'
down_revision: Union[str, Sequence[str], None] = 'b8f14ac2e6d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('categorias', sa.Column('imagen_url', sa.String(), nullable=True))
    op.drop_column('categorias', 'descripcion')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('categorias', sa.Column('descripcion', sa.String(), nullable=True))
    op.drop_column('categorias', 'imagen_url')
