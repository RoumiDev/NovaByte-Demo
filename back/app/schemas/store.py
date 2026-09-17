"""Esquemas Pydantic para ConfiguracionTienda y MarcaDestacada (ver
app/models/store.py)."""

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MAX_HORARIOS_LENGTH = 2000
_MAX_IMAGEN_URL_LENGTH = 2048
_MAX_NOMBRE_MARCA_LENGTH = 255


class ConfiguracionTiendaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    horarios_atencion: Optional[str] = None
    # FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- ver el
    # comentario grande en ConfiguracionTienda.cotizacion_dolar
    # (app/models/store.py). No es Optional a nivel de schema porque la
    # columna nunca es NULL en la base (nullable=False, default=1).
    cotizacion_dolar: Decimal


class ConfiguracionTiendaUpdate(BaseModel):
    """Edición (endpoint administrativo). horarios_atencion es texto libre
    a propósito -- lo escribe el dueño como quiera (franjas horarias,
    excepciones de feriados, etc.), no un horario estructurado por día."""

    horarios_atencion: Optional[str] = Field(default=None, max_length=_MAX_HORARIOS_LENGTH)
    # FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- gt=0, no
    # ge=0: una cotización de 0 (o negativa) dejaría el precio en pesos de
    # TODO el catálogo en $0, algo que nunca tiene sentido dejar cargar por
    # error (a diferencia de otros precios de la app, acá no hay un caso
    # legítimo de "gratis"). Sigue siendo texto libre en el sentido de que
    # no valida contra ninguna cotización real externa -- el dueño la carga
    # a mano, puede poner cualquier valor positivo.
    cotizacion_dolar: Optional[Decimal] = Field(default=None, gt=0, max_digits=10, decimal_places=2)

    # FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): antes
    # PATCH /configuracion/ no pedía nada más que ser admin para cambiar
    # cotizacion_dolar, un único valor global que reprecia TODO el
    # catálogo cargado en USD al instante -- sin el mismo "sudo" de
    # contraseña que ya se exige para dar de baja UN solo producto
    # (ver DELETE /productos/{id}, eliminar_marca_destacada acá mismo en
    # store.py). Optional porque solo hace falta cuando el cambio incluye
    # cotizacion_dolar -- ver update_configuracion en app/router/store.py,
    # que la exige recién ahí adentro (mismo patrón que
    # UsuarioAdminUpdate.password_actual para role/is_active en
    # app/schemas/user.py).
    password_actual: Optional[str] = Field(default=None, max_length=255)


def _validar_imagen_url_marca(value: str) -> str:
    """Validador de MarcaDestacada.imagen_url -- a propósito NO es el
    mismo _validar_imagen_url de app/schemas/product.py (ese exige que
    empiece con http:// o https://). Acá siempre se guarda la ruta
    RELATIVA que devuelve POST /productos/imagenes (ImagenProductoResponse,
    ver ese schema) -- FEATURE (29/08/2026, pedido del cliente): "Marcas
    destacadas" reutiliza ese mismo endpoint de subida en vez de duplicar
    la lógica de validación de imágenes (ver comentario en
    app/router/store.py), así que lo que llega acá nunca es una URL
    absoluta. Igual se valida el esquema para no aceptar cualquier string
    -- exigir que empiece con "/" descarta javascript:, data: y cualquier
    otro esquema peligroso (mismo espíritu que el hallazgo M-07 de la
    auditoría, que motivó el validador de productos/categorías)."""
    value = value.strip()
    if not value:
        raise ValueError("imagen_url es obligatorio.")
    if len(value) > _MAX_IMAGEN_URL_LENGTH:
        raise ValueError(f"imagen_url no puede superar los {_MAX_IMAGEN_URL_LENGTH} caracteres.")
    if not value.startswith("/"):
        raise ValueError("imagen_url debe ser una ruta relativa (por ejemplo /static/productos/...).")
    return value


class MarcaDestacadaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    posicion: int
    imagen_url: Optional[str] = None
    nombre_marca: Optional[str] = None


class MarcaDestacadaUpdate(BaseModel):
    """Body de PUT /configuracion/marcas-destacadas/{posicion}: la URL que
    ya devolvió POST /productos/imagenes para el archivo (recién subido, o
    el mismo que ya tenía la posición si solo se está corrigiendo la
    marca -- ver ModalCargarImagenMarca.jsx), y la marca a la que
    corresponde esa imagen.

    nombre_marca es obligatorio -- FEATURE (30/08/2026, pedido del
    cliente): sin una marca asociada, el clic en la imagen del Home no
    tendría a qué catálogo filtrado mandar (ver MarcaDestacada.nombre_marca
    en app/models/store.py: es el valor real de Producto.marca, no texto
    libre)."""

    imagen_url: str = Field(min_length=1, max_length=_MAX_IMAGEN_URL_LENGTH)
    nombre_marca: str = Field(min_length=1, max_length=_MAX_NOMBRE_MARCA_LENGTH)

    @field_validator("imagen_url")
    @classmethod
    def _validar_imagen(cls, value: str) -> str:
        return _validar_imagen_url_marca(value)

    @field_validator("nombre_marca")
    @classmethod
    def _validar_nombre_marca(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("nombre_marca es obligatorio.")
        return value
