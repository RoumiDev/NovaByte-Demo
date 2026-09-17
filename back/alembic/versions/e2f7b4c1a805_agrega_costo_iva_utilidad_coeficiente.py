"""agrega modo de precio costo+iva+utilidad+coeficiente a productos

FEATURE (11/09/2026, pedido del cliente): segunda forma de cargar el
precio de un producto -- costo, si el costo incluye IVA o no, porcentaje
de utilidad y un coeficiente de conversión de unidad de compra a unidad de
venta -- alternativa a la ya existente (moneda_carga/precio_carga, que
pasa a llamarse el modo "directo"). Conviven las dos: cada producto elige
una con la columna nueva modo_precio, ver Producto en app/models/
product.py para el detalle completo de la cadena de cálculo (costo neto ->
utilidad -> precio sin IVA -> IVA -> precio final).

Todas las columnas nuevas son nullable=True EXCEPTO modo_precio
(server_default='directo', mismo criterio de backfill que otras columnas
"nuevo modo, viejo comportamiento por default" de este proyecto -- ver
email_verificado en la migración a7d3e912f4b6) y coeficiente
(server_default=1: es el valor neutro, no cambia nada para los productos
que ya existen y no usan este modo). precio_carga/moneda_carga pasan de
NOT NULL a nullable=True -- un producto en modo_precio='costo_utilidad' no
los usa (ver el CheckConstraint ck_productos_campos_segun_modo_precio, que
exige uno de los dos juegos de campos completo, nunca ninguno a medias);
ningún producto existente se ve afectado por este relajamiento, todos
siguen teniendo sus valores de siempre.

Revision ID: e2f7b4c1a805
Revises: d4c8a1f6e930
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f7b4c1a805'
down_revision: Union[str, Sequence[str], None] = 'd4c8a1f6e930'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # precio_carga/moneda_carga pasan a admitir NULL -- un producto en modo
    # 'costo_utilidad' no los usa. No hace falta backfill acá: ningún
    # producto existente queda con estos campos en NULL, todos siguen
    # siendo modo_precio='directo' (ver server_default más abajo) con sus
    # valores de siempre intactos.
    op.alter_column('productos', 'precio_carga', existing_type=sa.Numeric(10, 2), nullable=True)
    op.alter_column('productos', 'moneda_carga', existing_type=sa.String(), nullable=True)

    op.add_column(
        'productos',
        sa.Column('modo_precio', sa.String(), nullable=False, server_default='directo'),
    )
    op.alter_column('productos', 'modo_precio', server_default=None)

    op.add_column('productos', sa.Column('costo', sa.Numeric(12, 2), nullable=True))
    op.add_column('productos', sa.Column('costo_incluye_iva', sa.Boolean(), nullable=True))
    op.add_column('productos', sa.Column('utilidad_porcentaje', sa.Numeric(6, 2), nullable=True))

    op.add_column(
        'productos',
        sa.Column('coeficiente', sa.Numeric(10, 4), nullable=False, server_default='1'),
    )
    op.alter_column('productos', 'coeficiente', server_default=None)

    op.create_check_constraint(
        'ck_productos_modo_precio_valido',
        'productos',
        "modo_precio IN ('directo', 'costo_utilidad')",
    )
    op.create_check_constraint(
        'ck_productos_costo_non_negative',
        'productos',
        "costo IS NULL OR costo >= 0",
    )
    op.create_check_constraint(
        'ck_productos_utilidad_porcentaje_valido',
        'productos',
        "utilidad_porcentaje IS NULL OR (utilidad_porcentaje >= -100 AND utilidad_porcentaje <= 1000)",
    )
    op.create_check_constraint(
        'ck_productos_coeficiente_positivo',
        'productos',
        "coeficiente > 0",
    )
    op.create_check_constraint(
        'ck_productos_campos_segun_modo_precio',
        'productos',
        "(modo_precio = 'directo' AND precio_carga IS NOT NULL AND moneda_carga IS NOT NULL) "
        "OR (modo_precio = 'costo_utilidad' AND costo IS NOT NULL AND costo_incluye_iva IS NOT NULL "
        "AND utilidad_porcentaje IS NOT NULL)",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_productos_campos_segun_modo_precio', 'productos', type_='check')
    op.drop_constraint('ck_productos_coeficiente_positivo', 'productos', type_='check')
    op.drop_constraint('ck_productos_utilidad_porcentaje_valido', 'productos', type_='check')
    op.drop_constraint('ck_productos_costo_non_negative', 'productos', type_='check')
    op.drop_constraint('ck_productos_modo_precio_valido', 'productos', type_='check')

    op.drop_column('productos', 'coeficiente')
    op.drop_column('productos', 'utilidad_porcentaje')
    op.drop_column('productos', 'costo_incluye_iva')
    op.drop_column('productos', 'costo')
    op.drop_column('productos', 'modo_precio')

    op.alter_column('productos', 'moneda_carga', existing_type=sa.String(), nullable=False)
    op.alter_column('productos', 'precio_carga', existing_type=sa.Numeric(10, 2), nullable=False)
