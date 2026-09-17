"""agrega configuracion_tienda (horarios de atencion)

Tabla nueva, singleton (una sola fila, id=1): datos generales de la
tienda que no pertenecen a un producto/categoría/pedido puntual. Por
ahora solo horarios_atencion (texto libre, lo carga el dueño desde el
panel de Configuración y se muestra en la página pública de Contacto).

Revision ID: c4a7e1f39d02
Revises: b3f6a2d9c751
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a7e1f39d02'
down_revision: Union[str, Sequence[str], None] = 'b3f6a2d9c751'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'configuracion_tienda',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('horarios_atencion', sa.Text(), nullable=True),
    )
    # Precarga la fila singleton (id=1) -- el router también sabe crearla
    # sola si por algún motivo no está, pero dejarla ya cargada acá evita
    # ese camino en el caso normal.
    op.execute("INSERT INTO configuracion_tienda (id, horarios_atencion) VALUES (1, NULL)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('configuracion_tienda')
