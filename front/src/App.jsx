import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import VerificarEmail from "./pages/VerificarEmail";
import OlvidePassword from "./pages/OlvidePassword";
import Home from "./pages/Home";
import Catalogo from "./pages/Catalogo";
import ProductoDetalle from "./pages/ProductoDetalle";
import Carrito from "./pages/Carrito";
import Favoritos from "./pages/Favoritos";
import MisPedidos from "./pages/MisPedidos";
import ConfiguracionLayout from "./pages/ConfiguracionLayout";
import ConfiguracionGeneral from "./pages/ConfiguracionGeneral";
import ConfiguracionStock from "./pages/ConfiguracionStock";
import ConfiguracionRelacionados from "./pages/ConfiguracionRelacionados";
import ConfiguracionPrivacidad from "./pages/ConfiguracionPrivacidad";
import Contacto from "./pages/Contacto";
import ResultadoPago from "./pages/ResultadoPago";
import RutaProtegida from "./components/RutaProtegida";
import RutaAdmin from "./components/RutaAdmin";
import RutaStaff from "./components/RutaStaff";
import SiteLayout from "./components/SiteLayout";
// FIX UX-02 (auditoría UX/UI 26/08/2026, revertido 27/08/2026 a pedido del
// cliente -- ver el comentario largo más abajo, en el bloque
// "administracion" dentro de /configuracion): AdminLayout/AdminIndex ya no
// se usan acá, quedaron huérfanos. Se pueden borrar a mano
// (src/components/AdminLayout.jsx y AdminIndex.jsx) si querés -- esta
// sesión no tiene forma de borrar archivos de tu computadora.
import ConfiguracionAdministracionIndex from "./pages/ConfiguracionAdministracionIndex";
import Productos from "./pages/admin/Productos";
import Categorias from "./pages/admin/Categorias";
import Pedidos from "./pages/admin/Pedidos";
import Usuarios from "./pages/admin/Usuarios";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* Públicas a propósito: quien todavía no tiene sesión (recién
          registrado, o que olvidó la contraseña) tiene que poder llegar
          acá sin estar logueado -- ver router/users.py. */}
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/olvide-password" element={<OlvidePassword />} />

      {/* Rutas a las que Mercado Pago redirige al comprador tras el pago
          (MP_SUCCESS_URL/FAILURE_URL/PENDING_URL en el .env del backend).
          Públicas a propósito: si la sesión expiró durante el pago, el
          comprador igual tiene que poder ver esta pantalla y no un login
          inesperado -- el estado real del pedido lo confirma el webhook,
          no esta página. */}
      <Route path="/pago/exito" element={<ResultadoPago resultado="exito" />} />
      <Route path="/pago/error" element={<ResultadoPago resultado="error" />} />
      <Route path="/pago/pendiente" element={<ResultadoPago resultado="pendiente" />} />

      {/* Todas las pantallas de la tienda comparten el layout de
          SiteLayout.jsx -- pero, a diferencia de antes, el layout en sí ya
          NO está protegido por RutaProtegida: Home ("/") tiene que poder
          verse sin sesión iniciada (invitado), así que SiteLayout decide
          él mismo qué mostrar según haya o no sesión (sidebar completo si
          hay sesión, barra simple con "Iniciar sesión"/"Registrarse" si
          no). Las demás pantallas de la tienda siguen protegidas, cada
          una por separado con su propio RutaProtegida. */}
      <Route element={<SiteLayout />}>
        <Route path="/" element={<Home />} />
        <Route
          path="/catalogo"
          element={
            // FIX UX-01 (auditoría UX/UI 26/08/2026, Punto Crítico #1):
            // mensaje contextual para que quien entra sin sesión sepa por
            // qué lo mandamos a loguearse (antes era un redirect mudo).
            <RutaProtegida mensaje="Iniciá sesión para ver el catálogo completo.">
              <Catalogo />
            </RutaProtegida>
          }
        />
        {/* Detalle de un producto puntual: se abre al hacer clic en una
            tarjeta del catálogo/Home (ver GrillaProductos.jsx). Pública a
            propósito, igual que Home ("/"): un visitante sin sesión tiene
            que poder entrar a leer la descripción de un producto desde el
            Home sin que lo manden al login solo por mirar. El backend ya
            expone GET /productos/{id} como endpoint público. Lo que sí
            sigue exigiendo sesión es "Agregar al carrito" adentro de la
            pantalla (mismo criterio que Home -- ver manejarAgregar en
            ProductoDetalle.jsx). */}
        <Route path="/productos/:id" element={<ProductoDetalle />} />
        <Route
          path="/carrito"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para ver tu carrito.">
              <Carrito />
            </RutaProtegida>
          }
        />
        {/* Favoritos: opción nueva del sidebar (ver SiteLayout.jsx). Igual
            que Carrito/Historial, exige sesión -- un favorito es propio
            de un usuario, no tiene sentido sin login (mismo criterio que
            el backend, que también exige sesión para /productos/favoritos
            y /productos/{id}/favorito). */}
        <Route
          path="/favoritos"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para ver tus favoritos.">
              <Favoritos />
            </RutaProtegida>
          }
        />
        <Route
          path="/mis-pedidos"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para ver tus pedidos.">
              <MisPedidos />
            </RutaProtegida>
          }
        />
        {/* FEATURE (29/08/2026, pedido del cliente): "Mi perfil" -- acceso
            para clientes a la misma pantalla que Configuración > Privacidad
            (mismo componente, ConfiguracionPrivacidad.jsx, reusado tal
            cual: ver ese archivo, no depende de estar montado adentro de
            ConfiguracionLayout). Existe porque /configuracion pasó a ser
            solo-staff (ver más abajo) -- un cliente ya no puede llegar a
            Privacidad por ese camino, así que esta ruta aparte, con su
            propio link en el sidebar (ver SiteLayout.jsx), es de dónde
            gestiona su cuenta. Solo exige sesión, no un rol puntual: un
            admin/ayudante que entre acá a mano ve exactamente lo mismo que
            ya tiene en Configuración > Privacidad, así que no hace falta
            bloqueárselo. */}
        <Route
          path="/mi-perfil"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para ver tu perfil.">
              <ConfiguracionPrivacidad />
            </RutaProtegida>
          }
        />
        {/* Configuración ahora es, a su vez, su propio mini-layout con
            sidebar fijo (General / Administración / Privacidad -- ver
            ConfiguracionLayout.jsx). "Más opciones" a futuro es agregar
            una ruta hija acá + un link en ese sidebar.

            FIX (29/08/2026, pedido del cliente): toda la sección pasó a
            requerir esStaff (RutaStaff, además de la sesión que ya exigía
            RutaProtegida) -- un cliente ya no tiene nada que hacer acá
            (Productos/Categorías/Pedidos/Usuarios/Stock/Relac. Produc. son
            todas cosas de administración; lo único que un cliente
            realmente usaba, Privacidad, ahora vive aparte en /mi-perfil,
            ver más arriba). El link "Configuración" del sidebar también se
            ocultó para clientes (ver SiteLayout.jsx) -- no tiene sentido
            mostrar un link que solo va a rebotar a "/". */}
        <Route
          path="/configuracion"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para acceder a tu configuración.">
              <RutaStaff>
                <ConfiguracionLayout />
              </RutaStaff>
            </RutaProtegida>
          }
        >
          <Route index element={<ConfiguracionGeneral />} />
          {/* === FIX UX-02 (auditoría UX/UI 26/08/2026, Punto Crítico #2) ===
              El informe de auditoría encontró que /admin/* y
              /configuracion/administracion/* eran dos URLs distintas para
              el mismo panel (Productos/Categorías/Pedidos/Usuarios), y la
              primera versión de este fix unificó todo bajo /admin/* como
              ruta canónica.
              === REVERTIDO 27/08/2026 (pedido del cliente) ===============
              El cliente probó /admin/productos y notó que AdminLayout.jsx
              renderiza su propia barra superior distinta (navbar oscura
              "LT-Informática · Admin", sin nada del sidebar/navegación de
              la tienda) -- da la sensación de entrar a otra aplicación
              aparte, exactamente la confusión de "¿dónde estoy?" que el
              punto crítico original quería evitar. Se volvió al esquema
              opuesto: /configuracion/administracion/* pasa a ser la ÚNICA
              ruta canónica, con Productos/Categorías/Pedidos/Usuarios
              como rutas hijas de acá adentro (compartiendo el mismo
              SiteLayout + ConfiguracionLayout de toda la sección
              Configuración, nunca un layout aparte). El sidebar de
              Configuración (ConfiguracionLayout.jsx) volvió a tener
              "Administración" como desplegable con los cuatro links
              adentro, en vez de un link de salida a /admin. AdminLayout.jsx
              y AdminIndex.jsx quedaron sin uso (ver el comentario en los
              imports, arriba) -- /admin/* ahora es la URL vieja, con un
              redirect más abajo (mismo criterio que el redirect que existía
              antes en sentido contrario). */}
          <Route
            path="administracion"
            element={
              <RutaStaff>
                <Outlet />
              </RutaStaff>
            }
          >
            <Route index element={<ConfiguracionAdministracionIndex />} />
            <Route
              path="productos"
              element={
                <RutaAdmin>
                  <Productos />
                </RutaAdmin>
              }
            />
            <Route
              path="categorias"
              element={
                <RutaAdmin>
                  <Categorias />
                </RutaAdmin>
              }
            />
            <Route
              path="usuarios"
              element={
                <RutaAdmin>
                  <Usuarios />
                </RutaAdmin>
              }
            />
            {/* Pedidos no lleva RutaAdmin: es justamente lo que un
                ayudante sí puede ver, y RutaStaff (arriba) ya exigió
                admin-o-ayudante. */}
            <Route path="pedidos" element={<Pedidos />} />
          </Route>
          {/* "Stock" es una opción propia del sidebar (no adentro del
              desplegable de Administración): listado de todos los
              productos con filtros (nombre/categoría/estado del stock) y
              un input de stock por fila para cargar reposiciones rápido,
              sin abrir el modal completo de Productos. Solo-admin, igual
              que Productos/Categorías/Usuarios. */}
          <Route
            path="stock"
            element={
              <RutaAdmin>
                <ConfiguracionStock />
              </RutaAdmin>
            }
          />
          {/* "Relac. Produc." -- opción propia del sidebar (ver
              ConfiguracionLayout.jsx), no adentro del desplegable de
              Administración: armar/quitar vínculos entre productos
              mirando el catálogo separado por categoría en las dos
              listas. Solo-admin, igual que Stock. */}
          <Route
            path="relacionados"
            element={
              <RutaAdmin>
                <ConfiguracionRelacionados />
              </RutaAdmin>
            }
          />
          {/* BORRADO (29/08/2026, pedido del cliente): la ruta "backup" y
              ConfiguracionBackup.jsx (backup/restauración manual desde la
              app) se dieron de baja -- los dos backups que quedan son el
              del servidor de hosting y, más adelante, un script aparte.
              ConfiguracionBackup.jsx y api/backup.js quedaron sin uso: se
              pueden borrar a mano, esta sesión no tiene forma de eliminar
              archivos de tu computadora. */}
          <Route path="privacidad" element={<ConfiguracionPrivacidad />} />
        </Route>
        <Route
          path="/contacto"
          element={
            // FIX UX-01: mismo criterio que /catalogo, ver ahí.
            <RutaProtegida mensaje="Iniciá sesión para contactarnos.">
              <Contacto />
            </RutaProtegida>
          }
        />
      </Route>

      {/* FIX UX-02 (revertido 27/08/2026, pedido del cliente -- ver el
          comentario largo en el bloque "administracion" dentro de
          /configuracion más arriba): /admin/* dejó de existir como árbol
          de rutas propio -- Productos/Categorías/Pedidos/Usuarios ahora
          viven en /configuracion/administracion/*, la ruta canónica.
          Este catch-all redirige cualquier /admin/lo-que-sea a la nueva
          URL para no romper un link guardado como favorito o compartido
          antes de este cambio (mismo criterio que el redirect que existía
          antes en sentido contrario). No intenta preservar la subruta
          exacta (ej. /admin/productos no manda directo a
          /configuracion/administracion/productos, sino al índice) --
          mismo criterio simple que ya usaba el redirect anterior. */}
      <Route path="/admin/*" element={<Navigate to="/configuracion/administracion" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
