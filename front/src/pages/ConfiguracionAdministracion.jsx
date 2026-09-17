// Sin uso: "Administración" pasó a ser un desplegable dentro del propio
// sidebar de Configuración (ver ConfiguracionLayout.jsx), con Productos/
// Categorías/Pedidos/Usuarios renderizándose directamente a la derecha
// (rutas hijas de /configuracion/administracion en App.jsx) en vez de
// esta tarjeta de accesos a /admin/*. Se deja este archivo en vez de
// borrarlo porque esta sesión no tiene forma de eliminar archivos de tu
// computadora -- lo podés borrar vos a mano
// (src/pages/ConfiguracionAdministracion.jsx) si querés.
import { Alert, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ConfiguracionAdministracion() {
  const { esAdmin, esStaff } = useAuth();

  if (!esStaff) {
    return <Alert variant="secondary">Todavía no hay opciones acá. Próximamente.</Alert>;
  }

  return (
    <Card className="superficie shadow-sm" style={{ maxWidth: 520 }}>
      <Card.Body>
        <Card.Title className="h5 mb-1">Administración</Card.Title>
        <Card.Subtitle className="text-muted mb-3">
          Productos, categorías, pedidos y usuarios de la tienda.
        </Card.Subtitle>

        <div className="d-flex flex-column gap-2">
          {esAdmin && (
            <Button as={Link} to="/admin/productos" variant="outline-secondary" className="text-start">
              Productos
            </Button>
          )}
          {esAdmin && (
            <Button as={Link} to="/admin/categorias" variant="outline-secondary" className="text-start">
              Categorías
            </Button>
          )}
          <Button as={Link} to="/admin/pedidos" variant="outline-secondary" className="text-start">
            Pedidos
          </Button>
          {esAdmin && (
            <Button as={Link} to="/admin/usuarios" variant="outline-secondary" className="text-start">
              Usuarios
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
