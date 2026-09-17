"""agrega precio dolar

FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- el dueño no
quiere seguir actualizando el precio de cada producto a mano cada vez que
sube el dólar. A partir de ahora carga el precio de cada producto en
dólares, y una única cotización global (nueva, en configuracion_tienda)
convierte todo el catálogo a pesos automáticamente en cada lectura -- ver
el column_property Producto.precio_venta en app/models/product.py, que
reemplaza a la columna física que tenía antes ese mismo nombre.

Esta migración:

1. Renombra productos.precio_venta -> productos.precio_usd. Es un rename,
   no un alta + baja: los valores numéricos que ya había cargados quedan
   igual, solo que ahora se interpretan como dólares en vez de pesos. El
   cliente pidió explícitamente no complicarse con una migración de datos
   prolija acá -- "la app de desarrollo va a ser usada como de prueba" --
   así que no se intenta convertir esos valores viejos a un precio en
   dólares "razonable"; el dueño va a tener que revisar/recargar los
   precios en dólares de su catálogo de test de todos modos.

2. Renombra el CheckConstraint que tenía la columna vieja, para que seguir
   apuntando al nombre nuevo.

3. Agrega configuracion_tienda.cotizacion_dolar. server_default='1': la
   fila singleton (id=1) ya existe en cualquier base que corrió la
   migración c4a7e1f39d02, así que agregar una columna NOT NULL sobre una
   tabla con datos exige un default para esa fila existente. 1 es un valor
   de arranque a propósito absurdo/visible (deja el precio en pesos igual
   al precio en dólares cargado) para que sea obvio que hace falta entrar a
   Configuración → General y cargar la cotización real -- mismo criterio
   que server_default='5' de stock_minimo (f2c916a4b83e), que también se
   deja puesto después de la migración en vez de sacarlo.

Revision ID: 3e41baba5124
Revises: f4a812e6c9d3
Create Date: 2026-09-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e41baba5124'
down_revision: Union[str, Sequence[str], None] = 'f4a812e6c9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('productos', 'precio_venta', new_column_name='precio_usd')
    op.drop_constraint('ck_productos_precio_venta_non_negative', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_precio_usd_non_negative',
        'productos',
        'precio_usd >= 0',
    )
    op.add_column(
        'configuracion_tienda',
        sa.Column('cotizacion_dolar', sa.Numeric(10, 2), nullable=False, server_default='1'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('configuracion_tienda', 'cotizacion_dolar')
    op.drop_constraint('ck_productos_precio_usd_non_negative', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_precio_venta_non_negative',
        'productos',
        'precio_venta >= 0',
    )
    op.alter_column('productos', 'precio_usd', new_column_name='precio_venta')
