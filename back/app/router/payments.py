"""Recepción de notificaciones (webhook) de Mercado Pago.

Separado de router/orders.py a propósito: esto no es una acción que hace
un usuario logueado sobre "su" pedido, es Mercado Pago llamando a esta API
directamente. No lleva ninguna dependencia de autenticación JWT -- la
validación acá es la firma x-signature (ver
app/services/mercadopago_service.validar_firma_webhook), no un Bearer token.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.order import EstadoOrden, Pedido
from app.services.mercadopago_service import MercadoPagoError, obtener_pago, validar_firma_webhook
from app.services.order_notification_service import notificar_compra_confirmada

logger = logging.getLogger("app.pagos")
router = APIRouter()


@router.post("/webhooks/mercadopago", status_code=status.HTTP_200_OK)
async def webhook_mercadopago(request: Request, db: Session = Depends(get_db)) -> dict:
    """Recibir el aviso de Mercado Pago cuando cambia el estado de un pago.

    Siempre que la firma sea válida, responde 200 -- incluso si el evento
    no nos interesa o ya fue procesado antes -- para que Mercado Pago no
    siga reintentando una notificación que ya entendimos. Solo devuelve un
    código de error real (401 firma inválida, 502 fallo hablando con la
    API de Mercado Pago) cuando corresponde reintentar o investigar.
    """
    x_signature = request.headers.get("x-signature", "")
    x_request_id = request.headers.get("x-request-id", "")
    data_id = request.query_params.get("data.id", "")

    if not validar_firma_webhook(x_signature, x_request_id, data_id):
        logger.warning("Webhook de Mercado Pago con firma invalida o ausente (data.id=%s)", data_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firma inválida")

    body = await request.json()
    if body.get("type") != "payment":
        # Otros tópicos (merchant_order, point_integration_wh, etc.) no
        # aplican a este flujo -- se ignoran sin error.
        return {"status": "ignored"}

    payment_id = str(body.get("data", {}).get("id") or data_id or "")
    if not payment_id:
        return {"status": "ignored"}

    try:
        # FIX (01/09/2026, hallazgo CRÍTICO del informe de auditoría de
        # rendimiento y concurrencia): obtener_pago() es una llamada HTTP
        # sincrónica al SDK de Mercado Pago. Esta ruta es async def (hace
        # falta para el "await request.json()" de más arriba), así que
        # llamarla directo acá bloquearía el único event loop de FastAPI --
        # con --workers 1 (ver guía de despliegue, necesario por el
        # BackgroundScheduler), eso congela la API ENTERA para todos los
        # usuarios mientras dura la llamada, no solo esta notificación
        # puntual. run_in_threadpool la corre en un hilo aparte y libera el
        # event loop mientras se espera la respuesta.
        pago = await run_in_threadpool(obtener_pago, payment_id)
    except MercadoPagoError:
        # Error transitorio: 502 para que Mercado Pago reintente más tarde
        # en vez de darlo por perdido.
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="No se pudo verificar el pago")

    pedido_id_raw = pago.get("external_reference")
    estado_pago = pago.get("status")
    if not pedido_id_raw or not estado_pago:
        return {"status": "ignored"}

    try:
        pedido_id = int(pedido_id_raw)
    except ValueError:
        logger.warning("Webhook con external_reference no numerico: %r", pedido_id_raw)
        return {"status": "ignored"}

    if estado_pago != "approved":
        # pending, rejected, in_process, etc.: no tocamos el pedido, el
        # comprador puede reintentar el pago con el mismo link.
        return {"status": "ignored", "mp_status": estado_pago}

    # FIX (01/09/2026): igual que obtener_pago() más arriba, el UPDATE a la
    # base y notificar_compra_confirmada() (que termina mandando un mail
    # por SMTP, también sincrónico) son operaciones bloqueantes -- se
    # agrupan en _confirmar_pago_en_db() de acá abajo y se corren juntas en
    # threadpool por el mismo motivo, en vez de bloquear el event loop.
    await run_in_threadpool(_confirmar_pago_en_db, db, pedido_id, payment_id)

    return {"status": "processed"}


def _confirmar_pago_en_db(db: Session, pedido_id: int, payment_id: str) -> None:
    """Aplicar la transición atómica pendiente -> pagado y, si esta llamada
    fue la que efectivamente la logró, disparar el aviso de compra
    confirmada.

    FIX (01/09/2026, hallazgo CRÍTICO del informe de auditoría de
    rendimiento y concurrencia): separada de webhook_mercadopago() para
    poder correr estas dos operaciones bloqueantes (el UPDATE/commit a la
    base y el mail de order_notification_service, que usa smtplib
    sincrónico) juntas en una sola llamada a run_in_threadpool, en vez de
    ejecutarlas directo sobre el event loop de esa ruta async -- que es lo
    que hoy congela la API entera para todos los usuarios durante cada
    notificación de pago real.
    """
    # Transición atómica pendiente -> pagado, mismo patrón que
    # update_order_status: si Mercado Pago reintenta la misma notificación
    # (o llegan dos casi simultáneas), la segunda no encuentra una fila en
    # estado "pendiente" para actualizar y no hace nada.
    result = db.execute(
        update(Pedido)
        .where(Pedido.id == pedido_id, Pedido.estado == EstadoOrden.pendiente)
        .values(estado=EstadoOrden.pagado, mp_payment_id=payment_id)
    )
    db.commit()
    if result.rowcount == 1:
        logger.info("Pedido %s marcado como pagado (mp_payment_id=%s)", pedido_id, payment_id)
        # Best-effort, ver order_notification_service.py -- si el mail
        # falla no vuelve a intentarlo ni hace fallar este webhook, el pago
        # ya quedó confirmado y guardado en la línea de arriba.
        notificar_compra_confirmada(db, pedido_id)
