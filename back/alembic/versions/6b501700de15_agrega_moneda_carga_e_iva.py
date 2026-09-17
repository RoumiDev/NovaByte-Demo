"""agrega moneda_carga e iva

FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
cargar" -- hasta ahora todo producto se cargaba en dólares (ver migración
3e41baba5124). El dueño pidió poder elegir, producto por producto, si lo
carga en pesos (precio final, como se hacía antes de "precio dólar") o en
dólares (precio SIN IVA, según aclaró -- ver el column_property
Producto.precio_venta en app/models/product.py para el detalle completo de
la cuenta).

Esta migración:

1. Agrega productos.moneda_carga ('ARS' o 'USD', restringido con un
   CheckConstraint -- mismo criterio que Usuario.role, ver migración
   b3f6a2d9c751, en vez de un ENUM nativo de Postgres). server_default='USD'
   para las filas existentes: TODOS los productos ya cargados hoy están en
   dólares (por la migración anterior), así que este backfill es
   exactamente correcto, no una aproximación. El default real de acá en
   más lo maneja el modelo (Producto.moneda_carga = Column(..., default=
   "USD")), no la base -- se saca el server_default al final, mismo
   criterio que esa migración de roles.

2. Renombra productos.precio_usd -> productos.precio_carga: ahora puede
   contener un precio en pesos O en dólares según moneda_carga, "precio_usd"
   dejaría de ser un nombre preciso.

3. Renombra el CheckConstraint de precio_usd al nombre nuevo.

4. Agrega productos.iva_porcentaje -- FEATURE (09/09/2026, pedido del
   cliente, corrección sobre la primera versión de esta migración): el
   dueño aclaró que el IVA varía por producto (21% general, 10,5%
   reducido en algunos casos), así que es una columna de productos, NO de
   configuracion_tienda como se había armado en un primer momento -- ver
   el comentario grande en Producto.iva_porcentaje (app/models/product.py).
   server_default='21' (alícuota general, el caso más común de este
   catálogo) para backfillear las filas existentes, y se saca al final --
   mismo patrón backfill-y-listo que moneda_carga, arriba, y que
   Usuario.role (migración b3f6a2d9c751): el default real de acá en más lo
   maneja el modelo, no la base.

Revision ID: 6b501700de15
Revises: 3e41baba5124
Create Date: 2026-09-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b501700de15'
down_revision: Union[str, Sequence[str], None] = '3e41baba5124'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'productos',
        sa.Column('moneda_carga', sa.String(), nullable=False, server_default='USD'),
    )
    op.create_check_constraint(
        'ck_productos_moneda_carga_valida',
        'productos',
        "moneda_carga IN ('ARS', 'USD')",
    )
    op.alter_column('productos', 'moneda_carga', server_default=None)

    op.alter_column('productos', 'precio_usd', new_column_name='precio_carga')
    op.drop_constraint('ck_productos_precio_usd_non_negative', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_precio_carga_non_negative',
        'productos',
        'precio_carga >= 0',
    )

    op.add_column(
        'productos',
        sa.Column('iva_porcentaje', sa.Numeric(5, 2), nullable=False, server_default='21'),
    )
    op.create_check_constraint(
        'ck_productos_iva_porcentaje_valido',
        'productos',
        'iva_porcentaje >= 0 AND iva_porcentaje <= 100',
    )
    op.alter_column('productos', 'iva_porcentaje', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_productos_iva_porcentaje_valido', 'productos', type_='check')
    op.drop_column('productos', 'iva_porcentaje')

    op.drop_constraint('ck_productos_precio_carga_non_negative', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_precio_usd_non_negative',
        'productos',
        'precio_usd >= 0',
    )
    op.alter_column('productos', 'precio_carga', new_column_name='precio_usd')

    op.drop_constraint('ck_productos_moneda_carga_valida', 'productos', type_='check')
    op.drop_column('productos', 'moneda_carga')
