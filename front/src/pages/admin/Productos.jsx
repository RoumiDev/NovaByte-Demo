import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Form, Image, InputGroup, Modal, Spinner, Table } from "react-bootstrap";
import { listarCategorias } from "../../api/categories";
import { extraerMensajeError } from "../../api/client";
// FEATURE (13/09/2026, pedido del cliente): "agregar la función de poder
// ingresar tanto en pesos ARS como en USD" en el campo Costo -- para poder
// mostrar una vista previa útil del precio final (ver
// _calcularDesgloseCostoUtilidad más abajo) hace falta la cotización del
// dólar vigente. Mismo endpoint público que ya usa el resto del sitio
// (SiteNavbar, Contacto, etc. -- ver api/store.js), de sola lectura, sin
// sesión de admin.
import { obtenerConfiguracionTienda } from "../../api/store";
import {
  actualizarProducto,
  crearProducto,
  darDeBajaProducto,
  listarTodosLosProductos,
  reactivarProducto,
  subirImagenProducto,
} from "../../api/products";
import { formatearMoneda } from "../../utils/formato";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): imagen_url ahora es una
// ruta relativa, no una URL completa -- ver utils/imagenes.js. Pasa tal
// cual las blob: (vista previa de un archivo recién elegido, no tocarlas)
// y las URL absolutas viejas.
import { resolverUrlImagen } from "../../utils/imagenes";
// FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): placeholder de "sin
// imagen" unificado con MiniaturaProducto.jsx (mismo tamaño de miniatura,
// 40x40) -- ver components/iconos.jsx.
import { IconoImagen } from "../../components/iconos";
// FEATURE (27/08/2026, pedido del cliente): "cuando se quiera confirmar un
// cambio o dar de baja... pida la contraseña del admin" -- modal
// compartido con Categorias.jsx, ver ese archivo.
import ModalConfirmarPassword from "../../components/ModalConfirmarPassword";
// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación") -- ver TAMANO_PAGINA/cargarDatos más abajo.
import ControlesPaginacion from "../../components/ControlesPaginacion";
import { traerTodasLasPaginas } from "../../utils/paginacion";
// FIX UX-03 (auditoría UX/UI 26/08/2026, Punto Crítico #3): confirmación de
// éxito de guardar/dar de baja como toast -- ver utils/notificaciones.js. El
// error de guardar sigue inline (errorModal, más abajo): el modal se queda
// abierto para corregir, así que conviene que el motivo quede a la vista
// ahí mismo en vez de en un toast que se puede perder. Mismo criterio para
// el error de la contraseña de confirmación (FEATURE 27/08/2026, ver
// ModalConfirmarPassword) -- ese error queda inline en ESE modal, no acá.
import { notificarExito } from "../../utils/notificaciones";

// Mismos límites que valida app/router/products.py (subir_imagen_producto)
// -- esto es solo para avisar antes de subir, el backend vuelve a
// verificarlo igual y es la última palabra.
const _MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const _TIPOS_IMAGEN_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];

// Mismo valor por default que tenía la constante fija en
// ConfiguracionStock.jsx antes de que este campo existiera -- así un alta
// nueva arranca con el mismo comportamiento de siempre salvo que el admin
// lo cambie a mano.
const _STOCK_MINIMO_POR_DEFECTO = "5";

// FIX (13/09/2026, reportado por el cliente -- "el coeficiente que pongo en
// 1 se transforma en 1 mil"): NO era un bug de datos ni de cálculo -- el
// admin veía "1,0000" en el campo Coeficiente (backend/base guardan y leen
// exactamente 1 en todos los casos, verificado a mano) y lo confundió con
// "1000" por dos motivos que se suman: (a) es el único campo del formulario
// con 4 decimales en vez de 2, y (b) el <input type="number"> lo muestra con
// COMA como separador decimal (configuración regional de Windows/Chrome del
// cliente), al revés de lo que muestra el resto de la app (formatearMoneda,
// utils/formato.js, usa PUNTO como separador de miles) -- "1,0000" a simple
// vista se confunde con un número grande. Esta función recorta los ceros
// decimales que no aportan nada ("1.0000" -> "1", "1.5000" -> "1.5") SOLO
// para poblar el campo al abrir la edición (ver abrirEdicion más abajo) --
// no toca en absoluto el valor que se guarda (manejarGuardar sigue mandando
// Number(form.coeficiente), da exactamente lo mismo con o sin los ceros de
// más).
function _recortarCerosDecimales(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? String(numero) : valor;
}

// FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
// coeficiente" -- segunda forma de cargar el precio de un producto,
// alternativa a la ya existente (moneda_carga/precio_carga, "directo").
// Redondea a 2 decimales igual que ROUND() en Postgres (ver los
// column_property de app/models/product.py) -- se suma Number.EPSILON
// antes de redondear para no perder centavos por errores de punto
// flotante binario (ej. 1.005 * 100 puede dar 100.49999999999999).
function _redondear2(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Recalcula en el navegador, en vivo, la MISMA cadena de cálculo que arma
 * el backend (costo neto -> utilidad -> precio sin IVA -> IVA -> precio
 * final) para el modo de precio "costo_utilidad" -- ver el comentario
 * grande junto a Producto.modo_precio en app/models/product.py para el
 * detalle completo de la fórmula, y los ejemplos numéricos que el cliente
 * dio (que esta misma cuenta reproduce). Es SOLO para que el admin vea el
 * resultado mientras tipea, sin ida y vuelta al servidor -- el precio que
 * de verdad se guarda y se le cobra al cliente siempre lo calcula el
 * backend (ver ProductoAdminRead.precio_venta_sin_iva/iva_monto/etc.).
 * Devuelve null si falta algún dato o hay algo inválido (en vez de mostrar
 * NaN o un resultado sin sentido mientras el admin todavía está tipeando).
 */
function _calcularDesgloseCostoUtilidad({
  costo,
  monedaCarga,
  cotizacionDolar,
  coeficiente,
  costoIncluyeIva,
  ivaPorcentaje,
  utilidadPorcentaje,
}) {
  if (![costo, coeficiente, ivaPorcentaje, utilidadPorcentaje].every((valor) => Number.isFinite(valor)) || coeficiente <= 0) {
    return null;
  }
  // FIX (13/09/2026, pedido del cliente -- "agregar la función de poder
  // ingresar tanto en pesos ARS como en USD, y que después el sistema
  // haga la cuenta para que al cliente le figure en pesos argentinos"):
  // costo entra convertido a pesos ACÁ, antes de arrancar el resto de la
  // cadena -- mismo orden que _costo_en_ars_expr del lado del backend
  // (ver app/models/product.py). Si la moneda elegida es USD pero todavía
  // no se pudo traer la cotización vigente (falló el pedido a
  // /configuracion/, o no terminó todavía), no hay forma de armar una
  // vista previa correcta -- se devuelve null, igual que cuando falta
  // cualquier otro dato, en vez de mostrar una cuenta mal hecha.
  if (monedaCarga === "USD" && !(Number.isFinite(cotizacionDolar) && cotizacionDolar > 0)) {
    return null;
  }
  const costoEnArs = monedaCarga === "ARS" ? costo : costo * cotizacionDolar;
  const costoPorUnidad = costoEnArs / coeficiente;
  const costoNeto = _redondear2(costoIncluyeIva ? costoPorUnidad / (1 + ivaPorcentaje / 100) : costoPorUnidad);
  const utilidadImporte = _redondear2((costoNeto * utilidadPorcentaje) / 100);
  const precioVentaSinIva = costoNeto + utilidadImporte;
  const ivaMonto = _redondear2((precioVentaSinIva * ivaPorcentaje) / 100);
  const precioFinal = precioVentaSinIva + ivaMonto;
  return { costoNeto, utilidadImporte, precioVentaSinIva, ivaMonto, precioFinal };
}

// FEATURE (27/08/2026, pedido del cliente): barra de filtros de la tabla --
// mismo criterio de "estado" que _ESTADOS_STOCK en ConfiguracionStock.jsx,
// pero acá es dado de alta/baja (is_active), no crítico de stock.
const _ESTADOS_PRODUCTO = [
  { valor: "todos", etiqueta: "Todos los estados" },
  { valor: "activos", etiqueta: "Dados de alta" },
  { valor: "baja", etiqueta: "Dados de baja" },
];

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): antes esta pantalla
// pedía listarTodosLosProductos({ limit: 100 }) una sola vez y filtraba
// nombre/marca/categoría/estado en memoria -- pasado los 100 productos,
// ninguno de esos filtros veía a los que quedaban afuera de esa primera
// tanda, en silencio. TAMANO_PAGINA chico (20, mismo default que ya usa el
// backend, ver Limit en app/core/pagination.py) + paginación real + los
// cuatro filtros movidos al backend (ver list_all_products en
// app/router/products.py) -- todos siguen funcionando sobre el catálogo
// COMPLETO, no solo la página visible.
const TAMANO_PAGINA = 20;

const FORM_VACIO = {
  nombre: "",
  marca: "",
  descripcion: "",
  // FEATURE (09/09/2026, pedido del cliente): "elegir pesos o dólares al
  // cargar" -- el admin elige la moneda en la que carga ESTE producto.
  // 'ARS': precio final, con IVA incluido, fijo (no cambia con la
  // cotización). 'USD': precio SIN IVA -- el backend le suma el IVA
  // configurado y lo convierte a pesos con la cotización vigente. El
  // precio en pesos que ve el cliente (producto.precio_venta) lo calcula
  // siempre el backend -- ver ProductoRead en app/schemas/product.py. Ya
  // no es un campo editable acá en ninguno de los dos casos.
  moneda_carga: "USD",
  precio_carga: "",
  // FEATURE (09/09/2026, pedido del cliente): "el IVA varía por producto"
  // -- el dueño aclaró que 21% (general) o 10,5% (reducido) varían de un
  // producto a otro, así que este campo se carga acá, por producto, no en
  // Configuración → General. Solo se usa (y solo se muestra el campo, ver
  // más abajo) cuando moneda_carga === "USD" -- en ARS el precio final ya
  // viene con el IVA que corresponda incluido. Default "21" (alícuota
  // general), mismo criterio que ProductoBase.iva_porcentaje en
  // app/schemas/product.py.
  iva_porcentaje: "21",
  // FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
  // coeficiente" -- segunda forma de cargar el precio, alternativa a
  // moneda_carga/precio_carga de acá arriba ("directo"). modo_precio
  // decide cuál de las dos se usa; arranca en "directo" para que un alta
  // nueva se comporte exactamente igual que antes de que existiera este
  // modo, salvo que el admin lo cambie a mano. coeficiente default "1":
  // compra y venta en la misma unidad, el caso más común (ver el
  // comentario en Producto.coeficiente, app/models/product.py).
  modo_precio: "directo",
  costo: "",
  costo_incluye_iva: "false",
  utilidad_porcentaje: "",
  coeficiente: "1",
  stock: "",
  stock_minimo: _STOCK_MINIMO_POR_DEFECTO,
  garantia: "",
  imagen_url: "",
  categoria_id: "",
};

export default function Productos() {
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  // FEATURE (13/09/2026, pedido del cliente): "agregar la función de poder
  // ingresar tanto en pesos ARS como en USD" en el campo Costo -- ver el
  // useEffect que la carga, más abajo, y _calcularDesgloseCostoUtilidad
  // más arriba en este archivo (quien realmente la usa). null hasta que
  // termine el fetch (o si falló): mientras tanto, la vista previa en
  // pesos de un Costo cargado en USD simplemente no se muestra.
  const [cotizacionDolar, setCotizacionDolar] = useState(null);
  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): ya no se deriva de
  // "productos" (ver el comentario grande junto a marcasDisponibles, más
  // abajo) -- productos ahora es solo la página actual.
  const [marcasDisponibles, setMarcasDisponibles] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(0);
  const [haySiguiente, setHaySiguiente] = useState(false);

  const [mostrarModal, setMostrarModal] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errorModal, setErrorModal] = useState("");
  const [guardando, setGuardando] = useState(false);
  // FEATURE (11/09/2026, pedido del cliente): formulario en dos "páginas"
  // dentro del mismo modal -- 1: datos generales (nombre, marca, categoría,
  // descripción, stock, garantía, imagen). 2: precio de carga e IVA, aparte
  // porque es la parte más delicada de cargar (afecta directo lo que paga
  // el cliente). Se resetea a 1 cada vez que se abre el modal (abrirNuevo/
  // abrirEdicion) -- ver esas funciones más abajo.
  const [paso, setPaso] = useState(1);

  // Imagen: se maneja aparte del resto del form porque no viaja como texto.
  // imagenArchivo es el File elegido (si el admin subió uno nuevo en esta
  // edición); imagenPreviewUrl es lo que se muestra en pantalla -- la
  // imagen ya guardada del producto, o una vista previa local del archivo
  // recién elegido (todavía no subido a ningún lado).
  const [imagenArchivo, setImagenArchivo] = useState(null);
  const [imagenPreviewUrl, setImagenPreviewUrl] = useState("");
  // Se incrementa cada vez que se limpia la imagen (nuevo/edición/"Quitar
  // foto") y se usa como key del <input type="file"> de más abajo: es la
  // única forma de vaciar ese input desde código -- no admite value="" a
  // mano por seguridad del navegador -- forzando a React a recrearlo desde
  // cero en vez de reusar el que ya tenía un archivo elegido.
  const [imagenInputKey, setImagenInputKey] = useState(0);

  // FEATURE (27/08/2026, pedido del cliente): confirmación con contraseña
  // antes de aplicar una edición -- payloadPendiente guarda el payload ya
  // armado (imagen subida, campos validados) esperando esa confirmación;
  // se manda recién cuando ModalConfirmarPassword resuelve (ver
  // confirmarEdicion más abajo). Dar de alta un producto nuevo NO pasa por
  // acá -- el cliente pidió esto para "confirmar un cambio", no para el alta.
  const [mostrarConfirmarEdicion, setMostrarConfirmarEdicion] = useState(false);
  const [payloadPendiente, setPayloadPendiente] = useState(null);
  // Mismo patrón para "Dar de baja" -- reemplaza el window.confirm() que
  // había antes (ver manejarBaja más abajo): guarda el producto a dar de
  // baja mientras se pide la contraseña.
  const [productoConfirmarBaja, setProductoConfirmarBaja] = useState(null);
  // FEATURE (27/08/2026, pedido del cliente): mismo patrón, para "Dar de
  // alta" (ver manejarAlta/confirmarAlta más abajo) -- el botón que
  // reemplaza a "Dar de baja" en un producto ya desactivado.
  const [productoConfirmarAlta, setProductoConfirmarAlta] = useState(null);

  // FEATURE (27/08/2026, pedido del cliente): barra de filtros -- los
  // cuatro se combinan (AND).
  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): ya NO se aplican en
  // memoria -- viajan al backend (ver cargarProductos más abajo) para
  // seguir funcionando sobre todo el catálogo con paginación real.
  // filtroMarca/filtroCategoriaId arrancan en "" ("todas"), filtroEstado en
  // "todos" -- ver _ESTADOS_PRODUCTO. filtroNombreAplicado es
  // filtroNombre con un debounce de 300ms (ver el useEffect de acá abajo),
  // para no disparar un pedido por cada tecla.
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroNombreAplicado, setFiltroNombreAplicado] = useState("");
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroCategoriaId, setFiltroCategoriaId] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  useEffect(() => {
    const id = setTimeout(() => setFiltroNombreAplicado(filtroNombre.trim()), 300);
    return () => clearTimeout(id);
  }, [filtroNombre]);

  // Cualquier cambio de filtro vuelve a la página 0 -- un filtro nuevo no
  // tiene por qué tener tantos resultados como para seguir en la página en
  // la que se estaba.
  useEffect(() => {
    setPagina(0);
  }, [filtroNombreAplicado, filtroMarca, filtroCategoriaId, filtroEstado]);

  // Trae la página actual de productos, con los cuatro filtros ya
  // resueltos en el backend (ver list_all_products en
  // app/router/products.py). Pide un elemento de más (TAMANO_PAGINA + 1)
  // para saber si hay página siguiente sin depender de un total que el
  // backend no devuelve -- ver el comentario grande junto a
  // ControlesPaginacion.jsx.
  // FIX (13/09/2026, auditoría QA/Seguridad -- condición de carrera): mismo
  // motivo que Usuarios.jsx -- con debounce + paginación + 4 filtros
  // combinados, pueden quedar varios pedidos en vuelo a la vez; idPedidoRef
  // descarta cualquier respuesta que ya no sea la del último pedido hecho.
  const idPedidoRef = useRef(0);

  async function cargarProductos() {
    const idPedido = ++idPedidoRef.current;
    setCargando(true);
    setError("");
    try {
      // FEATURE (27/08/2026, pedido del cliente): listarTodosLosProductos
      // (admin-only, GET /productos/todos) en vez de listarProductos
      // (público, solo activos) -- así el panel puede mostrar también los
      // productos dados de baja con su botón "Dar de alta" en vez de que
      // desaparezcan de la lista apenas se desactivan.
      const respuesta = await listarTodosLosProductos({
        skip: pagina * TAMANO_PAGINA,
        limit: TAMANO_PAGINA + 1,
        categoriaId: filtroCategoriaId || undefined,
        nombre: filtroNombreAplicado || undefined,
        marca: filtroMarca || undefined,
        activo: filtroEstado === "activos" ? true : filtroEstado === "baja" ? false : undefined,
      });
      if (idPedido !== idPedidoRef.current) return;
      setHaySiguiente(respuesta.data.length > TAMANO_PAGINA);
      setProductos(respuesta.data.slice(0, TAMANO_PAGINA));
    } catch (err) {
      if (idPedido !== idPedidoRef.current) return;
      setError(extraerMensajeError(err));
    } finally {
      if (idPedido === idPedidoRef.current) setCargando(false);
    }
  }

  useEffect(() => {
    cargarProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, filtroCategoriaId, filtroNombreAplicado, filtroMarca, filtroEstado]);

  // Si un producto cambia de estado (dar de baja/dar de alta) mientras el
  // filtro de estado está en "Dados de alta" o "Dados de baja", ese
  // producto puede dejar de matchear el filtro y desaparecer de la página
  // actual -- si era el único de la última página, queda vacía con
  // "Anterior" todavía disponible. Mismo criterio que admin/Categorias.jsx:
  // se retrocede sola una página en vez de mostrar una tabla vacía. No
  // aplica en la página 0: ahí una tabla vacía es un estado legítimo.
  useEffect(() => {
    if (!cargando && productos.length === 0 && pagina > 0) {
      setPagina((p) => p - 1);
    }
  }, [cargando, productos.length, pagina]);

  // Categorías (dropdown del filtro Y del formulario de alta/edición) y
  // marcas (dropdown del filtro) son listas de REFERENCIA -- necesitan
  // estar COMPLETAS para que el <select> y el filtro sirvan, así que se
  // traen aparte de "productos" (que ahora es solo la página actual) con
  // traerTodasLasPaginas (ver utils/paginacion.js), encadenando pedidos de
  // a 100 hasta tener todo. Se recargan solo al montar y después de un
  // alta/edición/baja/alta (ver cargarDatos más abajo) -- no en cada
  // cambio de filtro ni de página, que sería re-pedir el catálogo entero
  // sin necesidad.
  async function cargarReferencias() {
    try {
      const [todosLosProductos, todasLasCategorias] = await Promise.all([
        traerTodasLasPaginas(listarTodosLosProductos),
        traerTodasLasPaginas(listarCategorias),
      ]);
      // FEATURE (27/08/2026, pedido del cliente): marcas para el <select>
      // del filtro -- "todas las marcas registradas en la app" (activas e
      // inactivas), a diferencia de listarMarcas (GET /productos/marcas)
      // que es público y solo devuelve marcas de productos activos.
      setMarcasDisponibles(
        [...new Set(todosLosProductos.map((producto) => producto.marca))].sort((a, b) => a.localeCompare(b)),
      );
      setCategorias(todasLasCategorias);
    } catch (err) {
      setError(extraerMensajeError(err));
    }
  }

  useEffect(() => {
    cargarReferencias();
  }, []);

  // FEATURE (13/09/2026, pedido del cliente): "agregar la función de poder
  // ingresar tanto en pesos ARS como en USD" en el campo Costo -- se trae
  // UNA sola vez al montar la pantalla (no hace falta más seguido: si el
  // dueño actualiza la cotización mientras el admin tiene este formulario
  // abierto, la vista previa queda con el valor de recién, algo menor,
  // pero el precio que de verdad se guarda y se le cobra al cliente
  // siempre lo recalcula el backend con la cotización del momento del
  // guardado -- ver el comentario grande junto a _calcularDesgloseCostoUtilidad
  // más arriba). Falla en silencio (deja cotizacionDolar en null): no es
  // motivo para romper toda la pantalla de Productos, solo hace que la
  // vista previa en pesos de "Costo" en USD no se pueda mostrar (ver el
  // chequeo en _calcularDesgloseCostoUtilidad).
  useEffect(() => {
    let montado = true;
    obtenerConfiguracionTienda()
      .then((respuesta) => {
        if (montado) {
          setCotizacionDolar(Number(respuesta.data.cotizacion_dolar));
        }
      })
      .catch(() => {
        // silencioso a propósito, ver comentario de arriba.
      });
    return () => {
      montado = false;
    };
  }, []);

  // Recarga tanto la página actual de productos como las referencias
  // (categorías/marcas) -- se llama después de crear/editar/dar de baja/dar
  // de alta un producto, porque cualquiera de esos cambios puede haber
  // introducido una marca o categoría nueva, además de cambiar la fila en
  // sí. Reemplaza al viejo cargarDatos() de una sola pieza.
  async function cargarDatos() {
    await Promise.all([cargarProductos(), cargarReferencias()]);
  }

  // Libera la URL de vista previa generada localmente (createObjectURL) al
  // reemplazarla o desmontar -- si no, cada archivo elegido queda en
  // memoria hasta cerrar la pestaña.
  useEffect(() => {
    return () => {
      if (imagenPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagenPreviewUrl);
      }
    };
  }, [imagenPreviewUrl]);

  function abrirNuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setImagenArchivo(null);
    setImagenPreviewUrl("");
    setImagenInputKey((prev) => prev + 1);
    setErrorModal("");
    setPaso(1);
    setMostrarModal(true);
  }

  function abrirEdicion(producto) {
    setEditandoId(producto.id);
    setForm({
      nombre: producto.nombre,
      marca: producto.marca,
      descripcion: producto.descripcion || "",
      // FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad +
      // coeficiente" -- un producto ya cargado siempre tiene modo_precio
      // (NOT NULL en la base, default "directo" para los productos de
      // antes de esta migración), pero SOLO tiene costo/costo_incluye_iva/
      // utilidad_porcentaje/coeficiente si nació (o se editó) en modo
      // "costo_utilidad" -- en modo "directo" esos cuatro quedan en NULL
      // (ver _normalizar_campos_segun_modo_precio, app/router/products.py),
      // así que acá se completan con valores por defecto razonables para
      // que el formulario tenga algo coherente para mostrar si el admin
      // cambia de modo sin haber tocado nada más.
      modo_precio: producto.modo_precio || "directo",
      // FIX (13/09/2026, pedido del cliente -- "agregar la función de
      // poder ingresar tanto en pesos ARS como en USD" en Costo):
      // moneda_carga pasó a ser compartida entre los dos modos (ver el
      // comentario grande junto a Producto.moneda_carga, app/models/
      // product.py) -- el backend ya la manda siempre completa para
      // cualquier producto (la migración b4f1c2e0a973 backfilleó a 'ARS'
      // los que eran costo_utilidad de antes de esta fecha), este "|| USD"
      // queda solo como resguardo defensivo, no debería dispararse nunca.
      moneda_carga: producto.moneda_carga || "USD",
      precio_carga: producto.precio_carga != null ? String(producto.precio_carga) : "",
      iva_porcentaje: String(producto.iva_porcentaje),
      costo: producto.costo != null ? String(producto.costo) : "",
      costo_incluye_iva: producto.costo_incluye_iva != null ? String(producto.costo_incluye_iva) : "false",
      utilidad_porcentaje: producto.utilidad_porcentaje != null ? String(producto.utilidad_porcentaje) : "",
      // FIX (13/09/2026): _recortarCerosDecimales evita mostrar "1,0000" en
      // vez de "1" -- ver el comentario grande junto a esa función, más
      // arriba en este archivo.
      coeficiente: producto.coeficiente != null ? _recortarCerosDecimales(producto.coeficiente) : "1",
      stock: String(producto.stock),
      // producto.stock_minimo ?? ... por si el producto es de antes de esta
      // migración y todavía no se recargó desde el backend con el default.
      stock_minimo: String(producto.stock_minimo ?? _STOCK_MINIMO_POR_DEFECTO),
      garantia: producto.garantia || "",
      imagen_url: producto.imagen_url || "",
      categoria_id: String(producto.categoria_id),
    });
    setImagenArchivo(null);
    setImagenPreviewUrl(producto.imagen_url || "");
    setImagenInputKey((prev) => prev + 1);
    setErrorModal("");
    setPaso(1);
    setMostrarModal(true);
  }

  // "Quitar foto": limpia el archivo elegido, la vista previa y
  // form.imagen_url -- así, al guardar, el producto queda sin imagen
  // (imagenUrl termina en null, ver manejarGuardar) sin tener que elegir
  // un archivo nuevo para reemplazarla. Sirve tanto para sacarle la foto a
  // un producto que ya tenía una (edición) como para arrepentirse de un
  // archivo recién elegido antes de guardar (alta o edición).
  function manejarQuitarImagen() {
    setImagenArchivo(null);
    setImagenPreviewUrl("");
    setForm((prev) => ({ ...prev, imagen_url: "" }));
    setImagenInputKey((prev) => prev + 1);
  }

  function actualizarCampo(campo) {
    return (event) => setForm((prev) => ({ ...prev, [campo]: event.target.value }));
  }

  // FEATURE (13/09/2026, pedido del cliente): "agregar la función de poder
  // ingresar tanto en pesos ARS como en USD" en el campo Costo -- a partir
  // de esta fecha moneda_carga es un campo COMPARTIDO entre los dos modos
  // de precio (ver el comentario grande junto a Producto.moneda_carga,
  // app/models/product.py), así que el selector "Forma de cargar el
  // precio" ya NO usa el actualizarCampo genérico de arriba: cambiar de
  // modo sigue sin borrar nada de lo que el admin ya tipeó en el otro
  // juego de campos (mismo criterio de siempre, ver el comentario junto a
  // los radios más abajo), PERO la primera vez que se entra a "Costo + IVA
  // + utilidad" en un producto NUEVO (no al editar uno existente) con
  // moneda_carga todavía en el default sin tocar ("USD", heredado del modo
  // "directo"), se la sugiere en "ARS" -- hasta esta fecha "Costo" siempre
  // se cargó en pesos, así que es lo que un admin espera ver acá de
  // entrada, sin tener que pensarlo. Si el admin ya la había cambiado a
  // mano (a "ARS" o de vuelta a "USD" a propósito), esta función no la
  // vuelve a tocar.
  function manejarCambioModoPrecio(event) {
    const nuevoModo = event.target.value;
    setForm((prev) => {
      const debeSugerirArs =
        nuevoModo === "costo_utilidad" &&
        editandoId === null &&
        prev.modo_precio === "directo" &&
        prev.moneda_carga === "USD";
      return {
        ...prev,
        modo_precio: nuevoModo,
        moneda_carga: debeSugerirArs ? "ARS" : prev.moneda_carga,
      };
    });
  }

  function manejarSeleccionImagen(event) {
    const archivo = event.target.files?.[0];
    if (!archivo) {
      return;
    }

    if (!_TIPOS_IMAGEN_PERMITIDOS.includes(archivo.type)) {
      setErrorModal("La imagen tiene que ser JPG, PNG o WEBP.");
      event.target.value = "";
      return;
    }
    if (archivo.size > _MAX_IMAGEN_BYTES) {
      setErrorModal("La imagen no puede superar los 5MB.");
      event.target.value = "";
      return;
    }

    setErrorModal("");
    setImagenArchivo(archivo);
    setImagenPreviewUrl(URL.createObjectURL(archivo));
  }

  // FEATURE (11/09/2026, pedido del cliente): valida a mano los campos de
  // la página 1 antes de dejar pasar a la página 2 -- el botón "Siguiente"
  // (Modal.Footer) es type="button", no dispara la validación nativa del
  // <Form> como haría un submit real, así que sin esto se podía avanzar a
  // la página 2 con, por ejemplo, el nombre vacío. El submit real (con la
  // validación nativa del navegador para los campos de precio/IVA) sigue
  // pasando en manejarGuardar, más abajo, recién en la página 2.
  function manejarSiguiente() {
    setErrorModal("");
    if (!form.nombre.trim()) {
      setErrorModal("Completá el nombre.");
      return;
    }
    if (!form.marca.trim()) {
      setErrorModal("Completá la marca.");
      return;
    }
    if (!form.categoria_id) {
      setErrorModal("Elegí una categoría.");
      return;
    }
    if (!editandoId && !form.stock) {
      setErrorModal("Completá el stock inicial.");
      return;
    }
    if (!form.stock_minimo) {
      setErrorModal("Completá el mínimo para \"Stock crítico\".");
      return;
    }
    setPaso(2);
  }

  async function manejarGuardar(event) {
    event.preventDefault();
    setErrorModal("");

    if (!form.categoria_id) {
      setErrorModal("Elegí una categoría.");
      return;
    }
    // FIX (07/09/2026, pedido del cliente): la imagen de producto pasa a
    // ser opcional -- antes acá se exigía imagenArchivo o form.imagen_url
    // y no dejaba guardar sin ninguna de las dos. Ahora, si no hay ni
    // archivo nuevo ni imagen previa, imagenUrl simplemente queda en null
    // más abajo (ver manejarGuardar) y el producto se guarda sin foto.
    // Solo afecta a Productos -- Categorías ya tenía la imagen opcional.

    setGuardando(true);
    try {
      // Si el admin eligió un archivo nuevo, primero se sube y se usa la
      // URL que devuelve el backend; si no tocó la imagen, se conserva la
      // que ya tenía el producto (form.imagen_url, o null si es alta nueva
      // sin imagen).
      let imagenUrl = form.imagen_url.trim() || null;
      if (imagenArchivo) {
        const respuestaImagen = await subirImagenProducto(imagenArchivo);
        // FIX (07/09/2026): el backend devuelve una ruta relativa
        // ("/static/productos/<archivo>", ver FIX B-03 en utils/imagenes.js),
        // pero el validador de imagen_url en el backend exige que empiece
        // con http:// o https:// -- sin este resolverUrlImagen(), guardar
        // fallaba siempre que se subía una imagen nueva ("Value error,
        // imagen_url debe empezar con http:// o https://").
        imagenUrl = resolverUrlImagen(respuestaImagen.data.url);
      }

      const payload = {
        nombre: form.nombre.trim(),
        marca: form.marca.trim(),
        descripcion: form.descripcion.trim() || null,
        // FEATURE (09/09/2026, pedido del cliente): "el IVA varía por
        // producto" -- se manda siempre (aunque en modo "directo" el campo
        // solo se muestre y se edite con moneda_carga === "USD", ver el
        // Form.Group más abajo) para no perder el valor cargado si el
        // admin cambia de USD a ARS y vuelve a USD sin haber guardado en
        // el medio. En modo "costo_utilidad" este mismo campo es central
        // en la cuenta (ver _calcularDesgloseCostoUtilidad más arriba) y
        // siempre está visible.
        iva_porcentaje: Number(form.iva_porcentaje),
        stock_minimo: Number(form.stock_minimo),
        garantia: form.garantia.trim() || null,
        imagen_url: imagenUrl,
        categoria_id: Number(form.categoria_id),
        // FEATURE (11/09/2026, pedido del cliente): "costo + IVA + utilidad
        // + coeficiente" -- cada producto usa UN SOLO modo de precio (ver
        // el CheckConstraint ck_productos_campos_segun_modo_precio en
        // app/models/product.py); acá se arma el payload solo con los
        // campos del modo elegido, mandando explícitamente en null los del
        // otro modo -- así, si el admin cambia de modo al editar un
        // producto, el modo viejo no queda con datos sueltos sin usarse
        // (el backend igual lo garantiza de nuevo por las dudas, ver
        // _normalizar_campos_segun_modo_precio en app/router/products.py,
        // pero mandarlo explícito acá deja el payload mismo sin ambigüedad).
        modo_precio: form.modo_precio,
        // FIX (13/09/2026, pedido del cliente -- "agregar la función de
        // poder ingresar tanto en pesos ARS como en USD" en Costo):
        // moneda_carga se manda siempre tal cual la eligió el admin, ya no
        // se fuerza "USD" en modo costo_utilidad -- a partir de esta fecha
        // este campo es compartido entre los dos modos (ver el comentario
        // grande junto a Producto.moneda_carga, app/models/product.py).
        moneda_carga: form.moneda_carga,
        precio_carga: form.modo_precio === "directo" ? Number(form.precio_carga) : null,
        costo: form.modo_precio === "costo_utilidad" ? Number(form.costo) : null,
        costo_incluye_iva: form.modo_precio === "costo_utilidad" ? form.costo_incluye_iva === "true" : null,
        utilidad_porcentaje: form.modo_precio === "costo_utilidad" ? Number(form.utilidad_porcentaje) : null,
        coeficiente: form.modo_precio === "costo_utilidad" ? Number(form.coeficiente) : 1,
      };
      // El stock inicial solo se carga en el alta -- en la edición el campo
      // queda bloqueado (ver el Form.Control más abajo) y ni siquiera se
      // manda en el payload, para que no haya forma de tocarlo por acá
      // (ni por accidente ni "a mano" en el network tab). Reponer stock de
      // un producto que ya existe es la pantalla Stock (ConfiguracionStock.jsx),
      // que además registra reabastecido_at -- si se pudiera pisar el stock
      // desde acá se perdería ese registro.
      if (!editandoId) {
        payload.stock = Number(form.stock);
      }

      if (editandoId) {
        // FEATURE (27/08/2026, pedido del cliente): editar es un "cambio"
        // que ahora pide confirmar con la contraseña del admin -- el
        // payload ya está armado (imagen incluida), solo falta esa
        // confirmación antes de mandarlo. Ver ModalConfirmarPassword y
        // confirmarEdicion más abajo.
        setPayloadPendiente(payload);
        setMostrarConfirmarEdicion(true);
        return;
      }

      await crearProducto(payload);
      setMostrarModal(false);
      await cargarDatos();
      // FIX UX-03: antes el modal se cerraba solo, sin ninguna confirmación
      // de que el guardado salió bien -- fácil de confundir con que no pasó
      // nada.
      notificarExito("Producto creado.");
    } catch (err) {
      setErrorModal(extraerMensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Se llama desde ModalConfirmarPassword una vez que el admin tipeó su
  // contraseña -- si el backend la rechaza (contraseña incorrecta, u otro
  // error), esto tira y el modal se queda abierto mostrando el motivo (ver
  // ModalConfirmarPassword.jsx), sin tocar nada del modal de edición de
  // atrás.
  async function confirmarEdicion(password) {
    await actualizarProducto(editandoId, payloadPendiente, password);
    setMostrarConfirmarEdicion(false);
    setPayloadPendiente(null);
    setMostrarModal(false);
    await cargarDatos();
    notificarExito("Producto actualizado.");
  }

  // FEATURE (27/08/2026, pedido del cliente): reemplaza el window.confirm()
  // que había antes -- ahora la confirmación es con la contraseña del admin,
  // no un simple aceptar/cancelar del navegador.
  function manejarBaja(producto) {
    setProductoConfirmarBaja(producto);
  }

  async function confirmarBaja(password) {
    await darDeBajaProducto(productoConfirmarBaja.id, password);
    const nombre = productoConfirmarBaja.nombre;
    setProductoConfirmarBaja(null);
    await cargarDatos();
    notificarExito(`"${nombre}" dado de baja.`);
  }

  // FEATURE (27/08/2026, pedido del cliente): "una vez dado de baja... que
  // el botón cambie a dar de alta". Mismo patrón que manejarBaja/
  // confirmarBaja de acá arriba, contraseña incluida.
  function manejarAlta(producto) {
    setProductoConfirmarAlta(producto);
  }

  async function confirmarAlta(password) {
    await reactivarProducto(productoConfirmarAlta.id, password);
    const nombre = productoConfirmarAlta.nombre;
    setProductoConfirmarAlta(null);
    await cargarDatos();
    notificarExito(`"${nombre}" dado de alta.`);
  }

  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): los cuatro filtros
  // ahora los resuelve el backend (ver cargarProductos más arriba); acá
  // solo queda un flag para elegir el texto del estado vacío ("no hay
  // productos todavía" vs. "ninguno coincide con el filtro").
  const hayFiltrosActivos = Boolean(
    filtroNombreAplicado || filtroMarca || filtroCategoriaId || filtroEstado !== "todos",
  );

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Productos</h1>
        <Button variant="primary" onClick={abrirNuevo} disabled={categorias.length === 0}>
          + Nuevo producto
        </Button>
      </div>

      {categorias.length === 0 && !cargando && (
        <Alert variant="warning">
          Todavía no hay categorías cargadas. Creá al menos una en la sección "Categorías" antes de dar de
          alta productos (categoria_id es obligatorio).
        </Alert>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      {/* FEATURE (27/08/2026, pedido del cliente): barra de filtros --
          nombre, marca, categoría y estado (dado de alta/baja). Mismo
          patrón visual que ConfiguracionStock.jsx (Form className="row
          g-2 mb-4" con un Form.Group por columna). Los cuatro se combinan
          -- FIX (13/09/2026, auditoría UX/UI Punto Crítico #3): ya no en
          memoria, ver cargarProductos más arriba. */}
      <Form className="row g-2 mb-3">
        <Form.Group className="col-md-4">
          <Form.Control
            type="search"
            placeholder="Buscar por nombre..."
            value={filtroNombre}
            onChange={(evento) => setFiltroNombre(evento.target.value)}
            aria-label="Buscar producto por nombre"
          />
        </Form.Group>
        <Form.Group className="col-md-3">
          <Form.Select
            value={filtroMarca}
            onChange={(evento) => setFiltroMarca(evento.target.value)}
            aria-label="Filtrar por marca"
          >
            <option value="">Todas las marcas</option>
            {marcasDisponibles.map((marca) => (
              <option key={marca} value={marca}>
                {marca}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="col-md-3">
          <Form.Select
            value={filtroCategoriaId}
            onChange={(evento) => setFiltroCategoriaId(evento.target.value)}
            aria-label="Filtrar por categoría"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="col-md-2">
          <Form.Select
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value)}
            aria-label="Filtrar por estado"
          >
            {_ESTADOS_PRODUCTO.map((estado) => (
              <option key={estado.valor} value={estado.valor}>
                {estado.etiqueta}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      </Form>

      {cargando ? (
        <Spinner animation="border" />
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th></th>
              <th>Nombre</th>
              <th>Marca</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {productos.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-4">
                  {hayFiltrosActivos ? "Ningún producto coincide con el filtro." : "No hay productos todavía."}
                </td>
              </tr>
            )}
            {productos.map((producto) => (
              // FEATURE (27/08/2026, pedido del cliente): opacity reducida
              // en las filas dadas de baja -- listarTodosLosProductos ahora
              // las trae junto con las activas (antes desaparecían de la
              // tabla apenas se desactivaban), así que hace falta algo
              // visual para distinguirlas de un vistazo además del badge.
              <tr key={producto.id} className={producto.is_active ? undefined : "opacity-50"}>
                <td style={{ width: 56 }}>
                  {producto.imagen_url ? (
                    <Image
                      src={resolverUrlImagen(producto.imagen_url)}
                      alt=""
                      rounded
                      width={40}
                      height={40}
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    // FIX UX-06 (auditoría UX/UI 26/08/2026, Media #4): antes decía
                    // "s/f" -- ver el mismo cambio en ConfiguracionStock.jsx y
                    // Categorias.jsx, y el comentario en components/iconos.jsx.
                    <div
                      className="superficie rounded d-flex align-items-center justify-content-center text-muted"
                      style={{ width: 40, height: 40 }}
                      title="Sin imagen"
                    >
                      <IconoImagen />
                    </div>
                  )}
                </td>
                <td>
                  {producto.nombre}
                  {!producto.is_active && (
                    <Badge bg="secondary" className="ms-2">
                      Dado de baja
                    </Badge>
                  )}
                </td>
                <td>{producto.marca}</td>
                <td>{producto.categoria?.nombre ?? "—"}</td>
                <td>
                  {formatearMoneda(producto.precio_venta)}
                  {/* FEATURE (09/09/2026, pedido del cliente): "elegir pesos o
                      dólares al cargar" -- referencia de en qué moneda quedó
                      cargado el precio de al lado, mismo patrón visual que
                      "mín: X" de Stock más abajo. En ARS aclara "fijo" (no le
                      afecta la cotización); en USD muestra el IVA propio de
                      ESTE producto (21% general, 10,5% reducido, etc. -- ver
                      Producto.iva_porcentaje en app/models/product.py), ya
                      que varía de un producto a otro y no hay un único
                      "sin IVA" válido para todos.

                      FEATURE (11/09/2026, pedido del cliente): "costo + IVA
                      + utilidad + coeficiente" -- un producto en este modo
                      no tiene moneda_carga/precio_carga (quedan en NULL,
                      ver _normalizar_campos_segun_modo_precio en
                      app/router/products.py), así que acá se muestra el
                      costo y la utilidad configurada en su lugar. */}
                  <div className="text-muted small">
                    {/* FIX (13/09/2026, pedido del cliente -- "agregar la
                        función de poder ingresar tanto en pesos ARS como en
                        USD" en Costo): antes esta rama no mostraba en qué
                        moneda estaba cargado el costo (siempre se asumía
                        pesos) -- ahora que puede ser ARS o USD, se antepone
                        la moneda al importe, mismo criterio que la rama de
                        modo_precio "directo" de acá abajo. */}
                    {producto.modo_precio === "costo_utilidad"
                      ? `Costo ${producto.moneda_carga} ${formatearMoneda(producto.costo)} (${producto.costo_incluye_iva ? "c/IVA" : "s/IVA"}, +${producto.utilidad_porcentaje}% util.)`
                      : producto.moneda_carga === "ARS"
                        ? `ARS ${producto.precio_carga} (fijo)`
                        : `USD ${producto.precio_carga} (+${producto.iva_porcentaje}% IVA)`}
                  </div>
                </td>
                <td>
                  {producto.stock}
                  {producto.stock === 0 && (
                    <Badge bg="secondary" className="ms-2">
                      Sin stock
                    </Badge>
                  )}
                  {/* Mínimo configurado para "Stock crítico" (ver
                      ConfiguracionStock.jsx) -- solo para orientar, se
                      edita desde el modal (botón Editar). */}
                  <div className="text-muted small">mín: {producto.stock_minimo}</div>
                </td>
                <td className="text-end">
                  <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => abrirEdicion(producto)}>
                    Editar
                  </Button>
                  {/* FEATURE (27/08/2026, pedido del cliente): "una vez dado
                      de baja... que el botón cambie a dar de alta, con el
                      mismo sistema de confirmación de contraseña". */}
                  {producto.is_active ? (
                    <Button size="sm" variant="outline-danger" onClick={() => manejarBaja(producto)}>
                      Dar de baja
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline-success" onClick={() => manejarAlta(producto)}>
                      Dar de alta
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {!cargando && productos.length > 0 && (
        <ControlesPaginacion
          pagina={pagina}
          haySiguiente={haySiguiente}
          cargando={cargando}
          onAnterior={() => setPagina((p) => Math.max(0, p - 1))}
          onSiguiente={() => setPagina((p) => p + 1)}
        />
      )}

      <Modal show={mostrarModal} onHide={() => setMostrarModal(false)} size="lg">
        <Form onSubmit={manejarGuardar}>
          <Modal.Header closeButton>
            <Modal.Title>{editandoId ? "Editar producto" : "Nuevo producto"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {/* FEATURE (11/09/2026, pedido del cliente): formulario en dos
                "páginas" dentro del mismo modal -- antes iban todos los
                campos (generales + precio) en una sola pantalla larga.
                Página 1: datos generales. Página 2: precio de carga e IVA,
                aparte porque es la parte más delicada de cargar (afecta
                directo lo que paga el cliente). Las dos viven en el MISMO
                <Form> -- un solo manejarGuardar al final, en la página 2 --
                lo que cambia es solo qué Form.Group se renderiza según
                "paso" (ver el estado más arriba): los campos de la página
                que no se muestra ni siquiera existen en el DOM (a
                diferencia de ocultarlos con CSS), así que un required de
                la página 1 nunca bloquea el submit de la página 2, y
                viceversa. "Siguiente" (Modal.Footer, más abajo) valida a
                mano los campos de la página 1 antes de avanzar -- ver
                manejarSiguiente más arriba -- porque al ser type="button"
                no dispara la validación nativa del <Form> como sí lo hace
                el submit real de "Guardar". */}
            <div className="text-muted small mb-3">
              Paso {paso} de 2: {paso === 1 ? "Datos generales" : "Precio e IVA"}
            </div>

            {paso === 1 && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control value={form.nombre} onChange={actualizarCampo("nombre")} required />
                </Form.Group>

                <div className="row">
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Marca</Form.Label>
                    <Form.Control value={form.marca} onChange={actualizarCampo("marca")} required />
                  </Form.Group>
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Categoría</Form.Label>
                    <Form.Select value={form.categoria_id} onChange={actualizarCampo("categoria_id")} required>
                      <option value="">Elegir...</option>
                      {categorias.map((categoria) => (
                        <option key={categoria.id} value={categoria.id}>
                          {categoria.nombre}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>

                <Form.Group className="mb-3">
                  <Form.Label>Descripción (opcional)</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={form.descripcion}
                    onChange={actualizarCampo("descripcion")}
                  />
                  {/* Un renglón (Enter) por característica -- la ficha del
                      producto (ProductoDetalle.jsx) las muestra como lista de
                      viñetas automáticamente apenas hay más de un renglón; un
                      solo renglón se muestra como párrafo normal. No es un
                      campo aparte por característica a propósito: mantiene el
                      alta simple y no obliga a rehacer el formulario cada vez
                      que un producto necesita una característica distinta. */}
                  <Form.Text className="text-muted">
                    Un renglón por característica (Enter entre cada una) para que se muestren como viñetas en
                    la ficha del producto.
                  </Form.Text>
                </Form.Group>

                <div className="row">
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Stock{editandoId && " inicial"}</Form.Label>
                    <Form.Control
                      type="number"
                      step="1"
                      min="0"
                      value={form.stock}
                      onChange={actualizarCampo("stock")}
                      disabled={Boolean(editandoId)}
                      required
                    />
                    {editandoId && (
                      <Form.Text className="text-muted">
                        No se puede editar acá, para evitar altas duplicadas. Para cargar
                        stock nuevo usá la pantalla Stock (Configuración → Stock).
                      </Form.Text>
                    )}
                  </Form.Group>
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Mínimo para "Stock crítico"</Form.Label>
                    <Form.Control
                      type="number"
                      step="1"
                      min="0"
                      value={form.stock_minimo}
                      onChange={actualizarCampo("stock_minimo")}
                      required
                    />
                    <Form.Text className="text-muted">
                      Con este stock o menos, aparece como crítico en la pantalla Stock.
                    </Form.Text>
                  </Form.Group>
                </div>

                <div className="row">
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Garantía (opcional)</Form.Label>
                    <Form.Control value={form.garantia} onChange={actualizarCampo("garantia")} />
                  </Form.Group>
                  <Form.Group className="mb-3 col-md-6">
                    <Form.Label>Imagen (opcional)</Form.Label>
                    <Form.Control
                      key={imagenInputKey}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={manejarSeleccionImagen}
                      // FIX (07/09/2026, pedido del cliente): ya no es
                      // obligatoria -- se saca el atributo required nativo
                      // (antes era required={!imagenPreviewUrl}) y la
                      // validación que la exigía en manejarGuardar.
                    />
                    <Form.Text className="text-muted">Opcional. JPG, PNG o WEBP, hasta 5MB.</Form.Text>
                    {imagenPreviewUrl && (
                      <div className="mt-2 d-flex align-items-center gap-2">
                        <Image src={resolverUrlImagen(imagenPreviewUrl)} alt="Vista previa" thumbnail width={100} />
                        <Button variant="outline-danger" size="sm" onClick={manejarQuitarImagen}>
                          Quitar foto
                        </Button>
                      </div>
                    )}
                  </Form.Group>
                </div>
              </>
            )}

            {paso === 2 && (
              <>
                {/* FEATURE (11/09/2026, pedido del cliente): "costo + IVA +
                    utilidad + coeficiente" -- selector del modo de precio de
                    ESTE producto. Los radios están conectados a
                    form.modo_precio, que decide qué juego de campos se
                    muestra más abajo (y qué se manda en el payload, ver
                    manejarGuardar). Cambiar el modo acá NO borra lo que el
                    admin ya tenía tipeado en el otro juego de campos --
                    sigue en el estado del form por si vuelve atrás, solo se
                    descarta recién al guardar (ver el payload). */}
                <Form.Group className="mb-3">
                  <Form.Label>Forma de cargar el precio</Form.Label>
                  <div className="d-flex gap-3">
                    <Form.Check
                      type="radio"
                      id="modo-precio-directo"
                      name="modo_precio"
                      label="Precio directo (ARS/USD)"
                      value="directo"
                      checked={form.modo_precio === "directo"}
                      onChange={manejarCambioModoPrecio}
                    />
                    <Form.Check
                      type="radio"
                      id="modo-precio-costo-utilidad"
                      name="modo_precio"
                      label="Costo + IVA + utilidad"
                      value="costo_utilidad"
                      checked={form.modo_precio === "costo_utilidad"}
                      onChange={manejarCambioModoPrecio}
                    />
                  </div>
                </Form.Group>

                {form.modo_precio === "directo" && <CamposPrecioDirecto form={form} actualizarCampo={actualizarCampo} />}
                {form.modo_precio === "costo_utilidad" && (
                  <CamposCostoUtilidad form={form} actualizarCampo={actualizarCampo} cotizacionDolar={cotizacionDolar} />
                )}
              </>
            )}

            {errorModal && <Alert variant="danger">{errorModal}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            {/* FEATURE (11/09/2026, pedido del cliente): "Atrás" solo en la
                página 2 -- className="me-auto" lo empuja a la izquierda,
                separado de Cancelar/Siguiente-Guardar que quedan agrupados
                a la derecha como antes. */}
            {paso === 2 && (
              <Button variant="outline-secondary" type="button" className="me-auto" onClick={() => setPaso(1)}>
                Atrás
              </Button>
            )}
            <Button variant="secondary" onClick={() => setMostrarModal(false)}>
              Cancelar
            </Button>
            {paso === 1 ? (
              // FIX (11/09/2026, pedido del cliente): el key distinto acá es
              // a propósito, no cosmético -- sin él, este botón y el de
              // "Guardar" de abajo ocupan la MISMA posición del árbol (el
              // mismo Button en el mismo lugar de este ? :), así que React
              // reutiliza el mismo <button> del DOM entre uno y otro en vez
              // de crear uno nuevo, y solo le cambia el atributo type de
              // "button" a "submit". Como ese cambio de atributo pasa
              // durante el mismo clic que lo disparó (el onClick de acá
              // llama a manejarSiguiente, que hace setPaso(2) y React
              // re-renderiza en el momento), el navegador terminaba
              // enviando el formulario con ESE mismo clic -- el bug
              // reportado: "Siguiente" pasaba de página pero también
              // pedía la contraseña de guardar. El key fuerza a React a
              // desmontar este botón y montar uno nuevo para "Guardar" en
              // vez de reutilizar el nodo, así el clic en "Siguiente"
              // nunca llega a un <button type="submit">.
              <Button key="btn-siguiente" variant="primary" type="button" onClick={manejarSiguiente}>
                Siguiente
              </Button>
            ) : (
              <Button key="btn-guardar" variant="primary" type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </Modal.Footer>
        </Form>
      </Modal>
      {/* FEATURE (27/08/2026, pedido del cliente): confirmación con la
          contraseña del admin antes de aplicar la edición (payloadPendiente,
          armado en manejarGuardar) -- ver confirmarEdicion más arriba. */}
      <ModalConfirmarPassword
        show={mostrarConfirmarEdicion}
        titulo="Confirmar cambios"
        mensaje="Para guardar los cambios, confirmá tu contraseña."
        textoConfirmar="Guardar cambios"
        onConfirmar={confirmarEdicion}
        onCancelar={() => setMostrarConfirmarEdicion(false)}
      />

      {/* FEATURE (27/08/2026, pedido del cliente): reemplaza el
          window.confirm() que había antes para "Dar de baja" -- ver
          manejarBaja/confirmarBaja más arriba. */}
      <ModalConfirmarPassword
        show={productoConfirmarBaja !== null}
        titulo="Confirmar baja"
        mensaje={
          productoConfirmarBaja
            ? `¿Dar de baja "${productoConfirmarBaja.nombre}"? Ya no se va a poder comprar. Confirmá tu contraseña para continuar.`
            : ""
        }
        textoConfirmar="Dar de baja"
        variantConfirmar="danger"
        onConfirmar={confirmarBaja}
        onCancelar={() => setProductoConfirmarBaja(null)}
      />

      {/* FEATURE (27/08/2026, pedido del cliente): "Dar de alta" -- mismo
          sistema de confirmación con contraseña que "Dar de baja" de arriba,
          ver manejarAlta/confirmarAlta más arriba. */}
      <ModalConfirmarPassword
        show={productoConfirmarAlta !== null}
        titulo="Confirmar alta"
        mensaje={
          productoConfirmarAlta
            ? `¿Dar de alta "${productoConfirmarAlta.nombre}"? Va a volver a estar disponible para comprar. Confirmá tu contraseña para continuar.`
            : ""
        }
        textoConfirmar="Dar de alta"
        variantConfirmar="success"
        onConfirmar={confirmarAlta}
        onCancelar={() => setProductoConfirmarAlta(null)}
      />
    </div>
  );
}

/**
 * Página 2 del formulario, modo "directo" (el de siempre): moneda + precio
 * de carga, más el IVA de este producto cuando la moneda es USD. Separado
 * en su propio componente para no mezclar este bloque con el de
 * CamposCostoUtilidad (acá abajo) dentro del mismo JSX condicional gigante
 * -- ver el selector de modo_precio en Productos(), más arriba, que decide
 * cuál de los dos se monta.
 */
function CamposPrecioDirecto({ form, actualizarCampo }) {
  return (
    <div className="row">
      <Form.Group className="mb-3 col-md-6">
        <Form.Label>Precio de carga</Form.Label>
        {/* FEATURE (09/09/2026, pedido del cliente): "elegir pesos o
            dólares al cargar" -- el <Form.Select> de moneda va prendido al
            input de precio (InputGroup), un solo campo visual en vez de dos
            sueltos. Cambiar la moneda acá NO convierte el número ya
            tipeado -- es solo una etiqueta de en qué moneda se interpreta
            ese valor, coherente con que el backend tampoco convierte nada
            al guardar (ver ProductoBase.moneda_carga en
            app/schemas/product.py). */}
        <InputGroup>
          <Form.Select
            value={form.moneda_carga}
            onChange={actualizarCampo("moneda_carga")}
            // FIX (13/09/2026, reportado por el cliente -- "cuando hago
            // clic en la flecha para elegir la moneda, figura la flecha y
            // no la moneda"): el ancho estaba fijo en px (100) mientras que
            // el padding/flecha propios de Bootstrap para un <select> son
            // en rem -- con la letra más grande (zoom del navegador, o
            // "Escala de texto" de Windows por arriba de 100%, algo común
            // en notebooks), ese padding en rem crece pero la caja de
            // 100px NO, así que el texto ("ARS"/"USD") queda apretado
            // detrás de la flecha y no se ve. Poniendo el ancho TAMBIÉN en
            // rem, crece junto con el padding en cualquier tamaño de letra
            // y siempre queda lugar para las 3 letras de la moneda.
            style={{ width: "5.5rem", flex: "0 0 auto" }}
            aria-label="Moneda del precio"
          >
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </Form.Select>
          <Form.Control
            type="number"
            step="0.01"
            min="0"
            value={form.precio_carga}
            onChange={actualizarCampo("precio_carga")}
            // FIX (09/09/2026, pedido del cliente): un <input type="number">
            // le suma/resta al valor con el scroll del mouse apenas tiene
            // el foco -- fácil de disparar sin querer solo pasando el
            // cursor por arriba mientras se scrollea la página, y acá
            // cambiaría el precio del producto sin que el admin se dé
            // cuenta. onWheel le quita el foco al input apenas detecta un
            // scroll (blur) para que ese scroll pase de largo como en
            // cualquier otro campo, en vez de tocar el valor.
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
        </InputGroup>
        {/* FEATURE (09/09/2026, pedido del cliente): "elegir pesos o
            dólares al cargar" -- la ayuda cambia según la moneda elegida,
            para que quede claro qué hace el sistema con ese número (nunca
            se carga el precio final en pesos acá en ninguno de los dos
            casos). */}
        <Form.Text className="text-muted">
          {form.moneda_carga === "ARS"
            ? "Precio final en pesos, con IVA incluido. Queda fijo: no cambia si se actualiza la cotización del dólar."
            : "Precio en dólares, SIN IVA. El sistema le suma el IVA de al lado y lo convierte a pesos con la cotización del dólar, configurada en Configuración → General."}
        </Form.Text>
      </Form.Group>
      {/* FEATURE (09/09/2026, pedido del cliente): "el IVA varía por
          producto" -- el dueño aclaró que NO es un único porcentaje para
          todo el catálogo (21% general, 10,5% reducido en algunos casos),
          así que se carga acá, por producto, en vez de en Configuración →
          General. Solo tiene sentido (y solo se muestra) cuando el precio
          está en USD: en ARS el precio final ya viene con el IVA que
          corresponda incluido, este campo no participa de ninguna cuenta
          en ese caso. */}
      {form.moneda_carga === "USD" && (
        <Form.Group className="mb-3 col-md-6">
          <Form.Label>IVA (%)</Form.Label>
          <Form.Control
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.iva_porcentaje}
            onChange={actualizarCampo("iva_porcentaje")}
            // FIX (09/09/2026, pedido del cliente): mismo problema y misma
            // solución que en el campo de precio de al lado -- ver ese
            // comentario.
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
          <Form.Text className="text-muted">
            Alícuota de ESTE producto (21% general, 10,5% reducido, etc.). Se suma al precio en dólares antes
            de convertirlo a pesos.
          </Form.Text>
        </Form.Group>
      )}
    </div>
  );
}

/**
 * Página 2 del formulario, modo "costo_utilidad" -- FEATURE (11/09/2026,
 * pedido del cliente): costo, si ese costo incluye IVA o no, IVA,
 * utilidad y coeficiente de conversión de unidad de compra a unidad de
 * venta, más un panel con el resultado (costo neto, utilidad, precio sin
 * IVA, IVA, precio final) que se recalcula solo con cada tecla -- pedido
 * explícito del cliente: "los campos calculados deberían actualizarse
 * automáticamente cuando el usuario modifique costo, IVA, utilidad,
 * coeficiente o la condición con/sin IVA". La cuenta la hace
 * _calcularDesgloseCostoUtilidad (ver más arriba en este archivo), que
 * espeja exactamente la cadena de column_property del backend (ver el
 * comentario grande junto a Producto.modo_precio en app/models/
 * product.py) -- el precio que de verdad se guarda y se le cobra al
 * cliente siempre lo recalcula el backend, esto es solo una vista previa.
 */
function CamposCostoUtilidad({ form, actualizarCampo, cotizacionDolar }) {
  const desglose = useMemo(
    () =>
      _calcularDesgloseCostoUtilidad({
        costo: Number(form.costo),
        monedaCarga: form.moneda_carga,
        cotizacionDolar,
        coeficiente: Number(form.coeficiente),
        costoIncluyeIva: form.costo_incluye_iva === "true",
        ivaPorcentaje: Number(form.iva_porcentaje),
        utilidadPorcentaje: Number(form.utilidad_porcentaje),
      }),
    [
      form.costo,
      form.moneda_carga,
      cotizacionDolar,
      form.coeficiente,
      form.costo_incluye_iva,
      form.iva_porcentaje,
      form.utilidad_porcentaje,
    ],
  );

  return (
    <>
      <div className="row">
        <Form.Group className="mb-3 col-md-6">
          <Form.Label>Costo</Form.Label>
          {/* FEATURE (13/09/2026, pedido del cliente): "agregar la función
              de poder ingresar tanto en pesos ARS como en USD, y que
              después el sistema haga la cuenta para que al cliente le
              figure en pesos argentinos" -- mismo patrón de <InputGroup>
              con el <Form.Select> de moneda pegado al campo que ya usa
              "Precio de carga" en CamposPrecioDirecto, más arriba en este
              archivo. moneda_carga es la MISMA columna que usa ese otro
              modo (ver el comentario grande junto a Producto.moneda_carga,
              app/models/product.py) -- acá también decide en qué moneda se
              interpreta el número de al lado, la conversión a pesos la
              hace siempre el backend (y esta vista previa, ver
              _calcularDesgloseCostoUtilidad más arriba). */}
          <InputGroup>
            <Form.Select
              value={form.moneda_carga}
              onChange={actualizarCampo("moneda_carga")}
              // FIX (13/09/2026): mismo ajuste que el selector de moneda de
              // "Precio de carga" más arriba (CamposPrecioDirecto) -- ver
              // el comentario grande ahí.
              style={{ width: "5.5rem", flex: "0 0 auto" }}
              aria-label="Moneda del costo"
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </Form.Select>
            <Form.Control
              type="number"
              step="0.01"
              min="0"
              value={form.costo}
              onChange={actualizarCampo("costo")}
              onWheel={(event) => event.currentTarget.blur()}
              required
            />
          </InputGroup>
          <Form.Text className="text-muted">
            {form.moneda_carga === "ARS"
              ? "Lo que paga el negocio por este producto, en pesos, en la unidad de COMPRA (antes de aplicar el coeficiente)."
              : "Lo que paga el negocio por este producto, en dólares, en la unidad de COMPRA (antes de aplicar el coeficiente). El sistema lo convierte a pesos con la cotización del dólar, configurada en Configuración → General, antes de aplicar el resto de la cuenta."}
          </Form.Text>
        </Form.Group>
        <Form.Group className="mb-3 col-md-6">
          <Form.Label>¿Ese costo incluye IVA?</Form.Label>
          {/* IMPORTANTE (pedido explícito del cliente): el IVA nunca debe
              considerarse utilidad -- esta elección es justamente la que
              le permite al sistema, cuando el costo viene CON IVA, sacarlo
              primero y calcular la utilidad sobre el costo neto, no sobre
              un importe que ya lo incluye. Ver _calcularDesgloseCostoUtilidad. */}
          <div className="d-flex gap-3 pt-2">
            <Form.Check
              type="radio"
              id="costo-sin-iva"
              name="costo_incluye_iva"
              label="Sin IVA"
              value="false"
              checked={form.costo_incluye_iva === "false"}
              onChange={actualizarCampo("costo_incluye_iva")}
            />
            <Form.Check
              type="radio"
              id="costo-con-iva"
              name="costo_incluye_iva"
              label="Con IVA"
              value="true"
              checked={form.costo_incluye_iva === "true"}
              onChange={actualizarCampo("costo_incluye_iva")}
            />
          </div>
          <Form.Text className="text-muted">
            "Sin IVA": el costo de arriba ya es el costo neto. "Con IVA": el sistema le saca el IVA primero
            para obtener el costo neto.
          </Form.Text>
        </Form.Group>
      </div>

      <div className="row">
        <Form.Group className="mb-3 col-md-4">
          <Form.Label>IVA (%)</Form.Label>
          <Form.Control
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.iva_porcentaje}
            onChange={actualizarCampo("iva_porcentaje")}
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
        </Form.Group>
        <Form.Group className="mb-3 col-md-4">
          <Form.Label>Utilidad (%)</Form.Label>
          <Form.Control
            type="number"
            step="0.01"
            min="-100"
            max="1000"
            value={form.utilidad_porcentaje}
            onChange={actualizarCampo("utilidad_porcentaje")}
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
          <Form.Text className="text-muted">Se calcula sobre el costo neto, nunca sobre un importe que ya tiene IVA.</Form.Text>
        </Form.Group>
        <Form.Group className="mb-3 col-md-4">
          <Form.Label>Coeficiente</Form.Label>
          <Form.Control
            type="number"
            step="0.0001"
            min="0.0001"
            value={form.coeficiente}
            onChange={actualizarCampo("coeficiente")}
            onWheel={(event) => event.currentTarget.blur()}
            required
          />
          <Form.Text className="text-muted">
            Solo si la unidad de compra es distinta de la de venta (ej. se compra por docena y se vende por
            unidad → 12). Dejar en 1 si son la misma unidad.
          </Form.Text>
        </Form.Group>
      </div>

      {/* Panel de resultado -- se actualiza solo con cada tecla (useMemo de
          acá arriba). Mientras falte algún dato o algo no sea un número
          válido, _calcularDesgloseCostoUtilidad devuelve null y acá se
          muestra un aviso en vez de un cálculo a medias o un NaN.

          FIX (13/09/2026, pedido del cliente -- "agregar la función de
          poder ingresar tanto en pesos ARS como en USD"): con Costo en
          USD, null también puede deberse a que todavía no llegó la
          cotización del dólar (ver el useEffect que la trae, más arriba
          en este archivo) -- se distingue ese caso del resto para no
          confundir a un admin que sí completó todos los campos. */}
      <div className="border rounded p-3 bg-light-subtle mb-3">
        <div className="text-muted small mb-2">Resultado (se actualiza solo)</div>
        {form.moneda_carga === "USD" && !(Number.isFinite(cotizacionDolar) && cotizacionDolar > 0) ? (
          <div className="text-muted">Esperando la cotización del dólar para poder mostrar el resultado en pesos...</div>
        ) : desglose ? (
          <div className="row g-2">
            <div className="col-6 col-md-4">
              <div className="text-muted small">Costo neto</div>
              <div>{formatearMoneda(desglose.costoNeto)}</div>
            </div>
            <div className="col-6 col-md-4">
              <div className="text-muted small">Utilidad</div>
              <div>{formatearMoneda(desglose.utilidadImporte)}</div>
            </div>
            <div className="col-6 col-md-4">
              <div className="text-muted small">Precio de venta sin IVA</div>
              <div>{formatearMoneda(desglose.precioVentaSinIva)}</div>
            </div>
            <div className="col-6 col-md-4">
              <div className="text-muted small">IVA</div>
              <div>{formatearMoneda(desglose.ivaMonto)}</div>
            </div>
            <div className="col-6 col-md-4">
              <div className="text-muted small fw-bold">Precio final con IVA</div>
              <div className="fw-bold">{formatearMoneda(desglose.precioFinal)}</div>
            </div>
          </div>
        ) : (
          <div className="text-muted">Completá costo, IVA, utilidad y coeficiente para ver el resultado.</div>
        )}
      </div>
    </>
  );
}
