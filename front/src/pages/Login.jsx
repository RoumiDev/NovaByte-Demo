import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Container, Form, InputGroup, Row, Spinner } from "react-bootstrap";
import { iniciarSesion } from "../api/auth";
import { extraerMensajeError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Marca from "../components/Marca";
// FIX UX-08 (auditoría UX/UI 26/08/2026, Baja #1): toggle de mostrar/ocultar
// contraseña -- ver components/iconos.jsx.
import { IconoOjo, IconoOjoTachado } from "../components/iconos";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // FIX UX-08: arranca oculta (type="password") como cualquier campo de
  // contraseña -- el botón de al lado la muestra/oculta a pedido.
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const { guardarSesion } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // FIX UX-01 (auditoría UX/UI 26/08/2026, Punto Crítico #1): si llegamos
  // acá porque RutaProtegida.jsx nos redirigió (por ejemplo desde
  // /catalogo sin sesión), `location.state` trae la ruta de origen y un
  // mensaje explicando por qué se pidió iniciar sesión -- antes esto se
  // perdía y el usuario caía en un login "porque sí".
  const origen = location.state?.from;
  const mensajeContextual = location.state?.mensaje;

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");

    // FIX (30/08/2026, reportado por el cliente): con el formulario vacío,
    // este chequeo antes faltaba -- el submit llegaba igual hasta el
    // backend (el <Form> tiene noValidate, ver más abajo, así que el
    // navegador no lo frena solo) y el 422 de OAuth2PasswordRequestForm
    // (app/router/auth.py) volvía con dos errores de Pydantic "Field
    // required" (uno por username, uno por password) sin traducir --
    // extraerMensajeError (api/client.js) los junta tal cual, así que en
    // pantalla terminaba apareciendo "Field required Field required" en
    // inglés. Con este chequeo ni se llega a llamar a la API.
    if (!email.trim() || !password) {
      setError("Completá tu email y tu contraseña.");
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await iniciarSesion({ email, password });
      await guardarSesion(respuesta.data);
      // FIX UX-01: si vinimos de una ruta protegida, volvemos ahí en vez de
      // mandar siempre al Home -- el usuario retoma justo donde quería
      // estar (ej: vuelve a /catalogo, no a "/").
      //
      // FIX (30/08/2026, pedido del cliente): "que cuando se inicie sesión
      // no aparezca el sidebar abierto". /login está fuera del árbol de
      // SiteLayout (ver App.jsx), así que al volver adentro SiteLayout se
      // monta de cero -- y por defecto, en pantallas grandes, arranca
      // abierto (ver el estado "abierto" en SiteLayout.jsx). Este flag en
      // el state de la navegación le avisa a SiteLayout que este montaje
      // puntual es "recién logueado", para que arranque cerrado esta vez
      // nada más -- no toca el comportamiento normal de "abierto por
      // defecto en escritorio" para cuando alguien ya logueado entra
      // directo o refresca la página.
      navigate(origen ? `${origen.pathname}${origen.search ?? ""}` : "/", {
        replace: true,
        state: { sidebarCerrado: true },
      });
    } catch (err) {
      // El backend responde 401 genérico tanto si el email no existe como si
      // la contraseña es incorrecta, a propósito (evita que alguien pueda
      // usar este formulario para adivinar qué emails están registrados).
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Container className="pantalla-centrada">
      <Row className="justify-content-center w-100">
        <Col xs={12} sm={10} md={7} lg={5} xl={4}>
          <Card className="superficie shadow-sm">
            <Card.Body className="p-4">
              <Marca className="mb-4" />
              <h1 className="h4 text-center mb-4">Iniciar sesión</h1>

              {/* FIX UX-01: aviso contextual de por qué se pidió login (ver
                  RutaProtegida.jsx) -- solo aparece cuando venimos de una
                  ruta protegida, no en un login "espontáneo". */}
              {mensajeContextual && (
                <Alert variant="info" className="small py-2">
                  {mensajeContextual}
                </Alert>
              )}

              <Form onSubmit={manejarEnvio} noValidate>
                <Form.Group className="mb-3" controlId="login-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </Form.Group>

                <Form.Group className="mb-3" controlId="login-password">
                  <Form.Label>Contraseña</Form.Label>
                  {/* FIX UX-08 (auditoría UX/UI 26/08/2026, Baja #1): antes no
                      había forma de verificar lo que se tipeó antes de
                      enviar el formulario -- ahora un botón al lado del
                      campo alterna entre ocultarla (por defecto) y
                      mostrarla en texto plano. */}
                  <InputGroup>
                    <Form.Control
                      type={mostrarPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <Button
                      variant="outline-secondary"
                      type="button"
                      onClick={() => setMostrarPassword((actual) => !actual)}
                      aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      title={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {mostrarPassword ? <IconoOjoTachado /> : <IconoOjo />}
                    </Button>
                  </InputGroup>
                </Form.Group>

                <div className="text-end mb-3">
                  <Link to="/olvide-password" className="small">
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>

                {error && <Alert variant="danger">{error}</Alert>}

                <Button type="submit" variant="primary" className="w-100" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Ingresando...
                    </>
                  ) : (
                    "Ingresar"
                  )}
                </Button>
              </Form>

              <p className="text-center mt-4 mb-0">
                ¿Todavía no tenés cuenta? <Link to="/register">Crear cuenta</Link>
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
