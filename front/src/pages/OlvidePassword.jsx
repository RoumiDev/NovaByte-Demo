import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Container, Form, InputGroup, Row, Spinner } from "react-bootstrap";
import { restablecerPassword, solicitarRecuperacionPassword } from "../api/auth";
import { extraerMensajeError } from "../api/client";
// FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
// mismo toggle de mostrar/ocultar contraseña que ya tiene Login.jsx (ver
// components/iconos.jsx) -- acá hace más falta todavía porque son los dos
// campos de "escribir la contraseña dos veces para confirmar" (ver más
// abajo, olvide-passwordNueva/olvide-confirmarPassword).
import { IconoOjo, IconoOjoTachado } from "../components/iconos";

// Flujo en dos pasos dentro de la misma pantalla: 1) pedir el código por
// mail, 2) ingresar ese código + la contraseña nueva. Se mantienen los dos
// pasos acá (en vez de dos rutas separadas) porque comparten el email y no
// hay nada más que coordinar entre ellos.
export default function OlvidePassword() {
  const navigate = useNavigate();

  const [paso, setPaso] = useState(1);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  // FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
  // arrancan ocultas igual que cualquier campo de contraseña -- un botón al
  // lado de cada una la muestra/oculta a pedido (ver Login.jsx). Van por
  // separado, no juntas: mostrar una no debería destapar la otra sin que el
  // usuario lo pida.
  const [mostrarPasswordNueva, setMostrarPasswordNueva] = useState(false);
  const [mostrarConfirmarPassword, setMostrarConfirmarPassword] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [exito, setExito] = useState(false);

  async function pedirCodigo(event) {
    event.preventDefault();
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const respuesta = await solicitarRecuperacionPassword({ email });
      setMensaje(
        respuesta.data?.detail || "Si el mail corresponde a una cuenta, te enviamos un código para restablecer la contraseña.",
      );
      setPaso(2);
    } catch (err) {
      // Acá solo puede fallar por el rate limiter (429): el resto de los
      // casos (cuenta inexistente, inactiva) devuelven 200 a propósito.
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function reenviarCodigo() {
    setError("");
    setMensaje("");
    setReenviando(true);
    try {
      const respuesta = await solicitarRecuperacionPassword({ email });
      setMensaje(respuesta.data?.detail || "Te enviamos un código nuevo.");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setReenviando(false);
    }
  }

  async function restablecer(event) {
    event.preventDefault();
    setError("");
    setMensaje("");

    if (passwordNueva.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (passwordNueva !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setEnviando(true);
    try {
      await restablecerPassword({ email, codigo, passwordNueva });
      setExito(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      // Mismo error genérico para código equivocado/vencido/ya usado o
      // cuenta inexistente -- ver POST /users/restablecer-password.
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  if (exito) {
    return (
      <Container className="pantalla-centrada">
        <Row className="justify-content-center w-100">
          <Col xs={12} sm={10} md={7} lg={5}>
            {/* FIX (30/08/2026, hallazgo Media-Alta #8 de la auditoría
                UX/UI): "superficie" -- mismo criterio que ya usa Login.jsx
                (fondo + borde propio, no solo la sombra) para que esta
                pantalla no se vea "más plana" que el resto del flujo de
                autenticación. */}
            <Card className="superficie shadow-sm text-center">
              <Card.Body className="p-4">
                <h1 className="h3">¡Contraseña actualizada!</h1>
                <p className="mb-0">Te vamos a redirigir a iniciar sesión en un momento...</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <Container className="pantalla-centrada">
      <Row className="justify-content-center w-100">
        <Col xs={12} sm={10} md={7} lg={5}>
          {/* FIX (30/08/2026, hallazgo Media-Alta #8 de la auditoría
              UX/UI): "Login usa .superficie (fondo + borde propio) y las
              otras dos usan solo shadow-sm" -- se agrega acá el mismo
              .superficie que ya tiene Login.jsx (y ProductoDetalle.jsx/
              Contacto.jsx, ver esos archivos), para que el flujo de
              registro/recuperación no se vea "menos terminado" que el de
              login. */}
          <Card className="superficie shadow-sm">
            <Card.Body className="p-4">
              <h1 className="h4 text-center mb-2">Recuperar contraseña</h1>

              {paso === 1 ? (
                <>
                  <p className="text-center text-muted mb-4">
                    Ingresá el mail con el que te registraste y te mandamos un código para elegir una contraseña
                    nueva.
                  </p>
                  <Form onSubmit={pedirCodigo} noValidate>
                    <Form.Group className="mb-3" controlId="olvide-email">
                      <Form.Label>Email</Form.Label>
                      <Form.Control
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        autoComplete="email"
                      />
                    </Form.Group>

                    {error && <Alert variant="danger">{error}</Alert>}

                    <Button type="submit" variant="primary" className="w-100" disabled={enviando}>
                      {enviando ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Enviando...
                        </>
                      ) : (
                        "Enviar código"
                      )}
                    </Button>
                  </Form>
                </>
              ) : (
                <>
                  <p className="text-center text-muted mb-4">
                    Ingresá el código que te mandamos a <strong>{email}</strong> y elegí una contraseña nueva.
                  </p>
                  <Form onSubmit={restablecer} noValidate>
                    <Form.Group className="mb-3" controlId="olvide-codigo">
                      <Form.Label>Código</Form.Label>
                      <Form.Control
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        value={codigo}
                        onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        required
                        autoComplete="one-time-code"
                      />
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="olvide-passwordNueva">
                      <Form.Label>Contraseña nueva</Form.Label>
                      {/* FEATURE (30/08/2026, hallazgo Media-Alta #5 de la
                          auditoría UX/UI): toggle de mostrar/ocultar -- ver
                          mostrarPasswordNueva más arriba. */}
                      <InputGroup>
                        <Form.Control
                          type={mostrarPasswordNueva ? "text" : "password"}
                          value={passwordNueva}
                          onChange={(event) => setPasswordNueva(event.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                        />
                        <Button
                          variant="outline-secondary"
                          type="button"
                          onClick={() => setMostrarPasswordNueva((actual) => !actual)}
                          aria-label={mostrarPasswordNueva ? "Ocultar contraseña" : "Mostrar contraseña"}
                          title={mostrarPasswordNueva ? "Ocultar contraseña" : "Mostrar contraseña"}
                        >
                          {mostrarPasswordNueva ? <IconoOjoTachado /> : <IconoOjo />}
                        </Button>
                      </InputGroup>
                    </Form.Group>

                    <Form.Group className="mb-3" controlId="olvide-confirmarPassword">
                      <Form.Label>Confirmar contraseña nueva</Form.Label>
                      {/* FEATURE (30/08/2026, hallazgo Media-Alta #5 de la
                          auditoría UX/UI): toggle de mostrar/ocultar -- ver
                          mostrarConfirmarPassword más arriba. */}
                      <InputGroup>
                        <Form.Control
                          type={mostrarConfirmarPassword ? "text" : "password"}
                          value={confirmarPassword}
                          onChange={(event) => setConfirmarPassword(event.target.value)}
                          required
                          autoComplete="new-password"
                        />
                        <Button
                          variant="outline-secondary"
                          type="button"
                          onClick={() => setMostrarConfirmarPassword((actual) => !actual)}
                          aria-label={mostrarConfirmarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                          title={mostrarConfirmarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                        >
                          {mostrarConfirmarPassword ? <IconoOjoTachado /> : <IconoOjo />}
                        </Button>
                      </InputGroup>
                    </Form.Group>

                    {error && <Alert variant="danger">{error}</Alert>}
                    {mensaje && <Alert variant="info">{mensaje}</Alert>}

                    <Button
                      type="submit"
                      variant="primary"
                      className="w-100 mb-2"
                      disabled={enviando || codigo.length !== 6}
                    >
                      {enviando ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Guardando...
                        </>
                      ) : (
                        "Restablecer contraseña"
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline-secondary"
                      className="w-100"
                      disabled={reenviando}
                      onClick={reenviarCodigo}
                    >
                      {reenviando ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Enviando...
                        </>
                      ) : (
                        "Reenviar código"
                      )}
                    </Button>
                  </Form>
                </>
              )}

              <p className="text-center mt-4 mb-0">
                <Link to="/login">Volver a iniciar sesión</Link>
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
