"""Endpoints de autenticación: login y renovación de sesión JWT."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.security import (
    REFRESH_TOKEN_TYPE,
    create_token_pair,
    decode_token,
    get_password_hash,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    verify_password,
)
from app.core.config import (
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_PATH,
    REFRESH_COOKIE_SAMESITE,
    REFRESH_COOKIE_SECURE,
    REFRESH_TOKEN_LIFETIME_MINUTES,
)
from app.core.database import get_db
from app.core.rate_limit import login_rate_limiter
from app.models.user import RefreshTokenModel, Usuario
from app.schemas.auth import TokenResponse


router = APIRouter()

# Hash "señuelo" calculado una sola vez al importar el módulo: al verificarlo
# incluso cuando el email no existe, el tiempo de respuesta de /login no
# delata si una cuenta existe o no (evita enumeración de usuarios por timing).
_DUMMY_PASSWORD_HASH = get_password_hash("marcador-sin-usuario-valido-0000000000")


def _setear_cookie_refresh(response: Response, refresh_token: str) -> None:
    """Mandar el refresh token exclusivamente por cookie httpOnly (hallazgo ALTA,
    auditoría AppSec 2026-08-23): ya no viaja en el cuerpo JSON de ninguna
    respuesta (ver TokenResponse en app/schemas/auth.py), así queda
    inalcanzable para JavaScript del frontend (mitiga robo por XSS).

    Si el día de mañana hay que cambiar nombre/path/samesite de esta cookie,
    tocar también REFRESH_COOKIE_* en app/core/config.py y mantener
    _borrar_cookie_refresh (más abajo) con los mismos valores -- delete_cookie
    solo pisa la cookie si coincide el path/samesite con los que se usaron acá.
    """
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=REFRESH_COOKIE_SECURE,
        samesite=REFRESH_COOKIE_SAMESITE,
        path=REFRESH_COOKIE_PATH,
        max_age=REFRESH_TOKEN_LIFETIME_MINUTES * 60,
    )


def _borrar_cookie_refresh(response: Response) -> None:
    """Instruir al navegador a descartar la cookie de refresh (logout y ante
    cualquier intento de refresh/activity rechazado -- ver _rotate_refresh_token)."""
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        samesite=REFRESH_COOKIE_SAMESITE,
    )


def _credentials_exception() -> HTTPException:
    """Crear una respuesta genérica para no revelar si un token existía o fue reutilizado."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh token inválido, expirado o reutilizado",
    )


def _leer_refresh_token(request: Request) -> str:
    """Obtener el refresh token únicamente de la cookie httpOnly.

    A propósito NO se acepta por body/query/header: si en el futuro alguien
    agrega un fallback "por las dudas" a otra fuente, reintroduciría la
    exposición que este cambio vino a cerrar (hallazgo ALTA, ver arriba).
    """
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise _credentials_exception()
    return token


@router.post("/login", response_model=TokenResponse)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
    _rate_limit: None = Depends(login_rate_limiter),
) -> dict[str, str]:
    """Emitir un par de tokens a partir de email (username) y contraseña.

    Usa el formulario estándar OAuth2 (application/x-www-form-urlencoded,
    campos "username"/"password") para ser compatible con oauth2_scheme y con
    el botón "Authorize" de la documentación interactiva.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Email o contraseña incorrectos",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = db.execute(
        select(Usuario).where(Usuario.email == form_data.username.strip().lower())
    ).scalar_one_or_none()

    # Siempre se verifica un hash (real o el señuelo) para no delatar por
    # tiempo de respuesta si el email existe o no en la base.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_is_valid = verify_password(form_data.password, password_hash)

    if user is None or not user.is_active or not password_is_valid:
        raise credentials_exception

    token_pair = create_token_pair(db, user)
    db.commit()
    # response_model=TokenResponse filtra "refresh_token" del JSON: acá solo
    # se usa para armar la cookie, nunca llega al cuerpo de la respuesta.
    _setear_cookie_refresh(response, token_pair["refresh_token"])
    return token_pair


def _rotate_refresh_token(
    refresh_token_value: str,
    db: Session,
    response: Response,
) -> dict[str, str]:
    """Consumir una sola vez un refresh token y emitir un nuevo par de sesión.

    Ante CUALQUIER rechazo (token inválido, expirado, reutilizado, o de un
    usuario ya inactivo) se borra la cookie del navegador: al ser httpOnly,
    el frontend no puede limpiarla por su cuenta con JavaScript, así que si
    esta función no lo hace, una cookie ya inservible quedaría reenviándose
    en cada request a /api/v1/auth indefinidamente.
    """
    payload = decode_token(refresh_token_value, REFRESH_TOKEN_TYPE)
    if payload is None:
        _borrar_cookie_refresh(response)
        raise _credentials_exception()

    user = db.get(Usuario, payload["uid"])
    if user is None or not user.is_active or user.email != payload["sub"]:
        _borrar_cookie_refresh(response)
        raise _credentials_exception()

    # Este UPDATE atómico permite que solo una solicitud consuma el mismo jti.
    result = db.execute(
        update(RefreshTokenModel)
        .where(
            RefreshTokenModel.jti == payload["jti"],
            RefreshTokenModel.usuario_id == user.id,
            RefreshTokenModel.revocado.is_(False),
            RefreshTokenModel.expires_at > datetime.now(timezone.utc),
        )
        .values(revocado=True, revoked_at=datetime.now(timezone.utc))
    )
    if result.rowcount != 1:
        db.rollback()

        # Si el jti ya estaba marcado como revocado, alguien reutilizó un refresh
        # token ya consumido: señal típica de robo de sesión. Ante esa duda,
        # revocamos todas las sesiones activas del usuario (hallazgo H-03).
        existing = db.execute(
            select(RefreshTokenModel).where(
                RefreshTokenModel.jti == payload["jti"],
                RefreshTokenModel.usuario_id == user.id,
            )
        ).scalar_one_or_none()
        if existing is not None and existing.revocado:
            revoke_all_refresh_tokens(db, user.id)
            db.commit()

        _borrar_cookie_refresh(response)
        raise _credentials_exception()

    try:
        # El refresh usado queda revocado y el nuevo queda persistido en el mismo commit.
        token_pair = create_token_pair(db, user)
        db.commit()
    except Exception:
        db.rollback()
        raise

    _setear_cookie_refresh(response, token_pair["refresh_token"])
    return token_pair


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Renovar manualmente una sesión con el refresh token todavía vigente de la cookie."""
    refresh_token_value = _leer_refresh_token(request)
    return _rotate_refresh_token(refresh_token_value, db, response)


@router.post("/activity", response_model=TokenResponse)
def renew_session_after_activity(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Renovar tras actividad real del frontend, rotando también el refresh token."""
    # El backend no observa scrolls: el frontend debe llamar esta ruta solo tras una interacción.
    refresh_token_value = _leer_refresh_token(request)
    return _rotate_refresh_token(refresh_token_value, db, response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    """Cerrar sesión revocando el refresh token de la cookie (hallazgo H-04) y borrándola.

    Responde 204 exista o no cookie, válida o no, para no filtrar información
    sobre sesiones ajenas; simplemente no queda nada por revocar si no existía.
    """
    refresh_token_value = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token_value:
        payload = decode_token(refresh_token_value, REFRESH_TOKEN_TYPE)
        if payload is not None:
            revoke_refresh_token(db, payload["uid"], payload["jti"])
            db.commit()
    _borrar_cookie_refresh(response)
    return None
