import { toast } from "react-toastify";

// === FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3) ============
// Antes cada pantalla tenía su propio <Alert> local para avisar "guardado
// con éxito" / "no se pudo guardar", cada una decidiendo por su cuenta con
// qué variant de Bootstrap pintarlo -- la mayoría usaba variant="success"
// para un éxito, pero MisPedidos.jsx usaba variant="info" para lo mismo,
// así que dos pantallas del mismo sitio mostraban el mismo tipo de mensaje
// con dos colores distintos. Este archivo es el ÚNICO lugar que decide qué
// color/estilo le corresponde a "éxito"/"error"/"info" en toda la app --
// si el día de mañana hay que cambiar el criterio (otro ícono, otra
// duración, otra posición en pantalla), se cambia acá una sola vez y se
// aplica en todos lados.
//
// Uso: importar la función que corresponda y llamarla con el texto, en vez
// de crear un estado local + <Alert> para un mensaje transitorio de
// resultado de una acción (guardar, vincular, activar, etc.). Los errores
// de VALIDACIÓN que el usuario tiene que corregir mientras sigue mirando
// un formulario/modal abierto siguen mostrándose inline (un toast se
// autodestruye solo y el usuario podría perdérselo) -- estas funciones son
// para el resultado de una acción ya terminada, no para guiar mientras se
// completa un formulario.
// ==========================================================================

const OPCIONES_POR_DEFECTO = {
  position: "bottom-right",
  autoClose: 4000,
};

export function notificarExito(mensaje) {
  toast.success(mensaje, OPCIONES_POR_DEFECTO);
}

export function notificarError(mensaje) {
  // Los errores se quedan un poco más en pantalla que un éxito -- son más
  // importantes de llegar a leer.
  toast.error(mensaje, { ...OPCIONES_POR_DEFECTO, autoClose: 6000 });
}

export function notificarInfo(mensaje) {
  toast.info(mensaje, OPCIONES_POR_DEFECTO);
}
