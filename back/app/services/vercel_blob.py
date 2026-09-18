"""Subida de imágenes a Vercel Blob (https://vercel.com/docs/vercel-blob).

FEATURE (17/09/2026, pedido del cliente -- deploy en Vercel): las funciones
serverless de Vercel tienen el filesystem de sólo lectura fuera de /tmp, y
/tmp no persiste entre invocaciones ni se comparte entre instancias -- guardar
ahí una imagen subida desde el panel admin (como hacía esta app hasta ahora,
ver STORAGE_PRODUCTOS_DIR/STORAGE_CATEGORIAS_DIR en app/core/config.py) la
perdería en cualquier momento, sin aviso. Este módulo sube el archivo al
Blob store del proyecto con el SDK oficial de Vercel para Python (paquete
"vercel", ver requirements.txt) y devuelve la URL pública resultante.

BLOB_READ_WRITE_TOKEN (ver app/core/config.py) decide el modo:
  - Si está seteada (deploy en Vercel, con un Blob store conectado al
    proyecto): sube el archivo acá, devuelve la URL absoluta que da Vercel
    Blob. subir_imagen_producto/subir_imagen_categoria (app/router/
    products.py y app/router/categories.py) la usan tal cual como
    imagen_url -- ya empieza con "https://", así que pasa sin problema el
    validador _validar_imagen_url (app/schemas/product.py) y
    resolverUrlImagen (front/src/utils/imagenes.js) del frontend, que
    devuelve tal cual cualquier URL que ya venga con esquema.
  - Si NO está seteada (desarrollo local de siempre): este módulo no se usa
    para nada -- subir_imagen_producto/subir_imagen_categoria siguen
    guardando en disco local como siempre (ver STORAGE_PRODUCTOS_DIR/
    STORAGE_CATEGORIAS_DIR), sin ningún cambio de comportamiento.
"""

import logging

from vercel.blob import AsyncBlobClient

from app.core.config import BLOB_READ_WRITE_TOKEN

logger = logging.getLogger("app.vercel_blob")


class VercelBlobError(RuntimeError):
    """No se pudo subir el archivo a Vercel Blob."""


def blob_habilitado() -> bool:
    """True si hay que subir a Vercel Blob en vez de guardar en disco local
    -- ver el comentario grande más arriba sobre cuándo es cada caso."""
    return bool(BLOB_READ_WRITE_TOKEN)


async def subir_a_blob(contenido: bytes, nombre_archivo: str, carpeta: str, content_type: str) -> str:
    """Sube contenido a "<carpeta>/<nombre_archivo>" en el Blob store del
    proyecto y devuelve la URL pública.

    nombre_archivo ya viene armado por el llamador (UUID + extensión, mismo
    criterio anti path-traversal/colisión que ya usaba el guardado en disco
    local -- ver subir_imagen_producto/subir_imagen_categoria), así que acá
    NUNCA hace falta add_random_suffix -- agregarlo además pisaría el
    nombre exacto que el llamador ya generó y espera de vuelta.
    """
    client = AsyncBlobClient()
    try:
        resultado = await client.put(
            f"{carpeta}/{nombre_archivo}",
            contenido,
            access="public",
            content_type=content_type,
            add_random_suffix=False,
            token=BLOB_READ_WRITE_TOKEN,
        )
    except Exception as error:  # cualquier error de red/API de Vercel Blob
        logger.exception("Fallo subiendo %s/%s a Vercel Blob", carpeta, nombre_archivo)
        raise VercelBlobError("No se pudo subir la imagen.") from error
    return resultado.url
