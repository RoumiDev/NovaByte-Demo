"""agrega demo_tenants y tenant_id (accesos temporales aislados de demo)

FEATURE (17/09/2026, pedido del cliente): "que le pueda dar una credencial
temporal (como admin) para que pueda ver como es la aplicación por dentro
... pero que si otro usuario me pide usar esta demo, que ambas cuentas no
choquen, que el usuario 'A' no vea los productos que cargó el usuario 'B',
viceversa". Hasta esta fecha la app era estrictamente de UN solo tenant:
productos/categorías eran tablas globales, sin ningún concepto de "a quién
pertenece esta fila" más allá de la tienda real.

Esta migración agrega:

1. demo_tenants: una fila por cada acceso temporal de demo emitido (ver
   back/scripts/crear_acceso_demo.py) -- ver app/models/demo.py para el
   detalle completo de expiración y borrado en cascada.

2. tenant_id (nullable, FK a demo_tenants.id, ondelete=CASCADE) en
   usuarios, categorias, productos y pedidos -- NULL para toda fila real de
   la tienda (el caso de siempre, sin cambios); si no, pertenece a un
   tenant demo puntual. Ver el comentario grande en Usuario.tenant_id
   (app/models/user.py) para el porqué de ondelete=CASCADE en cada una.

3. Reemplaza el índice único de categorias.nombre (antes global, un solo
   nombre en TODA la tabla) por dos índices únicos PARCIALES: uno para
   tenant_id IS NULL (la tienda real) y otro para (tenant_id, nombre) con
   tenant_id IS NOT NULL (cada tenant demo por separado) -- así "Periféricos"
   puede existir una vez en la tienda real y una vez por cada visitante de
   la demo sin chocar entre sí. Ver el comentario grande en la clase
   Categoria (app/models/product.py) sobre por qué son DOS índices
   parciales y no un UniqueConstraint(tenant_id, nombre) común (Postgres no
   trata dos NULL como iguales en un UniqueConstraint normal).

OJO al hacer downgrade (verificado a mano, 17/09/2026): el downgrade
recrea un único índice único GLOBAL sobre categorias.nombre (el que había
antes de esta migración) -- eso solo puede aplicarse si, en ese momento,
no hay dos categorías con el mismo nombre en toda la tabla. Con más de un
DemoTenant sembrado (ver back/scripts/crear_acceso_demo.py --
sembrar_catalogo siempre usa los mismos 4 nombres de categoría para
CUALQUIER tenant), eso es la norma, no la excepción -- el downgrade va a
fallar con un IntegrityError de índice único duplicado apenas exista un
segundo tenant con, por ejemplo, dos categorías "Periféricos". Si alguna
vez hace falta bajar esta migración en una base con tenants de demo ya
creados, hay que borrar antes todas las filas de demo_tenants (arrastra en
cascada sus categorías) -- ver la limpieza en app/router/demo.py.

Revision ID: a3f9c72e1d68
Revises: b4f1c2e0a973
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c72e1d68'
down_revision: Union[str, Sequence[str], None] = 'b4f1c2e0a973'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'demo_tenants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('etiqueta', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_demo_tenants_id'), 'demo_tenants', ['id'], unique=False)
    op.create_index(op.f('ix_demo_tenants_expires_at'), 'demo_tenants', ['expires_at'], unique=False)

    for tabla in ('usuarios', 'categorias', 'productos', 'pedidos'):
        op.add_column(tabla, sa.Column('tenant_id', sa.Integer(), nullable=True))
        op.create_index(op.f(f'ix_{tabla}_tenant_id'), tabla, ['tenant_id'], unique=False)
        op.create_foreign_key(
            f'fk_{tabla}_tenant_id_demo_tenants',
            tabla,
            'demo_tenants',
            ['tenant_id'],
            ['id'],
            ondelete='CASCADE',
        )

    # Reemplaza el único índice único global de categorias.nombre (ver el
    # comentario grande arriba) -- primero se saca el viejo, después se
    # recrea SIN unique (nombre sigue indexado para búsquedas, solo deja de
    # imponer unicidad acá) y se agregan los dos índices únicos parciales.
    op.drop_index(op.f('ix_categorias_nombre'), table_name='categorias')
    op.create_index(op.f('ix_categorias_nombre'), 'categorias', ['nombre'], unique=False)
    op.create_index(
        'uq_categorias_nombre_produccion',
        'categorias',
        ['nombre'],
        unique=True,
        postgresql_where=sa.text('tenant_id IS NULL'),
    )
    op.create_index(
        'uq_categorias_nombre_por_tenant',
        'categorias',
        ['tenant_id', 'nombre'],
        unique=True,
        postgresql_where=sa.text('tenant_id IS NOT NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_categorias_nombre_por_tenant', table_name='categorias')
    op.drop_index('uq_categorias_nombre_produccion', table_name='categorias')
    op.drop_index(op.f('ix_categorias_nombre'), table_name='categorias')
    op.create_index(op.f('ix_categorias_nombre'), 'categorias', ['nombre'], unique=True)

    for tabla in ('usuarios', 'categorias', 'productos', 'pedidos'):
        op.drop_constraint(f'fk_{tabla}_tenant_id_demo_tenants', tabla, type_='foreignkey')
        op.drop_index(op.f(f'ix_{tabla}_tenant_id'), table_name=tabla)
        op.drop_column(tabla, 'tenant_id')

    op.drop_index(op.f('ix_demo_tenants_expires_at'), table_name='demo_tenants')
    op.drop_index(op.f('ix_demo_tenants_id'), table_name='demo_tenants')
    op.drop_table('demo_tenants')
