// Sin uso: reemplazado por ConfiguracionLayout.jsx + ConfiguracionGeneral.jsx
// + ConfiguracionAdministracion.jsx + ConfiguracionPrivacidad.jsx (ahora
// Configuración tiene su propio sidebar fijo con sub-secciones -- ver
// App.jsx). Se deja este archivo en vez de borrarlo porque esta sesión no
// tiene forma de eliminar archivos de tu computadora -- lo podés borrar
// vos a mano (src/pages/Configuracion.jsx) si querés.
import { useEffect, useState } from "react";
import { Alert, Button, Card, Container, Form, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import { actualizarConfiguracionTienda, obtenerConfiguracionTienda } from "../api/store";
import { extraerMensajeError } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Se accede desde el sidebar (SiteLayout), para cualquier usuario
// logueado. La sección de horarios de atención solo se muestra (y solo se
// puede editar) si es admin -- el backend también lo exige (PATCH
// /configuracion/ tiene require_admin), esto es nada más para no mostrarle
// un formulario a alguien que después va a recibir un 403.
//
// La sección "Administración" (accesos a Productos/Categorías/Pedidos/
// Usuarios, antes su propio ítem en el sidebar) se movió acá adentro --
// las páginas de /admin/* en sí no se tocaron, solo desde dónde se entra.
export default function Configuracion() {
  const { esAdmin, esStaff } = useAuth();
  const [horarios, setHorarios] = useState("");
  const [cargando, setCargando] = useState(esAdmin);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!esAdmin) return;
    obtenerConfiguracionTienda()
      .then((respuesta) => setHorarios(respuesta.data.horarios_atencion || ""))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }, [esAdmin]);

  async function manejarGuardar(evento) {
    evento.preventDefault();
    setError("");
    setAviso("");
    setGuardando(true);
    try {
      await actualizarConfiguracionTienda({ horarios_atencion: horarios });
      setAviso("Horarios actualizados.");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Container className="pb-5 pt-4">
      <h1 className="h3 mb-4">Configuración</h1>

      <div className="d-flex flex-column gap-4">
        {/* Ayudante ve Pedidos (RutaStaff ya lo permite en el backend);
            Productos/Categorías/Usuarios siguen siendo solo-admin (cada
            ruta además está protegida con RutaAdmin en App.jsx, esto es
            nada más para no mostrar un acceso que va a rebotar). */}
        {esStaff && (
          <Card className="superficie shadow-sm" style={{ maxWidth: 520 }}>
            <Card.Body>
              <Card.Title className="h5 mb-1">Administración</Card.Title>
              <Card.Subtitle className="text-muted mb-3">
                Productos, categorías, pedidos y usuarios de la tienda.
              </Card.Subtitle>

              <div className="d-flex flex-column gap-2">
                {esAdmin && (
                  <Button
                    as={Link}
                    to="/admin/productos"
                    variant="outline-secondary"
                    className="text-start"
                  >
                    Productos
                  </Button>
                )}
                {esAdmin && (
                  <Button
                    as={Link}
                    to="/admin/categorias"
                    variant="outline-secondary"
                    className="text-start"
                  >
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
        )}

        {esAdmin && (
          <Card className="superficie shadow-sm" style={{ maxWidth: 520 }}>
            <Card.Body>
              <Card.Title className="h5 mb-1">Horarios de atención</Card.Title>
              <Card.Subtitle className="text-muted mb-3">
                Se muestran tal cual en la página de Contacto.
              </Card.Subtitle>

              {error && <Alert variant="danger">{error}</Alert>}
              {aviso && <Alert variant="success">{aviso}</Alert>}

              {cargando ? (
                <Spinner animation="border" size="sm" />
              ) : (
                <Form onSubmit={manejarGuardar}>
                  <Form.Group className="mb-3" controlId="horarios-atencion">
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={horarios}
                      onChange={(evento) => setHorarios(evento.target.value)}
                      placeholder={"Ej: Lunes a viernes 9 a 13 y 15 a 19hs.\nSábados 9 a 13hs.\nDomingos cerrado."}
                    />
                  </Form.Group>
                  <Button type="submit" variant="primary" disabled={guardando}>
                    {guardando ? "Guardando..." : "Guardar"}
                  </Button>
                </Form>
              )}
            </Card.Body>
          </Card>
        )}

        {!esStaff && <Alert variant="secondary">Todavía no hay opciones acá. Próximamente.</Alert>}
      </div>
    </Container>
  );
}
