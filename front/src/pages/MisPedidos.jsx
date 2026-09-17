import { useEffect, useState } from "react";
import { Alert, Badge, Button, Container, Modal, Spinner, Table } from "react-bootstrap";
import { extraerMensajeError } from "../api/client";
import { crearPagoPedido, listarMisPedidos, verificarPagoPedido } from "../api/orders";
import MiniaturaProducto from "../components/MiniaturaProducto";
import { formatearFecha, formatearMoneda } from "../utils/formato";
// === FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3) ===========
// Esta pantalla era justo el ejemplo que encontró la auditoría de la
// inconsistencia de colores: el aviso de "verificar pago" usaba
// variant="info" SIEMPRE, incluso cuando el resultado era un éxito real
// (pago encontrado) -- mientras que el resto de la app usa variant=
// "success" para lo mismo. Ahora, en vez de un <Alert> local, se usa
// notificarExito para el caso de éxito y notificarInfo para el caso
// neutro ("todavía no encontramos un pago") -- ver utils/notificaciones.js.
// ==========================================================================
import { notificarError, notificarExito, notificarInfo } from "../utils/notificaciones";

const _COLOR_POR_ESTADO = {
  pendiente: "warning",
  pagado: "success",
  enviado: "info",
  cancelado: "secondary",
};

// Texto de la columna "Pedido": el nombre del producto en vez del número
// de pedido pelado. Con más de un producto distinto en el mismo pedido,
// muestra el primero y cuenta el resto ("... y 2 más") en vez de listarlos
// todos y romper el ancho de la tabla.
function nombreProductos(pedido) {
  const nombres = pedido.detalles.map((detalle) => detalle.producto.nombre);
  if (nombres.length <= 1) return nombres[0] || "Producto eliminado";
  return `${nombres[0]} y ${nombres.length - 1} más`;
}

export default function MisPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pagandoId, setPagandoId] = useState(null);
  const [verificandoId, setVerificandoId] = useState(null);
  // Pedido que se está mostrando en el modal de detalle (null = cerrado).
  // La columna "Pedido" resume a un solo producto ("... y 2 más") para no
  // romper el ancho de la tabla -- este modal es donde el comprador ve la
  // lista completa de lo que compró en ese pedido.
  const [pedidoAbierto, setPedidoAbierto] = useState(null);

  function cargar() {
    setCargando(true);
    setError("");
    listarMisPedidos()
      .then((respuesta) => setPedidos(respuesta.data))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  async function manejarPagar(pedido) {
    setPagandoId(pedido.id);
    try {
      const pago = await crearPagoPedido(pedido.id);
      window.location.href = pago.data.init_point;
    } catch (err) {
      notificarError(extraerMensajeError(err));
      setPagandoId(null);
    }
  }

  // Consulta directo a Mercado Pago si este pedido "pendiente" en realidad
  // ya se pagó -- red de seguridad para cuando el webhook nunca llegó (por
  // ejemplo, el túnel de desarrollo estaba caído en el momento del pago).
  async function manejarVerificar(pedido) {
    setVerificandoId(pedido.id);
    try {
      const respuesta = await verificarPagoPedido(pedido.id);
      if (respuesta.data.estado === "pagado") {
        setPedidos((actuales) => actuales.map((p) => (p.id === pedido.id ? respuesta.data : p)));
        // FIX UX-03: esto SÍ es un éxito real -- antes se mostraba con el
        // mismo variant="info" que el caso "todavía no encontramos nada".
        notificarExito(`Pedido #${pedido.id}: encontramos el pago, ya figura como pagado.`);
      } else {
        // Este caso es genuinamente neutro (ni éxito ni error, "seguí
        // esperando") -- notificarInfo, no notificarExito.
        notificarInfo(`Pedido #${pedido.id}: todavía no encontramos un pago aprobado en Mercado Pago.`);
      }
    } catch (err) {
      notificarError(extraerMensajeError(err));
    } finally {
      setVerificandoId(null);
    }
  }

  return (
    <Container className="pb-5 pt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Historial</h1>
        <Button variant="outline-secondary" size="sm" onClick={cargar}>
          Actualizar
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : pedidos.length === 0 ? (
        <Alert variant="secondary">Todavía no hiciste ningún pedido.</Alert>
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Fecha</th>
              <th>Productos</th>
              <th>Total</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((pedido) => (
              <tr key={pedido.id}>
                <td>{nombreProductos(pedido)}</td>
                <td title={new Date(pedido.created_at).toLocaleString()}>{formatearFecha(pedido.created_at)}</td>
                <td>{pedido.detalles.reduce((total, d) => total + d.cantidad, 0)} u.</td>
                <td>{formatearMoneda(pedido.total_pedido)}</td>
                <td>
                  <Badge bg={_COLOR_POR_ESTADO[pedido.estado] || "secondary"}>{pedido.estado}</Badge>
                </td>
                <td className="d-flex gap-2">
                  <Button size="sm" variant="outline-secondary" onClick={() => setPedidoAbierto(pedido)}>
                    Ver detalle
                  </Button>
                  {pedido.estado === "pendiente" && (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={pagandoId === pedido.id}
                        onClick={() => manejarPagar(pedido)}
                      >
                        {pagandoId === pedido.id ? "Generando..." : "Pagar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={verificandoId === pedido.id}
                        onClick={() => manejarVerificar(pedido)}
                        title="¿Ya pagaste pero acá sigue figurando pendiente? Consultá directo a Mercado Pago."
                      >
                        {verificandoId === pedido.id ? "Verificando..." : "Ya pagué, verificar"}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
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
    </Container>
  );
}
