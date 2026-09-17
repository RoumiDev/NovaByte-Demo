"""Esquemas Pydantic para favoritos (ver app/models/favorite.py y los
endpoints /productos/{id}/favorito y /productos/favoritos en
router/products.py)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.product import ProductoRead


class FavoritoRead(BaseModel):
    """Un producto favorito del usuario autenticado -- pensado para una
    futura pantalla de "Mis favoritos". Incluye el producto completo (no
    solo su id) para que esa pantalla no tenga que pedirlo aparte uno por
    uno."""

    model_config = ConfigDict(from_attributes=True)

    producto_id: int
    created_at: datetime
    producto: ProductoRead


class FavoritoEstadoResponse(BaseModel):
    """Respuesta de GET/POST/DELETE /productos/{id}/favorito: si el
    producto quedó marcado como favorito del usuario autenticado. La usa
    ProductoDetalle.jsx (frontend) para pintar la estrella llena o vacía."""

    es_favorito: bool
