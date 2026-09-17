"""Esquemas Pydantic para Categoria y Producto.

Los límites numéricos (ge=0, etc.) espejan a propósito los
CheckConstraints definidos en app/models/product.py: validar acá evita un
viaje a la base solo para descubrir que el valor es inválido, pero el
CheckConstraint de la base de datos sigue siendo la última línea de defensa
si algún día se escribe en la tabla sin pasar por estos schemas.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_ALLOWED_IMAGE_SCHEMES = ("http://", "https://")
_MAX_IMAGE_URL_LENGTH = 2048
# FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
# cargar" -- valores válidos de Producto.moneda_carga, mismo criterio que
# _TIPOS_FACTURA_VALIDOS en app/schemas/order.py (string simple + validador,
# no un Enum de Pydantic) para no atarlo a un tipo más rígido del que hace
# falta.
_MONEDAS_CARGA_VALIDAS = {"ARS", "USD"}
# FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
# coeficiente" -- valores válidos de Producto.modo_precio, mismo criterio
# (string simple + validador) que _MONEDAS_CARGA_VALIDAS acá arriba. Ver el
# comentario grande en Producto.modo_precio (app/models/product.py).
_MODOS_PRECIO_VALIDOS = {"directo", "costo_utilidad"}


def _validar_imagen_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    value = value.strip()
    if not value:
        return None
    if len(value) > _MAX_IMAGE_URL_LENGTH:
        raise ValueError(f"imagen_url no puede superar los {_MAX_IMAGE_URL_LENGTH} caracteres.")
    if not value.lower().startswith(_ALLOWED_IMAGE_SCHEMES):
        # Rechaza esquemas como javascript: o data: (ver hallazgo M-07 del
        # informe de auditoría de app/models).
        raise ValueError("imagen_url debe empezar con http:// o https://.")
    return value


class CategoriaBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=255)
    # Reemplaza a "descripcion" (se sacó, no se usaba en ninguna pantalla):
    # la foto de la categoría para la tarjeta con imagen del menú de
    # "Catálogo". Mismo validador que Producto.imagen_url (esquemas http/
    # https, nunca javascript:/data:, ver hallazgo M-07).
    imagen_url: Optional[str] = Field(default=None, max_length=_MAX_IMAGE_URL_LENGTH)

    @field_validator("imagen_url")
    @classmethod
    def _validar_imagen(cls, value: Optional[str]) -> Optional[str]:
        return _validar_imagen_url(value)


class CategoriaCreate(CategoriaBase):
    """Alta de categoría (endpoint administrativo)."""


class CategoriaUpdate(BaseModel):
    """Edición parcial de categoría (endpoint administrativo)."""

    nombre: Optional[str] = Field(default=None, min_length=1, max_length=255)
    imagen_url: Optional[str] = Field(default=None, max_length=_MAX_IMAGE_URL_LENGTH)
    # FEATURE (27/08/2026, pedido del cliente): confirmar con la contraseña
    # del admin logueado antes de aplicar la edición -- ver
    # verificar_password_admin en app/dependencies/auth.py y update_category
    # en router/categories.py, que la saca de "changes" antes de aplicar
    # setattr (no es un campo real de Categoria, no tiene columna). Opcional
    # acá a nivel de schema a propósito -- update_category es quien decide
    # si hace falta exigirla según qué se esté cambiando, y devuelve 422 si
    # falta.
    password_actual: Optional[str] = Field(default=None, max_length=255)

    @field_validator("imagen_url")
    @classmethod
    def _validar_imagen(cls, value: Optional[str]) -> Optional[str]:
        return _validar_imagen_url(value)


class CategoriaRead(CategoriaBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ProductoBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=255)
    marca: str = Field(min_length=1, max_length=255)
    descripcion: Optional[str] = Field(default=None, max_length=2000)
    # FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
    # cargar" -- el dueño elige en qué moneda carga ESTE producto:
    #
    #   - 'ARS': precio_carga es el precio final en pesos, ya con IVA
    #     incluido (como se cargaba antes de que existiera "precio dólar").
    #   - 'USD': precio_carga es el precio en dólares SIN IVA (así cotizan
    #     los proveedores/importadores, según aclaró el dueño) -- el precio
    #     final en pesos se arma solo sumando el IVA y aplicando la
    #     cotización vigente.
    #
    # El precio final que ve el cliente en cualquiera de los dos casos es
    # precio_venta (computado, solo lectura, ver ProductoRead más abajo) --
    # ver el comentario grande en Producto.precio_venta (app/models/product.py)
    # para el detalle de la cuenta.
    # FIX (13/09/2026, bug reportado por el cliente -- "no se pudo conectar
    # con el servidor" en Productos, en realidad un 500 de ResponseValidationError):
    # pasa a ser Optional, mismo motivo y mismo momento que precio_carga acá
    # abajo -- se pasó por alto en su momento. _normalizar_campos_segun_modo_
    # precio (router/products.py) deja moneda_carga en NULL para todo
    # producto en modo "costo_utilidad" (no se usa en ese modo, ver el
    # comentario de acá abajo), pero como el tipo de este campo seguía
    # siendo "str" a secas, Pydantic rechazaba esa respuesta con un 500 apenas
    # la lista de productos incluía uno solo en ese modo -- rompía tanto
    # GET /productos/ como GET /productos/{id} (ProductoRead hereda este
    # campo de acá) para TODO el catálogo, no solo para ese producto puntual.
    # Sigue siendo obligatorio en la práctica para un producto en modo
    # "directo" -- eso se valida en _validar_campos_segun_modo_precio/
    # update_product, no hace falta que el tipo del campo lo exija.
    moneda_carga: Optional[str] = Field(default="USD", max_length=3)
    # FEATURE (11/09/2026, pedido del cliente): pasa a ser Optional --
    # antes era obligatorio para TODO producto porque era la única forma de
    # cargar precio; ahora que existe el modo "costo_utilidad" (ver
    # ProductoCreate._validar_campos_segun_modo_precio más abajo), un
    # producto en ESE modo no manda precio_carga para nada, manda "costo"
    # en su lugar. Sigue siendo obligatorio en la práctica para un producto
    # en modo "directo" -- esa exigencia ahora se valida ahí abajo, ya no
    # alcanza con que el tipo del campo sea obligatorio.
    precio_carga: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    # FEATURE (09/09/2026, pedido del cliente): "el IVA varía por producto"
    # -- el dueño aclaró que NO es una alícuota única para todo el catálogo
    # (21% general, 10,5% reducido en algunos casos), así que va por
    # producto y no en ConfiguracionTienda (ver ProductoBase más arriba y
    # el comentario grande en Producto.precio_venta, app/models/
    # product.py). Solo se usa en la cuenta cuando moneda_carga == 'USD';
    # en un producto cargado en ARS el valor existe pero no participa del
    # cálculo. ge=0 (0% es válido, por ejemplo un producto exento) y le=100
    # como tope de sanidad (más de 100% sería casi con certeza un error de
    # tipeo, por ejemplo "210" en vez de "21.0"). default=21: alícuota
    # general de IVA en Argentina, el caso más común para este catálogo.
    iva_porcentaje: Decimal = Field(default=21, ge=0, le=100, max_digits=5, decimal_places=2)
    stock: int = Field(ge=0)
    # Punto de corte propio de este producto para el filtro "Stock crítico"
    # de la pantalla Stock (ver ConfiguracionStock.jsx): default=5 así una
    # alta que no lo manda explícitamente (poco probable, el form del
    # frontend siempre lo completa) no rompe -- queda con el mismo valor
    # que tenía la constante fija que reemplaza.
    stock_minimo: int = Field(default=5, ge=0)
    garantia: Optional[str] = Field(default=None, max_length=255)
    imagen_url: Optional[str] = Field(default=None, max_length=_MAX_IMAGE_URL_LENGTH)
    categoria_id: int = Field(gt=0)

    @field_validator("imagen_url")
    @classmethod
    def _validar_imagen(cls, value: Optional[str]) -> Optional[str]:
        return _validar_imagen_url(value)

    @field_validator("moneda_carga")
    @classmethod
    def _validar_moneda_carga(cls, value: Optional[str]) -> Optional[str]:
        # FIX (13/09/2026): moneda_carga ahora puede llegar en None -- ver
        # el comentario grande junto al campo, unas líneas más arriba --
        # típicamente al leer (from_attributes) un producto en modo
        # "costo_utilidad" desde la base. Sin este chequeo, `value.strip()`
        # explotaría con AttributeError antes de llegar siquiera al mensaje
        # de error "debe ser uno de...". Mismo patrón que ya usa
        # ProductoUpdate._validar_moneda_carga más abajo para este mismo
        # campo, ahora opcional.
        if value is None:
            return None
        value = value.strip().upper()
        if value not in _MONEDAS_CARGA_VALIDAS:
            raise ValueError(f"moneda_carga debe ser uno de: {', '.join(sorted(_MONEDAS_CARGA_VALIDAS))}.")
        return value


class ProductoCreate(ProductoBase):
    """Alta de producto (endpoint administrativo).

    No incluye id, is_active ni created_at: is_active nace en True por el
    default del modelo y el backend no debe aceptar que el cliente lo fije.

    FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
    coeficiente" -- estos cinco campos van ACÁ (y en ProductoUpdate más
    abajo), no en ProductoBase, a propósito: ProductoBase también lo hereda
    ProductoRead (la respuesta del catálogo PÚBLICO, ver GET /productos/ y
    GET /productos/{id} en router/products.py, ninguno de los dos exige
    sesión de admin) -- si estuvieran en ProductoBase, cualquier visitante
    vería cuánto paga el dueño por cada producto y qué margen le pone. Ver
    ProductoAdminRead más abajo para dónde SÍ se exponen de vuelta (nunca
    en el catálogo público, solo en las respuestas administrativas).
    """

    modo_precio: str = Field(default="directo", max_length=20)
    # Ver el comentario grande en Producto.costo/costo_incluye_iva/
    # utilidad_porcentaje/coeficiente (app/models/product.py) para el
    # significado de cada uno. Los tres primeros son Optional acá porque
    # solo son obligatorios cuando modo_precio == "costo_utilidad" -- ver
    # _validar_campos_segun_modo_precio más abajo, que es quien realmente
    # los exige en ese caso (el tipo Optional del campo no alcanza para
    # expresar "obligatorio solo a veces").
    costo: Optional[Decimal] = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    costo_incluye_iva: Optional[bool] = None
    # Tope de sanidad -100/1000, no una regla de negocio estricta -- mismo
    # criterio que Producto.utilidad_porcentaje (ver ese comentario,
    # app/models/product.py) sobre por qué -100 sí es un límite real y
    # 1000 es solo para atajar errores de tipeo.
    utilidad_porcentaje: Optional[Decimal] = Field(default=None, ge=-100, le=1000, max_digits=6, decimal_places=2)
    # gt=0, no ge=0: coeficiente divide a costo (ver _costo_por_unidad_venta
    # en app/models/product.py) -- 0 rompería esa cuenta. Default 1: compra
    # y venta en la misma unidad, el caso más común (ver el comentario en
    # Producto.coeficiente sobre por qué este campo, a diferencia de los
    # tres de arriba, siempre tiene un valor).
    coeficiente: Decimal = Field(default=1, gt=0, max_digits=10, decimal_places=4)

    @field_validator("modo_precio")
    @classmethod
    def _validar_modo_precio(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in _MODOS_PRECIO_VALIDOS:
            raise ValueError(f"modo_precio debe ser uno de: {', '.join(sorted(_MODOS_PRECIO_VALIDOS))}.")
        return value

    @model_validator(mode="after")
    def _validar_campos_segun_modo_precio(self) -> "ProductoCreate":
        """Cada producto usa EXACTAMENTE un modo de precio -- ver el
        CheckConstraint ck_productos_campos_segun_modo_precio (app/models/
        product.py) que respalda esta misma regla del lado de la base.
        Válida acá los campos que llegan en un alta completa (ProductoCreate
        siempre trae TODOS los campos, a diferencia de ProductoUpdate, que
        es parcial) -- por eso alcanza con un @model_validator simple, sin
        necesitar mezclar con valores ya guardados como sí hace
        update_product en router/products.py para ProductoUpdate."""
        if self.modo_precio == "costo_utilidad":
            faltantes = [
                nombre
                for nombre, valor in (
                    ("costo", self.costo),
                    ("costo_incluye_iva", self.costo_incluye_iva),
                    ("utilidad_porcentaje", self.utilidad_porcentaje),
                )
                if valor is None
            ]
            if faltantes:
                raise ValueError(
                    f"Con modo_precio 'costo_utilidad' hacen falta: {', '.join(faltantes)}."
                )
        elif self.precio_carga is None:
            raise ValueError("Con modo_precio 'directo' hace falta precio_carga.")
        return self


class ProductoUpdate(BaseModel):
    """Edición parcial de producto (endpoint administrativo). Todo opcional."""

    nombre: Optional[str] = Field(default=None, min_length=1, max_length=255)
    marca: Optional[str] = Field(default=None, min_length=1, max_length=255)
    descripcion: Optional[str] = Field(default=None, max_length=2000)
    # FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
    # cargar" -- ver el comentario en ProductoBase.moneda_carga más arriba.
    moneda_carga: Optional[str] = Field(default=None, max_length=3)
    precio_carga: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    # FEATURE (09/09/2026, pedido del cliente): "el IVA varía por producto"
    # -- ver el comentario en ProductoBase.iva_porcentaje más arriba.
    iva_porcentaje: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)
    # FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
    # coeficiente" -- mismos campos y mismos límites que ProductoCreate más
    # arriba (ver los comentarios ahí para el detalle de cada uno), pero acá
    # NO hay un @model_validator de "hacen falta tal y tal campo si
    # modo_precio es tal": ProductoUpdate es un PATCH parcial (puede traer
    # cualquier subconjunto de campos, o ninguno de estos), así que esa
    # validación necesita los valores EFECTIVOS -- lo que cambia en este
    # body más lo que el producto ya tenía guardado -- y eso solo se puede
    # armar en update_product (router/products.py) después de cargar el
    # producto de la base, no acá adentro. Mismo criterio que
    # tipo_documento/numero_documento/condicion_iva en UsuarioAdminUpdate
    # (app/schemas/user.py) por el mismo motivo.
    modo_precio: Optional[str] = Field(default=None, max_length=20)
    costo: Optional[Decimal] = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    costo_incluye_iva: Optional[bool] = None
    utilidad_porcentaje: Optional[Decimal] = Field(default=None, ge=-100, le=1000, max_digits=6, decimal_places=2)
    coeficiente: Optional[Decimal] = Field(default=None, gt=0, max_digits=10, decimal_places=4)
    stock: Optional[int] = Field(default=None, ge=0)
    stock_minimo: Optional[int] = Field(default=None, ge=0)
    garantia: Optional[str] = Field(default=None, max_length=255)
    imagen_url: Optional[str] = Field(default=None, max_length=_MAX_IMAGE_URL_LENGTH)
    categoria_id: Optional[int] = Field(default=None, gt=0)
    is_active: Optional[bool] = None
    # FEATURE (27/08/2026, pedido del cliente): mismo campo y mismo motivo
    # que CategoriaUpdate.password_actual (ver el comentario ahí) -- acá
    # update_product (router/products.py) exime el caso de que lo único que
    # cambie sea "stock" (lo usa ConfiguracionStock.jsx para actualizaciones
    # rápidas y frecuentes, pedir contraseña en cada fila rompería el
    # sentido de esa pantalla); cualquier otro campo, incluido reactivar
    # (is_active=True), sí la exige.
    password_actual: Optional[str] = Field(default=None, max_length=255)

    @field_validator("imagen_url")
    @classmethod
    def _validar_imagen(cls, value: Optional[str]) -> Optional[str]:
        return _validar_imagen_url(value)

    @field_validator("moneda_carga")
    @classmethod
    def _validar_moneda_carga(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip().upper()
        if value not in _MONEDAS_CARGA_VALIDAS:
            raise ValueError(f"moneda_carga debe ser uno de: {', '.join(sorted(_MONEDAS_CARGA_VALIDAS))}.")
        return value

    @field_validator("modo_precio")
    @classmethod
    def _validar_modo_precio(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip().lower()
        if value not in _MODOS_PRECIO_VALIDOS:
            raise ValueError(f"modo_precio debe ser uno de: {', '.join(sorted(_MODOS_PRECIO_VALIDOS))}.")
        return value


class ProductoRead(ProductoBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime
    categoria: Optional[CategoriaRead] = None
    # FEATURE (09/09/2026, pedido del cliente): "precio dólar" + "elegir
    # pesos o dólares al cargar" -- precio final en pesos, calculado por la
    # base en cada lectura según moneda_carga (fijo si es 'ARS'; precio_carga
    # x cotización x (1+IVA) si es 'USD') -- ver el column_property en
    # Producto.precio_venta (app/models/product.py) para el detalle
    # completo. Es SOLO de lectura: no existe en ProductoCreate ni en
    # ProductoUpdate (ninguno hereda de un schema que lo tenga), así que no
    # hay forma de que un cliente lo mande a mano al crear/editar.
    # Sin max_digits/decimal_places a propósito: el cliente pidió "sin
    # redondeo" para esta conversión (ver el comentario grande en el
    # modelo), así que este campo no le pone un tope artificial a la
    # precisión decimal que devuelva la base.
    #
    # FEATURE (11/09/2026, pedido del cliente): desde que existe el modo
    # "costo_utilidad" (ver ProductoAdminRead más abajo), este mismo campo
    # también es el precio final de ESA cuenta cuando corresponde -- sigue
    # siendo "el precio final que paga el cliente" sea cual sea el modo de
    # este producto puntual, no hace falta un campo separado por modo acá.
    precio_venta: Decimal = Field(ge=0)


class ProductoAdminRead(ProductoRead):
    """Lo que ve un ADMIN de un producto -- extiende ProductoRead (la
    respuesta del catálogo público) con todo lo que un admin necesita ver
    para administrar precios, pero que un visitante nunca debería ver: el
    modo de precio, el costo cargado, si ese costo incluye IVA, el
    porcentaje de utilidad, el coeficiente, y el desglose completo de la
    cuenta cuando modo_precio == 'costo_utilidad' (costo neto, utilidad en
    pesos, precio sin IVA, importe de IVA -- ver el comentario grande junto
    a Producto.modo_precio en app/models/product.py para el detalle de cada
    uno). Usado por response_model en los tres endpoints administrativos de
    router/products.py: GET /productos/todos, POST /productos/ y PATCH
    /productos/{id} -- GET /productos/ y GET /productos/{id} (los dos
    públicos) siguen devolviendo ProductoRead a secas.

    FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
    coeficiente".
    """

    modo_precio: str
    costo: Optional[Decimal] = None
    costo_incluye_iva: Optional[bool] = None
    utilidad_porcentaje: Optional[Decimal] = None
    coeficiente: Decimal
    # Desglose de la cadena de cálculo, solo tiene valor cuando modo_precio
    # == 'costo_utilidad' -- None en modo 'directo' (ver los cuatro
    # column_property homónimos en Producto, app/models/product.py, que ya
    # devuelven NULL en ese caso). Mismo criterio que precio_venta arriba:
    # sin max_digits/decimal_places, ya vienen redondeados a 2 decimales
    # desde la base (a diferencia de precio_venta en modo 'directo', acá SÍ
    # se redondea en cada paso -- pedido explícito de esta feature).
    costo_neto: Optional[Decimal] = None
    utilidad_importe: Optional[Decimal] = None
    precio_venta_sin_iva: Optional[Decimal] = None
    iva_monto: Optional[Decimal] = None


class ImagenProductoResponse(BaseModel):
    """Respuesta de POST /productos/imagenes: la URL para usar como
    imagen_url al crear o editar un producto."""

    url: str


class ProductoRelacionadoCreate(BaseModel):
    """Body de POST /productos/{id}/relacionados: el id del otro producto
    con el que se quiere vincular (ver ProductoRelacionado en
    app/models/product.py)."""

    producto_relacionado_id: int = Field(gt=0)


class ProductoRelacionadoEstadoResponse(BaseModel):
    """Respuesta de POST/DELETE /productos/{id}/relacionados -- confirma si
    el vínculo quedó creado o eliminado, mismo criterio que
    FavoritoEstadoResponse en app/schemas/favorite.py."""

    relacionado: bool


class ConfirmacionPassword(BaseModel):
    """Body de DELETE /productos/{id} y DELETE /categorias/{id}: la
    contraseña del admin logueado, para confirmar una baja -- ver
    verificar_password_admin en app/dependencies/auth.py. FEATURE
    (27/08/2026, pedido del cliente): "cuando se quiera... dar de baja
    alguna Categoría o Producto, pida la contraseña del admin". Compartida
    entre los dos routers (mismo criterio que ImagenProductoResponse más
    arriba, ya la importa router/categories.py desde acá)."""

    password_actual: str = Field(min_length=1, max_length=255)
