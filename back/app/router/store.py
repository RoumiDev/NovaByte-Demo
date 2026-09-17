"""Configuración general de la tienda (horarios de atención, marcas
destacadas).

Lectura pública -- la usa la página de Contacto (horarios) y el Home
(marcas destacadas) del sitio, que cualquiera tiene que poder ver sin
loguearse (mismo criterio que /productos y /categorias). Edición solo
para admins -- la usa el panel de Configuración → General
(ConfiguracionGeneral.jsx en el frontend, sección visible nada más si
esAdmin)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.database import get_db
from app.core.rate_limit import confirmar_password_admin_rate_limiter
from app.dependencies.auth import require_admin, verificar_password_admin
from app.models.store import ConfiguracionTienda, MarcaDestacada
from app.models.user import Usuario
from app.schemas.product import ConfirmacionPassword
from app.schemas.store import (
    ConfiguracionTiendaRead,
    ConfiguracionTiendaUpdate,
    MarcaDestacadaRead,
    MarcaDestacadaUpdate,
)

router = APIRouter()

# Tabla singleton: siempre esta misma fila (ver comentario en el modelo).
_ID_CONFIGURACION = 1

# FEATURE (29/08/2026, pedido del cliente): "debe haber exactamente 10
# posiciones y no permitir una undécima" -- ver MarcaDestacada en
# app/models/store.py.
_TOTAL_POSICIONES_MARCAS = 10


def _obtener_o_crear(db: Session) -> ConfiguracionTienda:
    """Devuelve la fila de configuración, creándola si todavía no existe.

    Red de contención más que flujo esperado: la migración que crea la
    tabla ya inserta esta fila (ver alembic/versions), así que esto solo
    entra en juego si alguna vez la base se recreó a mano sin correr esa
    migración -- evita que ese caso raro tire un 500 en vez de simplemente
    autocurarse.
    """
    config = db.get(ConfiguracionTienda, _ID_CONFIGURACION)
    if config is None:
        config = ConfiguracionTienda(id=_ID_CONFIGURACION)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.get("/", response_model=ConfiguracionTiendaRead)
def get_configuracion(db: Session = Depends(get_db)) -> ConfiguracionTienda:
    return _obtener_o_crear(db)


@router.patch("/", response_model=ConfiguracionTiendaRead)
def update_configuracion(
    body: ConfiguracionTiendaUpdate,
    request: Request,
    # FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): admin_actual
    # ahora se recibe como parámetro (en vez de dependencies=[Depends(require_admin)]
    # en el decorador) por el mismo motivo que admin_update_user en
    # app/router/users.py: acá adentro hace falta el Usuario real para
    # pasárselo a verificar_password_admin cuando el cambio incluye
    # cotizacion_dolar. Sigue exigiendo admin para CUALQUIER cambio (horarios
    # incluido) -- Depends(require_admin) se sigue evaluando igual, solo que
    # ahora como parámetro en vez de como dependencies=[].
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ConfiguracionTienda:
    config = _obtener_o_crear(db)
    changes = body.model_dump(exclude_unset=True)
    password_actual = changes.pop("password_actual", None)
    # FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): antes se
    # podía cambiar cotizacion_dolar (repreciando TODO el catálogo en USD al
    # instante) con un solo clic en "Guardar", sin ningún "sudo" de
    # contraseña -- a diferencia de dar de baja UN solo producto, que sí lo
    # exige (ver eliminar_marca_destacada más abajo en este mismo archivo, y
    # deactivate_product en app/router/products.py). Se pide la contraseña
    # SOLO cuando cotizacion_dolar está entre los campos que cambian --
    # guardar nada más los horarios de atención sigue sin pedirla, igual que
    # antes (mismo criterio que admin_update_user con role/is_active en
    # app/router/users.py: el "sudo" es condicional al campo sensible, no a
    # todo el endpoint).
    if "cotizacion_dolar" in changes:
        if not password_actual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Falta confirmar con tu contraseña.",
            )
        confirmar_password_admin_rate_limiter(request)
        verificar_password_admin(password_actual, admin_actual, request)
    for field, value in changes.items():
        setattr(config, field, value)
    db.commit()
    db.refresh(config)
    return config


def _asegurar_posiciones_marcas(db: Session) -> None:
    """Garantiza que existan las 10 filas fijas (posicion 1..10) de
    MarcaDestacada -- ver el comentario en ese modelo sobre por qué son
    filas fijas y no un catálogo libre. Mismo criterio de autocuración que
    _obtener_o_crear más arriba: la migración ya las inserta, esto solo
    cubre el caso de una base recreada sin correr esa migración."""
    posiciones_existentes = set(db.execute(select(MarcaDestacada.posicion)).scalars())
    faltantes = set(range(1, _TOTAL_POSICIONES_MARCAS + 1)) - posiciones_existentes
    if faltantes:
        for posicion in sorted(faltantes):
            db.add(MarcaDestacada(posicion=posicion))
        db.commit()


def _obtener_marca_o_404(db: Session, posicion: int) -> MarcaDestacada:
    if posicion < 1 or posicion > _TOTAL_POSICIONES_MARCAS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Posición inválida.")
    return db.execute(select(MarcaDestacada).where(MarcaDestacada.posicion == posicion)).scalar_one()


@router.get("/marcas-destacadas", response_model=list[MarcaDestacadaRead])
def list_marcas_destacadas(db: Session = Depends(get_db)) -> list[MarcaDestacada]:
    """Las 10 posiciones, siempre en orden -- las usa tanto
    ConfiguracionGeneral.jsx (grilla de carga admin) como
    FilaMarcasDestacadas.jsx (franja pública del Home, dos filas de 5).
    Público, mismo criterio que GET / (horarios) más arriba."""
    _asegurar_posiciones_marcas(db)
    query = select(MarcaDestacada).order_by(MarcaDestacada.posicion)
    return list(db.execute(query).scalars())


@router.put(
    "/marcas-destacadas/{posicion}",
    response_model=MarcaDestacadaRead,
    dependencies=[Depends(require_admin)],
)
def set_marca_destacada(posicion: int, body: MarcaDestacadaUpdate, db: Session = Depends(get_db)) -> MarcaDestacada:
    """Carga (o reemplaza) la imagen de una posición fija, y la marca a la
    que corresponde.

    FEATURE (29/08/2026, pedido del cliente): "revisá la implementación
    existente de carga de imágenes de productos y reutilizá la lógica...
    No dupliques esa lógica" -- el archivo en sí se sube antes, desde el
    frontend, contra el endpoint que YA existe para productos (POST
    /productos/imagenes, ver subir_imagen_producto en
    app/router/products.py -- mismo componente/flujo que usa el alta de
    productos, con las mismas validaciones de tamaño/formato). Acá no se
    reimplementa nada de esa subida: solo se guarda la URL relativa que
    esa subida ya devolvió, en la posición elegida.

    nombre_marca (FEATURE 30/08/2026, pedido del cliente): también se
    guarda acá siempre, tanto en una carga nueva como al solo corregir la
    marca de una imagen ya subida (ver ModalCargarImagenMarca.jsx, que
    manda el imagen_url existente sin volver a subir el archivo en ese
    caso) -- ver el comentario en MarcaDestacadaUpdate sobre por qué es
    obligatorio.
    """
    _asegurar_posiciones_marcas(db)
    marca = _obtener_marca_o_404(db, posicion)
    marca.imagen_url = body.imagen_url
    marca.nombre_marca = body.nombre_marca
    db.commit()
    db.refresh(marca)
    return marca


@router.delete(
    "/marcas-destacadas/{posicion}",
    response_model=MarcaDestacadaRead,
    dependencies=[Depends(confirmar_password_admin_rate_limiter)],
)
def eliminar_marca_destacada(
    posicion: int,
    confirmacion: ConfirmacionPassword,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> MarcaDestacada:
    """Vacía la posición (imagen_url = NULL, nombre_marca = NULL) -- NUNCA
    borra la fila, así conserva su número del 1 al 10 y las demás no se
    corren (pedido explícito del cliente, ver comentario en el modelo).
    Body/criterio idéntico a DELETE /productos/{id} y DELETE
    /categorias/{id}: exige la contraseña del admin logueado antes de
    aplicar (ConfirmacionPassword, compartida entre esos dos routers y
    este -- ver verificar_password_admin en app/dependencies/auth.py).

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026): acá
    la contraseña SIEMPRE es obligatoria, así que el rate limiter va como
    dependencies=[] del decorador -- ver app/core/rate_limit.py.
    """
    verificar_password_admin(confirmacion.password_actual, admin_actual, request)
    _asegurar_posiciones_marcas(db)
    marca = _obtener_marca_o_404(db, posicion)
    marca.imagen_url = None
    marca.nombre_marca = None
    db.commit()
    db.refresh(marca)
    return marca
