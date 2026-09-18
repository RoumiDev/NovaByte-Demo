"""Dependencias reutilizables para proteger endpoints con access tokens."""

import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import ACCESS_TOKEN_TYPE, decode_token, verify_password
from app.core.database import get_db
from app.models.demo import DemoTenant
from app.models.user import Usuario


# Mantener esta URL alineada con la futura ruta de login publicada por main.py.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# FEATURE (17/09/2026, pedido del cliente): "accesos temporales a la demo"
# -- variante de oauth2_scheme con auto_error=False, para los endpoints
# PÚBLICOS del catálogo (list_products/get_product/etc. en
# app/router/products.py y app/router/categories.py) que necesitan seguir
# funcionando sin sesión (un visitante anónimo de siempre), pero que
# también deben mostrar el catálogo del TENANT correcto cuando quien
# pregunta sí está logueado como un admin demo -- ver get_tenant_scope_opcional
# más abajo. oauth2_scheme (arriba) sigue igual, sin tocar, para todo
# endpoint que YA exigía sesión.
_oauth2_scheme_opcional = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026): logger
# dedicado para los intentos fallidos de verificar_password_admin más abajo
# -- antes no quedaba ningún rastro de cuántas veces se probó una contraseña
# incorrecta contra ese control.
logger = logging.getLogger(__name__)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    """Devolver el usuario activo de un access token; nunca aceptar refresh tokens."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales de acceso",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token, ACCESS_TOKEN_TYPE)
    if payload is None:
        raise credentials_exception

    # Consultar la base impide usar tokens emitidos antes de desactivar o borrar una cuenta.
    user = db.get(Usuario, payload["uid"])
    if user is None or not user.is_active or user.email != payload["sub"]:
        raise credentials_exception

    # FEATURE (17/09/2026, pedido del cliente): "accesos temporales a la
    # demo" -- si esta cuenta pertenece a un tenant demo (ver
    # app/models/demo.py) que ya venció, corta el acceso ACÁ, en cada
    # request, sin esperar a que el borrado físico del tenant (limpieza
    # diaria, ver app/router/demo.py) haya corrido -- en el plan Hobby de
    # Vercel ese cron sólo puede correr una vez por día, así que sin este
    # chequeo un acceso vencido seguiría funcionando hasta 24hs más. Se
    # consulta DemoTenant en vez de comparar contra algo ya en el JWT
    # porque expires_at puede cambiar (o el tenant puede borrarse) después
    # de emitido el token, y ese token sigue siendo válido por sí mismo
    # hasta ACCESS_TOKEN_EXPIRE_MINUTES -- este chequeo es lo que hace que
    # la expiración del tenant pese más que la del token.
    if user.tenant_id is not None:
        tenant_vencido = db.execute(
            select(DemoTenant.id).where(
                DemoTenant.id == user.tenant_id,
                DemoTenant.expires_at <= datetime.now(timezone.utc),
            )
        ).scalar_one_or_none()
        if tenant_vencido is not None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El acceso temporal a la demo venció.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    return user


def get_current_user_opcional(
    token: str | None = Depends(_oauth2_scheme_opcional),
    db: Session = Depends(get_db),
) -> Usuario | None:
    """Igual que get_current_user, pero devuelve None en vez de un 401
    cuando no hay token (o es inválido/expiró) -- para endpoints PÚBLICOS
    que siguen funcionando sin sesión, pero que igual quieren saber quién
    pregunta cuando sí la hay (ver get_tenant_scope_opcional más abajo).
    Nunca usar en un endpoint que exige login -- ahí sigue correspondiendo
    get_current_user a secas, que si rechaza el token corta el request con
    un 401 real."""
    if token is None:
        return None
    try:
        return get_current_user(token=token, db=db)
    except HTTPException:
        return None


def get_tenant_scope_opcional(current_user: Usuario | None = Depends(get_current_user_opcional)) -> int | None:
    """Mismo significado que get_tenant_scope (None = tienda real, un id =
    sólo ese tenant demo), pero para endpoints PÚBLICOS del catálogo (ver
    list_products/get_product/list_brands en app/router/products.py y sus
    equivalentes en app/router/categories.py): un visitante anónimo (sin
    login) siempre ve la tienda real -- None --; un admin demo que SÍ está
    logueado, en cambio, ve el catálogo de SU tenant en vez del real,
    incluso en estas rutas que no exigen sesión -- así puede recorrer
    también la vidriera pública de la demo (Home, Catálogo, ficha de
    producto) con lo que él mismo fue cargando, no con el catálogo real de
    la tienda mezclado en el medio."""
    return current_user.tenant_id if current_user is not None else None


def get_tenant_scope(current_user: Usuario = Depends(get_current_user)) -> int | None:
    """El tenant a usar para filtrar productos/categorías/pedidos en
    cualquier endpoint autenticado -- None significa "tienda real" (una
    cuenta de siempre); un id puntual significa "sólo lo de ESE tenant
    demo" (ver app/models/demo.py). Usar esta dependencia -- en vez de leer
    current_user.tenant_id directo en cada router -- deja un único lugar
    donde describir qué significa el valor, y deja explícito en la firma
    de cada endpoint que ese filtro es intencional, no un descuido.

    Para endpoints PÚBLICOS (sin login, ej. GET /productos/, catálogo
    anónimo) esta dependencia no aplica -- ahí se filtra directo por
    Producto.tenant_id.is_(None)/Categoria.tenant_id.is_(None), fijo,
    porque un visitante anónimo (sin sesión, sin forma de tener un tenant)
    sólo debe ver la tienda real."""
    return current_user.tenant_id


def bloquear_en_demo(current_user: Usuario = Depends(get_current_user)) -> None:
    """Bloquea por completo un endpoint para una cuenta de un tenant demo
    (ver app/models/demo.py) -- pensado para endpoints que tocan datos
    GLOBALES o compartidos entre TODOS los tenants: usuarios reales,
    pedidos de TODOS los usuarios, configuración de la tienda, marcas
    destacadas. Dejar pasar acá a un visitante de la demo filtraría datos
    reales de otras personas, o le permitiría corromper configuración
    compartida por todos los tenants (incluida la tienda real).

    Se usa JUNTO a require_admin/require_admin_o_ayudante (una dependencia
    más en la lista), nunca en su lugar: este chequeo no reemplaza el
    control de rol, sólo agrega el de tenant."""
    if current_user.tenant_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta acción no está disponible en el modo demo.",
        )


def require_admin(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Exigir además que el usuario autenticado tenga rol de administrador.

    El rol se verifica siempre en backend contra el registro de la base de datos
    (nunca contra un valor enviado por el cliente): usar esta dependencia, en lugar
    de get_current_user, en cualquier endpoint administrativo futuro (hallazgo H-09
    del informe de auditoría).
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador",
        )
    return current_user


def require_admin_o_ayudante(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Exigir rol de staff (admin o ayudante).

    Pensado para lo que hoy ya puede hacer un ayudante -- por ahora, solo
    ver todos los pedidos (GET /pedidos/todos). Mismo criterio que
    require_admin: el rol se verifica siempre contra el registro de la
    base, nunca contra un valor enviado por el cliente.
    """
    if current_user.role not in ("admin", "ayudante"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador o ayudante",
        )
    return current_user


def verificar_password_admin(password: str, admin: Usuario, request: Request) -> None:
    """Confirmar la contraseña del admin autenticado antes de una acción
    sensible (editar o dar de baja un producto/categoría, vaciar una marca
    destacada, cambiar el rol o activar/desactivar un usuario -- ver
    router/products.py, router/categories.py, router/store.py y
    router/users.py) -- FEATURE (27/08/2026, pedido del cliente).

    Ojo: esto NO es control de acceso -- eso ya lo hace require_admin, que
    corre antes en cualquier endpoint que use esta función. Es una
    re-confirmación tipo "sudo" para frenar un cambio hecho sin querer, o
    una sesión dejada abierta en una computadora compartida.

    403 (no 401) a propósito: el interceptor de axios del frontend
    (api/client.js) reintenta automáticamente cualquier 401 refrescando la
    sesión, pensando que el access token expiró -- una contraseña de
    confirmación incorrecta no tiene nada que ver con eso, y devolver 401
    acá terminaría gastando un refresh de sesión (o, en el peor caso, si
    ese refresh fallara, cerrando la sesión) solo porque el admin se
    equivocó al tipear.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026 --
    "Falta de rate limiting y de logging de auditoría en la confirmación de
    contraseña ('sudo')..."): cada intento fallido queda registrado acá
    (logger.warning, con el id/email del admin y la IP del request) -- antes
    no quedaba ningún rastro de cuántas veces se probó una contraseña
    incorrecta. `request` se agrega a la firma solo para esto -- el rate
    limiting en sí (límite de intentos) NO vive acá adentro, cada endpoint
    que llama a esta función es responsable de aplicar
    confirmar_password_admin_rate_limiter (app/core/rate_limit.py) de la
    forma que le corresponda -- ver el comentario grande en ese archivo
    sobre por qué varía según el endpoint.
    """
    if not verify_password(password, admin.password_hash):
        client_ip = request.client.host if request.client else "desconocido"
        logger.warning(
            "Confirmación de contraseña admin fallida -- admin_id=%s email=%s ip=%s",
            admin.id,
            admin.email,
            client_ip,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Contraseña incorrecta.")
