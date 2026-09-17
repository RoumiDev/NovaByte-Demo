// Contexto de sesión: además del par de tokens (delegado a api/tokenStore),
// mantiene el perfil del usuario logueado (GET /users/me) -- lo necesitamos
// para saber su rol (admin/ayudante/cliente) y así poder mostrar/proteger
// el panel de administración según corresponda.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { obtenerPerfil, cerrarSesionRemota } from "../api/auth";
import { clearTokens, getTokens, setTokens, subscribe } from "../api/tokenStore";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [tokens, setTokensState] = useState(getTokens);
  const [usuario, setUsuario] = useState(null);
  // Distingue "todavía no sabemos si hay sesión válida" de "no hay sesión".
  // Evita que, en un refresh de página con tokens guardados, RutaProtegida
  // mande a /login por una fracción de segundo antes de que termine de
  // cargar el perfil.
  const [cargando, setCargando] = useState(Boolean(getTokens()));

  // Se re-ejecuta si algo fuera de React (el interceptor de axios) cambia
  // los tokens -- por ejemplo, al fallar un refresh y limpiar la sesión.
  useEffect(() => subscribe(setTokensState), []);

  useEffect(() => {
    let cancelado = false;

    if (!tokens?.access_token) {
      setUsuario(null);
      setCargando(false);
      return;
    }

    setCargando(true);
    obtenerPerfil()
      .then((respuesta) => {
        if (!cancelado) {
          setUsuario(respuesta.data);
        }
      })
      .catch(() => {
        // Si el perfil no se pudo cargar (token inválido y el refresh
        // automático del interceptor tampoco pudo salvarlo), no dejamos al
        // usuario en un estado "autenticado pero sin datos".
        if (!cancelado) {
          clearTokens();
        }
      })
      .finally(() => {
        if (!cancelado) {
          setCargando(false);
        }
      });

    return () => {
      cancelado = true;
    };
  }, [tokens]);

  const guardarSesion = useCallback(async (tokenResponse) => {
    setTokens(tokenResponse);
    // El estado de "tokens" se actualiza solo vía el subscribe() de arriba;
    // no hace falta llamar setTokensState acá.
  }, []);

  // Vuelve a pedir el perfil y actualiza "usuario" sin pasar por un cambio
  // de tokens (que es lo único que dispara el useEffect de arriba). Hace
  // falta después de editar el perfil propio desde Privacidad (teléfono,
  // dirección, email) para que lo que se ve en pantalla (acá y en
  // cualquier otro lado que use useAuth().usuario) quede al día sin
  // recargar la página.
  const refrescarPerfil = useCallback(async () => {
    const respuesta = await obtenerPerfil();
    setUsuario(respuesta.data);
    return respuesta.data;
  }, []);

  const cerrarSesion = useCallback(async () => {
    const actuales = getTokens();
    // El refresh token ya no se maneja acá (viaja solo en la cookie
    // httpOnly, ver api/auth.js) -- este chequeo es solo para no llamar a
    // /auth/logout si esta pestaña ni siquiera tenía sesión iniciada.
    if (actuales?.access_token) {
      // Best-effort: si esta llamada falla (sin red, etc.) igual limpiamos
      // la sesión localmente -- no tiene sentido dejar al usuario "atrapado"
      // logueado en el frontend solo porque el logout remoto no llegó.
      try {
        await cerrarSesionRemota();
      } catch {
        /* ignorado a propósito, ver comentario arriba */
      }
    }
    clearTokens();
  }, []);

  // Tres roles (ver app/models/user.py: ROLES_VALIDOS): "admin" (acceso
  // total), "ayudante" (staff -- hoy solo puede ver todos los pedidos) y
  // "cliente" (default, comprador normal). esStaff agrupa admin+ayudante
  // para gatear lo que ambos ya pueden ver (por ahora, el panel admin en
  // general y la sección de Pedidos en particular).
  const rol = usuario?.role ?? null;
  const esAdmin = rol === "admin";
  const esAyudante = rol === "ayudante";

  const value = {
    tokens,
    usuario,
    cargando,
    estaAutenticado: Boolean(tokens?.access_token),
    rol,
    esAdmin,
    esAyudante,
    esStaff: esAdmin || esAyudante,
    guardarSesion,
    cerrarSesion,
    refrescarPerfil,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return context;
}
