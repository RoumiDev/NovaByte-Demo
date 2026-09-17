// Sin uso (13/09/2026, auditoría UX/UI Punto Alto #10, a pedido del
// cliente): SiteLayout.jsx ya no importa este componente -- "Catálogo"
// pasó a ser un link común, igual que "Inicio" (ver el comentario grande
// junto al <Navbar> en SiteLayout.jsx para el detalle de por qué). Se deja
// este archivo en vez de borrarlo porque esta sesión no tiene forma de
// eliminar archivos de tu computadora -- lo podés borrar vos a mano
// (src/components/CatalogoMegaMenu.jsx) si querés, igual que con
// SiteNavbar.jsx (ver el mismo tipo de comentario ahí arriba).
import { useEffect, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { listarCategorias } from "../api/categories";
import { listarProductos } from "../api/products";
import { IconoGrilla } from "./iconos";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- encontrado acá mismo mientras se
// resolvía ese hallazgo en las 6 pantallas que sí lo mencionaban
// explícitamente (Catalogo.jsx y las 5 del panel admin): este mega-menú
// tenía exactamente el mismo problema (categorías como lista de referencia,
// un único limit:100) y no estaba en esa lista. Ver el useEffect de acá
// abajo.
import { traerTodasLasPaginas } from "../utils/paginacion";

// FEATURE (12/09/2026, pedido del cliente): mega-menú de "Catálogo" en el
// navbar -- el cliente pasó una captura de otro sitio (varias columnas,
// una por categoría, con nombres debajo de cada una) y pidió que el
// nuestro se vea así. Reemplaza a la versión anterior
// de este archivo (menú de DOS columnas: categorías a la izquierda, marcas
// de la categoría resaltada a la derecha, una a la vez) -- ese diseño
// había quedado sin usar cuando SiteLayout.jsx pasó a ser un sidebar (ver
// el comentario ahí). Ahora que SiteLayout volvió a ser un navbar
// horizontal (12/09/2026), este componente se conecta ahí, en el link
// "Catálogo".
//
// FIX (12/09/2026, pedido del cliente): "te había dicho que figure por
// nombre, no por marca" -- la primera versión de este archivo (acá arriba
// todavía dice "mega-menú...") mostraba, debajo de cada categoría, las
// MARCAS que tienen productos ahí (GET /productos/marcas?categoria_id=...).
// Eso estaba mal: el cliente pidió el NOMBRE de cada producto, no la marca.
// Ahora cada columna pide los productos de esa categoría (GET /productos/
// ?categoria_id=...) y muestra producto.nombre -- clic en un nombre lleva
// directo a la ficha de ESE producto (/productos/:id), no a un filtro del
// catálogo por marca.
//
// Nota de diseño (sigue vigente de la versión anterior): el modelo de
// datos actual no tiene subcategorías, solo Categoria (tabla plana, ver
// app/models/product.py) y Producto.nombre por producto individual -- no
// hay un nivel intermedio tipo "PC Gamer"/"Notebook Oficina" como en la
// referencia que pasó el cliente. Se preguntó explícitamente si convenía
// agregar ese campo nuevo (subcategoría) y el cliente todavía no lo
// confirmó -- por ahora esto usa el nombre real de cada producto ya
// cargado, sin inventar una categoría intermedia que no existe en el
// sistema.
//
// FIX (13/09/2026, auditoría UX/UI Punto Alto #10, a pedido del cliente):
// el trigger ANTES se abría solo con onMouseEnter (hover) en pantallas
// grandes -- el problema es que eso deja al panel ya abierto antes de que
// el usuario llegue a hacer clic en "Catálogo", así que un clic pensado
// para ir al catálogo completo lo único que lograba era CERRAR el panel
// que el mouse acababa de abrir solo. A pedido explícito del cliente, se
// saca el hover por completo: en PC/notebook, igual que en móvil/tablet,
// el panel se abre y se cierra ÚNICAMENTE con clic/toque sobre "Catálogo"
// (ver alternar() más abajo) -- mismo comportamiento en todos los
// dispositivos, sin sorpresas. RETRASO_CIERRE_MS/cierreTimeoutRef/
// manejarCerrar (que existían solo para el cierre demorado por
// onMouseLeave) se sacaron de acá abajo por quedar sin uso.

// FIX UX-A1 (auditoría UX/UI 12/09/2026, Punto Crítico #1 "Crítico"): sigue
// vigente aunque ya no hay hover -- un usuario que abre el panel con
// teclado (Enter sobre el botón "Catálogo", que dispara alternar() más
// abajo) y sigue tabulando hacia otro link del navbar necesita alguna forma
// de cerrarlo sin volver a tocar ese mismo botón. Ver el useEffect de
// "cierre por teclado/clic afuera" más abajo, que agrega Escape y
// click/foco fuera del panel como cierres adicionales.

// Tope de nombres por columna: sin esto, una categoría con muchísimos
// productos cargados haría una columna gigante que descuadra el resto del
// menú. "Ver todo en <categoría>" (más abajo) sigue llevando al listado
// completo sin límite. Mismo valor que le pasamos a listarProductos como
// `limit` -- no tiene sentido pedir más de los que se van a mostrar.
const _MAX_NOMBRES_POR_COLUMNA = 8;

export default function CatalogoMegaMenu({ onNavegar }) {
  const [abierto, setAbierto] = useState(false);
  // null = todavía no se pidió la lista de categorías.
  const [categorias, setCategorias] = useState(null);
  // Productos por categoría (hasta _MAX_NOMBRES_POR_COLUMNA de cada una),
  // todos juntos: undefined mientras no se pidió ninguno, luego el objeto
  // completo { [categoriaId]: [producto, producto, ...] }.
  const [productosPorCategoria, setProductosPorCategoria] = useState(undefined);
  // Evita volver a pedir los productos de todas las categorías cada vez
  // que se vuelve a abrir el menú en la misma visita -- se piden una sola
  // vez, la primera vez que se abre.
  const yaPedidosRef = useRef(false);
  const navigate = useNavigate();
  // FIX UX-A1: refs para el cierre por teclado/clic afuera -- raizRef para
  // saber si un click/foco cayó dentro o fuera del componente entero (botón
  // + panel), botonRef para devolver el foco ahí al cerrar con Escape (si
  // no, el foco quedaría "perdido" en un elemento que dejó de existir).
  const raizRef = useRef(null);
  const botonRef = useRef(null);

  useEffect(() => {
    traerTodasLasPaginas(listarCategorias)
      .then((todas) => setCategorias(todas))
      .catch(() => {
        // Si falla, el menú simplemente no se despliega (ver el chequeo
        // de categorias?.length más abajo) -- el catálogo completo sigue
        // accesible desde /catalogo igual.
        setCategorias([]);
      });
  }, []);

  function pedirProductosDeTodasLasCategorias() {
    if (yaPedidosRef.current || !categorias || categorias.length === 0) {
      return;
    }
    yaPedidosRef.current = true;
    Promise.all(
      categorias.map((categoria) =>
        listarProductos({ categoriaId: categoria.id, limit: _MAX_NOMBRES_POR_COLUMNA })
          .then((respuesta) => [categoria.id, respuesta.data])
          .catch(() => [categoria.id, []]),
      ),
    ).then((pares) => setProductosPorCategoria(Object.fromEntries(pares)));
  }

  function manejarAbrir() {
    setAbierto(true);
    pedirProductosDeTodasLasCategorias();
  }

  // El trigger es un <button>, no un link real: onClick alterna el estado
  // sea cual sea el dispositivo -- ver el FIX de más arriba (13/09/2026,
  // Punto Alto #10) sobre por qué esto ya no depende de hover en ningún
  // tamaño de pantalla. Ir al catálogo completo queda en el botón
  // "Ver todo" de adentro del panel.
  function alternar() {
    if (abierto) {
      setAbierto(false);
    } else {
      manejarAbrir();
    }
  }

  // FIX UX-A1: mientras el panel está abierto, Escape lo cierra (devolviendo
  // el foco al botón "Catálogo") y un click o un foco que caiga fuera de
  // raizRef (botón + panel) también -- así queda cubierto tanto mouse
  // (click afuera) como teclado (Tab hacia otro link, o Escape). Se
  // registra en "document" solo mientras "abierto" es true, así que no hay
  // listeners de sobra corriendo el resto del tiempo.
  useEffect(() => {
    if (!abierto) {
      return;
    }

    function manejarTeclaGlobal(evento) {
      if (evento.key === "Escape") {
        setAbierto(false);
        botonRef.current?.focus();
      }
    }

    function manejarFueraDelPanel(evento) {
      if (raizRef.current && !raizRef.current.contains(evento.target)) {
        setAbierto(false);
      }
    }

    document.addEventListener("keydown", manejarTeclaGlobal);
    // "mousedown" (no "click") para que el cierre pase ANTES de que un click
    // afuera dispare su propia acción -- y "focusin" para el caso de Tab,
    // que mueve el foco sin ningún evento de mouse de por medio.
    document.addEventListener("mousedown", manejarFueraDelPanel);
    document.addEventListener("focusin", manejarFueraDelPanel);
    return () => {
      document.removeEventListener("keydown", manejarTeclaGlobal);
      document.removeEventListener("mousedown", manejarFueraDelPanel);
      document.removeEventListener("focusin", manejarFueraDelPanel);
    };
  }, [abierto]);

  function ir(url) {
    setAbierto(false);
    // Cierra también el navbar colapsado en celular (ver SiteLayout.jsx,
    // que pasa cerrarMenu acá como onNavegar) -- mismo criterio que el
    // resto de los links del navbar: "ya navegaste a donde querías ir".
    onNavegar?.();
    navigate(url);
  }

  const hayCategorias = categorias !== null && categorias.length > 0;

  return (
    <div ref={raizRef} className="nav-item position-relative">
      {/* FIX (13/09/2026, auditoría UX/UI -- ver el comentario grande junto
          al <Navbar> en SiteLayout.jsx): gap-2 -> gap-1, mismo recorte que
          el resto de los Nav.Link de ese archivo para que el navbar entero
          entre en una sola línea a partir de "xl" (1200px) en vez de
          "xxl" (1400px). */}
      <button
        ref={botonRef}
        type="button"
        className="nav-link d-flex align-items-center gap-1 bg-transparent border-0"
        onClick={alternar}
        aria-expanded={abierto}
      >
        <IconoGrilla /> Catálogo <span aria-hidden="true">{abierto ? "▴" : "▾"}</span>
      </button>

      {abierto && hayCategorias && (
        <div className="mega-menu-catalogo-panel superficie shadow-lg rounded-3 p-3 p-md-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <span className="text-uppercase text-muted small fw-semibold">Categorías</span>
            <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={() => ir("/catalogo")}>
              Ver todo →
            </button>
          </div>

          {productosPorCategoria === undefined ? (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : (
            <div className="mega-menu-catalogo-columnas">
              {categorias.map((categoria) => {
                const productos = productosPorCategoria[categoria.id] || [];
                return (
                  <div key={categoria.id} className="mega-menu-catalogo-item mb-3">
                    <button
                      type="button"
                      className="btn btn-link p-0 text-decoration-none fw-semibold text-uppercase small d-block mb-2 text-start"
                      onClick={() => ir(`/catalogo?categoria=${categoria.id}`)}
                    >
                      {categoria.nombre}
                    </button>
                    <div className="d-flex flex-column">
                      {productos.length === 0 ? (
                        <span className="text-muted small">Sin productos todavía</span>
                      ) : (
                        // Clic en el nombre de un producto va directo a SU
                        // ficha (/productos/:id) -- a diferencia de la
                        // versión anterior (marcas), que llevaba a un
                        // filtro del catálogo, acá cada nombre es un
                        // producto puntual, así que el destino natural es
                        // esa ficha.
                        productos.map((producto) => (
                          <button
                            key={producto.id}
                            type="button"
                            className="btn btn-link p-0 text-decoration-none text-body small text-start mb-1 text-truncate"
                            onClick={() => ir(`/productos/${producto.id}`)}
                            title={producto.nombre}
                          >
                            {producto.nombre}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
