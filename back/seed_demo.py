"""Script de UNA SOLA VEZ para poblar la base de datos DEMO (novabyte_demo)
con datos de muestra genéricos, pensados solo para sacar capturas de
pantalla promocionales de una copia aislada de la app -- no toca la base
real ni el servidor de producción.

Carga:
- Categorías genéricas con una imagen placeholder generada localmente
  (nada de fotos/logos reales).
- Productos en modo_precio='directo' únicamente (nunca 'costo_utilidad' --
  pedido explícito: no mostrar nada de costo/IVA/utilidad en las capturas).
- ConfiguracionTienda (cotización dólar) para que la app no rompa si algo
  la consulta.
- Un usuario 'cliente' demo con email ya verificado, para poder loguearse
  y sacar la captura de Catálogo/Carrito (rutas protegidas).

Cómo correrlo (con el venv activado, desde back/, contra la base
DEMO ya migrada con alembic upgrade head):
    python seed_demo.py
"""

from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.auth.security import get_password_hash
from app.core.config import STORAGE_CATEGORIAS_DIR, STORAGE_PRODUCTOS_DIR
from app.core.database import SessionLocal
from app.models.product import Categoria, Producto
from app.models.store import ConfiguracionTienda
from app.models.user import TipoDocumento, Usuario, condicionIVA

# -----------------------------------------------------------------------
# Paleta "NovaByte" (misma que theme.scss del frontend de demo) -- para
# que las imágenes placeholder generadas acá combinen con el resto de la
# captura en vez de desentonar.
# -----------------------------------------------------------------------
TEAL = (13, 148, 136)
DARK = (19, 42, 46)
LIGHT = (245, 246, 248)


def _fuente(tamano):
    for candidata in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidata).exists():
            return ImageFont.truetype(candidata, tamano)
    return ImageFont.load_default()


def _generar_placeholder(destino: Path, titulo: str, subtitulo: str, color_fondo, color_texto):
    """Imagen placeholder simple (fondo sólido + texto centrado) -- nada de
    fotos reales, solo para que el catálogo de demo no se vea con recuadros
    vacíos en las capturas."""
    ancho, alto = 900, 900
    img = Image.new("RGB", (ancho, alto), color_fondo)
    draw = ImageDraw.Draw(img)

    # Marco sutil, mismo espíritu que .producto-card del tema (borde tenue).
    draw.rectangle([20, 20, ancho - 20, alto - 20], outline=color_texto, width=3)

    fuente_titulo = _fuente(64)
    fuente_subtitulo = _fuente(34)

    bbox_t = draw.textbbox((0, 0), titulo, font=fuente_titulo)
    ancho_t = bbox_t[2] - bbox_t[0]
    draw.text(((ancho - ancho_t) / 2, alto / 2 - 60), titulo, fill=color_texto, font=fuente_titulo)

    bbox_s = draw.textbbox((0, 0), subtitulo, font=fuente_subtitulo)
    ancho_s = bbox_s[2] - bbox_s[0]
    draw.text(((ancho - ancho_s) / 2, alto / 2 + 30), subtitulo, fill=color_texto, font=fuente_subtitulo)

    destino.parent.mkdir(parents=True, exist_ok=True)
    img.save(destino, format="JPEG", quality=90)


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


def main():
    db = SessionLocal()
    try:
        # --- ConfiguracionTienda (singleton) --------------------------------
        config = db.query(ConfiguracionTienda).filter(ConfiguracionTienda.id == 1).first()
        if not config:
            config = ConfiguracionTienda(id=1, cotizacion_dolar=1450)
            db.add(config)
        else:
            config.cotizacion_dolar = 1450
        db.commit()

        # --- Categorías ------------------------------------------------------
        categorias_por_nombre = {}
        for datos in CATEGORIAS:
            existente = db.query(Categoria).filter(Categoria.nombre == datos["nombre"]).first()
            if existente:
                categorias_por_nombre[datos["nombre"]] = existente
                continue
            nombre_archivo = f"demo_cat_{datos['nombre'].lower().replace(' ', '_')}.jpg"
            ruta = STORAGE_CATEGORIAS_DIR / nombre_archivo
            _generar_placeholder(ruta, datos["nombre"], datos["sub"], DARK, (255, 255, 255))
            categoria = Categoria(nombre=datos["nombre"], imagen_url=f"/static/categorias/{nombre_archivo}")
            db.add(categoria)
            db.flush()
            categorias_por_nombre[datos["nombre"]] = categoria
        db.commit()

        # --- Productos (SOLO modo_precio='directo', moneda_carga='ARS') -----
        for datos in PRODUCTOS:
            existente = db.query(Producto).filter(Producto.nombre == datos["nombre"]).first()
            if existente:
                continue
            nombre_archivo = f"demo_prod_{datos['nombre'].lower().replace(' ', '_').replace(chr(34), '')}.jpg"
            ruta = STORAGE_PRODUCTOS_DIR / nombre_archivo
            _generar_placeholder(ruta, datos["marca"], datos["nombre"], TEAL, (255, 255, 255))

            producto = Producto(
                nombre=datos["nombre"],
                marca=datos["marca"],
                descripcion=datos["descripcion"],
                # Modo 'directo', precio ya en ARS con IVA incluido -- nunca
                # 'costo_utilidad' en la demo (pedido explícito del cliente:
                # nada de costo/IVA/utilidad en las capturas).
                modo_precio="directo",
                moneda_carga="ARS",
                precio_carga=datos["precio"],
                iva_porcentaje=21,
                coeficiente=1,
                stock=datos["stock"],
                stock_minimo=3,
                garantia=datos["garantia"],
                imagen_url=f"/static/productos/{nombre_archivo}",
                is_active=True,
                categoria_id=categorias_por_nombre[datos["categoria"]].id,
                reabastecido_at=datetime.now(timezone.utc),
            )
            db.add(producto)
        db.commit()

        # --- Usuario cliente demo (para loguearse y ver Catálogo/Carrito) ---
        email_demo = "demo@novabyte.local"
        usuario = db.query(Usuario).filter(Usuario.email == email_demo).first()
        if not usuario:
            usuario = Usuario(
                email=email_demo,
                razon_social="Cliente Demo",
                password_hash=get_password_hash("DemoNovaByte2026!"),
                tipo_documento=TipoDocumento.dni,
                numero_documento="30111222",
                condicion_iva=condicionIVA.consumidor_final,
                telefono="1122334455",
                direccion="Av. Siempre Viva 123",
                ciudad="Ciudad Autónoma de Buenos Aires",
                provincia=None,
                codigo_postal="1000",
                is_active=True,
                role="admin",
                email_verificado=True,
                debe_cambiar_password=False,
            )
            db.add(usuario)
            db.commit()

        print("Seed de demo OK.")
        print(f"  Categorías: {db.query(Categoria).count()}")
        print(f"  Productos:  {db.query(Producto).count()}")
        print(f"  Usuario demo: {email_demo} / DemoNovaByte2026!")
    finally:
        db.close()


if __name__ == "__main__":
    main()
