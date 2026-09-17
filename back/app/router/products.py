"""Endpoints de productos: lectura pública (solo activos), alta/edición/baja
lógica solo para admins."""

import io
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status

from app.core.config import STORAGE_PRODUCTOS_DIR
from app.core.database import get_db
from app.core.pagination import Limit, Skip
from app.core.rate_limit import confirmar_password_admin_rate_limiter
from app.dependencies.auth import get_current_user, require_admin, verificar_password_admin
from app.models.favorite import Favorito
from app.models.product import Categoria, Producto, ProductoRelacionado
from app.models.user import Usuario
from app.schemas.favorite import FavoritoEstadoResponse, FavoritoRead
from app.schemas.product import (
    ConfirmacionPassword,
    ImagenProductoResponse,
    ProductoAdminRead,
    ProductoCreate,
    ProductoRead,
    ProductoRelacionadoCreate,
    ProductoRelacionadoEstadoResponse,
    ProductoUpdate,
)

router = APIRouter()

# FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay control de
# orden/precio" en /catalogo -- list_products (más abajo) siempre ordenaba
# por "más nuevo primero", sin forma de pedir otra cosa. Literal en vez de
# str a secas: FastAPI/Pydantic valida solo ACEPTA uno de estos 4 valores
# exactos (cualquier otra cosa es un 422 automático, antes de que este
# código llegue a correr) -- el valor nunca se interpola en SQL como texto,
# solo se usa para elegir una rama de un if/elif (ver el order_by de
# list_products), así que no hay forma de inyectar nada por acá aunque no
# fuera un Literal.
OrdenProductos = Literal["nuevo", "precio_asc", "precio_desc", "nombre"]

# 5 MB: generoso para una foto de producto, chico para no convertir el
# endpoint en un vector de denegación de servicio (subidas gigantes).
_MAX_IMAGEN_BYTES = 5 * 1024 * 1024

# Solo los formatos que un navegador puede mostrar sin plugins. El valor de
# este dict es la extensión real con la que se guarda el archivo -- nunca la
# extensión que mandó el cliente en el nombre original (ver comentario en
# subir_imagen_producto).
_FORMATOS_PERMITIDOS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}

# Tope de longitud para los parámetros de búsqueda nombre/marca de
# list_products (hallazgo #7 de la auditoría AppSec, 2026-08-23). Mismo
# max_length que tienen esos campos como valor real en schemas/product.py --
# no tiene sentido permitir buscar con un texto más largo que el propio
# campo que se está buscando.
_MAX_LONGITUD_BUSQUEDA = 255


def _normalizar_campos_segun_modo_precio(producto: Producto) -> None:
    """Deja en NULL el juego de campos del modo de precio que NO
    corresponde a producto.modo_precio -- FEATURE (11/09/2026, pedido del
    cliente): "costo + IVA + utilidad + coeficiente", segunda forma de
    cargar el precio, alternativa al modo 'directo' (moneda_carga/
    precio_carga) de siempre. El CheckConstraint ck_productos_campos_segun_
    modo_precio (app/models/product.py) no exige por sí solo que el OTRO
    juego quede en NULL (solo exige que el que corresponde esté completo),
    así que sin esto un producto que pasa de un modo al otro (por ejemplo,
    editándolo) quedaría con datos del modo viejo dando vueltas sin usarse
    -- confuso para quien lo mire después, y un resabio que podría filtrar
    (aunque sea sin usarse) por ProductoAdminRead. Se llama desde
    create_product y update_product, siempre DESPUÉS de aplicar los campos
    que vinieron en el body y ANTES de hacer commit.

    FIX (13/09/2026, pedido del cliente -- "agregar la función de poder
    ingresar tanto en pesos ARS como en USD" en el campo Costo): moneda_carga
    YA NO se limpia acá en ninguno de los dos modos -- dejó de ser exclusiva
    de 'directo', ahora la usan los dos (ver su Column en app/models/
    product.py, comentario actualizado en esta misma fecha, y
    _costo_en_ars_expr en ese archivo, que es quien la usa para convertir
    "costo" a pesos en modo 'costo_utilidad')."""
    if producto.modo_precio == "costo_utilidad":
        producto.precio_carga = None
    else:
        producto.costo = None
        producto.costo_incluye_iva = None
        producto.utilidad_porcentaje = None


@router.get("/", response_model=list[ProductoRead])
def list_products(
    skip: Skip = 0,
    limit: Limit = 20,
    categoria_id: int | None = None,
    nombre: Annotated[str | None, Query(max_length=_MAX_LONGITUD_BUSQUEDA)] = None,
    marca: Annotated[str | None, Query(max_length=_MAX_LONGITUD_BUSQUEDA)] = None,
    # FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay control de
    # orden/precio" -- ver OrdenProductos más arriba y el order_by acá
    # abajo. "nuevo" es el default a propósito: mismo comportamiento de
    # siempre para quien no mande este parámetro (Home.jsx, por ejemplo,
    # sigue usando este mismo listado para "últimos ingresados" sin
    # enterarse de este cambio).
    orden: OrdenProductos = "nuevo",
    db: Session = Depends(get_db),
) -> list[Producto]:
    """Listado público: solo productos activos. No expone los dados de baja.

    nombre: búsqueda parcial, insensible a mayúsculas (ilike) -- pensado
    para la barra de búsqueda del navbar. Matchea tanto el nombre del
    producto como el nombre de su categoría (join contra Categoria), así
    que buscar "impresora" encuentra tanto un producto que se llame así
    como cualquier producto de la categoría "Impresoras" aunque su nombre
    no contenga esa palabra (ej. "Brother HL-1212W"). marca: coincidencia
    exacta a propósito -- se arma en el frontend a partir de un <select>
    con las marcas reales (ver GET /productos/marcas más abajo), no de
    texto libre, así que no hace falta (ni conviene) un ilike ahí.
    """
    # selectinload(Producto.categoria): ProductoRead expone la categoría
    # anidada completa (ver schemas/product.py) y Producto.categoria es
    # lazy="select" por default -- sin esto, cada producto del listado
    # dispara su propia query aparte para traer la categoría (N+1, hallazgo
    # #3 de la auditoría AppSec, 2026-08-23). Con esto, sea cual sea el
    # tamaño del listado, siempre son 2 queries en total (mismo criterio que
    # _pedido_query en router/orders.py).
    query = select(Producto).where(Producto.is_active.is_(True)).options(selectinload(Producto.categoria))
    if categoria_id is not None:
        query = query.where(Producto.categoria_id == categoria_id)
    if nombre:
        query = query.join(Categoria, Producto.categoria_id == Categoria.id).where(
            or_(Producto.nombre.ilike(f"%{nombre}%"), Categoria.nombre.ilike(f"%{nombre}%"))
        )
    if marca:
        query = query.where(Producto.marca == marca)
    # FIX (13/09/2026, auditoría UX/UI Punto Alto #11): antes esto era fijo
    # (siempre "más nuevo primero", sin forma de pedir otra cosa) -- ahora
    # son 4 ramas según "orden" (Literal validado arriba, no texto libre).
    # Producto.precio_venta es un column_property (ver app/models/product.py):
    # ya resuelve el precio final sea cual sea el modo_precio del producto
    # ('directo' o 'costo_utilidad', incluida la conversión USD->ARS con la
    # cotización vigente), así que ordenar por ese campo ordena por el
    # mismo precio que el cliente ve en la tarjeta, sin duplicar ninguna
    # cuenta acá. Producto.id desc como desempate en TODAS las ramas, mismo
    # criterio que ya tenía "nuevo": dos productos empatados (mismo precio,
    # mismo nombre) quedan en un orden estable entre pedidos, no uno que
    # cambie de página en página mientras el comprador navega con "Cargar
    # más" (ver Catalogo.jsx).
    if orden == "precio_asc":
        query = query.order_by(Producto.precio_venta.asc(), Producto.id.desc())
    elif orden == "precio_desc":
        query = query.order_by(Producto.precio_venta.desc(), Producto.id.desc())
    elif orden == "nombre":
        query = query.order_by(Producto.nombre.asc(), Producto.id.desc())
    else:
        # "nuevo" (default): más nuevo primero -- el Home de la tienda usa
        # este mismo listado para mostrar "los últimos productos
        # ingresados", así que el orden por defecto tiene que reflejar eso.
        # "Ingresado" no es solo created_at: un producto que se agotó y se
        # volvió a reabastecer (ver update_product) también cuenta como
        # recién ingresado, así que se ordena por el más reciente entre las
        # dos fechas. GREATEST ignora NULL (reabastecido_at arranca vacío)
        # en vez de "contagiarlo" al resultado -- es sintaxis de Postgres,
        # no portable a SQLite si algún día se usa para tests.
        ultimo_ingreso = func.greatest(Producto.created_at, Producto.reabastecido_at)
        query = query.order_by(ultimo_ingreso.desc(), Producto.id.desc())
    query = query.offset(skip).limit(limit)
    return list(db.execute(query).scalars())


@router.get("/marcas", response_model=list[str])
def list_brands(categoria_id: int | None = None, db: Session = Depends(get_db)) -> list[str]:
    """Marcas distintas entre los productos activos, para armar el <select>
    del filtro por marca sin inventar una lista aparte que se desincronice
    de lo que realmente hay cargado.

    categoria_id opcional: filtra a las marcas que existen dentro de esa
    categoría -- lo usa el mega menú del navbar (columna de marcas por
    categoría), que si no acotara por categoría terminaría mostrando todas
    las marcas de la tienda en cada categoría."""
    query = select(Producto.marca).where(Producto.is_active.is_(True))
    if categoria_id is not None:
        query = query.where(Producto.categoria_id == categoria_id)
    query = query.distinct().order_by(Producto.marca)
    return list(db.execute(query).scalars())


@router.get("/todos", response_model=list[ProductoAdminRead], dependencies=[Depends(require_admin)])
def list_all_products(
    skip: Skip = 0,
    limit: Limit = 20,
    categoria_id: int | None = None,
    nombre: Annotated[str | None, Query(max_length=_MAX_LONGITUD_BUSQUEDA)] = None,
    marca: Annotated[str | None, Query(max_length=_MAX_LONGITUD_BUSQUEDA)] = None,
    # FIX (13/09/2026, auditoría UX/UI Punto Crítico #3 -- "límite silencioso
    # de 100 registros sin paginación"): None = todos los estados (default,
    # mismo comportamiento que antes de este fix), True = solo activos,
    # False = solo dados de baja -- refleja el <select> "Todos los
    # estados"/"Dados de alta"/"Dados de baja" de Productos.jsx.
    activo: bool | None = None,
    db: Session = Depends(get_db),
) -> list[Producto]:
    """Listado admin: a diferencia de GET /productos/ (público, solo
    activos), este incluye también los productos dados de baja
    (is_active=False) -- lo usa Productos.jsx para poder mostrar el botón
    "Dar de alta" en los que están de baja (FEATURE 27/08/2026, pedido del
    cliente). Admin-only a propósito: un producto de baja no debería
    filtrarse a nadie que no sea quien lo administra.

    Declarado ANTES de GET /{producto_id} -- mismo motivo que /marcas y
    /favoritos más arriba: si quedara después, "/todos" matchearía ese path
    param como si "todos" fuera un producto_id.

    Mismo orden (último ingreso primero) que list_products.

    FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): nombre/marca/activo
    son nuevos -- antes Productos.jsx pedía limit=100 una sola vez y
    filtraba los 4 criterios de su barra de filtros en memoria; con la
    paginación real, ese filtrado en memoria solo vería la página actual, así
    que nombre/marca/estado (activo) pasan a resolverse acá, igual que ya
    hacía list_products más arriba para el catálogo público. categoria_id ya
    existía desde antes de este fix.

    FEATURE (11/09/2026, pedido del cliente): response_model pasa a
    ProductoAdminRead (antes ProductoRead) -- este listado alimenta
    directamente la tabla y el modal de edición de Productos.jsx, así que
    necesita el desglose de costo/IVA/utilidad/coeficiente para poder
    mostrarlo y editarlo sin un fetch aparte por producto. Ver
    ProductoAdminRead en app/schemas/product.py sobre por qué esto NO es lo
    mismo que exponerlo en el catálogo público (GET /productos/,
    /productos/{id}, sin cambios, siguen en ProductoRead a secas).
    """
    query = select(Producto).options(selectinload(Producto.categoria))
    if categoria_id is not None:
        query = query.where(Producto.categoria_id == categoria_id)
    # Mismo criterio que list_products: nombre matchea producto O categoría
    # (join solo cuando hace falta, para no pagar el join en el caso común
    # sin búsqueda); marca es coincidencia exacta (viene de un <select>, no
    # de texto libre).
    if nombre:
        query = query.join(Categoria, Producto.categoria_id == Categoria.id).where(
            or_(Producto.nombre.ilike(f"%{nombre}%"), Categoria.nombre.ilike(f"%{nombre}%"))
        )
    if marca:
        query = query.where(Producto.marca == marca)
    if activo is not None:
        query = query.where(Producto.is_active.is_(activo))
    ultimo_ingreso = func.greatest(Producto.created_at, Producto.reabastecido_at)
    query = query.order_by(ultimo_ingreso.desc(), Producto.id.desc()).offset(skip).limit(limit)
    return list(db.execute(query).scalars())


@router.get("/favoritos", response_model=list[FavoritoRead])
def list_favoritos(
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Favorito]:
    """Productos que el usuario autenticado marcó con la estrella de
    favorito (ver ProductoDetalle.jsx), más nuevo primero -- pensado para
    una futura pantalla de "Mis favoritos".

    Declarado ANTES de GET /{producto_id} a propósito (mismo motivo que
    /marcas más arriba): si quedara después, "/favoritos" matchearía ese
    path param como si "favoritos" fuera un producto_id y FastAPI
    respondería 422 (no es un int) en vez de este listado.

    selectinload trae el producto (y su categoría) en la misma tanda de
    queries -- mismo criterio anti-N+1 que list_products más arriba.
    """
    query = (
        select(Favorito)
        .where(Favorito.usuario_id == current_user.id)
        .options(selectinload(Favorito.producto).selectinload(Producto.categoria))
        .order_by(Favorito.created_at.desc())
    )
    return list(db.execute(query).scalars())


@router.get("/{producto_id}", response_model=ProductoRead)
def get_product(producto_id: int, db: Session = Depends(get_db)) -> Producto:
    """Detalle público: solo si está activo (un producto dado de baja
    responde 404, igual que uno inexistente, para no distinguir el caso)."""
    producto = db.execute(
        select(Producto)
        .where(Producto.id == producto_id, Producto.is_active.is_(True))
        .options(selectinload(Producto.categoria))
    ).scalar_one_or_none()
    if producto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    return producto


@router.get("/{producto_id}/favorito", response_model=FavoritoEstadoResponse)
def get_favorito_estado(
    producto_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Si el producto ya está marcado como favorito del usuario
    autenticado -- lo consulta ProductoDetalle.jsx al entrar a la pantalla
    para saber si pintar la estrella llena o vacía. Exige login (a
    diferencia de GET /{producto_id}): un favorito no tiene sentido sin
    saber de qué usuario es."""
    existe = db.execute(
        select(Favorito.id).where(Favorito.usuario_id == current_user.id, Favorito.producto_id == producto_id)
    ).scalar_one_or_none()
    return {"es_favorito": existe is not None}


@router.post(
    "/{producto_id}/favorito",
    response_model=FavoritoEstadoResponse,
    status_code=status.HTTP_201_CREATED,
)
def marcar_favorito(
    producto_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Marca un producto como favorito del usuario autenticado (clic en la
    estrella de ProductoDetalle.jsx). 404 si el producto no existe o está
    dado de baja -- mismo criterio que GET /{producto_id}, no distingue el
    caso. Idempotente: marcar dos veces el mismo producto no duplica la
    fila (UniqueConstraint de la tabla, ver app/models/favorite.py) ni
    devuelve error, simplemente confirma que ya quedó favorito."""
    producto_id_valido = db.execute(
        select(Producto.id).where(Producto.id == producto_id, Producto.is_active.is_(True))
    ).scalar_one_or_none()
    if producto_id_valido is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")

    ya_favorito = db.execute(
        select(Favorito.id).where(Favorito.usuario_id == current_user.id, Favorito.producto_id == producto_id)
    ).scalar_one_or_none()
    if ya_favorito is None:
        db.add(Favorito(usuario_id=current_user.id, producto_id=producto_id))
        try:
            db.commit()
        except IntegrityError:
            # Dos clics casi simultáneos (doble click, dos pestañas) podrían
            # llegar a intentar insertar la misma fila en paralelo -- el
            # UniqueConstraint de la tabla es la última palabra; esto solo
            # evita que ese caso puntual devuelva un 500 en vez de un
            # resultado igualmente válido (el producto termina favorito).
            db.rollback()
    return {"es_favorito": True}


@router.delete("/{producto_id}/favorito", response_model=FavoritoEstadoResponse)
def quitar_favorito(
    producto_id: int,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Saca un producto de los favoritos del usuario autenticado (segundo
    clic en la estrella). Idempotente en el otro sentido: sacar uno que ya
    no estaba tampoco es un error, simplemente confirma que no está."""
    db.execute(
        delete(Favorito).where(Favorito.usuario_id == current_user.id, Favorito.producto_id == producto_id)
    )
    db.commit()
    return {"es_favorito": False}


@router.get("/{producto_id}/relacionados", response_model=list[ProductoRead])
def list_productos_relacionados(producto_id: int, db: Session = Depends(get_db)) -> list[Producto]:
    """Productos vinculados a este (ver "También vas a necesitar" en
    ProductoDetalle.jsx) -- ej. el tóner y las hojas vinculados a una
    impresora. Público, igual que GET /{producto_id}: cualquiera puede ver
    la ficha de un producto sin sesión, así que también puede ver sus
    relacionados.

    El vínculo es bidireccional (ver ProductoRelacionado en
    app/models/product.py): busca filas donde este producto esté en
    CUALQUIERA de las dos columnas, y de cada fila se queda con "el otro"
    id -- no importa desde qué producto se cargó el vínculo originalmente.

    Solo devuelve relacionados activos: mismo criterio que el resto del
    catálogo, un producto dado de baja no debería aparecer sugerido en
    ningún lado aunque el vínculo siga existiendo en la base.
    """
    filas = db.execute(
        select(ProductoRelacionado).where(
            or_(ProductoRelacionado.producto_id_a == producto_id, ProductoRelacionado.producto_id_b == producto_id)
        )
    ).scalars()
    ids_relacionados = [
        fila.producto_id_b if fila.producto_id_a == producto_id else fila.producto_id_a for fila in filas
    ]
    if not ids_relacionados:
        return []
    query = (
        select(Producto)
        .where(Producto.id.in_(ids_relacionados), Producto.is_active.is_(True))
        .options(selectinload(Producto.categoria))
        .order_by(Producto.nombre)
    )
    return list(db.execute(query).scalars())


@router.post(
    "/{producto_id}/relacionados",
    response_model=ProductoRelacionadoEstadoResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def crear_producto_relacionado(
    producto_id: int, body: ProductoRelacionadoCreate, db: Session = Depends(get_db)
) -> dict:
    """Vincula dos productos entre sí (panel admin, formulario de
    Productos). Alcanza con cargarlo una vez desde cualquiera de los dos
    lados -- ver el comentario de ProductoRelacionado en
    app/models/product.py sobre el orden canónico (id más chico siempre en
    producto_id_a) que evita guardar el mismo par dos veces.

    Idempotente, mismo criterio que marcar_favorito más arriba: vincular
    dos veces el mismo par no duplica la fila (UniqueConstraint de la
    tabla) ni devuelve error.
    """
    otro_id = body.producto_relacionado_id
    if otro_id == producto_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Un producto no puede estar relacionado consigo mismo."
        )

    ids_validos = set(
        db.execute(select(Producto.id).where(Producto.id.in_((producto_id, otro_id)))).scalars()
    )
    if producto_id not in ids_validos or otro_id not in ids_validos:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")

    id_a, id_b = sorted((producto_id, otro_id))
    ya_existe = db.execute(
        select(ProductoRelacionado.id).where(
            ProductoRelacionado.producto_id_a == id_a, ProductoRelacionado.producto_id_b == id_b
        )
    ).scalar_one_or_none()
    if ya_existe is None:
        db.add(ProductoRelacionado(producto_id_a=id_a, producto_id_b=id_b))
        try:
            db.commit()
        except IntegrityError:
            # Mismo resguardo que marcar_favorito: dos clics casi
            # simultáneos podrían pisarse -- el UniqueConstraint es la
            # última palabra, esto solo evita un 500 en vez de un
            # resultado igualmente válido (el vínculo termina existiendo).
            db.rollback()
    return {"relacionado": True}


@router.delete(
    "/{producto_id}/relacionados/{otro_id}",
    response_model=ProductoRelacionadoEstadoResponse,
    dependencies=[Depends(require_admin)],
)
def eliminar_producto_relacionado(producto_id: int, otro_id: int, db: Session = Depends(get_db)) -> dict:
    """Desvincula dos productos (panel admin). Idempotente en el otro
    sentido, mismo criterio que quitar_favorito: desvincular un par que ya
    no estaba vinculado tampoco es un error."""
    id_a, id_b = sorted((producto_id, otro_id))
    db.execute(
        delete(ProductoRelacionado).where(
            ProductoRelacionado.producto_id_a == id_a, ProductoRelacionado.producto_id_b == id_b
        )
    )
    db.commit()
    return {"relacionado": False}


@router.post(
    "/imagenes",
    response_model=ImagenProductoResponse,
    dependencies=[Depends(require_admin)],
)
async def subir_imagen_producto(archivo: UploadFile = File(...)) -> dict:
    """Subir una imagen para usar como imagen_url de un producto.

    Reemplaza el flujo anterior de pegar una URL externa (hallazgo del
    dueño de la app: un link externo se puede romper o borrar sin aviso).
    El admin sube el archivo directo desde su computadora y esto devuelve
    la URL propia para mandar en imagen_url al crear/editar el producto.

    No confía en el nombre de archivo ni en el Content-Type que declara el
    navegador (los dos son fáciles de falsificar): abre el contenido real
    con Pillow para confirmar que es una imagen válida y para determinar el
    formato real, y genera un nombre de archivo propio (UUID) en vez de
    usar el que mandó el cliente -- evita tanto colisiones entre productos
    distintos como un path traversal armado a propósito en el nombre.
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
    (STORAGE_PRODUCTOS_DIR / nombre_archivo).write_bytes(contenido)

    # FIX B-03 (auditoría QA+Seguridad 28/08/2026): antes acá se armaba la
    # URL absoluta con request.base_url ("http://<host-de-ese-momento>:8000/
    # static/productos/...") y esa URL quedaba guardada tal cual en
    # producto.imagen_url. El problema: ese host queda fijo para siempre,
    # así que la imagen se rompe apenas la base de datos se usa desde otra
    # máquina, otro puerto, o detrás de un dominio distinto (le pasó
    # literalmente al cliente probando en WSL con una base de datos que
    # venía de Windows). Ahora se devuelve sólo la RUTA relativa
    # ("/static/productos/<archivo>"); quien arma la URL completa para
    # mostrarla es el frontend, contra la API que esté usando en cada
    # momento (ver utils/imagenes.js, resolverUrlImagen). request no se usa
    # más acá, pero se deja el parámetro por si en el futuro hiciera falta
    # loguear el host de origen de la subida.
    url = f"/static/productos/{nombre_archivo}"
    return {"url": url}


@router.post(
    "/",
    response_model=ProductoAdminRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_product(body: ProductoCreate, db: Session = Depends(get_db)) -> Producto:
    """FEATURE (11/09/2026, pedido del cliente): response_model pasa a
    ProductoAdminRead (antes ProductoRead) -- ver el comentario grande en
    list_all_products más arriba sobre el porqué. ProductoCreate ya validó
    (ver _validar_campos_segun_modo_precio en schemas/product.py) que
    vengan completos los campos del modo de precio elegido; acá solo hace
    falta limpiar a NULL los del OTRO modo (_normalizar_campos_segun_modo_
    precio más arriba en este archivo) -- en un alta nueva, si modo_precio
    es 'directo', ProductoCreate no expone costo/costo_incluye_iva/
    utilidad_porcentaje así que ya llegan en None; si es 'costo_utilidad',
    moneda_carga sí trae su default ("USD") aunque no se vaya a usar, y
    ESO es lo que necesita limpiarse."""
    if db.get(Categoria, body.categoria_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="categoria_id no existe.")

    producto = Producto(**body.model_dump())
    _normalizar_campos_segun_modo_precio(producto)
    db.add(producto)
    try:
        db.commit()
    except IntegrityError:
        # Ya no hay un SKU único que pueda chocar acá -- esto queda como
        # resguardo genérico (p.ej. una categoría borrada justo entre el
        # chequeo de arriba y este commit).
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se pudo guardar el producto.")
    db.refresh(producto)
    return producto


@router.patch("/{producto_id}", response_model=ProductoAdminRead)
def update_product(
    producto_id: int,
    body: ProductoUpdate,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Producto:
    """Edición admin. Busca por id sin filtrar is_active: un admin también
    tiene que poder reactivar (is_active=True) un producto dado de baja.

    FEATURE (27/08/2026, pedido del cliente): confirmar con la contraseña
    del admin logueado antes de aplicar un cambio real -- ver
    verificar_password_admin en app/dependencies/auth.py. Se exige SIEMPRE
    que se esté tocando algo más que "stock": ConfiguracionStock.jsx pega
    contra este mismo endpoint para actualizaciones rápidas y frecuentes de
    stock nada más (ver el comentario en ese archivo), y pedir contraseña en
    cada fila rompería el sentido de esa pantalla. Cualquier otro campo --
    incluido reactivar (is_active=True) -- sí la exige.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026):
    confirmar_password_admin_rate_limiter se llama A MANO acá adentro (no
    como dependencies=[] del decorador) y solo dentro de este bloque --
    justo porque la contraseña acá es opcional (ver el párrafo de arriba).
    Si fuera dependencies=[] del decorador, contaría también los updates de
    stock sueltos de ConfiguracionStock.jsx, que no tienen nada que ver con
    esto y son frecuentes -- terminaría bloqueando ese uso legítimo. Ver el
    comentario grande en app/core/rate_limit.py.
    """
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")

    changes = body.model_dump(exclude_unset=True)
    password_actual = changes.pop("password_actual", None)
    if changes.keys() - {"stock"}:
        if not password_actual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Falta confirmar con tu contraseña.",
            )
        confirmar_password_admin_rate_limiter(request)
        verificar_password_admin(password_actual, admin_actual, request)

    if "categoria_id" in changes and db.get(Categoria, changes["categoria_id"]) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="categoria_id no existe.")

    # FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
    # coeficiente" -- ProductoUpdate es un PATCH parcial (puede traer
    # cualquier subconjunto de campos), así que a diferencia de
    # ProductoCreate (que valida esto con un solo @model_validator, ver
    # schemas/product.py) acá hace falta el valor EFECTIVO de modo_precio y
    # de cada campo que ese modo exige -- lo que cambia en este body más lo
    # que el producto ya tenía guardado -- antes de poder decidir si falta
    # algo. Mismo criterio que tipo_documento/numero_documento/
    # condicion_iva en admin_update_user (router/users.py), mismo motivo.
    modo_precio_efectivo = changes.get("modo_precio", producto.modo_precio)
    if modo_precio_efectivo == "costo_utilidad":
        campos_requeridos = {
            "costo": changes.get("costo", producto.costo),
            "costo_incluye_iva": changes.get("costo_incluye_iva", producto.costo_incluye_iva),
            "utilidad_porcentaje": changes.get("utilidad_porcentaje", producto.utilidad_porcentaje),
            # FIX (13/09/2026, pedido del cliente -- "agregar la función de
            # poder ingresar tanto en pesos ARS como en USD" en 'Costo'):
            # moneda_carga ahora hace falta también en este modo (ver el
            # CheckConstraint ck_productos_campos_segun_modo_precio en
            # app/models/product.py, que a partir de esta fecha la exige acá
            # también) -- mismo criterio que precio_carga más abajo para el
            # modo 'directo'.
            "moneda_carga": changes.get("moneda_carga", producto.moneda_carga),
        }
    else:
        campos_requeridos = {"precio_carga": changes.get("precio_carga", producto.precio_carga)}
    faltantes = [nombre for nombre, valor in campos_requeridos.items() if valor is None]
    if faltantes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Con modo_precio '{modo_precio_efectivo}' hacen falta: {', '.join(faltantes)}.",
        )

    # Reabastecido = pasa de sin stock a con stock. Se fija ANTES de aplicar
    # los cambios de más abajo (ahí se pisa producto.stock) y se compara
    # contra el valor viejo -- no alcanza con "llega stock en el body", tiene
    # que venir realmente de 0 (si ya tenía stock y el admin lo corrige de
    # 8 a 10, eso no es un reingreso). Ver reabastecido_at en models/product.py.
    if "stock" in changes and producto.stock == 0 and changes["stock"] > 0:
        producto.reabastecido_at = datetime.now(timezone.utc)

    for field, value in changes.items():
        setattr(producto, field, value)

    # FEATURE (11/09/2026, pedido del cliente): limpia a NULL el juego de
    # campos del modo de precio que ya NO corresponde (ver el docstring de
    # _normalizar_campos_segun_modo_precio más arriba) -- DESPUÉS del
    # setattr, así producto.modo_precio ya refleja el valor nuevo si vino
    # en este PATCH.
    _normalizar_campos_segun_modo_precio(producto)

    try:
        db.commit()
    except IntegrityError:
        # Mismo resguardo genérico que en create_product (ver comentario ahí).
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se pudo guardar el producto.")
    db.refresh(producto)
    return producto


@router.delete(
    "/{producto_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(confirmar_password_admin_rate_limiter)],
)
def deactivate_product(
    producto_id: int,
    confirmacion: ConfirmacionPassword,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    """Baja lógica (is_active=False), nunca DELETE físico: un producto puede
    estar referenciado por pedidos ya existentes (PedidoDetalle.producto_id
    no tiene ondelete=CASCADE a propósito) y borrarlo de verdad rompería el
    historial de compras.

    FEATURE (27/08/2026, pedido del cliente): exige la contraseña del admin
    logueado antes de dar de baja -- ver verificar_password_admin en
    app/dependencies/auth.py.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026): acá
    la contraseña SIEMPRE es obligatoria (todo el body es
    ConfirmacionPassword), así que el rate limiter va como dependencies=[]
    del decorador -- ver el comentario grande en app/core/rate_limit.py.
    """
    verificar_password_admin(confirmacion.password_actual, admin_actual, request)
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    producto.is_active = False
    db.commit()
    return None
