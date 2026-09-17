"""agrega proposito cambiar_email a codigos_verificacion

Sección "Privacidad" ahora permite editar el email propio, con el mismo
mecanismo de código de 6 dígitos que ya existía para verificar el mail al
registrarse y para recuperar la contraseña (ver a7d3e912f4b6). A diferencia
de esos dos, el código de "cambiar_email" se manda a la dirección NUEVA
(todavía no guardada en usuarios.email) -- por eso codigos_verificacion
necesita una columna extra, email_nuevo, para saber a qué dirección
corresponde cada código de ese propósito puntual.

Este es también el momento en que "proposito" deja de ser un ENUM nativo
de Postgres: sumar un tercer valor a un ENUM de Postgres (ALTER TYPE ...
ADD VALUE) es más delicado de manejar en una migración transaccional común
que agregar un valor a un CheckConstraint -- el mismo motivo por el que
"role" (ver b3f6a2d9c751) tampoco es un ENUM nativo. PropositoCodigo en el
modelo ahora hereda de (str, enum.Enum): cada miembro ES un string, así que
el código de las capas de arriba (verification_service.py, router/users.py)
no cambia -- sigue comparando/asignando con PropositoCodigo.cambiar_email
como si fuera el Enum nativo de antes.

Revision ID: c9b47a1e0f3d
Revises: a7d3e912f4b6
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9b47a1e0f3d'
down_revision: Union[str, Sequence[str], None] = 'a7d3e912f4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PROPOSITOS_ORIGINALES = ('verificacion_email', 'recuperar_password')
_PROPOSITOS_ACTUALES = _PROPOSITOS_ORIGINALES + ('cambiar_email',)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'codigos_verificacion',
        sa.Column('email_nuevo', sa.String(length=255), nullable=True),
    )

    # Enum nativo -> texto simple + CheckConstraint (ver docstring de
    # arriba). "USING proposito::text" es necesario porque Postgres no
    # convierte un ENUM a varchar solo -- hay que decirle explícitamente
    # que tome el texto subyacente de cada valor.
    op.alter_column(
        'codigos_verificacion',
        'proposito',
        existing_type=sa.Enum(*_PROPOSITOS_ORIGINALES, name='propositocodigo'),
        type_=sa.String(length=30),
        postgresql_using='proposito::text',
        existing_nullable=False,
    )
    op.create_check_constraint(
        'ck_codigos_verificacion_proposito_valido',
        'codigos_verificacion',
        "proposito IN ('verificacion_email', 'recuperar_password', 'cambiar_email')",
    )

    # El ENUM viejo queda sin ninguna columna que lo use -- borrarlo para no
    # dejarlo huérfano en la base (mismo criterio que la migración anterior
    # al borrar la tabla codigos_verificacion en su downgrade).
    sa.Enum(name='propositocodigo').drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema.

    OJO: si para este momento ya existe algún código con
    proposito='cambiar_email', este downgrade va a fallar al intentar
    convertir esa fila de vuelta a un ENUM que no contempla ese valor --
    esperable: un downgrade de esquema no puede inventar qué hacer con datos
    que la versión vieja del modelo no sabía representar. Si hace falta
    bajar igual, hay que borrar (o migrar a mano) esas filas antes.
    """
    op.drop_constraint('ck_codigos_verificacion_proposito_valido', 'codigos_verificacion', type_='check')

    propositocodigo_enum = sa.Enum(*_PROPOSITOS_ORIGINALES, name='propositocodigo')
    propositocodigo_enum.create(op.get_bind(), checkfirst=True)
    op.alter_column(
        'codigos_verificacion',
        'proposito',
        existing_type=sa.String(length=30),
        type_=propositocodigo_enum,
        postgresql_using='proposito::propositocodigo',
        existing_nullable=False,
    )

    op.drop_column('codigos_verificacion', 'email_nuevo')
