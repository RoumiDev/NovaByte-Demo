// Llamadas a los endpoints de categorías (app/router/categories.py).
import { apiClient } from "./client";

export function listarCategorias({ skip = 0, limit = 100 } = {}) {
  return apiClient.get("/categorias/", { params: { skip, limit } });
}

export function crearCategoria(datos) {
  return apiClient.post("/categorias/", datos);
}

// FEATURE (27/08/2026, pedido del cliente): passwordActual -- ver
// update_category en app/router/categories.py, que ahora exige la
// contraseña del admin para cualquier cambio.
export function actualizarCategoria(categoriaId, cambios, passwordActual) {
  return apiClient.patch(`/categorias/${categoriaId}`, { ...cambios, password_actual: passwordActual });
}

/**
 * Borrado físico (a diferencia de productos, categorías sí se eliminan de
 * verdad). El backend devuelve 409 si todavía hay productos asociados --
 * hay que mostrar ese mensaje tal cual, no es un error genérico.
 *
 * FEATURE (27/08/2026, pedido del cliente): ahora exige la contraseña del
 * admin (ver delete_category en app/router/categories.py) -- va en el body
 * del DELETE (ConfirmacionPassword, ver schemas/product.py).
 */
export function eliminarCategoria(categoriaId, passwordActual) {
  return apiClient.delete(`/categorias/${categoriaId}`, { data: { password_actual: passwordActual } });
}

// Mismo flujo que subirImagenProducto en api/products.js: sube el archivo
// elegido en el panel admin y devuelve la URL propia para usar como
// imagen_url al crear/editar la categoría (ver POST /categorias/imagenes).
export function subirImagenCategoria(archivo) {
  const formData = new FormData();
  formData.append("archivo", archivo);
  return apiClient.post("/categorias/imagenes", formData);
}
