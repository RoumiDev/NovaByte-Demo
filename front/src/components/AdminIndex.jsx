import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Redirección por defecto de /admin (índice). No puede ser un simple
// <Navigate to="productos"> fijo: un ayudante no tiene acceso a Productos
// (ver RutaAdmin en App.jsx) y terminaría rebotado a "/" apenas entra.
// Cada rol arranca en la sección que sí puede ver: admin en Productos (lo
// que gestiona el día a día), ayudante en Pedidos (lo único que hoy puede
// ver).
export default function AdminIndex() {
  const { esAdmin } = useAuth();
  return <Navigate to={esAdmin ? "productos" : "pedidos"} replace />;
}
