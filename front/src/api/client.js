// Cliente HTTP central: todas las llamadas a la API pasan por acá, así el
// base URL, el header de autorización y el refresh automático quedan en un
// solo lugar en vez de repetirse en cada pantalla.
import axios from "axios";
import { clearTokens, getTokens, setTokens } from "./tokenStore";

// Configurable por variable de entorno (.env de este proyecto, prefijo
// VITE_ obligatorio para que Vite la exponga al código del navegador). En
// desarrollo apunta al backend local; en producción hay que setearla a la
// URL real de la API.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

// withCredentials: true -- imprescindible para que el navegador mande (y
// acepte) la cookie httpOnly donde viaja el refresh token (ver
// _setear_cookie_refresh en app/router/auth.py del backend, hallazgo ALTA de
// la auditoría AppSec 2026-08-23). Sin esto, el navegador ignora el
// Set-Cookie de /auth/login y no reenvía la cookie en /auth/refresh,
// /auth/activity ni /auth/logout. Requiere que el backend responda con
// Access-Control-Allow-Credentials: true y un origen explícito -- no
// wildcard -- en ALLOWED_ORIGINS (ver app/main.py), o el navegador rechaza
// igual la respuesta.
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// FIX B-03 (auditoría QA+Seguridad 28/08/2026): base para resolver las
// rutas relativas que devuelve el backend para imágenes de productos y
// categorías (ver POST /productos/imagenes, POST /categorias/imagenes --
// devuelven "/static/productos/<archivo>", no una URL completa, para no
// quedar atadas al host desde el que se subió la imagen). API_BASE_URL
// termina en "/api/v1" (o es sólo "/api/v1" en producción, cuando el
// frontend lo sirve la misma API -- ver .env.production); las imágenes
// estáticas cuelgan de la raíz del backend, un nivel más arriba (ver
// app.mount("/static/...") en main.py), así que se le saca ese sufijo acá
// una sola vez. Usado por utils/imagenes.js -- no importar API_BASE_URL
// directo para esto, para no repetir el .replace en cada lugar.
export const STATIC_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

// Adjunta el access token vigente (si hay sesión) a cada request.
apiClient.interceptors.request.use((config) => {
  const tokens = getTokens();
  if (tokens?.access_token) {
    config.headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  return config;
});

// El access token dura poco a propósito (15 min, ver ACCESS_TOKEN_EXPIRE_MINUTES
// en el backend). En vez de obligar a re-loguearse cada vez que expira
// mientras se usa el panel admin, ante un 401 probamos renovar la sesión una
// sola vez y reintentamos la request original. El refresh token en sí ya NO
// pasa por acá: viaja solo, automáticamente, en la cookie httpOnly que puso
// /auth/login (ver comentario de withCredentials más arriba) -- este código
// nunca lo lee ni lo manda a mano.
let refrescoEnCurso = null;

function refrescarSesion() {
  // Señal local (no autoritativa) de "puede haber sesión": si nunca hubo un
  // access_token en este tab, no vale la pena pegarle a /auth/refresh -- si
  // lo hay, el backend decide con la cookie si la sesión sigue viva o no.
  const tokens = getTokens();
  if (!tokens?.access_token) {
    return Promise.reject(new Error("No hay sesión iniciada."));
  }
  // Si ya hay un refresh en curso (dos requests en 401 al mismo tiempo),
  // todas esperan la misma promesa en vez de disparar refrescos duplicados
  // -- el backend rota/invalida el refresh token en cada uso, así que un
  // segundo intento en paralelo con la misma cookie fallaría igual.
  if (!refrescoEnCurso) {
    refrescoEnCurso = axios
      .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((respuesta) => {
        setTokens(respuesta.data);
        return respuesta.data;
      })
      .finally(() => {
        refrescoEnCurso = null;
      });
  }
  return refrescoEnCurso;
}

apiClient.interceptors.response.use(
  (respuesta) => respuesta,
  async (error) => {
    const { config, response } = error;
    const esLogin = config?.url?.includes("/auth/login");
    const esRefresh = config?.url?.includes("/auth/refresh");

    if (response?.status === 401 && !config._reintentado && !esLogin && !esRefresh) {
      config._reintentado = true;
      try {
        const nuevosTokens = await refrescarSesion();
        config.headers.Authorization = `Bearer ${nuevosTokens.access_token}`;
        return apiClient(config);
      } catch {
        // El refresh también falló (expiró o fue revocado): no hay forma de
        // recuperar la sesión, hay que volver a loguearse.
        clearTokens();
      }
    }

    return Promise.reject(error);
  },
);

// Traduce los errores de Axios/FastAPI a un mensaje de texto legible.
// FastAPI devuelve el detalle del error bajo la clave "detail": puede ser
// un string simple (ej. errores 401/409/400 de esta API) o una lista de
// objetos de validación de Pydantic (errores 422). Contemplamos los dos
// formatos para no mostrarle al usuario un [object Object].
export function extraerMensajeError(error) {
  if (!error.response) {
    return "No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.";
  }

  const { detail } = error.response.data || {};

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg || "Dato inválido")
      .join(" ");
  }

  return "Ocurrió un error inesperado. Intentá de nuevo.";
}
