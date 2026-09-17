// Sin uso: reemplazado por components/SiteLayout.jsx (sidebar vertical
// con botón de abrir/cerrar e ícono por opción, en vez de este navbar
// horizontal fijo arriba de cada página -- ver App.jsx). Se deja este
// archivo en vez de borrarlo porque esta sesión no tiene forma de
// eliminar archivos de tu computadora -- lo podés borrar vos a mano
// (src/components/SiteNavbar.jsx) si querés.
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Dropdown, Form, Nav, Navbar } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useTheme } from "../context/ThemeContext";
import CatalogoMegaMenu from "./CatalogoMegaMenu";

// Ícono de persona (bi-person-circle de Bootstrap Icons) inline como SVG
// para no agregar una dependencia nueva solo por un ícono.
function IconoPersona() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 16 16">
      <path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      <path
        fillRule="evenodd"
        d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 10.226 4.805 9 8 9s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"
      />
    </svg>
  );
}

// Íconos luna/sol (bi-moon-stars-fill / bi-sun-fill) para el interruptor
// de tema -- mismo motivo que IconoPersona, inline para no sumar una
// dependencia nueva.
function IconoLuna(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z" />
    </svg>
  );
}

// Ícono del carrito de compras activo (bi-cart3 de Bootstrap Icons).
function IconoCarrito(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M0 1.5A.5.5 0 0 1 .5 1H2a.5.5 0 0 1 .485.379L2.89 3H14.5a.5.5 0 0 1 .491.592l-1.5 8A.5.5 0 0 1 13 12H4a.5.5 0 0 1-.491-.408L2.01 3.607 1.61 2H.5a.5.5 0 0 1-.5-.5zM3.102 4l1.313 7h8.17l1.313-7H3.102zM5 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-7 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
    </svg>
  );
}

function IconoSol(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.414a.5.5 0 1 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707L4.464 3.757a.5.5 0 0 1 0 .708z" />
    </svg>
  );
}

// Ícono de lupa (bi-search de Bootstrap Icons) para el botón de buscar.
function IconoBuscar(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
    </svg>
  );
}

// Cuánto esperar después de la última tecla antes de actualizar los
// resultados -- ni instantáneo (un pedido HTTP por tecla) ni tan largo
// que se sienta lento.
const DEMORA_BUSQUEDA_MS = 400;

// Barra de navegación para la tienda (no confundir con AdminLayout, que es
// solo para /admin/*). Se muestra en catálogo, carrito, mis pedidos y home.
export default function SiteNavbar() {
  const { esAdmin, cerrarSesion } = useAuth();
  const { cantidadTotal, vaciarCarrito } = useCart();
  const { tema, alternarTema } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Búsqueda global: vive acá (no en Home/Catalogo) para que se pueda
  // buscar desde cualquier pantalla. Si ya estás en /catalogo, el término
  // se combina con categoría/marca sin pisarlos (mismos searchParams); si
  // estás en otra página, te manda a /catalogo?nombre=... directamente.
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

  function manejarEnviar(evento) {
    // Enter o clic en la lupa: aplica el término ya, sin esperar el
    // debounce (que en este caso terminaría haciendo lo mismo un poco
    // después).
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

  async function manejarCerrarSesion() {
    // Vaciamos el carrito al cerrar sesión: es local (localStorage), no
    // del usuario en el backend -- si no se limpia, en una compu
    // compartida el próximo que inicie sesión vería el carrito de otra
    // persona.
    vaciarCarrito();
    await cerrarSesion();
    navigate("/login");
  }

  return (
    <Navbar bg="dark" variant="dark" expand="sm" className="px-3 mb-4">
      <Navbar.Brand as={NavLink} to="/">
        LT Informática
      </Navbar.Brand>
      <Navbar.Toggle aria-controls="site-navbar-nav" />
      <Navbar.Collapse id="site-navbar-nav">
        <Nav className="me-auto">
          {/* El menú desplegable con categorías/productos solo tiene
              sentido a partir del breakpoint en el que el navbar ya está
              expandido (expand="sm" arriba) -- por debajo de eso (menú
              colapsado en hamburguesa) un hover no aplica, así que se
              muestra un link simple en su lugar. */}
          <div className="d-none d-sm-block">
            <CatalogoMegaMenu />
          </div>
          <Nav.Link as={NavLink} to="/catalogo" className="d-sm-none">
            Catálogo
          </Nav.Link>
          <Nav.Link as={NavLink} to="/contacto">
            Contacto
          </Nav.Link>
          {esAdmin && (
            <Nav.Link as={NavLink} to="/admin/productos">
              Administración
            </Nav.Link>
          )}
        </Nav>

        <Form
          className="d-flex mx-sm-auto my-2 my-sm-0"
          style={{ maxWidth: 320, width: "100%" }}
          onSubmit={manejarEnviar}
        >
          <Form.Control
            type="search"
            placeholder="Buscar por producto o categoría..."
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            aria-label="Buscar productos"
          />
          <Button type="submit" variant="outline-light" className="ms-2 d-flex align-items-center">
            <IconoBuscar />
          </Button>
        </Form>

        <Nav className="align-items-sm-center gap-2">
          <Nav.Link
            as={NavLink}
            to="/carrito"
            title="Carrito"
            aria-label="Carrito"
            className="d-flex align-items-center position-relative"
          >
            <IconoCarrito />
            {cantidadTotal > 0 && (
              <Badge
                bg="primary"
                pill
                className="position-absolute top-0 start-100 translate-middle"
                style={{ fontSize: "0.6rem" }}
              >
                {cantidadTotal}
              </Badge>
            )}
          </Nav.Link>
          <Dropdown align="end">
            <Dropdown.Toggle
              variant="outline-light"
              size="sm"
              id="menu-usuario"
              className="d-flex align-items-center gap-2"
            >
              <IconoPersona />
            </Dropdown.Toggle>
            <Dropdown.Menu>
              {/* Antes era un ícono aparte en el navbar (bi-receipt) --
                  se movió acá adentro para no competir con el carrito, y
                  se renombró de "Mis pedidos" a "Historial". */}
              <Dropdown.Item as={NavLink} to="/mis-pedidos">
                Historial
              </Dropdown.Item>
              <Dropdown.Item as={NavLink} to="/configuracion">
                Configuración
              </Dropdown.Item>
              <Dropdown.ItemText className="d-flex align-items-center justify-content-center gap-2">
                <IconoLuna className="text-muted" />
                <Form.Check
                  type="switch"
                  id="interruptor-tema"
                  checked={tema === "dark"}
                  onChange={alternarTema}
                  className="mb-0"
                />
                <IconoSol className="text-muted" />
              </Dropdown.ItemText>
              <Dropdown.Divider />
              <Dropdown.Item onClick={manejarCerrarSesion}>Cerrar sesión</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </Nav>
      </Navbar.Collapse>
    </Navbar>
  );
}
