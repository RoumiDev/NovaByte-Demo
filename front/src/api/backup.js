// SIN USO (29/08/2026, pedido del cliente): backup/restauración manual dado
// de baja, ver el comentario en ../pages/ConfiguracionBackup.jsx. Se puede
// borrar a mano (src/api/backup.js) si querés.
//
// Llamadas al backup/restauración completa de la base de datos (app/router/backup.py).
// Los dos endpoints exigen sesión de administrador -- el backend los
// protege con require_admin, esto solo evita mostrar la pantalla si no
// corresponde.
import { apiClient } from "./client";

/**
 * Corre pg_dump en el backend, lo empaqueta junto con las imágenes
 * actuales de productos/categorías, y devuelve el .zip resultante como
 * blob -- responseType: "blob" (no JSON) porque la respuesta es el backup
 * entero, no un objeto. ConfiguracionBackup.jsx arma la descarga en el
 * navegador a partir de este blob (ver manejarDescargar ahí), usando el
 * nombre real que manda el backend en el header Content-Disposition.
 *
 * FIX V-03 (auditoría AppSec, 28/08/2026): antes esto era un GET sin nada
 * más que el access token -- ahora el backend exige también la
 * contraseña del admin logueado (mismo criterio que ya se usaba para
 * editar una categoría), así que pasa a ser un POST con esa contraseña.
 */
export function descargarBackup(passwordActual) {
  const formData = new FormData();
  formData.append("password_actual", passwordActual);
  return apiClient.post("/backup/descargar", formData, { responseType: "blob" });
}

/**
 * Restaura la base de datos completa y las imágenes de productos/
 * categorías a partir de un backup .zip subido acá -- REEMPLAZA todo lo
 * que haya. Multipart porque va un archivo real (no un JSON): confirmacion
 * es la frase "RESTAURAR" tipeada literal (ver _FRASE_CONFIRMACION en
 * router/backup.py), passwordActual es la contraseña del admin logueado
 * -- el backend exige las dos cosas.
 */
export function restaurarBackup({ confirmacion, passwordActual, archivo }) {
  const formData = new FormData();
  formData.append("confirmacion", confirmacion);
  formData.append("password_actual", passwordActual);
  formData.append("archivo", archivo);
  return apiClient.post("/backup/restaurar", formData);
}
