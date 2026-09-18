"""Endpoints de usuarios: registro, perfil propio y administración."""

import logging
from typing import Annotated

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.auth.security import get_password_hash, revoke_all_refresh_tokens, verify_password
from app.core.database import get_db
from app.core.pagination import Limit, Skip
from app.core.rate_limit import (
    codigo_intento_rate_limiter,
    codigo_solicitud_rate_limiter,
    confirmar_password_admin_rate_limiter,
    password_change_rate_limiter,
    register_rate_limiter,
)
from app.dependencies.auth import bloquear_en_demo, get_current_user, require_admin, verificar_password_admin
from app.models.user import PropositoCodigo, Usuario
from app.schemas.user import (
    ConfirmarCambioEmail,
    RestablecerPassword,
    RestablecerPasswordAdmin,
    SolicitarCambioEmail,
    SolicitarCodigo,
    UsuarioAdminUpdate,
    UsuarioCreate,
    UsuarioPasswordChange,
    UsuarioRead,
    UsuarioUpdate,
    VerificarEmail,
    # FEATURE (27/08/2026, pedido del cliente): ver el uso en
    # admin_update_user más abajo -- misma validación de
    # documento/condición de IVA que UsuarioCreate, pero con los valores
    # EFECTIVOS de un PATCH parcial (ver el docstring de UsuarioAdminUpdate
    # en schemas/user.py).
    validar_formato_documento_valores,
    validar_relacion_iva_documento,
)
from app.services.email_service import (
    enviar_codigo_cambio_email,
    enviar_codigo_recuperar_password,
    enviar_codigo_verificacion_email,
    # FEATURE (12/09/2026, pedido del cliente): "desactiva esa opción de
    # envío de mail" -- las dos acciones "sudo" de más abajo
    # (admin_reset_password/admin_mark_email_verified) YA NO mandan ningún
    # mail de aviso: enviar_notificacion_password_restablecida_admin y
    # enviar_notificacion_email_verificado_admin (antes importadas acá)
    # rebotaban siempre, porque el mail de aviso iba a la MISMA casilla que,
    # por definición, está llena/rota si hizo falta usar alguno de estos dos
    # endpoints en primer lugar -- ver el comentario grande en cada función
    # más abajo para el reemplazo de cada una. Las dos funciones siguen
    # existiendo en email_service.py, sin uso, por si el día de mañana hace
    # falta retomar el envío por mail (ver el comentario ahí).
)
from app.services.verification_service import crear_codigo, validar_codigo, validar_codigo_cambio_email

router = APIRouter()

# FEATURE (11/09/2026, pedido del cliente): logger dedicado para dejar
# rastro auditable de admin_reset_password más abajo -- mismo criterio de
# namespacing por área que app.pagos/app.mercadopago/app.reconciliacion en
# el resto del proyecto (ver router/payments.py, services/mercadopago_service.py,
# jobs/reconciliacion_pagos.py).
logger = logging.getLogger("app.usuarios")

# FIX (13/09/2026, auditoría UX/UI Punto Crítico #3 -- "límite silencioso de
# 100 registros sin paginación"): mismo límite que _MAX_LONGITUD_BUSQUEDA en
# router/products.py, para el parámetro "busqueda" de list_users más abajo.
_MAX_LONGITUD_BUSQUEDA = 255

# Mismo mensaje para cualquier motivo de rechazo (código equivocado, ya
# usado, expirado, o cuenta inexistente) -- no hay forma de distinguir esos
# casos desde afuera, ni por el mensaje ni por el status code.
_CODIGO_INVALIDO = HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail="Código inválido o expirado.",
)

# Hash "señuelo" calculado una sola vez al importar el módulo -- mismo
# criterio que _DUMMY_PASSWORD_HASH en app/router/auth.py (hallazgo #2 de
# la auditoría AppSec, 2026-08-23). Sin esto, verify_email/reset_password
# respondían casi al instante cuando el email no existe, pero tardaban
# ~50-100ms más (el costo real de bcrypt) cuando sí existe -- esa diferencia
# de tiempo delata por sí sola qué emails están registrados, aunque el
# mensaje de error (_CODIGO_INVALIDO de arriba) sea siempre el mismo. Se
# usa en las dos ramas "usuario is None" de más abajo para gastar el mismo
# tiempo de cómputo que gastaría verificar un código real.
_DUMMY_CODIGO_HASH = get_password_hash("000000")


@router.post(
    "/",
    response_model=UsuarioRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(register_rate_limiter)],
)
def register(body: UsuarioCreate, db: Session = Depends(get_db)) -> Usuario:
    """Registrar un usuario nuevo.

    UsuarioCreate no tiene campo role ni is_active: nacen con los
    defaults del modelo (is_active=True, role="cliente") y solo un admin
    puede cambiarlos después, vía PATCH /{id} (UsuarioAdminUpdate).

    email_verificado nace en False (default del modelo): acá abajo se le
    manda un código de 6 dígitos por mail para confirmarlo (ver
    POST /verificar-email). El login de hoy NO exige tenerlo verificado
    (ver router/auth.py) -- si el mail no llega o se pierde, la cuenta
    igual funciona; "reenviar-verificacion" existe para pedir uno nuevo.
    """
    usuario = Usuario(
        email=body.email,
        razon_social=body.razon_social,
        password_hash=get_password_hash(body.password),
        tipo_documento=body.tipo_documento,
        numero_documento=body.numero_documento,
        condicion_iva=body.condicion_iva,
        telefono=body.telefono,
        direccion=body.direccion,
        # FEATURE (26/08/2026, pedido del cliente): ciudad/provincia/
        # codigo_postal -- ver UsuarioBase en app/schemas/user.py. Si se
        # agrega un campo nuevo a UsuarioBase el día de mañana, hay que
        # sumarlo acá también: este constructor es explícito campo por
        # campo a propósito (no **body.model_dump()), así nunca puede
        # colarse un campo no controlado (ver "Mass Assignment" en el
        # informe de auditoría) -- pero eso significa que un campo nuevo en
        # el schema no llega solo, hay que acordarse de este lugar.
        ciudad=body.ciudad,
        provincia=body.provincia,
        codigo_postal=body.codigo_postal,
    )
    db.add(usuario)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Mensaje genérico a propósito: no distingue si el conflicto es el
        # email o el número de documento, para no facilitar enumerar cuentas
        # existentes probando emails uno por uno.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo completar el registro con los datos provistos.",
        )
    db.refresh(usuario)

    # Envío del mail best-effort: si el proveedor SMTP falla acá, la cuenta
    # ya quedó creada igual (ver comentario arriba) -- no tiene sentido
    # perder un registro válido por un problema transitorio de mail. El
    # usuario puede pedir un código nuevo con POST /reenviar-verificacion.
    codigo = crear_codigo(db, usuario, PropositoCodigo.verificacion_email)
    db.commit()
    enviar_codigo_verificacion_email(usuario.email, usuario.razon_social, codigo)

    return usuario


@router.get("/me", response_model=UsuarioRead)
def read_my_profile(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    return current_user


@router.patch("/me", response_model=UsuarioRead)
def update_my_profile(
    body: UsuarioUpdate,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Usuario:
    """Editar los únicos campos que un usuario puede tocar sobre sí mismo.

    UsuarioUpdate no incluye email, documento, razon_social, role ni
    is_active: cambiar esos campos no pasa por acá (ver schemas/user.py).
    """
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post(
    "/me/email/solicitar",
    dependencies=[Depends(codigo_solicitud_rate_limiter)],
)
def request_email_change(
    body: SolicitarCambioEmail,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Pedir el código para cambiar el email propio (ver Privacidad).

    El código se manda a email_nuevo (la dirección todavía no guardada),
    no al email actual -- así queda probado que quien pide el cambio tiene
    acceso real a esa casilla nueva antes de aplicarlo.

    Respuesta genérica siempre, sin importar si email_nuevo ya está en uso
    por otra cuenta: un usuario autenticado no debería poder usar este
    endpoint para averiguar qué emails están registrados por otros. Si está
    libre, ahí sí se genera el código y se manda el mail; si no, esta
    llamada no hace nada más (la próxima persona que intente confirmar un
    código para esa cuenta simplemente no va a tener ninguno vigente).
    """
    if body.email_nuevo == current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ese ya es tu email actual.",
        )

    ya_en_uso = db.execute(
        select(Usuario).where(Usuario.email == body.email_nuevo)
    ).scalar_one_or_none()
    if ya_en_uso is None:
        codigo = crear_codigo(db, current_user, PropositoCodigo.cambiar_email, email_nuevo=body.email_nuevo)
        db.commit()
        enviar_codigo_cambio_email(body.email_nuevo, current_user.razon_social, codigo)

    return {"detail": "Si ese email está disponible, te enviamos un código a esa dirección para confirmarlo."}


@router.post(
    "/me/email/confirmar",
    response_model=UsuarioRead,
    dependencies=[Depends(codigo_intento_rate_limiter)],
)
def confirm_email_change(
    body: ConfirmarCambioEmail,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Usuario:
    """Confirmar el cambio de email con el código mandado a la dirección
    nueva. Se marca email_verificado=True de una: el código recién probó
    que el usuario tiene acceso a esa casilla, así que no tendría sentido
    pedirle además el flujo de verificar-email de nuevo."""
    email_nuevo = validar_codigo_cambio_email(db, current_user, body.codigo)
    if email_nuevo is None:
        raise _CODIGO_INVALIDO

    current_user.email = email_nuevo
    current_user.email_verificado = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Alguien más se registró (o cambió su email) a esa misma dirección
        # justo en la ventana entre pedir el código y confirmarlo -- caso
        # borde raro pero posible, se corta acá en vez de dejar que la
        # excepción cruda llegue al cliente.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese email ya está en uso por otra cuenta.",
        )
    db.refresh(current_user)
    return current_user


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(password_change_rate_limiter)],
)
def change_my_password(
    body: UsuarioPasswordChange,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Cambiar la propia contraseña. Exige la contraseña actual y revoca
    todos los refresh tokens activos (fuerza a re-loguearse en todos los
    dispositivos), como corresponde ante un cambio de credencial sensible."""
    if not verify_password(body.password_actual, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La contraseña actual no es correcta.",
        )
    current_user.password_hash = get_password_hash(body.password_nueva)
    # FEATURE (11/09/2026, pedido del cliente): cualquier cambio de
    # contraseña exitoso -- sea desde acá (Privacidad) o desde la pantalla
    # obligatoria que ve un cliente después de que un admin le restableció
    # la contraseña (CambiarPasswordObligatorio.jsx, que llama a este mismo
    # endpoint) -- apaga la señal de "todavía usás la temporal que te dio
    # el admin". Es una asignación inofensiva para el resto de los casos
    # (ya estaba en False, no cambia nada). Ver Usuario.debe_cambiar_password
    # en models/user.py.
    current_user.debe_cambiar_password = False
    revoke_all_refresh_tokens(db, current_user.id)
    db.commit()
    return None


@router.post(
    "/me/aviso-email-verificado",
    status_code=status.HTTP_204_NO_CONTENT,
)
def dismiss_email_verified_notice(
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Apaga la señal de "mostrar el aviso de cuenta verificada".

    FEATURE (12/09/2026, pedido del cliente): el frontend llama a esto una
    sola vez, apenas terminó de mostrarle al cliente el aviso no bloqueante
    de que un admin verificó su cuenta a mano (ver el useEffect en
    SiteLayout.jsx y el comentario grande en
    Usuario.debe_avisar_email_verificado, models/user.py) -- así ese aviso
    no vuelve a aparecer en el próximo login. No hace falta ningún body: no
    hay nada que elegir acá, solo confirmar "ya lo vi". Idempotente (llamar
    esto de nuevo con la señal ya en False no hace nada raro), a propósito,
    por si el frontend llega a reintentar sin darse cuenta de que la
    primera llamada sí llegó.
    """
    current_user.debe_avisar_email_verificado = False
    db.commit()
    return None


@router.post(
    "/verificar-email",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(codigo_intento_rate_limiter)],
)
def verify_email(body: VerificarEmail, db: Session = Depends(get_db)) -> None:
    """Confirmar el mail con el código de 6 dígitos que llegó al registrarse."""
    usuario = db.execute(select(Usuario).where(Usuario.email == body.email)).scalar_one_or_none()
    if usuario is None:
        # Verificar igual contra el hash señuelo (se descarta el resultado)
        # antes de responder -- ver _DUMMY_CODIGO_HASH arriba: así el tiempo
        # de respuesta no delata si el email existe o no.
        verify_password(body.codigo, _DUMMY_CODIGO_HASH)
        raise _CODIGO_INVALIDO

    if usuario.email_verificado:
        # Ya estaba verificado (ej. el usuario reenvió el form dos veces):
        # no tiene sentido devolver error por algo que ya se cumplió.
        return None

    es_valido = validar_codigo(db, usuario, PropositoCodigo.verificacion_email, body.codigo)
    if es_valido:
        usuario.email_verificado = True
    db.commit()

    if not es_valido:
        raise _CODIGO_INVALIDO
    return None


@router.post(
    "/reenviar-verificacion",
    dependencies=[Depends(codigo_solicitud_rate_limiter)],
)
def resend_verification(body: SolicitarCodigo, db: Session = Depends(get_db)) -> dict:
    """Pedir un código nuevo de verificación de mail.

    Responde siempre el mismo mensaje genérico, exista o no esa cuenta (y
    aunque ya esté verificada) -- mismo criterio anti-enumeración que
    POST /auth/login. El envío del mail es best-effort (ver email_service).
    """
    usuario = db.execute(select(Usuario).where(Usuario.email == body.email)).scalar_one_or_none()
    if usuario is not None and not usuario.email_verificado:
        codigo = crear_codigo(db, usuario, PropositoCodigo.verificacion_email)
        db.commit()
        enviar_codigo_verificacion_email(usuario.email, usuario.razon_social, codigo)

    return {"detail": "Si el mail corresponde a una cuenta sin verificar, te enviamos un código nuevo."}


@router.post(
    "/olvide-password",
    dependencies=[Depends(codigo_solicitud_rate_limiter)],
)
def forgot_password(body: SolicitarCodigo, db: Session = Depends(get_db)) -> dict:
    """Pedir un código para restablecer la contraseña.

    Mismo criterio anti-enumeración que resend_verification: responde
    siempre el mismo mensaje genérico exista o no esa cuenta.
    """
    usuario = db.execute(select(Usuario).where(Usuario.email == body.email)).scalar_one_or_none()
    if usuario is not None and usuario.is_active:
        codigo = crear_codigo(db, usuario, PropositoCodigo.recuperar_password)
        db.commit()
        enviar_codigo_recuperar_password(usuario.email, usuario.razon_social, codigo)

    return {"detail": "Si el mail corresponde a una cuenta, te enviamos un código para restablecer la contraseña."}


@router.post(
    "/restablecer-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(codigo_intento_rate_limiter)],
)
def reset_password(body: RestablecerPassword, db: Session = Depends(get_db)) -> None:
    """Elegir una contraseña nueva con el código de recuperar-password.

    Al igual que change_my_password, revoca todos los refresh tokens
    activos: si alguien más tenía una sesión abierta con la contraseña
    vieja, queda afuera.
    """
    usuario = db.execute(select(Usuario).where(Usuario.email == body.email)).scalar_one_or_none()
    if usuario is None:
        # Mismo criterio que en verify_email -- ver _DUMMY_CODIGO_HASH arriba.
        verify_password(body.codigo, _DUMMY_CODIGO_HASH)
        raise _CODIGO_INVALIDO

    es_valido = validar_codigo(db, usuario, PropositoCodigo.recuperar_password, body.codigo)
    if es_valido:
        usuario.password_hash = get_password_hash(body.password_nueva)
        # FEATURE (11/09/2026, pedido del cliente): mismo criterio que
        # change_my_password más arriba -- elegir una contraseña propia acá
        # (aunque el punto de partida haya sido "olvidé mi contraseña", no
        # el reset de un admin) también apaga la señal de "todavía usás una
        # temporal", si es que estaba prendida.
        usuario.debe_cambiar_password = False
        revoke_all_refresh_tokens(db, usuario.id)
    db.commit()

    if not es_valido:
        raise _CODIGO_INVALIDO
    return None


@router.get(
    "/",
    response_model=list[UsuarioRead],
    dependencies=[Depends(require_admin), Depends(bloquear_en_demo)],
)
def list_users(
    skip: Skip = 0,
    limit: Limit = 20,
    busqueda: Annotated[str | None, Query(max_length=_MAX_LONGITUD_BUSQUEDA)] = None,
    db: Session = Depends(get_db),
) -> list[Usuario]:
    """Listar usuarios (solo administradores).

    FIX (13/09/2026, auditoría UX/UI Punto Crítico #3 -- "límite silencioso
    de 100 registros sin paginación"): antes admin/Usuarios.jsx pedía
    limit=100 de una sola vez y filtraba nombre/email en memoria del lado
    del cliente -- si la base pasaba de 100 usuarios, el filtro dejaba de
    encontrar a los que quedaban afuera de esa primera tanda, en silencio.
    "busqueda" mueve ese mismo filtro (razón social O email, insensible a
    mayúsculas) al backend, para que funcione sobre TODA la tabla sin
    importar cuántas páginas haga falta pedir -- ver Usuarios.jsx.
    """
    query = select(Usuario)
    if busqueda:
        query = query.where(
            or_(Usuario.razon_social.ilike(f"%{busqueda}%"), Usuario.email.ilike(f"%{busqueda}%"))
        )
    query = query.order_by(Usuario.id).offset(skip).limit(limit)
    return list(db.execute(query).scalars())


@router.get(
    "/{usuario_id}",
    response_model=UsuarioRead,
    dependencies=[Depends(require_admin), Depends(bloquear_en_demo)],
)
def get_user(usuario_id: int, db: Session = Depends(get_db)) -> Usuario:
    """Obtener un usuario por id (solo administradores)."""
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return usuario


@router.patch("/{usuario_id}", response_model=UsuarioRead, dependencies=[Depends(bloquear_en_demo)])
def admin_update_user(
    usuario_id: int,
    body: UsuarioAdminUpdate,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Usuario:
    """Editar los datos de CUALQUIER usuario, activar/desactivarlo o cambiar
    su rol (admin/ayudante/cliente) -- panel de Usuarios del admin.

    Separado de PATCH /me a propósito: UsuarioAdminUpdate es el único schema
    que acepta is_active/role/razon_social/tipo_documento/numero_documento/
    condicion_iva, y solo lo puede llamar un admin.

    FEATURE (30/08/2026, pedido del cliente, hallazgo Alto #1 de la
    auditoría UX/UI): "aplicá la función de que tenga que pedir la
    contraseña del admin" para cambiar el rol o activar/desactivar una
    cuenta -- mismo criterio que update_product en router/products.py
    (ver el comentario ahí): se exige password_actual únicamente cuando el
    PATCH toca role y/o is_active; el resto de los campos (razon_social,
    teléfono, dirección, documento...) sigue sin pedirla, igual que antes.
    admin_actual ahora se recibe como parámetro (antes vivía solo en el
    dependencies=[] del decorador) porque acá adentro hace falta el
    Usuario real para pasárselo a verificar_password_admin.

    FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026 --
    "Falta de rate limiting y de logging de auditoría en la confirmación de
    contraseña ('sudo')..."): confirmar_password_admin_rate_limiter se llama
    A MANO acá adentro, igual que en update_product -- la contraseña acá es
    condicional (solo si se toca role/is_active), así que dependencies=[]
    del decorador la aplicaría también a ediciones de perfil que no tienen
    nada que ver con esto. Ver el comentario grande en
    app/core/rate_limit.py. Este es, además, el endpoint MÁS sensible de
    los que usan verificar_password_admin -- una promoción a admin sin
    límite de intentos era el peor caso posible del hallazgo original.
    """
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    changes = body.model_dump(exclude_unset=True)
    password_actual = changes.pop("password_actual", None)
    if {"role", "is_active"} & changes.keys():
        if not password_actual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Falta confirmar con tu contraseña.",
            )
        confirmar_password_admin_rate_limiter(request)
        verificar_password_admin(password_actual, admin_actual, request)

    # FEATURE (27/08/2026, pedido del cliente): si el PATCH toca
    # tipo_documento, numero_documento o condicion_iva -- aunque sea uno
    # solo de los tres -- hay que revalidar la relación entre ellos con los
    # valores EFECTIVOS (lo que cambia en este body más lo que el usuario
    # ya tenía guardado), no alcanza con validar contra lo que vino en este
    # body puntual. Ver el docstring de UsuarioAdminUpdate en
    # schemas/user.py sobre por qué esto no se puede hacer con un
    # @model_validator ahí adentro.
    if {"tipo_documento", "numero_documento", "condicion_iva"} & changes.keys():
        tipo_documento_efectivo = changes.get("tipo_documento", usuario.tipo_documento)
        numero_documento_efectivo = changes.get("numero_documento", usuario.numero_documento)
        condicion_iva_efectiva = changes.get("condicion_iva", usuario.condicion_iva)
        try:
            validar_formato_documento_valores(tipo_documento_efectivo, numero_documento_efectivo)
            validar_relacion_iva_documento(tipo_documento_efectivo, condicion_iva_efectiva)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))

    # Invariante: la tienda siempre tiene que tener al menos un admin activo
    # (hallazgo #5 de la auditoría AppSec, 2026-08-23). No alcanza con
    # bloquear solo la autodesactivación: sacarle el rol a ESTE usuario,
    # desactivarlo, o las dos cosas juntas, puede dejar la tienda sin ningún
    # admin si era el último -- sea que lo haga sobre sí mismo o sobre otro
    # admin. current_admin (el que hace el request) no importa acá; lo que
    # importa es si TODAVÍA queda algún admin activo aparte de "usuario"
    # (el que se está editando) después de aplicar los cambios.
    era_admin_activo = usuario.role == "admin" and usuario.is_active
    sera_admin_activo = (
        changes.get("role", usuario.role) == "admin" and changes.get("is_active", usuario.is_active)
    )
    if era_admin_activo and not sera_admin_activo:
        hay_otro_admin_activo = (
            db.execute(
                select(Usuario.id).where(
                    Usuario.role == "admin",
                    Usuario.is_active.is_(True),
                    Usuario.id != usuario.id,
                )
            ).first()
            is not None
        )
        if not hay_otro_admin_activo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se puede aplicar este cambio: la tienda se quedaría sin ningún administrador activo.",
            )

    for field, value in changes.items():
        setattr(usuario, field, value)

    if changes.get("is_active") is False:
        # Desactivar la cuenta no alcanza por sí solo para invalidar refresh
        # tokens ya emitidos: revocarlos explícitamente para cortar el acceso ya.
        revoke_all_refresh_tokens(db, usuario.id)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # FEATURE (27/08/2026, pedido del cliente): ahora que un admin puede
        # editar numero_documento (único, igual que en register()), un
        # conflicto acá es un caso esperable -- mensaje específico en vez de
        # dejar que lo agarre el manejador genérico de IntegrityError
        # (main.py), que respondería un 409 sin decir cuál fue el problema.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe otro usuario con ese número de documento.",
        )
    db.refresh(usuario)
    return usuario


@router.post(
    "/{usuario_id}/restablecer-password-admin",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(bloquear_en_demo)],
)
def admin_reset_password(
    usuario_id: int,
    body: RestablecerPasswordAdmin,
    request: Request,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    """Vía de emergencia: un admin le fija una contraseña nueva a
    CUALQUIER usuario, sin depender del código que llega por mail.

    FEATURE (11/09/2026, pedido del cliente): "hay cuentas de mails de
    clientes que tienen las casillas llenas" -- esos clientes no pueden
    recibir el código de POST /olvide-password + /restablecer-password
    (el flujo normal de autoservicio, más arriba), así que quedan
    bloqueados afuera de su propia cuenta sin ninguna salida. Este
    endpoint es esa salida: el admin, DESPUÉS de confirmar la identidad
    del cliente por otro medio (teléfono, WhatsApp, lo que sea -- eso
    queda fuera del sistema, es criterio del admin en el momento), le
    fija una contraseña nueva y se la comunica por ese mismo medio. El
    cliente puede cambiarla por una propia apenas vuelve a entrar (POST
    /users/me/password, ya existe).

    Revierte a propósito el criterio que todavía documenta
    UsuarioAdminUpdate (schemas/user.py) de que esto "no debe existir" --
    ver el comentario ahí. Ese criterio seguía siendo correcto para un
    PATCH genérico de perfil; esto es, a propósito, un endpoint APARTE y
    angosto (solo hace esto, nada más), con las mismas salvaguardas que
    cualquier otra acción "sudo" de este archivo:
      - password_actual confirma que quien ejecuta esto es realmente el
        admin logueado (verificar_password_admin), no una sesión dejada
        abierta en una computadora compartida.
      - confirmar_password_admin_rate_limiter acota los intentos, igual
        que el resto de las confirmaciones de este tipo (ver el
        comentario grande en app/core/rate_limit.py).
      - Se revocan todos los refresh tokens de la cuenta AFECTADA (no la
        del admin): si el cliente -- o alguien más -- tenía una sesión
        abierta en otro dispositivo con la contraseña vieja, queda
        afuera. Mismo criterio que change_my_password/reset_password más
        arriba.
      - Queda logueado quién hizo esto y sobre qué cuenta (logger.warning
        más abajo) -- un endpoint que le da a un admin la contraseña de
        cualquier otra cuenta necesita dejar rastro, mismo espíritu que
        el logging de intentos fallidos de verificar_password_admin (ver
        app/dependencies/auth.py).

    FEATURE (11/09/2026, pedido del cliente): un agregado más sobre lo de
    arriba, para que el cliente no siga usando indefinidamente una
    contraseña temporal que un tercero (el admin) también conoce:
      - usuario.debe_cambiar_password queda en True -- la próxima vez que
        esa cuenta inicie sesión, el frontend le va a interponer una
        pantalla obligatoria para elegir una contraseña propia antes de
        dejarlo usar el resto de la tienda (ver
        CambiarPasswordObligatorio.jsx/SiteLayout.jsx y el comentario
        grande en Usuario.debe_cambiar_password, models/user.py).

    FIX (12/09/2026, pedido del cliente): "desactiva esa opción de envío de
    mail, en caso de la contraseña el mismo dueño se encargue de comunicarse
    por WhatsApp al cliente" -- este endpoint YA NO manda ningún mail de
    aviso (antes: enviar_notificacion_password_restablecida_admin). Ese mail
    iba a la MISMA casilla que, por definición, está llena/rota si hizo
    falta usar este endpoint en primer lugar -- rebotaba siempre, y esos
    rebotes se acumulaban en la casilla del dueño de la tienda (el
    SMTP_USER). De acá en más, avisarle al cliente que su contraseña cambió
    queda a cargo del propio admin/dueño por el mismo medio que ya usa para
    pasarle la contraseña nueva (teléfono, WhatsApp) -- no hace falta que el
    sistema mande nada por mail para esto.
    """
    confirmar_password_admin_rate_limiter(request)
    verificar_password_admin(body.password_actual, admin_actual, request)

    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    usuario.password_hash = get_password_hash(body.password_nueva)
    # FEATURE (11/09/2026, pedido del cliente): "que cuando se logue por
    # primera vez le aparezca un campo para colocar su contraseña nueva" --
    # prende la señal que el frontend usa para interponer una pantalla
    # obligatoria de cambio de contraseña la próxima vez que esta cuenta
    # entre (ver CambiarPasswordObligatorio.jsx/SiteLayout.jsx y el
    # comentario grande en Usuario.debe_cambiar_password, models/user.py).
    # Se apaga sola en cuanto el cliente elige una propia, por ese camino o
    # por cualquier otro cambio de contraseña (ver change_my_password/
    # reset_password más arriba).
    usuario.debe_cambiar_password = True
    revoke_all_refresh_tokens(db, usuario.id)
    db.commit()

    logger.warning(
        "Admin restableció la contraseña de otra cuenta -- admin_id=%s admin_email=%s usuario_id=%s usuario_email=%s",
        admin_actual.id,
        admin_actual.email,
        usuario.id,
        usuario.email,
    )
    # FIX (12/09/2026, pedido del cliente): acá antes iba el envío de
    # enviar_notificacion_password_restablecida_admin -- ver el FIX en el
    # docstring de esta función sobre por qué se sacó (rebotaba siempre a
    # la casilla llena del cliente). El aviso de que la contraseña cambió
    # ahora se lo da el admin al cliente por WhatsApp, junto con la
    # contraseña nueva -- no queda nada más que hacer acá después del
    # commit.


@router.post(
    "/{usuario_id}/marcar-email-verificado",
    response_model=UsuarioRead,
    dependencies=[Depends(bloquear_en_demo)],
)
def admin_mark_email_verified(
    usuario_id: int,
    admin_actual: Usuario = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Usuario:
    """Marcar el mail de CUALQUIER usuario como verificado, sin código.

    FEATURE (11/09/2026, pedido del cliente): mismo problema de fondo que
    admin_reset_password más arriba -- clientes con la casilla de mail
    llena a quienes nunca les llega el código (acá, el de
    POST /verificar-email al registrarse). A diferencia de la contraseña,
    esto NO es una vía de emergencia para "desbloquear" nada: el login
    (router/auth.py) nunca exigió email_verificado=True, así que esas
    cuentas ya pueden usarse con normalidad aunque este campo quede en
    False para siempre (ver también el aviso agregado en la pantalla
    "Verificá tu cuenta" del frontend, VerificarEmail.jsx). Este endpoint
    es, a propósito, solo para que un admin pueda dejar prolija la
    cuenta -- por ejemplo si ya confirmó la identidad del cliente por
    teléfono/WhatsApp y prefiere que no quede con el badge "Sin
    verificar" en el panel -- no para arreglar algo que esté roto.

    Justo por eso, y a diferencia de admin_reset_password/
    admin_update_user(role/is_active), NO pide confirmar con la
    contraseña del admin ni tiene rate limiter propio: marcar este campo
    no le da a nadie acceso a nada que no tuviera ya (no hay ningún
    Depends ni chequeo en el resto del código que lea email_verificado
    para permitir o negar una acción -- ver la búsqueda hecha para esta
    misma feature, 11/09/2026). Es un dato informativo, no una llave.
    Igual queda registrado quién lo hizo (logger.info abajo) por las
    dudas de que el día de mañana alguien necesite auditar esto.

    Idempotente: si ya estaba verificado, no hace nada y devuelve el
    usuario tal cual (mismo criterio que verify_email más arriba).

    FIX (12/09/2026, pedido del cliente): "desactiva esa opción de envío de
    mail ... que cuando se verifique la cuenta del cliente, en su próximo
    logueo le salte una pequeña alerta dentro de las misma app" -- este
    endpoint YA NO manda ningún mail (antes:
    enviar_notificacion_email_verificado_admin, que iba a la MISMA casilla
    llena/rota que motivó usar este endpoint en primer lugar, y por eso
    rebotaba siempre). En su lugar, prende
    usuario.debe_avisar_email_verificado -- el frontend lo lee de GET
    /users/me y, en el próximo login de ESTE cliente, le muestra un aviso
    no bloqueante (toast, ver el useEffect en SiteLayout.jsx) en vez de
    depender de que le llegue un mail. Ver el comentario grande junto al
    campo en Usuario.debe_avisar_email_verificado (models/user.py).
    """
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    if usuario.email_verificado:
        return usuario

    usuario.email_verificado = True
    # FIX (12/09/2026, pedido del cliente): a diferencia del viejo mail de
    # aviso (que iba DESPUÉS del commit, ver el comentario que tenía acá
    # antes), esta señal es puro estado de la propia fila -- va ANTES del
    # commit, junto con email_verificado, para que las dos se guarden en la
    # misma transacción. No hay ningún I/O externo (mail, etc.) de por
    # medio que justifique separarla en un best-effort aparte.
    usuario.debe_avisar_email_verificado = True
    db.commit()
    db.refresh(usuario)

    logger.info(
        "Admin marcó el mail de otra cuenta como verificado a mano -- admin_id=%s admin_email=%s usuario_id=%s usuario_email=%s",
        admin_actual.id,
        admin_actual.email,
        usuario.id,
        usuario.email,
    )

    return usuario