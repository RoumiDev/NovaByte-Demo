import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// FIX UX-02 (auditoría UX/UI 26/08/2026, revertido 27/08/2026 a pedido del
// cliente -- ver el comentario largo en App.jsx sobre /configuracion/
// administracion vs /admin): redirección por defecto del índice de
// /configuracion/administracion. Reemplaza a components/AdminIndex.jsx
// (que hacía lo mismo para /admin, ahora legacy) -- misma lógica: no puede
// ser un <Navigate to="productos"> fijo porque un ayudante no tiene acceso
// a Productos (ver RutaAdmin en App.jsx) y terminaría rebotado a "/" apenas
// entra. Cada rol arranca en la sección que sí puede ver: admin en
// Productos (lo que gestiona el día a día), ayudante en Pedidos (lo único
// que hoy puede ver).
export default function ConfiguracionAdministracionIndex() {
  const { esAdmin } = useAuth();
  return <Navigate to={esAdmin ? "productos" : "pedidos"} replace />;
}
