# SIN USO (29/08/2026, pedido del cliente): el backup/restauración manual
# desde la app se dio de baja -- este router ya NO está registrado en
# app/router/__init__.py, así que estos endpoints no existen más en la API.
# De acá en más los dos backups vigentes son el del servidor de hosting y,
# más adelante, un script aparte. Se deja este archivo en vez de borrarlo
# porque esta sesión no tiene forma de eliminar archivos de tu computadora
# -- lo podés borrar vos a mano (app/router/backup.py) si querés, junto con
# app/services/backup_service.py.
"""Backup y restauración de la base de datos -- solo administradores.

Descargar: genera un backup "completo" -- un .zip con el dump binario
(formato "custom" de pg_dump, firmado con HMAC) de la base MÁS una copia de
las imágenes actuales de productos/categorías -- y lo devuelve directo
desde el panel admin, sin guardar ninguna copia en el servidor (ver
generar_backup_completo en backup_service.py).

Restaurar: sube ese mismo .zip y lo aplica contra la base y contra
storage/productos+categorias, REEMPLAZANDO su contenido actual. Es la
operación más destructiva de todo este proyecto -- ver las advertencias en
restaurar_backup_completo (app/services/backup_service.py) y en el
frontend (ConfiguracionBackup.jsx) antes de tocar nada acá.

FIX V-01/V-03/V-03b (auditoría AppSec, 28/08/2026): ver el docstring de
app/services/backup_service.py para el detalle de por qué cambió el
formato del backup y cómo se firma. Los cambios propios de este archivo:

- V-03: descargar ahora exige la contraseña del admin (antes alcanzaba con
  el access token, igual que para editar una categoría -- pero acá el
  "dato" es la base entera) y deja registro de auditoría de quién
  descargó, cuándo y desde qué IP (antes solo se registraba la
  restauración).
- V-03 / V-07 (parcial): las dos operaciones tienen un rate limit estricto
  y propio (2 por hora cada una, ver backup_descarga_rate_limiter /
  backup_restaurar_rate_limiter en core/rate_limit.py) -- antes no tenían
  ninguno.
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core.rate_limit import backup_descarga_rate_limiter, backup_restaurar_rate_limiter
from app.dependencies.auth import require_admin, verificar_password_admin
from app.models.user import Usuario
from app.services.backup_service import BackupError, generar_backup_completo, restaurar_backup_completo

router = APIRouter()
logger = logging.getLogger(__name__)

# Frase que hay que escribir literal (mayúsculas incluidas) para confirmar
# una restauración -- mismo criterio que GitHub/otros paneles admin al
# borrar algo irreversible: un simple "¿estás seguro? sí/no" es demasiado
# fácil de apretar sin pensar en una operación de este calibre.
_FRASE_CONFIRMACION = "RESTAURAR"

# 500 MB: desde que el backup incluye las imágenes de productos/categorías
# (ver comentario "BACKUP COMPLETO" en backup_service.py), el archivo ya no
# es solo un dump de pocos MB -- un catálogo con muchas fotos en buena
# resolución puede sumar bastante. Sigue siendo un tope finito (no "sin
# límite") para no convertir el endpoint en un vector de denegación de
# servicio con una subida gigante.
_MAX_BACKUP_BYTES = 500 * 1024 * 1024


def _ip_del_cliente(request: Request) -> str:
    return request.client.host if request.client else "desconocida"


@router.post("/descargar")
def descargar_backup(
    request: Request,
    password_actual: str = Form(...),
    admin_actual: Usuario = Depends(require_admin),
    _rate_limit: None = Depends(backup_descarga_rate_limiter),
) -> FileResponse:
    """Correr pg_dump contra la base configurada, empaquetarlo junto con
    las imágenes actuales de productos/categorías, y devolver el .zip
    resultante como descarga (ver generar_backup_completo en
    backup_service.py).

    FIX V-03 (auditoría AppSec, 28/08/2026 -- "GET /backup/descargar
    exfiltra toda la base con solo un access token de admin"): antes este
    endpoint no exigía nada más que estar logueado como admin -- un access
    token robado (XSS, sesión abierta, token filtrado en un log) alcanzaba
    para un solo GET y llevarse la base entera (hashes de contraseña,
    datos personales de clientes, todo). Ahora exige la misma
    confirmación de contraseña que ya se pedía para editar una categoría
    -- acá con más razón, dado el impacto -- y queda registrada en el log
    (ver logger.warning más abajo), cosa que antes solo pasaba con la
    restauración.
    """
    verificar_password_admin(password_actual, admin_actual)

    try:
        archivo, nombre_descarga = generar_backup_completo()
    except BackupError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))
    except Exception:
        logger.exception("Error inesperado generando un backup de la base de datos.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo generar el backup de la base de datos.",
        )

    # warning (no info): descargar la base entera es un evento raro y de
    # alto impacto -- vale la pena que quede visible en los logs sin tener
    # que subir el nivel a DEBUG para encontrarlo. Mismo criterio que ya
    # tenía la restauración, acá aplicado también a la descarga (antes no
    # dejaba ningún rastro -- ver FIX V-03 arriba).
    logger.warning(
        "Backup completo de la base descargado por un administrador (id=%s, ip=%s).",
        admin_actual.id,
        _ip_del_cliente(request),
    )

    # BackgroundTask corre DESPUÉS de que la respuesta ya se mandó entera al
    # cliente -- borrar el archivo temporal antes rompería la descarga a
    # mitad de camino. missing_ok=True: si por lo que sea ya no está, no
    # hace falta que esto tire un error, el objetivo (que no quede la copia)
    # ya se cumple.
    return FileResponse(
        path=archivo,
        filename=nombre_descarga,
        media_type="application/zip",
        background=BackgroundTask(lambda: archivo.unlink(missing_ok=True)),
    )


@router.post("/restaurar")
def subir_backup(
    request: Request,
    confirmacion: str = Form(...),
    password_actual: str = Form(...),
    archivo: UploadFile = File(...),
    admin_actual: Usuario = Depends(require_admin),
    _rate_limit: None = Depends(backup_restaurar_rate_limiter),
) -> dict:
    """Restaurar la base de datos y las imágenes de productos/categorías a
    partir del backup completo (.zip) subido acá.

    REEMPLAZA el contenido actual -- no es una fusión ni un "agregar
    datos", es dejar todo como estaba en el momento en que se generó ese
    backup. No hay forma de deshacer esto salvo restaurando un backup más
    nuevo.

    Para confirmar, hay que escribir exactamente "RESTAURAR" Y la
    contraseña del admin logueado -- doble confirmación a propósito, ver
    verificar_password_admin en app/dependencies/auth.py: ninguna otra
    acción del panel admin es tan destructiva como esta, así que acá se
    exigen las dos cosas en vez de solo una.

    FIX V-01 (auditoría AppSec, 28/08/2026 -- "ejecución de comandos vía
    restauración de backup"): SOLO se acepta el .zip firmado que genera
    "Descargar backup" -- ya no se acepta un .sql suelto. Un .sql
    restaurado con "psql -f" era exactamente el vector de la
    vulnerabilidad (psql interpreta metacomandos de shell dentro del
    archivo); mantener esa vía "por compatibilidad" habría dejado el
    agujero abierto para cualquiera que todavía tuviera un backup viejo.
    Es un cambio incompatible a propósito -- ver backup_service.py para el
    resto del rediseño (formato binario + firma HMAC).

    FIX B-02 (auditoría QA+Seguridad, 28/08/2026, "la restauración queda
    cargando"): esta función es "def" (no "async def") porque hace trabajo
    bloqueante de punta a punta (restaurar_backup_completo corre
    pg_restore con subprocess.run, hasta BACKUP_RESTORE_TIMEOUT_SEGUNDOS).
    Un "async def" que bloquea así congela el event loop de uvicorn
    ENTERO mientras corre -- ninguna otra request de la API (ni siquiera
    /health) respondía mientras tanto, así que la app entera se sentía
    "colgada", no solo esta pantalla. Con "def", FastAPI corre esta
    función en su threadpool en vez de en el event loop -- el resto de la
    API sigue respondiendo normalmente mientras la restauración (que
    puede tardar) sigue en curso. Ver también el manejo de "lock timeout"
    en backup_service.py para la otra mitad del problema: por qué la
    restauración podía tardar varios minutos en primer lugar.
    """
    if confirmacion != _FRASE_CONFIRMACION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Para confirmar, escribí exactamente "{_FRASE_CONFIRMACION}".',
        )
    verificar_password_admin(password_actual, admin_actual)

    if not archivo.filename or not archivo.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo tiene que ser el .zip que genera esta app en \"Descargar backup\".",
        )

    contenido = archivo.file.read()
    if not contenido:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo está vacío.")
    if len(contenido) > _MAX_BACKUP_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo no puede superar los {_MAX_BACKUP_BYTES // (1024 * 1024)} MB.",
        )

    try:
        restaurar_backup_completo(contenido)
    except BackupError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))
    except Exception:
        logger.exception("Error inesperado restaurando un backup de la base de datos.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo restaurar el backup de la base de datos.",
        )

    # warning (no info): esto es un evento raro y de alto impacto -- vale la
    # pena que quede visible en los logs sin tener que subir el nivel a
    # DEBUG para encontrarlo.
    logger.warning(
        "Base de datos restaurada desde un backup subido por un administrador (id=%s, ip=%s).",
        admin_actual.id,
        _ip_del_cliente(request),
    )
    return {
        "detail": (
            "Backup restaurado. Conviene cerrar sesión y volver a entrar (los datos de la sesión "
            "actual pueden no coincidir más con lo que quedó en la base)."
        )
    }
