import { Col, Row } from "react-bootstrap";
import TarjetaProducto from "./TarjetaProducto";

// Grilla de tarjetas de producto. Usada por Catalogo.jsx (listado
// completo, con filtros) y, hasta el carrusel del Home (FEATURE
// 29/08/2026, ver CarruselProductos.jsx), también por Home.jsx.
//
// La tarjeta en sí vive en TarjetaProducto.jsx -- acá solo se arma la
// disposición en grilla (Row/Col) para que Catálogo y el carrusel del Home
// compartan EXACTAMENTE el mismo render de tarjeta, en vez de tener dos
// copias que se puedan desincronizar.
export default function GrillaProductos({ productos, agregadoId, onAgregar }) {
  return (
    <Row xs={1} sm={2} md={3} lg={4} className="g-4">
      {productos.map((producto) => (
        <Col key={producto.id}>
          <TarjetaProducto producto={producto} agregadoId={agregadoId} onAgregar={onAgregar} />
        </Col>
      ))}
    </Row>
  );
}
