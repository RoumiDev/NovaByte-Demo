"""Esquemas Pydantic para el recurso Usuario.

Separados en Base/Create/Update/Read a propósito para no exponer nunca al
cliente los campos que solo el backend debe controlar: id, password_hash,
role, is_active y created_at (ver "Mass Assignment" en el informe de
auditoría de este proyecto). Ningún schema de entrada acepta esos campos.
"""

import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.user import Provincia, TipoDocumento, condicionIVA

# Mismos tres valores que ROLES_VALIDOS / el CheckConstraint del modelo
# (app/models/user.py) -- FastAPI valida acá antes de que el valor
# llegue a tocar la base.
Rol = Literal["admin", "ayudante", "cliente"]

# Validación simple de email: evita depender de un paquete extra (email-validator)
# que hoy no está en requirements.txt. No cubre el 100% del RFC 5322, solo
# rechaza valores claramente inválidos.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# bcrypt trunca/rechaza contraseñas de más de 72 bytes (se vio en las pruebas
# de esta auditoría). Limitarlo acá evita ese error y evita que alguien mande
# una contraseña gigante para forzar hashing costoso (DoS barato).
_PASSWORD_MAX_BYTES = 72
_PASSWORD_MIN_LENGTH = 8

# Los códigos de verificación (ver app/services/verification_service.py)
# son siempre 6 dígitos exactos -- este patrón se reutiliza en los tres
# schemas de más abajo que reciben uno.
_CODIGO_PATTERN = r"^\d{6}$"

# FEATURE (26/08/2026): Código Postal Argentino (CPA) -- el formato clásico
# de 4 dígitos (ej. "2500") o el nuevo alfanumérico (1 letra + 4 dígitos +
# 3 letras, ej. "S2500FRV", el del propio local -- ver Contacto.jsx del
# frontend). Se reutiliza en UsuarioBase y UsuarioUpdate más abajo.
_CODIGO_POSTAL_RE = re.compile(r"^(\d{4}|[A-Za-z]\d{4}[A-Za-z]{3})$")


def _validar_password(value: str) -> str:
    if len(value) < _PASSWORD_MIN_LENGTH:
        raise ValueError(f"La contraseña debe tener al menos {_PASSWORD_MIN_LENGTH} caracteres.")
    if len(value.encode("utf-8")) > _PASSWORD_MAX_BYTES:
        raise ValueError(f"La contraseña no puede superar los {_PASSWORD_MAX_BYTES} bytes.")
    return value


def _limpiar_email(value: str) -> str:
    """Mismo criterio que UsuarioBase._validar_email: normaliza antes de
    buscar en la base, así "Usuario@Mail.com " y "usuario@mail.com"
    matchean la misma cuenta."""
    value = value.strip().lower()
    if len(value) > 255 or not _EMAIL_RE.match(value):
        raise ValueError("Email inválido.")
    return value


def validar_formato_documento_valores(tipo_documento: TipoDocumento, numero_documento: str) -> None:
    """Validación básica de formato de documento según el tipo (Argentina) --
    es una validación de forma, no de existencia real del documento.

    FEATURE (27/08/2026, pedido del cliente): a propósito SIN guion bajo
    (a diferencia del resto de los helpers de este archivo): la usa tanto
    UsuarioBase._validar_formato_documento (abajo, con self.tipo_documento/
    self.numero_documento siempre completos) como admin_update_user en
    router/users.py, para revalidar esta misma regla cuando un admin edita
    SOLO alguno de los dos campos de otro usuario (ahí no hay un "self"
    completo -- hay que armar los valores efectivos a mano mezclando el
    PATCH con lo que ese usuario ya tenía, y validar con esos valores).
    Levanta ValueError (no HTTPException): quien la llama decide cómo
    convertir eso en una respuesta -- Pydantic lo hace solo dentro de un
    validator, router/users.py lo atrapa a mano.
    """
    digitos = re.sub(r"\D", "", numero_documento)
    if tipo_documento is TipoDocumento.dni:
        if not (7 <= len(digitos) <= 8):
            raise ValueError("El DNI debe tener 7 u 8 dígitos.")
    else:  # CUIT / CUIL
        if len(digitos) != 11:
            raise ValueError("El CUIT/CUIL debe tener 11 dígitos.")


def validar_relacion_iva_documento(tipo_documento: TipoDocumento, condicion_iva: condicionIVA) -> None:
    """Relación 1 a 1 entre tipo de documento y condición frente al IVA
    (pedido puntual del dueño de la tienda): con DNI la única condición
    válida es "Consumidor Final"; con CUIT/CUIL, cualquier otra menos esa.

    FEATURE (27/08/2026, pedido del cliente): mismo motivo que
    validar_formato_documento_valores de acá arriba -- sin guion bajo
    porque también la usa router/users.py, no solo
    UsuarioCreate._validar_condicion_iva_segun_documento.
    """
    si_es_dni = tipo_documento is TipoDocumento.dni
    es_consumidor_final = condicion_iva is condicionIVA.consumidor_final
    if si_es_dni and not es_consumidor_final:
        raise ValueError('Con DNI, la condición frente al IVA tiene que ser "Consumidor Final".')
    if not si_es_dni and es_consumidor_final:
        raise ValueError('"Consumidor Final" no es válido para CUIT/CUIL.')


def _validar_codigo_postal(value: Optional[str]) -> Optional[str]:
    """FEATURE (26/08/2026): compartido por UsuarioBase y UsuarioUpdate
    (ver _CODIGO_POSTAL_RE más arriba). "" o None se normalizan a None
    (campo opcional, sin especificar) -- cualquier otra cosa tiene que
    matchear el formato CPA."""
    if value is None:
        return None
    value = value.strip().upper()
    if not value:
        return None
    if not _CODIGO_POSTAL_RE.match(value):
        raise ValueError('Código postal inválido (ej: "2500" o "S2500FRV").')
    return value


class UsuarioBase(BaseModel):
    """Campos que el propio usuario elige al registrarse y puede ver luego."""

    email: str = Field(max_length=255)
    razon_social: str = Field(min_length=1, max_length=255)
    tipo_documento: TipoDocumento = TipoDocumento.dni
    numero_documento: str = Field(min_length=1, max_length=255)
    condicion_iva: condicionIVA = condicionIVA.consumidor_final
    telefono: str = Field(min_length=1, max_length=30)
    # FIX (26/08/2026, pedido del cliente): direccion pasa a ser obligatoria
    # (antes era opcional). Se mantiene Optional[...] a nivel de tipo acá en
    # UsuarioBase -- que también hereda UsuarioRead -- porque ya existen
    # cuentas registradas antes de este cambio con direccion en NULL; la
    # obligatoriedad real para cuentas nuevas se exige en UsuarioCreate
    # (ver _validar_domicilio_obligatorio más abajo), no acá.
    direccion: Optional[str] = Field(default=None, max_length=255)
    # FEATURE (26/08/2026, pedido del cliente): ciudad del domicilio,
    # separada de direccion -- mismo criterio Optional[...]+obligatoriedad
    # en UsuarioCreate que direccion de acá arriba.
    ciudad: Optional[str] = Field(default=None, max_length=255)
    # FEATURE (26/08/2026, pedido del cliente): provincia y código postal --
    # ver Provincia en app/models/user.py. Mismo criterio Optional[...]+
    # obligatoriedad en UsuarioCreate que direccion/ciudad de acá arriba.
    provincia: Optional[Provincia] = Field(default=None)
    codigo_postal: Optional[str] = Field(default=None, max_length=8)

    @field_validator("email")
    @classmethod
    def _validar_email(cls, value: str) -> str:
        value = value.strip().lower()
        if len(value) > 255 or not _EMAIL_RE.match(value):
            raise ValueError("Email inválido.")
        return value

    @field_validator("direccion")
    @classmethod
    def _limpiar_direccion(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("ciudad")
    @classmethod
    def _limpiar_ciudad(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("codigo_postal")
    @classmethod
    def _validar_codigo_postal_base(cls, value: Optional[str]) -> Optional[str]:
        return _validar_codigo_postal(value)

    @field_validator("numero_documento")
    @classmethod
    def _limpiar_numero_documento(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("numero_documento no puede estar vacío.")
        return value

    @model_validator(mode="after")
    def _validar_formato_documento(self) -> "UsuarioBase":
        """Validación básica de formato según el tipo de documento (Argentina) --
        ver validar_formato_documento_valores más arriba (compartida con
        router/users.py)."""
        validar_formato_documento_valores(self.tipo_documento, self.numero_documento)
        return self


class UsuarioCreate(UsuarioBase):
    """Datos aceptados al registrar un usuario. Nunca incluye role ni
    is_active: esos campos los controla exclusivamente el backend."""

    password: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=200)

    @field_validator("password")
    @classmethod
    def _validar_password_create(cls, value: str) -> str:
        return _validar_password(value)

    @model_validator(mode="after")
    def _validar_domicilio_obligatorio(self) -> "UsuarioCreate":
        """FIX (26/08/2026, pedido del cliente): al registrarse, direccion,
        ciudad, provincia y código postal ahora son obligatorios (antes
        eran opcionales).

        Puesto acá (UsuarioCreate) y no en UsuarioBase por el mismo motivo
        que _validar_condicion_iva_segun_documento más abajo: UsuarioBase
        también la hereda UsuarioRead, y ya existen cuentas registradas
        antes de este cambio con estos campos en NULL -- exigirlo en
        UsuarioBase rompería con un 500 la lectura de esas cuentas viejas.
        Acá solo se aplica al dar de alta una cuenta nueva.
        """
        if not self.direccion:
            raise ValueError("La dirección es obligatoria.")
        if not self.ciudad:
            raise ValueError("La ciudad es obligatoria.")
        if self.provincia is None:
            raise ValueError("La provincia es obligatoria.")
        if not self.codigo_postal:
            raise ValueError("El código postal es obligatorio.")
        return self

    @model_validator(mode="after")
    def _validar_condicion_iva_segun_documento(self) -> "UsuarioCreate":
        """Relación 1 a 1 entre tipo de documento y condición frente al IVA
        (pedido puntual del dueño de la tienda, formulario de registro) --
        ver validar_relacion_iva_documento más arriba (compartida con
        router/users.py).

        Puesto acá (UsuarioCreate) y no en UsuarioBase a propósito:
        UsuarioBase también la hereda UsuarioRead, y ya pueden existir
        cuentas viejas que no cumplan esta relación (antes no estaba
        restringida) -- validar esto en UsuarioBase rompería con un 500
        cualquier lectura de esos usuarios ya existentes. Acá solo se
        aplica al dar de alta una cuenta nueva.
        """
        validar_relacion_iva_documento(self.tipo_documento, self.condicion_iva)
        return self


class UsuarioUpdate(BaseModel):
    """Campos que un usuario autenticado puede editar sobre sí mismo.

    Deliberadamente NO incluye email, numero_documento, razon_social,
    role ni is_active: cambiar esos campos necesita un flujo separado
    (verificación de email, endpoint de administración, etc.), nunca un
    PATCH genérico de "editar mi perfil".
    """

    # FIX (26/08/2026, pedido del cliente): direccion, ciudad, provincia y
    # codigo_postal ahora son obligatorios -- el tipo se mantiene
    # Optional[...] a propósito en los cuatro, porque PATCH /users/me usa
    # exclude_unset=True (router/users.py) y cada campo tiene que poder
    # omitirse del body sin error (así se puede editar solo el teléfono,
    # por ejemplo, sin tocar el resto del domicilio). Pero si alguno de
    # estos cuatro SÍ viene en el body, ya no se acepta null/vacío como
    # forma de "borrarlo" -- ver los validators de abajo.
    telefono: Optional[str] = Field(default=None, min_length=1, max_length=30)
    direccion: Optional[str] = Field(default=None, max_length=255)
    ciudad: Optional[str] = Field(default=None, max_length=255)
    provincia: Optional[Provincia] = Field(default=None)
    codigo_postal: Optional[str] = Field(default=None, max_length=8)

    @field_validator("direccion")
    @classmethod
    def _validar_direccion_update(cls, value: Optional[str]) -> str:
        # FIX (26/08/2026): a diferencia de antes, si "direccion" viene en
        # el body de PATCH /users/me, ya no puede ser null/vacía.
        if value is None or not value.strip():
            raise ValueError("La dirección es obligatoria.")
        return value.strip()

    @field_validator("ciudad")
    @classmethod
    def _validar_ciudad_update(cls, value: Optional[str]) -> str:
        if value is None or not value.strip():
            raise ValueError("La ciudad es obligatoria.")
        return value.strip()

    @field_validator("provincia")
    @classmethod
    def _validar_provincia_update(cls, value: Optional[Provincia]) -> Provincia:
        # FIX (26/08/2026): a diferencia de antes, si "provincia" viene en
        # el body de PATCH /users/me, ya no puede ser null (el frontend
        # tampoco manda más el placeholder "Sin especificar" que permitía
        # esto -- ver Register.jsx / ConfiguracionPrivacidad.jsx).
        if value is None:
            raise ValueError("La provincia es obligatoria.")
        return value

    @field_validator("codigo_postal")
    @classmethod
    def _validar_codigo_postal_update(cls, value: Optional[str]) -> str:
        resultado = _validar_codigo_postal(value)
        if resultado is None:
            # FIX (26/08/2026): antes "" / null normalizaba a None (borrar
            # el dato); ahora, si el campo viene en el body, tiene que
            # traer un valor válido.
            raise ValueError("El código postal es obligatorio.")
        return resultado


class UsuarioPasswordChange(BaseModel):
    """Cambio de contraseña: exige la contraseña actual.

    Así, una sesión robada (o un XSS que solo alcance a ejecutar una request)
    no sirve por sí sola para tomar la cuenta cambiando la contraseña.
    """

    password_actual: str = Field(min_length=1, max_length=200)
    password_nueva: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=200)

    @field_validator("password_nueva")
    @classmethod
    def _validar_password_nueva(cls, value: str) -> str:
        return _validar_password(value)


class UsuarioAdminUpdate(UsuarioUpdate):
    """Campos que un administrador puede modificar sobre CUALQUIER usuario
    (usar junto con la dependencia require_admin de app/dependencies/auth.py)
    -- PATCH /users/{usuario_id}, no confundir con PATCH /users/me.

    FEATURE (27/08/2026, pedido del cliente): botón "Editar" en el panel de
    Usuarios del admin. Hereda de UsuarioUpdate a propósito -- la dirección
    de la herencia importa acá: UsuarioUpdate (PATCH /users/me) sigue sin
    saber nada de is_active/role/etc., así que "editar mi perfil" no corre
    ningún riesgo nuevo; lo único que gana este schema, al heredar, es
    reutilizar los mismos campos/validators de contacto
    (telefono/direccion/ciudad/provincia/codigo_postal, con las mismas
    reglas de "obligatorio si viene") sin duplicarlos.

    Encima de esos, un admin (y SOLO un admin) puede tocar razon_social,
    tipo_documento, numero_documento y condicion_iva -- los datos de
    identidad/fiscales que un usuario normal no puede editarse a sí mismo
    (ver el docstring de UsuarioUpdate) -- y, como ya era antes, is_active y
    role.

    Deliberadamente NO incluye email (tiene su propio flujo con
    verificación por código, ver /users/me/email/solicitar -- un admin
    reasignando el email de otro sin esa verificación sería una forma de
    apropiarse una cuenta ajena) ni password: ese cambio de contraseña NO
    pasa por acá, un PATCH genérico de perfil. La ÚNICA vía para que un
    admin le fije una contraseña a otro usuario es el endpoint aparte,
    angosto a propósito, agregado el 11/09/2026 (pedido del cliente, ver
    RestablecerPasswordAdmin más abajo y admin_reset_password en
    router/users.py) para desbloquear cuentas con la casilla de mail
    llena -- no una excepción silenciosa acá.

    OJO -- la relación tipo_documento <-> condicion_iva
    (validar_relacion_iva_documento) y el formato de numero_documento
    (validar_formato_documento_valores), las dos en este mismo archivo más
    arriba, NO se validan acá adentro con un @model_validator como en
    UsuarioCreate: como este es un PATCH parcial (un admin puede mandar
    uno solo de los tres campos relacionados), hace falta el valor
    EFECTIVO resultante -- lo que cambia en este body más lo que el
    usuario ya tenía guardado -- para poder validar esa relación. Eso se
    hace a mano en admin_update_user (router/users.py), después de mezclar
    los cambios de este body con los valores actuales del usuario.

    FEATURE (30/08/2026, pedido del cliente, hallazgo Alto #1 de la
    auditoría UX/UI): "aplicá la función de que tenga que pedir la
    contraseña del admin" para cambiar el rol de un usuario o activar/
    desactivarlo -- mismo criterio y mismo campo que ya usa
    ProductoUpdate.password_actual (ver el comentario ahí, en
    schemas/product.py) para el mismo tipo de confirmación "sudo" (ver
    verificar_password_admin en app/dependencies/auth.py). Acá la exime
    admin_update_user (router/users.py) SOLO si el PATCH no toca role ni
    is_active -- editar razon_social/teléfono/dirección/etc. desde el modal
    "Editar" del panel de Usuarios sigue sin pedirla, igual que antes.
    """

    razon_social: Optional[str] = Field(default=None, min_length=1, max_length=255)
    tipo_documento: Optional[TipoDocumento] = None
    numero_documento: Optional[str] = Field(default=None, min_length=1, max_length=255)
    condicion_iva: Optional[condicionIVA] = None
    is_active: Optional[bool] = None
    role: Optional[Rol] = None
    password_actual: Optional[str] = Field(default=None, max_length=255)

    @field_validator("razon_social")
    @classmethod
    def _limpiar_razon_social_admin(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("razon_social no puede estar vacío.")
        return value

    @field_validator("numero_documento")
    @classmethod
    def _limpiar_numero_documento_admin(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("numero_documento no puede estar vacío.")
        return value


class UsuarioRead(UsuarioBase):
    """Lo que se devuelve al cliente. Nunca incluye password_hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    role: Rol
    created_at: datetime
    email_verificado: bool
    # FEATURE (11/09/2026, pedido del cliente): ver el comentario grande en
    # Usuario.debe_cambiar_password (app/models/user.py). El frontend lo lee
    # de acá (viene con GET /users/me, que usa este mismo schema) para
    # saber si tiene que interponer la pantalla obligatoria de cambiar
    # contraseña -- ver CambiarPasswordObligatorio.jsx y SiteLayout.jsx.
    debe_cambiar_password: bool
    # FEATURE (12/09/2026, pedido del cliente): ver el comentario grande en
    # Usuario.debe_avisar_email_verificado (app/models/user.py). El frontend
    # lo lee de acá (viene con GET /users/me, que usa este mismo schema)
    # para saber si tiene que mostrar el aviso no bloqueante de "tu cuenta
    # ya fue verificada" -- ver el useEffect en SiteLayout.jsx.
    debe_avisar_email_verificado: bool


class SolicitarCodigo(BaseModel):
    """Body de POST /users/reenviar-verificacion y POST /users/olvide-password.

    Solo el email: los dos endpoints responden siempre el mismo mensaje
    genérico exista o no esa cuenta (ver router/users.py), para no
    filtrar qué emails están registrados -- mismo criterio que POST
    /auth/login."""

    email: str = Field(max_length=255)

    @field_validator("email")
    @classmethod
    def _validar_email(cls, value: str) -> str:
        return _limpiar_email(value)


class VerificarEmail(BaseModel):
    """Body de POST /users/verificar-email."""

    email: str = Field(max_length=255)
    codigo: str = Field(pattern=_CODIGO_PATTERN)

    @field_validator("email")
    @classmethod
    def _validar_email(cls, value: str) -> str:
        return _limpiar_email(value)


class SolicitarCambioEmail(BaseModel):
    """Body de POST /users/me/email/solicitar.

    Requiere sesión (a diferencia de SolicitarCodigo de arriba): acá no hay
    que decir de quién es la cuenta, ya lo sabemos por el token -- solo
    hace falta la dirección nueva a la que se quiere cambiar.
    """

    email_nuevo: str = Field(max_length=255)

    @field_validator("email_nuevo")
    @classmethod
    def _validar_email_nuevo(cls, value: str) -> str:
        return _limpiar_email(value)


class ConfirmarCambioEmail(BaseModel):
    """Body de POST /users/me/email/confirmar. El email nuevo no viaja acá
    de nuevo -- ya quedó guardado junto con el código al pedirlo (ver
    CodigoVerificacion.email_nuevo)."""

    codigo: str = Field(pattern=_CODIGO_PATTERN)


class RestablecerPasswordAdmin(BaseModel):
    """Body de POST /users/{usuario_id}/restablecer-password-admin.

    FEATURE (11/09/2026, pedido del cliente): vía de emergencia para
    cuentas de clientes cuya casilla de mail está llena -- no pueden
    recibir el código de /olvide-password + /restablecer-password (el
    flujo normal de autoservicio), así que quedan bloqueados afuera de su
    propia cuenta. Acá un admin, DESPUÉS de confirmar la identidad del
    cliente por otro medio (teléfono, WhatsApp, lo que sea -- eso queda
    fuera del sistema, es criterio del admin en el momento), le puede
    poner una contraseña nueva directamente.

    OJO -- esto es una excepción angosta y a propósito al criterio que
    todavía documenta UsuarioAdminUpdate más abajo ("no existe, ni debe
    existir, un endpoint para que un admin le ponga una contraseña a otro
    usuario"): ese criterio sigue valiendo para un PATCH genérico de
    perfil -- password NUNCA se coló ahí --, pero el cliente pidió
    explícitamente esta vía puntual para desbloquear cuentas. Por eso es
    un endpoint APARTE (no un campo más de UsuarioAdminUpdate), con las
    mismas salvaguardas "sudo" de siempre -- ver el docstring de
    admin_reset_password en router/users.py para el detalle completo
    (confirmación con la contraseña del propio admin, rate limiting,
    revocación de sesiones de la cuenta afectada, y logging de auditoría).
    """

    password_nueva: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=200)
    password_actual: str = Field(min_length=1, max_length=200)

    @field_validator("password_nueva")
    @classmethod
    def _validar_password_nueva(cls, value: str) -> str:
        return _validar_password(value)


class RestablecerPassword(BaseModel):
    """Body de POST /users/restablecer-password."""

    email: str = Field(max_length=255)
    codigo: str = Field(pattern=_CODIGO_PATTERN)
    password_nueva: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=200)

    @field_validator("email")
    @classmethod
    def _validar_email(cls, value: str) -> str:
        return _limpiar_email(value)

    @field_validator("password_nueva")
    @classmethod
    def _validar_password_nueva(cls, value: str) -> str:
        return _validar_password(value)
