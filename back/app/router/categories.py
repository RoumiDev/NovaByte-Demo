"""Endpoints de categorías: lectura pública, alta/edición solo para admins."""

import io
import uuid

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.core.config import STORAGE_CATEGORIAS_DIR
from app.core.database import get_db
from app.core.pagination import Limit, Skip
from app.core.rate_limit import confirmar_password_admin_rate_limiter
from app.dependencies.auth import get_tenant_scope, get_tenant_scope_opcional, require_admin, verificar_password_admin
from app.models.product import Categoria
from app.models.user import Usuario
from app.schemas.product import (
    CategoriaCreate,
    CategoriaRead,
    CategoriaUpdate,
    ConfirmacionPassword,
    ImagenProductoResponse,
)
from app.services.vercel_blob import VercelBlobError, blob_habilitado, subir_a_blob

router = APIRouter()


def _con_tenant(query, columna, tenant_scope: int | None):
    """Ver el comentario grande en la copia idéntica de app/router/products.py
    -- duplicado a propósito, mismo criterio que _MAX_IMAGEN_BYTES acá abajo."""
    if tenant_scope is None:
        return query.where(columna.is_(None))
    return query.where(columna == tenant_scope)

# Mismos límites y criterio que subir_imagen_producto en router/products.py
# (ver los comentarios ahí): 5MB de tope, y solo los formatos que un
# navegador puede mostrar sin plugins. Duplicado a propósito en vez de
# importado -- categorías e imágenes de productos son dos flujos de subida
# independientes que no tienen por qué compartir código solo porque hoy los
# valores coinciden.
_MAX_IMAGEN_BYTES = 5 * 1024 * 1024
_FORMATOS_PERMITIDOS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


@router.get("/", response_model=list[CategoriaRead])
def list_categories(
    skip: Skip = 0,
    limit: Limit = 20,
    tenant_scope: int | None = Depends(get_tenant_scope_opcional),
    db: Session = Depends(get_db),
) -> list[Categoria]:
    """FEATURE (17/09/2026, pedido del cliente): tenant_scope (ver
    get_tenant_scope_opcional en app/dependencies/auth.py) filtra a la
    tienda real para un visitante anónimo, o al catálogo propio de un
    admin demo logueado."""
    query = _con_tenant(select(Categoria), Categoria.tenant_id, tenant_scope)
    return list(db.execute(query.order_by(Categoria.nombre).offset(skip).limit(limit)).scalars())


@router.get("/{categoria_id}", response_model=CategoriaRead)
def get_category(
    categoria_id: int,
    tenant_scope: int | None = Depends(get_tenant_scope_opcional),
    db: Session = Depends(get_db),
) -> Categoria:
    categoria = db.execute(
        _con_tenant(select(Categoria).where(Categoria.id == categoria_id), Categoria.tenant_id, tenant_scope)
    ).scalar_one_or_none()
    if categoria is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoría no encontrada")
    return categoria


@router.post(
    "/imagenes",
    response_model=ImagenProductoResponse,
    dependencies=[Depends(require_admin)],
)
async def subir_imagen_categoria(archivo: UploadFile = File(...)) -> dict:
    """Subir una imagen para usar como imagen_url de una categoría (la
    tarjeta con foto del menú de "Catálogo"). Mismo flujo que
    subir_imagen_producto en router/products.py -- ver los comentarios ahí
    para el detalle de por qué se valida con Pillow y se genera un nombre
    de archivo propio (UUID) en vez de confiar en el que manda el cliente.

    Declarado ANTES de POST /{categoria_id} -- no aplica acá porque esa
    ruta es PATCH, no POST, pero se mantiene el mismo orden que en
    products.py por consistencia.
    """
    contenido = await archivo.read()
    if len(contenido) > _MAX_IMAGEN_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen no puede superar los 5MB.",
        )

    try:
        Image.open(io.BytesIO(contenido)).verify()
        # verify() deja el objeto inutilizable para seguir operando con él;
        # se reabre para leer el formato ya confirmado que el archivo es válido.
        formato = Image.open(io.BytesIO(contenido)).format
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo no es una imagen válida.")

    extension = _FORMATOS_PERMITIDOS.get(formato)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de imagen no soportado. Usá JPG, PNG o WEBP.",
        )

    nombre_archivo = f"{uuid.uuid4().hex}.{extension}"

    # FEATURE (17/09/2026, deploy en Vercel) -- mismo criterio que
    # subir_imagen_producto en app/router/products.py, ver los comentarios ahí.
    if blob_habilitado():
        content_type = f"image/{'jpeg' if extension == 'jpg' else extension}"
        try:
            url = await subir_a_blob(contenido, nombre_archivo, "categorias", content_type)
        except VercelBlobError:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudo subir la imagen. Intentá de nuevo en unos minutos.",
            )
        return {"url": url}

    (STORAGE_CATEGORIAS_DIR / nombre_archivo).write_bytes(contenido)

    # FIX B-03 (auditoría QA+Seguridad 28/08/2026) -- mismo criterio que
    # subir_imagen_producto en router/products.py: ya no se arma acá la URL
    # absoluta con request.base_url (quedaba fija con el host de ese
    # momento y se rompía al mover la base de datos a otra máquina). Se
    # devuelve sólo la ruta relativa; el frontend la resuelve contra la API
    # que esté usando (ver utils/imagenes.js, resolverUrlImagen).
    url = f"/static/categorias/{nombre_archivo}"
    return {"url": url}


@router.post(
    "/",
    response_model=CategoriaRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_category(
    body: CategoriaCreate,
    tenant_scope: int | None = Depends(get_tenant_scope),
    db: Session = Depends(get_db),
) -> Categoria:
    """FEATURE (17/09/2026, pedido del cliente): la categoría nueva nace
    marcada con tenant_scope -- ver el comentario grande en
    Categoria.tenant_id (app/models/product.py) sobre los dos índices
    únicos parciales que hacen que el mismo nombre pueda repetirse una vez
    por tenant sin chocar."""
    categoria = Categoria(**body.model_dump(), tenant_id=tenant_scope)
    db.add(categoria)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe una categoría con ese nombre.")
    db.refresh(categoria)
    return categoria


@router.patch("/{categoria_id}", response_model=CategoriaRead)
def update_category(
    categoria_id: int,
    body: CategoriaUpdate,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Categoria:
    """FEATURE (27/08/2026, pedido del cliente): confirmar con la
    contraseña del admin logueado antes de aplicar la edición -- ver
    verificar_password_admin en app/dependencies/auth.py. A diferencia de
    update_product (router/products.py), acá CUALQUIER cambio la exige: una
    categoría no tiene un campo de bajo riesgo equivalente a "stock" que
    valga la pena eximir.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026):
    confirmar_password_admin_rate_limiter se llama A MANO acá adentro, igual
    que en update_product -- la contraseña sigue siendo condicional en el
    código (guardada bajo "if changes:"), así que dependencies=[] del
    decorador la aplicaría también a un PATCH vacío. Ver el comentario
    grande en app/core/rate_limit.py.

    FEATURE (17/09/2026, pedido del cliente): la categoría tiene que ser
    del MISMO tenant que admin_actual (404 si no, mismo criterio IDOR de
    siempre).
    """
    categoria = db.execute(
        _con_tenant(
            select(Categoria).where(Categoria.id == categoria_id), Categoria.tenant_id, admin_actual.tenant_id
        )
    ).scalar_one_or_none()
    if categoria is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoría no encontrada")

    changes = body.model_dump(exclude_unset=True)
    password_actual = changes.pop("password_actual", None)
    if changes:
        if not password_actual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Falta confirmar con tu contraseña.",
            )
        confirmar_password_admin_rate_limiter(request)
        verificar_password_admin(password_actual, admin_actual, request)

    for field, value in changes.items():
        setattr(categoria, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe una categoría con ese nombre.")
    db.refresh(categoria)
    return categoria


@router.delete(
    "/{categoria_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(confirmar_password_admin_rate_limiter)],
)
def delete_category(
    categoria_id: int,
    confirmacion: ConfirmacionPassword,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    """Borrar una categoría. Falla con 409 (en vez de 500) si todavía tiene
    productos asociados, porque la FK productos.categoria_id no tiene
    ondelete=CASCADE a propósito (ver hallazgo M-06 de la revisión de modelos).

    FEATURE (27/08/2026, pedido del cliente): exige la contraseña del admin
    logueado antes de eliminar -- ver verificar_password_admin en
    app/dependencies/auth.py.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026): acá
    la contraseña SIEMPRE es obligatoria, así que el rate limiter va como
    dependencies=[] del decorador -- ver app/core/rate_limit.py.
    """
    verificar_password_admin(confirmacion.password_actual, admin_actual, request)
    categoria = db.execute(
        _con_tenant(
            select(Categoria).where(Categoria.id == categoria_id), Categoria.tenant_id, admin_actual.tenant_id
        )
    ).scalar_one_or_none()
    if categoria is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoría no encontrada")
    db.delete(categoria)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: la categoría todavía tiene productos asociados.",
        )
    return None