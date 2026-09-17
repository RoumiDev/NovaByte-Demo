import { useEffect, useState } from "react";
import TarjetaProducto from "./TarjetaProducto";

// Carrusel horizontal de productos (FEATURE 29/08/2026, pedido del
// cliente) -- usado en el Home para "recién agregados" en vez de la
// grilla de siempre (ver GrillaProductos.jsx). La tarjeta en sí es la
// misma (TarjetaProducto.jsx) que usa la grilla, así que un producto se ve
// exactamente igual esté en el Home o en Catálogo.
//
// FIX (30/08/2026, pedido del cliente, dos vueltas):
//   1) "sacar el movimiento manual, que se vayan solos, que al llegar al
//      último arranque de nuevo con el primero de forma natural" -- se
//      sacaron las flechas y el arrastre/swipe.
//   2) "lo ideal sería que tenga un movimiento constante" -- la primera
//      versión avanzaba de a una tarjeta entera cada 5s (con pausa entre
//      medio); esta ya no "avanza a saltos": es una animación CSS pura que
//      desliza la pista todo el tiempo a velocidad constante, como una
//      cinta -- no hay índice ni pasos, un producto nunca "salta" al
//      siguiente, se desliza.
//
// Cómo se logra que no se note la vuelta al principio: la pista no tiene
// solo los productos reales -- les sigue una copia idéntica (ver
// listaExtendida más abajo). La animación desliza la pista exactamente el
// ancho de UN set completo de productos reales (--carrusel-desplazamiento,
// calculado según cuántas tarjetas entran por pantalla) y se repite en
// loop (animation-iteration-count: infinite, ver theme.scss) -- como en el
// punto donde termina un ciclo la pista está mostrando el arranque de la
// copia (idéntica a los productos reales desde el principio), el reinicio
// de la animación es invisible: nunca se nota un "salto".
//
// Pausarlo al pasar el mouse o enfocarlo con teclado se mantiene: eso no
// es "moverlo a mano", es solo darle tiempo a quien está mirando/
// interactuando con una tarjeta para que no se encuentre en movimiento
// mientras lee o hace clic (además, sin esto, alguien que llega por
// teclado a una tarjeta tapada por el recorte del carrusel -- overflow:
// hidden -- no tendría forma de que la animación se quede quieta para
// verla).
//
// Cuánto tarda en pasar el ancho de UNA tarjeta -- define la velocidad,
// constante sea cual sea la cantidad de productos o de tarjetas visibles
// por pantalla (ver el cálculo de duración más abajo, que escala con
// ambos para que la VELOCIDAD en pantalla se sienta siempre igual).
const SEGUNDOS_POR_TARJETA = 4;

// Mismos breakpoints que la grilla (Row xs=1 sm=2 md=3 lg=4, ver
// GrillaProductos.jsx) para que la cantidad de tarjetas por pantalla se
// sienta consistente entre el carrusel del Home y el listado de Catálogo.
function calcularTarjetasVisibles() {
  if (typeof window === "undefined") return 4;
  if (window.matchMedia("(min-width: 992px)").matches) return 4;
  if (window.matchMedia("(min-width: 768px)").matches) return 3;
  if (window.matchMedia("(min-width: 576px)").matches) return 2;
  return 1;
}

export default function CarruselProductos({ productos, agregadoId, onAgregar }) {
  const [visibles, setVisibles] = useState(calcularTarjetasVisibles);
  const [pausado, setPausado] = useState(false);

  // Recalcula cuántas tarjetas entran por pantalla si cambia el tamaño de
  // ventana (rotar el celular, achicar la ventana del navegador, etc.).
  useEffect(() => {
    function manejarResize() {
      setVisibles(calcularTarjetasVisibles());
    }
    window.addEventListener("resize", manejarResize);
    return () => window.removeEventListener("resize", manejarResize);
  }, []);

  // Si todos los productos ya entran en pantalla, no hace falta desplazar
  // nada -- se muestran quietos, sin animación ni copia duplicada.
  const hayNavegacion = productos.length > visibles;

  if (productos.length === 0) return null;

  // Copia de los mismos productos a continuación de los reales -- ver el
  // comentario grande más arriba. Sin esto, no habría nada que mostrar
  // después de que la pista termine de deslizar el set real.
  const listaExtendida = hayNavegacion ? [...productos, ...productos] : productos;
  const anchoPorTarjeta = 100 / visibles;

  // Cuánto (en % del ancho de la pista) hay que deslizar para recorrer
  // exactamente UN set completo de productos reales -- ni un pixel más ni
  // menos, para que el punto donde reinicia el loop caiga justo donde la
  // copia es indistinguible del principio real (ver comentario grande).
  const desplazamientoPorcentaje = productos.length * anchoPorTarjeta;
  // Duración proporcional a esa misma distancia: así SEGUNDOS_POR_TARJETA
  // sigue siendo "cuánto tarda en pasar una tarjeta" sin importar cuántos
  // productos haya ni cuántas tarjetas entren por pantalla -- la velocidad
  // en pantalla (no la duración de un ciclo completo) queda constante.
  const duracionS = (productos.length / visibles) * SEGUNDOS_POR_TARJETA;

  return (
    <div
      className="carrusel-productos"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Productos recién agregados"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget)) setPausado(false);
      }}
    >
      <div className="carrusel-productos__viewport">
        <div
          className={`carrusel-productos__pista${hayNavegacion ? " carrusel-productos__pista--animada" : ""}${
            pausado ? " carrusel-productos__pista--pausada" : ""
          }`}
          style={
            hayNavegacion
              ? {
                  "--carrusel-desplazamiento": `${desplazamientoPorcentaje}%`,
                  "--carrusel-duracion": `${duracionS}s`,
                }
              : undefined
          }
        >
          {listaExtendida.map((producto, posicion) => {
            // La segunda mitad de listaExtendida es la copia (ver
            // comentario grande más arriba) -- puramente visual, para que
            // el loop no se note. aria-hidden porque un lector de
            // pantalla no tiene que enterarse de que "existe" un segundo
            // producto idéntico, y enFoco siempre en false para que Tab
            // nunca se meta en una tarjeta que es solo una copia.
            const esCopia = posicion >= productos.length;
            return (
              <div
                key={`${producto.id}-${esCopia ? "copia" : "real"}`}
                className="carrusel-productos__item"
                style={{ flexBasis: `${anchoPorTarjeta}%` }}
                aria-hidden={esCopia || undefined}
              >
                <TarjetaProducto
                  producto={producto}
                  agregadoId={agregadoId}
                  onAgregar={onAgregar}
                  enFoco={!esCopia}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
