import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button, Col, Container, Nav, Navbar, Row } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";

// Layout compartido por todas las pantallas del panel admin: barra superior
// con el nombre del negocio y el usuario logueado, y una barra lateral de
// navegación entre secciones. El contenido de cada sección se renderiza en
// <Outlet /> (rutas hijas de /admin en App.jsx).
export default function AdminLayout() {
  const { usuario, esAdmin, cerrarSesion } = useAuth();
  const navigate = useNavigate();

  // FIX UX-07 (auditoría UX/UI 26/08/2026, reportado por el cliente): navegar
  // antes de cerrarSesion() -- ver el comentario completo en
  // SiteLayout.jsx. Evita que RutaProtegida redirija con `state.from`
  // apuntando a la pantalla admin en la que estabas y te devuelva ahí
  // después de loguearte de nuevo.
  async function manejarCerrarSesion() {
    navigate("/login");
    await cerrarSesion();
  }

  return (
    <div>
      <Navbar bg="dark" variant="dark" className="px-3">
        <Navbar.Brand>NovaByte · Admin</Navbar.Brand>
        <Nav className="ms-auto align-items-center">
          <Navbar.Text className="me-3">{usuario?.email}</Navbar.Text>
          <Button as={NavLink} to="/" variant="outline-light" size="sm" className="me-2">
            Ir a la tienda
          </Button>
          <Button variant="outline-light" size="sm" onClick={manejarCerrarSesion}>
            Cerrar sesión
          </Button>
        </Nav>
      </Navbar>

      <Container fluid>
        <Row>
          <Col xs={12} md={3} lg={2} className="sidebar-admin py-3">
            <Nav className="flex-column">
              {/* Productos/Categorías/Usuarios: solo admin (un ayudante no
                  entra ahí ni con el link a mano, RutaAdmin lo rebota) --
                  ocultarlo acá evita mostrar accesos que van a fallar. */}
              {esAdmin && (
                <>
                  <Nav.Link as={NavLink} to="/admin/productos" end>
                    Productos
                  </Nav.Link>
                  <Nav.Link as={NavLink} to="/admin/categorias" end>
                    Categorías
                  </Nav.Link>
                </>
              )}
              <Nav.Link as={NavLink} to="/admin/pedidos" end>
                Pedidos
              </Nav.Link>
              {esAdmin && (
                <Nav.Link as={NavLink} to="/admin/usuarios" end>
                  Usuarios
                </Nav.Link>
              )}
            </Nav>
          </Col>
          <Col xs={12} md={9} lg={10} className="py-4">
            <Outlet />
          </Col>
        </Row>
      </Container>
    </div>
  );
}
