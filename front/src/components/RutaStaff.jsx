import { Navigate } from "react-router-dom";
import { Spinner } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";

// Igual que RutaAdmin, pero exige esStaff (admin O ayudante) en vez de
// solo admin -- se usa para envolver todo /admin, ya que un ayudante
// también tiene que poder entrar al panel (hoy, para ver Pedidos).
// Las secciones que siguen siendo exclusivas de admin (Productos,
// Categorías, Usuarios) se envuelven además, puntualmente, en RutaAdmin
// dentro de App.jsx. Mismo recordatorio que RutaAdmin: esto es solo UX,
// la protección real está en el backend (require_admin /
// require_admin_o_ayudante en cada endpoint).
export default function RutaStaff({ children }) {
  const { estaAutenticado, esStaff, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="pantalla-centrada">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (!estaAutenticado) {
    return <Navigate to="/login" replace />;
  }

  if (!esStaff) {
    return <Navigate to="/" replace />;
  }

  return children;
}
