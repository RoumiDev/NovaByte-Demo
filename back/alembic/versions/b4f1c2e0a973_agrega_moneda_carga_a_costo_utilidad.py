"""agrega moneda_carga al modo costo_utilidad de productos

FEATURE (13/09/2026, pedido del cliente): "Agrega la función de poder
ingresar tanto en pesos ARS como en USD, y que después el sistema haga la
cuenta para que al cliente le figure en pesos argentinos" -- hasta esta
fecha el campo "costo" (modo_precio == 'costo_utilidad') se entendía
SIEMPRE cargado en pesos, y moneda_carga (agregada en la migración
6b501700de15 para el modo 'directo') quedaba en NULL para todo producto en
este otro modo -- ver _normalizar_campos_segun_modo_precio en
router/products.py, versión anterior a esta fecha. A partir de ahora
moneda_carga es compartida por los dos modos: en 'costo_utilidad' dice en
qué moneda está cargado "costo", y _costo_en_ars_expr (app/models/
product.py) lo convierte a pesos antes de correr el resto de la cadena de
cálculo (costo neto -> utilidad -> IVA -> precio final).

Dos pasos, en este orden (importante -- al revés, el segundo paso
fallaría contra los productos ya cargados):

  1. Backfillea a 'ARS' los productos EXISTENTES en modo 'costo_utilidad'
     (hoy en NULL) -- 'ARS' porque hasta esta fecha "costo" siempre se
     cargó en pesos, así que ese es el valor real que ya tenían, no un
     valor arbitrario.
  2. Aprieta ck_productos_campos_segun_modo_precio (app/models/product.py)
     para exigir moneda_carga IS NOT NULL también en la rama
     'costo_utilidad' -- antes solo lo exigía en 'directo'.

Revision ID: b4f1c2e0a973
Revises: f5ac03751359
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4f1c2e0a973'
down_revision: Union[str, Sequence[str], None] = 'f5ac03751359'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Paso 1: backfill. Sin esto, apretar la constraint en el paso 2 de
    # acá abajo fallaría contra cualquier producto ya cargado en modo
    # 'costo_utilidad' (todos, hasta esta fecha, con moneda_carga en NULL).
    op.execute(
        "UPDATE productos SET moneda_carga = 'ARS' "
        "WHERE modo_precio = 'costo_utilidad' AND moneda_carga IS NULL"
    )

    # Paso 2: la constraint vieja (de e2f7b4c1a805) solo exigía
    # moneda_carga IS NOT NULL en la rama 'directo' -- se reemplaza por
    # una que la exige en las dos ramas, ahora que el paso 1 garantiza que
    # ningún producto costo_utilidad quede en NULL.
    op.drop_constraint('ck_productos_campos_segun_modo_precio', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_campos_segun_modo_precio',
        'productos',
        "(modo_precio = 'directo' AND precio_carga IS NOT NULL AND moneda_carga IS NOT NULL) "
        "OR (modo_precio = 'costo_utilidad' AND costo IS NOT NULL AND costo_incluye_iva IS NOT NULL "
        "AND utilidad_porcentaje IS NOT NULL AND moneda_carga IS NOT NULL)",
    )


def downgrade() -> None:
    """Downgrade schema.

    Solo revierte la constraint -- el backfill del paso 1 de upgrade() NO
    se deshace (mismo criterio que el resto de las migraciones de este
    proyecto con backfill, ver por ejemplo f5ac03751359: un downgrade
    reintroduce la ESTRUCTURA vieja, no vuelve a poner NULL donde ya había
    un valor real cargado)."""
    op.drop_constraint('ck_productos_campos_segun_modo_precio', 'productos', type_='check')
    op.create_check_constraint(
        'ck_productos_campos_segun_modo_precio',
        'productos',
        "(modo_precio = 'directo' AND precio_carga IS NOT NULL AND moneda_carga IS NOT NULL) "
        "OR (modo_precio = 'costo_utilidad' AND costo IS NOT NULL AND costo_incluye_iva IS NOT NULL "
        "AND utilidad_porcentaje IS NOT NULL)",
    )
