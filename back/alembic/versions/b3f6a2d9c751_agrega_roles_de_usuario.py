"""agrega roles de usuario (admin/ayudante/cliente)

Reemplaza el viejo campo booleano is_admin (todo-o-nada) por un campo
role de tres niveles: admin (acceso total), ayudante (staff -- por ahora
puede ver todos los pedidos), cliente (comprador normal, el default).

Los usuarios que ya tenían is_admin=true se migran a role='admin'; el
resto queda en 'cliente'. El downgrade reconstruye is_admin a partir de
esa misma correspondencia (role='admin' -> is_admin=true) -- no hay
pérdida de información en ninguno de los dos sentidos, a diferencia de
otras migraciones destructivas de este proyecto.

Revision ID: b3f6a2d9c751
Revises: a1c9f7e2d84b
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f6a2d9c751'
down_revision: Union[str, Sequence[str], None] = 'a1c9f7e2d84b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default temporal: la columna nace NOT NULL y hace falta un
    # valor para las filas existentes antes del backfill de abajo. Se saca
    # al final -- el default real de acá en más lo maneja el modelo
    # (Usuario.role = Column(..., default="cliente")), no la base, mismo
    # criterio que is_active.
    op.add_column(
        'usuarios',
        sa.Column('role', sa.String(), nullable=False, server_default='cliente'),
    )
    op.execute("UPDATE usuarios SET role = 'admin' WHERE is_admin IS TRUE")
    op.create_check_constraint(
        'ck_usuarios_role_valido',
        'usuarios',
        "role IN ('admin', 'ayudante', 'cliente')",
    )
    op.alter_column('usuarios', 'role', server_default=None)
    op.drop_column('usuarios', 'is_admin')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('usuarios', sa.Column('is_admin', sa.Boolean(), nullable=True))
    op.execute("UPDATE usuarios SET is_admin = (role = 'admin')")
    op.drop_constraint('ck_usuarios_role_valido', 'usuarios', type_='check')
    op.drop_column('usuarios', 'role')
