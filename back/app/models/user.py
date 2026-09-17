from sqlalchemy import CheckConstraint, Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum

class condicionIVA(enum.Enum):
    responsable_inscripto = "responsable inscripto"
    monotributista = "monotributista"
    consumidor_final = "consumidor final"
    exento = "exento"

class TipoDocumento(enum.Enum):
    dni = "DNI"
    cuit = "CUIT"
    cuil = "CUIL"

# FEATURE (26/08/2026, pedido del cliente): provincia del domicilio, como
# ENUM nativo de Postgres -- igual criterio que TipoDocumento/condicionIVA
# arriba, NO como String (a propósito, lo pidió el cliente): la lista de
# provincias argentinas es un conjunto fijo y estable (no cambia como
# "role", que si necesita crecer usa CheckConstraint en vez de Enum, ver
# el comentario debajo de esta clase), así que un ENUM de Postgres con
# estos 24 valores fijos es la elección correcta acá. El nombre de cada
# miembro (buenos_aires, caba, etc.) es lo que se guarda en la base; el
# string (Buenos Aires, Ciudad Autónoma de Buenos Aires, etc.) es lo que
# viaja en el JSON hacia/desde el frontend -- mismo patrón que
# TipoDocumento/condicionIVA. Orden alfabético, para que sea fácil ver
# rápido si falta o sobra alguna.
class Provincia(enum.Enum):
    buenos_aires = "Buenos Aires"
    catamarca = "Catamarca"
    chaco = "Chaco"
    chubut = "Chubut"
    caba = "Ciudad Autónoma de Buenos Aires"
    cordoba = "Córdoba"
    corrientes = "Corrientes"
    entre_rios = "Entre Ríos"
    formosa = "Formosa"
    jujuy = "Jujuy"
    la_pampa = "La Pampa"
    la_rioja = "La Rioja"
    mendoza = "Mendoza"
    misiones = "Misiones"
    neuquen = "Neuquén"
    rio_negro = "Río Negro"
    salta = "Salta"
    san_juan = "San Juan"
    san_luis = "San Luis"
    santa_cruz = "Santa Cruz"
    santa_fe = "Santa Fe"
    santiago_del_estero = "Santiago del Estero"
    tierra_del_fuego = "Tierra del Fuego, Antártida e Islas del Atlántico Sur"
    tucuman = "Tucumán"

# Roles de usuario. String simple + CheckConstraint acá abajo, no un Enum
# nativo de Postgres como tipo_documento/condicion_iva arriba: sumarle un
# valor a un ENUM de Postgres exige ALTER TYPE ... ADD VALUE, que Postgres
# no permite dentro de una transacción -- complicaría el día que haga
# falta un cuarto rol. Con CheckConstraint, sumar un rol es solo cambiar
# la constraint en una migración común y transaccional.
ROLES_VALIDOS = ("admin", "ayudante", "cliente")

class Usuario(Base):
    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'ayudante', 'cliente')", name="ck_usuarios_role_valido"),
    )

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    # unique=True quitado a propósito (hallazgo R-07 del informe de
    # auditoría): dos clientes distintos pueden llamarse igual sin ser la
    # misma persona/cuenta. Lo que sí debe ser único es email y
    # numero_documento (abajo), que ya lo son.
    razon_social = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    tipo_documento = Column(Enum(TipoDocumento), default=TipoDocumento.dni, nullable=False) # Eliminado el unique=True
    numero_documento = Column(String(255), unique=True, nullable=False)
    condicion_iva = Column(Enum(condicionIVA), default=condicionIVA.consumidor_final, nullable=False) # Eliminado el unique=True
    telefono = Column(String(30), nullable=False)
    # FIX (26/08/2026, pedido del cliente): direccion, provincia, ciudad y
    # codigo_postal son obligatorios desde el formulario (ver
    # app/schemas/user.py) -- pero las cuatro columnas se dejan
    # nullable=True acá a propósito: ya existen cuentas registradas antes
    # de exigir estos campos (algunas incluso antes de que existiera
    # provincia/codigo_postal), y no tiene sentido, ni es seguro, forzar
    # retroactivamente un valor a nivel de base de datos para esas cuentas
    # viejas. La obligatoriedad se aplica en Pydantic (UsuarioCreate) para
    # cuentas nuevas, no acá.
    direccion = Column(String(255), nullable=True)
    # FEATURE (26/08/2026, pedido del cliente): ciudad del domicilio,
    # separada de direccion (que es solo calle/altura) -- mismo criterio de
    # columna que razon_social/telefono, String simple: a diferencia de
    # provincia, el universo de ciudades argentinas es demasiado grande
    # para un ENUM fijo, así que queda como texto libre.
    ciudad = Column(String(255), nullable=True)
    # FEATURE (26/08/2026, pedido del cliente): provincia y código postal
    # del domicilio -- mismo criterio que direccion/ciudad (de las que son
    # parte lógica). provincia es Enum, no String -- ver la clase
    # Provincia más arriba. codigo_postal queda como String(8): acepta
    # tanto el formato clásico de 4 dígitos como el CPA alfanumérico (ej.
    # "S2500FRV", el del propio local en Contacto.jsx del frontend) -- ver
    # la validación en app/schemas/user.py.
    provincia = Column(Enum(Provincia), nullable=True)
    codigo_postal = Column(String(8), nullable=True)
    is_active = Column(Boolean, default=True)
    # admin: acceso total al panel de administración. ayudante: rol de
    # staff -- hoy solo puede ver todos los pedidos (GET /pedidos/todos),
    # pensado para ampliarse más adelante. cliente: el default, un
    # comprador normal. Reemplaza al viejo campo booleano is_admin
    # (todo-o-nada) por estos tres niveles.
    role = Column(String, nullable=False, default="cliente")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # False al registrarse -- se pone en True cuando confirma el código de
    # 6 dígitos que se le manda por mail (ver POST /users/verificar-email).
    # Las cuentas que ya existían antes de este campo arrancan en True (ver
    # server_default en la migración): no tiene sentido "desverificar"
    # retroactivamente cuentas que ya venían funcionando. Hoy el login NO
    # exige email_verificado=True (ver router/auth.py) -- es una decisión
    # a propósito para no bloquear a nadie si el mail de verificación se
    # pierde o tarda; si en el futuro se quiere exigirlo, es un solo chequeo
    # más en login().
    email_verificado = Column(Boolean, default=False, nullable=False)

    # FEATURE (11/09/2026, pedido del cliente): False para toda cuenta,
    # salvo el momento puntual entre que un admin le restablece la
    # contraseña a mano (ver admin_reset_password en router/users.py --
    # vía de emergencia para clientes con la casilla de mail llena) y la
    # próxima vez que esa cuenta cambia su propia contraseña. Mientras esté
    # en True, el FRONTEND (ver CambiarPasswordObligatorio.jsx y el chequeo
    # en SiteLayout.jsx) le muestra a ese cliente, apenas vuelve a entrar,
    # una pantalla obligatoria para elegir una contraseña propia en vez de
    # seguir usando la temporal que le dio el admin por teléfono/WhatsApp
    # -- el backend NO bloquea nada por su cuenta con este campo (login
    # sigue funcionando igual con la temporal), es pura señal para esa
    # pantalla. Se apaga solo (vuelve a False) en CUALQUIER cambio de
    # contraseña exitoso, sea por esa pantalla obligatoria o por el cambio
    # normal de Privacidad/"olvidé mi contraseña" -- ver change_my_password
    # y reset_password en router/users.py.
    debe_cambiar_password = Column(Boolean, default=False, nullable=False)

    # FEATURE (12/09/2026, pedido del cliente): False para toda cuenta,
    # salvo el momento puntual entre que un admin le marca el mail como
    # verificado a mano (ver admin_mark_email_verified en router/users.py --
    # misma vía de emergencia que debe_cambiar_password, para cuando la
    # casilla de mail del cliente está llena) y la próxima vez que ese
    # cliente inicia sesión. Mismo patrón que debe_cambiar_password de acá
    # arriba: el FRONTEND (ver el useEffect en SiteLayout.jsx) lo lee de
    # GET /users/me y, si viene en True, le muestra a ese cliente un aviso
    # NO bloqueante (un toast, no una pantalla obligatoria como
    # CambiarPasswordObligatorio.jsx -- acá no hace falta ninguna acción del
    # cliente, es puramente informativo) avisándole que su cuenta ya fue
    # verificada. El frontend después llama a POST /users/me/aviso-email-
    # verificado para apagar la señal (ver ese endpoint en router/users.py),
    # así el aviso no vuelve a aparecer en el próximo login.
    #
    # Reemplaza al mail de aviso que existía antes
    # (enviar_notificacion_email_verificado_admin, todavía en
    # email_service.py pero sin uso -- ver el comentario ahí): ese mail se
    # mandaba a la MISMA casilla que, por definición, está llena/rota si
    # hizo falta usar admin_mark_email_verified en primer lugar -- siempre
    # rebotaba, y los rebotes se acumulaban en la casilla del dueño de la
    # tienda. Este aviso en la app reemplaza esa notificación sin depender
    # para nada del mail del cliente.
    debe_avisar_email_verificado = Column(Boolean, default=False, nullable=False)

    pedidos = relationship("Pedido", back_populates="usuario")
    tokens = relationship("RefreshTokenModel", back_populates="usuario", cascade="all, delete-orphan")
    codigos_verificacion = relationship(
        "CodigoVerificacion", back_populates="usuario", cascade="all, delete-orphan"
    )
    # Productos que este usuario marcó con la estrella de favorito (ver
    # app/models/favorite.py). cascade="all, delete-orphan": si la cuenta
    # se borra, sus favoritos no tienen sentido sueltos en la tabla.
    favoritos = relationship("Favorito", back_populates="usuario", cascade="all, delete-orphan")


class RefreshTokenModel(Base):
    """
    Guarda los identificadores únicos (jti) de los refresh tokens
    para permitir rotación segura y revocación de sesiones.
    """
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    revocado = Column(Boolean, default=False, nullable=False)
    # Registrar cuándo se consumió o revocó el token facilita auditoría de sesiones.
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario", back_populates="tokens")


class PropositoCodigo(str, enum.Enum):
    """Para qué se emitió un código de 6 dígitos -- el mismo mecanismo
    (CodigoVerificacion de acá abajo) sirve para más de un flujo, y no
    tendría sentido que un código pedido para "recuperar contraseña" sirva
    también para verificar el mail, o viceversa.

    Hereda de (str, enum.Enum) a propósito -- igual que se decidió para
    ROLES_VALIDOS/role más arriba, este campo se guarda como texto simple
    (proposito, columna String + CheckConstraint) y NO como un ENUM nativo
    de Postgres: sumar un valor a un ENUM de Postgres exige
    ALTER TYPE ... ADD VALUE, una operación molesta de manejar en una
    migración transaccional común. Con (str, Enum), cada miembro ES un
    string (PropositoCodigo.cambiar_email == "cambiar_email" da True), así
    que se puede seguir comparando/asignando con el mismo código de
    siempre sin tener que acordarse de usar .value en todos lados.
    """

    verificacion_email = "verificacion_email"
    recuperar_password = "recuperar_password"
    # Cambiar el email desde "Privacidad" (ver POST /users/me/email/solicitar
    # y /confirmar en router/users.py): a diferencia de los otros dos
    # propósitos, el código de este se manda a la casilla NUEVA (todavía no
    # guardada en usuarios.email), no a la actual -- por eso CodigoVerificacion
    # necesita guardar además a qué email_nuevo corresponde (ver abajo).
    cambiar_email = "cambiar_email"


class CodigoVerificacion(Base):
    """Código de 6 dígitos de un solo uso, mandado por mail, para
    confirmar que quien está haciendo la acción (verificar el mail al
    registrarse, restablecer una contraseña olvidada, cambiar de email, y a
    futuro cualquier otra acción sensible) tiene acceso a esa casilla de
    correo.

    El código en sí NUNCA se guarda en texto plano (codigo_hash, mismo
    hashing que las contraseñas -- ver app/auth/security.py): si la base
    se filtrara, no debería alcanzar para generar códigos válidos. intentos
    cuenta los intentos fallidos de ESTE código puntual (ver
    app/services/verification_service.py): tras varios, se invalida solo
    aunque todavía no haya expirado, para no dejar la puerta abierta a
    probar los 1.000.000 de combinaciones posibles de un PIN de 6 dígitos.
    """

    __tablename__ = "codigos_verificacion"
    __table_args__ = (
        CheckConstraint(
            "proposito IN ('verificacion_email', 'recuperar_password', 'cambiar_email')",
            name="ck_codigos_verificacion_proposito_valido",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    proposito = Column(String(30), nullable=False)
    codigo_hash = Column(String(255), nullable=False)
    # Solo se usa (y solo tiene sentido) para proposito=cambiar_email: la
    # dirección nueva que se va a confirmar si el código resulta válido.
    # Para los otros dos propósitos queda en NULL -- la acción se aplica
    # directamente sobre el email/password ya existentes del usuario.
    email_nuevo = Column(String(255), nullable=True)
    intentos = Column(Integer, default=0, nullable=False)
    usado = Column(Boolean, default=False, nullable=False)
    expira_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario", back_populates="codigos_verificacion")