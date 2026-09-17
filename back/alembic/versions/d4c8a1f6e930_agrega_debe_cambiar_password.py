"""agrega debe_cambiar_password a usuarios

FEATURE (11/09/2026, pedido del cliente): columna nueva para la pantalla
obligatoria de cambiar contraseña que aparece cuando un admin restableció
la de un cliente a mano (ver admin_reset_password en router/users.py,
Usuario.debe_cambiar_password en models/user.py, y
CambiarPasswordObligatorio.jsx/SiteLayout.jsx del lado del frontend).

Mismo patrón que email_verificado (a7d3e912f4b6): server_default=false
al agregar la columna, para que las cuentas YA EXISTENTES backfilleen en
False (ninguna cuenta vieja tiene una contraseña "temporal" pendiente de
cambiar) sin necesitar un UPDATE aparte -- se saca el server_default al
final, de acá en más el default real lo maneja el modelo, no la base.

Revision ID: d4c8a1f6e930
Revises: 6b501700de15
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4c8a1f6e930'
down_revision: Union[str, Sequence[str], None] = '6b501700de15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'usuarios',
        sa.Column('debe_cambiar_password', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column('usuarios', 'debe_cambiar_password', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('usuarios', 'debe_cambiar_password')
