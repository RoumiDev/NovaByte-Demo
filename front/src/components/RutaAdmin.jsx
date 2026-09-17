import { Navigate } from "react-router-dom";
import { Spinner } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";

// Igual que RutaProtegida, pero además exige el rol "admin" (no alcanza
// con ser staff -- ver RutaStaff para eso). Se usa para las secciones del
// panel admin que un ayudante no puede tocar: Productos, Categorías,
// Usuarios. Recordatorio: esto es solo UX (ocultar el link, evitar una
// pantalla rota) -- la protección real está en el backend, que exige
// require_admin en cada endpoint de alta/edición/baja sin importar qué
// muestre este componente.
export default function RutaAdmin({ children }) {
  const { estaAutenticado, esAdmin, cargando } = useAuth();

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

  if (!esAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}
