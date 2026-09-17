// Llamadas a los endpoints de productos (app/router/products.py). Los de
// alta/edición/baja exigen sesión de administrador -- el backend los
// protege con require_admin, esto solo evita mostrar la opción si no
// corresponde.
import { apiClient } from "./client";

/**
 * Listado de productos. El backend GET /productos/ es público pero solo
 * devuelve activos -- para el panel admin igual sirve como listado
 * principal; si en algún momento hace falta ver también los dados de baja,
 * el backend necesitaría un parámetro nuevo (hoy no existe).
 *
 * FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "orden" es nuevo --
 * antes el backend siempre devolvía "más nuevo primero" sin forma de
 * pedir otra cosa. Opcional a propósito (undefined si no se pasa): el
 * backend ya tiene "nuevo" como default propio (ver list_products en
 * app/router/products.py), así que los llamados existentes que no les
 * interesa el orden (Home.jsx, CatalogoMegaMenu.jsx, etc.) no necesitan
 * tocarse. Los valores válidos son "nuevo" | "precio_asc" | "precio_desc"
 * | "nombre" -- los mismos 4 que acepta el backend (Catalogo.jsx es hoy el
 * único llamador que los usa, ver el <select> de orden ahí).
 */
export function listarProductos({ skip = 0, limit = 50, categoriaId, nombre, marca, orden } = {}) {
  return apiClient.get("/productos/", {
    params: {
      skip,
      limit,
      ...(categoriaId ? { categoria_id: categoriaId } : {}),
      ...(nombre ? { nombre } : {}),
      ...(marca ? { marca } : {}),
      ...(orden ? { orden } : {}),
    },
  });
}

/**
 * Marcas distintas entre los productos activos -- para el <select> del
 * filtro por marca. categoriaId es opcional: filtra a las marcas que
 * existen dentro de esa categoría (lo usa el mega menú del navbar).
 */
export function listarMarcas({ categoriaId } = {}) {
  return apiClient.get("/productos/marcas", {
    params: {
      ...(categoriaId ? { categoria_id: categoriaId } : {}),
    },
  });
}

/**
 * FEATURE (27/08/2026, pedido del cliente): listado admin -- a diferencia
 * de listarProductos (público, GET /productos/, solo activos), este trae
 * TAMBIÉN los productos dados de baja, para que Productos.jsx pueda
 * mostrarles el botón "Dar de alta". Solo la usa esa pantalla -- el resto
 * (Home, Catálogo, ConfiguracionStock.jsx) sigue usando listarProductos.
 *
 * FIX (13/09/2026, auditoría UX/UI Punto Crítico #3 -- "límite silencioso
 * de 100 registros sin paginación"): nombre/marca/activo son nuevos -- ver
 * el mismo fix en list_all_products (app/router/products.py). Antes de
 * este fix, Productos.jsx filtraba estos criterios en memoria sobre un
 * único pedido de hasta 100 productos; ahora que la pantalla pagina de
 * verdad, esos filtros viajan al backend para seguir funcionando sobre
 * TODO el catálogo, no solo la página visible.
 */
export function listarTodosLosProductos({ skip = 0, limit = 20, categoriaId, nombre, marca, activo } = {}) {
  return apiClient.get("/productos/todos", {
    params: {
      skip,
      limit,
      ...(categoriaId ? { categoria_id: categoriaId } : {}),
      ...(nombre ? { nombre } : {}),
      ...(marca ? { marca } : {}),
      ...(activo !== undefined && activo !== null ? { activo } : {}),
    },
  });
}

/**
 * Detalle de un producto puntual (para la pantalla que se abre al hacer
 * clic en una tarjeta del catálogo/Home -- ver ProductoDetalle.jsx). Mismo
 * criterio que el listado: público, pero el backend responde 404 tanto si
 * el id no existe como si el producto está dado de baja (GET /productos/{id}
 * en app/router/products.py).
 *
 * FIX (13/09/2026, auditoría UX/UI Punto Alto #9): "config" es opcional y
 * se pasa tal cual a axios -- lo agrega Carrito.jsx para poder pedirle un
 * timeout acotado a la revalidación de stock del carrito (ver el
 * comentario grande en verificarStock, Carrito.jsx) sin tener que crear
 * una función aparte ni tocar a ProductoDetalle.jsx, que sigue llamando a
 * esta función con un solo argumento.
 */
export function obtenerProducto(productoId, config) {
  return apiClient.get(`/productos/${productoId}`, config);
}

/**
 * Estado de favorito del usuario autenticado para un producto puntual (la
 * estrella de ProductoDetalle.jsx). A diferencia del resto de las llamadas
 * de este archivo, exige sesión -- el backend responde 401 sin login
 * (GET /productos/{id}/favorito en app/router/products.py), así que solo
 * hay que llamarla si estaAutenticado.
 */
export function obtenerEstadoFavorito(productoId) {
  return apiClient.get(`/productos/${productoId}/favorito`);
}

/** Marca un producto como favorito del usuario autenticado (clic en la estrella). */
export function marcarFavorito(productoId) {
  return apiClient.post(`/productos/${productoId}/favorito`);
}

/** Saca un producto de los favoritos del usuario autenticado (segundo clic en la estrella). */
export function quitarFavorito(productoId) {
  return apiClient.delete(`/productos/${productoId}/favorito`);
}

/**
 * Productos que el usuario autenticado marcó como favoritos, más nuevo
 * primero -- para la pantalla "Favoritos" del sidebar (ver Favoritos.jsx).
 * Cada elemento trae el producto completo (respuesta.data[i].producto),
 * no solo su id -- ver FavoritoRead en app/schemas/favorite.py.
 */
export function listarFavoritos() {
  return apiClient.get("/productos/favoritos");
}

/** Refleja ProductoCreate (app/schemas/product.py). */
export function crearProducto(datos) {
  return apiClient.post("/productos/", datos);
}

/**
 * Refleja ProductoUpdate: todos los campos son opcionales (edición parcial).
 *
 * FEATURE (27/08/2026, pedido del cliente): passwordActual es opcional a
 * propósito -- ConfiguracionStock.jsx llama a esta misma función solo con
 * (productoId, { stock }) para sus guardados rápidos por fila, sin pasar
 * contraseña, y el backend exime justamente ese caso (ver update_product en
 * app/router/products.py: solo la exige si se cambia algo más que "stock").
 * Productos.jsx sí la pasa siempre que edita (ver manejarGuardar ahí).
 */
export function actualizarProducto(productoId, cambios, passwordActual) {
  return apiClient.patch(`/productos/${productoId}`, { ...cambios, password_actual: passwordActual });
}

/**
 * Baja lógica (is_active=False) -- el backend nunca borra productos
 * físicamente. FEATURE (27/08/2026, pedido del cliente): ahora exige la
 * contraseña del admin (ver deactivate_product en app/router/products.py) --
 * va en el body del DELETE (ConfirmacionPassword, ver schemas/product.py).
 */
export function darDeBajaProducto(productoId, passwordActual) {
  return apiClient.delete(`/productos/${productoId}`, { data: { password_actual: passwordActual } });
}

/**
 * Reactivar un producto dado de baja (mismo PATCH que editar, is_active=true).
 * Reactivar también es un "cambio" real -- pide contraseña igual que
 * actualizarProducto (ver el comentario ahí).
 */
export function reactivarProducto(productoId, passwordActual) {
  return actualizarProducto(productoId, { is_active: true }, passwordActual);
}

/**
 * Subir un archivo de imagen y obtener la URL para usar como imagen_url.
 * Reemplaza pegar una URL externa (se puede romper o borrar sin aviso) por
 * subir el archivo directo desde la computadora del admin -- el backend lo
 * guarda él mismo y devuelve una URL propia. No se fija el header
 * Content-Type a mano: axios arma el boundary de multipart correcto solo
 * si se lo dejamos inferir del FormData.
 */
export function subirImagenProducto(archivo) {
  const formData = new FormData();
  formData.append("archivo", archivo);
  return apiClient.post("/productos/imagenes", formData);
}

/**
 * Productos vinculados a este -- la sección "También vas a necesitar" de
 * ProductoDetalle.jsx (ej. el tóner de una impresora). Público, igual que
 * obtenerProducto: el vínculo ya viene resuelto en los dos sentidos desde
 * el backend (ver GET /productos/{id}/relacionados), acá no hay que hacer
 * nada especial para eso.
 */
export function listarProductosRelacionados(productoId) {
  return apiClient.get(`/productos/${productoId}/relacionados`);
}

/**
 * Vincula dos productos entre sí (panel admin, formulario de Productos).
 * Alcanza con llamarla una vez desde cualquiera de los dos productos -- el
 * backend guarda el vínculo en los dos sentidos (ver crear_producto_relacionado
 * en app/router/products.py).
 */
export function relacionarProducto(productoId, otroProductoId) {
  return apiClient.post(`/productos/${productoId}/relacionados`, {
    producto_relacionado_id: otroProductoId,
  });
}

/** Desvincula dos productos (panel admin, botón "Quitar" de la lista de relacionados). */
export function desrelacionarProducto(productoId, otroProductoId) {
  return apiClient.delete(`/productos/${productoId}/relacionados/${otroProductoId}`);
}
