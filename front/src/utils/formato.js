// Formato de moneda para toda la app (pesos argentinos). Centralizado acá
// para no repetir "$" + Number(x).toFixed(2) en cada página -- ese patrón
// no agrega separador de miles y usa "." como separador decimal en vez de
// ",", así que "$200000.00" quedaba sin separador de miles y con el punto
// y la coma invertidos respecto a la convención argentina.
const formateadorMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  // Siempre dos decimales (250.000,00), no solo cuando el precio los tiene.
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatea un precio como moneda argentina, ya con el símbolo "$" incluido. */
export function formatearMoneda(valor) {
  return formateadorMoneda.format(Number(valor) || 0);
}

// Formato de fecha pensado para minimizar la carga cognitiva: un
// "20/8/2026, 08:00:58" obliga a hacer la cuenta mental de cuánto hace que
// fue. En cambio: relativa si es reciente ("Hace 2 horas", donde el dato
// que importa es "hace cuánto"), fecha corta si ya pasó bastante tiempo
// ("20 Ago, 2026", donde lo que importa es la fecha en sí, no la hora
// exacta).
const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Formatea una fecha/hora ISO como texto relativo (reciente) o corto (antiguo). */
export function formatearFecha(valor) {
  const fecha = new Date(valor);
  const diferenciaMs = Date.now() - fecha.getTime();

  if (diferenciaMs < MINUTO_MS) {
    return "Hace instantes";
  }
  if (diferenciaMs < HORA_MS) {
    const minutos = Math.floor(diferenciaMs / MINUTO_MS);
    return `Hace ${minutos} minuto${minutos === 1 ? "" : "s"}`;
  }
  if (diferenciaMs < DIA_MS) {
    const horas = Math.floor(diferenciaMs / HORA_MS);
    return `Hace ${horas} hora${horas === 1 ? "" : "s"}`;
  }
  if (diferenciaMs < 7 * DIA_MS) {
    const dias = Math.floor(diferenciaMs / DIA_MS);
    return `Hace ${dias} día${dias === 1 ? "" : "s"}`;
  }
  return `${fecha.getDate()} ${MESES_CORTOS[fecha.getMonth()]}, ${fecha.getFullYear()}`;
}
