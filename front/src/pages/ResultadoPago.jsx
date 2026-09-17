import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Col, Container, Row, Spinner } from "react-bootstrap";
import { verificarPagoPedido } from "../api/orders";
import { getTokens } from "../api/tokenStore";
import { useCart } from "../context/CartContext";

// Una sola pantalla reutilizada por las tres rutas de vuelta de Mercado
// Pago (éxito/error/pendiente) -- cambia solo el texto e ícono según el
// resultado. El texto de _CONTENIDO es el fallback -- lo que se ve si no
// se puede confirmar nada más. Apenas se monta, si hay un external_reference
// en la URL (el id del pedido, lo agrega Mercado Pago solo) se llama a
// verificar-pago para confirmar el estado real contra Mercado Pago en el
// momento, sin esperar al webhook ni al job de reconciliación automática
// (ver app/jobs/reconciliacion_pagos.py) -- así el comprador ve "pagado" ya
// mismo al volver, no en 5 minutos. El botón sigue mandando a "Mis
// pedidos" porque esa es la fuente de verdad definitiva pase lo que pase acá.
const _CONTENIDO = {
  exito: {
    titulo: "¡Pago realizado!",
    variante: "success",
    mensaje: "Tu pago se procesó correctamente. Podés confirmar el estado del pedido en \"Mis pedidos\".",
  },
  error: {
    titulo: "El pago no se completó",
    variante: "danger",
    mensaje: "Algo falló o cancelaste el pago. Tu pedido sigue pendiente, podés reintentarlo desde \"Mis pedidos\".",
  },
  pendiente: {
    titulo: "Pago pendiente",
    variante: "warning",
    mensaje: "Mercado Pago todavía está procesando el pago (por ejemplo, pago en efectivo). Revisá \"Mis pedidos\" en unos minutos.",
  },
};

// Reintentos cortos: si el comprador llega acá, Mercado Pago ya le mostró
// su propia pantalla de "pago aprobado" antes de que tocara "Volver al
// sitio" -- el pago casi seguro ya está aprobado del lado de Mercado Pago.
// Estos reintentos son solo colchón para una demora momentánea de
// propagación en la API de Mercado Pago, no para esperar algo que todavía
// no pasó.
const _REINTENTOS = 3;
const _ESPERA_ENTRE_REINTENTOS_MS = 2000;

export default function ResultadoPago({ resultado }) {
  const [searchParams] = useSearchParams();
  const [verificando, setVerificando] = useState(false);
  const [confirmadoPagado, setConfirmadoPagado] = useState(false);
  const { vaciarCarrito } = useCart();

  // El carrito se vacía acá, no al crear el pedido (ver Carrito.jsx): recién
  // ahora, llegando a la pantalla de éxito, sabemos que la compra se
  // completó de verdad. Si el comprador hubiera vuelto atrás desde
  // Mercado Pago sin pagar, nunca llega a este componente con
  // resultado="exito", así que el carrito sigue intacto para él.
  useEffect(() => {
    if (resultado === "exito") {
      vaciarCarrito();
    }
    // Vaciar el carrito no depende de nada que cambie después del montaje
    // -- correrlo una sola vez alcanza, no hace falta repetirlo si
    // resultado (que viene fijo por ruta, ver App.jsx) no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado]);

  useEffect(() => {
    // Si Mercado Pago mandó al comprador a "error", no hay un pago
    // aprobado que buscar -- no tiene sentido verificar nada.
    if (resultado === "error") return;

    const pedidoId = searchParams.get("external_reference");
    if (!pedidoId) return;

    // Si la sesión expiró durante el pago (por eso esta ruta es pública,
    // ver App.jsx), no hay token para llamar a un endpoint autenticado. Se
    // deja la pantalla genérica: el pedido igual se va a reconciliar solo
    // con el job automático, o el comprador lo confirma al volver a
    // loguearse y entrar a "Mis pedidos".
    if (!getTokens()?.access_token) return;

    let cancelado = false;

    async function verificar() {
      setVerificando(true);
      for (let intento = 0; intento < _REINTENTOS && !cancelado; intento++) {
        try {
          const respuesta = await verificarPagoPedido(pedidoId);
          if (respuesta.data.estado === "pagado") {
            if (!cancelado) setConfirmadoPagado(true);
            return;
          }
        } catch {
          // 401 (sesión que expiró justo ahora), 404 (pedido de otra
          // cuenta) u otro error transitorio: no hay más que hacer acá, el
          // comprador siempre puede confirmar desde "Mis pedidos".
          return;
        }
        if (intento < _REINTENTOS - 1) {
          await new Promise((resolve) => setTimeout(resolve, _ESPERA_ENTRE_REINTENTOS_MS));
        }
      }
    }

    verificar().finally(() => {
      if (!cancelado) setVerificando(false);
    });

    return () => {
      cancelado = true;
    };
  }, [resultado, searchParams]);

  const contenido = _CONTENIDO[resultado];

  return (
    <Container className="pantalla-centrada">
      <Row className="justify-content-center w-100">
        <Col xs={12} sm={10} md={7} lg={5}>
          <Card className={`shadow-sm text-center border-${confirmadoPagado ? "success" : contenido.variante}`}>
            <Card.Body className="p-4">
              <h1 className="h3">{confirmadoPagado ? "¡Pago confirmado!" : contenido.titulo}</h1>
              {verificando ? (
                <p className="d-flex align-items-center justify-content-center gap-2 text-muted">
                  <Spinner animation="border" size="sm" /> Confirmando el pago con Mercado Pago...
                </p>
              ) : (
                <p>
                  {confirmadoPagado
                    ? "Ya lo verificamos: tu pedido figura como pagado."
                    : contenido.mensaje}
                </p>
              )}
              <Button as={Link} to="/mis-pedidos" variant="primary" className="w-100">
                Ver mis pedidos
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
