import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Nunito Sans (fuente self-hosteada vía @fontsource, no depende de que
// Google Fonts esté online) en los pesos que usa la app: 400 texto normal,
// 500 texto semi-destacado, 600 títulos/botones (ver $headings-font-weight
// y $btn-font-weight en styles/theme.scss), 700 por si hace falta más
// énfasis.
import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/500.css";
import "@fontsource/nunito-sans/600.css";
import "@fontsource/nunito-sans/700.css";
// Bootstrap recompilado con nuestros colores/tipografía/bordes -- ver ese
// archivo para editar el look de toda la app desde un solo lugar.
import "./styles/theme.scss";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): CSS base de
// react-toastify -- se importa una sola vez acá, igual que theme.scss.
import "react-toastify/dist/ReactToastify.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import ToastContainerTema from "./components/ToastContainerTema.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        {/* FIX UX-03: contenedor único de toasts para toda la app -- ver
            components/ToastContainerTema.jsx. Va adentro de ThemeProvider
            (necesita saber si el tema es claro/oscuro) pero no depende de
            AuthProvider/CartProvider, así que queda como hermano de App en
            vez de envolverla. */}
        <ToastContainerTema />
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
