"""Contratos de entrada y salida para los endpoints de autenticación."""

from pydantic import BaseModel


class TokenResponse(BaseModel):
    """Respuesta de /auth/login, /auth/refresh y /auth/activity.

    Ya NO incluye refresh_token (hallazgo ALTA de la auditoría AppSec,
    2026-08-23, parte backend): ese token viaja exclusivamente por una
    cookie httpOnly que arma el router (ver _setear_cookie_refresh en
    app/router/auth.py), nunca en el cuerpo JSON -- así queda inalcanzable
    para JavaScript (y para un eventual XSS) del lado del frontend.
    """

    access_token: str
    token_type: str = "bearer"
