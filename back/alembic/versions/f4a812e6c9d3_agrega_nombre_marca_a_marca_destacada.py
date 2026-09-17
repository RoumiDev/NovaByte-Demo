"""agrega nombre_marca a marca_destacada

FEATURE (30/08/2026, pedido del cliente): "al hacer clic en cualquiera de
estas imágenes, que mande al catálogo y muestre todos los productos de
dicha marca" -- para eso, cada posición de MarcaDestacada (ver
app/models/store.py) necesita saber a qué Producto.marca corresponde su
imagen, no solo la imagen en sí.

Columna nullable=True: las posiciones que ya tenían una imagen cargada
antes de este campo (o una posición vacía) quedan con nombre_marca=NULL
-- el Home simplemente no hace clickeable esa imagen hasta que el admin
le asigne una marca desde el panel (ver ModalCargarImagenMarca.jsx).

Revision ID: f4a812e6c9d3
Revises: 9dfe7541658e
Create Date: 2026-08-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a812e6c9d3'
down_revision: Union[str, Sequence[str], None] = '9dfe7541658e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('marca_destacada', sa.Column('nombre_marca', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('marca_destacada', 'nombre_marca')
