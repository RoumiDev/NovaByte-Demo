"""Configuración centralizada de la aplicación y de la sesión JWT."""

import os
from pathlib import Path

from dotenv import load_dotenv


# Cargar siempre el .env de la raíz del backend, sin depender de dónde se ejecute Uvicorn.
BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")

# FEATURE (17/09/2026, deploy en Vercel): "VERCEL" es una variable que
# Vercel setea sola (a "1") en toda función serverless suya -- no hace
# falta cargarla a mano en ningún .env, sólo está presente ahí. Se usa acá
# abajo para no intentar crear carpetas en un filesystem de sólo lectura
# (ver el comentario grande de STORAGE_PRODUCTOS_DIR/STORAGE_CATEGORIAS_DIR
# más abajo), y en app/main.py para no arrancar el scheduler en background
# de app/jobs/reconciliacion_pagos.py (una función serverless no tiene
# proceso persistente donde ese scheduler pueda seguir vivo entre
# requests -- ver el comentario ahí).
EN_VERCEL = bool(os.getenv("VERCEL"))

# Carpeta donde se guardan las imágenes de productos subidas desde el panel
# admin (ver POST /productos/imagenes) -- SOLO en desarrollo local o en un
# hosting con disco persistente. Carpeta única y plana a propósito: un
# producto puede cambiar de categoría, así que organizar por categoría
# obligaría a mover archivos físicos cada vez que eso pase. No se versiona
# en git (ver .gitignore).
#
# FIX (17/09/2026, deploy en Vercel): antes esto hacía
# STORAGE_PRODUCTOS_DIR.mkdir(...) sin condición ninguna, al importar este
# módulo -- en una función serverless de Vercel el filesystem es de sólo
# lectura fuera de /tmp, así que ese mkdir tiraba PermissionError/OSError
# ahí mismo, en el import, tumbando la app entera antes de poder responder
# ni un solo request. Ahora sólo se crea la carpeta si NO estamos en Vercel
# (ver EN_VERCEL más arriba) -- en Vercel las imágenes van a Vercel Blob en
# cambio (ver BLOB_READ_WRITE_TOKEN más abajo y app/services/vercel_blob.py),
# así que esta carpeta directamente no se usa ahí.
STORAGE_PRODUCTOS_DIR = BASE_DIR / "storage" / "productos"
if not EN_VERCEL:
    STORAGE_PRODUCTOS_DIR.mkdir(parents=True, exist_ok=True)

# Carpeta donde se guardan las imágenes de categorías subidas desde el
# panel admin (ver POST /categorias/imagenes) -- la tarjeta con foto por
# categoría del menú de "Catálogo". Aparte de STORAGE_PRODUCTOS_DIR porque
# es contenido distinto (una foto por categoría, no por producto); mismo
# criterio de carpeta plana, no versionada en git, y mismo FIX (17/09/2026)
# de más arriba sobre por qué el mkdir es condicional.
STORAGE_CATEGORIAS_DIR = BASE_DIR / "storage" / "categorias"
if not EN_VERCEL:
    STORAGE_CATEGORIAS_DIR.mkdir(parents=True, exist_ok=True)

# FEATURE (17/09/2026, deploy en Vercel): token del Blob store del proyecto
# (Storage → tu store → variables de entorno, Vercel ya lo agrega solo como
# BLOB_READ_WRITE_TOKEN al conectar un store -- ver la guía de despliegue en
# back/DEPLOY.md). Opcional a propósito, a diferencia de MP_ACCESS_TOKEN y
# el resto de la config sensible de más abajo: en desarrollo local
# simplemente no se setea, y subir_imagen_producto/subir_imagen_categoria
# (app/router/products.py y app/router/categories.py) siguen guardando en
# disco local como siempre -- ver blob_habilitado() en
# app/services/vercel_blob.py, que es quien decide cuál de los dos modos
# corresponde en cada subida.
BLOB_READ_WRITE_TOKEN = os.getenv("BLOB_READ_WRITE_TOKEN")

# FEATURE (17/09/2026, pedido del cliente -- "accesos temporales a la
# demo"): secreto compartido que valida GET /api/v1/demo/limpieza (ver
# app/router/demo.py) contra el header Authorization que Vercel agrega
# solo a las llamadas de su propio Cron Job cuando existe una variable de
# entorno CRON_SECRET (ver vercel.json y la guía de despliegue en
# back/DEPLOY.md) -- sin este chequeo, cualquiera que descubriera la URL
# del endpoint podría dispararlo a mano en cualquier momento. Opcional acá
# (a diferencia de SECRET_KEY): sin setear, ese endpoint simplemente
# rechaza TODAS las llamadas (ver _verificar_secreto_cron en
# app/router/demo.py) -- falla cerrado, nunca abierto.
CRON_SECRET = os.getenv("CRON_SECRET")


def _positive_int(environment_name: str, default: int) -> int:
    """Leer un entero positivo desde .env y fallar temprano si es inválido."""
    try:
        value = int(os.getenv(environment_name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{environment_name} debe ser un entero positivo.") from error
    if value <= 0:
        raise RuntimeError(f"{environment_name} debe ser mayor que cero.")
    return value


# Configuración general.
APP_NAME = os.getenv("APP_NAME", "NovaByte E-Commerce API")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"
DATABASE_URL = os.getenv("DATABASE_URL")

# CORS: orígenes explícitamente permitidos, separados por coma en el .env
# (ej. "https://tienda.com,https://admin.tienda.com"). Vacío por defecto para
# no arrancar en modo permisivo por omisión: en producción hay que configurar
# el/los dominios reales del frontend.
_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [origin.strip() for origin in _allowed_origins_raw.split(",") if origin.strip()]

# JWT: cambiar estos valores en el archivo .env cuando cambie la política de sesión.
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

# Access token: vida corta e independiente de la del refresh token (ver informe de
# auditoría, hallazgo H-01). No es revocable individualmente, por eso debe expirar rápido.
ACCESS_TOKEN_LIFETIME_MINUTES = _positive_int("ACCESS_TOKEN_EXPIRE_MINUTES", 15)

# Refresh token: vive mientras el usuario tenga actividad, con un margen de gracia
# tras la última actividad antes de forzar un nuevo login.
SESSION_INACTIVITY_MINUTES = _positive_int("SESSION_INACTIVITY_MINUTES", 120)
SESSION_LOGOUT_COUNTDOWN_MINUTES = _positive_int("SESSION_LOGOUT_COUNTDOWN_MINUTES", 60)
REFRESH_TOKEN_LIFETIME_MINUTES = (
    SESSION_INACTIVITY_MINUTES + SESSION_LOGOUT_COUNTDOWN_MINUTES
)

# Cookie httpOnly donde viaja el refresh token (hallazgo ALTA de la auditoría
# AppSec, 2026-08-23: ver TokenResponse en app/schemas/auth.py). Si hay que
# tocar cómo se arma o se borra esta cookie, el código está en
# _setear_cookie_refresh / _borrar_cookie_refresh en app/router/auth.py.
REFRESH_COOKIE_NAME = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")
# Restringida a /api/v1/auth (no a toda la API): el navegador no la adjunta a
# ninguna otra ruta, así un endpoint no-auth comprometido no puede leerla ni
# reenviarla a otro lado.
REFRESH_COOKIE_PATH = os.getenv("REFRESH_COOKIE_PATH", "/api/v1/auth")
# Lax alcanza para mitigar CSRF acá: estas rutas solo se llaman vía
# fetch/axios desde el propio frontend, nunca como destino de un submit
# cross-site. OJO: si algún día el frontend se sirve en un dominio DISTINTO
# del de esta API (dos túneles, por ejemplo), Lax no alcanza -- ahí hace
# falta SameSite=None (y Secure=True, obligatorio en ese caso).
REFRESH_COOKIE_SAMESITE = os.getenv("REFRESH_COOKIE_SAMESITE", "lax")
# Secure=True en producción (HTTPS obligatorio para que el navegador la
# mande). Se puede forzar por .env; si no está seteada, se infiere de DEBUG
# para no exigir HTTPS en desarrollo local (http://localhost).
REFRESH_COOKIE_SECURE = os.getenv("REFRESH_COOKIE_SECURE", str(not DEBUG)).lower() == "true"

# Build de producción del frontend (npm run build en front/). Si esta
# carpeta existe, app/main.py sirve el frontend directamente desde ESTA API
# (mismo origen, sin CORS ni cookies cross-site) -- pensado para demos
# temporales con un solo túnel, NO para el despliegue real (ahí el frontend
# va aparte, servido por un CDN/Nginx). Si no se necesita, simplemente no
# correr el build: esta app sigue funcionando igual, solo como API.
_frontend_dist_env = os.getenv("FRONTEND_DIST_DIR", "")
FRONTEND_DIST_DIR = (
    Path(_frontend_dist_env) if _frontend_dist_env else BASE_DIR.parent / "front" / "dist"
)

# Usar solamente algoritmos HMAC explícitamente soportados por esta aplicación.
ALLOWED_JWT_ALGORITHMS = {"HS256", "HS384", "HS512"}
if ALGORITHM not in ALLOWED_JWT_ALGORITHMS:
    raise RuntimeError("ALGORITHM debe ser HS256, HS384 o HS512.")
if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY debe existir y tener al menos 32 caracteres.")

# Mercado Pago (Checkout Pro): access token de la cuenta vendedora y secret
# para validar la firma de los webhooks. Fallan rápido igual que SECRET_KEY:
# un pago mal configurado en producción es peor que la app sin arrancar.
MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN")
MP_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET")
if not MP_ACCESS_TOKEN:
    raise RuntimeError("MP_ACCESS_TOKEN debe estar configurado (access token de Mercado Pago).")
if not MP_WEBHOOK_SECRET:
    raise RuntimeError("MP_WEBHOOK_SECRET debe estar configurado (secret de firma de webhooks).")

# URLs a las que Mercado Pago redirige al comprador según el resultado del
# pago. Deben ser URLs del FRONTEND (no de esta API), así que no tienen un
# valor por defecto razonable -- si faltan, mejor fallar temprano que mandar
# al comprador a una URL rota en medio de un pago real.
MP_SUCCESS_URL = os.getenv("MP_SUCCESS_URL")
MP_FAILURE_URL = os.getenv("MP_FAILURE_URL")
MP_PENDING_URL = os.getenv("MP_PENDING_URL")
if not (MP_SUCCESS_URL and MP_FAILURE_URL and MP_PENDING_URL):
    raise RuntimeError(
        "MP_SUCCESS_URL, MP_FAILURE_URL y MP_PENDING_URL deben estar configuradas "
        "(URLs del frontend a las que Mercado Pago redirige tras el pago)."
    )

# URL pública y accesible desde internet de ESTA API (no localhost), usada
# para armar el notification_url que Mercado Pago llama para avisar pagos.
API_PUBLIC_BASE_URL = os.getenv("API_PUBLIC_BASE_URL", "").rstrip("/")
if not API_PUBLIC_BASE_URL:
    raise RuntimeError(
        "API_PUBLIC_BASE_URL debe estar configurada (URL pública de esta API, "
        "para que Mercado Pago pueda notificar pagos via webhook)."
    )

# Mail saliente (códigos de verificación de mail y de recuperar contraseña,
# ver app/services/email_service.py): SMTP con una cuenta de Gmail de la
# tienda. Falla rápido igual que el resto de la config sensible de acá
# arriba -- sin esto, el registro y el login siguen funcionando, pero
# nadie puede verificar su mail ni recuperar una contraseña olvidada, así
# que mejor que la app no arranque a que arranque a medias en silencio.
#
# Cómo conseguir SMTP_PASSWORD (NO es la contraseña normal de la cuenta):
# 1. La cuenta de Gmail remitente tiene que tener verificación en dos
#    pasos activada (Cuenta de Google -> Seguridad).
# 2. Ahí mismo, "Contraseñas de aplicaciones" -> crear una nueva -> copiar
#    los 16 caracteres que da Google (sin espacios) como SMTP_PASSWORD.
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = _positive_int("SMTP_PORT", 587)
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
# Nombre visible como remitente (ej. "NovaByte <cuenta@gmail.com>").
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", APP_NAME)
if not SMTP_USER or not SMTP_PASSWORD:
    raise RuntimeError(
        "SMTP_USER y SMTP_PASSWORD deben estar configurados (cuenta de Gmail "
        "remitente y su contraseña de aplicación -- ver comentario arriba)."
    )

# Vida del código de 6 dígitos antes de que haya que pedir uno nuevo.
CODIGO_VERIFICACION_LIFETIME_MINUTES = _positive_int("CODIGO_VERIFICACION_EXPIRE_MINUTES", 15)

# BORRADO (29/08/2026, pedido del cliente): esta app ya no hace backups de
# la base de datos por sí misma -- antes acá vivían PG_DUMP_PATH,
# PG_RESTORE_PATH, BACKUP_TIMEOUT_SEGUNDOS y BACKUP_RESTORE_TIMEOUT_SEGUNDOS,
# usadas por app/router/backup.py y app/services/backup_service.py (dados
# de baja, ver comentario en app/router/__init__.py). De acá en más los
# backups quedan a cargo de (1) el propio servidor de hosting y (2) un
# script aparte que se va a armar más adelante -- si ese script necesita
# estas mismas variables, se agregan de nuevo en ese momento, con su propio
# .env si corre fuera de esta app. Si tenías PG_DUMP_PATH/PG_RESTORE_PATH/
# BACKUP_TIMEOUT_SEGUNDOS/BACKUP_RESTORE_TIMEOUT_SEGUNDOS cargadas en tu
# .env, ya no hacen nada -- las podés borrar de ahí cuando quieras, no
# hace falta para que la app funcione.
