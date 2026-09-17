import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner } from "react-bootstrap";
import {
  actualizarMiPerfil,
  cambiarMiPassword,
  confirmarCambioEmail,
  reenviarVerificacion,
  solicitarCambioEmail,
} from "../api/auth";
import { extraerMensajeError } from "../api/client";
import { useAuth } from "../context/AuthContext";
// FEATURE (26/08/2026, pedido del cliente): lista de provincias -- ver ese
// archivo, es la única fuente de verdad (también la usa Register.jsx).
import { PROVINCIAS } from "../utils/provincias";
// FEATURE (27/08/2026, pedido del cliente): ciudades agrupadas por
// provincia -- ver ese archivo (también lo usa Register.jsx).
import { CIUDADES_POR_PROVINCIA } from "../utils/ciudadesPorProvincia";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): las
// confirmaciones de "Guardado."/"Email actualizado."/etc. de las tres
// tarjetas de abajo pasan a toast -- ver utils/notificaciones.js. Los
// errores de cada tarjeta se dejan inline a propósito: el formulario sigue
// abierto para corregir (ej. contraseña actual incorrecta), así que
// conviene que el motivo quede a la vista ahí mismo.
import { notificarExito } from "../utils/notificaciones";
// FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
// mismo toggle de mostrar/ocultar contraseña que ya tiene Login.jsx (ver
// components/iconos.jsx) -- acá hace más falta todavía porque es el flujo
// con TRES campos de contraseña (actual + nueva + confirmar, ver más abajo
// priv-password-actual/priv-password-nueva/priv-password-confirmar).
import { IconoOjo, IconoOjoTachado } from "../components/iconos";

// Mismas etiquetas que usa Register.jsx para los mismos valores.
const ETIQUETAS_TIPO_DOCUMENTO = { DNI: "DNI", CUIT: "CUIT", CUIL: "CUIL" };
const ETIQUETAS_CONDICION_IVA = {
  "consumidor final": "Consumidor Final",
  "responsable inscripto": "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};

// Mismo sentinel que Register.jsx para "no está en la lista" en el
// <select> de Ciudad.
const OTRA_CIUDAD = "__otra__";

// Sub-sección "Privacidad" de Configuración (ver ConfiguracionLayout.jsx):
// muestra todos los datos de la cuenta propia. Razón social, documento y
// condición de IVA se muestran de solo lectura -- cambiarlos no pasa por
// acá (ver UsuarioUpdate en app/schemas/user.py); lo que sí se puede editar
// desde esta pantalla es teléfono/dirección, el email (con verificación
// por código a la casilla nueva) y la contraseña.
export default function ConfiguracionPrivacidad() {
  const { usuario, refrescarPerfil, cerrarSesion } = useAuth();

  if (!usuario) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <div className="d-flex flex-column gap-4">
      <h2 className="h5 mb-0">Privacidad</h2>
      <TarjetaTusDatos usuario={usuario} />
      <TarjetaContacto usuario={usuario} refrescarPerfil={refrescarPerfil} />
      <TarjetaEmail usuario={usuario} refrescarPerfil={refrescarPerfil} />
      <TarjetaPassword cerrarSesion={cerrarSesion} />
    </div>
  );
}

function TarjetaTusDatos({ usuario }) {
  const fechaCreacion = new Date(usuario.created_at).toLocaleDateString("es-AR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Card className="shadow-sm">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3">Tus datos</Card.Title>
        <p className="text-muted small mb-3">
          Estos campos no se pueden editar desde acá -- si necesitás corregir alguno, contactanos.
        </p>
        <Row className="row-gap-2">
          <Col xs={12} sm={6}>
            <div className="text-muted small">Nombre / Razón social</div>
            <div>{usuario.razon_social}</div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="text-muted small">Documento</div>
            <div>
              {ETIQUETAS_TIPO_DOCUMENTO[usuario.tipo_documento] ?? usuario.tipo_documento} {usuario.numero_documento}
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="text-muted small">Condición frente al IVA</div>
            <div>{ETIQUETAS_CONDICION_IVA[usuario.condicion_iva] ?? usuario.condicion_iva}</div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="text-muted small">Cuenta creada</div>
            <div>{fechaCreacion}</div>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

function TarjetaContacto({ usuario, refrescarPerfil }) {
  const [telefono, setTelefono] = useState(usuario.telefono || "");
  // FIX (26/08/2026, pedido del cliente): direccion ahora es obligatoria
  // (ver UsuarioUpdate en app/schemas/user.py). A diferencia de provincia
  // (más abajo), acá no hace falta un valor de arranque "real" para
  // cuentas viejas con direccion en null -- el campo de texto puede
  // arrancar vacío sin problema, el required + la validación de abajo se
  // encargan de exigirlo recién al guardar.
  const [direccion, setDireccion] = useState(usuario.direccion || "");
  // FEATURE (26/08/2026, pedido del cliente): provincia/código postal --
  // mismo criterio que telefono/direccion de acá arriba.
  //
  // FIX (26/08/2026, pedido del cliente): ahora son obligatorios (ver
  // UsuarioUpdate en app/schemas/user.py), así que el <select> ya no tiene
  // una opción "Sin especificar" para representar un valor vacío. Para
  // cuentas creadas ANTES de este cambio -- que pueden tener
  // usuario.provincia en null -- el campo arranca en PROVINCIAS[0]
  // ("Buenos Aires") en vez de vacío. Ojo: si esa cuenta vieja guarda
  // cambios acá tocando solo otro campo (ej. el teléfono) sin fijarse en
  // Provincia, va a quedar grabada "Buenos Aires" aunque no sea la
  // provincia real -- es la contrapartida de "obligatorio + sin
  // placeholder" que pidió el cliente.
  const [provincia, setProvincia] = useState(usuario.provincia || PROVINCIAS[0].value);
  // FEATURE (27/08/2026, pedido del cliente): ciudad ahora depende de la
  // provincia elegida (ver CIUDADES_POR_PROVINCIA) -- mismo criterio de
  // reseteo que Register.jsx (ver manejarCambioProvincia/
  // manejarCambioCiudad más abajo). Acá hay un caso extra que Register.jsx
  // no tiene: cuentas ya guardadas pueden tener en usuario.ciudad un valor
  // que no esté en nuestra lista curada de esa provincia (se cargó como
  // texto libre antes de este cambio, o es una localidad que no
  // incluimos) -- ahí arranca en modo "Otra" con el valor ya guardado, en
  // vez de pisarlo por una ciudad de la lista que no es la real.
  const provinciaInicial = usuario.provincia || PROVINCIAS[0].value;
  const ciudadInicialEnLista =
    !!usuario.ciudad && CIUDADES_POR_PROVINCIA[provinciaInicial].includes(usuario.ciudad);
  const [ciudad, setCiudad] = useState(usuario.ciudad || CIUDADES_POR_PROVINCIA[provinciaInicial][0]);
  const [ciudadEsOtra, setCiudadEsOtra] = useState(!!usuario.ciudad && !ciudadInicialEnLista);
  const [codigoPostal, setCodigoPostal] = useState(usuario.codigo_postal || "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Cambiar de provincia cambia qué ciudades tiene sentido ofrecer -- la
  // ciudad elegida hasta ahora casi seguro no pertenece a la provincia
  // nueva, así que se resetea a la primera de la lista nueva (mismo
  // criterio "sin placeholder" que el <select> de Provincia).
  function manejarCambioProvincia(event) {
    const nuevaProvincia = event.target.value;
    setProvincia(nuevaProvincia);
    setCiudad(CIUDADES_POR_PROVINCIA[nuevaProvincia][0]);
    setCiudadEsOtra(false);
  }

  // Elegir "Otra (especificar)" pasa el campo a texto libre; cualquier
  // otra opción es una ciudad real de la lista.
  function manejarCambioCiudad(event) {
    const valor = event.target.value;
    if (valor === OTRA_CIUDAD) {
      setCiudadEsOtra(true);
      setCiudad("");
    } else {
      setCiudadEsOtra(false);
      setCiudad(valor);
    }
  }

  // Volver del modo "texto libre" al <select>.
  function volverAListaDeCiudades() {
    setCiudadEsOtra(false);
    setCiudad(CIUDADES_POR_PROVINCIA[provincia][0]);
  }

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");
    // FIX (26/08/2026, pedido del cliente): feedback inmediato sin esperar
    // la vuelta del backend -- mismo criterio que validarLocalmente en
    // Register.jsx.
    if (!direccion.trim()) {
      setError("La dirección es obligatoria.");
      return;
    }
    if (!ciudad.trim()) {
      setError("La ciudad es obligatoria.");
      return;
    }
    if (!codigoPostal.trim()) {
      setError("El código postal es obligatorio.");
      return;
    }
    setGuardando(true);
    try {
      await actualizarMiPerfil({ telefono, direccion, ciudad, provincia, codigoPostal });
      await refrescarPerfil();
      // FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): antes esto
      // era un <Alert variant="success"> local -- ver utils/notificaciones.js.
      notificarExito("Guardado.");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3">Datos de contacto</Card.Title>
        <Form onSubmit={manejarEnvio} noValidate>
          <Row>
            <Col xs={12} sm={6}>
              <Form.Group className="mb-3" controlId="priv-telefono">
                <Form.Label>Teléfono</Form.Label>
                <Form.Control
                  type="tel"
                  value={telefono}
                  onChange={(event) => setTelefono(event.target.value)}
                  required
                />
              </Form.Group>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Group className="mb-3" controlId="priv-direccion">
                <Form.Label>Dirección</Form.Label>
                <Form.Control
                  type="text"
                  value={direccion}
                  onChange={(event) => setDireccion(event.target.value)}
                  required
                />
              </Form.Group>
            </Col>
            <Col xs={12}>
              {/* FEATURE (26/08/2026, pedido del cliente): provincia
                  (select, no texto libre). Va antes que Ciudad a propósito
                  -- ver manejarCambioProvincia: la lista de Ciudad depende
                  de lo que se elija acá. */}
              <Form.Group className="mb-3" controlId="priv-provincia">
                <Form.Label>Provincia</Form.Label>
                <Form.Select value={provincia} onChange={manejarCambioProvincia} required>
                  {PROVINCIAS.map((opcion) => (
                    <option key={opcion.value} value={opcion.value}>
                      {opcion.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} sm={7}>
              {/* FEATURE (27/08/2026, pedido del cliente): ciudad, ahora
                  depende de la provincia elegida arriba -- ver
                  CIUDADES_POR_PROVINCIA en utils/ciudadesPorProvincia.js.
                  "Otra" pasa el campo a texto libre para no dejar afuera a
                  nadie cuya ciudad no esté en la lista (o cuentas viejas
                  con una ciudad ya cargada que no está en la lista). */}
              <Form.Group className="mb-3" controlId="priv-ciudad">
                <Form.Label>Ciudad</Form.Label>
                {ciudadEsOtra ? (
                  <>
                    <Form.Control
                      type="text"
                      value={ciudad}
                      onChange={(event) => setCiudad(event.target.value)}
                      required
                    />
                    <Form.Text>
                      <Button variant="link" size="sm" className="p-0" onClick={volverAListaDeCiudades}>
                        Elegir de la lista
                      </Button>
                    </Form.Text>
                  </>
                ) : (
                  <Form.Select value={ciudad} onChange={manejarCambioCiudad} required>
                    {CIUDADES_POR_PROVINCIA[provincia].map((opcion) => (
                      <option key={opcion} value={opcion}>
                        {opcion}
                      </option>
                    ))}
                    <option value={OTRA_CIUDAD}>Otra (especificar)</option>
                  </Form.Select>
                )}
              </Form.Group>
            </Col>
            <Col xs={12} sm={5}>
              <Form.Group className="mb-3" controlId="priv-codigoPostal">
                <Form.Label>Código postal</Form.Label>
                <Form.Control
                  type="text"
                  value={codigoPostal}
                  onChange={(event) => setCodigoPostal(event.target.value)}
                  required
                />
              </Form.Group>
            </Col>
          </Row>

          {error && <Alert variant="danger">{error}</Alert>}

          <Button type="submit" variant="primary" disabled={guardando}>
            {guardando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Guardando...
              </>
            ) : (
              "Guardar cambios"
            )}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}

function TarjetaEmail({ usuario, refrescarPerfil }) {
  const [cambiando, setCambiando] = useState(false);
  const [paso, setPaso] = useState(1);
  const [emailNuevo, setEmailNuevo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  function cancelar() {
    setCambiando(false);
    setPaso(1);
    setEmailNuevo("");
    setCodigo("");
    setError("");
    setMensaje("");
  }

  async function manejarReenvioVerificacion() {
    setError("");
    setMensaje("");
    setReenviando(true);
    try {
      const respuesta = await reenviarVerificacion({ email: usuario.email });
      // FIX UX-03: confirmación puntual, sin ningún paso siguiente que
      // dependa de leerla más tarde -- toast, igual que TarjetaContacto.
      notificarExito(respuesta.data?.detail || "Te enviamos un código nuevo.");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setReenviando(false);
    }
  }

  async function pedirCodigoCambio(event) {
    event.preventDefault();
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const respuesta = await solicitarCambioEmail({ emailNuevo });
      setMensaje(respuesta.data?.detail || "Si ese email está disponible, te enviamos un código a esa dirección.");
      setPaso(2);
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarCambio(event) {
    event.preventDefault();
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      await confirmarCambioEmail({ codigo });
      await refrescarPerfil();
      // FIX UX-03: acción terminada y el formulario se cierra (setCambiando
      // más abajo) -- no hay ninguna pantalla siguiente que necesite seguir
      // mostrando este texto, así que pasa a toast.
      notificarExito("Email actualizado.");
      setCambiando(false);
      setPaso(1);
      setEmailNuevo("");
      setCodigo("");
    } catch (err) {
      // Mismo error genérico para código equivocado/vencido -- ver
      // POST /users/me/email/confirmar.
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3">Email</Card.Title>

        <div className="d-flex align-items-center gap-2 mb-3">
          <span>{usuario.email}</span>
          {usuario.email_verificado ? (
            <Badge bg="success">Verificado</Badge>
          ) : (
            <Badge bg="warning" text="dark">
              Sin verificar
            </Badge>
          )}
        </div>

        {!usuario.email_verificado && !cambiando && (
          <Button variant="outline-secondary" size="sm" className="mb-3" disabled={reenviando} onClick={manejarReenvioVerificacion}>
            {reenviando ? "Enviando..." : "Reenviar código de verificación"}
          </Button>
        )}

        {error && <Alert variant="danger">{error}</Alert>}
        {mensaje && <Alert variant="success">{mensaje}</Alert>}

        {!cambiando ? (
          <div>
            <Button variant="outline-primary" size="sm" onClick={() => setCambiando(true)}>
              Cambiar email
            </Button>
          </div>
        ) : paso === 1 ? (
          <Form onSubmit={pedirCodigoCambio} noValidate>
            <Form.Group className="mb-3" controlId="priv-email-nuevo">
              <Form.Label>Nuevo email</Form.Label>
              <Form.Control
                type="email"
                value={emailNuevo}
                onChange={(event) => setEmailNuevo(event.target.value)}
                required
                autoComplete="email"
              />
            </Form.Group>
            <div className="d-flex gap-2">
              <Button type="submit" variant="primary" disabled={enviando}>
                {enviando ? "Enviando..." : "Enviar código"}
              </Button>
              <Button type="button" variant="outline-secondary" onClick={cancelar}>
                Cancelar
              </Button>
            </div>
          </Form>
        ) : (
          <Form onSubmit={confirmarCambio} noValidate>
            <p className="text-muted small">
              Ingresá el código que te mandamos a <strong>{emailNuevo}</strong>.
            </p>
            <Form.Group className="mb-3" controlId="priv-codigo-email">
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
            <div className="d-flex gap-2">
              <Button type="submit" variant="primary" disabled={enviando || codigo.length !== 6}>
                {enviando ? "Confirmando..." : "Confirmar"}
              </Button>
              <Button type="button" variant="outline-secondary" onClick={cancelar}>
                Cancelar
              </Button>
            </div>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
}

function TarjetaPassword({ cerrarSesion }) {
  const navigate = useNavigate();
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  // FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
  // arrancan ocultas igual que cualquier campo de contraseña -- un botón al
  // lado de cada una la muestra/oculta a pedido (ver Login.jsx). Van cada
  // una por separado: mostrar una no debería destapar las otras dos sin que
  // el usuario lo pida.
  const [mostrarPasswordActual, setMostrarPasswordActual] = useState(false);
  const [mostrarPasswordNueva, setMostrarPasswordNueva] = useState(false);
  const [mostrarConfirmarPassword, setMostrarConfirmarPassword] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");

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
      await cambiarMiPassword({ passwordActual, passwordNueva });
      // El backend revoca todos los refresh tokens al cambiar la
      // contraseña (incluida esta sesión) -- mejor cerrar sesión acá
      // mismo y mandar a loguearse de nuevo, en vez de dejar la pantalla
      // en un estado "logueado" que va a fallar en el próximo refresh.
      // FIX UX-07 (auditoría UX/UI 26/08/2026, reportado por el cliente):
      // navegar ANTES de cerrarSesion() -- mismo motivo que en
      // SiteLayout.jsx/AdminLayout.jsx: si cerrarSesion() corre primero,
      // RutaProtegida (todavía montada acá, en /configuracion) redirige por
      // su cuenta con `state.from` apuntando a esta pantalla, y después de
      // loguearse te devuelve a Privacidad en vez de al inicio.
      navigate("/login");
      await cerrarSesion();
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3">Contraseña</Card.Title>
        <Form onSubmit={manejarEnvio} noValidate>
          <Form.Group className="mb-3" controlId="priv-password-actual">
            <Form.Label>Contraseña actual</Form.Label>
            {/* FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría
                UX/UI): toggle de mostrar/ocultar -- ver
                mostrarPasswordActual más arriba. */}
            <InputGroup>
              <Form.Control
                type={mostrarPasswordActual ? "text" : "password"}
                value={passwordActual}
                onChange={(event) => setPasswordActual(event.target.value)}
                required
                autoComplete="current-password"
              />
              <Button
                variant="outline-secondary"
                type="button"
                onClick={() => setMostrarPasswordActual((actual) => !actual)}
                aria-label={mostrarPasswordActual ? "Ocultar contraseña" : "Mostrar contraseña"}
                title={mostrarPasswordActual ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {mostrarPasswordActual ? <IconoOjoTachado /> : <IconoOjo />}
              </Button>
            </InputGroup>
          </Form.Group>
          <Row>
            <Col xs={12} sm={6}>
              <Form.Group className="mb-3" controlId="priv-password-nueva">
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
            </Col>
            <Col xs={12} sm={6}>
              <Form.Group className="mb-3" controlId="priv-password-confirmar">
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
            </Col>
          </Row>

          {error && <Alert variant="danger">{error}</Alert>}

          <Button type="submit" variant="primary" disabled={enviando}>
            {enviando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Cambiando...
              </>
            ) : (
              "Cambiar contraseña"
            )}
          </Button>
          <p className="text-muted small mt-2 mb-0">
            Al cambiarla se cierra tu sesión en todos los dispositivos, incluido este.
          </p>
        </Form>
      </Card.Body>
    </Card>
  );
}
