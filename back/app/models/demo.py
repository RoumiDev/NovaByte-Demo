"""Tenants de la demo pública: cada credencial temporal que el dueño le da
a un visitante (ver back/scripts/crear_acceso_demo.py) vive bajo una fila
de esta tabla. Sirve como el "dueño" común de todo lo que ese visitante ve
o carga durante su acceso (su propio Usuario admin, y los Producto/
Categoria/Pedido que le pertenecen) -- ver tenant_id en app/models/user.py,
app/models/product.py y app/models/order.py.

Aislamiento entre visitantes concurrentes (pedido explícito del dueño: que
un visitante "A" nunca vea lo que cargó un visitante "B", ni viceversa):
cada visitante recibe su propio DemoTenant, así que todo lo que crea queda
en un compartimento separado del de cualquier otro visitante Y de la
tienda real -- la tienda real no pertenece a ningún tenant (tenant_id queda
en NULL en sus filas). Ver el comentario grande en get_tenant_scope
(app/dependencies/auth.py), que es quien realmente aplica este filtro en
cada consulta.

Expiración en dos tiempos, a propósito:
  1. expires_at se chequea en CADA request (ver get_current_user en
     app/dependencies/auth.py): apenas se cumple, ese acceso deja de
     funcionar aunque el JWT en sí todavía no haya vencido.
  2. El borrado FÍSICO de la fila (y, en cascada, de todo lo que le
     pertenecía) lo hace por separado el endpoint de limpieza (GET
     /api/v1/demo/limpieza, ver app/router/demo.py) -- pensado para
     correr una vez por día desde un cron job de Vercel (el plan Hobby no
     permite pedirle más frecuencia).
Sin el paso 1, un acceso vencido seguiría funcionando hasta 24hs más,
esperando a que corra el cron. Sin el paso 2, las filas vencidas (y sus
productos/categorías/usuario/pedidos) se irían acumulando para siempre.

ondelete="CASCADE" en cada tenant_id (ver los modelos que lo tienen) hace
que borrar UNA fila de acá borre en cascada, del lado de Postgres, todo lo
que le pertenecía a ese tenant -- el endpoint de limpieza no necesita
borrar tabla por tabla a mano ni conocer el detalle de cada una.
"""

from sqlalchemy import Column, DateTime, Integer, String, func

from app.core.database import Base


class DemoTenant(Base):
    __tablename__ = "demo_tenants"

    id = Column(Integer, primary_key=True, index=True)
    # Texto libre para que el dueño identifique de un vistazo a quién
    # corresponde este acceso al mirar la tabla a mano (ej. "LinkedIn --
    # Juan Pérez, 17/09"). Nunca se le muestra ni se le pide nada de esto a
    # quien usa la demo -- es sólo una nota interna, ver
    # back/scripts/crear_acceso_demo.py.
    etiqueta = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # A partir de este momento, get_current_user (app/dependencies/auth.py)
    # rechaza cualquier token de un usuario de este tenant, aunque el JWT en
    # sí todavía no haya expirado -- ver el comentario grande más arriba.
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
