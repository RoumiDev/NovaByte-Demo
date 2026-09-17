// FIX B-03 (auditoría QA+Seguridad 28/08/2026): el backend guardaba antes
// la URL completa de cada imagen ("http://<host-de-la-subida>:8000/static/
// productos/<archivo>") en producto.imagen_url / categoria.imagen_url. Eso
// deja la imagen atada para siempre al host desde el que se subió -- se
// rompe apenas la base de datos se usa desde otra máquina, otro puerto, u
// otro dominio (le pasó al cliente probando en WSL con una base que venía
// de Windows: la URL seguía apuntando a ese "localhost:8000" viejo). Ahora
// el backend devuelve sólo la RUTA relativa ("/static/productos/<archivo>")
// y esta función arma la URL final contra la API que el frontend esté
// usando en cada momento (ver STATIC_BASE_URL en api/client.js).
import { STATIC_BASE_URL } from "../api/client";

// Cualquier valor que ya venga como URL completa (http/https -- filas
// viejas que se subieron antes de este fix; o blob:/data: -- la vista
// previa de un archivo recién elegido en el form de Productos/Categorias,
// ver imagenPreviewUrl en admin/Productos.jsx y admin/Categorias.jsx) se
// devuelve tal cual: ya son usables directamente como src de <img>, y no
// hay que tocarlas.
const _TIENE_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Arma la URL completa para mostrar una imagen de producto/categoría a
 * partir de lo que haya en imagen_url (ruta relativa nueva, URL absoluta
 * vieja, blob: de una vista previa, o null/"" si no tiene imagen).
 * Devuelve null si no hay nada que mostrar, para que los componentes
 * puedan seguir usando el patrón `{resolverUrlImagen(x) ? <img .../> : ...}`.
 */
export function resolverUrlImagen(valor) {
  if (!valor) return null;
  if (_TIENE_ESQUEMA.test(valor)) return valor;
  return `${STATIC_BASE_URL}${valor}`;
}
