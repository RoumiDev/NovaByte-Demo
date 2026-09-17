"""Dependencias reutilizables para proteger endpoints con access tokens."""

import logging

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth.security import ACCESS_TOKEN_TYPE, decode_token, verify_password
from app.core.database import get_db
from app.models.user import Usuario


# Mantener esta URL alineada con la futura ruta de login publicada por main.py.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

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
    return user


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
