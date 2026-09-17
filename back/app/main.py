"""Punto de entrada de la aplicación: arma la app FastAPI, middlewares,
manejo de errores, y registra los routers bajo /api/v1."""

import logging
import mimetypes
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from app.core.config import (
    ALLOWED_ORIGINS,
    APP_NAME,
    DEBUG,
    FRONTEND_DIST_DIR,
    STORAGE_CATEGORIAS_DIR,
    STORAGE_PRODUCTOS_DIR,
)
from app.jobs.reconciliacion_pagos import procesar_pedidos_pendientes
from app.router import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

# Cada cuántos minutos corre el procesamiento automático de pedidos
# "pendiente" (ver app/jobs/reconciliacion_pagos.py): confirma los que se
# pagaron y cancela -- reponiendo stock -- los abandonados. 1 minuto porque
# el corte de abandono es de solo 5 minutos (ver _MINUTOS_ABANDONO ahí) --
# con un intervalo más largo, la cancelación por abandono sería imprecisa.
_MINUTOS_ENTRE_CORRIDAS = 1


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Arranca/apaga el scheduler de procesamiento de pedidos junto con la app.

    BackgroundScheduler corre en un hilo aparte -- no bloquea el event loop
    de FastAPI mientras habla con la API de Mercado Pago (esa llamada es
    sincrónica). Con --reload de uvicorn, cada recarga reinicia este
    lifespan limpio, así que no queda ningún scheduler duplicado corriendo.
    """
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        procesar_pedidos_pendientes,
        "interval",
        minutes=_MINUTOS_ENTRE_CORRIDAS,
        id="procesar_pedidos_pendientes",
        # Si una corrida todavía sigue corriendo (backlog grande) cuando
        # tocaría la siguiente, no la superpone -- simplemente la saltea.
        max_instances=1,
    )
    scheduler.start()
    logger.info(
        "Procesamiento automatico de pedidos pendientes iniciado (cada %s minuto(s)).",
        _MINUTOS_ENTRE_CORRIDAS,
    )
    yield
    scheduler.shutdown(wait=False)


# Nombres de campos que nunca deben viajar en texto plano dentro de un
# cuerpo de respuesta, ni siquiera en un error de validación (ver
# validation_exception_handler más abajo, hallazgo R-01 del informe de
# auditoría: FastAPI devuelve por defecto el valor recibido en "input").
_SENSITIVE_FIELD_NAMES = {"password", "password_actual", "password_nueva"}

# El esquema de la base de datos ahora lo maneja Alembic (alembic upgrade
# head), no esta app. Antes acá había un Base.metadata.create_all(bind=
# engine) -- eso crea tablas que falten pero NUNCA migra columnas ni tipos
# en tablas ya existentes, y con Alembic ya configurado, tenerlo corriendo
# en cada arranque solo generaba confusión sobre cuál de los dos maneja el
# esquema de verdad. El esquema real ahora se controla explícitamente con
# `alembic upgrade head` como parte del despliegue, nunca implícitamente al
# levantar la app.

# Con DEBUG=False (el valor esperado en producción) se ocultan /docs, /redoc
# y /openapi.json: no quedan expuestos públicamente por defecto.
app = FastAPI(
    title=APP_NAME,
    version="1.0.0",
    docs_url="/docs" if DEBUG else None,
    redoc_url="/redoc" if DEBUG else None,
    openapi_url="/openapi.json" if DEBUG else None,
    lifespan=lifespan,
)

# IMPORTANTE: nunca combinar allow_origins=["*"] con allow_credentials=True.
# Starlette, ante ese combo, refleja el header Origin de cada request en vez
# de mandar un wildcard real — en la práctica cualquier sitio puede hacer
# requests autenticadas (con cookies/credenciales) contra esta API. Los
# orígenes permitidos ahora salen de ALLOWED_ORIGINS (.env), explícitos.
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    logger.warning(
        "ALLOWED_ORIGINS está vacío: no se agregó CORSMiddleware. Ningún "
        "origen va a poder llamar a esta API desde un navegador hasta que "
        "se configure esa variable en el .env."
    )


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Cabeceras de seguridad básicas en toda respuesta.

    No incluye Strict-Transport-Security a propósito: HSTS le indica al
    navegador forzar HTTPS para el dominio, algo que solo tiene sentido si
    TLS ya está garantizado (típicamente terminado en el load balancer/reverse
    proxy de producción, no acá). Configurarlo ahí, no en la app.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Igual al manejador de validación por defecto de FastAPI, pero redacta
    el valor de entrada de campos sensibles (contraseñas) antes de
    devolverlo: por defecto, un 422 de Pydantic incluye el valor exacto que
    mandó el cliente en cada error bajo la clave "input" -- si ese campo es
    una contraseña, quedaría en texto plano en el cuerpo de la respuesta
    (hallazgo R-01 del informe de auditoría)."""
    errors = jsonable_encoder(exc.errors())
    for error in errors:
        loc = error.get("loc", [])
        if any(str(part) in _SENSITIVE_FIELD_NAMES for part in loc) and "input" in error:
            error["input"] = "[REDACTED]"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": errors},
    )


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """Red de contención: los endpoints ya deberían atrapar sus propios
    conflictos de integridad (ver router/users.py, categories.py,
    products.py) y devolver un 409 con un mensaje específico. Esto cubre
    cualquier caso que se haya escapado, para no filtrar un 500 con SQL crudo."""
    logger.exception("IntegrityError no manejado en %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "La operación viola una restricción de integridad de datos."},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Cualquier error no previsto: nunca devolver el traceback al cliente,
    solo loguearlo server-side. No depende de DEBUG a propósito: no
    queremos que un DEBUG=True mal configurado en producción filtre
    información interna en la respuesta HTTP."""
    logger.exception("Error no manejado en %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Ocurrió un error interno. Ya quedó registrado para su revisión."},
    )


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Sin autenticación: pensado para checks de infraestructura (load balancer, etc.)."""
    return {"status": "ok", "app": APP_NAME}


app.include_router(api_router, prefix="/api/v1")

# FIX (08/09/2026): StaticFiles adivina el Content-Type de cada imagen por
# su extensión, usando la tabla de tipos MIME del sistema operativo (módulo
# mimetypes de Python). En esta instalación mínima de AlmaLinux esa tabla no
# tiene registrado ".webp" -- se servía como "application/octet-stream", y
# con X-Content-Type-Options: nosniff (ver SecurityHeadersMiddleware/config
# más abajo) el navegador se niega a mostrarlo como imagen (ícono roto en
# vez de la foto). .jpg/.png sí estaban en la tabla del sistema y andaban
# bien. Se registra a mano para no depender de qué tenga instalado el SO.
mimetypes.add_type("image/webp", ".webp")

# Sirve las imágenes de productos subidas desde el panel admin (ver
# POST /api/v1/productos/imagenes). Montado fuera de /api/v1 a propósito:
# no es un endpoint de la API, es contenido estático plano.
app.mount("/static/productos", StaticFiles(directory=STORAGE_PRODUCTOS_DIR), name="productos-imagenes")

# Mismo criterio, para las imágenes de categoría (ver POST
# /api/v1/categorias/imagenes) -- la tarjeta con foto por categoría del
# menú de "Catálogo".
app.mount("/static/categorias", StaticFiles(directory=STORAGE_CATEGORIAS_DIR), name="categorias-imagenes")

# Servir el build del frontend (npm run build en LTI_frontend) DESDE ESTA
# MISMA API cuando la carpeta existe -- pensado para demos temporales
# expuestas con un solo túnel (ver FRONTEND_DIST_DIR en app/core/config.py),
# NO para el despliegue real (ahí el frontend va aparte). Si no se corrió el
# build, esta app sigue funcionando igual, solo como API pura.
if FRONTEND_DIST_DIR.is_dir():
    _frontend_dist_resuelto = FRONTEND_DIST_DIR.resolve()

    # Registrada AL FINAL a propósito: el path converter "{full_path:path}"
    # matchea literalmente cualquier ruta, pero FastAPI evalúa las rutas en
    # el orden en que se registraron, así que todo lo definido más arriba
    # (/api/v1/..., /static/productos, /docs, /health) sigue ganando siempre
    # -- esta ruta es el fallback para lo que quede, típicamente rutas de
    # React Router (/login, /admin/productos, etc.) que no son archivos.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def servir_frontend(full_path: str) -> FileResponse:
        """Devolver el archivo del build que matchea la URL pedida, o
        index.html si no hay ninguno (así React Router resuelve la ruta del
        lado del cliente, incluso en una recarga de página o un link directo
        -- ej. las redirecciones de Mercado Pago a /pago/exito)."""
        candidato = (_frontend_dist_resuelto / full_path).resolve()
        # is_relative_to evita servir archivos fuera de dist/ ante un
        # full_path con "..": sin este chequeo, un path traversal armado a
        # mano podría llegar a leer cualquier archivo del filesystem del
        # servidor que el proceso de la API tenga permiso de leer.
        if (
            full_path
            and candidato.is_file()
            and candidato.is_relative_to(_frontend_dist_resuelto)
        ):
            return FileResponse(candidato)
        return FileResponse(_frontend_dist_resuelto / "index.html")
else:
    logger.info(
        "FRONTEND_DIST_DIR no existe (%s): esta API no está sirviendo el "
        "frontend, solo funciona como API. Correr `npm run build` en "
        "LTI_frontend si se necesita servir todo desde acá (ver guía de "
        "despliegue temporal con túnel).",
        FRONTEND_DIST_DIR,
    )