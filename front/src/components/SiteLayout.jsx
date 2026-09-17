import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Form, Nav, Navbar, Offcanvas, Spinner } from "react-bootstrap";
import { marcarAvisoEmailVerificadoVisto } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useTheme } from "../context/ThemeContext";
import { notificarInfo } from "../utils/notificaciones";
// FEATURE (11/09/2026, pedido del cliente): ver el chequeo de
// usuario.debe_cambiar_password más abajo, antes del sidebar/Outlet
// normal.
import CambiarPasswordObligatorio from "./CambiarPasswordObligatorio";
// FIX UX-05 (auditoría UX/UI 26/08/2026, Media #3): los íconos que usaba
// este archivo (antes definidos acá mismo, uno por uno) ahora viven en
// components/iconos.jsx -- ver ese archivo, es la única fuente de verdad.
// IconoEstrella pasó a llamarse IconoEstrellaSolida acá: no es el mismo
// ícono que la estrella-toggle de ProductoDetalle.jsx, solo tenían el
// mismo nombre por casualidad.
// FEATURE (12/09/2026, pedido del cliente): "pasar el contenido del
// sidebar al navbar" -- IconoAbrirMenu/IconoCerrarMenu ya no se usan acá:
// eran el ícono a mano del botón que abría/cerraba el aside de acá abajo;
// el <Navbar.Toggle> de react-bootstrap (ver el JSX más abajo) ya trae su
// propio ícono de "hamburguesa" para colapsar/expandir en celular, no hace
// falta elegir uno. Los dos íconos en sí siguen viviendo en iconos.jsx por
// si algún otro archivo los usa (ConfiguracionLayout.jsx sí sigue usando
// IconoAbrirMenu para su propio botón "Menú").
import {
  IconoBuscar,
  IconoCarrito,
  IconoEngranaje,
  IconoEstrellaSolida,
  IconoGrilla,
  IconoHistorial,
  IconoInicio,
  IconoLuna,
  IconoPerfil,
  IconoSalir,
  IconoSol,
  IconoTelefono,
} from "./iconos";

// Cuánto esperar después de la última tecla antes de actualizar los
// resultados -- ni instantáneo (un pedido HTTP por tecla) ni tan largo
// que se sienta lento.
const DEMORA_BUSQUEDA_MS = 400;

// Layout compartido por toda la tienda (no confundir con AdminLayout, que
// es el layout viejo de /admin/*, hoy sin uso -- ver el comentario en
// App.jsx).
//
// === FEATURE (12/09/2026, pedido del cliente): "pasar el contenido del
// sidebar al navbar" =========================================================
// Hasta acá, con sesión iniciada, este layout mostraba un sidebar vertical
// overlay (aside con position: fixed, ver .sidebar-tienda en theme.scss)
// que se deslizaba por encima del contenido. Ahora ese mismo contenido --
// marca, buscador, los links de navegación (Inicio/Catálogo/Carrito/
// Favoritos/Historial/Contacto/Configuración-Mi perfil), el interruptor de
// tema y "Cerrar sesión" -- vive en un <Navbar> horizontal de
// react-bootstrap arriba de la página, en vez de a un costado. Nada de
// esa lista se sacó ni se achicó, solo cambió de lugar.
//
// En escritorio (>= "xl", ver el FIX del 13/09/2026 más abajo) ese
// contenido se ve siempre en línea, adentro del <Navbar expand="xl">,
// como cualquier navbar.
//
// === FIX (12/09/2026, pedido del cliente): "solamente en celular, el
// navbar cambia el sidebar que teníamos" =====================================
// La primera versión de este cambio usaba <Navbar.Collapse>: en celular,
// tocar el botón "hamburguesa" desplegaba el contenido hacia ABAJO,
// empujando la página (el patrón típico de navbar colapsable). El cliente
// pidió volver, pero SOLO en celular, al comportamiento que tenía el
// sidebar viejo: un panel que se desliza encima de todo (no que empuja el
// contenido), con fondo oscurecido y cierre con click-afuera/Escape.
//
// La solución no es "volver a mostrar el aside de siempre en celular" --
// eso obligaría a mantener dos layouts en paralelo (uno para desktop, uno
// para mobile). En vez de eso, <Navbar.Collapse> se reemplaza acá por
// <Navbar.Offcanvas>: es el mismo patrón "navbar responsive" de Bootstrap
// que ya usa ConfiguracionLayout.jsx para su propio sidebar (<Offcanvas
// responsive="md">, ese SÍ sigue en "md" -- es un panel distinto, con su
// propio contenido y su propio ancho, ver el FIX del 13/09/2026 más abajo
// sobre por qué el de acá cambió y ese no), aplicado ahora a este navbar.
// Por debajo del breakpoint de "expand" que se le pase (ver el FIX del
// 13/09/2026 más abajo -- hoy "xl") es un <Offcanvas> de verdad -- panel
// que se desliza (placement="start", desde la izquierda, como el sidebar
// de siempre) con su propio backdrop, click-afuera-para-cerrar y tecla
// Escape, todo integrado, sin reimplementar nada de eso a mano. De ese
// breakpoint para arriba, react-bootstrap renderiza el mismo contenido
// como un <div> normal, en línea dentro del navbar, sin nada de Offcanvas
// (encabezado, botón de cerrar, backdrop) -- se ve exactamente igual que
// un navbar común.
//
// El estado de expandido/colapsado en celular/tablet (expandido, más
// abajo) sigue arrancando siempre en false: del breakpoint de "expand"
// para arriba, react-bootstrap ignora "expanded" (el contenido siempre se
// ve en línea), así que un solo default alcanza para todos los casos,
// igual que con Collapse.
// ============================================================================
//
// === FIX (13/09/2026, reportado por el cliente, dos vueltas -- ver el
// comentario grande junto al <Navbar> más abajo para el detalle completo
// con los números medidos): "la app tiene que ser responsive, con la
// excepción de que en tablet Y EN CELULAR el navbar sea un sidebar". El
// <Navbar expand="md"> original (md = 768px) mostraba el contenido en
// línea demasiado pronto (marca + buscador + 7 secciones + switch de tema
// + "Cerrar sesión" recién entraban cómodos a partir de ~1380-1400px,
// medido con Playwright) -- primera vuelta: subir el breakpoint a "xxl"
// (1400px). Eso a su vez resultó ser MÁS ancho que la mayoría de las
// notebooks reales (una pantalla de 1366px, o una de 1920px al 125% de
// escalado de Windows, dan menos de 1400px de ancho disponible) --
// segunda vuelta: en vez de seguir subiendo el breakpoint, se compactó el
// contenido en sí (buscador más angosto, "Cerrar sesión" solo ícono,
// espacios más ajustados) para que entre cómodo ya en "xl" (1200px), el
// breakpoint estándar de Bootstrap justo debajo de "xxl" -- ese sí cubre
// notebooks/PCs reales sin dejar de mandar tablets (portrait y landscape)
// al sidebar. Por debajo de 1200px el navbar es el sidebar deslizable
// (Navbar.Offcanvas, ver el FIX del 12/09/2026 más arriba); de ahí para
// arriba se ve en línea.
// ============================================================================
//
// FIX (13/09/2026, auditoría UX/UI Punto Alto #10, a pedido del cliente):
// "Catálogo" tenía acá un mega-menú propio (CatalogoMegaMenu.jsx --
// categorías en columnas con productos debajo de cada una, se abría con
// mouseenter/click) que traía tres problemas de fondo: en desktop el hover
// abría el panel ANTES de que el usuario llegara a hacer clic, así que un
// clic pensado para ir al catálogo completo lo único que lograba era
// cerrarlo; la primera vez que se abría disparaba una request HTTP en
// paralelo POR CADA categoría (hasta ~100, el tope de paginación del
// backend); y el panel no tenía tope de alto ni scroll propio. El cliente
// pidió simplificar en vez de seguir parchando: "Catálogo" pasa a ser un
// link común, igual que "Inicio" -- un clic manda directo a /catalogo, sin
// desplegable. CatalogoMegaMenu.jsx queda sin usar (no lo pude borrar de tu
// carpeta -- esta sesión no tiene forma de eliminar archivos de tu
// computadora, ver el comentario que le agregué arriba de ese archivo); lo
// podés borrar vos a mano si querés.
// ============================================================================
//
// Invitado (sin sesión): este layout ya no está detrás de RutaProtegida
// (ver App.jsx) porque Home ("/") tiene que poder verse sin haber
// iniciado sesión. Así que acá abajo, más allá de todos los hooks (que
// tienen que llamarse siempre, sesión o no), se decide qué se muestra:
// invitado -> barra simple con "Iniciar sesión"/"Registrarse", nada de
// navegación; con sesión -> el navbar completo de siempre.
export default function SiteLayout() {
  const { estaAutenticado, esStaff, cargando, cerrarSesion, usuario } = useAuth();
  const { cantidadTotal, vaciarCarrito } = useCart();
  const { tema, alternarTema } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // FEATURE (12/09/2026, pedido del cliente): "pasar el contenido del
  // sidebar al navbar" -- reemplaza al viejo "abierto" (sidebar overlay).
  // Controla si el panel está desplegado en celular/tablet: por debajo del
  // breakpoint de "expand" del <Navbar> de más abajo (FIX 13/09/2026:
  // "xl", antes "md" y luego "xxl") es el <Navbar.Offcanvas> (ver el comentario grande
  // más arriba); de ese breakpoint para arriba no hace nada (Bootstrap
  // ignora "expanded", el contenido siempre se ve en línea), así que no
  // hace falta ninguna lógica de default distinto por tamaño de pantalla
  // ni el chequeo de location.state.sidebarCerrado que ponía Login.jsx.
  // Arranca siempre cerrado.
  const [expandido, setExpandido] = useState(false);

  // Elegir cualquier opción (un link, "Cerrar sesión", tocar el switch de
  // tema) cierra el menú desplegado -- solo importa por debajo del
  // breakpoint de "expand" (celular/tablet), en escritorio el navbar ya se
  // ve siempre en línea y esto no hace nada visible. Mismo criterio de UX
  // que tenía el sidebar viejo ("ya navegaste a donde querías ir, no hace
  // falta que se quede abierto").
  function cerrarMenu() {
    setExpandido(false);
  }

  // FIX (12/09/2026, pedido del cliente): ya no hace falta ningún listener
  // de teclado a mano acá -- antes (con <Navbar.Collapse>) Escape se
  // manejaba con este mismo useEffect (auditoría UX/UI 30/08/2026,
  // hallazgo Media-Alta #6); ahora que en celular es un <Navbar.Offcanvas>
  // de verdad (ver el comentario grande más arriba), Escape y el
  // click-afuera-para-cerrar ya vienen incluidos en el propio componente
  // Offcanvas de react-bootstrap, igual que en cualquier Modal -- no hay
  // nada que reimplementar. En escritorio tampoco hacía falta: ahí no hay
  // nada que "cerrar" (el contenido del navbar siempre se ve en línea).

  // Búsqueda global: mismo comportamiento que tenía en SiteNavbar.jsx --
  // vive acá (no en Home/Catalogo) para poder buscar desde cualquier
  // pantalla. Si ya estás en /catalogo, el término se combina con
  // categoría/marca sin pisarlos (mismos searchParams); si estás en otra
  // página, te manda a /catalogo?nombre=... directamente.
  const [busqueda, setBusqueda] = useState(() =>
    location.pathname === "/catalogo" ? searchParams.get("nombre") || "" : "",
  );
  // Para no disparar una navegación en el primer render (cuando busqueda
  // se inicializa desde la URL, arriba) -- el debounce de abajo solo debe
  // reaccionar a lo que el usuario tipea después.
  const primerRenderRef = useRef(true);

  useEffect(() => {
    if (primerRenderRef.current) {
      primerRenderRef.current = false;
      return;
    }
    const timeoutId = setTimeout(() => {
      const termino = busqueda.trim();
      if (location.pathname === "/catalogo") {
        setSearchParams(
          (actual) => {
            const siguiente = new URLSearchParams(actual);
            if (termino) {
              siguiente.set("nombre", termino);
            } else {
              siguiente.delete("nombre");
            }
            return siguiente;
          },
          { replace: true },
        );
      } else if (termino) {
        navigate(`/catalogo?nombre=${encodeURIComponent(termino)}`, { replace: true });
      }
    }, DEMORA_BUSQUEDA_MS);
    return () => clearTimeout(timeoutId);
    // Solo debe reiniciar el timer cuando cambia lo que tipeó el usuario --
    // location/searchParams/navigate se usan adentro pero no tienen que
    // disparar el efecto de nuevo por su cuenta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  // FEATURE (12/09/2026, pedido del cliente): "que cuando se verifique la
  // cuenta del cliente, en su próximo logueo le salte una pequeña alerta
  // dentro de las misma app de que su cuenta ya ha sido verificada" --
  // reemplaza al mail de aviso que mandaba antes admin_mark_email_verified
  // (router/users.py), que rebotaba siempre porque iba a la misma casilla
  // llena/rota que motivó al admin a usar ese endpoint en primer lugar (ver
  // el comentario grande en Usuario.debe_avisar_email_verificado,
  // app/models/user.py). Mismo mecanismo que debe_cambiar_password más
  // abajo (una señal booleana que el backend prende y el frontend lee de
  // GET /users/me en el próximo login), pero acá NO hace falta bloquear
  // nada -- es puramente informativo -- así que en vez de una pantalla
  // obligatoria (CambiarPasswordObligatorio.jsx) alcanza con un toast (ver
  // utils/notificaciones.js).
  //
  // FIX (13/09/2026, auditoría UX/UI Punto Crítico #7): "puramente
  // informativo" no significa "incondicional" -- ver el chequeo de
  // usuario?.debe_cambiar_password adentro del useEffect de acá abajo:
  // este aviso puede convivir con esa OTRA pantalla obligatoria (no son
  // mutuamente excluyentes) y no tiene que aparecer superpuesto a ella.
  //
  // avisoEmailVerificadoMostradoRef evita mostrarlo más de una vez por
  // sesión de React (este layout puede re-renderizar por otros motivos
  // mientras usuario.debe_avisar_email_verificado sigue en true un
  // instante, hasta que el POST de abajo confirma el apagado en el
  // backend y refrescarPerfil -- si algo la llama -- lo trae de vuelta en
  // false). El apagado en sí es best-effort: si el POST falla (sin red,
  // etc.), el cliente igual ya vio el aviso en pantalla; en el peor caso
  // vuelve a aparecer la próxima vez que se cargue el perfil, no es grave
  // tratándose de un mensaje puramente informativo.
  const avisoEmailVerificadoMostradoRef = useRef(false);
  useEffect(() => {
    if (!usuario?.debe_avisar_email_verificado) {
      return;
    }
    // FIX (13/09/2026, auditoría UX/UI Punto Crítico #7 -- bug introducido
    // el 12/09/2026 junto con este mismo aviso): este useEffect se declara
    // ACÁ ARRIBA, antes del "if (usuario?.debe_cambiar_password) return
    // <CambiarPasswordObligatorio />" de más abajo -- las reglas de hooks
    // no dejan ponerlo después de ese return condicional, así que corre
    // SIEMPRE que debe_avisar_email_verificado venga en true, sin importar
    // qué pantalla se termine renderizando. Sin este chequeo, una cuenta
    // que el backend marcó con las dos señales en true a la vez (un admin
    // le restableció la contraseña Y en algún momento también le verificó
    // el mail -- no son mutuamente excluyentes, ver los dos modelos en
    // app/models/user.py) mostraba este toast de "¡Ya podés usarla con
    // total normalidad!" SUPERPUESTO a la pantalla obligatoria de cambio
    // de contraseña (CambiarPasswordObligatorio.jsx no tiene navbar propio
    // que lo tape, y ToastContainerTema.jsx vive en main.jsx, por encima
    // de todo el router) -- un mensaje de "todo normal" mientras la cuenta
    // sigue bloqueada por otro motivo, justo antes de que el cliente
    // pudiera entender que en realidad no puede usar nada todavía.
    //
    // La solución es simplemente no disparar el aviso mientras
    // debe_cambiar_password siga en true -- ni marcarAvisoEmailVerificadoVisto
    // se llama en ese caso, así que no se "pierde": en el próximo login
    // (una vez cambiada la contraseña, que cierra la sesión y manda a
    // /login -- ver manejarGuardar en CambiarPasswordObligatorio.jsx) este
    // mismo efecto corre de nuevo con un usuario fresco, y si
    // debe_avisar_email_verificado sigue en true del lado del backend, el
    // aviso aparece recién ahí, ya con la tienda normal detrás y no con la
    // pantalla de contraseña obligatoria.
    if (usuario?.debe_cambiar_password) {
      return;
    }
    if (avisoEmailVerificadoMostradoRef.current) {
      return;
    }
    avisoEmailVerificadoMostradoRef.current = true;
    notificarInfo("Un administrador verificó tu cuenta. ¡Ya podés usarla con total normalidad!");
    marcarAvisoEmailVerificadoVisto().catch(() => {
      // Ignorado a propósito, ver el comentario grande de acá arriba.
    });
  }, [usuario]);

  function manejarEnviar(evento) {
    evento.preventDefault();
    const termino = busqueda.trim();
    if (location.pathname === "/catalogo") {
      setSearchParams((actual) => {
        const siguiente = new URLSearchParams(actual);
        if (termino) {
          siguiente.set("nombre", termino);
        } else {
          siguiente.delete("nombre");
        }
        return siguiente;
      });
    } else if (termino) {
      navigate(`/catalogo?nombre=${encodeURIComponent(termino)}`);
    }
  }

  // FIX UX-07 (auditoría UX/UI 26/08/2026, reportado por el cliente): antes
  // se llamaba a cerrarSesion() (que limpia los tokens) y RECIÉN DESPUÉS se
  // navegaba a /login. Ese cambio de tokens dispara, mientras todavía
  // estamos montados sobre la ruta protegida (ej. /configuracion),
  // el propio redirect de RutaProtegida -- y ese redirect SÍ guarda
  // `state.from` (para volver ahí después de loguearse, que es lo correcto
  // cuando alguien intenta entrar a una pantalla protegida sin sesión).
  // Acá no queremos eso: cerrar sesión a propósito en Configuración y volver
  // a entrar te devolvía a Configuración en vez de al inicio. Navegar
  // PRIMERO evita la carrera: al salir de la ruta protegida antes de tocar
  // los tokens, RutaProtegida ya no está montada cuando cambia el estado de
  // sesión, así que nunca llega a redirigir con `from`. Mismo criterio en
  // AdminLayout.jsx y en TarjetaPassword (ConfiguracionPrivacidad.jsx).
  async function manejarCerrarSesion() {
    navigate("/login");
    // Vaciamos el carrito al cerrar sesión: es local (localStorage), no
    // del usuario en el backend -- si no se limpia, en una compu
    // compartida el próximo que inicie sesión vería el carrito de otra
    // persona.
    vaciarCarrito();
    await cerrarSesion();
  }

  // Todavía no sabemos si hay sesión válida (ver AuthContext) -- evita el
  // parpadeo de mostrar la barra de invitado medio segundo y después
  // cambiar de golpe al sidebar completo cuando sí había sesión.
  if (cargando) {
    return (
      <div className="pantalla-centrada">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  // Invitado: solo la marca y los dos accesos que pidió el negocio --
  // nada de sidebar, nada de buscador ni carrito todavía (recién tienen
  // sentido con sesión iniciada). El resto de la tienda sigue detrás de
  // RutaProtegida (ver App.jsx), así que desde acá ni siquiera hay cómo
  // navegar a otra pantalla salvo logueándose o registrándose.
  if (!estaAutenticado) {
    return (
      <div>
        <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom">
          <NavLink to="/" className="text-decoration-none text-body fw-semibold fs-5 text-truncate">
            NovaByte
          </NavLink>
          <div className="d-flex gap-2">
            <Button as={NavLink} to="/login" variant="outline-secondary" size="sm">
              Iniciar sesión
            </Button>
            <Button as={NavLink} to="/register" variant="primary" size="sm">
              Registrarse
            </Button>
          </div>
        </div>
        <Outlet />
      </div>
    );
  }

  // FEATURE (11/09/2026, pedido del cliente): con sesión iniciada pero
  // todavía con la contraseña temporal que le dio un admin (ver
  // admin_reset_password en app/router/users.py), se interpone esta
  // pantalla en vez del sidebar/Outlet normal -- ANTES que cualquier ruta
  // hija, así cubre cualquier URL de la tienda (catálogo, carrito, el
  // panel de administración si encima es staff, lo que sea), no solo la
  // pantalla a la que lo mandaría un login normal. Va después del chequeo
  // de "cargando" de arriba a propósito: recién ahí "usuario" (el perfil
  // de GET /users/me) ya terminó de cargar. Ver
  // CambiarPasswordObligatorio.jsx para el detalle del flujo.
  if (usuario?.debe_cambiar_password) {
    return <CambiarPasswordObligatorio />;
  }

  return (
    <div>
      {/* FEATURE (12/09/2026, pedido del cliente): "pasar el contenido del
          sidebar al navbar" -- ver el comentario grande más arriba. Mismo
          contenido que tenía el aside de siempre (marca, buscador, los seis
          links de navegación, tema y cerrar sesión), ahora en un <Navbar>
          horizontal en vez de un costado fijo.

          FIX (12/09/2026, pedido del cliente): "solamente en celular, el
          navbar cambia el sidebar que teníamos" -- <Navbar.Offcanvas> en
          vez de <Navbar.Collapse>: por debajo del breakpoint de "expand"
          es un panel deslizable de verdad (como el sidebar de siempre), en
          escritorio se ve igual que un navbar común. Ver el comentario
          grande más arriba para el detalle completo.

          FIX (13/09/2026 -- 1ra vuelta, reportado por el cliente con
          captura de pantalla): expand="md" (768px) pasó a expand="xxl"
          (1400px) -- "la app tiene que ser responsive, con la excepción de
          que tanto en tablet como en celular el navbar sea un sidebar".
          Con "md" el contenido se mostraba en línea a partir de 768px
          aunque recién entraba cómodo a partir de ~1400px (medido con
          Playwright contra el CSS compilado de este proyecto).

          FIX (13/09/2026 -- 2da vuelta, mismo día, reportado por el
          cliente con OTRA captura: una notebook común, maximizada,
          todavía mostrando el sidebar): "xxl" (1400px) resolvía el
          reclamo original pero se pasaba para el otro lado -- 1400px de
          ANCHO DE VENTANA es más de lo que tiene la mayoría de las
          notebooks reales (una pantalla de 1366px con el navegador
          maximizado, o una de 1920px con el escalado al 125% que trae
          Windows por defecto en la mayoría de los equipos, dan bastante
          menos de 1400px de ancho disponible para la página). Subir el
          breakpoint no alcanzaba: el contenido en sí (marca + buscador +
          7 secciones + interruptor de tema + "Cerrar sesión") pedía
          ~1380-1400px tal cual estaba armado, y ESE es el problema de
          fondo, no el breakpoint elegido.

          La solución esta vez es compactar el contenido, no correr el
          breakpoint: buscador de 320px a 180px de ancho (sigue siendo un
          buscador usable, no hace falta que sea tan ancho), "Cerrar
          sesión" pasa a ser solo el ícono (con aria-label/title, ver más
          abajo -- mismo criterio de accesibilidad que cualquier botón
          icon-only de la app) y los espacios ícono-texto/entre grupos se
          achican un toque (gap-2 -> gap-1 en cada Nav.Link, gap-3 -> gap-2
          en el grupo de tema+salir). Con esos ajustes, medido de nuevo con
          Playwright, todo entra en una sola línea ya a partir de 1200px --
          "xl", el breakpoint estándar de Bootstrap justo debajo de "xxl",
          que sí cubre notebooks/PCs reales (1366px, 1920px al 125%,
          etc.). Por debajo de 1200px (celulares y la gran mayoría de
          tablets, tanto en portrait como en landscape -- ver el
          comentario grande más arriba) sigue siendo el sidebar deslizable;
          la única excepción real son un puñado de tablets grandes en
          landscape (iPad Pro 12.9" a 1366px lógicos, por ejemplo) que
          quedan del lado del navbar en línea -- aceptable: el criterio
          responsive de acá es el ancho real de la ventana, no el tipo de
          dispositivo, y a ese ancho el contenido entra igual de cómodo que
          en una notebook. */}
      <Navbar expand="xl" className="border-bottom px-3" expanded={expandido} onToggle={setExpandido}>
        {/* FIX (13/09/2026, reportado por el cliente): antes Brand y
            Toggle eran dos hijos sueltos del <Navbar> -- este, por
            defecto, reparte sus hijos con justify-content: space-between,
            así que con el Offcanvas fuera del flujo (position: fixed
            mientras está colapsado) quedaban solo estos dos, uno en cada
            punta: la marca a la izquierda, el botón de "hamburguesa" pegado
            al borde DERECHO. El panel, en cambio, se desliza desde la
            IZQUIERDA (placement="start", ver Navbar.Offcanvas más abajo,
            pensado así a propósito para imitar al sidebar de siempre) --
            quedaba el botón que abre el panel en una punta y el panel
            abriéndose en la opuesta. Envolver Brand+Toggle en un solo
            <div> hace que el <Navbar> los trate como UN solo hijo (ya no
            dos), así que space-between ya no tiene un segundo hijo del
            que separarlos: los dos quedan pegados a la izquierda, del
            mismo lado por el que se abre el panel. En "xl" (navbar en
            línea) esto no cambia nada -- Toggle ya está oculto ahí por
            Bootstrap (.navbar-expand-xl .navbar-toggler{display:none}) y
            el Offcanvas vuelve a ser un hijo normal del flujo, con su
            propio flex-grow para ocupar el resto de la fila. */}
        <div className="d-flex align-items-center gap-2">
          <Navbar.Brand as={NavLink} to="/" onClick={cerrarMenu} className="fw-semibold text-truncate">
            NovaByte
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="navbar-tienda-offcanvas" aria-label={expandido ? "Cerrar menú" : "Abrir menú"} />
        </div>
        <Navbar.Offcanvas id="navbar-tienda-offcanvas" aria-labelledby="navbar-tienda-offcanvas-titulo" placement="start">
          {/* Header/título con botón de cerrar: solo se ve por debajo del
              breakpoint de "expand" -- de ahí para arriba react-bootstrap
              ni siquiera arma el Offcanvas real, así que este bloque no
              aparece ahí (ver el comentario grande de más arriba). */}
          <Offcanvas.Header closeButton>
            <Offcanvas.Title id="navbar-tienda-offcanvas-titulo">NovaByte</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
          {/* FIX (13/09/2026, "2da vuelta" -- ver el comentario grande
              junto al <Navbar> más arriba): 320px a 180px de ancho -- uno
              de los recortes que permiten que todo entre en una sola línea
              ya en "xl" (1200px) en vez de necesitar "xxl" (1400px). Sigue
              siendo un campo de texto usable, no hace falta que sea tan
              ancho para escribir "impresora" o el nombre de un producto. */}
          <Form className="d-flex my-3 my-md-0 me-md-2" style={{ maxWidth: 180 }} onSubmit={manejarEnviar}>
            <Form.Control
              type="search"
              size="sm"
              placeholder="Buscar..."
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              aria-label="Buscar productos"
            />
            <Button type="submit" variant="outline-secondary" size="sm" className="ms-2 d-flex align-items-center">
              <IconoBuscar />
            </Button>
          </Form>

          {/* d-flex align-items-center gap-1 en cada Nav.Link: mismo
              espaciado ícono-texto que tenía .sidebar-tienda .nav-link en
              theme.scss (ese CSS quedó sin uso, ver la nota ahí) -- acá se
              logra igual con clases utilitarias de Bootstrap en vez de un
              selector CSS nuevo, ya que ".nav-link" a secas (el que usa
              react-bootstrap adentro del Navbar) no trae ese flex+gap.

              FIX (13/09/2026, "2da vuelta" -- ver el comentario grande
              junto al <Navbar> más arriba): gap-2 (0.5rem) pasó a gap-1
              (0.25rem) en los siete Nav.Link de acá abajo (y en el botón
              de CatalogoMegaMenu.jsx, mismo criterio) -- uno de varios
              recortes chicos que en conjunto permiten bajar el breakpoint
              de "xxl" a "xl". */}
          <Nav className="me-auto">
            <Nav.Link as={NavLink} to="/" end className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoInicio /> Inicio
            </Nav.Link>
            {/* FIX (13/09/2026, auditoría UX/UI Punto Alto #10, a pedido
                del cliente): antes acá iba <CatalogoMegaMenu>, un
                desplegable de categorías -- ver el comentario grande junto
                al <Navbar> más arriba sobre por qué se simplificó. Ahora es
                un link común, mismo patrón que "Inicio". */}
            <Nav.Link as={NavLink} to="/catalogo" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoGrilla /> Catálogo
            </Nav.Link>
            <Nav.Link as={NavLink} to="/carrito" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoCarrito /> Carrito
              {cantidadTotal > 0 && (
                <Badge bg="primary" pill>
                  {cantidadTotal}
                </Badge>
              )}
            </Nav.Link>
            <Nav.Link as={NavLink} to="/favoritos" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoEstrellaSolida /> Favoritos
            </Nav.Link>
            <Nav.Link as={NavLink} to="/mis-pedidos" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoHistorial /> Historial
            </Nav.Link>
            <Nav.Link as={NavLink} to="/contacto" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
              <IconoTelefono /> Contacto
            </Nav.Link>
            {/* Administración (Productos/Categorías/Pedidos/Usuarios) ya
                no tiene su propio ítem acá -- se mudó adentro de
                Configuración, ver Configuracion.jsx.

                FIX (29/08/2026, pedido del cliente): /configuracion pasó a
                ser solo-staff (ver App.jsx, RutaStaff envolviendo esa
                ruta) -- un cliente que hiciera clic acá solo iba a rebotar
                a "/", así que el link ahora se reparte según el rol: staff
                sigue viendo "Configuración" como siempre, y un cliente ve
                en su lugar "Mi perfil" (/mi-perfil, mismo componente que
                Configuración > Privacidad -- ver ese comentario en
                App.jsx). Mismo lugar del navbar en los dos casos, para no
                mover el resto de los ítems de acá al lado. */}
            {esStaff ? (
              <Nav.Link as={NavLink} to="/configuracion" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
                <IconoEngranaje /> Configuración
              </Nav.Link>
            ) : (
              <Nav.Link as={NavLink} to="/mi-perfil" className="d-flex align-items-center gap-1" onClick={cerrarMenu}>
                <IconoPerfil /> Mi perfil
              </Nav.Link>
            )}
          </Nav>

          {/* FIX (13/09/2026, "2da vuelta" -- ver el comentario grande
              junto al <Navbar> más arriba): gap-3 -> gap-2 en este grupo,
              y "Cerrar sesión" pasa a ser solo el ícono (con
              aria-label/title para que se siga entendiendo qué hace y
              siga siendo accesible -- mismo criterio que cualquier botón
              icon-only del resto de la app) -- entre los dos, parte de lo
              que permite bajar el breakpoint del navbar de "xxl" a "xl". */}
          <div className="d-flex align-items-center gap-2 mt-3 mt-md-0">
            <div className="d-flex align-items-center gap-2">
              <IconoLuna className="text-muted" />
              <Form.Check
                type="switch"
                id="interruptor-tema"
                checked={tema === "dark"}
                onChange={alternarTema}
                className="mb-0"
              />
              <IconoSol className="text-muted" />
            </div>
            <Button
              variant="outline-secondary"
              size="sm"
              className="d-flex align-items-center"
              onClick={manejarCerrarSesion}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <IconoSalir />
            </Button>
          </div>
          </Offcanvas.Body>
        </Navbar.Offcanvas>
      </Navbar>

      <Outlet />
    </div>
  );
}
