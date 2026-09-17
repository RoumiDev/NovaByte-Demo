import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from "react-bootstrap";
import { reenviarVerificacion, verificarEmail } from "../api/auth";
import { extraerMensajeError } from "../api/client";

// El email llega por state desde Register.jsx (ver navigate(..., { state })
// ahí). Si no está (ej. el usuario recargó la página o entró directo por
// URL), se pide como campo editable -- no depender de un solo camino.
export default function VerificarEmail() {
  const location = useLocation();
  const navigate = useNavigate();

  const [email, setEmail] = useState(location.state?.email || "");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [exito, setExito] = useState(false);

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      await verificarEmail({ email, codigo });
      setExito(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      // El backend responde el mismo error genérico ("Código inválido o
      // expirado") sin importar el motivo real (típo, vencido, ya usado, o
      // la cuenta no existe) -- ver POST /users/verificar-email.
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function manejarReenvio() {
    setError("");
    setMensaje("");
    setReenviando(true);
    try {
      const respuesta = await reenviarVerificacion({ email });
      setMensaje(respuesta.data?.detail || "Si el mail corresponde a una cuenta sin verificar, te enviamos un código nuevo.");
    } catch (err) {
      // Este endpoint solo puede fallar acá por el rate limiter (429) --
      // el resto de los casos (cuenta inexistente, ya verificada) devuelven
      // 200 a propósito, sin distinguirlos.
      setError(extraerMensajeError(err));
    } finally {
      setReenviando(false);
    }
  }

  if (exito) {
    return (
      <Container className="pantalla-centrada">
        <Row className="justify-content-center w-100">
          <Col xs={12} sm={10} md={7} lg={5}>
            <Card className="shadow-sm text-center">
              <Card.Body className="p-4">
                <h1 className="h3">¡Cuenta verificada!</h1>
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
          <Card className="shadow-sm">
            <Card.Body className="p-4">
              <h1 className="h4 text-center mb-2">Verificá tu cuenta</h1>
              <p className="text-center text-muted mb-3">
                Te mandamos un código de 6 dígitos a tu mail. Ingresalo acá abajo para confirmar tu cuenta.
              </p>

              {/* FEATURE (11/09/2026, pedido del cliente): aclaración para
                  cuando el código nunca llega (por ejemplo, casilla de mail
                  llena) -- antes de este cambio no había ninguna indicación
                  acá de que la cuenta YA se puede usar sin este paso: el
                  login (POST /auth/login) nunca exigió email_verificado=True
                  (ver router/users.py, docstring de register). Sin este
                  aviso, un usuario en esa situación quedaba convencido de
                  que estaba trabado sin poder hacer nada más que esperar un
                  código que nunca iba a llegar. */}
              <Alert variant="info" className="small">
                <strong>¿No te llegó el código?</strong> Puede que tu casilla de mail esté llena o el
                mail haya ido a spam. No es un problema: no hace falta verificar el mail para usar tu
                cuenta, así que ya podés <Link to="/login">iniciar sesión</Link> con el email y la
                contraseña que elegiste. Podés verificarlo más adelante, cuando quieras, desde "Mi
                cuenta" -- o probar "Reenviar código" acá abajo si liberaste espacio en la casilla.
              </Alert>

              <Form onSubmit={manejarEnvio} noValidate>
                <Form.Group className="mb-3" controlId="verif-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </Form.Group>

                <Form.Group className="mb-3" controlId="verif-codigo">
                  <Form.Label>Código de verificación</Form.Label>
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

                {error && <Alert variant="danger">{error}</Alert>}
                {mensaje && <Alert variant="info">{mensaje}</Alert>}

                <Button type="submit" variant="primary" className="w-100 mb-2" disabled={enviando || codigo.length !== 6}>
                  {enviando ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Verificando...
                    </>
                  ) : (
                    "Verificar"
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline-secondary"
                  className="w-100"
                  disabled={reenviando || !email}
                  onClick={manejarReenvio}
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
