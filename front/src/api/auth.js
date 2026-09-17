// Llamadas a los endpoints de autenticación/registro del backend
// (app/router/auth.py y app/router/users.py).
import { apiClient } from "./client";

/**
 * Registrar un usuario nuevo. Refleja exactamente los campos que exige
 * UsuarioCreate en el backend (app/schemas/user.py) -- si ese schema
 * cambia, este objeto tiene que actualizarse junto con el formulario.
 */
export function registrarUsuario({
  email,
  razonSocial,
  tipoDocumento,
  numeroDocumento,
  condicionIva,
  telefono,
  // FIX (26/08/2026, pedido del cliente): direccion pasa a ser obligatoria
  // (antes se mandaba direccion || null). ciudad es nueva, también
  // obligatoria -- ver Usuario.ciudad en app/models/user.py.
  direccion,
  ciudad,
  // FEATURE (26/08/2026, pedido del cliente): provincia/código postal --
  // ver utils/provincias.js (mismos "value" que espera el backend) y
  // Provincia en app/models/user.py.
  provincia,
  codigoPostal,
  password,
}) {
  return apiClient.post("/users/", {
    email,
    razon_social: razonSocial,
    tipo_documento: tipoDocumento,
    numero_documento: numeroDocumento,
    condicion_iva: condicionIva,
    telefono,
    direccion,
    ciudad,
    provincia,
    codigo_postal: codigoPostal,
    password,
  });
}

/**
 * Login. El backend usa el formulario estándar OAuth2
 * (application/x-www-form-urlencoded, campos "username"/"password") en vez
 * de JSON -- por eso se manda como URLSearchParams y no como objeto plano.
 * "username" es en realidad el email.
 */
export function iniciarSesion({ email, password }) {
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);

  return apiClient.post("/auth/login", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

/** Perfil del usuario autenticado (incluye role). */
export function obtenerPerfil() {
  return apiClient.get("/users/me");
}

/**
 * Cerrar sesión: revoca el refresh token en el backend. Ya no se manda por
 * parámetro -- el backend lo lee solo de la cookie httpOnly que puso
 * /auth/login (ver withCredentials en api/client.js).
 */
export function cerrarSesionRemota() {
  return apiClient.post("/auth/logout");
}

/**
 * Confirmar el mail con el código de 6 dígitos que llegó al registrarse
 * (o al pedir uno nuevo con reenviarVerificacion).
 */
export function verificarEmail({ email, codigo }) {
  return apiClient.post("/users/verificar-email", { email, codigo });
}

/**
 * Pedir un código nuevo de verificación de mail. El backend responde
 * siempre el mismo mensaje genérico exista o no esa cuenta (o ya esté
 * verificada) -- no hay forma de distinguir esos casos desde acá, y no
 * hace falta: la pantalla siempre puede mostrar el mismo mensaje.
 */
export function reenviarVerificacion({ email }) {
  return apiClient.post("/users/reenviar-verificacion", { email });
}

/**
 * Pedir un código para restablecer la contraseña. Mismo criterio de
 * respuesta genérica que reenviarVerificacion.
 */
export function solicitarRecuperacionPassword({ email }) {
  return apiClient.post("/users/olvide-password", { email });
}

/** Elegir una contraseña nueva con el código de recuperar-password. */
export function restablecerPassword({ email, codigo, passwordNueva }) {
  return apiClient.post("/users/restablecer-password", {
    email,
    codigo,
    password_nueva: passwordNueva,
  });
}

/**
 * Editar los campos del propio perfil que no necesitan verificación
 * (teléfono/dirección/ciudad/provincia/código postal). Refleja
 * UsuarioUpdate (app/schemas/user.py) -- no acepta email, documento, razón
 * social, role ni is_active.
 *
 * FEATURE (26/08/2026, pedido del cliente): provincia/codigoPostal/ciudad
 * -- ver utils/provincias.js.
 *
 * FIX (26/08/2026, pedido del cliente): direccion, ciudad, provincia y
 * codigoPostal ahora son obligatorios en UsuarioUpdate si vienen en el
 * body -- ya no se manda "|| null" para ellos (eso el backend ahora lo
 * rechaza, ver _validar_direccion_update/_validar_ciudad_update/etc en
 * app/schemas/user.py). Se pueden seguir omitiendo del todo (undefined)
 * para editar solo, por ejemplo, el teléfono.
 */
export function actualizarMiPerfil({ telefono, direccion, ciudad, provincia, codigoPostal }) {
  const cambios = {};
  if (telefono !== undefined) cambios.telefono = telefono;
  if (direccion !== undefined) cambios.direccion = direccion;
  if (ciudad !== undefined) cambios.ciudad = ciudad;
  if (provincia !== undefined) cambios.provincia = provincia;
  if (codigoPostal !== undefined) cambios.codigo_postal = codigoPostal;
  return apiClient.patch("/users/me", cambios);
}

/**
 * Cambiar la propia contraseña estando logueado (distinto del flujo de
 * "olvidé mi contraseña"). Revoca todos los refresh tokens activos, así
 * que después de esto conviene cerrar sesión y pedir volver a loguearse.
 */
export function cambiarMiPassword({ passwordActual, passwordNueva }) {
  return apiClient.post("/users/me/password", {
    password_actual: passwordActual,
    password_nueva: passwordNueva,
  });
}

/**
 * Pedir el código para cambiar el propio email. El código se manda a
 * emailNuevo, no al email actual -- ver POST /users/me/email/solicitar.
 */
export function solicitarCambioEmail({ emailNuevo }) {
  return apiClient.post("/users/me/email/solicitar", { email_nuevo: emailNuevo });
}

/**
 * Confirmar el cambio de email con el código recibido en la casilla nueva.
 * Devuelve el perfil actualizado (con el email ya cambiado).
 */
export function confirmarCambioEmail({ codigo }) {
  return apiClient.post("/users/me/email/confirmar", { codigo });
}

/**
 * FEATURE (12/09/2026, pedido del cliente): apaga
 * Usuario.debe_avisar_email_verificado (ver ese campo en app/models/user.py
 * y POST /users/me/aviso-email-verificado en app/router/users.py) apenas el
 * propio cliente vio el aviso no bloqueante de "tu cuenta ya fue
 * verificada" -- ver el useEffect en components/SiteLayout.jsx, que es el
 * único lugar que llama a esto. Devuelve 204 sin cuerpo, igual que
 * cambiarMiPassword más arriba.
 */
export function marcarAvisoEmailVerificadoVisto() {
  return apiClient.post("/users/me/aviso-email-verificado");
}
