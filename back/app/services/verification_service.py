"""Generar y validar los códigos de 6 dígitos de un solo uso (verificar
mail, recuperar contraseña, cambiar de email) -- la lógica compartida entre
esos flujos vive acá para no duplicarla en cada endpoint de router/users.py."""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.security import get_password_hash, verify_password
from app.core.config import CODIGO_VERIFICACION_LIFETIME_MINUTES
from app.models.user import CodigoVerificacion, PropositoCodigo, Usuario

# Tras esta cantidad de intentos fallidos contra UN código puntual, se
# invalida (usado=True) aunque todavía no haya expirado -- sin esto, el
# rate limiter por IP (ver core/rate_limit.py) sería la única defensa
# contra probar las 1.000.000 de combinaciones de un PIN de 6 dígitos, y
# alcanzaría con repartir los intentos entre varias IPs para esquivarlo.
_INTENTOS_MAXIMOS = 5


def _generar_codigo() -> str:
    """6 dígitos, con ceros a la izquierda si hace falta (ej. "004821").
    secrets.randbelow (no random.randint) porque es criptográficamente
    seguro -- este código es, ni más ni menos, una contraseña temporal."""
    return f"{secrets.randbelow(1_000_000):06d}"


def crear_codigo(
    db: Session,
    usuario: Usuario,
    proposito: PropositoCodigo,
    *,
    email_nuevo: Optional[str] = None,
) -> str:
    """Invalida cualquier código previo sin usar del mismo propósito (evita
    que queden varios códigos "vivos" al mismo tiempo para la misma acción
    -- solo el último pedido debe servir) y crea uno nuevo.

    email_nuevo solo se usa (y solo tiene sentido) para
    PropositoCodigo.cambiar_email: la dirección que se va a confirmar si el
    código resulta válido, ver CodigoVerificacion.email_nuevo en el modelo.

    Devuelve el código EN TEXTO PLANO (para mandarlo por mail) -- lo único
    que se persiste es su hash (ver CodigoVerificacion.codigo_hash), nunca
    el valor real: si la base se filtrara, no debería alcanzar para
    generar códigos válidos.

    No hace commit: quien llama decide cuándo confirmar la transacción
    (junto con cualquier otro cambio, ej. crear el usuario en el registro).
    """
    db.execute(
        update(CodigoVerificacion)
        .where(
            CodigoVerificacion.usuario_id == usuario.id,
            CodigoVerificacion.proposito == proposito,
            CodigoVerificacion.usado.is_(False),
        )
        .values(usado=True)
    )

    codigo = _generar_codigo()
    db.add(
        CodigoVerificacion(
            usuario_id=usuario.id,
            proposito=proposito,
            codigo_hash=get_password_hash(codigo),
            email_nuevo=email_nuevo,
            expira_at=datetime.now(timezone.utc) + timedelta(minutes=CODIGO_VERIFICACION_LIFETIME_MINUTES),
        )
    )
    return codigo


def _validar_y_consumir(
    db: Session, usuario: Usuario, proposito: PropositoCodigo, codigo_ingresado: str
) -> Optional[CodigoVerificacion]:
    """Busca el código vigente más reciente de ESE usuario y propósito, y si
    codigo_ingresado matchea lo marca usado y lo devuelve -- si no matchea
    (o no hay ninguno vigente), devuelve None.

    Al fallar, cuenta el intento contra ese código puntual (ver
    _INTENTOS_MAXIMOS más arriba) -- no hace falta que quien llama haga
    nada más para que esa protección funcione. Tampoco hace commit acá:
    quien llama decide cuándo confirmar (junto con aplicar el efecto real
    -- email_verificado=True, nueva contraseña, nuevo email, etc.).
    """
    fila = (
        db.execute(
            select(CodigoVerificacion)
            .where(
                CodigoVerificacion.usuario_id == usuario.id,
                CodigoVerificacion.proposito == proposito,
                CodigoVerificacion.usado.is_(False),
                CodigoVerificacion.expira_at > datetime.now(timezone.utc),
            )
            .order_by(CodigoVerificacion.id.desc())
        )
        .scalars()
        .first()
    )

    if fila is None:
        return None

    if not verify_password(codigo_ingresado, fila.codigo_hash):
        fila.intentos += 1
        if fila.intentos >= _INTENTOS_MAXIMOS:
            fila.usado = True
        return None

    fila.usado = True
    return fila


def validar_codigo(db: Session, usuario: Usuario, proposito: PropositoCodigo, codigo_ingresado: str) -> bool:
    """Como _validar_y_consumir, pero para los propósitos que solo necesitan
    saber si el código era válido (verificacion_email, recuperar_password) --
    no hace falta ningún dato extra de la fila."""
    return _validar_y_consumir(db, usuario, proposito, codigo_ingresado) is not None


def validar_codigo_cambio_email(db: Session, usuario: Usuario, codigo_ingresado: str) -> Optional[str]:
    """Variante para PropositoCodigo.cambiar_email: además de validar,
    devuelve la dirección nueva guardada junto con el código (ver
    crear_codigo) para que quien llama sepa a qué email cambiar la cuenta.
    None si el código no era válido."""
    fila = _validar_y_consumir(db, usuario, PropositoCodigo.cambiar_email, codigo_ingresado)
    return fila.email_nuevo if fila is not None else None
