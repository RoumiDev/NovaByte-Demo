"""agrega ciudad a usuarios

FEATURE (26/08/2026, pedido del cliente): ciudad del domicilio, separada
de direccion (que es solo calle/altura) -- ver Usuario.ciudad en
app/models/user.py. String simple, no ENUM: a diferencia de provincia, el
universo de ciudades argentinas es demasiado grande para un conjunto fijo.

Columna nullable=True (mismo criterio que direccion/provincia/
codigo_postal): ya existen cuentas registradas antes de este cambio, y no
tiene sentido exigir el dato retroactivamente para ellas. La
obligatoriedad para cuentas nuevas se aplica en Pydantic (UsuarioCreate,
ver app/schemas/user.py), no acá.

Revision ID: b0fb4a8cf5b0
Revises: 12288e6390a1
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b0fb4a8cf5b0'
down_revision: Union[str, Sequence[str], None] = '12288e6390a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('usuarios', sa.Column('ciudad', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('usuarios', 'ciudad')
