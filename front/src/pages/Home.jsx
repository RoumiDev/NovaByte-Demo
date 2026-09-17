import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Container, Spinner } from "react-bootstrap";
import { extraerMensajeError } from "../api/client";
import { listarProductos } from "../api/products";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
// FEATURE (29/08/2026, pedido del cliente): "recién agregados" pasa de
// grilla a carrusel horizontal (autoplay, flechas, swipe/drag táctil) --
// ver CarruselProductos.jsx. Catalogo.jsx sigue usando GrillaProductos tal
// cual (el listado completo con filtros sigue siendo una grilla, no tiene
// sentido como carrusel).
import CarruselProductos from "../components/CarruselProductos";
// FEATURE (29/08/2026, pedido del cliente): franja de "Marcas destacadas"
// debajo del carrusel -- ver FilaMarcasDestacadas.jsx y
// GrillaMarcasDestacadas.jsx (carga admin, Configuración → General).
import FilaMarcasDestacadas from "../components/FilaMarcasDestacadas";

// Cuántos productos mostrar en el Home -- CAMBIAR ACÁ si el día de mañana
// se quiere otra cantidad (p.ej. 8, 10). El backend ya devuelve los
// productos ordenados por "último ingreso" (ver list_products en
// app/router/products.py), así que esto es nada más "cuántos de esos
// traer", no hace falta tocar nada más en el frontend.
const _CANTIDAD_PRODUCTOS_HOME = 5;

// Home ES la vitrina de la tienda: los últimos productos ingresados, sin
// filtro propio -- la barra de filtros que tenía antes (nombre, marca,
// categoría) se sacó porque quedaba duplicada con la búsqueda del sidebar
// (SiteLayout.jsx, manda a /catalogo?nombre=...) y el filtro de
// categoría/marca del mega menú (CatalogoMegaMenu.jsx + Catalogo.jsx).
// Catálogo sigue siendo la página que entiende esos filtros por URL y
// muestra el listado completo. "Último ingreso" no es solo "recién
// creado": un producto que se quedó sin stock y se volvió a cargar
// también cuenta (ver reabastecido_at en app/models/product.py) -- así
// que acá pueden aparecer productos viejos que volvieron a tener stock,
// no solo productos nuevos. El sidebar/navegación ya no se arma acá: lo
// pone SiteLayout.jsx alrededor (ver App.jsx), esta página solo devuelve
// su propio contenido.
export default function Home() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [agregadoId, setAgregadoId] = useState(null);
  const { agregarAlCarrito } = useCart();
  const { estaAutenticado } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    listarProductos({ limit: _CANTIDAD_PRODUCTOS_HOME })
      .then((respuesta) => setProductos(respuesta.data))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }, []);

  function manejarAgregar(producto) {
    // Vitrina pública: cualquiera puede VER el Home sin sesión, pero para
    // agregar al carrito le pedimos loguearse primero (pedido puntual del
    // dueño). Login siempre manda a "/" al terminar, así que quien venía de
    // acá vuelve a este mismo lugar para retomar la compra.
    if (!estaAutenticado) {
      navigate("/login");
      return;
    }
    agregarAlCarrito(producto, 1);
    setAgregadoId(producto.id);
    setTimeout(() => setAgregadoId((actual) => (actual === producto.id ? null : actual)), 1500);
  }

  return (
    <Container className="pb-5 pt-4">
      <h1 className="h3 mb-4">Novedades</h1>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : productos.length === 0 ? (
        <Alert variant="secondary">Todavía no hay productos cargados.</Alert>
      ) : (
        <CarruselProductos productos={productos} agregadoId={agregadoId} onAgregar={manejarAgregar} />
      )}

      {/* FEATURE (29/08/2026, pedido del cliente): independiente del estado
          de carga de productos de arriba -- es otra fuente de datos, y no
          tiene sentido esperar a los productos para mostrar las marcas. */}
      <FilaMarcasDestacadas />
    </Container>
  );
}
