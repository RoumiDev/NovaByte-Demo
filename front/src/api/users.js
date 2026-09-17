// Llamadas administrativas sobre usuarios (app/router/users.py). Todas
// exigen sesión de admin -- el backend las protege con require_admin,
// esto solo evita mostrar la pantalla si no corresponde.
import { apiClient } from "./client";

/**
 * Listado de usuarios registrados (solo admin).
 *
 * FIX (13/09/2026, auditoría UX/UI Punto Crítico #3 -- "límite silencioso
 * de 100 registros sin paginación"): "busqueda" es nueva -- antes
 * Usuarios.jsx pedía limit=100 una sola vez y filtraba por nombre/email en
 * memoria (ver el comentario viejo que quedó ahí), así que un usuario más
 * allá del registro 100 no aparecía ni buscándolo por nombre exacto. Ahora
 * que la pantalla pagina de verdad, el filtro viaja al backend (ver
 * list_users en app/router/users.py) para seguir encontrando a cualquier
 * usuario sin importar en qué página esté.
 */
export function listarUsuarios({ skip = 0, limit = 20, busqueda } = {}) {
  return apiClient.get("/users/", { params: { skip, limit, ...(busqueda ? { busqueda } : {}) } });
}

/**
 * Editar cualquier dato de un usuario (rol, activo/inactivo, o los campos
 * de perfil que solo un admin puede tocar -- razon_social, documento,
 * condición de IVA, teléfono, dirección, ciudad, provincia, código
 * postal). Refleja UsuarioAdminUpdate (app/schemas/user.py) -- nunca email
 * ni password, esos tienen sus propios flujos aparte.
 *
 * FEATURE (30/08/2026, pedido del cliente, hallazgo Alto #1 de la
 * auditoría UX/UI): si `cambios` incluye `role` y/o `is_active`, también
 * tiene que incluir `password_actual` -- el backend lo exige en ese caso
 * (ver admin_update_user en router/users.py) y devuelve 422 si falta.
 * Editar el resto del perfil (razon_social/teléfono/etc.) sigue sin
 * pedirla. Ver pages/admin/Usuarios.jsx para el modal de confirmación que
 * arma ese campo antes de llamar acá.
 */
export function actualizarUsuarioAdmin(usuarioId, cambios) {
  return apiClient.patch(`/users/${usuarioId}`, cambios);
}

/**
 * FEATURE (11/09/2026, pedido del cliente -- URGENTE, clientes bloqueados):
 * le fija a mano una contraseña nueva a la cuenta de OTRO usuario. Existe
 * como vía de emergencia para cuando la casilla de mail del cliente está
 * llena y no le entran los códigos de verificación/recuperación (ver
 * admin_reset_password en app/router/users.py, RestablecerPasswordAdmin en
 * app/schemas/user.py). El backend exige, aparte de la password_nueva, la
 * password_actual del ADMIN que hace el cambio (mismo patrón de "sudo" que
 * confirmar_password_admin_rate_limiter en otros endpoints sensibles) y
 * revoca todas las sesiones activas de la cuenta afectada. Devuelve 204 sin
 * cuerpo -- por eso este archivo no hace nada con la respuesta más que
 * dejarla pasar, el que llama solo necesita saber si tiró error o no.
 */
export function restablecerPasswordAdmin(usuarioId, { password_nueva, password_actual }) {
  return apiClient.post(`/users/${usuarioId}/restablecer-password-admin`, {
    password_nueva,
    password_actual,
  });
}

/**
 * FEATURE (11/09/2026, pedido del cliente): marca el mail de OTRO usuario
 * como verificado a mano, sin el código de POST /verificar-email (ver
 * admin_mark_email_verified en app/router/users.py). Mismo problema de
 * fondo que restablecerPasswordAdmin -- casillas de mail llenas -- pero acá
 * NO es una vía de "desbloqueo": el login nunca exigió el mail verificado,
 * así que esto es solo prolijidad administrativa. Por eso, a diferencia de
 * restablecerPasswordAdmin, no pide la contraseña del admin ni tiene body:
 * solo el id del usuario. Devuelve el UsuarioRead actualizado (204 no,
 * a propósito, para que el que llama pueda refrescar el badge sin tener
 * que volver a pedir la lista completa).
 */
export function marcarEmailVerificadoAdmin(usuarioId) {
  return apiClient.post(`/users/${usuarioId}/marcar-email-verificado`);
}
