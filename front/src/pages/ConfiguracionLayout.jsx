import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button, Col, Container, Nav, Offcanvas, Row } from "react-bootstrap";
import { useAuth } from "../context/AuthContext";
import { IconoAbrirMenu } from "../components/iconos";

// Layout de la sección Configuración: sidebar con la lista de
// sub-secciones (General / Administración / Stock / Privacidad). De "md"
// para arriba es fijo y siempre visible, igual que siempre; por debajo se
// colapsa a un panel deslizable cerrado por defecto -- ver el FIX UX-04
// más abajo para el detalle.
//
// === FIX UX-02 (auditoría UX/UI 26/08/2026, Punto Crítico #2) ===========
// "Administración" solía ser un desplegable adentro de este mismo sidebar
// que mostraba Productos/Categorías/Pedidos/Usuarios en un segundo árbol
// de rutas (/configuracion/administracion/*) -- duplicaba exactamente el
// panel de /admin/*, con dos URLs distintas para la misma pantalla. La
// primera versión de este fix lo cambió por un link directo a /admin (la
// ruta canónica de entonces).
// === REVERTIDO 27/08/2026 (pedido del cliente) ===========================
// El cliente probó /admin/productos y notó que se siente como "otra
// aplicación" (AdminLayout.jsx tiene su propia barra superior oscura, sin
// nada del sidebar de la tienda) -- justo la confusión de "¿dónde estoy?"
// que el punto crítico original quería evitar. Ahora es al revés:
// /configuracion/administracion/* es la ÚNICA ruta canónica (ver App.jsx),
// así que "Administración" volvió a ser un desplegable acá mismo con
// Productos/Categorías/Pedidos/Usuarios como rutas hijas, en vez de un
// link de salida -- todo se ve siempre dentro de este mismo layout.
// ==========================================================================
//
// === FIX UX-04 (auditoría UX/UI 30/08/2026, hallazgo Alto #4) ===========
// Hasta acá el sidebar era una <Col> común (xs={12} md={3} lg={2}) sin
// ningún mecanismo de colapso: en pantallas <768px se renderizaba a ancho
// completo, apilado ARRIBA del contenido -- cualquier staff que entrara a
// Configuración desde el celular o una tablet tenía que scrollear más allá
// de toda la navegación (incluidos los 4 sub-ítems de "Administración" si
// estaba abierto) antes de ver la tabla/formulario que quería usar.
//
// La recomendación del informe era aplicar el mismo patrón colapsable de
// SiteLayout.jsx (sidebar-overlay a mano, con su propio backdrop y botón)
// o usar un Offcanvas/acordeón cerrado por defecto en <md. Se eligió la
// segunda opción: <Offcanvas responsive="md"> es el componente que
// react-bootstrap ya trae para EXACTAMENTE este caso (un sidebar de panel
// que se comporta distinto según el ancho) -- por debajo de "md" se
// esconde como un panel deslizable cerrado por defecto (con su propio
// backdrop y cierre con Escape, gratis, sin reimplementar nada de eso a
// mano); de "md" para arriba se ve exactamente igual que antes, una
// columna fija siempre visible. Reimplementar el patrón de SiteLayout acá
// hubiera significado un SEGUNDO sidebar-overlay con SU propio botón
// hamburguesa conviviendo con el de SiteLayout (este layout ya vive
// adentro de ese, ver el comentario grande en ese archivo) -- dos
// "menús" superpuestos en la misma barra angosta de celular. Con
// Offcanvas no hace falta: el sidebar de Configuración solo se comporta
// como un panel deslizable propio cuando hace falta (<768px) y el resto
// del tiempo es la misma columna fija de siempre.
export default function ConfiguracionLayout() {
  const { esAdmin, esStaff } = useAuth();
  const location = useLocation();
  // Arranca abierto si ya se está en alguna pantalla de Administración
  // (ej. al recargar la página en /configuracion/administracion/productos)
  // -- si no, el desplegable se vería cerrado tapando la sección activa.
  const [administracionAbierta, setAdministracionAbierta] = useState(
    location.pathname.startsWith("/configuracion/administracion")
  );

  // FIX UX-04: estado del panel deslizable en <768px -- arranca cerrado,
  // igual que el criterio que ya usa SiteLayout.jsx para su propio
  // sidebar en celular ("250px de sidebar se come casi toda la
  // pantalla"). De "md" para arriba, Offcanvas ignora este estado por
  // completo y siempre se muestra (ver responsive="md" más abajo).
  const [sidebarMovilAbierto, setSidebarMovilAbierto] = useState(false);

  // Elegir cualquier opción del menú lo cierra solo en celular/tablet --
  // mismo criterio que el sidebar de SiteLayout.jsx ("ya navegaste a
  // donde querías ir, no hace falta que se quede abierto tapando la
  // pantalla nueva"). En "md" para arriba no hace nada (el panel ya está
  // siempre visible, no hay nada que cerrar).
  function cerrarEnMovil() {
    setSidebarMovilAbierto(false);
  }

  return (
    <Container fluid className="pt-4 pb-5">
      <div className="d-flex d-md-block align-items-center justify-content-between mb-4">
        <h1 className="h3 mb-0 mb-md-4">Configuración</h1>
        {/* FIX UX-04: solo existe por debajo de "md" -- de ahí para
            arriba el sidebar ya está siempre visible, así que no hace
            falta ningún botón para mostrarlo/ocultarlo. */}
        <Button
          variant="outline-secondary"
          size="sm"
          className="d-md-none d-flex align-items-center gap-2"
          onClick={() => setSidebarMovilAbierto(true)}
          aria-label="Abrir menú de Configuración"
        >
          <IconoAbrirMenu /> Menú
        </Button>
      </div>
      <Row>
        <Col md={3} lg={2} className="mb-3 mb-md-0">
          <Offcanvas
            show={sidebarMovilAbierto}
            onHide={() => setSidebarMovilAbierto(false)}
            responsive="md"
            className="sidebar-admin"
          >
            <Offcanvas.Header closeButton>
              <Offcanvas.Title>Configuración</Offcanvas.Title>
            </Offcanvas.Header>
            <Offcanvas.Body className="py-3">
              <Nav className="flex-column">
                <Nav.Link as={NavLink} to="/configuracion" end onClick={cerrarEnMovil}>
                  General
                </Nav.Link>

                {/* Solo tiene sentido para admin/ayudante -- un cliente no
                    tiene nada que hacer en Productos/Categorías/Pedidos/
                    Usuarios.
                    FIX UX-02 (revertido 27/08/2026): desplegable con
                    Productos/Categorías/Pedidos/Usuarios como rutas hijas de
                    /configuracion/administracion (ver App.jsx) -- ver el
                    comentario largo arriba del componente. */}
                {esStaff && (
                  <>
                    <Nav.Link
                      as="button"
                      type="button"
                      className="d-flex justify-content-between align-items-center w-100 bg-transparent border-0 text-start"
                      onClick={() => setAdministracionAbierta((prev) => !prev)}
                      aria-expanded={administracionAbierta}
                    >
                      Administración
                      <span aria-hidden="true">{administracionAbierta ? "▾" : "▸"}</span>
                    </Nav.Link>
                    {administracionAbierta && (
                      <Nav className="flex-column ps-3">
                        {esAdmin && (
                          <Nav.Link
                            as={NavLink}
                            to="/configuracion/administracion/productos"
                            onClick={cerrarEnMovil}
                          >
                            Productos
                          </Nav.Link>
                        )}
                        {esAdmin && (
                          <Nav.Link
                            as={NavLink}
                            to="/configuracion/administracion/categorias"
                            onClick={cerrarEnMovil}
                          >
                            Categorías
                          </Nav.Link>
                        )}
                        <Nav.Link as={NavLink} to="/configuracion/administracion/pedidos" onClick={cerrarEnMovil}>
                          Pedidos
                        </Nav.Link>
                        {esAdmin && (
                          <Nav.Link as={NavLink} to="/configuracion/administracion/usuarios" onClick={cerrarEnMovil}>
                            Usuarios
                          </Nav.Link>
                        )}
                      </Nav>
                    )}
                  </>
                )}

                {/* Solo-admin, igual que Productos/Categorías/Usuarios dentro
                    del desplegable de arriba -- ver ConfiguracionStock.jsx. */}
                {esAdmin && (
                  <Nav.Link as={NavLink} to="/configuracion/stock" onClick={cerrarEnMovil}>
                    Stock
                  </Nav.Link>
                )}

                {/* Solo-admin: armar/quitar vínculos entre productos (ej. una
                    impresora con su tóner) -- ver ConfiguracionRelacionados.jsx. */}
                {esAdmin && (
                  <Nav.Link as={NavLink} to="/configuracion/relacionados" onClick={cerrarEnMovil}>
                    Relac. Produc.
                  </Nav.Link>
                )}

                {/* BORRADO (29/08/2026, pedido del cliente): el link a "Backup"
                    (/configuracion/backup, ConfiguracionBackup.jsx) se dio de
                    baja junto con la ruta en App.jsx -- ver el comentario ahí. */}

                <Nav.Link as={NavLink} to="/configuracion/privacidad" onClick={cerrarEnMovil}>
                  Privacidad
                </Nav.Link>
              </Nav>
            </Offcanvas.Body>
          </Offcanvas>
        </Col>
        <Col md={9} lg={10}>
          <Outlet />
        </Col>
      </Row>
    </Container>
  );
}
