import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from "react-bootstrap";
import { cambiarMiPassword } from "../api/auth";
import { extraerMensajeError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Marca from "./Marca";

// FEATURE (11/09/2026, pedido del cliente): "que cuando se logue por
// primera vez le aparezca un campo para colocar su contraseña nueva" --
// pantalla obligatoria que SiteLayout.jsx interpone delante de TODA la
// tienda (sidebar y cualquier <Outlet/> -- catálogo, carrito, panel de
// administración, lo que sea) mientras usuario.debe_cambiar_password venga
// en true desde el backend. Eso pasa únicamente justo después de que un
// admin le restableció la contraseña a mano a esta cuenta (ver
// admin_reset_password en app/router/users.py -- vía de emergencia para
// clientes con la casilla de mail llena, bloqueados fuera de su cuenta): el
// cliente entra con la contraseña temporal que el admin le pasó por
// teléfono/WhatsApp, y hasta que no elige una propia acá, no puede usar el
// resto de la tienda -- ni siquiera navegando a mano a otra URL, porque
// esto se evalúa ANTES que cualquier ruta protegida, no es una ruta aparte.
//
// A propósito NO es un endpoint nuevo: reusa cambiarMiPassword (POST
// /users/me/password, el mismo que usa TarjetaPassword en
// ConfiguracionPrivacidad.jsx) -- ese endpoint ya apaga
// debe_cambiar_password solo (ver change_my_password en router/users.py) y
// ya revoca todas las sesiones activas al cambiar la contraseña, así que
// el flujo de acá es el mismo que el de Privacidad: tras el éxito, cerrar
// sesión localmente y mandar a /login para que vuelva a entrar ya con la
// contraseña nueva (mismo motivo de "navegar ANTES de cerrarSesion()" que
// TarjetaPassword/SiteLayout -- ver el comentario grande ahí sobre la
// carrera con RutaProtegida).
export default function CambiarPasswordObligatorio() {
  const navigate = useNavigate();
  const { cerrarSesion } = useAuth();
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");

    // Espejo de _validar_password en app/schemas/user.py, mismo criterio
    // que TarjetaPassword -- feedback inmediato, el backend siempre vuelve
    // a validar esto igual.
    if (passwordNueva.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (passwordNueva !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (passwordNueva === passwordActual) {
      setError("Elegí una contraseña distinta de la temporal que te dieron.");
      return;
    }

    setEnviando(true);
    try {
      await cambiarMiPassword({ passwordActual, passwordNueva });
      navigate("/login", {
        replace: true,
        state: { mensaje: "Contraseña actualizada. Iniciá sesión con tu contraseña nueva." },
      });
      await cerrarSesion();
    } catch (err) {
      // Mismo error que TarjetaPassword si password_actual (la temporal)
      // está mal tipeada -- 401 "La contraseña actual no es correcta.".
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  // Salida por si el cliente no tiene a mano la contraseña temporal en
  // este momento y prefiere volver más tarde -- no lo dejamos encerrado
  // sin ninguna forma de salir de esta pantalla.
  async function manejarSalir() {
    navigate("/login", { replace: true });
    await cerrarSesion();
  }

  return (
    <Container className="pantalla-centrada">
      <Row className="justify-content-center w-100">
        <Col xs={12} sm={10} md={7} lg={5}>
          <Card className="superficie shadow-sm">
            <Card.Body className="p-4">
              <Marca className="mb-4" />
              <h1 className="h4 text-center mb-2">Elegí una contraseña nueva</h1>
              <p className="text-center text-muted mb-4">
                Un administrador restableció tu contraseña. Por seguridad, antes de seguir usando tu
                cuenta tenés que elegir una propia.
              </p>

              <Form onSubmit={manejarEnvio} noValidate>
                <Form.Group className="mb-3" controlId="obligatorio-password-actual">
                  <Form.Label>Contraseña temporal (la que te pasaron)</Form.Label>
                  <Form.Control
                    type="password"
                    value={passwordActual}
                    onChange={(event) => setPasswordActual(event.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </Form.Group>

                <Row>
                  <Col xs={12} sm={6}>
                    <Form.Group className="mb-3" controlId="obligatorio-password-nueva">
                      <Form.Label>Contraseña nueva</Form.Label>
                      <Form.Control
                        type="password"
                        value={passwordNueva}
                        onChange={(event) => setPasswordNueva(event.target.value)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Form.Group className="mb-3" controlId="obligatorio-password-confirmar">
                      <Form.Label>Confirmarla</Form.Label>
                      <Form.Control
                        type="password"
                        value={confirmarPassword}
                        onChange={(event) => setConfirmarPassword(event.target.value)}
                        required
                        autoComplete="new-password"
                      />
                    </Form.Group>
                  </Col>
                </Row>

                {error && <Alert variant="danger">{error}</Alert>}

                <Button type="submit" variant="primary" className="w-100 mb-2" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Guardando...
                    </>
                  ) : (
                    "Guardar y continuar"
                  )}
                </Button>
                <Button
                  variant="outline-secondary"
                  type="button"
                  className="w-100"
                  onClick={manejarSalir}
                  disabled={enviando}
                >
                  Cerrar sesión
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
