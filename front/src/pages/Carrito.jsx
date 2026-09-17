import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Container, Form, Image, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import { extraerMensajeError } from "../api/client";
import { crearPagoPedido, crearPedido } from "../api/orders";
// FIX UX-A3 (auditoría UX/UI 12/09/2026, Punto Crítico #3 "Alto"): para
// revalidar el stock real de cada producto del carrito al entrar a esta
// pantalla (ver el useEffect "revalidar stock" más abajo) -- mismo endpoint
// público que usa ProductoDetalle.jsx.
import { obtenerProducto } from "../api/products";
import { useCart } from "../context/CartContext";
import { formatearMoneda } from "../utils/formato";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): item.imagenUrl viene tal
// cual de producto.imagen_url (ruta relativa) -- se resuelve acá, al
// mostrarla, en vez de al agregar el producto al carrito (CartContext.jsx),
// para que un carrito guardado en localStorage no quede con una URL
// absoluta pegada al host de cuando se agregó el producto.
import { resolverUrlImagen } from "../utils/imagenes";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): el error de
// "Finalizar compra" no está atado a ningún campo puntual del formulario
// (no hay formulario: es un botón de acción) -- toast en vez de <Alert>
// local. Ver utils/notificaciones.js.
import { notificarError } from "../utils/notificaciones";

export default function Carrito() {
  const { items, actualizarCantidad, actualizarStockDisponible, quitarDelCarrito, totalEstimado } = useCart();
  const [finalizando, setFinalizando] = useState(false);

  // FIX UX-A3: revalida el stock real de cada producto del carrito una
  // sola vez, al entrar a esta pantalla -- antes item.stockDisponible
  // quedaba con el valor que tenía el catálogo en el momento de "Agregar",
  // y el comprador recién se enteraba de que se había quedado sin stock
  // cuando fallaba "Finalizar compra". Pensado originalmente como efecto de
  // una sola pasada: usa los productoId presentes al momento de verificar,
  // no hace falta repetirlo si el carrito cambia después por otro motivo
  // (agregar/quitar/cambiar cantidad ya validan contra el stockDisponible
  // que se acaba de traer acá) -- salvo el botón "Reintentar" de más abajo.
  const [verificandoStock, setVerificandoStock] = useState(true);
  const [avisoStock, setAvisoStock] = useState("");
  // FIX (13/09/2026, auditoría UX/UI Punto Alto #9): antes el .catch de acá
  // abajo trataba CUALQUIER error de obtenerProducto -- 404 real (el
  // producto se dio de baja), pero también un 500, un error de red o un
  // timeout -- exactamente igual: "no encontrado, seguí como si nada". Un
  // error de conexión NO es lo mismo que un 404: no sabemos si el producto
  // sigue teniendo el stock que ya conocíamos o no, y silenciarlo dejaba a
  // veces "Finalizar compra" habilitado sobre datos de stock que en
  // realidad no se pudieron confirmar. Este estado separa ese caso (algo
  // nuestro/de la red que se puede reintentar) del 404 real (dato válido
  // sobre el producto, que create_order va a rechazar solo si corresponde).
  const [errorVerificacion, setErrorVerificacion] = useState(false);
  // Evita pisar el estado si el componente ya se desmontó mientras la
  // verificación (la inicial o un reintento manual) seguía en vuelo --
  // reemplaza al booleano "cancelado" local que tenía el efecto original,
  // ahora que esta lógica se puede disparar más de una vez (botón
  // "Reintentar" más abajo, no solo al montar).
  const montadoRef = useRef(true);
  useEffect(() => {
    // FIX (13/09/2026, reportado probando en local -- servidor de
    // desarrollo con <StrictMode>, ver main.jsx): sin esta línea, el ciclo
    // de montar/desmontar-simulado/volver-a-montar que hace StrictMode en
    // desarrollo (a propósito, para detectar bugs de limpieza de efectos)
    // dejaba montadoRef.current en `false` para siempre -- la limpieza de
    // acá abajo se ejecutaba una vez (en el desmontaje simulado) y nada la
    // volvía a poner en `true` en el remontaje real que sigue. Resultado:
    // verificarStock() de más abajo entraba siempre en el
    // "if (!montadoRef.current) return;" y nunca llegaba a
    // setVerificandoStock(false) -- el botón quedaba trabado en
    // "Verificando disponibilidad..." para siempre. Reseteando acá, cada
    // vez que este efecto vuelve a "montar" (incluido el remontaje
    // simulado de StrictMode) el flag arranca limpio. Es un problema solo
    // de desarrollo -- el build de producción nunca hace ese doble
    // montaje -- pero vale la pena que el código ande bien también en
    // local.
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const verificarStock = useCallback(() => {
    const idsAVerificar = items.map((item) => item.productoId);
    if (idsAVerificar.length === 0) {
      setVerificandoStock(false);
      return;
    }
    setVerificandoStock(true);
    setErrorVerificacion(false);
    Promise.all(
      idsAVerificar.map((productoId) =>
        // FIX Punto Alto #9: timeout acotado -- api/client.js no configura
        // ninguno (ver comentario ahí), así que sin esto una llamada
        // colgada (servidor que no responde ni cae la conexión) nunca
        // resolvía ni rechazaba, Promise.all nunca terminaba, y
        // "verificandoStock" se quedaba en true para siempre: el botón
        // mostraba "Verificando disponibilidad..." bloqueado sin límite de
        // tiempo, sin mensaje y sin forma de salir salvo recargar la
        // página a ciegas. Con el timeout, esa llamada SIEMPRE termina
        // rechazándose sola dentro de este plazo y cae en la misma rama de
        // "error de verificación" que un error de red común.
        obtenerProducto(productoId, { timeout: 12000 })
          .then((respuesta) => ({
            productoId,
            stockReal: respuesta.data.stock,
            encontrado: true,
            error: false,
          }))
          .catch((error) => {
            // 404 real = el producto se dio de baja mientras estaba en el
            // carrito; create_order lo va a rechazar igual al finalizar,
            // así que acá alcanza con no tocar su stockDisponible (no hay
            // un valor "real" que poner) y dejar que ese rechazo, si llega,
            // se explique solo. Cualquier OTRA cosa (error.response
            // ausente = error de red/timeout; 500; etc.) no es lo mismo:
            // se marca error:true para avisar y ofrecer reintentar, en vez
            // de tratarlo en silencio como si el producto no existiera.
            if (error.response?.status === 404) {
              return { productoId, stockReal: null, encontrado: false, error: false };
            }
            return { productoId, stockReal: null, encontrado: false, error: true };
          }),
      ),
    ).then((resultados) => {
      if (!montadoRef.current) {
        return;
      }
      let bajoAlgunoDeStock = false;
      let huboErrorDeVerificacion = false;
      for (const resultado of resultados) {
        if (resultado.error) {
          huboErrorDeVerificacion = true;
          continue;
        }
        if (!resultado.encontrado) {
          continue;
        }
        const item = items.find((i) => i.productoId === resultado.productoId);
        if (item && resultado.stockReal !== item.stockDisponible) {
          if (resultado.stockReal < item.stockDisponible) {
            bajoAlgunoDeStock = true;
          }
          actualizarStockDisponible(resultado.productoId, resultado.stockReal);
        }
      }
      if (bajoAlgunoDeStock) {
        setAvisoStock(
          "Actualizamos la disponibilidad de algunos productos porque cambió desde que los agregaste -- revisá las cantidades antes de continuar.",
        );
      }
      setErrorVerificacion(huboErrorDeVerificacion);
      setVerificandoStock(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, actualizarStockDisponible]);

  useEffect(() => {
    verificarStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const haySinStock = items.some((item) => item.stockDisponible <= 0);

  // FIX (31/08/2026, reportado por el cliente): "Finalizar compra" se
  // quedaba trabado en "Generando pago..." si el comprador iba hasta
  // Mercado Pago y volvía con el botón "atrás" del navegador sin llegar a
  // pagar -- solo se destrababa si de casualidad agregaba otro producto
  // (lo que fuerza un re-render por otro motivo). Causa: la redirección de
  // más abajo (window.location.href = pago.data.init_point) saca al
  // comprador de esta página con "finalizando" ya en true, y el resto de
  // la función nunca termina de correr para volver a ponerlo en false
  // -- la navegación corta la ejecución ahí mismo. Muchos navegadores no
  // recargan la página al volver con "atrás": la restauran tal cual
  // estaba en memoria (back-forward cache / bfcache), con ese "true"
  // todavía pegado. "pageshow" con persisted=true es la señal estándar de
  // que la página se restauró desde bfcache en vez de cargarse de cero,
  // así que ahí es donde corresponde soltar el botón.
  useEffect(() => {
    function manejarPageShow(evento) {
      if (evento.persisted) {
        setFinalizando(false);
      }
    }
    window.addEventListener("pageshow", manejarPageShow);
    return () => window.removeEventListener("pageshow", manejarPageShow);
  }, []);

  async function manejarFinalizarCompra() {
    setFinalizando(true);
    try {
      const detalles = items.map((item) => ({ producto_id: item.productoId, cantidad: item.cantidad }));
      const pedido = await crearPedido({ detalles });
      // A propósito NO se vacía el carrito acá: si el comprador vuelve
      // atrás desde Mercado Pago sin terminar de pagar (por ejemplo,
      // porque se acordó de otro producto que se quería llevar), tiene que
      // encontrar el carrito tal cual lo dejó, no vacío -- si no, tendría
      // que volver a elegir todo de cero. El carrito recién se vacía
      // cuando el pago se confirma como exitoso (ver ResultadoPago.jsx).
      //
      // Ojo con esto: si vuelve y aprieta "Finalizar compra" de nuevo sin
      // sacar nada del carrito, se crea un pedido nuevo con los mismos
      // productos (el anterior sigue "pendiente" aparte, reservando su
      // propio stock) -- el job de reconciliación automática
      // (app/jobs/reconciliacion_pagos.py) cancela solo, a los 5 minutos,
      // cualquiera de los dos que termine sin pagarse.
      const pago = await crearPagoPedido(pedido.data.id);
      // Redirección de página completa a propósito (no es navegación
      // interna de React Router): init_point es la página de pago real de
      // Mercado Pago, fuera de esta app.
      window.location.href = pago.data.init_point;
    } catch (err) {
      notificarError(extraerMensajeError(err));
      setFinalizando(false);
    }
  }

  if (items.length === 0) {
    return (
      <Container className="pb-5 pt-4">
        <h1 className="h3 mb-4">Carrito</h1>
        <Alert variant="secondary">
          Todavía no agregaste ningún producto.{" "}
          <Alert.Link as={Link} to="/catalogo">
            Ir al catálogo
          </Alert.Link>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="pb-5 pt-4">
      <h1 className="h3 mb-4">Carrito</h1>

      {avisoStock && (
        <Alert variant="warning" onClose={() => setAvisoStock("")} dismissible>
          {avisoStock}
        </Alert>
      )}

      {/* FIX (13/09/2026, auditoría UX/UI Punto Alto #9): antes un error de
          red/timeout al verificar el stock se tragaba en silencio (ver el
          .catch de verificarStock más arriba) -- este aviso es justamente
          para el caso contrario: no pudimos confirmar, no sabemos si el
          stock mostrado es el real, y se lo decimos al comprador en vez de
          dejarlo avanzar (o bloqueado sin explicación) sobre datos sin
          confirmar. */}
      {errorVerificacion && (
        <Alert variant="danger">
          No pudimos confirmar la disponibilidad de algunos productos del carrito -- puede deberse a un
          problema de conexión.{" "}
          <Alert.Link as="button" type="button" onClick={verificarStock}>
            Reintentar
          </Alert.Link>
        </Alert>
      )}

      <Table striped bordered hover responsive align="middle">
        <thead>
          <tr>
            <th></th>
            <th>Producto</th>
            {/* FIX (31/08/2026, reportado por el cliente): "el campo
                subtotal se va expandiendo" -- ni Precio unitario ni
                Subtotal tenían un ancho fijo (a diferencia de Cantidad,
                que sí), así que la columna crecía/encogía según cuántos
                dígitos tuviera el monto formateado en cada fila (ej.
                "$7.000,00" vs "$70.000,00" al subir la cantidad),
                corriendo el resto de la tabla en cada cambio. Mismo ancho
                fijo que ya tenía Cantidad, más tabular-nums para que los
                números de una misma columna se alineen entre sí. */}
            <th style={{ width: 140 }} className="text-nowrap">
              Precio unitario
            </th>
            <th style={{ width: 140 }}>Cantidad</th>
            <th style={{ width: 140 }} className="text-nowrap">
              Subtotal
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <FilaCarrito
              key={item.productoId}
              item={item}
              actualizarCantidad={actualizarCantidad}
              quitarDelCarrito={quitarDelCarrito}
            />
          ))}
        </tbody>
      </Table>

      <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mt-4">
        <div>
          <div className="text-muted small">
            Total estimado
          </div>
          <div className="h4 mb-0">{formatearMoneda(totalEstimado)}</div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" as={Link} to="/catalogo">
            Seguir comprando
          </Button>
          <Button
            variant="primary"
            disabled={finalizando || verificandoStock || haySinStock}
            title={haySinStock ? "Quitá del carrito los productos sin stock para poder continuar." : undefined}
            onClick={manejarFinalizarCompra}
          >
            {finalizando
              ? "Generando pago..."
              : verificandoStock
                ? "Verificando disponibilidad..."
                : "Finalizar compra"}
          </Button>
        </div>
      </div>
    </Container>
  );
}

// Una fila de la tabla, con su propio campo de cantidad -- separado del
// componente principal para que ese campo pueda tener su propio estado de
// texto (ver más abajo) sin repetirlo a mano por cada item.
function FilaCarrito({ item, actualizarCantidad, quitarDelCarrito }) {
  // FIX (31/08/2026, reportado por el cliente): "si quiero comprar 2 no me
  // deja borrar el 1 -- escribo 2 y pasa a 12". El <Form.Control type=
  // "number"> antes estaba controlado directo por item.cantidad, y cada
  // tecla llamaba a actualizarCantidad -- que clampea con Math.max(1,
  // ...). Al borrar el "1" con Backspace, el campo quedaba vacío un
  // instante pero el clamp lo devolvía a "1" antes de que se notara
  // ningún cambio visual, así que el Backspace no parecía hacer nada; al
  // tipear "2" a continuación, el navegador lo insertaba sobre el "1" que
  // seguía ahí, dando "12" en vez de "2".
  //
  // Ahora el campo tiene su propio estado de texto libre (textoCantidad):
  // se puede vaciar y volver a tipear sin que nada lo pise mientras se
  // está editando (editandoRef). Solo se sincroniza con el valor real del
  // carrito (item.cantidad) cuando el campo NO tiene el foco -- típicamente
  // porque se acaba de confirmar un valor válido (ver manejarCambio) o
  // porque el carrito cambió por otro lado mientras tanto.
  const [textoCantidad, setTextoCantidad] = useState(String(item.cantidad));
  const editandoRef = useRef(false);

  useEffect(() => {
    if (!editandoRef.current) {
      setTextoCantidad(String(item.cantidad));
    }
  }, [item.cantidad]);

  function manejarCambio(evento) {
    const texto = evento.target.value;
    setTextoCantidad(texto);
    // Solo empuja el cambio al carrito (y recalcula el subtotal) cuando ya
    // es un número entero completo -- mientras el campo está vacío (por
    // ejemplo, justo después de borrar todo para tipear una cantidad
    // nueva) todavía no hay nada válido que confirmar, y no hace falta
    // forzar ningún valor por defecto como antes.
    if (/^\d+$/.test(texto)) {
      actualizarCantidad(item.productoId, Number(texto));
    }
  }

  function manejarFoco() {
    editandoRef.current = true;
  }

  function manejarBlur(evento) {
    editandoRef.current = false;
    // Al salir del campo, mostrar siempre la cantidad real ya confirmada
    // del carrito -- cubre tanto "quedó vacío/inválido" (se descarta lo
    // tipeado) como "se tipeó más que el stock disponible" (queda
    // clampeada al stock, ver actualizarCantidad en CartContext.jsx).
    setTextoCantidad(String(item.cantidad));
    evento.target.value = String(item.cantidad);
  }

  function manejarTecla(evento) {
    // Enter confirma y saca el foco, igual que Tab -- dispara manejarBlur.
    if (evento.key === "Enter") {
      evento.currentTarget.blur();
    }
  }

  return (
    <tr>
      <td style={{ width: 64 }}>
        {item.imagenUrl ? (
          <Image
            src={resolverUrlImagen(item.imagenUrl)}
            alt={item.nombre}
            width={48}
            height={48}
            style={{ objectFit: "cover" }}
            rounded
          />
        ) : (
          <div
            className="bg-light text-muted d-flex align-items-center justify-content-center"
            style={{ width: 48, height: 48 }}
          >
            -
          </div>
        )}
      </td>
      <td>
        <div className="fw-semibold">{item.nombre}</div>
        <div className="text-muted small">{item.marca}</div>
      </td>
      <td className="text-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatearMoneda(item.precioUnitario)}
      </td>
      <td>
        {/* FIX UX-A3: item.stockDisponible en 0 es la señal de
            actualizarStockDisponible (CartContext.jsx) de que este producto
            se quedó sin stock desde que se agregó -- acá se bloquea el
            campo de cantidad y se avisa en rojo en vez de dejar un input
            con max={0} que confunde más de lo que aclara. */}
        {item.stockDisponible <= 0 ? (
          <div className="text-danger small fw-semibold">Sin stock -- quitalo para continuar</div>
        ) : (
          <>
            <Form.Control
              type="number"
              min={1}
              max={item.stockDisponible}
              value={textoCantidad}
              onChange={manejarCambio}
              onFocus={manejarFoco}
              onBlur={manejarBlur}
              onKeyDown={manejarTecla}
            />
            <div className="text-muted small mt-1">{item.stockDisponible} disponibles</div>
          </>
        )}
      </td>
      <td className="text-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatearMoneda(item.precioUnitario * item.cantidad)}
      </td>
      <td>
        <Button variant="outline-danger" size="sm" onClick={() => quitarDelCarrito(item.productoId)}>
          Quitar
        </Button>
      </td>
    </tr>
  );
}
