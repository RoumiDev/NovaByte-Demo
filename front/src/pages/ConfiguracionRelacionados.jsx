import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, Spinner } from "react-bootstrap";
import { extraerMensajeError } from "../api/client";
import {
  desrelacionarProducto,
  listarProductos,
  listarProductosRelacionados,
  relacionarProducto,
} from "../api/products";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): "vincular"/
// "quitar relación" ahora avisan por toast en vez de un <Alert> local
// (`aviso`/`errorAccion`, sacados más abajo) -- ver utils/notificaciones.js.
import { notificarError, notificarExito } from "../utils/notificaciones";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver el useEffect de carga más abajo.
import { traerTodasLasPaginas } from "../utils/paginacion";

// Agrupa una lista de productos por categoría, ordenado alfabéticamente
// por categoría y, adentro de cada una, por nombre de producto -- así las
// dos listas de esta pantalla siempre se ven en el mismo orden previsible,
// sin depender del orden de "último ingreso" que usa el resto del catálogo
// (acá no importa qué es más nuevo, importa poder encontrar rápido un
// producto puntual).
function agruparPorCategoria(productos) {
  const grupos = new Map();
  for (const producto of productos) {
    const nombreCategoria = producto.categoria?.nombre ?? "Sin categoría";
    if (!grupos.has(nombreCategoria)) {
      grupos.set(nombreCategoria, []);
    }
    grupos.get(nombreCategoria).push(producto);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([categoria, productosDeCategoria]) => ({
      categoria,
      productos: [...productosDeCategoria].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }));
}

// Una de las dos listas (columnas) de la pantalla: todos los productos,
// separados por categoría, con un buscador liviano para acotar en
// catálogos grandes. onSeleccionar marca un solo producto a la vez como
// elegido en ESTA lista -- las dos listas son independientes entre sí.
function ListaProductos({ titulo, productos, filtro, onCambiarFiltro, seleccionId, onSeleccionar, idsRelacionados }) {
  const grupos = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    const filtrados = texto ? productos.filter((producto) => producto.nombre.toLowerCase().includes(texto)) : productos;
    return agruparPorCategoria(filtrados);
  }, [productos, filtro]);

  return (
    <div>
      <Form.Label className="fw-semibold">{titulo}</Form.Label>
      <Form.Control
        type="text"
        placeholder="Buscar por nombre..."
        value={filtro}
        onChange={(evento) => onCambiarFiltro(evento.target.value)}
        className="mb-2"
      />
      <div className="border rounded" style={{ maxHeight: 420, overflowY: "auto" }}>
        {grupos.length === 0 && <div className="text-muted small p-3">Sin resultados.</div>}
        {grupos.map(({ categoria, productos: productosDeCategoria }) => (
          <div key={categoria}>
            <div className="bg-body-secondary text-muted small fw-semibold px-3 py-1 text-uppercase">
              {categoria}
            </div>
            {productosDeCategoria.map((producto) => {
              const seleccionado = producto.id === seleccionId;
              // Si el producto seleccionado en la OTRA lista ya está
              // relacionado con este, se lo marca -- así se ve de un
              // vistazo qué ya está vinculado antes de tocar nada.
              const yaRelacionado = idsRelacionados?.has(producto.id) ?? false;
              return (
                <button
                  key={producto.id}
                  type="button"
                  className={`btn text-start w-100 px-3 py-2 rounded-0 d-flex justify-content-between align-items-center ${
                    seleccionado ? "btn-primary" : "btn-light"
                  }`}
                  onClick={() => onSeleccionar(producto)}
                >
                  <span>{producto.nombre}</span>
                  {yaRelacionado && !seleccionado && (
                    <Badge bg="secondary" className="ms-2">
                      Relacionado
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Sub-sección "Relac. Produc." de Configuración (solo-admin, ver
// ConfiguracionLayout.jsx/App.jsx): la forma "visual" de armar vínculos
// entre productos (ej. una impresora con su tóner) mirando el catálogo
// completo separado por categoría en vez de tener que escribir el nombre
// exacto -- ese buscador puntual sigue existiendo en el propio formulario
// de Productos.jsx, esta pantalla es un complemento, no un reemplazo.
//
// El vínculo es bidireccional (ver ProductoRelacionado en
// app/models/product.py): elegir un producto en cada lista y tocar
// "Vincular" alcanza para que aparezca en la ficha de los dos, sin
// importar cuál se eligió en la lista 1 o la 2.
export default function ConfiguracionRelacionados() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [filtroA, setFiltroA] = useState("");
  const [filtroB, setFiltroB] = useState("");
  const [seleccionAId, setSeleccionAId] = useState(null);
  const [seleccionBId, setSeleccionBId] = useState(null);

  // Relacionados del producto elegido en la lista 1 -- se usan tanto para
  // marcar "Relacionado" en la lista 2 como para el listado de abajo con
  // el botón de quitar.
  const [relacionadosDeA, setRelacionadosDeA] = useState([]);
  const [cargandoRelacionados, setCargandoRelacionados] = useState(false);

  const [guardando, setGuardando] = useState(false);

  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes acá se pedía
  // listarProductos({ limit: 100 }) una sola vez -- pasado los 100
  // productos, los que quedaban afuera de esa primera tanda no aparecían
  // en ninguna de las dos listas de este selector, sin ningún aviso, y
  // tampoco había forma de vincularlos. A diferencia de las tablas de
  // gestión (Usuarios/Productos/Categorías/Stock), acá no tiene sentido
  // una paginación con "Anterior"/"Siguiente": las dos columnas navegan el
  // catálogo agrupado por categoría y con un buscador instantáneo, algo
  // que necesita la lista COMPLETA en memoria para funcionar bien -- así
  // que se usa traerTodasLasPaginas (ver utils/paginacion.js), que
  // encadena pedidos de a 100 (el máximo que acepta el backend) hasta
  // traer todo el catálogo, en vez de quedarse en el primero.
  useEffect(() => {
    setCargando(true);
    setError("");
    traerTodasLasPaginas(listarProductos)
      .then((todos) => setProductos(todos))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }, []);

  function cargarRelacionadosDeA(productoId) {
    setCargandoRelacionados(true);
    listarProductosRelacionados(productoId)
      .then((respuesta) => setRelacionadosDeA(respuesta.data))
      .catch(() => setRelacionadosDeA([]))
      .finally(() => setCargandoRelacionados(false));
  }

  function manejarSeleccionarA(producto) {
    setSeleccionAId(producto.id);
    cargarRelacionadosDeA(producto.id);
  }

  function manejarSeleccionarB(producto) {
    setSeleccionBId(producto.id);
  }

  async function manejarVincular() {
    setGuardando(true);
    try {
      await relacionarProducto(seleccionAId, seleccionBId);
      notificarExito("Productos vinculados.");
      cargarRelacionadosDeA(seleccionAId);
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function manejarQuitarRelacion(otroId) {
    setGuardando(true);
    try {
      await desrelacionarProducto(seleccionAId, otroId);
      setRelacionadosDeA((prev) => prev.filter((relacionado) => relacionado.id !== otroId));
      notificarExito("Relación eliminada.");
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const nombreA = productos.find((producto) => producto.id === seleccionAId)?.nombre;
  const nombreB = productos.find((producto) => producto.id === seleccionBId)?.nombre;
  const idsRelacionadosDeA = useMemo(
    () => new Set(relacionadosDeA.map((relacionado) => relacionado.id)),
    [relacionadosDeA],
  );
  const puedeVincular =
    seleccionAId != null && seleccionBId != null && seleccionAId !== seleccionBId && !guardando;

  // Todo el contenido (carga, error, o la pantalla completa) va adentro del
  // mismo marco metálico -- así el panel siempre se ve igual, en vez de
  // que el spinner/error inicial aparezcan "sueltos" sin el diseño pedido
  // y recién se arme el marco un instante después al terminar de cargar.
  return (
    <div className="panel-relacionados">
      <div className="panel-relacionados__interior">
        {cargando ? (
          <Spinner animation="border" />
        ) : error ? (
          <Alert variant="danger" className="mb-0">
            {error}
          </Alert>
        ) : (
          <>
            <h2 className="h5 mb-1">Productos relacionados</h2>
            <p className="text-muted mb-4">
              Elegí un producto en cada lista y tocá "Vincular" -- va a aparecer en la sección "También vas a
              necesitar" de la ficha de los dos productos, sin importar en cuál lista elegiste cada uno.
            </p>

            <div className="row g-4">
              <div className="col-12 col-md-6">
                <ListaProductos
                  titulo="Producto 1"
                  productos={productos}
                  filtro={filtroA}
                  onCambiarFiltro={setFiltroA}
                  seleccionId={seleccionAId}
                  onSeleccionar={manejarSeleccionarA}
                />
              </div>
              <div className="col-12 col-md-6">
                <ListaProductos
                  titulo="Producto 2"
                  productos={productos}
                  filtro={filtroB}
                  onCambiarFiltro={setFiltroB}
                  seleccionId={seleccionBId}
                  onSeleccionar={manejarSeleccionarB}
                  idsRelacionados={idsRelacionadosDeA}
                />
              </div>
            </div>

            <div className="mt-3 d-flex align-items-center gap-3 flex-wrap">
              <div className="text-muted">
                {seleccionAId && seleccionBId ? (
                  seleccionAId === seleccionBId ? (
                    "Elegí dos productos distintos."
                  ) : (
                    <>
                      Vas a vincular <strong>{nombreA}</strong> con <strong>{nombreB}</strong>.
                    </>
                  )
                ) : (
                  "Elegí un producto en cada lista."
                )}
              </div>
              <Button variant="primary" disabled={!puedeVincular} onClick={manejarVincular}>
                {guardando ? "Vinculando..." : "Vincular"}
              </Button>
            </div>

            {seleccionAId && (
              <div className="mt-4">
                <div className="fw-semibold mb-2">Ya relacionados con {nombreA}:</div>
                {cargandoRelacionados ? (
                  <Spinner animation="border" size="sm" />
                ) : relacionadosDeA.length === 0 ? (
                  <div className="text-muted small">Todavía no tiene ninguno.</div>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {relacionadosDeA.map((relacionado) => (
                      <Badge
                        key={relacionado.id}
                        bg="secondary"
                        className="d-flex align-items-center gap-2 fs-6 fw-normal py-2"
                      >
                        {relacionado.nombre}
                        <span
                          role="button"
                          onClick={() => manejarQuitarRelacion(relacionado.id)}
                          title="Quitar relación"
                          style={{ cursor: guardando ? "default" : "pointer" }}
                        >
                          ×
                        </span>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
