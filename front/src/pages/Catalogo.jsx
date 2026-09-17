import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Container, Form, Spinner } from "react-bootstrap";
import { useSearchParams } from "react-router-dom";
import { extraerMensajeError } from "../api/client";
import { listarCategorias } from "../api/categories";
import { listarProductos } from "../api/products";
import { useCart } from "../context/CartContext";
import GrillaCategorias from "../components/GrillaCategorias";
import GrillaProductos from "../components/GrillaProductos";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver TAMANO_PAGINA/cargarProductos más
// abajo.
import { traerTodasLasPaginas } from "../utils/paginacion";

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esta pantalla
// pedía listarProductos({ limit: 100 }) una sola vez -- el producto 101 en
// adelante de una categoría/marca/búsqueda con más de 100 resultados
// simplemente no aparecía en el catálogo público, sin ningún aviso ni forma
// de verlo. TAMANO_PAGINA chico + botón "Cargar más" (en vez de
// Anterior/Siguiente, más cómodo para navegar un catálogo de a poco que
// para ir y volver entre páginas como en una tabla de administración).
const TAMANO_PAGINA = 24;

// Catálogo: cada producto se agrega al carrito (context/CartContext), no
// se compra al toque. El checkout de varios productos a la vez pasa por
// /carrito ahora. Acepta ?categoria=<id>, ?marca=<nombre> y ?nombre=<texto>
// en la URL -- nombre lo arma la barra de búsqueda del navbar (ver
// components/SiteLayout.jsx); categoria/marca se arman navegando desde
// GrillaCategorias/tarjetas de producto o escribiendo la URL a mano. Los
// tres filtros pueden estar activos a la vez. El sidebar/navegación ya no
// se arma acá: lo pone SiteLayout.jsx alrededor (ver App.jsx).
//
// FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "sin filtros nunca
// lista productos (no hay 'ver todos')" -- ANTES, sin ningún filtro, esta
// pantalla solo podía mostrar la grilla de categorías (GrillaCategorias,
// tarjetas con imagen_url de Categoria), sin ninguna forma de listar el
// catálogo completo. Ahora acepta también ?todos=1 (ver verTodos más
// abajo): un modo explícito que fuerza el listado completo de productos
// aunque no haya categoría/marca/nombre -- el botón "Ver todos los
// productos" de la grilla de categorías arma esa URL. Sin NINGUNO de los
// cuatro (categoria/marca/nombre/todos) se sigue mostrando la grilla de
// categorías como pantalla de entrada.
//
// FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay control de
// orden/precio" -- ?orden=nuevo|precio_asc|precio_desc|nombre (ver
// OPCIONES_ORDEN/ordenFiltro más abajo), mismos 4 valores que acepta
// OrdenProductos en app/router/products.py. "nuevo" (más nuevo primero) es
// el default de siempre -- no aparece en la URL a menos que se elija otra
// cosa, para no romper ningún link viejo que ya apuntaba a esta pantalla.
// Etiquetas del <select> de más abajo + lista de referencia para validar
// el valor que venga en la URL (ver ordenFiltro más abajo).
const OPCIONES_ORDEN = [
  { valor: "nuevo", etiqueta: "Más nuevo primero" },
  { valor: "precio_asc", etiqueta: "Precio: menor a mayor" },
  { valor: "precio_desc", etiqueta: "Precio: mayor a menor" },
  { valor: "nombre", etiqueta: "Nombre (A-Z)" },
];
const ORDEN_POR_DEFECTO = "nuevo";

export default function Catalogo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoriaIdFiltro = searchParams.get("categoria");
  const marcaFiltro = searchParams.get("marca");
  const nombreFiltro = searchParams.get("nombre");
  // FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay 'ver todos'"
  // -- antes, sin ningún filtro, esta pantalla SOLO podía mostrar la
  // grilla de categorías (ver "sinFiltros" más abajo), sin ninguna forma
  // de listar el catálogo completo. ?todos=1 es un modo explícito
  // (distinto de categoria/marca/nombre) que fuerza el listado de
  // productos aunque no haya ningún filtro real -- ver el botón "Ver
  // todos los productos" más abajo.
  const verTodos = searchParams.get("todos") === "1";
  // Si el valor de la URL no es uno de los 4 válidos (tocado a mano, o un
  // link viejo) cae al default en vez de mandarle al backend algo que le
  // va a devolver 422 -- mismo criterio defensivo que categoriaIdFiltro,
  // que tampoco valida que sea un id real antes de pedirlo.
  const ordenFiltroCrudo = searchParams.get("orden");
  const ordenFiltro = OPCIONES_ORDEN.some((opcion) => opcion.valor === ordenFiltroCrudo)
    ? ordenFiltroCrudo
    : ORDEN_POR_DEFECTO;

  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): "cargando" es la
  // carga inicial (o de un filtro nuevo, que arranca de cero); "cargandoMas"
  // es la del botón "Cargar más" -- separado para no reemplazar toda la
  // grilla por un spinner solo porque se pidió una página más.
  const [cargandoMas, setCargandoMas] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [haySiguiente, setHaySiguiente] = useState(false);
  const [cargandoCategorias, setCargandoCategorias] = useState(true);
  const [error, setError] = useState("");
  // Feedback momentáneo de "Agregado" en el botón que se tocó -- se limpia
  // solo a los 1.5s, no depende de nada más.
  const [agregadoId, setAgregadoId] = useState(null);
  const { agregarAlCarrito } = useCart();

  // Sin categoría, marca ni búsqueda activa todavía se muestra la grilla de
  // categorías (ver GrillaCategorias más abajo) en vez de productos -- SALVO
  // que se haya pedido "todos" explícitamente (ver verTodos arriba).
  const sinFiltros = !categoriaIdFiltro && !marcaFiltro && !nombreFiltro && !verTodos;

  // Se usan tanto para el chip de filtro activo (nombre real, no un id
  // pelado) como para la grilla de categorías cuando no hay filtro. Lista
  // de REFERENCIA (necesita estar completa) -- traerTodasLasPaginas (ver
  // utils/paginacion.js) en vez de un único limit:100, mismo motivo que el
  // resto de los cambios de este fix.
  useEffect(() => {
    setCargandoCategorias(true);
    traerTodasLasPaginas(listarCategorias)
      .then((todas) => setCategorias(todas))
      .catch((err) => {
        // Si sinFiltros, esta es la pantalla principal -- ahí sí importa
        // mostrar el error. Con un filtro activo, el chip simplemente cae
        // al id pelado (ver nombreCategoriaFiltro más abajo) y no vale la
        // pena duplicar el error con el que ya puede tirar listarProductos.
        if (sinFiltros) {
          setError(extraerMensajeError(err));
        }
      })
      .finally(() => setCargandoCategorias(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): pide un elemento de
  // más (TAMANO_PAGINA + 1) para saber si hay más productos sin depender de
  // un total que el backend no devuelve -- ver el comentario grande junto a
  // ControlesPaginacion.jsx (mismo criterio, acá con "Cargar más" en vez de
  // Anterior/Siguiente). "reemplazar" true = filtro nuevo, pisa la lista;
  // false = "Cargar más", concatena al final.
  // FIX (13/09/2026, auditoría QA/Seguridad -- condición de carrera): mismo
  // motivo que las pantallas de admin -- cambiar de filtro justo antes de
  // que responda el pedido anterior podría, sin este chequeo, agregar al
  // final de la lista productos de un filtro viejo (con "reemplazar:
  // false" ya en curso) después de que la lista se vació para el filtro
  // nuevo.
  const idPedidoRef = useRef(0);

  function cargarPagina(paginaAPedir, reemplazar) {
    const idPedido = ++idPedidoRef.current;
    if (reemplazar) {
      setCargando(true);
    } else {
      setCargandoMas(true);
    }
    listarProductos({
      skip: paginaAPedir * TAMANO_PAGINA,
      limit: TAMANO_PAGINA + 1,
      categoriaId: categoriaIdFiltro || undefined,
      marca: marcaFiltro || undefined,
      nombre: nombreFiltro || undefined,
      orden: ordenFiltro,
    })
      .then((respuesta) => {
        if (idPedido !== idPedidoRef.current) return;
        setHaySiguiente(respuesta.data.length > TAMANO_PAGINA);
        const nuevaTanda = respuesta.data.slice(0, TAMANO_PAGINA);
        setProductos((actuales) => (reemplazar ? nuevaTanda : [...actuales, ...nuevaTanda]));
      })
      .catch((err) => {
        if (idPedido !== idPedidoRef.current) return;
        setError(extraerMensajeError(err));
      })
      .finally(() => {
        if (idPedido !== idPedidoRef.current) return;
        setCargando(false);
        setCargandoMas(false);
      });
  }

  function manejarCargarMas() {
    const siguientePagina = pagina + 1;
    setPagina(siguientePagina);
    cargarPagina(siguientePagina, false);
  }

  // Sin ningún filtro no hay nada que listar todavía (se muestra la grilla
  // de categorías en su lugar) -- evita pedir productos de arranque que ni
  // se van a mostrar. Cualquier cambio de filtro arranca la lista de cero
  // (página 0, reemplazando lo que hubiera).
  useEffect(() => {
    if (sinFiltros) {
      setProductos([]);
      setCargando(false);
      return;
    }
    setPagina(0);
    cargarPagina(0, /* reemplazar */ true);
    // FIX (13/09/2026, auditoría UX/UI Punto Alto #11): ordenFiltro se
    // suma acá -- cambiar el orden tiene que recargar desde la página 0,
    // igual que cambiar cualquier otro filtro (si no, "Cargar más"
    // mezclaría páginas pedidas con dos criterios de orden distintos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinFiltros, categoriaIdFiltro, marcaFiltro, nombreFiltro, ordenFiltro]);

  const nombreCategoriaFiltro = categorias.find(
    (categoria) => String(categoria.id) === categoriaIdFiltro,
  )?.nombre;

  function quitarFiltroCategoria() {
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      siguiente.delete("categoria");
      return siguiente;
    });
  }

  function quitarFiltroMarca() {
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      siguiente.delete("marca");
      return siguiente;
    });
  }

  function quitarFiltroNombre() {
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      siguiente.delete("nombre");
      return siguiente;
    });
  }

  // FIX (13/09/2026, auditoría UX/UI Punto Alto #11): activa/desactiva el
  // modo "ver todos" (ver verTodos más arriba) -- volverACategorias no
  // hace falta que toque categoria/marca/nombre: solo se puede llegar a
  // "todos" desde la grilla de categorías (sinFiltros), así que esos tres
  // ya están vacíos cuando esto se usa.
  function verTodosLosProductos() {
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      siguiente.set("todos", "1");
      return siguiente;
    });
  }

  function volverACategorias() {
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      siguiente.delete("todos");
      return siguiente;
    });
  }

  // FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay control de
  // orden/precio" -- deja el parámetro afuera de la URL cuando vuelve al
  // default ("nuevo"), mismo criterio prolijo que ya tienen categoria/
  // marca/nombre (nunca aparecen en la URL con un valor "vacío").
  function manejarCambiarOrden(evento) {
    const nuevoOrden = evento.target.value;
    setSearchParams((actual) => {
      const siguiente = new URLSearchParams(actual);
      if (nuevoOrden === ORDEN_POR_DEFECTO) {
        siguiente.delete("orden");
      } else {
        siguiente.set("orden", nuevoOrden);
      }
      return siguiente;
    });
  }

  function manejarAgregar(producto) {
    agregarAlCarrito(producto, 1);
    setAgregadoId(producto.id);
    setTimeout(() => setAgregadoId((actual) => (actual === producto.id ? null : actual)), 1500);
  }

  return (
    <Container className="pb-5 pt-4">
      <div className="d-flex align-items-center gap-2 mb-4 flex-wrap">
        <h1 className="h3 mb-0">Catálogo</h1>
        {/* FIX (13/09/2026, auditoría UX/UI Punto Alto #11): chip de "Todos
            los productos", mismo patrón visual que los otros tres filtros
            de acá abajo -- volverACategorias (la ×) saca "todos" de la URL
            y vuelve a la grilla de categorías. */}
        {verTodos && (
          <Badge bg="secondary" className="d-flex align-items-center gap-2 fs-6 fw-normal py-2">
            Todos los productos
            <span role="button" onClick={volverACategorias} title="Volver a categorías" style={{ cursor: "pointer" }}>
              ×
            </span>
          </Badge>
        )}
        {categoriaIdFiltro && (
          <Badge bg="secondary" className="d-flex align-items-center gap-2 fs-6 fw-normal py-2">
            {nombreCategoriaFiltro || `Categoría #${categoriaIdFiltro}`}
            <span role="button" onClick={quitarFiltroCategoria} title="Quitar filtro" style={{ cursor: "pointer" }}>
              ×
            </span>
          </Badge>
        )}
        {marcaFiltro && (
          <Badge bg="secondary" className="d-flex align-items-center gap-2 fs-6 fw-normal py-2">
            {marcaFiltro}
            <span role="button" onClick={quitarFiltroMarca} title="Quitar filtro" style={{ cursor: "pointer" }}>
              ×
            </span>
          </Badge>
        )}
        {nombreFiltro && (
          <Badge bg="secondary" className="d-flex align-items-center gap-2 fs-6 fw-normal py-2">
            "{nombreFiltro}"
            <span role="button" onClick={quitarFiltroNombre} title="Quitar filtro" style={{ cursor: "pointer" }}>
              ×
            </span>
          </Badge>
        )}
        {/* FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay
            control de orden/precio" -- ms-auto lo empuja al extremo
            derecho de esta misma fila (con flex-wrap, baja de línea solo
            si hace falta). Solo tiene sentido mientras se está listando
            productos, no arriba de la grilla de categorías. */}
        {!sinFiltros && (
          <Form.Select
            size="sm"
            className="ms-auto"
            style={{ maxWidth: 220 }}
            value={ordenFiltro}
            onChange={manejarCambiarOrden}
            aria-label="Ordenar productos"
          >
            {OPCIONES_ORDEN.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </Form.Select>
        )}
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {sinFiltros ? (
        cargandoCategorias ? (
          <Spinner animation="border" />
        ) : categorias.length === 0 ? (
          <Alert variant="secondary">Todavía no hay categorías cargadas.</Alert>
        ) : (
          <>
            {/* FIX (13/09/2026, auditoría UX/UI Punto Alto #11): "no hay
                'ver todos'" -- antes, sin elegir una categoría, no había
                ninguna forma de listar el catálogo completo desde acá. */}
            <div className="d-flex justify-content-end mb-3">
              <Button variant="link" className="text-decoration-none p-0" onClick={verTodosLosProductos}>
                Ver todos los productos →
              </Button>
            </div>
            <GrillaCategorias categorias={categorias} />
          </>
        )
      ) : cargando ? (
        <Spinner animation="border" />
      ) : productos.length === 0 ? (
        <Alert variant="secondary">No hay productos cargados con esos filtros.</Alert>
      ) : (
        <>
          <GrillaProductos productos={productos} agregadoId={agregadoId} onAgregar={manejarAgregar} />
          {/* FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esto
              no existía -- el catálogo se cortaba en los primeros 100
              productos sin ningún aviso ni forma de ver el resto. */}
          {haySiguiente && (
            <div className="d-flex justify-content-center mt-4">
              <Button variant="outline-secondary" disabled={cargandoMas} onClick={manejarCargarMas}>
                {cargandoMas ? "Cargando..." : "Cargar más"}
              </Button>
            </div>
          )}
        </>
      )}
    </Container>
  );
}
