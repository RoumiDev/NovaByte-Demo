import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";
import { extraerMensajeError } from "../../api/client";
import {
  actualizarUsuarioAdmin,
  listarUsuarios,
  marcarEmailVerificadoAdmin,
  restablecerPasswordAdmin,
} from "../../api/users";
import { useAuth } from "../../context/AuthContext";
// FIX UX-A2 (auditoría UX/UI 12/09/2026, Punto Crítico #2 "Alto"): mismo
// modal que ya usan Productos.jsx/Categorias.jsx para pedir la contraseña
// del propio admin antes de confirmar un cambio sensible -- ver
// manejarCambiarRol/manejarCambiarActivo más abajo. Antes esta pantalla era
// la única acción "sensible" del panel admin que se ejecutaba con un solo
// clic sin ningún tipo de confirmación (ni siquiera un window.confirm), a
// pesar de que escalar un usuario a Admin o desactivar una cuenta tiene más
// impacto que dar de baja un producto -- que sí la pedía.
import ModalConfirmarPassword from "../../components/ModalConfirmarPassword";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver TAMANO_PAGINA/cargar más abajo.
import ControlesPaginacion from "../../components/ControlesPaginacion";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): resultado de
// una acción puntual (cambiar rol/activar-desactivar) ahora se avisa con
// un toast en vez de reusar el <Alert> de "no pude cargar la lista" --
// ver utils/notificaciones.js.
import { notificarError, notificarExito } from "../../utils/notificaciones";
// FEATURE (27/08/2026, pedido del cliente): mismas listas que usan
// Register.jsx y ConfiguracionPrivacidad.jsx -- ver esos archivos, son la
// única fuente de verdad para provincia/ciudad.
import { PROVINCIAS } from "../../utils/provincias";
import { CIUDADES_POR_PROVINCIA } from "../../utils/ciudadesPorProvincia";

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esta pantalla
// pedía listarUsuarios({ limit: 100 }) una sola vez y filtraba la búsqueda
// en memoria (ver el comentario viejo que quedó en busquedaNormalizada más
// abajo) -- pasado los 100 usuarios, ni la tabla ni la búsqueda por
// nombre/email veían a los que quedaban afuera de esa primera tanda, en
// silencio. TAMANO_PAGINA chico (20, mismo default que ya usa el backend,
// ver Limit en app/core/pagination.py) + paginación real + la búsqueda
// movida al backend (ver listarUsuarios en api/users.js).
const TAMANO_PAGINA = 20;

const _ROLES = [
  { valor: "cliente", etiqueta: "Cliente" },
  { valor: "ayudante", etiqueta: "Ayudante" },
  { valor: "admin", etiqueta: "Admin" },
];

// Mismas etiquetas que usa ConfiguracionPrivacidad.jsx para los mismos
// valores (tipo_documento/condicion_iva/role vienen del backend en
// minúscula o en el value crudo del enum -- esto es solo cosmético).
const _ETIQUETAS_TIPO_DOCUMENTO = { DNI: "DNI", CUIT: "CUIT", CUIL: "CUIL" };
const _ETIQUETAS_CONDICION_IVA = {
  "consumidor final": "Consumidor Final",
  "responsable inscripto": "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};
const _ETIQUETAS_ROL = { admin: "Administrador", ayudante: "Ayudante", cliente: "Cliente" };

// Mismas opciones que usa Register.jsx para armar los <select> de tipo de
// documento/condición IVA -- acá se repiten en vez de importarlas porque
// Register.jsx no las exporta (son constantes internas de ese archivo).
const _OPCIONES_TIPO_DOCUMENTO = [
  { value: "DNI", label: "DNI" },
  { value: "CUIT", label: "CUIT" },
  { value: "CUIL", label: "CUIL" },
];
const _OPCIONES_CONDICION_IVA = [
  { value: "consumidor final", label: "Consumidor Final" },
  { value: "responsable inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
];

// Misma relación 1 a 1 documento <-> IVA que Register.jsx/el backend (ver
// _validar_relacion_iva_documento en app/schemas/user.py): con DNI la
// única opción es "Consumidor Final"; con CUIT/CUIL, cualquier otra.
function _opcionesCondicionIvaPara(tipoDocumento) {
  if (tipoDocumento === "DNI") {
    return _OPCIONES_CONDICION_IVA.filter((opcion) => opcion.value === "consumidor final");
  }
  return _OPCIONES_CONDICION_IVA.filter((opcion) => opcion.value !== "consumidor final");
}

// Sentinel del <select> de Ciudad para "no está en la lista" -- mismo
// criterio que Register.jsx/ConfiguracionPrivacidad.jsx.
const OTRA_CIUDAD = "__otra__";

// Gestión de usuarios y roles -- solo admin (ver RutaAdmin en App.jsx).
// Reutiliza los endpoints administrativos que ya existían en el backend
// (GET /users/, PATCH /users/{id} con UsuarioAdminUpdate) desde antes de
// que hubiera una pantalla para ellos.
export default function Usuarios() {
  const { usuario: usuarioActual } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Id del usuario cuya fila está en medio de un PATCH -- deshabilita esa
  // fila puntual para no disparar dos cambios superpuestos con doble clic.
  const [guardandoId, setGuardandoId] = useState(null);
  // Id del usuario que se está mostrando en el modal de "Ver datos" (null =
  // cerrado) -- se guarda el id, no el objeto, para que si cambia el rol o
  // el estado mientras el modal está abierto se vea reflejado sin más
  // (el modal busca el usuario actualizado en "usuarios" más abajo). No
  // hace falta pedir nada aparte al backend para esto: la fila ya tiene el
  // UsuarioRead completo -- que nunca incluye password_hash, ver
  // UsuarioRead en app/schemas/user.py -- así que no hay ningún dato
  // sensible que ocultar a mano acá, el backend ya no lo manda.
  const [idUsuarioVer, setIdUsuarioVer] = useState(null);
  const usuarioVer = usuarios.find((u) => u.id === idUsuarioVer) || null;

  // FEATURE (11/09/2026, pedido del cliente): id del usuario cuyo mail se
  // está marcando como verificado a mano (ver manejarMarcarVerificado y el
  // botón dentro del modal "Ver datos" más abajo) -- mismo patrón que
  // guardandoId, deshabilita puntualmente ese botón mientras está en
  // vuelo. Esto es prolijidad administrativa, no un desbloqueo: el login
  // nunca exigió el mail verificado (ver marcarEmailVerificadoAdmin en
  // api/users.js).
  const [marcandoVerificadoId, setMarcandoVerificadoId] = useState(null);

  // FEATURE (27/08/2026, pedido del cliente): "agrega un botón para poder
  // editar los campos de los usuario" -- antes "Ver datos" era de solo
  // lectura y lo único editable desde esta pantalla era el rol y
  // activar/desactivar (cada uno con su propio control en la tabla). Este
  // modal nuevo, separado del de "Ver datos", cubre el resto del perfil:
  // razón social, documento, condición IVA, teléfono, dirección, ciudad,
  // provincia y código postal -- ver UsuarioAdminUpdate en
  // app/schemas/user.py. A propósito NO incluye email (tiene su propio
  // flujo de verificación por código, ver TarjetaEmail en
  // ConfiguracionPrivacidad.jsx) ni contraseña -- la contraseña tiene su
  // PROPIO modal aparte (ver RestablecerPasswordModal más abajo), separado
  // a propósito de este para que quede claro que es una acción distinta y
  // más sensible. Mismo criterio que idUsuarioVer: se guarda el id, no el
  // objeto.
  const [idUsuarioEditar, setIdUsuarioEditar] = useState(null);
  const usuarioEditar = usuarios.find((u) => u.id === idUsuarioEditar) || null;

  // FEATURE (11/09/2026, pedido del cliente -- URGENTE): hay clientes en
  // producción con la casilla de mail llena, así que no les entran los
  // mails de verificación ni de recuperación de contraseña y quedan
  // bloqueados sin forma de recuperar el acceso por su cuenta. Esto es la
  // vía de emergencia: un admin le fija una contraseña nueva a mano
  // (después de confirmar la identidad del cliente por teléfono/WhatsApp,
  // por ejemplo) y se la comunica. Ver RestablecerPasswordModal más abajo y
  // admin_reset_password en app/router/users.py -- a propósito reversa una
  // restricción de diseño anterior (ver el comentario viejo que quedó en
  // UsuarioAdminUpdate en app/schemas/user.py), con las mismas
  // salvaguardas que se usan en el resto del proyecto para acciones de
  // admin sensibles: pide la contraseña del PROPIO admin para confirmar,
  // tiene rate limiting, cierra las sesiones activas de la cuenta afectada
  // y queda registrado en el log del backend.
  const [idUsuarioResetPassword, setIdUsuarioResetPassword] = useState(null);
  const usuarioResetPassword = usuarios.find((u) => u.id === idUsuarioResetPassword) || null;

  // FIX UX-A2: acción sensible (cambio de rol o activar/desactivar) que
  // está esperando que el admin confirme con su propia contraseña -- null
  // cuando no hay ninguna en curso. Se guarda el objeto completo (no solo
  // el id) porque hace falta tanto para armar el mensaje del modal como
  // para el PATCH final. { tipo: "rol", usuario, nuevoRol } o
  // { tipo: "activo", usuario, nuevoActivo }.
  const [accionPendiente, setAccionPendiente] = useState(null);

  // FEATURE (27/08/2026, pedido del cliente): buscador por nombre/razón
  // social o email.
  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): ya NO filtra en
  // memoria -- ver TAMANO_PAGINA más arriba. "busqueda" es lo que el admin
  // está tipeando; "busquedaAplicada" es lo que de verdad se manda al
  // backend, con un debounce de 300ms (ver el useEffect de acá abajo) para
  // no disparar un pedido por cada tecla.
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);
  const [haySiguiente, setHaySiguiente] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim());
      // Una búsqueda nueva no tiene por qué tener tantos resultados como
      // para seguir en la página en la que se estaba -- si no se reinicia
      // acá, se podría quedar mirando una página 3 vacía de resultados que
      // sí existen, solo que en la página 1.
      setPagina(0);
    }, 300);
    return () => clearTimeout(id);
  }, [busqueda]);

  // Pide un elemento de más (TAMANO_PAGINA + 1) para saber si hay página
  // siguiente sin depender de un total que el backend no devuelve -- ver
  // el comentario grande junto a ControlesPaginacion.jsx.
  // FIX (13/09/2026, auditoría QA/Seguridad -- condición de carrera): con
  // debounce + paginación, dos pedidos pueden quedar en vuelo al mismo
  // tiempo (ej. tipear rápido, o pisar "Anterior" antes de que responda el
  // pedido de la página anterior) -- sin este chequeo, el que responde
  // último "gana" sin importar si es el más reciente, y podría pisar la
  // pantalla con datos de una búsqueda o página vieja. idPedidoRef cuenta
  // cada llamada a cargar(); si al responder ya no es la más nueva, se
  // descarta en silencio (la respuesta correcta, más reciente, ya viene en
  // camino o ya llegó).
  const idPedidoRef = useRef(0);

  function cargar() {
    const idPedido = ++idPedidoRef.current;
    setCargando(true);
    setError("");
    listarUsuarios({
      skip: pagina * TAMANO_PAGINA,
      limit: TAMANO_PAGINA + 1,
      busqueda: busquedaAplicada || undefined,
    })
      .then((respuesta) => {
        if (idPedido !== idPedidoRef.current) return;
        setHaySiguiente(respuesta.data.length > TAMANO_PAGINA);
        setUsuarios(respuesta.data.slice(0, TAMANO_PAGINA));
      })
      .catch((err) => {
        if (idPedido !== idPedidoRef.current) return;
        setError(extraerMensajeError(err));
      })
      .finally(() => {
        if (idPedido === idPedidoRef.current) setCargando(false);
      });
  }

  useEffect(cargar, [pagina, busquedaAplicada]);

  // FIX UX-A2: ya no aplican el cambio directo -- solo abren el modal de
  // confirmación (ver accionPendiente/confirmarAccionPendiente más abajo).
  // Como el <Form.Select> de rol sigue controlado por usuario.role (que
  // todavía no cambió), en el próximo render vuelve a mostrar el valor
  // original solo hasta que se confirme -- mismo criterio que cualquier
  // <select> con confirmación aparte.
  function manejarCambiarRol(usuario, nuevoRol) {
    if (nuevoRol === usuario.role) {
      return;
    }
    setAccionPendiente({ tipo: "rol", usuario, nuevoRol });
  }

  function manejarCambiarActivo(usuario) {
    setAccionPendiente({ tipo: "activo", usuario, nuevoActivo: !usuario.is_active });
  }

  // Confirma la acción pendiente (cambio de rol o activar/desactivar) con
  // la contraseña que el admin cargó en ModalConfirmarPassword.
  // password_actual va en el mismo PATCH -- el backend lo exige cuando
  // "cambios" incluye role y/o is_active (ver el comentario de
  // actualizarUsuarioAdmin en api/users.js). Si la llamada tira (contraseña
  // incorrecta, por ejemplo), NO se atrapa acá a propósito: el error tiene
  // que llegar hasta ModalConfirmarPassword, que lo muestra y deja el modal
  // abierto para reintentar (ver su propio manejarEnvio) -- por eso
  // accionPendiente solo se limpia en el camino de éxito.
  async function confirmarAccionPendiente(password) {
    const accion = accionPendiente;
    setGuardandoId(accion.usuario.id);
    try {
      const cambios =
        accion.tipo === "rol"
          ? { role: accion.nuevoRol, password_actual: password }
          : { is_active: accion.nuevoActivo, password_actual: password };
      const respuesta = await actualizarUsuarioAdmin(accion.usuario.id, cambios);
      setUsuarios((actuales) => actuales.map((u) => (u.id === accion.usuario.id ? respuesta.data : u)));
      // FIX UX-03: antes esto quedaba en silencio total -- ni éxito ni
      // error tenían feedback visible más que la fila actualizándose sola.
      if (accion.tipo === "rol") {
        notificarExito(`Rol de ${accion.usuario.razon_social} actualizado a ${_ETIQUETAS_ROL[accion.nuevoRol] ?? accion.nuevoRol}.`);
      } else {
        notificarExito(`${accion.usuario.razon_social} ${respuesta.data.is_active ? "activado" : "desactivado"}.`);
      }
      setAccionPendiente(null);
    } finally {
      setGuardandoId(null);
    }
  }

  // FEATURE (11/09/2026, pedido del cliente): ver el botón "Marcar como
  // verificado" dentro del modal "Ver datos" más abajo -- mismo patrón que
  // manejarCambiarRol/manejarCambiarActivo (mezcla el usuario que vuelve
  // del backend en la lista, no hace falta recargar todo).
  async function manejarMarcarVerificado(usuario) {
    setMarcandoVerificadoId(usuario.id);
    try {
      const respuesta = await marcarEmailVerificadoAdmin(usuario.id);
      setUsuarios((actuales) => actuales.map((u) => (u.id === usuario.id ? respuesta.data : u)));
      notificarExito(`Mail de ${usuario.razon_social} marcado como verificado.`);
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setMarcandoVerificadoId(null);
    }
  }

  // Se llama cuando el modal de edición guarda con éxito -- mezcla el
  // usuario actualizado en la lista (mismo patrón que manejarCambiarRol/
  // manejarCambiarActivo) y cierra el modal.
  function manejarUsuarioEditado(usuarioActualizado) {
    setUsuarios((actuales) => actuales.map((u) => (u.id === usuarioActualizado.id ? usuarioActualizado : u)));
    notificarExito(`Datos de ${usuarioActualizado.razon_social} actualizados.`);
    setIdUsuarioEditar(null);
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Usuarios</h1>
        <Button variant="outline-secondary" size="sm" onClick={cargar}>
          Actualizar
        </Button>
      </div>

      {/* FEATURE (27/08/2026, pedido del cliente): buscador por nombre o
          email -- FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): ya se
          resuelve en el backend, ver busquedaAplicada más arriba. */}
      <Form.Group className="mb-3" controlId="usuarios-buscar" style={{ maxWidth: 360 }}>
        <Form.Control
          type="search"
          placeholder="Buscar por nombre o email..."
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
      </Form.Group>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : usuarios.length === 0 ? (
        <Alert variant="secondary" className="mb-0">
          {busquedaAplicada ? "Ningún usuario coincide con esa búsqueda." : "Todavía no hay usuarios registrados."}
        </Alert>
      ) : (
        <Table striped bordered hover responsive align="middle">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((usuario) => {
              const esUnoMismo = usuario.id === usuarioActual?.id;
              const guardandoEstaFila = guardandoId === usuario.id;
              return (
                <tr key={usuario.id}>
                  <td>
                    <div className="fw-semibold">
                      {usuario.razon_social} {esUnoMismo && <Badge bg="secondary">vos</Badge>}
                    </div>
                    <div className="text-muted small">{usuario.email}</div>
                  </td>
                  <td style={{ width: 180 }}>
                    <Form.Select
                      size="sm"
                      value={usuario.role}
                      disabled={esUnoMismo || guardandoEstaFila}
                      title={esUnoMismo ? "No podés cambiar tu propio rol." : undefined}
                      onChange={(evento) => manejarCambiarRol(usuario, evento.target.value)}
                    >
                      {_ROLES.map((rol) => (
                        <option key={rol.valor} value={rol.valor}>
                          {rol.etiqueta}
                        </option>
                      ))}
                    </Form.Select>
                  </td>
                  <td>
                    <Badge bg={usuario.is_active ? "success" : "secondary"}>
                      {usuario.is_active ? "Activo" : "Desactivado"}
                    </Badge>
                  </td>
                  <td>
                    <div className="d-flex gap-2">
                      <Button size="sm" variant="outline-secondary" onClick={() => setIdUsuarioVer(usuario.id)}>
                        Ver datos
                      </Button>
                      {/* FEATURE (27/08/2026, pedido del cliente): botón nuevo,
                          abre el modal de edición de perfil (ver más abajo). */}
                      <Button size="sm" variant="outline-primary" onClick={() => setIdUsuarioEditar(usuario.id)}>
                        Editar
                      </Button>
                      {/* FEATURE (11/09/2026, pedido del cliente -- URGENTE):
                          botón nuevo, abre RestablecerPasswordModal (ver más
                          abajo) -- vía de emergencia para clientes con la
                          casilla de mail llena que no pueden recuperar el
                          acceso por su cuenta. A propósito separado del
                          botón "Editar" de acá arriba, para que un admin no
                          lo confunda con una edición de perfil más. */}
                      <Button
                        size="sm"
                        variant="outline-warning"
                        onClick={() => setIdUsuarioResetPassword(usuario.id)}
                      >
                        Restablecer contraseña
                      </Button>
                      <Button
                        size="sm"
                        variant={usuario.is_active ? "outline-danger" : "outline-success"}
                        disabled={esUnoMismo || guardandoEstaFila}
                        title={esUnoMismo ? "No podés desactivar tu propia cuenta." : undefined}
                        onClick={() => manejarCambiarActivo(usuario)}
                      >
                        {usuario.is_active ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {!cargando && usuarios.length > 0 && (
        <ControlesPaginacion
          pagina={pagina}
          haySiguiente={haySiguiente}
          cargando={cargando}
          onAnterior={() => setPagina((p) => Math.max(0, p - 1))}
          onSiguiente={() => setPagina((p) => p + 1)}
        />
      )}

      <Modal show={usuarioVer !== null} onHide={() => setIdUsuarioVer(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h5">Datos de {usuarioVer?.razon_social}</Modal.Title>
        </Modal.Header>
        {usuarioVer && (
          <Modal.Body>
            <Row className="row-gap-3">
              <Col xs={12}>
                <div className="text-muted small">Email</div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {usuarioVer.email}
                  {usuarioVer.email_verificado ? (
                    <Badge bg="success">Verificado</Badge>
                  ) : (
                    <>
                      <Badge bg="warning" text="dark">
                        Sin verificar
                      </Badge>
                      {/* FEATURE (11/09/2026, pedido del cliente): botón para
                          casos como casilla de mail llena, donde el código de
                          verificación nunca le llegó al cliente y no tiene
                          sentido que quede con este badge para siempre -- ver
                          manejarMarcarVerificado más arriba y
                          admin_mark_email_verified en app/router/users.py.
                          Esto NO desbloquea nada (el cliente ya podía
                          loguearse igual sin esto): es solo para dejar la
                          cuenta prolija después de confirmar su identidad por
                          otro medio. */}
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={marcandoVerificadoId === usuarioVer.id}
                        onClick={() => manejarMarcarVerificado(usuarioVer)}
                      >
                        {marcandoVerificadoId === usuarioVer.id ? "Marcando..." : "Marcar como verificado"}
                      </Button>
                    </>
                  )}
                </div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Documento</div>
                <div>
                  {_ETIQUETAS_TIPO_DOCUMENTO[usuarioVer.tipo_documento] ?? usuarioVer.tipo_documento}{" "}
                  {usuarioVer.numero_documento}
                </div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Condición frente al IVA</div>
                <div>{_ETIQUETAS_CONDICION_IVA[usuarioVer.condicion_iva] ?? usuarioVer.condicion_iva}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Teléfono</div>
                <div>{usuarioVer.telefono}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Dirección</div>
                <div>{usuarioVer.direccion || "--"}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Ciudad</div>
                <div>{usuarioVer.ciudad || "--"}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Provincia</div>
                <div>{usuarioVer.provincia || "--"}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Código postal</div>
                <div>{usuarioVer.codigo_postal || "--"}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Rol</div>
                <div>{_ETIQUETAS_ROL[usuarioVer.role] ?? usuarioVer.role}</div>
              </Col>
              <Col xs={12} sm={6}>
                <div className="text-muted small">Estado</div>
                <div>
                  <Badge bg={usuarioVer.is_active ? "success" : "secondary"}>
                    {usuarioVer.is_active ? "Activo" : "Desactivado"}
                  </Badge>
                </div>
              </Col>
              <Col xs={12}>
                <div className="text-muted small">Cuenta creada</div>
                <div>
                  {new Date(usuarioVer.created_at).toLocaleDateString("es-AR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
              </Col>
            </Row>
            {/* La contraseña NUNCA aparece acá -- ni hasheada: el backend no
                la incluye en UsuarioRead (ver app/schemas/user.py), así que
                del lado del frontend no hay nada que ocultar a mano, no hay
                forma de mostrarla aunque quisiéramos. */}
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIdUsuarioVer(null)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      {/* FEATURE (27/08/2026, pedido del cliente): modal de edición, aparte
          del de "Ver datos" de arriba -- se remonta desde cero por
          key={usuarioEditar.id} cada vez que se abre para un usuario nuevo,
          así el estado interno del formulario (ver EditarUsuarioModal) no
          arrastra valores del usuario anterior. */}
      {usuarioEditar && (
        <EditarUsuarioModal
          key={usuarioEditar.id}
          usuario={usuarioEditar}
          onHide={() => setIdUsuarioEditar(null)}
          onGuardado={manejarUsuarioEditado}
        />
      )}

      {/* FEATURE (11/09/2026, pedido del cliente -- URGENTE): ver
          RestablecerPasswordModal más abajo. Mismo criterio de key que
          EditarUsuarioModal, para que el formulario arranque limpio si se
          abre para otro usuario. */}
      {usuarioResetPassword && (
        <RestablecerPasswordModal
          key={usuarioResetPassword.id}
          usuario={usuarioResetPassword}
          onHide={() => setIdUsuarioResetPassword(null)}
          onRestablecida={() => {
            notificarExito(`Contraseña de ${usuarioResetPassword.razon_social} restablecida. Sus sesiones activas se cerraron.`);
            setIdUsuarioResetPassword(null);
          }}
        />
      )}

      {/* FIX UX-A2: confirmación con la contraseña del propio admin antes
          de cambiar un rol o activar/desactivar una cuenta -- mismo
          componente que ya usan Productos.jsx/Categorias.jsx para sus
          acciones sensibles. */}
      {accionPendiente && (
        <ModalConfirmarPassword
          show
          titulo={
            accionPendiente.tipo === "rol"
              ? "Confirmar cambio de rol"
              : accionPendiente.nuevoActivo
                ? "Confirmar activación de cuenta"
                : "Confirmar desactivación de cuenta"
          }
          mensaje={
            accionPendiente.tipo === "rol"
              ? `¿Confirmás cambiar el rol de ${accionPendiente.usuario.razon_social} a "${
                  _ETIQUETAS_ROL[accionPendiente.nuevoRol] ?? accionPendiente.nuevoRol
                }"?`
              : accionPendiente.nuevoActivo
                ? `¿Confirmás activar la cuenta de ${accionPendiente.usuario.razon_social}?`
                : `¿Confirmás desactivar la cuenta de ${accionPendiente.usuario.razon_social}? No va a poder iniciar sesión hasta que la reactives.`
          }
          textoConfirmar={accionPendiente.tipo === "activo" && !accionPendiente.nuevoActivo ? "Desactivar" : "Confirmar"}
          variantConfirmar={accionPendiente.tipo === "activo" && !accionPendiente.nuevoActivo ? "danger" : "primary"}
          onConfirmar={confirmarAccionPendiente}
          onCancelar={() => setAccionPendiente(null)}
        />
      )}
    </div>
  );
}

// Formulario de edición completo del perfil de un usuario, para el admin.
// Junta el patrón de documento/CUIT-CUIL de Register.jsx con el patrón de
// provincia/ciudad en cascada de ConfiguracionPrivacidad.jsx -- ver esos
// archivos para el detalle de cada uno. A diferencia de
// ConfiguracionPrivacidad.jsx (donde razón social/documento/condición IVA
// son de solo lectura, ver UsuarioUpdate en app/schemas/user.py), acá el
// admin SÍ puede editarlos -- UsuarioAdminUpdate los incluye a propósito.
function EditarUsuarioModal({ usuario, onHide, onGuardado }) {
  const [razonSocial, setRazonSocial] = useState(usuario.razon_social || "");
  const [tipoDocumento, setTipoDocumento] = useState(usuario.tipo_documento || "DNI");
  const [condicionIva, setCondicionIva] = useState(usuario.condicion_iva || "consumidor final");

  // Mismo desdoblamiento que Register.jsx: DNI es un campo único; CUIT/CUIL
  // son tres campos separados con el formato real argentino (XX-XXXXXXXX-X).
  const esDni = tipoDocumento === "DNI";
  const partesIniciales = !esDni && usuario.numero_documento ? usuario.numero_documento.split("-") : ["", "", ""];
  const [dni, setDni] = useState(esDni ? usuario.numero_documento || "" : "");
  const [cuitPrefijo, setCuitPrefijo] = useState(partesIniciales[0] || "");
  const [cuitNumero, setCuitNumero] = useState(partesIniciales[1] || "");
  const [cuitVerificador, setCuitVerificador] = useState(partesIniciales[2] || "");
  const refCuitNumero = useRef(null);
  const refCuitVerificador = useRef(null);
  // numero_documento efectivo, según el tipo de documento actual -- esto es
  // lo que se manda al backend.
  const numeroDocumento = esDni ? dni : `${cuitPrefijo}-${cuitNumero}-${cuitVerificador}`;

  const [telefono, setTelefono] = useState(usuario.telefono || "");
  const [direccion, setDireccion] = useState(usuario.direccion || "");

  // Mismo criterio que ConfiguracionPrivacidad.jsx: si la ciudad ya
  // guardada no está en la lista curada de su provincia (cuenta vieja o
  // localidad no incluida), arranca en modo "Otra" con el valor real.
  const provinciaInicial = usuario.provincia || PROVINCIAS[0].value;
  const ciudadInicialEnLista =
    !!usuario.ciudad && CIUDADES_POR_PROVINCIA[provinciaInicial].includes(usuario.ciudad);
  const [provincia, setProvincia] = useState(provinciaInicial);
  const [ciudad, setCiudad] = useState(usuario.ciudad || CIUDADES_POR_PROVINCIA[provinciaInicial][0]);
  const [ciudadEsOtra, setCiudadEsOtra] = useState(!!usuario.ciudad && !ciudadInicialEnLista);
  const [codigoPostal, setCodigoPostal] = useState(usuario.codigo_postal || "");

  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  function manejarCambioTipoDocumento(event) {
    const nuevoTipo = event.target.value;
    setTipoDocumento(nuevoTipo);
    setDni("");
    setCuitPrefijo("");
    setCuitNumero("");
    setCuitVerificador("");
    // Misma relación 1 a 1 que Register.jsx: DNI fuerza "Consumidor Final";
    // si vuelve a CUIT/CUIL y tenía "Consumidor Final" elegido, esa opción
    // deja de estar disponible.
    setCondicionIva((prev) =>
      nuevoTipo === "DNI" ? "consumidor final" : prev === "consumidor final" ? "responsable inscripto" : prev
    );
  }

  function actualizarDni(event) {
    setDni(event.target.value.replace(/\D/g, "").slice(0, 8));
  }

  function actualizarCuitPrefijo(event) {
    const valor = event.target.value.replace(/\D/g, "").slice(0, 2);
    setCuitPrefijo(valor);
    if (valor.length === 2) {
      refCuitNumero.current?.focus();
    }
  }

  function actualizarCuitNumero(event) {
    const valor = event.target.value.replace(/\D/g, "").slice(0, 8);
    setCuitNumero(valor);
    if (valor.length === 8) {
      refCuitVerificador.current?.focus();
    }
  }

  function actualizarCuitVerificador(event) {
    setCuitVerificador(event.target.value.replace(/\D/g, "").slice(0, 1));
  }

  function manejarCambioProvincia(event) {
    const nuevaProvincia = event.target.value;
    setProvincia(nuevaProvincia);
    setCiudad(CIUDADES_POR_PROVINCIA[nuevaProvincia][0]);
    setCiudadEsOtra(false);
  }

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

  function volverAListaDeCiudades() {
    setCiudadEsOtra(false);
    setCiudad(CIUDADES_POR_PROVINCIA[provincia][0]);
  }

  function validarLocalmente() {
    // Espejo de las validaciones del backend -- ver
    // validar_formato_documento_valores/validar_relacion_iva_documento en
    // app/schemas/user.py -- mismo criterio que Register.jsx: feedback
    // inmediato, el backend siempre vuelve a validar todo.
    if (!razonSocial.trim()) {
      return "El nombre / razón social es obligatorio.";
    }
    const digitos = numeroDocumento.replace(/\D/g, "");
    if (esDni && (digitos.length < 7 || digitos.length > 8)) {
      return "El DNI debe tener 7 u 8 dígitos.";
    }
    if (!esDni && digitos.length !== 11) {
      return "El CUIT/CUIL debe tener 11 dígitos.";
    }
    if (!direccion.trim()) {
      return "La dirección es obligatoria.";
    }
    if (!ciudad.trim()) {
      return "La ciudad es obligatoria.";
    }
    if (!codigoPostal.trim()) {
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

    setGuardando(true);
    try {
      const respuesta = await actualizarUsuarioAdmin(usuario.id, {
        razon_social: razonSocial,
        tipo_documento: tipoDocumento,
        numero_documento: numeroDocumento,
        condicion_iva: condicionIva,
        telefono,
        direccion,
        ciudad,
        provincia,
        codigo_postal: codigoPostal,
      });
      onGuardado(respuesta.data);
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal show onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h5">Editar datos de {usuario.razon_social}</Modal.Title>
      </Modal.Header>
      <Form onSubmit={manejarEnvio} noValidate>
        <Modal.Body>
          {/* El email no se edita desde acá a propósito -- tiene su propio
              flujo de verificación por código (ver TarjetaEmail en
              ConfiguracionPrivacidad.jsx) que no tiene sentido saltarse
              solo porque quien edita es un admin. Tampoco hay ningún campo
              de contraseña -- eso tiene su propio botón/modal aparte
              ("Restablecer contraseña" en la tabla, ver
              RestablecerPasswordModal más abajo en este mismo archivo). */}
          <Alert variant="secondary" className="py-2 small mb-3">
            Email: <strong>{usuario.email}</strong> y contraseña no se editan desde acá.
          </Alert>

          <Form.Group className="mb-3" controlId="editar-razonSocial">
            <Form.Label>Nombre / Razón social</Form.Label>
            <Form.Control type="text" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} required />
          </Form.Group>

          <Row>
            <Col xs={5}>
              <Form.Group className="mb-3" controlId="editar-tipoDocumento">
                <Form.Label>Tipo de documento</Form.Label>
                <Form.Select value={tipoDocumento} onChange={manejarCambioTipoDocumento}>
                  {_OPCIONES_TIPO_DOCUMENTO.map((opcion) => (
                    <option key={opcion.value} value={opcion.value}>
                      {opcion.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={7}>
              <Form.Group className="mb-3" controlId="editar-numeroDocumento">
                <Form.Label>Número de documento</Form.Label>
                {esDni ? (
                  <Form.Control type="text" inputMode="numeric" placeholder="12345678" value={dni} onChange={actualizarDni} required />
                ) : (
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

          <Form.Group className="mb-3" controlId="editar-condicionIva">
            <Form.Label>Condición frente al IVA</Form.Label>
            <Form.Select value={condicionIva} onChange={(e) => setCondicionIva(e.target.value)} disabled={esDni}>
              {_opcionesCondicionIvaPara(tipoDocumento).map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3" controlId="editar-telefono">
            <Form.Label>Teléfono</Form.Label>
            <Form.Control type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} required />
          </Form.Group>

          <Form.Group className="mb-3" controlId="editar-direccion">
            <Form.Label>Dirección</Form.Label>
            <Form.Control type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} required />
          </Form.Group>

          <Form.Group className="mb-3" controlId="editar-provincia">
            <Form.Label>Provincia</Form.Label>
            <Form.Select value={provincia} onChange={manejarCambioProvincia} required>
              {PROVINCIAS.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Row>
            <Col xs={12} sm={7}>
              <Form.Group className="mb-3" controlId="editar-ciudad">
                <Form.Label>Ciudad</Form.Label>
                {ciudadEsOtra ? (
                  <>
                    <Form.Control type="text" value={ciudad} onChange={(e) => setCiudad(e.target.value)} required autoFocus />
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
              <Form.Group className="mb-3" controlId="editar-codigoPostal">
                <Form.Label>Código postal</Form.Label>
                <Form.Control type="text" value={codigoPostal} onChange={(e) => setCodigoPostal(e.target.value)} required />
              </Form.Group>
            </Col>
          </Row>

          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={guardando}>
            Cancelar
          </Button>
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
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// Caracteres para la contraseña que genera el botón "Generar" de acá abajo.
// A propósito sin caracteres que se confunden al dictarla por teléfono
// (0/O, 1/l/I) -- el admin suele leérsela al cliente en voz alta.
const _CARACTERES_PASSWORD_GENERADA = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

// Genera una contraseña al azar de 12 caracteres usando el generador
// criptográfico del navegador (no Math.random -- esto termina en manos de
// un cliente real, mejor no escatimar en la calidad del azar).
function _generarPasswordAlAzar() {
  const valores = new Uint32Array(12);
  window.crypto.getRandomValues(valores);
  let resultado = "";
  for (const valor of valores) {
    resultado += _CARACTERES_PASSWORD_GENERADA[valor % _CARACTERES_PASSWORD_GENERADA.length];
  }
  return resultado;
}

// FEATURE (11/09/2026, pedido del cliente -- URGENTE, clientes bloqueados):
// vía de emergencia para fijarle una contraseña nueva a mano a la cuenta de
// otro usuario, para cuando ese cliente tiene la casilla de mail llena y no
// le entran ni el código de verificación ni el de recuperación de
// contraseña (ver restablecerPasswordAdmin en api/users.js,
// admin_reset_password en app/router/users.py). A propósito es un
// componente aparte de EditarUsuarioModal: junta dos campos de contraseña
// (la nueva del cliente + la propia del admin para confirmar, mismo patrón
// de "sudo" que se usa en el resto del proyecto) en vez de mezclarlos con
// el resto del formulario de perfil.
function RestablecerPasswordModal({ usuario, onHide, onRestablecida }) {
  const [passwordNueva, setPasswordNueva] = useState("");
  const [mostrarPasswordNueva, setMostrarPasswordNueva] = useState(false);
  const [passwordAdmin, setPasswordAdmin] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  function manejarGenerar() {
    setPasswordNueva(_generarPasswordAlAzar());
    // La mostramos en texto plano de una: si el admin la generó es porque
    // la va a leer/copiar para pasarle al cliente, no para recordarla de
    // memoria -- no tiene sentido esconderla en ese caso.
    setMostrarPasswordNueva(true);
  }

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");

    // Espejo de _validar_password en app/schemas/user.py -- feedback
    // inmediato, el backend siempre vuelve a validar esto igual.
    if (passwordNueva.length < 8) {
      setError("La contraseña nueva debe tener al menos 8 caracteres.");
      return;
    }
    if (!passwordAdmin) {
      setError("Ingresá tu propia contraseña de admin para confirmar.");
      return;
    }

    setGuardando(true);
    try {
      await restablecerPasswordAdmin(usuario.id, {
        password_nueva: passwordNueva,
        password_actual: passwordAdmin,
      });
      onRestablecida();
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal show onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">Restablecer contraseña de {usuario.razon_social}</Modal.Title>
      </Modal.Header>
      <Form onSubmit={manejarEnvio} noValidate>
        <Modal.Body>
          <Alert variant="warning" className="py-2 small">
            Usá esto solo si <strong>ya confirmaste la identidad</strong> de {usuario.razon_social} (por
            teléfono, WhatsApp, etc.) -- por ejemplo, porque tiene la casilla de mail llena y no le
            entran los códigos de verificación ni de recuperación. Al confirmar, se cierran todas sus
            sesiones activas y va a tener que volver a iniciar sesión con la contraseña nueva.
          </Alert>

          <Form.Group className="mb-3" controlId="reset-passwordNueva">
            <Form.Label>Contraseña nueva para {usuario.email}</Form.Label>
            <div className="d-flex gap-2">
              <Form.Control
                type={mostrarPasswordNueva ? "text" : "password"}
                value={passwordNueva}
                onChange={(e) => setPasswordNueva(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                required
              />
              <Button variant="outline-secondary" type="button" onClick={() => setMostrarPasswordNueva((v) => !v)}>
                {mostrarPasswordNueva ? "Ocultar" : "Ver"}
              </Button>
            </div>
            <Form.Text>
              <Button variant="link" size="sm" className="p-0" onClick={manejarGenerar} type="button">
                Generar una contraseña al azar
              </Button>
              {" "}-- útil para dictársela al cliente por teléfono.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="reset-passwordAdmin">
            <Form.Label>Tu contraseña de admin (para confirmar)</Form.Label>
            <Form.Control
              type="password"
              value={passwordAdmin}
              onChange={(e) => setPasswordAdmin(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Form.Group>

          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" variant="warning" disabled={guardando}>
            {guardando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Restableciendo...
              </>
            ) : (
              "Restablecer contraseña"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
