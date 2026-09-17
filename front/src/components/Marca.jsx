// Logo/isotipo de la marca: las dos flechas ">>" naranjas, el mismo
// trazo que public/favicon.ico (generado a partir de la referencia visual
// que pasó el cliente). Vive como SVG inline -- así se puede reusar en
// cualquier tamaño/color sin depender de un archivo de imagen aparte
// (Login, Register, navbar, lo que haga falta más adelante).
// Nota: son dos trazos en V (stroke, no relleno con muesca) con unión en
// punta ("miter") -- así el vértice queda realmente puntiagudo, como en
// la referencia del cliente. Un polígono relleno con una muesca angosta
// terminaba viéndose más romo. El mismo trazo se usa para regenerar
// public/favicon.ico (ver el script que lo generó), para que el isotipo
// sea idéntico en todos lados.
export function IconoMarca(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 66 66" fill="none" {...props}>
      <path d="M0,0 L32,28 L0,56" stroke="currentColor" strokeWidth="9" strokeLinecap="butt" strokeLinejoin="miter" />
      <path d="M24,0 L56,28 L24,56" stroke="currentColor" strokeWidth="9" strokeLinecap="butt" strokeLinejoin="miter" />
    </svg>
  );
}

// Isotipo + texto "LT Informática" (mismo patrón de dos tonos que la
// referencia "TECH DIRECT": primera palabra en un tono neutro, segunda en
// el naranja de marca). `size` controla el alto del ícono en px.
export default function Marca({ size = 56, className = "" }) {
  return (
    <div className={`d-flex flex-column align-items-center ${className}`}>
      <IconoMarca style={{ width: size, height: size }} className="text-primary logo-brillo mb-2" />
      <span className="fs-4 fw-semibold">
        <span className="text-body">Nova</span><span className="text-primary">Byte</span>
      </span>
    </div>
  );
}
