// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación, repetido en 6 pantallas"). Antes,
// Catalogo.jsx/admin/Usuarios.jsx/admin/Productos.jsx/admin/Categorias.jsx/
// ConfiguracionStock.jsx/ConfiguracionRelacionados.jsx pedían un único
// limit:100 y se quedaban con eso -- el registro 101 en adelante
// simplemente no existía para esa pantalla, sin ningún error ni aviso (el
// backend acepta como máximo 100 por pedido, ver Limit en
// app/core/pagination.py, así que tampoco alcanzaba con subir el número).
//
// Esta utilidad es para las listas de REFERENCIA (categorías para un
// <select>, el catálogo completo del selector de "Productos relacionados",
// las marcas para un filtro) que necesitan estar completas en memoria para
// funcionar -- no para tablas de gestión grandes, que tienen su propia
// paginación real con controles "Anterior"/"Siguiente" (ver
// ControlesPaginacion.jsx y usePaginaOffset más abajo en este archivo).
export async function traerTodasLasPaginas(funcionListado, paramsBase = {}) {
  const TAMANO_PAGINA = 100; // el máximo que el backend acepta por pedido
  // Salvaguarda: nunca más de 50 pedidos encadenados (5000 registros). Si
  // algún catálogo llega a ese tamaño, esa lista puntual necesita su propia
  // paginación real, no esta utilidad de "traer todo".
  const TOPE_PEDIDOS = 50;

  let skip = 0;
  let todos = [];
  for (let i = 0; i < TOPE_PEDIDOS; i++) {
    const respuesta = await funcionListado({ ...paramsBase, skip, limit: TAMANO_PAGINA });
    todos = todos.concat(respuesta.data);
    if (respuesta.data.length < TAMANO_PAGINA) {
      break;
    }
    skip += TAMANO_PAGINA;
  }
  return todos;
}
