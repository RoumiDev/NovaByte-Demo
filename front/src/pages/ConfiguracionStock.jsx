import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Form, Image, Spinner, Table } from "react-bootstrap";
import { listarCategorias } from "../api/categories";
import { extraerMensajeError } from "../api/client";
import { actualizarProducto, listarProductos } from "../api/products";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): errores de
// guardar un stock puntual ahora van por toast en vez de reusar el
// <Alert> de "no pude cargar la lista" (`error`, más abajo sigue
// existiendo pero ya solo se usa para eso). El "Guardado" en verde del
// botón de cada fila ya era una buena confirmación de éxito puntual -- no
// hace falta duplicarlo con un toast.
import { notificarError } from "../utils/notificaciones";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js.
import { resolverUrlImagen } from "../utils/imagenes";
// FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): placeholder de "sin
// imagen" unificado con MiniaturaProducto.jsx (mismo tamaño de miniatura,
// 40x40) -- ver components/iconos.jsx.
import { IconoImagen } from "../components/iconos";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver TAMANO_PAGINA/cargarProductos más
// abajo.
import ControlesPaginacion from "../components/ControlesPaginacion";
import { traerTodasLasPaginas } from "../utils/paginacion";

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esta pantalla
// pedía listarProductos({ limit: 100 }) una sola vez y filtraba nombre/
// categoría/estado en memoria -- pasado los 100 productos, esos filtros no
// veían a los que quedaban afuera de esa primera tanda, en silencio.
// TAMANO_PAGINA chico (20, mismo default que ya usa el backend, ver Limit
// en app/core/pagination.py) + paginación real. nombre/categoría se
// resuelven en el backend (mismos parámetros que ya soporta GET
// /productos/, ver listarProductos en api/products.js); "estado" (crítico/
// disponible) NO tiene equivalente en el backend hoy (depende de comparar
// stock contra stock_minimo, algo que hoy solo se calcula acá) -- ese
// filtro sigue aplicándose en memoria, pero ahora SOLO sobre la página
// visible, no sobre todo el catálogo. Es una limitación conocida y
// aceptada: "stock crítico" pasa a ser "crítico dentro de esta página", no
// "crítico en toda la tienda" -- si el día de mañana hace falta ver TODOS
// los críticos de una, ese filtro tendría que sumarse como parámetro nuevo
// en GET /productos/.
const TAMANO_PAGINA = 20;

const _ESTADOS_STOCK = [
  { valor: "todos", etiqueta: "Mostrar todo" },
  { valor: "disponible", etiqueta: "Stock disponible" },
  { valor: "critico", etiqueta: "Stock crítico" },
];

// Sub-sección "Stock" de Configuración (solo-admin, ver App.jsx/
// ConfiguracionLayout.jsx): pensada para cargar/actualizar el stock de
// muchos productos seguidos, sin abrir el modal completo de edición que
// ya tiene Productos.jsx (ese sigue siendo el lugar para editar nombre,
// precio, imagen, etc. -- acá es nada más el número de stock). Cada fila
// tiene su propio input y botón "Guardar" -- ninguno se manda al backend
// hasta tocar ese botón, así que cambiar el filtro o escribir en una fila
// no afecta a las demás.
//
// "Crítico" ya no es un número fijo para todo el catálogo: cada producto
// trae su propio stock_minimo (columna nueva en el backend), que se carga
// en el formulario de Productos.jsx -- acá solo se lee y se usa para el
// filtro/las etiquetas, no se edita en esta pantalla.
export default function ConfiguracionStock() {
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Valor en edición por producto (id -> string del input), separado de
  // productos[].stock: así lo que el admin está tipeando no se pisa solo
  // al re-renderizar, y comparar contra el stock real dice qué filas
  // tienen cambios sin guardar (el botón "Guardar" se habilita con eso).
  const [valoresStock, setValoresStock] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [guardadoId, setGuardadoId] = useState(null);

  const [pagina, setPagina] = useState(0);
  const [haySiguiente, setHaySiguiente] = useState(false);
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroNombreAplicado, setFiltroNombreAplicado] = useState("");
  const [filtroCategoriaId, setFiltroCategoriaId] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  useEffect(() => {
    const id = setTimeout(() => setFiltroNombreAplicado(filtroNombre.trim()), 300);
    return () => clearTimeout(id);
  }, [filtroNombre]);

  // Nombre/categoría vuelven a la página 0 -- un filtro nuevo no tiene por
  // qué tener tantos resultados como para seguir en la página en la que se
  // estaba. "estado" NO está acá a propósito: se aplica solo sobre la
  // página ya cargada (ver productosFiltrados más abajo), cambiarlo no
  // pide nada nuevo al backend.
  useEffect(() => {
    setPagina(0);
  }, [filtroNombreAplicado, filtroCategoriaId]);

  // Pide un elemento de más (TAMANO_PAGINA + 1) para saber si hay página
  // siguiente sin depender de un total que el backend no devuelve -- ver
  // el comentario grande junto a ControlesPaginacion.jsx.
  // FIX (13/09/2026, auditoría QA/Seguridad -- condición de carrera): mismo
  // motivo que admin/Usuarios.jsx/admin/Productos.jsx -- descarta cualquier
  // respuesta que ya no sea la del último pedido hecho.
  const idPedidoRef = useRef(0);

  async function cargarProductos() {
    const idPedido = ++idPedidoRef.current;
    setCargando(true);
    setError("");
    try {
      const respuesta = await listarProductos({
        skip: pagina * TAMANO_PAGINA,
        limit: TAMANO_PAGINA + 1,
        categoriaId: filtroCategoriaId || undefined,
        nombre: filtroNombreAplicado || undefined,
      });
      if (idPedido !== idPedidoRef.current) return;
      setHaySiguiente(respuesta.data.length > TAMANO_PAGINA);
      const productosDePagina = respuesta.data.slice(0, TAMANO_PAGINA);
      setProductos(productosDePagina);
      setValoresStock(
        Object.fromEntries(productosDePagina.map((producto) => [producto.id, String(producto.stock)])),
      );
    } catch (err) {
      if (idPedido !== idPedidoRef.current) return;
      setError(extraerMensajeError(err));
    } finally {
      if (idPedido === idPedidoRef.current) setCargando(false);
    }
  }

  useEffect(() => {
    cargarProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, filtroCategoriaId, filtroNombreAplicado]);

  // Categorías son una lista de REFERENCIA (dropdown del filtro) --
  // necesita estar completa, así que se trae aparte con
  // traerTodasLasPaginas (ver utils/paginacion.js), una sola vez al montar.
  useEffect(() => {
    traerTodasLasPaginas(listarCategorias)
      .then(setCategorias)
      .catch((err) => setError(extraerMensajeError(err)));
  }, []);

  // "estado" (crítico/disponible) se sigue aplicando en memoria -- ver el
  // comentario grande junto a TAMANO_PAGINA sobre por qué (no tiene
  // equivalente en el backend hoy) y su limitación conocida (solo filtra
  // dentro de la página actual, no todo el catálogo).
  const productosFiltrados = useMemo(() => {
    return productos.filter((producto) => {
      if (filtroEstado === "critico" && producto.stock > producto.stock_minimo) {
        return false;
      }
      if (filtroEstado === "disponible" && producto.stock <= producto.stock_minimo) {
        return false;
      }
      return true;
    });
  }, [productos, filtroEstado]);

  async function manejarGuardarStock(producto) {
    const nuevoStock = Number(valoresStock[producto.id]);
    if (!Number.isInteger(nuevoStock) || nuevoStock < 0) {
      notificarError(`Stock inválido para "${producto.nombre}": tiene que ser un número entero, 0 o mayor.`);
      return;
    }

    setGuardandoId(producto.id);
    try {
      const respuesta = await actualizarProducto(producto.id, { stock: nuevoStock });
      setProductos((actual) => actual.map((item) => (item.id === producto.id ? respuesta.data : item)));
      setValoresStock((actual) => ({ ...actual, [producto.id]: String(respuesta.data.stock) }));
      setGuardadoId(producto.id);
      setTimeout(() => setGuardadoId((actual) => (actual === producto.id ? null : actual)), 1500);
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setGuardandoId(null);
    }
  }

  return (
    <div>
      <h1 className="h3 mb-4">Stock</h1>

      <Form className="row g-2 mb-4">
        <Form.Group className="col-md-5">
          <Form.Control
            type="search"
            placeholder="Buscar por nombre..."
            value={filtroNombre}
            onChange={(evento) => setFiltroNombre(evento.target.value)}
            aria-label="Buscar producto por nombre"
          />
        </Form.Group>
        <Form.Group className="col-md-4">
          <Form.Select
            value={filtroCategoriaId}
            onChange={(evento) => setFiltroCategoriaId(evento.target.value)}
            aria-label="Filtrar por categoría"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="col-md-3">
          <Form.Select
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value)}
            aria-label="Filtrar por estado del stock"
          >
            {_ESTADOS_STOCK.map((estado) => (
              <option key={estado.valor} value={estado.valor}>
                {estado.etiqueta}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      </Form>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th></th>
              <th>Nombre</th>
              <th>Marca</th>
              <th>Categoría</th>
              <th>Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {productosFiltrados.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-4">
                  {productos.length === 0
                    ? "No hay productos activos todavía."
                    : filtroEstado !== "todos"
                      ? // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3):
                        // "estado" solo filtra la página actual (ver el
                        // comentario grande junto a TAMANO_PAGINA más
                        // arriba) -- este aviso lo deja explícito en vez de
                        // sugerir que no hay ninguno en TODO el catálogo.
                        "Ninguno en esta página coincide con ese estado. Probá 'Siguiente' o cambiá el filtro."
                      : "Ningún producto coincide con el filtro."}
                </td>
              </tr>
            )}
            {productosFiltrados.map((producto) => {
              const esCritico = producto.stock <= producto.stock_minimo;
              const valorEnEdicion = valoresStock[producto.id] ?? String(producto.stock);
              const hayCambio = valorEnEdicion !== String(producto.stock);
              return (
                <tr key={producto.id}>
                  <td style={{ width: 56 }}>
                    {producto.imagen_url ? (
                      <Image
                        src={resolverUrlImagen(producto.imagen_url)}
                        alt=""
                        rounded
                        width={40}
                        height={40}
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      // FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): antes decía
                      // "s/f" -- distinto del placeholder de MiniaturaProducto.jsx
                      // para la misma miniatura de 40x40. Ahora usa el mismo ícono
                      // y superficie (theme-aware, ver .superficie en theme.scss),
                      // con "Sin imagen" como title (tooltip) en vez de texto visible
                      // -- a fontSize 10 el texto no entraba de forma legible.
                      <div
                        className="superficie rounded d-flex align-items-center justify-content-center text-muted"
                        style={{ width: 40, height: 40 }}
                        title="Sin imagen"
                      >
                        <IconoImagen />
                      </div>
                    )}
                  </td>
                  <td>{producto.nombre}</td>
                  <td>{producto.marca}</td>
                  <td>{producto.categoria?.nombre ?? "—"}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Control
                        type="number"
                        step="1"
                        min="0"
                        size="sm"
                        style={{ width: 80 }}
                        value={valorEnEdicion}
                        onChange={(evento) =>
                          setValoresStock((actual) => ({ ...actual, [producto.id]: evento.target.value }))
                        }
                        aria-label={`Stock de ${producto.nombre}`}
                      />
                      {esCritico && (
                        <Badge bg={producto.stock === 0 ? "secondary" : "danger"}>
                          {producto.stock === 0 ? "Sin stock" : "Crítico"}
                        </Badge>
                      )}
                    </div>
                    {/* Mínimo configurado para ESTE producto (ver el campo
                        nuevo en el formulario de Productos.jsx) -- distinto
                        producto puede tener distinto punto de corte. */}
                    <div className="text-muted small">mín: {producto.stock_minimo}</div>
                  </td>
                  <td className="text-end">
                    <Button
                      size="sm"
                      variant={guardadoId === producto.id ? "success" : "outline-secondary"}
                      disabled={!hayCambio || guardandoId === producto.id}
                      onClick={() => manejarGuardarStock(producto)}
                    >
                      {guardandoId === producto.id ? "Guardando..." : guardadoId === producto.id ? "Guardado" : "Guardar"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {!cargando && productos.length > 0 && (
        <ControlesPaginacion
          pagina={pagina}
          haySiguiente={haySiguiente}
          cargando={cargando}
          onAnterior={() => setPagina((p) => Math.max(0, p - 1))}
          onSiguiente={() => setPagina((p) => p + 1)}
        />
      )}
    </div>
  );
}
