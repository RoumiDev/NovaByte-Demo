// Llamadas a los endpoints de pedidos y pago (app/router/orders.py).
import { apiClient } from "./client";

/** Refleja PedidoCreate (app/schemas/order.py): detalles = [{producto_id, cantidad}]. */
export function crearPedido({ detalles, tipoFactura } = {}) {
  return apiClient.post("/pedidos/", {
    detalles,
    tipo_factura: tipoFactura || null,
  });
}

/** Pedidos del usuario autenticado (nunca los de otro). */
export function listarMisPedidos() {
  return apiClient.get("/pedidos/");
}

/**
 * Pedidos de TODOS los usuarios -- solo admin o ayudante (GET
 * /pedidos/todos, protegido con require_admin_o_ayudante). Paginado de
 * verdad: el backend solo trae "limit" filas por vez (OFFSET/LIMIT en la
 * base), nunca todos los pedidos juntos. La respuesta es
 * { items: [...], total } -- "total" es la cantidad de pedidos que hay en
 * total (sin paginar), para poder calcular cuántas páginas hay. Cada
 * pedido incluye además los datos básicos del comprador (ver PedidoAdminRead).
 */
export function listarTodosLosPedidos({ skip = 0, limit = 50 } = {}) {
  return apiClient.get("/pedidos/todos", { params: { skip, limit } });
}

export function obtenerPedido(pedidoId) {
  return apiClient.get(`/pedidos/${pedidoId}`);
}

/**
 * Generar (o regenerar) el link de pago de Mercado Pago para un pedido
 * propio en estado "pendiente". Se puede llamar más de una vez sobre el
 * mismo pedido -- útil si el primer intento de pago no se completó.
 */
export function crearPagoPedido(pedidoId) {
  return apiClient.post(`/pedidos/${pedidoId}/pago`);
}

/**
 * Reconciliar manualmente el estado de un pedido contra Mercado Pago.
 * Útil cuando el pedido quedó "pendiente" pero el comprador ya pagó (por
 * ejemplo, el webhook no llegó porque el túnel de desarrollo estaba
 * caído). Devuelve el pedido actualizado; si no encuentra un pago
 * aprobado, lo devuelve sin cambios.
 */
export function verificarPagoPedido(pedidoId) {
  return apiClient.post(`/pedidos/${pedidoId}/verificar-pago`);
}
