"""agrega debe_avisar_email_verificado a usuarios

FEATURE (12/09/2026, pedido del cliente): columna nueva para el aviso NO
bloqueante que aparece cuando un admin marcó el mail de un cliente como
verificado a mano (ver admin_mark_email_verified en router/users.py,
Usuario.debe_avisar_email_verificado en models/user.py, y el useEffect
correspondiente en SiteLayout.jsx del lado del frontend). Reemplaza al mail
de aviso que se mandaba antes (enviar_notificacion_email_verificado_admin,
ahora sin uso) -- ver el comentario grande junto al campo en models/user.py
sobre por qué ese mail rebotaba siempre.

Mismo patrón que debe_cambiar_password (d4c8a1f6e930) y email_verificado
(a7d3e912f4b6): server_default=false al agregar la columna, para que las
cuentas YA EXISTENTES backfilleen en False (ninguna tiene un aviso
pendiente de una acción que, para empezar, no existía todavía) sin
necesitar un UPDATE aparte -- se saca el server_default al final, de acá
en más el default real lo maneja el modelo, no la base.

Revision ID: f5ac03751359
Revises: e2f7b4c1a805
Create Date: 2026-09-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5ac03751359'
down_revision: Union[str, Sequence[str], None] = 'e2f7b4c1a805'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'usuarios',
        sa.Column('debe_avisar_email_verificado', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column('usuarios', 'debe_avisar_email_verificado', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('usuarios', 'debe_avisar_email_verificado')
