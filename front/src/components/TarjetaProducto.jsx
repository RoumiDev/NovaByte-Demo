import { useNavigate } from "react-router-dom";
import { Badge, Button, Card } from "react-bootstrap";
import { IconoMarca } from "./Marca";
import { useAuth } from "../context/AuthContext";
import { formatearMoneda } from "../utils/formato";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js.
import { resolverUrlImagen } from "../utils/imagenes";

// Tarjeta de un producto individual -- extraída de GrillaProductos.jsx
// (FEATURE 29/08/2026, pedido del cliente: carrusel de "recién agregados"
// en el Home, ver CarruselProductos.jsx) para que la grilla y el carrusel
// compartan EXACTAMENTE el mismo render de tarjeta, en vez de tener dos
// copias del mismo <Card> que se puedan desincronizar con el tiempo.
// GrillaProductos.jsx sigue siendo la que arma la disposición en grilla
// (Row/Col); esta de acá es solo la tarjeta en sí, sin opinión sobre cómo
// se acomoda alrededor.
//
// Estilo alineado a la referencia "Tech Direct" del cliente: tarjeta
// oscura con el isotipo de marca como marca de agua, nombre en mayúsculas,
// precio grande y botón en forma de pastilla.
//
// `enFoco` (default true, uso normal en la grilla): el carrusel lo pone en
// false para las tarjetas que quedan fuera de la parte visible (recortadas
// por overflow:hidden, ver .carrusel-productos__viewport en theme.scss) --
// así el teclado (Tab) no se mete en una tarjeta que no se ve, y un lector
// de pantalla tampoco la anuncia como si estuviera a la vista.
export default function TarjetaProducto({ producto, agregadoId, onAgregar, enFoco = true }) {
  const navigate = useNavigate();
  const { estaAutenticado } = useAuth();

  // stopPropagation: la tarjeta entera navega al detalle del producto (ver
  // onClick más abajo), así que estos dos botones no pueden dejar que su
  // propio clic se propague hasta ahí.
  function manejarClicAgregar(evento) {
    evento.stopPropagation();
    onAgregar(producto);
  }

  // También suma el producto (onAgregar, la misma función que "Agregar al
  // carrito") antes de navegar -- así "Ir al carrito" no es solo un atajo
  // de navegación, deja el producto cargado para que en /carrito ya
  // aparezca sin tener que volver.
  function manejarClicCarrito(evento) {
    evento.stopPropagation();
    onAgregar(producto);
    navigate("/carrito");
  }

  return (
    <Card
      className="h-100 shadow-sm producto-card"
      role="button"
      tabIndex={enFoco ? 0 : -1}
      aria-hidden={!enFoco}
      style={{ cursor: "pointer" }}
      onClick={() => navigate(`/productos/${producto.id}`)}
      onKeyDown={(evento) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          navigate(`/productos/${producto.id}`);
        }
      }}
    >
      <IconoMarca
        aria-hidden="true"
        className="producto-card__marca-agua"
        style={{ width: 110, height: 110, right: -22, bottom: 46 }}
      />
      <div
        className="d-flex align-items-center justify-content-center p-3 producto-card__contenido"
        style={{ height: 170 }}
      >
        {producto.imagen_url ? (
          <img
            src={resolverUrlImagen(producto.imagen_url)}
            alt={producto.nombre}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          <span className="text-muted small">Sin imagen</span>
        )}
      </div>
      <Card.Body className="d-flex flex-column pt-0 producto-card__contenido">
        {/* line-clamp a 2 líneas + minHeight reservando ese mismo
            espacio: sin esto, un título corto (1 línea) y uno largo
            (2 líneas) dejaban el precio/stock/botón de cada tarjeta
            a distinta altura dentro de la misma fila. */}
        <Card.Title
          className="h6 text-uppercase"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "2.4em",
          }}
        >
          {producto.nombre}
        </Card.Title>
        <Card.Subtitle className="text-uppercase text-muted small mb-2 text-truncate">
          {producto.categoria?.nombre ?? producto.marca}
        </Card.Subtitle>
        <div className="fs-4 fw-bold mb-1">{formatearMoneda(producto.precio_venta)}</div>
        {producto.stock === 0 ? (
          <Badge bg="secondary" className="mb-3 align-self-start">
            Sin stock
          </Badge>
        ) : (
          <div className="text-muted small mb-3">{producto.stock} disponibles</div>
        )}
        <Button
          variant={agregadoId === producto.id ? "success" : "dark"}
          className="mt-auto rounded-pill text-uppercase fw-semibold btn-agregar-carrito"
          disabled={producto.stock === 0}
          tabIndex={enFoco ? 0 : -1}
          onClick={manejarClicAgregar}
        >
          {agregadoId === producto.id ? "Agregado ✓" : "Agregar al carrito"}
        </Button>
        {/* Solo con sesión iniciada -- sin login "Agregar al carrito" ya
            manda a /login (ver Home.jsx/Catalogo.jsx), así que no tiene
            sentido ofrecer un atajo al carrito todavía. Sin mt-auto (a
            diferencia del botón de arriba): tiene que quedar pegado
            inmediatamente debajo, no empujado él solo al fondo de la
            tarjeta. */}
        {estaAutenticado && (
          <Button
            variant="outline-secondary"
            className="mt-2 rounded-pill text-uppercase fw-semibold"
            disabled={producto.stock === 0}
            tabIndex={enFoco ? 0 : -1}
            onClick={manejarClicCarrito}
          >
            Ir al carrito
          </Button>
        )}
      </Card.Body>
    </Card>
  );
}
