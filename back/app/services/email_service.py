"""Envío de mails transaccionales (códigos de verificación de mail y de
recuperar contraseña) vía SMTP.

Se usa smtplib de la librería estándar en vez de sumar una dependencia
nueva (fastapi-mail, un SDK de un proveedor, etc.): acá alcanza con
mandar, de a uno, un mail corto de texto/HTML sin adjuntos ni colas --
justo lo que ya trae Python sin nada más.
"""

import html
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import TYPE_CHECKING

from app.core.config import SMTP_FROM_NAME, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER

if TYPE_CHECKING:
    # Solo para el chequeo de tipos de enviar_notificacion_nueva_compra --
    # evita que este módulo (que hoy no depende de la base de datos ni de
    # los modelos) pase a importar app.models.order en tiempo de ejecución.
    from app.models.order import Pedido

logger = logging.getLogger("app")


def _esc(valor: str) -> str:
    """Escapar HTML antes de meter en un cuerpo_html cualquier valor que
    haya elegido el usuario (nombre, razon_social, telefono, email,
    nombre de producto). USAR ACÁ ADENTRO, nunca en cuerpo_texto (la parte
    de texto plano no corre riesgo de HTML injection, escaparla ahí solo
    ensuciaría el mail con "&lt;"/"&gt;" de más).

    Hallazgo #1 de la auditoría AppSec (2026-08-23): sin esto, alguien podía
    registrarse con razon_social = "<img src=x onerror=...>" y ese HTML
    crudo terminaba en el mail de "Nueva compra confirmada" que recibe la
    propia tienda -- no ejecuta JS real (esto es un mail, no una página),
    pero sí permite falsificar enlaces/texto dentro de un mail "de
    confianza" del propio sistema (phishing). Si el día de mañana se agrega
    OTRO campo de texto libre a un cuerpo_html (de un mail nuevo, o de este
    mismo archivo), pasarlo por acá también.
    """
    return html.escape(valor)


def _enviar_mail(destinatario: str, asunto: str, cuerpo_texto: str, cuerpo_html: str) -> bool:
    """Manda un mail. Nunca lanza: un problema de red/SMTP no debe tirar
    abajo el flujo que lo dispara (registrarse, pedir un código, etc.) --
    devuelve False y deja logueado el error para que quede auditable.

    Además, para /users/reenviar-verificacion y /users/olvide-password
    (que a propósito responden siempre lo mismo exista o no ese mail, para
    no filtrar qué cuentas existen -- ver router/users.py), que esta
    función devuelva False en vez de lanzar es lo que le permite a esos
    endpoints ignorar limpiamente el resultado sin un try/except propio.
    """
    mensaje = MIMEMultipart("alternative")
    mensaje["Subject"] = asunto
    mensaje["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    mensaje["To"] = destinatario
    # Primero la parte texto, después HTML -- por convención del formato
    # multipart/alternative, el cliente de mail muestra la ÚLTIMA parte que
    # sepa renderizar, así que HTML (más lindo) va al final.
    mensaje.attach(MIMEText(cuerpo_texto, "plain", "utf-8"))
    mensaje.attach(MIMEText(cuerpo_html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as servidor:
            servidor.starttls()
            servidor.login(SMTP_USER, SMTP_PASSWORD)
            servidor.sendmail(SMTP_USER, [destinatario], mensaje.as_string())
        return True
    except Exception:
        logger.exception("No se pudo enviar el mail a %s (asunto: %r)", destinatario, asunto)
        return False


def _plantilla_html(titulo: str, parrafo: str, codigo: str) -> str:
    """Mismo esqueleto visual para los dos tipos de mail de código -- solo
    cambian el título y el párrafo de contexto."""
    return f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f37021;">{SMTP_FROM_NAME}</h2>
      <h3>{titulo}</h3>
      <p>{parrafo}</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;
                text-align: center; background: #f5f6f8; padding: 16px;
                border-radius: 8px;">{codigo}</p>
      <p style="color: #64748b; font-size: 13px;">
        Este código vence en unos minutos. Si vos no pediste esto, podés
        ignorar este mail -- nadie más pudo hacer nada con tu cuenta solo
        por este correo.
      </p>
    </div>
    """


def enviar_codigo_verificacion_email(destinatario: str, nombre: str, codigo: str) -> bool:
    """Mail de "confirmá tu cuenta" tras registrarse."""
    asunto = f"Tu código para verificar tu cuenta en {SMTP_FROM_NAME}"
    cuerpo_texto = (
        f"Hola {nombre},\n\n"
        f"Tu código para verificar tu cuenta en {SMTP_FROM_NAME} es: {codigo}\n\n"
        "Si vos no creaste esta cuenta, podés ignorar este mail."
    )
    cuerpo_html = _plantilla_html(
        "Confirmá tu cuenta",
        f"Hola {_esc(nombre)}, usá este código para verificar tu cuenta:",
        codigo,
    )
    return _enviar_mail(destinatario, asunto, cuerpo_texto, cuerpo_html)


def enviar_codigo_cambio_email(destinatario: str, nombre: str, codigo: str) -> bool:
    """Mail de "confirmá tu nuevo email" -- destinatario es la dirección
    NUEVA que se quiere confirmar, no la actual de la cuenta (ver
    POST /users/me/email/solicitar en router/users.py)."""
    asunto = f"Tu código para confirmar tu nuevo email en {SMTP_FROM_NAME}"
    cuerpo_texto = (
        f"Hola {nombre},\n\n"
        f"Tu código para confirmar esta dirección como tu nuevo email en {SMTP_FROM_NAME} es: {codigo}\n\n"
        "Si vos no pediste este cambio, podés ignorar este mail -- tu email actual sigue siendo el mismo."
    )
    cuerpo_html = _plantilla_html(
        "Confirmá tu nuevo email",
        f"Hola {_esc(nombre)}, usá este código para confirmar esta dirección como tu nuevo email:",
        codigo,
    )
    return _enviar_mail(destinatario, asunto, cuerpo_texto, cuerpo_html)


def enviar_notificacion_nueva_compra(pedido: "Pedido") -> bool:
    """Avisa a la propia tienda que se confirmó el pago de un pedido.

    Destinatario fijo: SMTP_USER, la misma cuenta que ya manda el resto de
    los mails de esta app -- no hace falta configurar una casilla de
    "ventas" aparte, funciona apenas está seteado SMTP_USER/SMTP_PASSWORD.

    "pedido" tiene que venir con .usuario y .detalles[].producto ya
    cargados (ver app/services/order_notification_service.py, que es quien
    llama a esta función) -- acá adentro no se toca la base, solo se arma
    y manda el mail con lo que ya viene en el objeto.
    """
    comprador = pedido.usuario
    lineas_texto = "\n".join(
        f"- {detalle.cantidad} x "
        f"{detalle.producto.nombre if detalle.producto else '(producto eliminado)'} "
        f"-- $ {detalle.subtotal:.2f}"
        for detalle in pedido.detalles
    )
    lineas_html = "".join(
        f"""
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #e5e7eb;">
            {detalle.cantidad} x {_esc(detalle.producto.nombre if detalle.producto else '(producto eliminado)')}
          </td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: right; white-space: nowrap;">
            $ {detalle.subtotal:.2f}
          </td>
        </tr>
        """
        for detalle in pedido.detalles
    )

    asunto = f"Nueva compra confirmada -- Pedido #{pedido.id}"
    cuerpo_texto = (
        f"Se confirmó el pago del pedido #{pedido.id}.\n\n"
        f"Comprador: {comprador.razon_social} <{comprador.email}> -- tel. {comprador.telefono}\n\n"
        f"Detalle:\n{lineas_texto}\n\n"
        f"Total: $ {pedido.total_pedido:.2f}\n"
    )
    cuerpo_html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f37021;">{SMTP_FROM_NAME}</h2>
      <h3>Nueva compra confirmada -- Pedido #{pedido.id}</h3>
      <p>
        <strong>{_esc(comprador.razon_social)}</strong><br>
        {_esc(comprador.email)}<br>
        Tel. {_esc(comprador.telefono)}
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        {lineas_html}
      </table>
      <p style="font-size: 18px; font-weight: bold; text-align: right;">
        Total: $ {pedido.total_pedido:.2f}
      </p>
    </div>
    """
    return _enviar_mail(SMTP_USER, asunto, cuerpo_texto, cuerpo_html)


# FIX (12/09/2026, pedido del cliente, sin borrar): esta función quedó SIN
# USO -- admin_mark_email_verified (router/users.py) ya no la llama. Mandaba
# este mail a la MISMA casilla que, por definición, está llena/rota si hizo
# falta usar ese endpoint en primer lugar, así que rebotaba siempre y esos
# rebotes se acumulaban en la casilla del dueño de la tienda (el SMTP_USER).
# Se reemplazó por un aviso no bloqueante DENTRO de la app (ver
# Usuario.debe_avisar_email_verificado en models/user.py y el useEffect en
# SiteLayout.jsx), que no depende para nada de que el mail del cliente
# funcione. Se deja la función acá (no se borra) por si el día de mañana
# hace falta retomar el envío por mail para este caso.
def enviar_notificacion_email_verificado_admin(destinatario: str, nombre: str) -> bool:
    """Mail que avisa que un ADMIN marcó la cuenta como verificada a mano,
    sin el código habitual de "confirmá tu cuenta" (ver
    admin_mark_email_verified en router/users.py -- vía para cuando la
    casilla de mail está llena y el código nunca llega). Es solo un aviso
    informativo, no requiere ninguna acción del cliente -- por eso, a
    diferencia de los mails de código de más arriba, no lleva ningún PIN.

    FEATURE (11/09/2026, pedido del cliente)."""
    asunto = f"Tu cuenta en {SMTP_FROM_NAME} fue verificada"
    cuerpo_texto = (
        f"Hola {nombre},\n\n"
        f"Te avisamos que un administrador de {SMTP_FROM_NAME} verificó tu cuenta a mano.\n\n"
        "Ya podés usarla con total normalidad. Si no esperabas este mail, podés ignorarlo -- "
        "no hace falta que hagas nada de tu lado."
    )
    cuerpo_html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f37021;">{SMTP_FROM_NAME}</h2>
      <h3>Tu cuenta fue verificada</h3>
      <p>
        Hola {_esc(nombre)}, te avisamos que un administrador de {SMTP_FROM_NAME} verificó
        tu cuenta a mano. Ya podés usarla con total normalidad.
      </p>
      <p style="color: #64748b; font-size: 13px;">
        Si no esperabas este mail, podés ignorarlo -- no hace falta que hagas nada de tu lado.
      </p>
    </div>
    """
    return _enviar_mail(destinatario, asunto, cuerpo_texto, cuerpo_html)


# FIX (12/09/2026, pedido del cliente, sin borrar): esta función quedó SIN
# USO -- admin_reset_password (router/users.py) ya no la llama. Mismo
# motivo que enviar_notificacion_email_verificado_admin más arriba: mandaba
# este mail a la MISMA casilla llena/rota que motivó usar ese endpoint en
# primer lugar, así que rebotaba siempre. De acá en más, avisarle al
# cliente que su contraseña cambió queda a cargo del propio admin/dueño por
# WhatsApp (el mismo medio que ya usa para pasarle la contraseña nueva), no
# de un mail del sistema. Se deja la función acá (no se borra) por si el
# día de mañana hace falta retomar el envío por mail para este caso.
def enviar_notificacion_password_restablecida_admin(destinatario: str, nombre: str) -> bool:
    """Mail que avisa que un ADMIN restableció la contraseña de la cuenta a
    mano (ver admin_reset_password en router/users.py -- vía de emergencia
    para clientes con la casilla de mail llena, bloqueados fuera de su
    cuenta). A propósito NO incluye la contraseña nueva en ningún lado de
    este mail -- el admin ya se la comunicó al cliente por otro medio
    (teléfono, WhatsApp) después de confirmar su identidad; mandarla
    también por mail sería exponerla en un canal que, justamente, puede
    estar comprometido (por eso existe este endpoint en primer lugar). Este
    mail es solo la notificación de seguridad de que el cambio ocurrió, así
    el dueño real de la cuenta se entera aunque no haya sido él quien lo
    pidió -- y sabe que, si no fue él, algo raro está pasando.

    FEATURE (11/09/2026, pedido del cliente)."""
    asunto = f"Tu contraseña en {SMTP_FROM_NAME} fue cambiada"
    cuerpo_texto = (
        f"Hola {nombre},\n\n"
        f"Te avisamos que un administrador de {SMTP_FROM_NAME} restableció la contraseña de tu cuenta.\n\n"
        "La próxima vez que inicies sesión, te vamos a pedir que elijas una contraseña nueva y propia "
        "antes de seguir navegando.\n\n"
        "Si vos no pediste este cambio, escribinos apenas puedas."
    )
    cuerpo_html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f37021;">{SMTP_FROM_NAME}</h2>
      <h3>Tu contraseña fue cambiada</h3>
      <p>
        Hola {_esc(nombre)}, te avisamos que un administrador de {SMTP_FROM_NAME} restableció la
        contraseña de tu cuenta.
      </p>
      <p>
        La próxima vez que inicies sesión, te vamos a pedir que elijas una contraseña nueva y propia
        antes de seguir navegando.
      </p>
      <p style="color: #64748b; font-size: 13px;">
        Si vos no pediste este cambio, escribinos apenas puedas.
      </p>
    </div>
    """
    return _enviar_mail(destinatario, asunto, cuerpo_texto, cuerpo_html)


def enviar_codigo_recuperar_password(destinatario: str, nombre: str, codigo: str) -> bool:
    """Mail de "recuperar contraseña"."""
    asunto = f"Tu código para recuperar tu contraseña en {SMTP_FROM_NAME}"
    cuerpo_texto = (
        f"Hola {nombre},\n\n"
        f"Tu código para restablecer tu contraseña en {SMTP_FROM_NAME} es: {codigo}\n\n"
        "Si vos no pediste esto, tu contraseña sigue siendo la misma -- podés "
        "ignorar este mail."
    )
    cuerpo_html = _plantilla_html(
        "Recuperar contraseña",
        f"Hola {_esc(nombre)}, usá este código para elegir una contraseña nueva:",
        codigo,
    )
    return _enviar_mail(destinatario, asunto, cuerpo_texto, cuerpo_html)
