import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";

// Envuelve rutas que necesitan sesión iniciada. Esto es solo una comodidad
// de navegación en el frontend (evita mostrar una pantalla vacía o rota) --
// la seguridad real sigue siendo el backend, que valida el JWT en cada
// endpoint protegido sin importar lo que haga este componente.
//
// === FIX UX-01 (auditoría UX/UI 26/08/2026, Punto Crítico #1) ===========
// Antes esto mandaba a /login en silencio: el usuario entraba a /catalogo
// y, sin sesión, aparecía en el login sin ninguna explicación (se sentía
// como un bug, no como una regla del sitio). Ahora le pasamos a Login, vía
// `state` de React Router, la ruta de origen (`from`) y un mensaje
// contextual (`mensaje`) para que Login.jsx pueda mostrar un aviso
// ("Iniciá sesión para ver el catálogo completo") y, después de loguearse,
// vuelva a mandar al usuario a la pantalla que quería ver en vez de
// siempre al Home.
//
// Si el día de mañana hay que cambiar el texto para una ruta puntual, se
// edita el prop `mensaje="..."` en el <RutaProtegida> de esa ruta en
// App.jsx -- no hace falta tocar este archivo.
// ==========================================================================
export default function RutaProtegida({ children, mensaje = "Iniciá sesión para continuar." }) {
  const { estaAutenticado, cargando } = useAuth();
  const location = useLocation();

  if (cargando) {
    return (
      <div className="pantalla-centrada">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (!estaAutenticado) {
    // FIX UX-01: `state.from` guarda de dónde vinimos para poder volver acá
    // después de loguearse (ver Login.jsx); `state.mensaje` es el texto que
    // Login.jsx muestra en el Alert contextual.
    //
    // FIX UX-07 (auditoría UX/UI 26/08/2026, reportado por el cliente): este
    // redirect también se dispara si estaAutenticado pasa a false MIENTRAS
    // esta ruta protegida sigue montada -- por ejemplo, durante un cierre
    // de sesión explícito, si el botón "Cerrar sesión" limpia los tokens
    // antes de navegar a otro lado. En ese caso `from` termina apuntando a
    // la pantalla protegida en la que el usuario estaba, y después de
    // loguearse de nuevo lo devuelve ahí -- que no es lo que se espera de
    // un logout a propósito. Por eso todo lugar que cierre sesión de forma
    // explícita (SiteLayout.jsx, AdminLayout.jsx, TarjetaPassword en
    // ConfiguracionPrivacidad.jsx) navega a /login ANTES de tocar la
    // sesión, para que esta ruta ya no esté montada cuando cambia
    // estaAutenticado. Si se agrega un nuevo botón de logout, seguir el
    // mismo orden ahí también.
    return <Navigate to="/login" replace state={{ from: location, mensaje }} />;
  }

  return children;
}
