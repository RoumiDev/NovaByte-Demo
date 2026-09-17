import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";
import { actualizarConfiguracionTienda, obtenerConfiguracionTienda } from "../api/store";
import { extraerMensajeError } from "../api/client";
import { useAuth } from "../context/AuthContext";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): "Horarios
// actualizados." pasa a toast -- ver utils/notificaciones.js. `error`
// (más abajo) queda dedicado exclusivamente al fallo de la carga inicial
// (gatea todo el formulario); un fallo al guardar ahora también avisa por
// toast en vez de compartir ese mismo estado con la carga.
import { notificarError, notificarExito } from "../utils/notificaciones";
// FEATURE (29/08/2026, pedido del cliente): sección "Marcas destacadas"
// -- ver GrillaMarcasDestacadas.jsx (grilla de carga, misma lógica de
// admin-only que el resto de esta pantalla).
import GrillaMarcasDestacadas from "../components/GrillaMarcasDestacadas";
// FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): mismo modal
// de confirmación "sudo" que ya usan Productos.jsx/Categorias.jsx/
// Usuarios.jsx para dar de baja/promover -- acá lo suma cambiar la
// cotización del dólar, que reprecia TODO el catálogo en USD al instante
// (ver manejarGuardarCotizacion/confirmarCotizacion más abajo).
import ModalConfirmarPassword from "../components/ModalConfirmarPassword";

// Sub-sección "General" de Configuración (ver ConfiguracionLayout.jsx,
// ruta índice de /configuracion): horarios de atención y marcas
// destacadas -- el backend también exige admin en cada endpoint (PATCH
// /configuracion/, PUT/DELETE /configuracion/marcas-destacadas/...), esto
// es nada más para no mostrarle un formulario a alguien que después va a
// recibir un 403.
export default function ConfiguracionGeneral() {
  const { esAdmin } = useAuth();
  const [horarios, setHorarios] = useState("");
  const [cargando, setCargando] = useState(esAdmin);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- la
  // cotización que necesita el backend para convertir un producto cargado
  // en USD a su precio final en pesos (ver el column_property
  // Producto.precio_venta en app/models/product.py). Card aparte de
  // horarios, mismo criterio que "Marcas destacadas" más abajo: no comparte
  // botón "Guardar" con esa otra sección.
  //
  // El IVA que se suma en esa misma cuenta NO vive acá -- el dueño aclaró
  // que varía por producto (21% general, 10,5% reducido en algunos casos),
  // así que se carga en el registro de cada producto (ver Productos.jsx),
  // no como un único valor global de la tienda.
  const [cotizacionDolar, setCotizacionDolar] = useState("");
  const [guardandoCotizacion, setGuardandoCotizacion] = useState(false);
  // FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): guarda el
  // valor tal cual vino del backend (no el que se está tipeando en el
  // input) para poder mostrar "de X a Y" en el mensaje del modal de
  // confirmación -- ver mensaje de ModalConfirmarPassword más abajo.
  const [cotizacionDolarActual, setCotizacionDolarActual] = useState("");
  // FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): antes
  // "Guardar" mandaba el PATCH directo, sin ningún "sudo" de contraseña --
  // ahora abre este modal (mostrarConfirmarCotizacion) con el valor nuevo
  // ya validado guardado en cotizacionPendiente, y recién en
  // confirmarCotizacion (más abajo) se manda el PATCH de verdad, con la
  // contraseña incluida. Mismo patrón que payloadPendiente en
  // admin/Productos.jsx.
  const [mostrarConfirmarCotizacion, setMostrarConfirmarCotizacion] = useState(false);
  const [cotizacionPendiente, setCotizacionPendiente] = useState(null);

  useEffect(() => {
    if (!esAdmin) return;
    obtenerConfiguracionTienda()
      .then((respuesta) => {
        setHorarios(respuesta.data.horarios_atencion || "");
        setCotizacionDolar(String(respuesta.data.cotizacion_dolar));
        setCotizacionDolarActual(String(respuesta.data.cotizacion_dolar));
      })
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }, [esAdmin]);

  async function manejarGuardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    try {
      await actualizarConfiguracionTienda({ horarios_atencion: horarios });
      notificarExito("Horarios actualizados.");
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): antes esto
  // mandaba el PATCH directo con un solo clic -- cambiar cotizacion_dolar
  // reprecia TODO el catálogo cargado en USD al instante, un radio de
  // impacto mayor que dar de baja un solo producto (que sí exige la
  // contraseña del admin, ver ModalConfirmarPassword en
  // admin/Productos.jsx). Ahora solo guarda el valor tipeado como
  // "pendiente" y abre ese mismo modal -- el PATCH real recién se manda en
  // confirmarCotizacion, una vez confirmada la contraseña.
  function manejarGuardarCotizacion(evento) {
    evento.preventDefault();
    setCotizacionPendiente(Number(cotizacionDolar));
    setMostrarConfirmarCotizacion(true);
  }

  // Se llama desde ModalConfirmarPassword una vez que el admin tipeó su
  // contraseña -- si el backend la rechaza (contraseña incorrecta, la
  // cotización pendiente ya no es válida, u otro error), esto tira y el
  // modal se queda abierto mostrando el motivo (ver ModalConfirmarPassword.jsx),
  // sin tocar el formulario de atrás.
  async function confirmarCotizacion(password) {
    setGuardandoCotizacion(true);
    try {
      await actualizarConfiguracionTienda({ cotizacion_dolar: cotizacionPendiente }, password);
      setMostrarConfirmarCotizacion(false);
      setCotizacionDolarActual(String(cotizacionPendiente));
      setCotizacionPendiente(null);
      notificarExito("Guardado. Los precios en dólares del catálogo ya reflejan la cotización nueva.");
    } finally {
      setGuardandoCotizacion(false);
    }
  }

  if (!esAdmin) {
    return <Alert variant="secondary">Todavía no hay opciones acá. Próximamente.</Alert>;
  }

  return (
    <div className="d-flex flex-column gap-4">
      <Card className="superficie shadow-sm" style={{ maxWidth: 520 }}>
        <Card.Body>
          <Card.Title className="h5 mb-1">Horarios de atención</Card.Title>
          <Card.Subtitle className="text-muted mb-3">
            Se muestran tal cual en la página de Contacto.
          </Card.Subtitle>

          {error && <Alert variant="danger">{error}</Alert>}

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

      {/* FEATURE (09/09/2026, pedido del cliente): "precio dólar" -- la
          cotización que convierte el precio de un producto cargado en USD
          (Productos.jsx) al precio en pesos que ve el cliente. Solo afecta
          a los productos cargados en USD -- los cargados en ARS quedan
          fijos, sin importar este valor (ver el comentario grande en
          Producto.precio_venta, app/models/product.py). Global para toda
          la tienda, no por producto -- cambiarla acá actualiza el precio
          de TODO el catálogo en dólares al instante, sin tener que editar
          producto por producto.

          El IVA que también entra en esa cuenta NO va acá -- ver
          Productos.jsx, campo IVA (%) del formulario de cada producto: el
          dueño aclaró que varía de un producto a otro (21% general, 10,5%
          reducido en algunos casos), así que no tiene sentido como un
          único valor global de la tienda. */}
      <Card className="superficie shadow-sm" style={{ maxWidth: 520 }}>
        <Card.Body>
          <Card.Title className="h5 mb-1">Cotización del dólar</Card.Title>
          <Card.Subtitle className="text-muted mb-3">
            Convierte el precio en USD (sin IVA) de cada producto al precio final en pesos que ve el
            cliente. Se aplica a todo el catálogo cargado en dólares apenas se guarda. No afecta a los
            productos cargados en pesos.
          </Card.Subtitle>

          {cargando ? (
            <Spinner animation="border" size="sm" />
          ) : (
            <Form onSubmit={manejarGuardarCotizacion}>
              <Form.Group className="mb-3" controlId="cotizacion-dolar" style={{ maxWidth: 220 }}>
                <Form.Label>Pesos por dólar</Form.Label>
                <Form.Control
                  type="number"
                  step="0.01"
                  min="0"
                  value={cotizacionDolar}
                  onChange={(evento) => setCotizacionDolar(evento.target.value)}
                  // FIX (09/09/2026, pedido del cliente): mismo problema y misma
                  // solución que en el precio de producto de Productos.jsx --
                  // un <input type="number"> le suma/resta al valor con el
                  // scroll del mouse apenas tiene el foco, y acá cambiaría la
                  // cotización (que afecta a TODO el catálogo) sin que el
                  // dueño se dé cuenta. onWheel le quita el foco al input
                  // apenas detecta un scroll, para que se comporte como
                  // cualquier otro campo.
                  onWheel={(evento) => evento.currentTarget.blur()}
                  required
                />
              </Form.Group>
              <Button type="submit" variant="primary" disabled={guardandoCotizacion}>
                {guardandoCotizacion ? "Guardando..." : "Guardar"}
              </Button>
            </Form>
          )}
        </Card.Body>
      </Card>

      {/* FIX (13/09/2026, auditoría QA/Seguridad Punto Crítico #4): "sudo"
          de contraseña antes de aplicar el cambio de cotización -- ver
          manejarGuardarCotizacion/confirmarCotizacion más arriba. Muestra
          "de X a Y" para que quede clarísimo qué se está por repreciar
          antes de confirmar (cotizacionDolarActual es el valor que sigue
          vigente, cotizacionPendiente el que se tipeó y todavía no se
          guardó). */}
      <ModalConfirmarPassword
        show={mostrarConfirmarCotizacion}
        titulo="Confirmar cambio de cotización"
        mensaje={
          cotizacionPendiente !== null
            ? `Vas a cambiar la cotización de $${cotizacionDolarActual} a $${cotizacionPendiente} por dólar. ` +
              "Esto actualiza al instante el precio de TODO el catálogo cargado en dólares. Confirmá tu " +
              "contraseña para continuar."
            : ""
        }
        textoConfirmar="Guardar cotización"
        onConfirmar={confirmarCotizacion}
        onCancelar={() => {
          setMostrarConfirmarCotizacion(false);
          setCotizacionPendiente(null);
        }}
      />

      {/* FEATURE (29/08/2026, pedido del cliente): "Marcas destacadas" --
          10 posiciones fijas, se muestran en el Home en dos filas de 5
          (ver FilaMarcasDestacadas.jsx). Card aparte porque es una unidad
          de guardado independiente de los horarios (cada posición se
          sube/borra sola, no hay un botón "Guardar" en común). */}
      <Card className="superficie shadow-sm" style={{ maxWidth: 640 }}>
        <Card.Body>
          <Card.Title className="h5 mb-1">Marcas destacadas</Card.Title>
          <Card.Subtitle className="text-muted mb-3">
            Se muestran en el Home, en dos filas de 5. Hacé clic en un espacio vacío para cargar una imagen.
          </Card.Subtitle>
          <GrillaMarcasDestacadas />
        </Card.Body>
      </Card>
    </div>
  );
}
