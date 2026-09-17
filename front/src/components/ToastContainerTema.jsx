import { ToastContainer } from "react-toastify";
import { useTheme } from "../context/ThemeContext";

// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): contenedor
// único de toasts para toda la app -- se monta una sola vez en main.jsx.
// Sigue el tema claro/oscuro de ThemeContext (mismo mecanismo que ya usa
// el resto de la app vía data-bs-theme) para que los toasts no queden
// "quemados" en un tema fijo si el usuario cambia a oscuro. No renderiza
// nada más que el contenedor: los toasts en sí se disparan desde
// utils/notificaciones.js (notificarExito/notificarError/notificarInfo),
// nunca directo con react-toastify importado en cada pantalla -- así el
// criterio de color/duración queda en un solo lugar.
export default function ToastContainerTema() {
  const { tema } = useTheme();
  return <ToastContainer theme={tema === "dark" ? "dark" : "light"} position="bottom-right" newestOnTop />;
}
