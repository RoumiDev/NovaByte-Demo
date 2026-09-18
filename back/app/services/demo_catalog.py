"""Catálogo de muestra para un tenant de demo (ver app/models/demo.py).

FEATURE (17/09/2026, pedido del cliente): "que le pueda dar una credencial
temporal ... para que pueda ver como es cargar un producto, categoría,
etc." -- back/scripts/crear_acceso_demo.py llama a sembrar_catalogo() de
acá para que un acceso temporal nuevo no arranque con el catálogo vacío
(nada que mostrar en Home/Catálogo, nada para editar de entrada en el
panel admin).

Mismos nombres/precios/descripciones que back/seed_demo.py (la base DEMO
separada que arma el propio dueño para sacar capturas promocionales, sin
tenant) -- duplicado a propósito, no importado de ahí: son dos flujos
independientes con necesidades distintas (éste sube a Vercel Blob cuando
corresponde -- ver _guardar_imagen más abajo -- y siempre pasa un
tenant_id; seed_demo.py siempre guarda en disco local y nunca usa tenant),
que no tienen por qué evolucionar pegados sólo porque hoy coinciden en el
texto de muestra.
"""

import asyncio
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from app.core.config import STORAGE_CATEGORIAS_DIR, STORAGE_PRODUCTOS_DIR
from app.models.product import Categoria, Producto
from app.services.vercel_blob import blob_habilitado, subir_a_blob

# Paleta "NovaByte" (misma que theme.scss del frontend de demo) -- para que
# las imágenes placeholder generadas acá combinen con el resto de la app.
TEAL = (13, 148, 136)
DARK = (19, 42, 46)


def _fuente(tamano: int):
    for candidata in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidata).exists():
            return ImageFont.truetype(candidata, tamano)
    return ImageFont.load_default()


def _generar_placeholder_bytes(titulo: str, subtitulo: str, color_fondo, color_texto) -> bytes:
    """Imagen placeholder simple (fondo sólido + texto centrado), como
    bytes JPEG en memoria -- a diferencia de la variante de seed_demo.py
    (que escribe directo a un archivo en disco), acá hace falta en memoria
    porque puede terminar subida a Vercel Blob en vez de a disco local (ver
    _guardar_imagen más abajo)."""
    ancho, alto = 900, 900
    img = Image.new("RGB", (ancho, alto), color_fondo)
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, ancho - 20, alto - 20], outline=color_texto, width=3)

    fuente_titulo = _fuente(64)
    fuente_subtitulo = _fuente(34)

    bbox_t = draw.textbbox((0, 0), titulo, font=fuente_titulo)
    ancho_t = bbox_t[2] - bbox_t[0]
    draw.text(((ancho - ancho_t) / 2, alto / 2 - 60), titulo, fill=color_texto, font=fuente_titulo)

    bbox_s = draw.textbbox((0, 0), subtitulo, font=fuente_subtitulo)
    ancho_s = bbox_s[2] - bbox_s[0]
    draw.text(((ancho - ancho_s) / 2, alto / 2 + 30), subtitulo, fill=color_texto, font=fuente_subtitulo)

    buffer = BytesIO()
    img.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _guardar_imagen(nombre_archivo: str, carpeta: str, contenido: bytes) -> str:
    """Devuelve la imagen_url a guardar -- sube a Vercel Blob si está
    habilitado (ver blob_habilitado en app/services/vercel_blob.py, el
    mismo criterio que ya usan subir_imagen_producto/subir_imagen_categoria
    en app/router/products.py y categories.py), si no escribe en disco
    local como hacía siempre back/seed_demo.py.

    asyncio.run() acá adentro: este módulo lo llama un script de línea de
    comandos sincrónico (back/scripts/crear_acceso_demo.py), no un endpoint
    de FastAPI -- no hay ningún event loop corriendo todavía del que haya
    que preocuparse."""
    if blob_habilitado():
        return asyncio.run(subir_a_blob(contenido, nombre_archivo, carpeta, "image/jpeg"))
    destino_dir = STORAGE_PRODUCTOS_DIR if carpeta == "productos" else STORAGE_CATEGORIAS_DIR
    destino_dir.mkdir(parents=True, exist_ok=True)
    (destino_dir / nombre_archivo).write_bytes(contenido)
    return f"/static/{carpeta}/{nombre_archivo}"


CATEGORIAS = [
    {"nombre": "Periféricos", "sub": "Mouse · Teclados"},
    {"nombre": "Audio", "sub": "Auriculares · Parlantes"},
    {"nombre": "Monitores", "sub": "Pantallas"},
    {"nombre": "Notebooks", "sub": "Portátiles"},
]

PRODUCTOS = [
    {
        "nombre": "Mouse inalámbrico NB Pro",
        "marca": "NovaByte",
        "categoria": "Periféricos",
        "descripcion": "Mouse inalámbrico liviano, sensor óptico de alta precisión y batería de larga duración. Ideal para uso diario en oficina o estudio.",
        "precio": 24999,
        "stock": 18,
        "garantia": "12 meses",
    },
    {
        "nombre": "Teclado mecánico NB Type",
        "marca": "NovaByte",
        "categoria": "Periféricos",
        "descripcion": "Teclado mecánico con retroiluminación regulable y switches de respuesta táctil suave. Distribución en español.",
        "precio": 54999,
        "stock": 12,
        "garantia": "12 meses",
    },
    {
        "nombre": "Auriculares NB Sound",
        "marca": "NovaByte",
        "categoria": "Audio",
        "descripcion": "Auriculares over-ear con cancelación de ruido pasiva y almohadillas acolchadas para uso prolongado.",
        "precio": 39999,
        "stock": 25,
        "garantia": "6 meses",
    },
    {
        "nombre": "Parlante Bluetooth NB Beat",
        "marca": "NovaByte",
        "categoria": "Audio",
        "descripcion": "Parlante portátil con conexión Bluetooth, resistente a salpicaduras y hasta 10 horas de batería.",
        "precio": 32999,
        "stock": 20,
        "garantia": "6 meses",
    },
    {
        "nombre": "Monitor NB View 24\"",
        "marca": "NovaByte",
        "categoria": "Monitores",
        "descripcion": "Monitor Full HD de 24 pulgadas, panel IPS con colores fieles y bordes ultra delgados.",
        "precio": 189999,
        "stock": 8,
        "garantia": "24 meses",
    },
    {
        "nombre": "Notebook NB Slim 14\"",
        "marca": "NovaByte",
        "categoria": "Notebooks",
        "descripcion": "Notebook liviana de 14 pulgadas, ideal para trabajo y estudio, con batería para todo el día.",
        "precio": 899999,
        "stock": 5,
        "garantia": "12 meses",
    },
]


def sembrar_catalogo(db: Session, tenant_id: int) -> None:
    """Crea las categorías y productos de muestra, todos marcados con
    tenant_id -- ver el comentario grande en Producto.tenant_id/
    Categoria.tenant_id (app/models/product.py). Pensada para llamarse una
    sola vez, justo después de crear el DemoTenant (ver
    back/scripts/crear_acceso_demo.py): un tenant nuevo siempre arranca sin
    categorías/productos propios, así que no hace falta chequear
    duplicados como sí hace back/seed_demo.py (que puede correrse más de
    una vez sobre la misma base sin tenant)."""
    categorias_por_nombre: dict[str, Categoria] = {}
    for datos in CATEGORIAS:
        nombre_archivo = f"demo_cat_{datos['nombre'].lower().replace(' ', '_')}_{tenant_id}.jpg"
        contenido = _generar_placeholder_bytes(datos["nombre"], datos["sub"], DARK, (255, 255, 255))
        imagen_url = _guardar_imagen(nombre_archivo, "categorias", contenido)
        categoria = Categoria(nombre=datos["nombre"], imagen_url=imagen_url, tenant_id=tenant_id)
        db.add(categoria)
        db.flush()
        categorias_por_nombre[datos["nombre"]] = categoria
    db.commit()

    for datos in PRODUCTOS:
        nombre_archivo = (
            f"demo_prod_{datos['nombre'].lower().replace(' ', '_').replace(chr(34), '')}_{tenant_id}.jpg"
        )
        contenido = _generar_placeholder_bytes(datos["marca"], datos["nombre"], TEAL, (255, 255, 255))
        imagen_url = _guardar_imagen(nombre_archivo, "productos", contenido)
        producto = Producto(
            nombre=datos["nombre"],
            marca=datos["marca"],
            descripcion=datos["descripcion"],
            # Modo 'directo', precio ya en ARS con IVA incluido -- mismo
            # criterio que back/seed_demo.py: nada de costo/IVA/utilidad
            # cargado en modo 'costo_utilidad' para el catálogo de muestra.
            modo_precio="directo",
            moneda_carga="ARS",
            precio_carga=datos["precio"],
            iva_porcentaje=21,
            coeficiente=1,
            stock=datos["stock"],
            stock_minimo=3,
            garantia=datos["garantia"],
            imagen_url=imagen_url,
            is_active=True,
            categoria_id=categorias_por_nombre[datos["categoria"]].id,
            reabastecido_at=datetime.now(timezone.utc),
            tenant_id=tenant_id,
        )
        db.add(producto)
    db.commit()
