import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "lti_tema";

function leerTemaInicial() {
  const guardado = localStorage.getItem(STORAGE_KEY);
  if (guardado === "light" || guardado === "dark") return guardado;
  // Sin preferencia guardada todavía: arrancamos respetando el modo que
  // ya tiene configurado el sistema operativo del usuario.
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

const ThemeContext = createContext(null);

// Tema claro/oscuro de toda la app. Usa el mecanismo nativo de Bootstrap
// 5.3 (atributo data-bs-theme en <html>): los componentes de Bootstrap y
// las variables de theme.scss (basadas en var(--bs-...)) ya saben
// responder solos a ese atributo, así que no hace falta duplicar colores
// a mano para el modo oscuro.
export function ThemeProvider({ children }) {
  const [tema, setTema] = useState(leerTemaInicial);

  useEffect(() => {
    document.documentElement.setAttribute("data-bs-theme", tema);
    localStorage.setItem(STORAGE_KEY, tema);
  }, [tema]);

  function alternarTema() {
    setTema((actual) => (actual === "dark" ? "light" : "dark"));
  }

  return <ThemeContext.Provider value={{ tema, alternarTema }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const contexto = useContext(ThemeContext);
  if (!contexto) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return contexto;
}
