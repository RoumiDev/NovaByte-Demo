// Configuración general de la tienda (horarios de atención, marcas
// destacadas). Ver app/router/store.py -- lectura pública, edición solo
// admin.
import { apiClient } from "./client";

export function obtenerConfiguracionTienda() {
  return apiClient.get("/configuracion/");
}

// FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): passwordActual
// es opcional a propósito -- el backend (ver update_configuracion en
// app/router/store.py) solo la exige cuando el cambio incluye
// cotizacion_dolar; guardar nada más los horarios de atención sigue
// mandando este mismo endpoint sin contraseña, igual que antes. Mismo
// criterio que actualizarProducto en api/products.js: axios descarta las
// claves en undefined, así que password_actual ni siquiera viaja en el
// body cuando no se pasa este segundo argumento.
export function actualizarConfiguracionTienda(cambios, passwordActual) {
  return apiClient.patch("/configuracion/", { ...cambios, password_actual: passwordActual });
}

// FEATURE (29/08/2026, pedido del cliente): "Marcas destacadas" -- 10
// posiciones fijas para imágenes de marcas, ver GrillaMarcasDestacadas.jsx
// (carga admin, Configuración → General) y FilaMarcasDestacadas.jsx
// (franja pública del Home).

/** Las 10 posiciones, siempre en orden. Público, igual que obtenerConfiguracionTienda. */
export function listarMarcasDestacadas() {
  return apiClient.get("/configuracion/marcas-destacadas");
}

/**
 * Carga (o reemplaza) la imagen de una posición, y la marca a la que
 * corresponde. imagenUrl ya tiene que venir de subir el archivo primero
 * contra POST /productos/imagenes (ver subirImagenProducto en
 * api/products.js -- mismo endpoint que usa el alta de productos,
 * FEATURE 29/08/2026: "no dupliques esa lógica") -- o ser la misma URL
 * que ya tenía la posición, si solo se está corrigiendo la marca (ver
 * ModalCargarImagenMarca.jsx).
 *
 * nombreMarca (FEATURE 30/08/2026, pedido del cliente): tiene que ser uno
 * de los valores que devuelve listarMarcas() (api/products.js) -- el
 * backend filtra el catálogo por igualdad exacta contra Producto.marca
 * (ver list_products en app/router/products.py), así que un texto libre
 * que no coincida ni a una letra nunca encontraría productos al hacer
 * clic en el Home.
 */
export function establecerMarcaDestacada(posicion, imagenUrl, nombreMarca) {
  return apiClient.put(`/configuracion/marcas-destacadas/${posicion}`, {
    imagen_url: imagenUrl,
    nombre_marca: nombreMarca,
  });
}

/**
 * Vacía una posición (nunca borra la fila -- conserva su número). Exige
 * la contraseña del admin, mismo criterio que darDeBajaProducto/
 * eliminarCategoria -- va en el body del DELETE.
 */
export function eliminarMarcaDestacada(posicion, passwordActual) {
  return apiClient.delete(`/configuracion/marcas-destacadas/${posicion}`, {
    data: { password_actual: passwordActual },
  });
}
