"""Funciones de contraseña y JWT usadas por autenticación."""

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import (
    ACCESS_TOKEN_LIFETIME_MINUTES,
    ALGORITHM,
    REFRESH_TOKEN_LIFETIME_MINUTES,
    SECRET_KEY,
)
from app.models.user import RefreshTokenModel, Usuario


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Comparar la contraseña ingresada contra el hash almacenado."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generar el hash bcrypt que se debe guardar en la base de datos."""
    return pwd_context.hash(password)


def _create_token(user: Usuario, token_type: str, lifetime_minutes: int) -> tuple[str, str, datetime]:
    """Crear un JWT y devolver también su jti y vencimiento para persistir refresh tokens."""
    if not user.id or not user.email:
        raise ValueError("El usuario debe estar persistido y tener email antes de crear un token.")

    now = datetime.now(timezone.utc)
    issued_at = int(now.timestamp())
    expires_at = int(
        (now + timedelta(minutes=lifetime_minutes)).timestamp()
    )
    token_id = token_urlsafe(24)
    claims = {
        "sub": user.email,
        "uid": user.id,
        "type": token_type,
        "iat": issued_at,
        "last_activity_at": issued_at,
        "exp": expires_at,
        "jti": token_id,
        # FEATURE (17/09/2026, pedido del cliente): "accesos temporales a
        # la demo, aislados entre visitantes" -- viaja en el token para que
        # get_tenant_scope (app/dependencies/auth.py) pueda filtrar sin una
        # consulta aparte. None para toda cuenta real (el caso de siempre).
        # A propósito NO va en required_claims de decode_token más abajo:
        # a diferencia del resto de los claims, None es un valor válido
        # acá (no "faltante"), así que exigirlo con el mismo chequeo
        # truthy que los demás rechazaría de punta cualquier token de una
        # cuenta real.
        "tenant_id": user.tenant_id,
    }
    return jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM), token_id, datetime.fromtimestamp(
        expires_at, timezone.utc
    )


def create_access_token(user: Usuario) -> str:
    """Crear el token que autoriza llamadas normales a la API.

    Vida corta e independiente del refresh token (ver hallazgo H-01 del informe de
    auditoría): al no ser revocable individualmente, debe expirar rápido.
    """
    token, _, _ = _create_token(user, ACCESS_TOKEN_TYPE, ACCESS_TOKEN_LIFETIME_MINUTES)
    return token


def create_refresh_token(user: Usuario) -> tuple[str, str, datetime]:
    """Crear el refresh token cuyo jti se guardará en la base de datos."""
    return _create_token(user, REFRESH_TOKEN_TYPE, REFRESH_TOKEN_LIFETIME_MINUTES)


def create_token_pair(db: Session, user: Usuario) -> dict[str, str]:
    """Crear tokens y registrar el refresh token dentro de la transacción actual."""
    refresh_token, refresh_jti, refresh_expires_at = create_refresh_token(user)
    # No hacer commit aquí: el endpoint decide si confirma o revierte toda la operación.
    db.add(
        RefreshTokenModel(
            jti=refresh_jti,
            usuario_id=user.id,
            expires_at=refresh_expires_at,
        )
    )
    return {
        "access_token": create_access_token(user),
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


def decode_token(token: str, expected_type: str) -> Optional[dict[str, Any]]:
    """Validar firma, expiración, claims obligatorios y tipo de un JWT."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None

    required_claims = ("sub", "uid", "type", "iat", "last_activity_at", "exp", "jti")
    if any(not payload.get(claim) for claim in required_claims):
        return None
    if (
        not isinstance(payload["sub"], str)
        or not isinstance(payload["uid"], int)
        or payload["uid"] <= 0
        or payload["type"] != expected_type
    ):
        return None
    return payload


def revoke_refresh_token(db: Session, usuario_id: int, jti: str) -> None:
    """Revocar puntualmente un refresh token conocido (usado por /auth/logout).

    No hace commit: el endpoint que la invoca decide cuándo confirmar la transacción.
    """
    db.execute(
        update(RefreshTokenModel)
        .where(
            RefreshTokenModel.usuario_id == usuario_id,
            RefreshTokenModel.jti == jti,
            RefreshTokenModel.revocado.is_(False),
        )
        .values(revocado=True, revoked_at=datetime.now(timezone.utc))
    )


def revoke_all_refresh_tokens(db: Session, usuario_id: int) -> None:
    """Revocar todos los refresh tokens activos de un usuario.

    Respuesta de contención ante la reutilización detectada de un refresh token ya
    consumido (posible robo de sesión): ver hallazgo H-03 del informe de auditoría.
    No hace commit: el endpoint que la invoca decide cuándo confirmar la transacción.
    """
    db.execute(
        update(RefreshTokenModel)
        .where(
            RefreshTokenModel.usuario_id == usuario_id,
            RefreshTokenModel.revocado.is_(False),
        )
        .values(revocado=True, revoked_at=datetime.now(timezone.utc))
    )