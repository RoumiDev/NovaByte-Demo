import { useEffect, useState } from "react";
import { Alert, Badge, Button, Modal, Spinner, Table } from "react-bootstrap";
import { extraerMensajeError } from "../../api/client";
import { listarTodosLosPedidos } from "../../api/orders";
import MiniaturaProducto from "../../components/MiniaturaProducto";
import { formatearFecha, formatearMoneda } from "../../utils/formato";

const _COLOR_POR_ESTADO = {
  pendiente: "warning",
  pagado: "success",
  enviado: "info",
  cancelado: "secondary",
};

// Tiene que coincidir con el "limit" que se manda en listarTodosLosPedidos:
// 50 pedidos por página, traídos con LIMIT/OFFSET en la base (GET
// /pedidos/todos) -- nunca se trae la tabla completa de una.
const _TAMANIO_PAGINA = 50;

// Producto "principal" de un pedido para la columna Productos: el primero
// de la lista de detalles, más cuántos artículos distintos hay además de
// ese (no la suma de cantidades -- eso ya lo mostraba la columna vieja y
// obligaba a adivinar qué se compró).
function productoPrincipal(pedido) {
  const [primero, ...resto] = pedido.detalles;
  if (!primero) {
    return { nombre: "Producto eliminado", imagen: null, extra: 0 };
  }
  return {
    nombre: primero.producto?.nombre ?? "Producto eliminado",
    imagen: primero.producto?.imagen_url ?? null,
    extra: resto.length,
  };
}

// Pedidos de TODOS los usuarios -- a diferencia de "Mis pedidos" (que cada
// comprador ve sobre sí mismo), esta pantalla la ve el panel admin
// (admin y ayudante, ver RutaStaff/App.jsx). Por ahora es de solo lectura:
// el rol "ayudante" hoy solo puede VER pedidos, no cambiarles el estado
// (eso sigue siendo PATCH /pedidos/{id}/estado, protegido con
// require_admin) -- si más adelante se decide que un ayudante también
// pueda actualizar estados, acá es donde habría que agregar esos controles.
export default function Pedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [total, setTotal] = useState(0);
  // Página actual, base 0. Se traduce a "skip" (pagina * _TAMANIO_PAGINA)
  // al pedir los datos -- el recorte de 50 en 50 lo hace la base con
  // OFFSET/LIMIT, acá solo se guarda en qué página está parado el admin.
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Pedido que se está mostrando en el modal de detalle (null = cerrado).
  // Se abre desde el botón "Ver detalle" (columna Estado) o, si hay más de
  // un artículo, también desde el badge "+N artículos" (columna Productos,
  // que solo muestra el primero para no romper el ancho de la tabla) --
  // los dos llevan al mismo modal con la lista completa de lo que compró.
  const [pedidoAbierto, setPedidoAbierto] = useState(null);

  function cargar() {
    setCargando(true);
    setError("");
    listarTodosLosPedidos({ skip: pagina * _TAMANIO_PAGINA, limit: _TAMANIO_PAGINA })
      .then((respuesta) => {
        setPedidos(respuesta.data.items);
        setTotal(respuesta.data.total);
      })
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }

  // Se vuelve a pedir cada vez que cambia de página, no solo al montar.
  useEffect(cargar, [pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / _TAMANIO_PAGINA));

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Pedidos</h1>
        <Button variant="outline-secondary" size="sm" onClick={cargar}>
          Actualizar
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : pedidos.length === 0 ? (
        <Alert variant="secondary">Todavía no hay pedidos cargados.</Alert>
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Productos</th>
              <th>Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((pedido) => {
              const { nombre, imagen, extra } = productoPrincipal(pedido);
              return (
                <tr key={pedido.id}>
                  <td>#{pedido.id}</td>
                  <td title={new Date(pedido.created_at).toLocaleString()}>{formatearFecha(pedido.created_at)}</td>
                  <td>
                    <div>{pedido.usuario.razon_social}</div>
                    <div className="text-muted small">{pedido.usuario.email}</div>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <MiniaturaProducto url={imagen} alt={nombre} />
                      <div className="text-truncate" style={{ maxWidth: 200 }}>
                        <div className="text-truncate">{nombre}</div>
                        {extra > 0 && (
                          <Badge
                            bg="primary"
                            pill
                            role="button"
                            style={{ cursor: "pointer" }}
                            onClick={() => setPedidoAbierto(pedido)}
                          >
                            +{extra} artículo{extra > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{formatearMoneda(pedido.total_pedido)}</td>
                  <td>
                    <div className="d-flex flex-column align-items-start gap-1">
                      <Badge bg={_COLOR_POR_ESTADO[pedido.estado] || "secondary"}>{pedido.estado}</Badge>
                      <Button variant="outline-secondary" size="sm" onClick={() => setPedidoAbierto(pedido)}>
                        Ver detalle
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {!cargando && total > 0 && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={pagina === 0}
            onClick={() => setPagina((actual) => actual - 1)}
          >
            Anterior
          </Button>
          <span className="text-muted small">
            Página {pagina + 1} de {totalPaginas} ({total} pedido{total !== 1 ? "s" : ""})
          </span>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={pagina + 1 >= totalPaginas}
            onClick={() => setPagina((actual) => actual + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      <Modal show={pedidoAbierto !== null} onHide={() => setPedidoAbierto(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h5">Pedido #{pedidoAbierto?.id}</Modal.Title>
        </Modal.Header>
        {pedidoAbierto && (
          <Modal.Body>
            <div className="d-flex flex-column gap-3 mb-3">
              {pedidoAbierto.detalles.map((detalle) => (
                <div key={detalle.id} className="d-flex align-items-center gap-2">
                  <MiniaturaProducto url={detalle.producto?.imagen_url} alt={detalle.producto?.nombre} size={48} />
                  <div className="flex-grow-1">
                    <div>{detalle.producto?.nombre ?? "Producto eliminado"}</div>
                    <div className="text-muted small">
                      {detalle.cantidad} u. × {formatearMoneda(detalle.precio_unitario)}
                    </div>
                  </div>
                  <div className="fw-semibold">{formatearMoneda(detalle.subtotal)}</div>
                </div>
              ))}
            </div>
            <div className="d-flex justify-content-between align-items-center border-top pt-3">
              <span className="text-muted">Total</span>
              <span className="h5 mb-0">{formatearMoneda(pedidoAbierto.total_pedido)}</span>
            </div>
          </Modal.Body>
        )}
      </Modal>
    </div>
  );
}
