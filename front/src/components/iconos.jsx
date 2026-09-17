// === FIX UX-05 (auditoría UX/UI 26/08/2026, Media #3) =====================
// Módulo único de íconos SVG inline (Bootstrap Icons, a mano -- mismo
// criterio de siempre en este proyecto: sin sumar una librería de íconos
// nueva). Antes cada pantalla/componente redefinía sus propios íconos
// (function IconoTal(props) {...}) sueltos ahí mismo, y algunos terminaron
// duplicados palabra por palabra en más de un archivo (ej. IconoCarrito
// vivía, con el mismo dibujo, tanto en SiteLayout.jsx como en
// ProductoDetalle.jsx) -- un sistema de íconos fragmentado, sin una sola
// fuente de verdad.
//
// Si el día de mañana hay que agregar un ícono nuevo o ajustar uno
// existente (otro trazo, otro tamaño por defecto), se hace ACÁ, una sola
// vez -- nunca copiando el <svg> de nuevo adentro de una pantalla. Todos
// aceptan `...props` para poder pisar width/height/className/etc. puntual
// en el lugar donde se usan, sin tener que tocar este archivo.
// ============================================================================

export function IconoInicio(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 6.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5ZM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5 5 5Z" />
    </svg>
  );
}

export function IconoGrilla(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5z" />
    </svg>
  );
}

// Antes duplicado palabra por palabra en SiteLayout.jsx Y en
// ProductoDetalle.jsx (bi-cart) -- default 18x18 (como el resto de los
// íconos del sidebar); en ProductoDetalle se usa a 20x20 pasando
// width/height explícitos en el lugar donde se llama.
export function IconoCarrito(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M0 1.5A.5.5 0 0 1 .5 1H2a.5.5 0 0 1 .485.379L2.89 3H14.5a.5.5 0 0 1 .491.592l-1.5 8A.5.5 0 0 1 13 12H4a.5.5 0 0 1-.491-.408L2.01 3.607 1.61 2H.5a.5.5 0 0 1-.5-.5ZM3.102 4l1.313 7h8.17l1.313-7H3.102ZM5 14.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm7 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" />
    </svg>
  );
}

// Estrella siempre rellena (bi-star-fill): ícono de navegación del
// sidebar (opción "Favoritos"), no representa "marcado"/"vacío" como la
// estrella toggle de la ficha de producto -- ver IconoEstrella más abajo,
// que es un ícono distinto (otro trazo, acepta `relleno`).
export function IconoEstrellaSolida(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.283.95l-3.523 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z" />
    </svg>
  );
}

export function IconoHistorial(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0L11 1.293l.646-.647a.5.5 0 0 1 .708 0L13 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647a.5.5 0 0 1 .146.354V15a.5.5 0 0 1-.854.354L14 14.707l-.646.647a.5.5 0 0 1-.708 0L12 14.707l-.646.647a.5.5 0 0 1-.708 0L10 14.707l-.646.647a.5.5 0 0 1-.708 0L8 14.707l-.646.647a.5.5 0 0 1-.708 0L6 14.707l-.646.647a.5.5 0 0 1-.708 0L4 14.707l-.646.647a.5.5 0 0 1-.708 0L2 14.707l-.646.647A.5.5 0 0 1 .5 15V.86a.5.5 0 0 1 .42-.354M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5m0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5m0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5m0 2a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5" />
    </svg>
  );
}

export function IconoTelefono(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.428.35 1.024.052 1.474l-.679 1.02a.678.678 0 0 0 .045.798l.582.577a1 1 0 0 0 .026.03l.622.622c.32.32.66.485.798.045l1.02-.679c.45-.298 1.046-.277 1.474.052l2.306 1.795c.687.535.75 1.542.164 2.31l-.964 1.263c-.573.75-1.514 1.075-2.35.802-1.86-.607-4.114-1.848-6.06-3.793-1.946-1.946-3.187-4.2-3.793-6.06-.273-.836.052-1.777.802-2.35L1.885.511Z" />
    </svg>
  );
}

// Ícono de "Mi perfil" (bi-person-circle), FEATURE 29/08/2026 -- ver
// SiteLayout.jsx: mismo lugar del sidebar donde antes iba siempre
// IconoEngranaje/"Configuración", ahora un cliente ve esto en su lugar.
export function IconoPerfil(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0" />
      <path
        fillRule="evenodd"
        d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1"
      />
    </svg>
  );
}

// Flechas de navegación del carrusel de "recién agregados" del Home (bi-
// chevron-left / bi-chevron-right, FEATURE 29/08/2026, pedido del cliente
// -- ver CarruselProductos.jsx).
export function IconoFlechaIzquierda(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
      />
    </svg>
  );
}

export function IconoFlechaDerecha(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"
      />
    </svg>
  );
}

export function IconoEngranaje(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
    </svg>
  );
}

export function IconoSalir(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 0-1 0v2A1.5 1.5 0 0 0 6.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-8A1.5 1.5 0 0 0 5 3.5v2a.5.5 0 0 0 1 0z"
      />
      <path
        fillRule="evenodd"
        d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z"
      />
    </svg>
  );
}

export function IconoLuna(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z" />
    </svg>
  );
}

export function IconoSol(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.414a.5.5 0 1 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707L4.464 3.757a.5.5 0 0 1 0 .708z" />
    </svg>
  );
}

export function IconoBuscar(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
    </svg>
  );
}

// Ícono de "abrir menú" (bi-list): tres rayitas horizontales.
export function IconoAbrirMenu(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"
      />
    </svg>
  );
}

// Ícono de "cerrar menú" (bi-x-lg).
export function IconoCerrarMenu(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
    </svg>
  );
}

// Íconos de la ficha de producto (ProductoDetalle.jsx).
export function IconoCheck(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={16} height={16} fill="currentColor" {...props}>
      <path d="M13.485 1.929a1 1 0 0 1 .057 1.413l-7.5 8a1 1 0 0 1-1.457.043l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.757 2.757 6.815-7.27a1 1 0 0 1 1.414-.029Z" />
    </svg>
  );
}

export function IconoEscudo(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={18} height={18} fill="currentColor" {...props}>
      <path d="M8 0c-.69 1.5-3 2.5-5.5 2.5C2.5 8 3.5 12.5 8 16c4.5-3.5 5.5-8 5.5-13.5C11 2.5 8.69 1.5 8 0Zm2.485 5.929-3 3.2a.6.6 0 0 1-.874.006L5.05 7.529a.6.6 0 1 1 .874-.823l1.135 1.208 2.552-2.72a.6.6 0 1 1 .874.735Z" />
    </svg>
  );
}

// La estrella de favorito (toggle, ficha de producto): relleno=false es
// solo el contorno (vacía), relleno=true la pinta completa -- el color en
// sí lo pone quien la usa (className="text-primary" cuando ya es
// favorito). Distinta de IconoEstrellaSolida (ícono de navegación,
// siempre rellena, otro trazo) -- no son el mismo ícono aunque el nombre
// se parezca, así que se mantienen como dos exports separados.
export function IconoEstrella({ relleno, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={26}
      height={26}
      fill={relleno ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-4.156-7.416 4.156 1.48-8.279-6.064-5.828 8.332-1.151z" />
    </svg>
  );
}

// Íconos de contacto (Contacto.jsx).
export function IconoWhatsapp(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
    </svg>
  );
}

export function IconoInstagram(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599.28.28.453.546.598.92.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.5 2.5 0 0 1-.598.92c-.28.28-.546.453-.92.598-.282.11-.705.24-1.486.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.5 2.5 0 0 1-.92-.598 2.5 2.5 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233 0-2.136.008-2.388.046-3.231.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92.28-.28.546-.453.92-.598.282-.11.705-.24 1.485-.276.738-.033 1.024-.043 2.515-.045zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92m-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217m0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334z" />
    </svg>
  );
}

// FIX UX-08 (auditoría UX/UI 26/08/2026, Baja #1): íconos de mostrar/ocultar
// contraseña (bi-eye / bi-eye-slash) -- usados en el botón de "ojito" al
// lado de cualquier campo de contraseña (Login.jsx, y de ahí en más
// Register/OlvidePassword/ConfiguracionPrivacidad cuando se agregue el
// mismo toggle).
export function IconoOjo(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
    </svg>
  );
}

export function IconoOjoTachado(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z" />
      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.822.822a2.5 2.5 0 0 0 2.83 2.83z" />
      <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z" />
    </svg>
  );
}

// Ícono placeholder (bi-image) para cuando un producto/categoría no tiene
// imagen cargada, o la imagen no llega a cargar (link roto).
// FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): antes MiniaturaProducto.jsx
// usaba este ícono, mientras que las tablas admin (Productos.jsx,
// Categorias.jsx, ConfiguracionStock.jsx) mostraban el texto "s/f" en su
// lugar -- dos placeholders visualmente distintos para el mismo caso "no
// hay imagen", en miniaturas del mismo tamaño (40x40). Ver Media #4 en
// esos archivos: ahora las tres tablas admin usan este mismo ícono, con
// title="Sin imagen" (tooltip) en vez de texto visible -- a 40x40 no
// entra el texto de forma legible, a diferencia de las tarjetas grandes
// de GrillaProductos.jsx/GrillaCategorias.jsx/ProductoDetalle.jsx (esas sí
// tienen lugar de sobra y siguen mostrando "Sin imagen" como texto).
export function IconoImagen(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
      <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-10zm10 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h10z" />
    </svg>
  );
}

// "+" centrado (bi-plus-lg) -- FEATURE (29/08/2026, pedido del cliente):
// marca del centro de una posición vacía en la grilla de "Marcas
// destacadas" (ver GrillaMarcasDestacadas.jsx). El "X" para eliminar una
// posición ocupada reutiliza IconoCerrarMenu (bi-x-lg, más arriba) -- no
// hace falta un ícono nuevo para eso.
export function IconoMas(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"
      />
    </svg>
  );
}
