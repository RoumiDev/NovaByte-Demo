"""agrega marca_destacada (marcas destacadas del Home)

FEATURE (29/08/2026, pedido del cliente): sección "Marcas destacadas" en
Configuración → General -- 10 posiciones fijas para imágenes de marcas,
que se muestran en el Home en dos filas de 5 (ver
FilaMarcasDestacadas.jsx). Ver MarcaDestacada en app/models/store.py para
el detalle de por qué son 10 filas fijas y no un catálogo libre.

Igual que configuracion_tienda (ver c4a7e1f39d02_agrega_configuracion_
tienda.py), la migración ya precarga las filas -- acá las 10 posiciones
con imagen_url NULL -- así el caso normal ni siquiera pasa por el camino
de autocuración del router (_asegurar_posiciones_marcas en
app/router/store.py), que solo cubre una base recreada sin correr esta
migración.

Revision ID: 9dfe7541658e
Revises: b0fb4a8cf5b0
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9dfe7541658e'
down_revision: Union[str, Sequence[str], None] = 'b0fb4a8cf5b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'marca_destacada',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('posicion', sa.Integer(), nullable=False),
        sa.Column('imagen_url', sa.String(length=2048), nullable=True),
        sa.UniqueConstraint('posicion', name='uq_marca_destacada_posicion'),
    )
    # Precarga las 10 posiciones fijas (1..10), todas sin imagen todavía --
    # el router también sabe crearlas solo si por algún motivo no están,
    # pero dejarlas ya cargadas acá evita ese camino en el caso normal
    # (mismo criterio que configuracion_tienda).
    op.execute(
        "INSERT INTO marca_destacada (posicion, imagen_url) VALUES "
        + ", ".join(f"({i}, NULL)" for i in range(1, 11))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('marca_destacada')
