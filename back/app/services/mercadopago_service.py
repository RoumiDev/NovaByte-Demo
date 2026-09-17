"""Integración con Mercado Pago Checkout Pro: creación de preferencias de
pago y validación de la firma de los webhooks de notificación.

Referencia oficial:
- Crear preferencia: https://www.mercadopago.com.ar/developers/es/reference/preferences/_checkout_preferences/post
- Webhooks y firma:  https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/notifications/webhooks
"""

import hashlib
import hmac
import logging

import mercadopago

from app.core.config import (
    API_PUBLIC_BASE_URL,
    MP_ACCESS_TOKEN,
    MP_FAILURE_URL,
    MP_PENDING_URL,
    MP_SUCCESS_URL,
    MP_WEBHOOK_SECRET,
)
from app.models.order import Pedido

logger = logging.getLogger("app.mercadopago")

_sdk = mercadopago.SDK(MP_ACCESS_TOKEN)


class MercadoPagoError(RuntimeError):
    """Error de comunicación con la API de Mercado Pago (timeout, rechazo, etc.)."""


def crear_preferencia(pedido: Pedido) -> dict:
    """Crear una preferencia de Checkout Pro para un pedido ya persistido.

    Requiere que pedido.detalles venga con producto ya cargado (join/
    selectinload), para poder armar cada línea de "items" con el nombre
    real del producto. El monto de cada línea sale siempre de
    precio_unitario/cantidad ya calculados y guardados en PedidoDetalle en
    el momento del checkout -- acá tampoco se recalcula nada a partir de
    datos del cliente, es la misma garantía que ya tiene create_order().
    """
    items = [
        {
            "id": str(detalle.producto_id),
            "title": detalle.producto.nombre if detalle.producto else f"Producto {detalle.producto_id}",
            "quantity": detalle.cantidad,
            # Argentina/ARS: coherente con el resto del proyecto (condicion_iva,
            # tipo_documento DNI/CUIT/CUIL, tipo_factura AFIP). Si el día de
            # mañana hay ventas en otra moneda, esto necesita salir de config.
            "currency_id": "ARS",
            "unit_price": float(detalle.precio_unitario),
        }
        for detalle in pedido.detalles
    ]

    preference_data = {
        "items": items,
        "external_reference": str(pedido.id),
        "back_urls": {
            "success": MP_SUCCESS_URL,
            "failure": MP_FAILURE_URL,
            "pending": MP_PENDING_URL,
        },
        "notification_url": f"{API_PUBLIC_BASE_URL}/api/v1/pagos/webhooks/mercadopago",
        "statement_descriptor": "LTI INFORMATICA",
    }

    # "auto_return" hace que Mercado Pago redirija solo (sin que el
    # comprador tenga que tocar "Volver al sitio") apenas se resuelve el
    # pago. Pero Mercado Pago exige que back_urls.success sea una URL
    # https válida para poder usarlo -- si no, RECHAZA toda la creación
    # de la preferencia (no solo ignora la redirección automática), y
    # crear_preferencia() explota con MercadoPagoError. En desarrollo
    # local MP_SUCCESS_URL suele ser http://localhost:3000/... (no
    # https), así que acá lo omitimos: el comprador vuelve igual, solo
    # que con un clic en el botón de Mercado Pago en vez de automático.
    # Con un dominio https real (producción) esto se activa solo.
    if MP_SUCCESS_URL.startswith("https://"):
        preference_data["auto_return"] = "approved"

    try:
        result = _sdk.preference().create(preference_data)
    except Exception as error:  # errores de red/timeout del SDK
        logger.exception("Fallo de comunicacion creando preferencia para pedido %s", pedido.id)
        raise MercadoPagoError("No se pudo comunicar con Mercado Pago.") from error

    if result.get("status") not in (200, 201):
        logger.error("Mercado Pago rechazo la creacion de preferencia para pedido %s: %s", pedido.id, result)
        raise MercadoPagoError("Mercado Pago rechazó la creación de la preferencia de pago.")

    response = result["response"]
    return {"id": response["id"], "init_point": response["init_point"]}


def obtener_pago(payment_id: str) -> dict:
    """Consultar el estado REAL de un pago contra la API de Mercado Pago.

    Nunca se confía en el estado que venga embebido en el cuerpo de un
    webhook -- ese cuerpo solo avisa "pasó algo con este id de pago"; la
    fuente de verdad es siempre esta consulta directa a la API. Esto,
    junto con validar_firma_webhook(), es lo que impide que alguien
    falsifique una notificación de "pago aprobado" sin haber pagado nada.
    """
    try:
        result = _sdk.payment().get(payment_id)
    except Exception as error:
        logger.exception("Fallo de comunicacion consultando el pago %s", payment_id)
        raise MercadoPagoError("No se pudo comunicar con Mercado Pago.") from error

    if result.get("status") != 200:
        logger.error("No se pudo obtener el pago %s de Mercado Pago: %s", payment_id, result)
        raise MercadoPagoError(f"No se pudo obtener el pago {payment_id} de Mercado Pago.")
    return result["response"]


def buscar_pago_aprobado(pedido_id: int) -> dict | None:
    """Buscar directamente en Mercado Pago si existe un pago aprobado para
    este pedido, sin depender de que haya llegado el webhook.

    Existe para reconciliar manualmente: si el webhook nunca llegó (por
    ejemplo, el túnel público de desarrollo estaba caído justo cuando el
    comprador pagó), el pedido queda "pendiente" en la base para siempre
    aunque Mercado Pago sí haya cobrado. Esta función consulta el estado
    real por external_reference, igual que obtener_pago() consulta por id
    -- misma garantía: nunca se confía en nada que no sea la propia API de
    Mercado Pago.
    """
    try:
        result = _sdk.payment().search(filters={"external_reference": str(pedido_id)})
    except Exception as error:
        logger.exception("Fallo de comunicacion buscando pagos del pedido %s", pedido_id)
        raise MercadoPagoError("No se pudo comunicar con Mercado Pago.") from error

    if result.get("status") != 200:
        logger.error("No se pudo buscar pagos del pedido %s en Mercado Pago: %s", pedido_id, result)
        raise MercadoPagoError("No se pudo consultar el estado del pago.")

    for pago in result["response"].get("results", []):
        if pago.get("status") == "approved":
            return pago
    return None


def validar_firma_webhook(x_signature: str, x_request_id: str, data_id: str) -> bool:
    """Validar la firma HMAC-SHA256 de una notificación de webhook.

    Sin esto, cualquiera que descubra la URL del webhook podría mandar un
    POST fingiendo "este pago se aprobó" y marcar pedidos como pagados sin
    que nadie haya pagado un peso -- el manifest y el algoritmo siguen
    exactamente el formato documentado por Mercado Pago (header
    x-signature con formato "ts=...,v1=...", HMAC-SHA256 en hex sobre
    "id:{data.id};request-id:{x-request-id};ts:{ts};").
    """
    if not x_signature or not x_request_id or not data_id:
        return False

    partes = dict(parte.split("=", 1) for parte in x_signature.split(",") if "=" in parte)
    ts = partes.get("ts")
    v1 = partes.get("v1")
    if not ts or not v1:
        return False

    manifest = f"id:{data_id.lower()};request-id:{x_request_id};ts:{ts};"
    firma_calculada = hmac.new(
        MP_WEBHOOK_SECRET.encode("utf-8"), manifest.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    # Comparación en tiempo constante: comparar con == filtraría por
    # timing cuánto de la firma coincide, en teoría explotable.
    return hmac.compare_digest(firma_calculada, v1)
