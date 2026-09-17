"""Configuración general de la tienda -- hoy solo horarios de atención,
pero pensada como el lugar donde va a ir cualquier otro dato "de la tienda
en general" que no pertenezca a un producto/categoría/pedido puntual."""

from sqlalchemy import Column, Integer, Numeric, String, Text

from app.core.database import Base


class ConfiguracionTienda(Base):
    """Tabla singleton: siempre una sola fila (id=1). No hay múltiples
    tiendas, así que no tiene sentido modelarla como un catálogo con alta
    y baja -- el router (app/router/store.py) la crea sola la primera vez
    que hace falta, y de ahí en más solo se lee/edita esa misma fila."""

    __tablename__ = "configuracion_tienda"

    id = Column(Integer, primary_key=True)
    horarios_atencion = Column(Text, nullable=True)
    # FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- para los
    # productos que el dueño carga en dólares (Producto.moneda_carga ==
    # 'USD', ver app/models/product.py) este es el único lugar donde vive la
    # cotización que los convierte a pesos. Es un valor GLOBAL para toda la
    # tienda (no por producto) y lo carga el dueño a mano desde el panel de
    # Configuración → General (no se integra con ninguna API de cotización
    # automática) -- ver ConfiguracionGeneral.jsx en el frontend. No afecta a
    # los productos cargados en pesos (moneda_carga == 'ARS'): esos tienen un
    # precio fijo, ver el column_property Producto.precio_venta.
    #
    # nullable=False con default=1: Producto.precio_venta (ver ese modelo)
    # se calcula en la base como precio_carga * cotizacion_dolar * (1 +
    # iva_porcentaje/100), donde iva_porcentaje es una columna de CADA
    # producto (ver app/models/product.py, no vive acá), así que un NULL
    # acá dejaría el precio de TODOS los productos en dólares en NULL. El
    # default de 1 es un valor de arranque obviamente incorrecto a
    # propósito (deja los precios en dólares mostrándose como si 1 dólar
    # valiera 1 peso) -- el dueño tiene que cargar la cotización real la
    # primera vez que entra a Configuración → General.
    cotizacion_dolar = Column(Numeric(10, 2), nullable=False, default=1)


class MarcaDestacada(Base):
    """Diez posiciones fijas para las imágenes de "Marcas destacadas" que
    se muestran en el Home (FEATURE 29/08/2026, pedido del cliente) --
    franja de logos de marcas debajo del carrusel de productos nuevos, ver
    ConfiguracionGeneral.jsx (carga admin) y FilaMarcasDestacadas.jsx
    (muestra pública).

    Tabla de 10 filas FIJAS (posicion 1..10), no un catálogo de alta/baja
    libre -- pedido explícito del cliente: "debe haber exactamente 10
    posiciones y no permitir una undécima". La migración que crea esta
    tabla (ver alembic/versions) ya inserta las 10 filas con imagen_url
    NULL, y el router (_asegurar_posiciones_marcas en app/router/store.py)
    se asegura de que sigan existiendo si la base se recreó sin correr esa
    migración -- mismo criterio de autocuración que
    ConfiguracionTienda._obtener_o_crear más arriba.

    Eliminar una imagen NUNCA borra la fila, solo vacía imagen_url
    (UPDATE): así la posición conserva su número del 1 al 10 y las demás
    no se corren ni se reorganizan (otro pedido explícito del cliente).

    nombre_marca (FEATURE 30/08/2026, pedido del cliente): "al hacer clic
    en cualquiera de estas imágenes, que mande al catálogo y muestre todos
    los productos de dicha marca". Guarda el valor EXACTO de Producto.marca
    (ver app/models/product.py) que le corresponde a la imagen de esa
    posición -- no un texto libre: el filtro del catálogo hace una
    comparación exacta (Producto.marca == marca, ver list_products en
    app/router/products.py), así que el frontend elige este valor de la
    misma lista de marcas reales que ya usa el mega menú del navbar (GET
    /productos/marcas -- ver ModalCargarImagenMarca.jsx), nunca lo escribe
    a mano. Nullable: una posición puede tener imagen sin marca asignada
    todavía (fotos cargadas antes de este campo, o mientras se carga) --
    en ese caso el Home simplemente no la hace clickeable (ver
    FilaMarcasDestacadas.jsx).
    """

    __tablename__ = "marca_destacada"

    id = Column(Integer, primary_key=True)
    posicion = Column(Integer, unique=True, nullable=False)
    imagen_url = Column(String(2048), nullable=True)
    nombre_marca = Column(String(255), nullable=True)
