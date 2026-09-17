import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Container, Form, InputGroup, Row, Spinner } from "react-bootstrap";
import { registrarUsuario } from "../api/auth";
import { extraerMensajeError } from "../api/client";
// FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
// mismo toggle de mostrar/ocultar contraseña que ya tiene Login.jsx (ver
// components/iconos.jsx) -- acá hace más falta todavía porque son los dos
// campos de "escribir la contraseña dos veces para confirmar" (ver más
// abajo, reg-password/reg-confirmarPassword).
import { IconoOjo, IconoOjoTachado } from "../components/iconos";
// FEATURE (26/08/2026, pedido del cliente): lista de provincias -- ver
// ese archivo, es la única fuente de verdad (también la usa
// ConfiguracionPrivacidad.jsx).
import { PROVINCIAS } from "../utils/provincias";
// FEATURE (27/08/2026, pedido del cliente): ciudades agrupadas por
// provincia, para que el <select> de Ciudad dependa de la Provincia
// elegida -- ver ese archivo (también lo usa ConfiguracionPrivacidad.jsx).
import { CIUDADES_POR_PROVINCIA } from "../utils/ciudadesPorProvincia";

// Mismos valores que los enums del backend (app/models/user.py). El "value"
// es lo que viaja en el JSON hacia la API; el "label" es lo que ve el usuario.
const OPCIONES_TIPO_DOCUMENTO = [
  { value: "DNI", label: "DNI" },
  { value: "CUIT", label: "CUIT" },
  { value: "CUIL", label: "CUIL" },
];

const OPCIONES_CONDICION_IVA = [
  { value: "consumidor final", label: "Consumidor Final" },
  { value: "responsable inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
];

// Relación 1 a 1 entre tipo de documento y condición frente al IVA
// (pedido puntual del dueño de la tienda) -- mismo criterio que ya aplica
// el backend (ver _validar_condicion_iva_segun_documento en
// app/schemas/user.py): con DNI la única opción válida es "Consumidor
// Final" (quien se identifica con DNI no tiene CUIT propio para ser otra
// cosa); con CUIT/CUIL es cualquiera de las otras tres, nunca "Consumidor
// Final".
function opcionesCondicionIvaPara(tipoDocumento) {
  if (tipoDocumento === "DNI") {
    return OPCIONES_CONDICION_IVA.filter((opcion) => opcion.value === "consumidor final");
  }
  return OPCIONES_CONDICION_IVA.filter((opcion) => opcion.value !== "consumidor final");
}

const ESTADO_INICIAL = {
  email: "",
  razonSocial: "",
  tipoDocumento: "DNI",
  numeroDocumento: "",
  condicionIva: "consumidor final",
  telefono: "",
  // FIX (26/08/2026, pedido del cliente): direccion ahora es obligatoria
  // (antes era opcional). ciudad es un campo nuevo, también obligatorio --
  // ver UsuarioCreate en app/schemas/user.py. provincia/código postal ya
  // eran obligatorios desde el cambio anterior -- provincia arranca con
  // un valor real (la primera de la lista) en vez de "", ya que el
  // <select> no tiene una opción "Sin especificar" para representar un
  // valor vacío.
  //
  // FEATURE (27/08/2026, pedido del cliente): ciudad ahora depende de
  // provincia (ver CIUDADES_POR_PROVINCIA) -- mismo criterio que
  // provincia de acá abajo, arranca en la primera ciudad de la lista de
  // la provincia default, no en "".
  direccion: "",
  ciudad: CIUDADES_POR_PROVINCIA[PROVINCIAS[0].value][0],
  provincia: PROVINCIAS[0].value,
  codigoPostal: "",
  password: "",
  confirmarPassword: "",
};

export default function Register() {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(false);
  // FEATURE (30/08/2026, hallazgo Media-Alta #5 de la auditoría UX/UI):
  // arrancan ocultas igual que cualquier campo de contraseña -- un botón al
  // lado de cada una la muestra/oculta a pedido (ver Login.jsx). Van por
  // separado, no juntas: mostrar una no debería destapar la otra sin que el
  // usuario lo pida.
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmarPassword, setMostrarConfirmarPassword] = useState(false);
  const navigate = useNavigate();

  // El número de documento cambia de forma según el tipo (ver el bloque
  // "Número de documento" más abajo): DNI es un campo único de hasta 8
  // dígitos, CUIT/CUIL son tres campos separados (2 dígitos, guion, 8
  // dígitos, guion, 1 dígito) siguiendo el formato real argentino
  // (XX-XXXXXXXX-X) -- antes era un solo campo de texto libre sin ninguna
  // guía, así que era fácil escribir un CUIT/CUIL con un formato que no
  // pasaba la validación (7-8 dígitos para DNI / 11 para CUIT-CUIL, ver
  // validarLocalmente más abajo y UsuarioBase en app/schemas/user.py) sin
  // entender por qué. form.numeroDocumento sigue siendo lo único que se
  // manda al backend -- estos tres campos solo arman ese string.
  const [cuitPrefijo, setCuitPrefijo] = useState("");
  const [cuitNumero, setCuitNumero] = useState("");
  const [cuitVerificador, setCuitVerificador] = useState("");
  const refCuitNumero = useRef(null);
  const refCuitVerificador = useRef(null);

  function actualizarCampo(campo) {
    return (event) => {
      setForm((prev) => ({ ...prev, [campo]: event.target.value }));
    };
  }

  // FEATURE (27/08/2026, pedido del cliente): cambiar de provincia cambia
  // qué ciudades tiene sentido ofrecer (ver CIUDADES_POR_PROVINCIA) -- la
  // ciudad elegida hasta ahora casi seguro no pertenece a la provincia
  // nueva, así que se resetea a la primera de la lista nueva (mismo
  // criterio "sin placeholder" que el <select> de Provincia).
  function manejarCambioProvincia(event) {
    const nuevaProvincia = event.target.value;
    setForm((prev) => ({
      ...prev,
      provincia: nuevaProvincia,
      ciudad: CIUDADES_POR_PROVINCIA[nuevaProvincia][0],
    }));
  }

  // Cambiar el tipo de documento limpia lo que se había escrito: un DNI a
  // medio completar no tiene ningún sentido como CUIT (ni viceversa), y
  // dejarlo a medias solo generaría un error de validación confuso.
  function manejarCambioTipoDocumento(event) {
    const nuevoTipo = event.target.value;
    setForm((prev) => ({
      ...prev,
      tipoDocumento: nuevoTipo,
      numeroDocumento: "",
      // Relación 1 a 1 con el tipo de documento (ver opcionesCondicionIvaPara):
      // a DNI le corresponde forzar "Consumidor Final" (es la única opción
      // que va a mostrar el <select>); a CUIT/CUIL, si tenía elegido
      // "Consumidor Final" hay que pisarlo por otra cosa porque esa opción
      // deja de estar disponible. En cualquier otro caso (ya tenía una
      // condición válida para el tipo nuevo) se deja como estaba.
      condicionIva:
        nuevoTipo === "DNI"
          ? "consumidor final"
          : prev.condicionIva === "consumidor final"
            ? "responsable inscripto"
            : prev.condicionIva,
    }));
    setCuitPrefijo("");
    setCuitNumero("");
    setCuitVerificador("");
  }

  function actualizarDni(event) {
    const digitos = event.target.value.replace(/\D/g, "").slice(0, 8);
    setForm((prev) => ({ ...prev, numeroDocumento: digitos }));
  }

  // Arma form.numeroDocumento como "XX-XXXXXXXX-X" a partir de los tres
  // campos -- el backend igual limpia los guiones antes de contar dígitos
  // (ver _validar_formato_documento en app/schemas/user.py), pero mandarlo
  // ya formateado deja el dato guardado con el mismo formato con el que
  // cualquier argentino reconoce un CUIT/CUIL. Autoavanza al campo
  // siguiente apenas se completan los dígitos de este, mismo criterio que
  // un código de verificación de varios dígitos.
  function actualizarCuitPrefijo(event) {
    const valor = event.target.value.replace(/\D/g, "").slice(0, 2);
    setCuitPrefijo(valor);
    setForm((prev) => ({ ...prev, numeroDocumento: `${valor}-${cuitNumero}-${cuitVerificador}` }));
    if (valor.length === 2) {
      refCuitNumero.current?.focus();
    }
  }

  function actualizarCuitNumero(event) {
    const valor = event.target.value.replace(/\D/g, "").slice(0, 8);
    setCuitNumero(valor);
    setForm((prev) => ({ ...prev, numeroDocumento: `${cuitPrefijo}-${valor}-${cuitVerificador}` }));
    if (valor.length === 8) {
      refCuitVerificador.current?.focus();
    }
  }

  function actualizarCuitVerificador(event) {
    const valor = event.target.value.replace(/\D/g, "").slice(0, 1);
    setCuitVerificador(valor);
    setForm((prev) => ({ ...prev, numeroDocumento: `${cuitPrefijo}-${cuitNumero}-${valor}` }));
  }

  function validarLocalmente() {
    // Validaciones espejo de app/schemas/user.py -- el backend siempre es la
    // fuente de verdad y vuelve a validar todo, esto es solo para dar
    // feedback inmediato sin esperar un viaje de ida y vuelta al servidor.
    if (form.password.length < 8) {
      return "La contraseña debe tener al menos 8 caracteres.";
    }
    if (form.password !== form.confirmarPassword) {
      return "Las contraseñas no coinciden.";
    }
    const digitos = form.numeroDocumento.replace(/\D/g, "");
    if (form.tipoDocumento === "DNI" && (digitos.length < 7 || digitos.length > 8)) {
      return "El DNI debe tener 7 u 8 dígitos.";
    }
    if (form.tipoDocumento !== "DNI" && digitos.length !== 11) {
      return "El CUIT/CUIL debe tener 11 dígitos.";
    }
    // FIX (26/08/2026, pedido del cliente): direccion, ciudad, provincia y
    // código postal ahora son obligatorios (ver UsuarioCreate en
    // app/schemas/user.py).
    if (!form.direccion.trim()) {
      return "La dirección es obligatoria.";
    }
    if (!form.ciudad.trim()) {
      return "La ciudad es obligatoria.";
    }
    if (!form.provincia) {
      return "La provincia es obligatoria.";
    }
    if (!form.codigoPostal.trim()) {
      return "El código postal es obligatorio.";
    }
    return "";
  }

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");

    const errorLocal = validarLocalmente();
    if (errorLocal) {
      setError(errorLocal);
      return;
    }

    setEnviando(true);
    try {
      await registrarUsuario(form);
      setExito(true);
      // El registro (POST /users/) ya dispara el mail con el código de
      // verificación (ver router/users.py); acá solo mandamos al usuario a
      // la pantalla donde lo va a ingresar. Se manda el email por state en
      // vez de por query string para no dejarlo visible en la URL/historial.
      setTimeout(() => navigate("/verificar-email", { state: { email: form.email } }), 1200);
    } catch (err) {
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
                <h1 className="h3">¡Cuenta creada!</h1>
                <p className="mb-0">
                  Te mandamos un código a tu mail para confirmar tu cuenta. Te vamos a redirigir en un momento...
                </p>
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
        <Col xs={12} sm={11} md={9} lg={7} xl={6}>
          {/* FIX (30/08/2026, hallazgo Media-Alta #8 de la auditoría
              UX/UI): "Login usa .superficie (fondo + borde propio) y las
              otras dos usan solo shadow-sm" -- se agrega acá el mismo
              .superficie que ya tiene Login.jsx (y ProductoDetalle.jsx/
              Contacto.jsx, ver esos archivos), para que el flujo de
              registro/recuperación no se vea "menos terminado" que el de
              login. */}
          <Card className="superficie shadow-sm">
            <Card.Body className="p-4">
              <h1 className="h3 text-center mb-4">Crear cuenta</h1>
              <Form onSubmit={manejarEnvio} noValidate>
                <Form.Group className="mb-3" controlId="reg-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={form.email}
                    onChange={actualizarCampo("email")}
                    required
                    autoComplete="email"
                  />
                </Form.Group>

                <Form.Group className="mb-3" controlId="reg-razonSocial">
                  <Form.Label>Nombre / Razón social</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.razonSocial}
                    onChange={actualizarCampo("razonSocial")}
                    required
                  />
                </Form.Group>

                <Row>
                  <Col xs={5}>
                    <Form.Group className="mb-3" controlId="reg-tipoDocumento">
                      <Form.Label>Tipo de documento</Form.Label>
                      <Form.Select value={form.tipoDocumento} onChange={manejarCambioTipoDocumento}>
                        {OPCIONES_TIPO_DOCUMENTO.map((opcion) => (
                          <option key={opcion.value} value={opcion.value}>
                            {opcion.label}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col xs={7}>
                    <Form.Group className="mb-3" controlId="reg-numeroDocumento">
                      <Form.Label>Número de documento</Form.Label>
                      {form.tipoDocumento === "DNI" ? (
                        <Form.Control
                          type="text"
                          inputMode="numeric"
                          placeholder="12345678"
                          value={form.numeroDocumento}
                          onChange={actualizarDni}
                          required
                        />
                      ) : (
                        // CUIT/CUIL con el formato real argentino
                        // (XX-XXXXXXXX-X): tres campos en vez de uno solo de
                        // texto libre, para que quede claro de entrada cuántos
                        // dígitos va cada parte -- antes era fácil escribir
                        // algo que no coincidiera con las 11 cifras que exige
                        // el backend sin entender por qué fallaba.
                        <div className="d-flex align-items-center gap-1">
                          <Form.Control
                            type="text"
                            inputMode="numeric"
                            aria-label="Prefijo del CUIT/CUIL (2 dígitos)"
                            placeholder="20"
                            style={{ width: 52, textAlign: "center", flex: "0 0 auto" }}
                            value={cuitPrefijo}
                            onChange={actualizarCuitPrefijo}
                            required
                          />
                          <span className="text-muted">-</span>
                          <Form.Control
                            ref={refCuitNumero}
                            type="text"
                            inputMode="numeric"
                            aria-label="Número del CUIT/CUIL (8 dígitos)"
                            placeholder="12345678"
                            style={{ flex: "1 1 auto", minWidth: 0, textAlign: "center" }}
                            value={cuitNumero}
                            onChange={actualizarCuitNumero}
                            required
                          />
                          <span className="text-muted">-</span>
                          <Form.Control
                            ref={refCuitVerificador}
                            type="text"
                            inputMode="numeric"
                            aria-label="Dígito verificador del CUIT/CUIL (1 dígito)"
                            placeholder="9"
                            style={{ width: 42, textAlign: "center", flex: "0 0 auto" }}
                            value={cuitVerificador}
                            onChange={actualizarCuitVerificador}
                            required
                          />
                        </div>
                      )}
                    </Form.Group>
                  </Col>
                </Row>

                <Form.Group className="mb-3" controlId="reg-condicionIva">
                  <Form.Label>Condición frente al IVA</Form.Label>
                  <Form.Select
                    value={form.condicionIva}
                    onChange={actualizarCampo("condicionIva")}
                    // Con DNI es la única opción posible (ver
                    // opcionesCondicionIvaPara) -- deshabilitado en vez de
                    // dejar un <select> de un solo valor que invita a
                    // hacer clic sin que pase nada.
                    disabled={form.tipoDocumento === "DNI"}
                  >
                    {opcionesCondicionIvaPara(form.tipoDocumento).map((opcion) => (
                      <option key={opcion.value} value={opcion.value}>
                        {opcion.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3" controlId="reg-telefono">
                  <Form.Label>Teléfono</Form.Label>
                  <Form.Control
                    type="tel"
                    value={form.telefono}
                    onChange={actualizarCampo("telefono")}
                    required
                  />
                </Form.Group>

                {/* FIX (26/08/2026, pedido del cliente): dirección ahora
                    obligatoria (antes decía "(opcional)" y no llevaba
                    required). */}
                <Form.Group className="mb-3" controlId="reg-direccion">
                  <Form.Label>Dirección</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.direccion}
                    onChange={actualizarCampo("direccion")}
                    required
                  />
                </Form.Group>

                {/* FEATURE (26/08/2026, pedido del cliente): provincia
                    (select, no texto libre -- ver utils/provincias.js).
                    FIX (26/08/2026, pedido del cliente): obligatoria -- ya
                    no hay opción "Sin especificar" en el <select> (arranca
                    en PROVINCIAS[0], ver ESTADO_INICIAL). Va antes que
                    Ciudad a propósito: la lista de Ciudad depende de la
                    Provincia elegida acá (ver manejarCambioProvincia). */}
                <Form.Group className="mb-3" controlId="reg-provincia">
                  <Form.Label>Provincia</Form.Label>
                  <Form.Select value={form.provincia} onChange={manejarCambioProvincia} required>
                    {PROVINCIAS.map((opcion) => (
                      <option key={opcion.value} value={opcion.value}>
                        {opcion.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>

                {/* FEATURE (27/08/2026, pedido del cliente): ciudad, ahora
                    depende de la provincia elegida arriba -- ver
                    CIUDADES_POR_PROVINCIA en utils/ciudadesPorProvincia.js.
                    FIX (30/08/2026, pedido del cliente): "sacá la opción
                    Otra (especificar)" -- antes, si la ciudad no estaba en
                    la lista, el campo pasaba a texto libre (ver
                    ConfiguracionPrivacidad.jsx/Usuarios.jsx, que todavía
                    tienen ese modo para cuentas ya existentes con una
                    ciudad vieja fuera de la lista). Acá en Registro, al ser
                    siempre una cuenta nueva, se saca esa opción y el campo
                    queda como un <select> simple, igual que Provincia. */}
                <Row>
                  <Col xs={12} sm={7}>
                    <Form.Group className="mb-3" controlId="reg-ciudad">
                      <Form.Label>Ciudad</Form.Label>
                      <Form.Select value={form.ciudad} onChange={actualizarCampo("ciudad")} required>
                        {CIUDADES_POR_PROVINCIA[form.provincia].map((ciudad) => (
                          <option key={ciudad} value={ciudad}>
                            {ciudad}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col xs={12} sm={5}>
                    <Form.Group className="mb-3" controlId="reg-codigoPostal">
                      <Form.Label>Código postal</Form.Label>
                      <Form.Control
                        type="text"
                        value={form.codigoPostal}
                        onChange={actualizarCampo("codigoPostal")}
                        required
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Row>
                  <Col xs={6}>
                    <Form.Group className="mb-3" controlId="reg-password">
                      <Form.Label>Contraseña</Form.Label>
                      {/* FEATURE (30/08/2026, hallazgo Media-Alta #5 de la
                          auditoría UX/UI): toggle de mostrar/ocultar -- ver
                          mostrarPassword más arriba. */}
                      <InputGroup>
                        <Form.Control
                          type={mostrarPassword ? "text" : "password"}
                          value={form.password}
                          onChange={actualizarCampo("password")}
                          required
                          minLength={8}
                          autoComplete="new-password"
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
                  </Col>
                  <Col xs={6}>
                    <Form.Group className="mb-3" controlId="reg-confirmarPassword">
                      <Form.Label>Confirmar contraseña</Form.Label>
                      {/* FEATURE (30/08/2026, hallazgo Media-Alta #5 de la
                          auditoría UX/UI): toggle de mostrar/ocultar -- ver
                          mostrarConfirmarPassword más arriba. */}
                      <InputGroup>
                        <Form.Control
                          type={mostrarConfirmarPassword ? "text" : "password"}
                          value={form.confirmarPassword}
                          onChange={actualizarCampo("confirmarPassword")}
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

                <Button type="submit" variant="primary" className="w-100" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Creando cuenta...
                    </>
                  ) : (
                    "Crear cuenta"
                  )}
                </Button>
              </Form>

              <p className="text-center mt-4 mb-0">
                ¿Ya tenés cuenta? <Link to="/login">Iniciar sesión</Link>
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
