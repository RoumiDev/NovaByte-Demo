from sqlalchemy import CheckConstraint, Column, Integer, String, Numeric, ForeignKey, DateTime, Boolean, UniqueConstraint, func, select, case, cast, null
from sqlalchemy.orm import column_property, relationship
from app.core.database import Base
# FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- ver el
# comentario grande en el Column de precio_venta más abajo. ConfiguracionTienda
# no importa nada de este archivo, así que importarla acá no genera un
# import circular (confirmado también por el orden de app/models/__init__.py,
# que importa product.py antes que store.py).
from app.models.store import ConfiguracionTienda

# FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- subconsulta
# escalar reutilizada por Producto.precio_venta (ver el column_property más
# abajo) para leer la cotización vigente desde la fila singleton de
# ConfiguracionTienda (id=1). A nivel de MÓDULO a propósito, no como
# atributo de clase de Producto: SQLAlchemy trata cualquier expresión
# asignada directo en el cuerpo de una clase declarativa como un posible
# atributo mapeado, y tira un warning (SAWarning) en cada arranque porque
# esto no está envuelto en column_property() -- acá afuera es una simple
# constante de Python, sin ninguna ambigüedad para el mapper.
#
# El IVA, a diferencia de la cotización, NO sale de acá -- el dueño aclaró
# que el IVA varía por producto (21% general, 10,5% reducido en algunos
# casos), así que es una columna de Producto (iva_porcentaje, más abajo),
# no un valor global de ConfiguracionTienda.
_COTIZACION_DOLAR_VIGENTE = (
    select(ConfiguracionTienda.cotizacion_dolar).where(ConfiguracionTienda.id == 1).scalar_subquery()
)

# FEATURE (11/09/2026, pedido del cliente): "modo_precio" == 'costo_utilidad'
# -- segunda forma de cargar el precio de un producto, alternativa a la de
# arriba (moneda_carga/precio_carga, ahora llamada 'directo'). Se eligen por
# producto (ver Producto.modo_precio más abajo), conviven las dos: unos
# productos siguen con precio directo en ARS/USD como hasta ahora, otros usan
# esta cadena costo -> costo neto -> utilidad -> precio de venta.
#
# Estas cinco funciones (a nivel de MÓDULO, no de clase -- mismo motivo que
# _COTIZACION_DOLAR_VIGENTE arriba: son simples fábricas de expresiones SQL,
# no atributos mapeados) arman la cadena completa, un paso por función,
# encadenando cada una a la anterior. Se llaman desde ADENTRO del cuerpo de
# la clase Producto (ver los column_property más abajo), pasándoles los
# Column de esa clase por nombre de variable local (costo, coeficiente,
# etc.) -- válido porque Python ejecuta el cuerpo de una clase como un bloque
# secuencial normal, así que esos nombres ya apuntan a los Column reales en
# el momento en que se llaman (mismo principio que ya usa precio_venta más
# abajo, que referencia moneda_carga/precio_carga/iva_porcentaje como
# nombres sueltos definidos antes en el mismo cuerpo de clase).
#
# Se recalcula cada paso desde cero en cada función (en vez de encadenar los
# column_property ya definidos unos con otros) a propósito: un
# column_property recién queda instrumentado como atributo de clase
# utilizable en expresiones DESPUÉS de que el mapper terminó de configurarse
# -- intentar usarlo dentro del mismo cuerpo de clase, antes de eso, no
# funciona. Repetir la subexpresión en SQL es barato (aritmética simple) y
# evita ese problema de orden por completo.
#
# Redondeo a 2 decimales en CADA paso monetario (a diferencia de
# precio_venta en modo 'directo', que a pedido del cliente NO redondea) --
# el cliente pidió expresamente esta vez que cada campo en pantalla sea "el
# número real", no un valor con más decimales de los que tiene sentido para
# pesos. func.round(x, 2) es la función ROUND de Postgres.
def _costo_por_unidad_venta(costo, coeficiente):
    """Costo ya convertido a costo por UNIDAD DE VENTA -- ver
    Producto.coeficiente más abajo: si se compra por docena y se vende por
    unidad, coeficiente=12 y esto divide el costo cargado (de la docena)
    por 12. Sin redondear todavía: es un paso intermedio, no un campo que
    se muestre en pantalla por sí solo."""
    return costo / coeficiente


def _costo_neto_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje):
    """Costo neto (sin IVA), redondeado a 2 decimales -- primer campo que
    se muestra en pantalla de toda la cadena. Si costo_incluye_iva es
    True, el costo cargado ya trae el IVA adentro y hay que quitarlo
    (dividir por 1 + iva/100); si es False, el costo cargado YA es neto,
    se usa tal cual."""
    costo_unidad = _costo_por_unidad_venta(costo, coeficiente)
    return func.round(
        case(
            (costo_incluye_iva.is_(True), costo_unidad / (1 + iva_porcentaje / 100)),
            else_=costo_unidad,
        ),
        2,
    )


def _utilidad_importe_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje):
    """Utilidad en pesos (no en %) -- IMPORTANTE (pedido explícito del
    cliente): se calcula sobre el costo neto SIN IVA, nunca sobre un
    importe que ya contiene IVA. El IVA no es utilidad."""
    costo_neto = _costo_neto_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje)
    return func.round(costo_neto * utilidad_porcentaje / 100, 2)


def _precio_venta_sin_iva_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje):
    """Costo neto + utilidad -- el precio de venta ANTES de sumarle el IVA
    de nuevo."""
    costo_neto = _costo_neto_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje)
    utilidad = _utilidad_importe_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje)
    return costo_neto + utilidad


def _iva_monto_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje):
    """Importe (en pesos) del IVA que se le agrega al precio de venta sin
    IVA -- último paso antes del precio final."""
    precio_sin_iva = _precio_venta_sin_iva_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje)
    return func.round(precio_sin_iva * iva_porcentaje / 100, 2)


def _precio_final_costo_utilidad_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje):
    """Precio final con IVA -- lo que efectivamente paga el cliente. Este
    es el valor que termina en Producto.precio_venta (más abajo) cuando
    modo_precio == 'costo_utilidad', el mismo campo que en modo 'directo'
    devuelve el precio final de esa otra cuenta -- un solo campo,
    precio_venta, sirve como "el precio final" sea cual sea el modo de
    este producto puntual."""
    precio_sin_iva = _precio_venta_sin_iva_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje)
    iva_monto = _iva_monto_expr(costo, coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje)
    return precio_sin_iva + iva_monto


# FEATURE (13/09/2026, pedido del cliente): "agregar la función de poder
# ingresar tanto en pesos ARS como en USD [en 'Costo'], y que después el
# sistema haga la cuenta para que al cliente le figure en pesos
# argentinos" -- hasta esta fecha "costo" (más abajo, Column de Producto)
# siempre se entendía cargado en pesos. Esta función convierte el costo
# crudo a pesos ANTES de entrar a la cadena de cálculo de más arriba
# (_costo_neto_expr y siguientes) -- mismo criterio que ya usa
# precio_venta en modo 'directo' para moneda_carga == 'USD' (ver ese
# column_property más abajo: ahí también se multiplica por
# _COTIZACION_DOLAR_VIGENTE ANTES de aplicar el resto de la cuenta). A
# partir de esta fecha moneda_carga (Column de más abajo) deja de ser
# exclusiva del modo 'directo' -- la usan los dos modos, ver su
# comentario actualizado en esa misma fecha.
def _costo_en_ars_expr(costo, moneda_carga):
    """costo tal cual si moneda_carga == 'ARS' (ya está en pesos); costo x
    cotización vigente si moneda_carga == 'USD'. Se llama UNA sola vez, al
    principio de la cadena -- todos los pasos de más arriba
    (_costo_neto_expr en adelante) siguen recibiendo y devolviendo pesos,
    sin ningún cambio en su lógica."""
    return case(
        (moneda_carga == "ARS", costo),
        else_=costo * _COTIZACION_DOLAR_VIGENTE,
    )


# Tipo de columna que usan los cuatro column_property de más abajo
# (costo_neto/utilidad_importe/precio_venta_sin_iva/iva_monto) para la rama
# "no corresponde" (modo_precio == 'directo') de su CASE -- Postgres exige
# que las dos ramas de un CASE tengan un tipo compatible, así que la rama
# NULL necesita este cast explícito en vez de un None suelto.
_TIPO_MONTO_COSTO_UTILIDAD = Numeric(14, 2)


class Categoria(Base):
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, unique=True, index=True, nullable=False) # Ej: "Teclados", "Monitores"
    # Reemplaza a "descripcion" (se sacó, no se usaba en ninguna pantalla):
    # la foto de la categoría para la tarjeta con imagen del menú de
    # "Catálogo" (ver POST /categorias/imagenes en router/categories.py,
    # mismo patrón que Producto.imagen_url).
    imagen_url = Column(String, nullable=True)

    productos = relationship("Producto", back_populates="categoria")


class Producto(Base):
    __tablename__ = "productos"
    # Estas reglas se ejecutan en la base de datos, incluso si una API omite validarlas.
    __table_args__ = (
        CheckConstraint("stock >= 0", name="ck_productos_stock_non_negative"),
        CheckConstraint("stock_minimo >= 0", name="ck_productos_stock_minimo_non_negative"),
        CheckConstraint(
            "precio_carga >= 0",
            name="ck_productos_precio_carga_non_negative",
        ),
        # FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
        # cargar" -- restringe moneda_carga a los dos valores que entiende el
        # cálculo de precio_venta más abajo. String + CheckConstraint en vez
        # de un ENUM nativo de Postgres a propósito -- mismo criterio que
        # Usuario.role (ver migración b3f6a2d9c751): más simple de migrar
        # (agregar/renombrar un valor es solo tocar el CheckConstraint, no
        # un ALTER TYPE) para un campo que se agrega después del diseño
        # original, no en la creación de la tabla.
        CheckConstraint(
            "moneda_carga IN ('ARS', 'USD')",
            name="ck_productos_moneda_carga_valida",
        ),
        # FEATURE (09/09/2026, pedido del cliente): "el IVA varía por
        # producto" -- 0 a 100, mismo tope de sanidad que valida el schema
        # (ver ProductoBase.iva_porcentaje en app/schemas/product.py).
        CheckConstraint(
            "iva_porcentaje >= 0 AND iva_porcentaje <= 100",
            name="ck_productos_iva_porcentaje_valido",
        ),
        # FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
        # coeficiente" -- segunda forma de cargar el precio de un producto,
        # alternativa a moneda_carga/precio_carga (ahora "modo_precio ==
        # 'directo'") -- ver el comentario grande arriba de las funciones
        # _costo_neto_expr y compañía, y el de precio_venta más abajo.
        CheckConstraint(
            "modo_precio IN ('directo', 'costo_utilidad')",
            name="ck_productos_modo_precio_valido",
        ),
        CheckConstraint("costo IS NULL OR costo >= 0", name="ck_productos_costo_non_negative"),
        # Tope de sanidad, no una regla de negocio estricta -- mismo
        # criterio que iva_porcentaje <= 100 arriba: sirve para atajar un
        # error de tipeo (ej. "200" en vez de "20" en el % de utilidad), no
        # para prohibir un margen real fuera de este rango. >= -100 es un
        # límite real, en cambio: con -100% de utilidad el precio de venta
        # sin IVA daría 0, y por debajo de eso daría negativo, algo que no
        # tiene sentido para un precio.
        CheckConstraint(
            "utilidad_porcentaje IS NULL OR (utilidad_porcentaje >= -100 AND utilidad_porcentaje <= 1000)",
            name="ck_productos_utilidad_porcentaje_valido",
        ),
        # > 0, no >= 0: coeficiente participa como divisor de costo (ver
        # _costo_por_unidad_venta más arriba) -- un coeficiente en 0
        # rompería esa cuenta (división por cero).
        CheckConstraint("coeficiente > 0", name="ck_productos_coeficiente_positivo"),
        # Cada producto usa EXACTAMENTE un modo de precio a la vez -- nunca
        # los dos juegos de campos cargados a medias ni los dos vacíos.
        # update_product/create_product (router/products.py) son quienes
        # limpian a NULL el juego de campos del modo que NO corresponde
        # cada vez que se guarda un producto, así que en la práctica esta
        # constraint nunca debería dispararse -- queda como última línea de
        # defensa si algún día se escribe en la tabla sin pasar por ese
        # router.
        # FIX (13/09/2026, pedido del cliente -- "agregar la función de
        # poder ingresar tanto en pesos ARS como en USD" en 'Costo'): se
        # suma "AND moneda_carga IS NOT NULL" también en la rama
        # costo_utilidad -- moneda_carga (ver su Column y comentario más
        # abajo) dejó de ser exclusiva del modo 'directo' en esta fecha, la
        # necesitan los dos modos. Ver la migración
        # b4f1c2e0a973_agrega_moneda_carga_a_costo_utilidad.py: primero
        # backfillea a 'ARS' las filas costo_utilidad existentes (que hasta
        # esta fecha tenían moneda_carga en NULL) y recién después aprieta
        # esta constraint -- si el orden fuera al revés, la migración
        # fallaría contra los datos ya cargados.
        CheckConstraint(
            "(modo_precio = 'directo' AND precio_carga IS NOT NULL AND moneda_carga IS NOT NULL) "
            "OR (modo_precio = 'costo_utilidad' AND costo IS NOT NULL AND costo_incluye_iva IS NOT NULL "
            "AND utilidad_porcentaje IS NOT NULL AND moneda_carga IS NOT NULL)",
            name="ck_productos_campos_segun_modo_precio",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, index=True, nullable=False)
    marca = Column(String, nullable=False) # Ej: "Logitech", "Redragon"
    descripcion = Column(String, nullable=True)
    # FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
    # cargar" -- el dueño puede cargar el precio de CADA producto en la
    # moneda que prefiera: 'ARS' (precio final ya con IVA incluido, fijo,
    # no le afecta ningún cambio de cotización -- típico de productos de
    # costo/fabricación local) o 'USD' (precio SIN IVA, en dólares, pensado
    # para productos importados que el proveedor cotiza así -- ver el
    # comentario grande en precio_venta más abajo sobre cómo se convierte).
    # Default 'USD' a nivel de modelo (no de la base) -- mismo criterio que
    # Usuario.role: el default real vive acá, la migración solo lo usa una
    # vez para backfillear las filas existentes.
    #
    # FEATURE (11/09/2026, pedido del cliente): nullable=True desde acá --
    # antes era obligatorio para TODO producto porque era la única forma de
    # cargar precio.
    #
    # FIX (13/09/2026, pedido del cliente -- "agregar la función de poder
    # ingresar tanto en pesos ARS como en USD" en 'Costo'): entre el
    # 11/09/2026 y esta fecha, un producto en modo 'costo_utilidad' no
    # usaba esta columna para nada y quedaba en NULL -- ahora la reutiliza
    # TAMBIÉN ese modo, para elegir en qué moneda se carga "costo" (ver su
    # Column más abajo, y _costo_en_ars_expr más arriba en este archivo,
    # que es quien realmente usa este valor para convertir costo a pesos).
    # Sigue siendo nullable=True a nivel de columna (ORM), pero el
    # CheckConstraint ck_productos_campos_segun_modo_precio de más arriba
    # ahora exige que NO sea NULL en NINGUNO de los dos modos -- las filas
    # costo_utilidad que ya existían de antes de esta fecha se
    # backfillearon a 'ARS' en la migración
    # b4f1c2e0a973_agrega_moneda_carga_a_costo_utilidad.py (mismo valor que
    # tenían implícito hasta ahora: "costo" siempre se cargó en pesos).
    moneda_carga = Column(String, nullable=True, default="USD")
    # Precio tal cual lo carga el dueño, en la moneda de moneda_carga --
    # reemplaza al precio_usd de la primera versión de "precio dólar"
    # (cuando todavía no existía la opción de cargar en pesos). El precio
    # final en pesos que ve el cliente es precio_venta, más abajo.
    #
    # FEATURE (11/09/2026, pedido del cliente): nullable=True -- mismo
    # motivo que moneda_carga acá arriba: en modo 'costo_utilidad' este
    # campo no se usa, se carga "costo" en su lugar (ver más abajo).
    precio_carga = Column(Numeric(10, 2), nullable=True)
    # FEATURE (09/09/2026, pedido del cliente): "el IVA varía por producto"
    # -- el dueño aclaró que NO es una alícuota única para todo el catálogo
    # (hay productos al 21% general y otros al 10,5% reducido), así que va
    # acá, por producto, y no en ConfiguracionTienda. Solo se USA en el
    # cálculo de precio_venta cuando moneda_carga == 'USD' (ver ese
    # column_property más abajo) -- en un producto cargado en ARS el precio
    # final ya viene con su IVA incluido, este campo simplemente no
    # participa de la cuenta, aunque igual tenga un valor cargado. Default
    # 21 a nivel de modelo (no de la base) -- mismo criterio que
    # moneda_carga: la alícuota general es el caso más común, el dueño
    # cambia a mano los productos que correspondan al 10,5% (o a otro valor).
    # Reutilizado por los dos modos de precio (ver modo_precio más abajo):
    # en 'directo' solo participa de la cuenta si moneda_carga == 'USD'
    # (como hasta ahora); en 'costo_utilidad' participa siempre, en dos
    # pasos distintos de la cadena (ver _costo_neto_expr/_iva_monto_expr
    # más arriba) -- por eso sigue siendo una sola columna compartida y no
    # se duplicó una segunda "iva_porcentaje" propia del modo nuevo.
    iva_porcentaje = Column(Numeric(5, 2), nullable=False, default=21)

    # === FEATURE (11/09/2026, pedido del cliente) ===========================
    # Segunda forma de cargar el precio de un producto -- "costo + IVA +
    # utilidad + coeficiente" -- alternativa a moneda_carga/precio_carga de
    # arriba (que pasa a llamarse el modo 'directo'). Se elige por
    # producto, las dos conviven en el catálogo: cada producto usa una u
    # otra, nunca las dos ni ninguna (ver el CheckConstraint
    # ck_productos_campos_segun_modo_precio más arriba). Ver el comentario
    # grande sobre las funciones _costo_neto_expr y compañía, más arriba en
    # este archivo, para el detalle completo de la cadena de cálculo.
    #
    # A propósito estos cuatro campos (modo_precio, costo, costo_incluye_iva,
    # utilidad_porcentaje -- coeficiente es la excepción, ver su comentario
    # más abajo) NO viajan en el schema público de productos (ver
    # ProductoRead vs. ProductoAdminRead en app/schemas/product.py): costo y
    # utilidad_porcentaje son información comercial sensible (cuánto paga
    # el dueño por el producto y qué margen le pone), no algo que deba
    # verse desde el catálogo público -- solo los ve un admin logueado.
    modo_precio = Column(String, nullable=False, default="directo")
    # Costo cargado por el dueño, en la moneda que indique moneda_carga
    # (Column de más arriba, compartida con el modo 'directo' desde el
    # 13/09/2026 -- ver su comentario) -- CON o SIN IVA según diga
    # costo_incluye_iva (ver más abajo). NULL si modo_precio == 'directo'
    # (ahí no se usa, ver precio_carga arriba).
    #
    # FIX (13/09/2026, pedido del cliente -- "agregar la función de poder
    # ingresar tanto en pesos ARS como en USD"): hasta esta fecha este
    # campo se entendía siempre en pesos (moneda_carga no aplicaba a este
    # modo). _costo_en_ars_expr (más arriba en este archivo) es quien
    # convierte este valor a pesos según moneda_carga ANTES de que entre a
    # la cadena de cálculo (_costo_neto_expr y siguientes) -- esas
    # funciones y el resto de este comentario en columnas de más abajo
    # siguen hablando de "costo" ya asumiendo pesos, porque para cuando
    # llegan ahí ya se convirtió.
    costo = Column(Numeric(12, 2), nullable=True)
    # True: el costo de arriba ya incluye IVA (hay que quitarlo para
    # llegar al costo neto). False: el costo ya es neto, sin IVA, se usa
    # tal cual. NULL si modo_precio == 'directo' (no aplica).
    costo_incluye_iva = Column(Boolean, nullable=True)
    # Margen que se le agrega al costo neto para llegar al precio de venta
    # sin IVA -- ver _utilidad_importe_expr más arriba. Se expresa como
    # porcentaje del costo neto, NUNCA se calcula sobre un importe que ya
    # contenga IVA (pedido explícito del cliente). NULL si modo_precio ==
    # 'directo' (no aplica).
    utilidad_porcentaje = Column(Numeric(6, 2), nullable=True)
    # Para cuando la unidad de COMPRA es distinta de la unidad de VENTA --
    # ej. se compra por docena pero se vende por unidad: coeficiente=12 (ver
    # _costo_por_unidad_venta más arriba, que divide "costo" por este
    # valor). Default 1 (compra y venta en la misma unidad, el caso más
    # común) -- a diferencia de los tres campos de arriba, éste SIEMPRE
    # tiene un valor (nunca NULL, ni en modo 'directo', donde simplemente
    # queda sin usar en 1): así se evita la complejidad extra de un campo
    # opcional para algo que, cuando no aplica, ya tiene un valor neutro
    # obvio (dividir por 1 no cambia nada). No es información sensible como
    # costo/utilidad_porcentaje, pero tampoco tiene ningún uso público, así
    # que igual queda fuera de ProductoRead (ver comentario más arriba).
    coeficiente = Column(Numeric(10, 4), nullable=False, default=1)
    # === fin FEATURE 11/09/2026 ===============================================

    stock = Column(Integer, default=0, nullable=False)
    # Punto de corte propio de ESTE producto para contar como "stock
    # crítico" en la pantalla Stock del panel admin (ver
    # ConfiguracionStock.jsx en el frontend): antes era un número fijo
    # igual para todo el catálogo, ahora lo carga el admin por producto en
    # el formulario de Productos -- uno que se vende rápido puede
    # necesitar un mínimo más alto que uno que casi no rota. "Crítico" es
    # stock <= stock_minimo (0 incluido, sin stock).
    stock_minimo = Column(Integer, default=5, nullable=False)
    garantia = Column(String, nullable=True) # Moví la garantía al producto
    imagen_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    categoria_id = Column(Integer, ForeignKey("categorias.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Se completa (nunca en la creación, arranca NULL) cada vez que el stock
    # pasa de 0 a positivo -- ver update_product en router/products.py. Junto
    # con created_at arma el orden de "últimos productos ingresados" que usa
    # el Home de la tienda: un producto reabastecido después de agotarse
    # vuelve a aparecer como si fuera "nuevo", no solo el que se creó hace
    # poco.
    reabastecido_at = Column(DateTime(timezone=True), nullable=True)

    # FEATURE (09/09/2026, pedido del cliente): "precio dólar" + "elegir
    # pesos o dólares al cargar" -- el precio final en pesos que ve el
    # cliente NO es una columna guardada, se recalcula solo según
    # moneda_carga:
    #
    #   - 'ARS': precio_venta = precio_carga tal cual. Es el precio final,
    #     ya con IVA incluido (el dueño lo carga así, como se hacía antes
    #     de que existiera "precio dólar") -- fijo, no le afecta ningún
    #     cambio futuro de cotización ni de IVA.
    #   - 'USD': precio_venta = precio_carga (SIN IVA, según aclaró el
    #     dueño) x la cotización vigente x (1 + este mismo iva_porcentaje/100).
    #     La cotización sale de ConfiguracionTienda (fila singleton id=1, ver
    #     app/models/store.py), como sub-consulta escalar correlacionada a
    #     NINGÚN producto en particular (siempre lee esa misma fila) -- el
    #     IVA, en cambio, es la columna de ESTE producto (arriba), porque
    #     varía de uno a otro (21% general, 10,5% reducido, etc.).
    #
    # Ventaja de resolverlo así, a nivel de columna calculada por la base,
    # en vez de calcularlo a mano en cada endpoint de app/router/products.py:
    # no hay que tocar list_products, get_product, create_product,
    # update_product, etc. -- con que la query traiga el Producto (SELECT
    # normal, sin cambios), este valor viaja solo, siempre actualizado, sin
    # guardar nunca un precio "viejo" en pesos. Tampoco hace falta recorrer y
    # actualizar todos los productos cuando el dueño cambia la cotización: al
    # ser un valor global no guardado acá, el próximo SELECT ya lee el valor
    # nuevo para todos los productos en USD -- salvo, justamente, los
    # cargados en ARS, que por diseño no dependen de la cotización ni del
    # IVA.
    #
    # Sin redondeo a propósito (pedido explícito del cliente) EN EL MODO
    # 'directo': no se aplica ningún quantize()/round() en ese caso -- puede
    # devolver más de 2 decimales, y eso es intencional (ver ProductoRead en
    # app/schemas/product.py, que no limita decimal_places en este campo).
    # El formateo a 2 decimales para mostrarlo es solo cosmético del
    # frontend (ver utils/formato.js, formatearMoneda), nunca se trunca acá.
    # En el modo 'costo_utilidad' (FEATURE 11/09/2026, ver más arriba) SÍ se
    # redondea en cada paso -- pedido explícito de ESTA feature, ver el
    # comentario grande junto a _costo_neto_expr más arriba sobre por qué
    # es un criterio distinto al de 'directo'.
    #
    # PedidoDetalle.precio_unitario (ver app/models/order.py) SIGUE
    # guardando un valor congelado en el momento de la compra -- éste es
    # el que lee create_order() en router/orders.py (Producto.precio_venta,
    # sin cambios en ese archivo) para armar cada línea del pedido: como acá
    # es un cálculo en vivo, el pedido congela automáticamente "el precio en
    # pesos según la cotización y el IVA de ESE momento" para los productos
    # en dólares, y el precio fijo de siempre para los productos en pesos
    # (y, para 'costo_utilidad', el precio final de esa cuenta en ESE
    # momento -- si el dueño cambia el costo o la utilidad después, los
    # pedidos ya hechos no se ven afectados).
    precio_venta = column_property(
        case(
            (
                modo_precio == "costo_utilidad",
                # FIX (13/09/2026): costo entra convertido a pesos --
                # ver _costo_en_ars_expr más arriba en este archivo.
                _precio_final_costo_utilidad_expr(
                    _costo_en_ars_expr(costo, moneda_carga), coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje
                ),
            ),
            (moneda_carga == "ARS", precio_carga),
            else_=precio_carga * _COTIZACION_DOLAR_VIGENTE * (1 + iva_porcentaje / 100),
        )
    )

    # === FEATURE (11/09/2026, pedido del cliente) ===========================
    # Desglose de la cadena de cálculo para modo_precio == 'costo_utilidad',
    # cada paso como su propio campo -- "la interfaz debe mostrar claramente
    # qué importe representa cada campo" (pedido explícito). NULL cuando el
    # producto usa modo_precio == 'directo' (no aplica ninguno de estos
    # pasos -- ver _TIPO_MONTO_COSTO_UTILIDAD más arriba para el cast que
    # necesita esa rama NULL). Solo lectura: no existen en ProductoCreate ni
    # ProductoUpdate, se derivan siempre de costo/coeficiente/
    # costo_incluye_iva/iva_porcentaje/utilidad_porcentaje, nunca se cargan
    # a mano. Igual que precio_venta arriba, no exponerlos en el catálogo
    # público: ver ProductoRead vs. ProductoAdminRead en
    # app/schemas/product.py.
    # FIX (13/09/2026): en los cuatro column_property de acá abajo, "costo"
    # entra convertido a pesos -- ver _costo_en_ars_expr más arriba en este
    # archivo -- antes de la cadena de cálculo, igual que en precio_venta.
    costo_neto = column_property(
        case(
            (
                modo_precio == "costo_utilidad",
                _costo_neto_expr(_costo_en_ars_expr(costo, moneda_carga), coeficiente, costo_incluye_iva, iva_porcentaje),
            ),
            else_=cast(null(), _TIPO_MONTO_COSTO_UTILIDAD),
        )
    )
    utilidad_importe = column_property(
        case(
            (
                modo_precio == "costo_utilidad",
                _utilidad_importe_expr(
                    _costo_en_ars_expr(costo, moneda_carga), coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje
                ),
            ),
            else_=cast(null(), _TIPO_MONTO_COSTO_UTILIDAD),
        )
    )
    precio_venta_sin_iva = column_property(
        case(
            (
                modo_precio == "costo_utilidad",
                _precio_venta_sin_iva_expr(
                    _costo_en_ars_expr(costo, moneda_carga), coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje
                ),
            ),
            else_=cast(null(), _TIPO_MONTO_COSTO_UTILIDAD),
        )
    )
    iva_monto = column_property(
        case(
            (
                modo_precio == "costo_utilidad",
                _iva_monto_expr(
                    _costo_en_ars_expr(costo, moneda_carga), coeficiente, costo_incluye_iva, iva_porcentaje, utilidad_porcentaje
                ),
            ),
            else_=cast(null(), _TIPO_MONTO_COSTO_UTILIDAD),
        )
    )
    # === fin FEATURE 11/09/2026 ===============================================

    categoria = relationship("Categoria", back_populates="productos")
    detalles_pedido = relationship("PedidoDetalle", back_populates="producto")
    # cascade="all, delete-orphan": si el producto se borra físicamente
    # alguna vez (hoy solo hay baja lógica, is_active=False, ver
    # deactivate_product en router/products.py), no tiene sentido dejar
    # favoritos apuntando a un producto que ya no existe.
    favoritos = relationship("Favorito", back_populates="producto", cascade="all, delete-orphan")


class ProductoRelacionado(Base):
    """Vínculo bidireccional entre dos productos -- "También vas a
    necesitar" en la ficha de producto (ver GET /productos/{id}/relacionados
    en router/products.py). Ej: la impresora HL-1212W vinculada con el
    tóner TN-1060 -- cargar el vínculo una sola vez alcanza para que
    aparezca tanto en la ficha de la impresora como en la del tóner, no
    hace falta cargarlo dos veces desde cada lado.

    No se modela con una relationship many-to-many de SQLAlchemy a
    propósito: sería una relación self-referential con dos columnas FK
    apuntando a la misma tabla, lo que obliga a primaryjoin/secondaryjoin
    explícitos y de paso no resuelve el problema real acá, que es evitar
    guardar el mismo par dos veces (una vez A-B y otra B-A). En cambio, se
    guarda una única fila por par y se fuerza un orden canónico con el
    CheckConstraint de abajo: producto_id_a siempre es el id más chico. El
    endpoint (no este modelo) es el que ordena los dos ids con sorted(...)
    antes de guardar, y busca coincidencias en cualquiera de las dos
    columnas al leer -- así una sola fila representa la relación completa
    en los dos sentidos.
    """

    __tablename__ = "productos_relacionados"
    __table_args__ = (
        # Ordena canónicamente el par (id más chico siempre en _a) --
        # de paso, como ningún id puede ser menor que sí mismo, esto
        # también impide que un producto quede "relacionado consigo
        # mismo" sin necesitar una validación aparte para ese caso.
        CheckConstraint("producto_id_a < producto_id_b", name="ck_productos_relacionados_orden_canonico"),
        UniqueConstraint("producto_id_a", "producto_id_b", name="uq_productos_relacionados_par"),
    )

    id = Column(Integer, primary_key=True, index=True)
    producto_id_a = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False, index=True)
    producto_id_b = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
