"""Esquemas de respuesta para la integración de pagos con Mercado Pago."""

from pydantic import BaseModel


class PedidoPagoResponse(BaseModel):
    """Lo que necesita el frontend para redirigir al comprador a pagar."""

    preference_id: str
    init_point: str
