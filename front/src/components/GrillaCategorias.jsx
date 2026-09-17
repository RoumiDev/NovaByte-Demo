import { useNavigate } from "react-router-dom";
import { Card, Col, Row } from "react-bootstrap";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js.
import { resolverUrlImagen } from "../utils/imagenes";

// Grilla de tarjetas de categoría: lo que se ve al entrar a /catalogo sin
// ningún filtro todavía (ver Catalogo.jsx) -- primero se elige la
// categoría, después esa pantalla vuelve a renderizarse mostrando los
// productos de esa categoría (GrillaProductos), nunca los dos mezclados.
//
// Reusa la clase .producto-card (theme.scss) a propósito: mismo look de
// tarjeta oscura con brillo naranja al pasar el mouse que ya tienen las
// tarjetas de producto, así el catálogo se siente consistente aunque acá
// no haya precio ni botón.
export default function GrillaCategorias({ categorias }) {
  const navigate = useNavigate();

  function irACategoria(categoriaId) {
    navigate(`/catalogo?categoria=${categoriaId}`);
  }

  return (
    <Row xs={2} sm={3} md={4} lg={5} className="g-3">
      {categorias.map((categoria) => (
        <Col key={categoria.id}>
          <Card
            className="h-100 shadow-sm producto-card text-center"
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => irACategoria(categoria.id)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                irACategoria(categoria.id);
              }
            }}
          >
            <div
              className="d-flex align-items-center justify-content-center p-4 producto-card__contenido"
              style={{ height: 150 }}
            >
              {categoria.imagen_url ? (
                <img
                  src={resolverUrlImagen(categoria.imagen_url)}
                  alt={categoria.nombre}
                  style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
                />
              ) : (
                <span className="text-muted small">Sin imagen</span>
              )}
            </div>
            <Card.Body className="pt-0 pb-3 producto-card__contenido">
              <Card.Title className="h6 text-uppercase mb-0">{categoria.nombre}</Card.Title>
            </Card.Body>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
