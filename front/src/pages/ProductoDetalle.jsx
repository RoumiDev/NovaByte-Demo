import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Button, Col, Container, Row, Spinner } from "react-bootstrap";
import { extraerMensajeError } from "../api/client";
import {
  listarProductosRelacionados,
  marcarFavorito,
  obtenerEstadoFavorito,
  obtenerProducto,
  quitarFavorito,
} from "../api/products";
import GrillaProductos from "../components/GrillaProductos";
import { IconoMarca } from "../components/Marca";
// FIX UX-05 (auditoría UX/UI 26/08/2026, Media #3): estos íconos (antes
// definidos acá mismo) ahora viven en components/iconos.jsx, junto con
// todos los demás de la app -- ver ese archivo. IconoCarrito se usaba acá
// a 20x20 (el resto de la app lo usa a 18x18); se sigue pidiendo ese
// tamaño explícito en cada <IconoCarrito /> de más abajo en vez de
// cambiar el default del módulo compartido.
import { IconoCarrito, IconoCheck, IconoEscudo, IconoEstrella } from "../components/iconos";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { formatearMoneda } from "../utils/formato";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js.
import { resolverUrlImagen } from "../utils/imagenes";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): si falla
// marcar/quitar favorito, la estrella ya se revertía sola (línea de abajo)
// pero antes no había NINGÚN aviso de que había pasado algo -- quedaba en
// silencio total. Se agrega un toast de error, ver utils/notificaciones.js.
import { notificarError } from "../utils/notificaciones";

// Pantalla de detalle: se abre al hacer clic en una tarjeta de producto
// (ver GrillaProductos.jsx) para leer la descripción completa, la garantía
// y el resto de los datos que la tarjeta del listado no tiene espacio para
// mostrar. Ruta /productos/:id (ver App.jsx) -- misma que ya exponía el
// backend en GET /productos/{id} (app/router/products.py), no hizo falta
// tocar nada del lado del backend.
//
// La ruta en sí es pública (igual que Home), así que esta pantalla la
// puede ver un visitante sin sesión. Lo que sí sigue exigiendo login es
// "Agregar al carrito" -- mismo criterio que ya tiene Home.jsx (ver
// manejarAgregar más abajo), para no reabrir el bug que se corrigió ahí:
// dejar agregar al carrito sin estar logueado.
export default function ProductoDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { estaAutenticado } = useAuth();
  const { agregarAlCarrito } = useCart();
  const [producto, setProducto] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [agregado, setAgregado] = useState(false);
  const [esFavorito, setEsFavorito] = useState(false);
  const [guardandoFavorito, setGuardandoFavorito] = useState(false);
  // "También vas a necesitar" -- productos vinculados a este (ej. el tóner
  // de una impresora, ver ProductoRelacionado en app/models/product.py).
  // agregadoIdRelacionados es propio de esta grilla, separado del
  // "agregado" del producto principal de más abajo: son tarjetas
  // distintas, cada una necesita su propio feedback de "Agregado ✓".
  const [relacionados, setRelacionados] = useState([]);
  const [agregadoIdRelacionados, setAgregadoIdRelacionados] = useState(null);

  useEffect(() => {
    setCargando(true);
    setError("");
    setProducto(null);
    setRelacionados([]);
    obtenerProducto(id)
      .then((respuesta) => setProducto(respuesta.data))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
    // Público, igual que obtenerProducto -- no hace falta esperar a que
    // termine de cargar el producto principal, los dos pedidos van en
    // paralelo. Si falla, la sección de relacionados simplemente no
    // aparece (ver el render más abajo), no tapa el resto de la ficha.
    listarProductosRelacionados(id)
      .then((respuesta) => setRelacionados(respuesta.data))
      .catch(() => {});
    // Sin esto, navegar de un producto a otro (ej. desde "también vas a
    // necesitar") reusaría el estado del anterior hasta que termine de
    // cargar el nuevo.
  }, [id]);

  // Estado inicial de la estrella: solo tiene sentido consultarlo si hay
  // sesión (el endpoint exige login, ver GET /productos/{id}/favorito) y
  // una vez que se sabe qué producto es. Si falla (ej. sin conexión), se
  // deja en "no favorito" -- no es lo suficientemente crítico como para
  // tapar la pantalla con un error solo por esto.
  useEffect(() => {
    if (!estaAutenticado || !producto) {
      setEsFavorito(false);
      return;
    }
    obtenerEstadoFavorito(producto.id)
      .then((respuesta) => setEsFavorito(respuesta.data.es_favorito))
      .catch(() => {});
  }, [estaAutenticado, producto]);

  function manejarAgregar() {
    if (!estaAutenticado) {
      navigate("/login");
      return;
    }
    agregarAlCarrito(producto, 1);
    setAgregado(true);
    setTimeout(() => setAgregado(false), 1500);
  }

  // Mismo criterio de login que manejarAgregar -- GrillaProductos ya llama
  // a esto con el producto relacionado puntual que se tocó.
  function manejarAgregarRelacionado(productoRelacionado) {
    if (!estaAutenticado) {
      navigate("/login");
      return;
    }
    agregarAlCarrito(productoRelacionado, 1);
    setAgregadoIdRelacionados(productoRelacionado.id);
    setTimeout(() => setAgregadoIdRelacionados((actual) => (actual === productoRelacionado.id ? null : actual)), 1500);
  }

  // "Ir al carrito": mismo agregado que el botón de arriba (agregarAlCarrito)
  // pero además navega a /carrito -- no es solo un atajo de navegación, deja
  // este producto sumado para que ya aparezca ahí sin tener que volver.
  function manejarIrAlCarrito() {
    agregarAlCarrito(producto, 1);
    navigate("/carrito");
  }

  // Mismo criterio de login que "Agregar al carrito": sin sesión, manda a
  // /login en vez de intentar guardar un favorito de nadie. La estrella se
  // pinta optimistamente (antes de que responda el backend) y se revierte
  // si el pedido falla, para que el clic se sienta instantáneo.
  async function manejarFavorito() {
    if (!estaAutenticado) {
      navigate("/login");
      return;
    }
    const nuevoEstado = !esFavorito;
    setEsFavorito(nuevoEstado);
    setGuardandoFavorito(true);
    try {
      if (nuevoEstado) {
        await marcarFavorito(producto.id);
      } else {
        await quitarFavorito(producto.id);
      }
    } catch (err) {
      setEsFavorito(!nuevoEstado);
      // FIX UX-03: antes esto fallaba en silencio -- la estrella se
      // revertía sola sin que quedara claro por qué el clic "no hizo nada".
      notificarError(extraerMensajeError(err));
    } finally {
      setGuardandoFavorito(false);
    }
  }

  if (cargando) {
    return (
      <Container className="pantalla-centrada">
        <Spinner animation="border" role="status" />
      </Container>
    );
  }

  if (error || !producto) {
    return (
      <Container className="pb-5 pt-4">
        <Alert variant="danger">{error || "Producto no encontrado."}</Alert>
        <Button variant="outline-secondary" onClick={() => navigate(-1)}>
          Volver
        </Button>
      </Container>
    );
  }

  // La descripción se escribe en el alta de producto como una línea por
  // característica (ej. "Capacidad: 16 GB\nInterfaz: USB 2.0\n..."), así
  // que si tiene más de un renglón se muestra como lista de viñetas (como
  // en la referencia visual del cliente); si es un párrafo único, se deja
  // como texto corrido.
  const lineasDescripcion = (producto.descripcion ?? "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  return (
    <Container className="pb-5 pt-4">
      <Button variant="link" className="ps-0 mb-3 text-decoration-none" onClick={() => navigate(-1)}>
        &larr; Volver a productos
      </Button>

      {/* Un solo banner que encierra toda la ficha (imagen + datos) -- antes
          cada dato iba suelto directo sobre el fondo de la página; ahora
          todo queda contenido en un único panel, con un borde propio que
          lo separa del resto (misma superficie que usan otros paneles de
          la app -- ver .superficie en theme.scss -- así se ve consistente
          en modo claro y oscuro). */}
      <div className="superficie rounded-4 p-4 p-md-5">
        <Row className="g-4">
          <Col xs={12} md={5}>
            <div
              className="d-flex align-items-center justify-content-center position-relative overflow-hidden rounded-3"
              style={{ height: 340 }}
            >
              <IconoMarca
                aria-hidden="true"
                className="producto-card__marca-agua"
                style={{ width: 160, height: 160, right: -30, bottom: -20 }}
              />
              <div className="d-flex align-items-center justify-content-center h-100 w-100" style={{ position: "relative", zIndex: 1 }}>
                {producto.imagen_url ? (
                  <img
                    src={resolverUrlImagen(producto.imagen_url)}
                    alt={producto.nombre}
                    style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <span className="text-muted">Sin imagen</span>
                )}
              </div>
            </div>
          </Col>

          <Col xs={12} md={7}>
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div className="text-primary text-uppercase small fw-semibold">
                {producto.categoria?.nombre ?? producto.marca}
              </div>
              <Button
                variant="link"
                className="p-0 lh-1 text-decoration-none"
                aria-label={esFavorito ? "Quitar de favoritos" : "Marcar como favorito"}
                aria-pressed={esFavorito}
                disabled={guardandoFavorito}
                onClick={manejarFavorito}
              >
                <IconoEstrella relleno={esFavorito} className={esFavorito ? "text-primary" : "text-muted"} />
              </Button>
            </div>
            <h1 className="h3 mb-2">{producto.nombre}</h1>
            <div className="text-muted mb-3">Marca: {producto.marca}</div>

            <div className="fs-3 fw-bold mb-2">{formatearMoneda(producto.precio_venta)}</div>

            {producto.stock === 0 ? (
              <Badge bg="secondary" className="mb-2">
                Sin stock
              </Badge>
            ) : (
              <div className="d-flex align-items-center gap-2 text-muted mb-2">
                <span>Disponibilidad: {producto.stock} unidades en stock</span>
                <IconoCheck className="text-success" />
              </div>
            )}

            {producto.garantia && (
              // El texto es tal cual lo carga el admin en el campo "Garantía"
              // del alta/edición de producto (ver Productos.jsx) -- acá no se
              // le agrega ni la marca ni ninguna otra palabra, para que
              // siempre coincida exactamente con lo que se cargó.
              <div className="d-flex align-items-center gap-2 text-muted mb-3">
                <IconoEscudo className="text-primary flex-shrink-0" />
                <span>Garantía: {producto.garantia}</span>
              </div>
            )}

            {lineasDescripcion.length > 1 ? (
              <ul className="list-unstyled mb-4">
                {lineasDescripcion.map((linea, indice) => (
                  // eslint-disable-next-line react/no-array-index-key -- la
                  // lista sale de un texto libre, no tiene un id propio.
                  <li key={indice} className="d-flex align-items-start gap-2 mb-1">
                    <IconoMarca className="text-primary flex-shrink-0 mt-1" style={{ width: 10, height: 10 }} />
                    <span>{linea}</span>
                  </li>
                ))}
              </ul>
            ) : (
              lineasDescripcion.length === 1 && <p className="mb-4">{lineasDescripcion[0]}</p>
            )}

            <Button
              variant={agregado ? "success" : "dark"}
              size="lg"
              className="d-flex align-items-center justify-content-center gap-2 w-100 text-uppercase fw-semibold btn-agregar-carrito"
              disabled={producto.stock === 0}
              onClick={manejarAgregar}
            >
              {agregado ? "Agregado ✓" : (
                <>
                  Agregar al carrito
                  <IconoCarrito width={20} height={20} />
                </>
              )}
            </Button>

            {/* Solo con sesión iniciada -- sin login no tiene sentido
                ofrecer ir al carrito (mismo criterio que "Agregar al
                carrito" de acá arriba, que ya exige login). Suma el
                producto (manejarIrAlCarrito) y recién ahí navega -- no es
                solo un atajo de navegación, deja el producto cargado. */}
            {estaAutenticado && (
              <Button
                variant="outline-secondary"
                size="lg"
                className="d-flex align-items-center justify-content-center gap-2 w-100 mt-2 text-uppercase fw-semibold"
                disabled={producto.stock === 0}
                onClick={manejarIrAlCarrito}
              >
                Ir al carrito
                <IconoCarrito width={20} height={20} />
              </Button>
            )}
          </Col>
        </Row>
      </div>

      {/* Solo si el admin cargó algún vínculo (ver Productos.jsx, campo
          "Productos relacionados") -- ej. el tóner, cartucho u hojas de
          esta impresora. Reusa GrillaProductos, misma tarjeta y botón de
          agregar al carrito que el resto del catálogo. */}
      {relacionados.length > 0 && (
        <div className="mt-5">
          <h2 className="h4 mb-3">También vas a necesitar</h2>
          <GrillaProductos
            productos={relacionados}
            agregadoId={agregadoIdRelacionados}
            onAgregar={manejarAgregarRelacionado}
          />
        </div>
      )}
    </Container>
  );
}
