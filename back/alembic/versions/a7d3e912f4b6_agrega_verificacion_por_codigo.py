"""agrega verificacion de email y recuperar password por codigo

Dos cambios relacionados, en una sola migración porque son parte de la
misma feature:

1. usuarios.email_verificado (bool): arranca en False para cuentas
   nuevas (lo maneja el modelo, ver Usuario.email_verificado en
   models/user.py) pero las cuentas que YA EXISTÍAN antes de este campo
   arrancan en True -- server_default=true backfillea eso solo al agregar
   la columna, sin necesidad de un UPDATE aparte (no tiene sentido
   "desverificar" retroactivamente cuentas que ya venían funcionando). Se
   saca el server_default al final, mismo criterio que la migración de
   "role" (b3f6a2d9c751): de acá en más el default real lo maneja el
   modelo, no la base.

2. Tabla nueva codigos_verificacion: códigos de 6 dígitos de un solo uso
   (hasheados, nunca en texto plano -- ver codigo_hash) para confirmar
   que quien pide una acción sensible (verificar el mail al registrarse,
   restablecer una contraseña olvidada, y a futuro cualquier otra) tiene
   acceso al mail con el que se registró. Ver CodigoVerificacion en
   models/user.py y app/services/verification_service.py.

Revision ID: a7d3e912f4b6
Revises: f2c916a4b83e
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7d3e912f4b6'
down_revision: Union[str, Sequence[str], None] = 'f2c916a4b83e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'usuarios',
        sa.Column('email_verificado', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column('usuarios', 'email_verificado', server_default=None)

    op.create_table(
        'codigos_verificacion',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column(
            'proposito',
            sa.Enum('verificacion_email', 'recuperar_password', name='propositocodigo'),
            nullable=False,
        ),
        sa.Column('codigo_hash', sa.String(length=255), nullable=False),
        sa.Column('intentos', sa.Integer(), nullable=False),
        sa.Column('usado', sa.Boolean(), nullable=False),
        sa.Column('expira_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_codigos_verificacion_id'), 'codigos_verificacion', ['id'], unique=False)
    op.create_index(op.f('ix_codigos_verificacion_usuario_id'), 'codigos_verificacion', ['usuario_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_codigos_verificacion_usuario_id'), table_name='codigos_verificacion')
    op.drop_index(op.f('ix_codigos_verificacion_id'), table_name='codigos_verificacion')
    op.drop_table('codigos_verificacion')
    # El ENUM de Postgres no se borra solo al borrar la tabla que lo usaba
    # -- hay que sacarlo a mano, si no queda huérfano en la base.
    sa.Enum(name='propositocodigo').drop(op.get_bind(), checkfirst=True)

    op.drop_column('usuarios', 'email_verificado')
