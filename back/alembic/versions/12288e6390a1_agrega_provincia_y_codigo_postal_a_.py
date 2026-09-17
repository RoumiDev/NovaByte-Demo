"""agrega provincia y codigo_postal a usuarios

FEATURE (26/08/2026, pedido del cliente): domicilio más completo --
provincia (ENUM de Postgres con las 24 provincias argentinas, ver
Provincia en app/models/user.py) y código postal (String, formato CPA).
Las dos columnas son nullable=True: mismo criterio que direccion (de la
que son parte lógica), no todo usuario ya existente tiene este dato
cargado y no tiene sentido exigirlo retroactivamente.

Nota sobre el ENUM: a diferencia de agregar una columna en la migración de
creación inicial (donde el CREATE TABLE crea el tipo solo), acá hay que
crear el tipo Postgres explícitamente ANTES del ALTER TABLE ADD COLUMN --
por eso el create()/drop() explícito de más abajo en vez de simplemente
pasar sa.Enum(...) a op.add_column.

Revision ID: 12288e6390a1
Revises: f7e2c58a9d14
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '12288e6390a1'
down_revision: Union[str, Sequence[str], None] = 'f7e2c58a9d14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mismos nombres de miembro que la clase Provincia en app/models/user.py
# (el nombre del miembro es lo que SQLAlchemy graba en el ENUM de
# Postgres -- el string legible, ej. "Buenos Aires", es solo el .value de
# cada miembro en Python/Pydantic, no lo que queda en la base).
_VALORES_PROVINCIA = (
    'buenos_aires', 'catamarca', 'chaco', 'chubut', 'caba', 'cordoba',
    'corrientes', 'entre_rios', 'formosa', 'jujuy', 'la_pampa', 'la_rioja',
    'mendoza', 'misiones', 'neuquen', 'rio_negro', 'salta', 'san_juan',
    'san_luis', 'santa_cruz', 'santa_fe', 'santiago_del_estero',
    'tierra_del_fuego', 'tucuman',
)


def upgrade() -> None:
    """Upgrade schema."""
    provincia_enum = sa.Enum(*_VALORES_PROVINCIA, name='provincia')
    provincia_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'usuarios',
        sa.Column('provincia', sa.Enum(*_VALORES_PROVINCIA, name='provincia', create_type=False), nullable=True),
    )
    op.add_column('usuarios', sa.Column('codigo_postal', sa.String(length=8), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('usuarios', 'codigo_postal')
    op.drop_column('usuarios', 'provincia')
    sa.Enum(name='provincia').drop(op.get_bind(), checkfirst=True)
