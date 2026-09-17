import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Image, Modal, Spinner, Table } from "react-bootstrap";
import { extraerMensajeError } from "../../api/client";
import {
  actualizarCategoria,
  crearCategoria,
  eliminarCategoria,
  listarCategorias,
  subirImagenCategoria,
} from "../../api/categories";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): mismo criterio
// que Productos.jsx -- ver ese archivo y utils/notificaciones.js.
import { notificarExito } from "../../utils/notificaciones";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js.
import { resolverUrlImagen } from "../../utils/imagenes";
// FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): placeholder de "sin
// imagen" unificado con MiniaturaProducto.jsx (mismo tamaño de miniatura,
// 40x40) -- ver components/iconos.jsx.
import { IconoImagen } from "../../components/iconos";
// FEATURE (27/08/2026, pedido del cliente): "cuando se quiera confirmar un
// cambio o dar de baja... pida la contraseña del admin" -- modal
// compartido con Productos.jsx, ver ese archivo.
import ModalConfirmarPassword from "../../components/ModalConfirmarPassword";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver el comentario grande junto a
// TAMANO_PAGINA/cargarDatos más abajo.
import ControlesPaginacion from "../../components/ControlesPaginacion";

// Mismos límites que valida app/router/categories.py (subir_imagen_categoria)
// -- esto es solo para avisar antes de subir, el backend vuelve a
// verificarlo igual y es la última palabra.
const _MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const _TIPOS_IMAGEN_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esta pantalla
// pedía listarCategorias({ limit: 100 }) una sola vez y se quedaba ahí --
// la categoría 101 en adelante no existía para esta tabla, sin ningún
// aviso. TAMANO_PAGINA chico (20, mismo default que ya usa el backend, ver
// Limit en app/core/pagination.py) + paginación real de verdad, en vez de
// simplemente subir el número (que además el backend rechaza pasado 100).
const TAMANO_PAGINA = 20;

const FORM_VACIO = { nombre: "", imagen_url: "" };

export default function Categorias() {
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(0);
  const [haySiguiente, setHaySiguiente] = useState(false);

  const [mostrarModal, setMostrarModal] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errorModal, setErrorModal] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Imagen: se maneja aparte del resto del form porque no viaja como texto.
  // Mismo patrón que Productos.jsx -- ver los comentarios ahí para el
  // detalle de cada pieza (imagenArchivo/imagenPreviewUrl/imagenInputKey).
  const [imagenArchivo, setImagenArchivo] = useState(null);
  const [imagenPreviewUrl, setImagenPreviewUrl] = useState("");
  const [imagenInputKey, setImagenInputKey] = useState(0);

  // FEATURE (27/08/2026, pedido del cliente): mismo patrón que
  // Productos.jsx -- ver los comentarios ahí para el detalle de cada
  // estado (payloadPendiente/mostrarConfirmarEdicion y
  // categoriaConfirmarEliminar).
  const [mostrarConfirmarEdicion, setMostrarConfirmarEdicion] = useState(false);
  const [payloadPendiente, setPayloadPendiente] = useState(null);
  const [categoriaConfirmarEliminar, setCategoriaConfirmarEliminar] = useState(null);

  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): pide un elemento de
  // más (TAMANO_PAGINA + 1) para saber si hay página siguiente sin depender
  // de un total que el backend no devuelve (ver el comentario grande junto
  // a ControlesPaginacion.jsx) -- el elemento de más se descarta del
  // render con slice(0, TAMANO_PAGINA), nunca se muestra.
  // FIX (13/09/2026, auditoría QA/Seguridad -- condición de carrera): mismo
  // motivo que las demás pantallas con paginación de este fix -- descarta
  // cualquier respuesta que ya no sea la del último pedido hecho (ej. dos
  // clics rápidos en "Siguiente"/"Anterior").
  const idPedidoRef = useRef(0);

  async function cargarDatos() {
    const idPedido = ++idPedidoRef.current;
    setCargando(true);
    setError("");
    try {
      const respuesta = await listarCategorias({ skip: pagina * TAMANO_PAGINA, limit: TAMANO_PAGINA + 1 });
      if (idPedido !== idPedidoRef.current) return;
      setHaySiguiente(respuesta.data.length > TAMANO_PAGINA);
      setCategorias(respuesta.data.slice(0, TAMANO_PAGINA));
    } catch (err) {
      if (idPedido !== idPedidoRef.current) return;
      setError(extraerMensajeError(err));
    } finally {
      if (idPedido === idPedidoRef.current) setCargando(false);
    }
  }

  useEffect(() => {
    cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina]);

  // Si se eliminó la única categoría de la última página, esa página queda
  // vacía -- en vez de mostrar una tabla vacía con "Anterior" disponible,
  // se retrocede sola una página (que sí dispara el useEffect de acá
  // arriba y recarga). No aplica en la página 0: ahí una tabla vacía es un
  // estado legítimo ("no hay categorías todavía").
  useEffect(() => {
    if (!cargando && categorias.length === 0 && pagina > 0) {
      setPagina((p) => p - 1);
    }
  }, [cargando, categorias.length, pagina]);

  // Libera la URL de vista previa generada localmente (createObjectURL) al
  // reemplazarla o desmontar -- mismo motivo que en Productos.jsx.
  useEffect(() => {
    return () => {
      if (imagenPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagenPreviewUrl);
      }
    };
  }, [imagenPreviewUrl]);

  function abrirNueva() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setImagenArchivo(null);
    setImagenPreviewUrl("");
    setImagenInputKey((prev) => prev + 1);
    setErrorModal("");
    setMostrarModal(true);
  }

  function abrirEdicion(categoria) {
    setEditandoId(categoria.id);
    setForm({ nombre: categoria.nombre, imagen_url: categoria.imagen_url || "" });
    setImagenArchivo(null);
    setImagenPreviewUrl(categoria.imagen_url || "");
    setImagenInputKey((prev) => prev + 1);
    setErrorModal("");
    setMostrarModal(true);
  }

  // "Quitar foto": mismo criterio que en Productos.jsx -- limpia el archivo
  // elegido, la vista previa y form.imagen_url, así al guardar la
  // categoría queda sin imagen sin tener que elegir un archivo nuevo.
  function manejarQuitarImagen() {
    setImagenArchivo(null);
    setImagenPreviewUrl("");
    setForm((prev) => ({ ...prev, imagen_url: "" }));
    setImagenInputKey((prev) => prev + 1);
  }

  function actualizarCampo(campo) {
    return (event) => setForm((prev) => ({ ...prev, [campo]: event.target.value }));
  }

  function manejarSeleccionImagen(event) {
    const archivo = event.target.files?.[0];
    if (!archivo) {
      return;
    }

    if (!_TIPOS_IMAGEN_PERMITIDOS.includes(archivo.type)) {
      setErrorModal("La imagen tiene que ser JPG, PNG o WEBP.");
      event.target.value = "";
      return;
    }
    if (archivo.size > _MAX_IMAGEN_BYTES) {
      setErrorModal("La imagen no puede superar los 5MB.");
      event.target.value = "";
      return;
    }

    setErrorModal("");
    setImagenArchivo(archivo);
    setImagenPreviewUrl(URL.createObjectURL(archivo));
  }

  async function manejarGuardar(event) {
    event.preventDefault();
    setErrorModal("");

    setGuardando(true);
    try {
      // Si el admin eligió un archivo nuevo, primero se sube y se usa la
      // URL que devuelve el backend; si no tocó la imagen, se conserva la
      // que ya tenía la categoría (o null si es alta nueva sin imagen).
      let imagenUrl = form.imagen_url.trim() || null;
      if (imagenArchivo) {
        const respuestaImagen = await subirImagenCategoria(imagenArchivo);
        // FIX (07/09/2026): el backend devuelve una ruta relativa
        // ("/static/categorias/<archivo>", ver FIX B-03 más arriba), pero
        // el validador de imagen_url en el backend exige que empiece con
        // http:// o https:// -- sin este resolverUrlImagen(), guardar
        // fallaba siempre que se subía una imagen nueva ("Value error,
        // imagen_url debe empezar con http:// o https://").
        imagenUrl = resolverUrlImagen(respuestaImagen.data.url);
      }

      const payload = {
        nombre: form.nombre.trim(),
        imagen_url: imagenUrl,
      };

      if (editandoId) {
        // FEATURE (27/08/2026, pedido del cliente): editar es un "cambio"
        // que ahora pide confirmar con la contraseña del admin -- ver
        // ModalConfirmarPassword y confirmarEdicion más abajo. El alta de
        // una categoría nueva NO pasa por acá.
        setPayloadPendiente(payload);
        setMostrarConfirmarEdicion(true);
        return;
      }

      await crearCategoria(payload);
      setMostrarModal(false);
      await cargarDatos();
      // FIX UX-03: mismo motivo que Productos.jsx -- antes no había ninguna
      // confirmación visible de que el guardado salió bien.
      notificarExito("Categoría creada.");
    } catch (err) {
      setErrorModal(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Se llama desde ModalConfirmarPassword una vez confirmada la contraseña
  // -- mismo patrón que confirmarEdicion en Productos.jsx.
  async function confirmarEdicion(password) {
    await actualizarCategoria(editandoId, payloadPendiente, password);
    setMostrarConfirmarEdicion(false);
    setPayloadPendiente(null);
    setMostrarModal(false);
    await cargarDatos();
    notificarExito("Categoría actualizada.");
  }

  // FEATURE (27/08/2026, pedido del cliente): reemplaza el window.confirm()
  // que había antes -- mismo criterio que manejarBaja en Productos.jsx.
  function manejarEliminar(categoria) {
    setCategoriaConfirmarEliminar(categoria);
  }

  async function confirmarEliminar(password) {
    // Si tiene productos asociados, el backend responde 409 con un mensaje
    // específico -- ModalConfirmarPassword lo muestra inline tal cual (ver
    // extraerMensajeError ahí).
    await eliminarCategoria(categoriaConfirmarEliminar.id, password);
    const nombre = categoriaConfirmarEliminar.nombre;
    setCategoriaConfirmarEliminar(null);
    await cargarDatos();
    notificarExito(`Categoría "${nombre}" eliminada.`);
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Categorías</h1>
        <Button variant="primary" onClick={abrirNueva}>
          + Nueva categoría
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th></th>
              <th>Nombre</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categorias.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-muted py-4">
                  No hay categorías todavía.
                </td>
              </tr>
            )}
            {categorias.map((categoria) => (
              <tr key={categoria.id}>
                <td style={{ width: 56 }}>
                  {categoria.imagen_url ? (
                    <Image
                      src={resolverUrlImagen(categoria.imagen_url)}
                      alt=""
                      rounded
                      width={40}
                      height={40}
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    // FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): antes decía
                    // "s/f" -- ver el mismo cambio en ConfiguracionStock.jsx y
                    // Productos.jsx, y el comentario en components/iconos.jsx.
                    <div
                      className="superficie rounded d-flex align-items-center justify-content-center text-muted"
                      style={{ width: 40, height: 40 }}
                      title="Sin imagen"
                    >
                      <IconoImagen />
                    </div>
                  )}
                </td>
                <td>{categoria.nombre}</td>
                <td className="text-end">
                  <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => abrirEdicion(categoria)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => manejarEliminar(categoria)}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): controles de
          paginación -- solo tiene sentido mostrarlos una vez que terminó de
          cargar, para no parpadear "Página 1" antes de tener datos. */}
      {!cargando && (
        <ControlesPaginacion
          pagina={pagina}
          haySiguiente={haySiguiente}
          cargando={cargando}
          onAnterior={() => setPagina((p) => Math.max(0, p - 1))}
          onSiguiente={() => setPagina((p) => p + 1)}
        />
      )}

      <Modal show={mostrarModal} onHide={() => setMostrarModal(false)}>
        <Form onSubmit={manejarGuardar}>
          <Modal.Header closeButton>
            <Modal.Title>{editandoId ? "Editar categoría" : "Nueva categoría"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Nombre</Form.Label>
              <Form.Control value={form.nombre} onChange={actualizarCampo("nombre")} required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Imagen (opcional)</Form.Label>
              <Form.Control
                key={imagenInputKey}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={manejarSeleccionImagen}
              />
              <Form.Text className="text-muted">JPG, PNG o WEBP, hasta 5MB.</Form.Text>
              {imagenPreviewUrl && (
                <div className="mt-2 d-flex align-items-center gap-2">
                  <Image src={resolverUrlImagen(imagenPreviewUrl)} alt="Vista previa" thumbnail width={100} />
                  <Button variant="outline-danger" size="sm" onClick={manejarQuitarImagen}>
                    Quitar foto
                  </Button>
                </div>
              )}
            </Form.Group>
            {errorModal && <Alert variant="danger">{errorModal}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setMostrarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* FEATURE (27/08/2026, pedido del cliente): confirmación con la
          contraseña del admin antes de aplicar la edición -- ver
          confirmarEdicion más arriba. */}
      <ModalConfirmarPassword
        show={mostrarConfirmarEdicion}
        titulo="Confirmar cambios"
        mensaje="Para guardar los cambios, confirmá tu contraseña."
        textoConfirmar="Guardar cambios"
        onConfirmar={confirmarEdicion}
        onCancelar={() => setMostrarConfirmarEdicion(false)}
      />

      {/* FEATURE (27/08/2026, pedido del cliente): reemplaza el
          window.confirm() que había antes para "Eliminar" -- ver
          manejarEliminar/confirmarEliminar más arriba. */}
      <ModalConfirmarPassword
        show={categoriaConfirmarEliminar !== null}
        titulo="Confirmar eliminación"
        mensaje={
          categoriaConfirmarEliminar
            ? `¿Eliminar la categoría "${categoriaConfirmarEliminar.nombre}"? Confirmá tu contraseña para continuar.`
            : ""
        }
        textoConfirmar="Eliminar"
        variantConfirmar="danger"
        onConfirmar={confirmarEliminar}
        onCancelar={() => setCategoriaConfirmarEliminar(null)}
      />
    </div>
  );
}
