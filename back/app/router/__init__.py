"""Agrupa todos los routers de la API bajo un único api_router."""

from fastapi import APIRouter

from app.router import auth, categories, demo, orders, payments, products, store, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(categories.router, prefix="/categorias", tags=["categorias"])
api_router.include_router(products.router, prefix="/productos", tags=["productos"])
api_router.include_router(orders.router, prefix="/pedidos", tags=["pedidos"])
api_router.include_router(payments.router, prefix="/pagos", tags=["pagos"])
api_router.include_router(store.router, prefix="/configuracion", tags=["configuracion"])
# FEATURE (17/09/2026, pedido del cliente -- "accesos temporales a la
# demo"): sin tag en Swagger (docs_url igual queda deshabilitado con
# DEBUG=False de cualquier forma, ver app/main.py) -- GET /demo/limpieza
# no es un endpoint pensado para un humano ni para el frontend, solo para
# el Cron Job diario de Vercel (ver app/router/demo.py y vercel.json).
api_router.include_router(demo.router, prefix="/demo", tags=["demo"])
# BORRADO (29/08/2026, pedido del cliente): el backup/restauración manual
# desde la app (router/backup.py + services/backup_service.py) se dio de
# baja -- de acá en más los únicos dos sistemas de backup son el del propio
# servidor de hosting y, más adelante, un script propio corrido por fuera
# de esta app (ver comentario en app/core/config.py). router/backup.py y
# services/backup_service.py quedaron sin uso: se pueden borrar a mano, esta
# sesión no tiene forma de eliminar archivos de tu computadora.
