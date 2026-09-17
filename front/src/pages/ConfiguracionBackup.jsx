// SIN USO (29/08/2026, pedido del cliente): el backup/restauración manual
// desde la app se dio de baja -- App.jsx ya no tiene la ruta
// /configuracion/backup ni el link en el sidebar (ver
// pages/ConfiguracionLayout.jsx), así que esta pantalla no se puede abrir
// más. De acá en más los dos backups vigentes son el del servidor de
// hosting y, más adelante, un script aparte. Se deja este archivo en vez
// de borrarlo porque esta sesión no tiene forma de eliminar archivos de tu
// computadora -- lo podés borrar vos a mano
// (src/pages/ConfiguracionBackup.jsx) si querés, junto con src/api/backup.js.
import { useState } from "react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";
import { descargarBackup, restaurarBackup } from "../api/backup";
import { extraerMensajeError } from "../api/client";
import { notificarExito } from "../utils/notificaciones";

// Mismo criterio que router/backup.py (_FRASE_CONFIRMACION): hay que
// escribirla literal, mayúsculas incluidas, para habilitar el botón
// "Restaurar" -- primera de las dos confirmaciones que exige el backend
// (la segunda es la contraseña del admin logueado).
const _FRASE_CONFIRMACION = "RESTAURAR";

// Sub-sección "Backup" de Configuración (solo-admin, ver App.jsx/
// ConfiguracionLayout.jsx): descargar un backup COMPLETO (dump de la base
// -- productos, categorías, pedidos, usuarios, historial -- MÁS una copia
// de las imágenes actuales de productos/categorías, todo en un único
// .zip firmado) y restaurar todo eso a partir de un backup previo. Las
// imágenes viven aparte de la base, como archivos planos en
// storage/productos y storage/categorias (ver
// STORAGE_PRODUCTOS_DIR/STORAGE_CATEGORIAS_DIR en app/core/config.py) --
// por eso hace falta empaquetarlas junto con el dump: sin esto, restaurar
// en un servidor nuevo deja los productos con imagen_url apuntando a un
// archivo que no existe en ningún lado.
export default function ConfiguracionBackup() {
  return (
    <div className="d-flex flex-column gap-4">
      <h1 className="h3 mb-0">Backup</h1>
      <TarjetaDescargar />
      <TarjetaRestaurar />
    </div>
  );
}

function TarjetaDescargar() {
  const [password, setPassword] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");

  async function manejarDescargar(event) {
    event.preventDefault();
    setError("");
    setDescargando(true);
    try {
      const respuesta = await descargarBackup(password);
      // El nombre real del archivo (con la fecha/hora, ver
      // generar_backup_sql en app/services/backup_service.py) viaja en el
      // header Content-Disposition -- el backend lo expone explícitamente
      // vía CORS (expose_headers en app/main.py) justo para que esto
      // funcione en un request cross-origin.
      const disposition = respuesta.headers["content-disposition"] || "";
      const coincidencia = disposition.match(/filename="?([^";]+)"?/);
      const nombreArchivo = coincidencia ? coincidencia[1] : "backup.zip";

      const url = URL.createObjectURL(respuesta.data);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = nombreArchivo;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
      notificarExito("Backup descargado.");
      setPassword("");
    } catch (err) {
      setError(await extraerMensajeErrorDescarga(err));
    } finally {
      setDescargando(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3">Descargar backup</Card.Title>
        <p className="text-muted small mb-3">
          Genera un backup completo -- la base de datos entera (productos, categorías, pedidos, usuarios,
          historial de cambios de rol/estado) MÁS las imágenes actuales de productos y categorías -- y lo
          descarga como un único archivo .zip. No queda ninguna copia guardada en el servidor: se genera al
          toque y se borra apenas termina de mandarse. Con este único archivo alcanza para reconstruir la
          app entera en otro servidor, ninguna imagen queda rota.
        </p>
        <p className="text-muted small mb-3">
          Pide tu contraseña para confirmar: este archivo trae todos los datos personales de los clientes
          (incluidos los hashes de sus contraseñas), así que la descarga tiene la misma fricción que borrar
          una categoría.
        </p>
        <Form onSubmit={manejarDescargar} noValidate>
          <Form.Group className="mb-3" controlId="backup-descargar-password" style={{ maxWidth: "320px" }}>
            <Form.Label>Tu contraseña</Form.Label>
            <Form.Control
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </Form.Group>

          {error && <Alert variant="danger">{error}</Alert>}

          <Button variant="primary" type="submit" disabled={!password || descargando}>
            {descargando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Generando...
              </>
            ) : (
              "Descargar backup"
            )}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}

function TarjetaRestaurar() {
  const [archivo, setArchivo] = useState(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mensajeExito, setMensajeExito] = useState("");
  const [restaurando, setRestaurando] = useState(false);

  const listoParaRestaurar = archivo && confirmacion === _FRASE_CONFIRMACION && password;

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");
    setMensajeExito("");

    if (!archivo) {
      setError("Elegí el archivo de backup (.zip) que querés restaurar.");
      return;
    }
    if (confirmacion !== _FRASE_CONFIRMACION) {
      setError(`Para confirmar, escribí exactamente "${_FRASE_CONFIRMACION}".`);
      return;
    }

    setRestaurando(true);
    try {
      const respuesta = await restaurarBackup({ confirmacion, passwordActual: password, archivo });
      // El mensaje que devuelve el backend recuerda cerrar sesión y volver
      // a entrar -- se deja como Alert fijo en la pantalla (no un toast que
      // desaparece solo) porque es una recomendación que el admin todavía
      // tiene que leer y actuar, no solo una confirmación de "listo".
      setMensajeExito(respuesta.data?.detail || "Backup restaurado.");
      setArchivo(null);
      setConfirmacion("");
      setPassword("");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setRestaurando(false);
    }
  }

  return (
    <Card className="shadow-sm border-danger">
      <Card.Body className="p-4">
        <Card.Title className="h6 mb-3 text-danger">Restaurar backup</Card.Title>

        <Alert variant="danger">
          <strong>Operación irreversible.</strong> Restaurar reemplaza TODO el contenido actual -- base de
          datos e imágenes de productos/categorías -- por lo que había en el backup subido -- no se fusiona
          ni se agrega, se pisa entero. No hay forma de deshacer esto salvo restaurando un backup más nuevo.
          Asegurate de estar subiendo el archivo correcto antes de confirmar. Solo se acepta el .zip que
          genera esta misma app en "Descargar backup" -- cualquier otro archivo se rechaza.
        </Alert>

        {mensajeExito && (
          <Alert variant="success" onClose={() => setMensajeExito("")} dismissible>
            {mensajeExito}
          </Alert>
        )}

        <Form onSubmit={manejarEnvio} noValidate>
          <Form.Group className="mb-3" controlId="backup-archivo">
            <Form.Label>Archivo de backup (.zip)</Form.Label>
            <Form.Control
              type="file"
              accept=".zip"
              onChange={(event) => setArchivo(event.target.files?.[0] || null)}
              required
            />
          </Form.Group>

          <Form.Group className="mb-3" controlId="backup-confirmacion">
            <Form.Label>
              Para confirmar, escribí <strong>{_FRASE_CONFIRMACION}</strong>
            </Form.Label>
            <Form.Control
              type="text"
              value={confirmacion}
              onChange={(event) => setConfirmacion(event.target.value)}
              placeholder={_FRASE_CONFIRMACION}
              required
              autoComplete="off"
            />
          </Form.Group>

          <Form.Group className="mb-3" controlId="backup-password">
            <Form.Label>Tu contraseña</Form.Label>
            <Form.Control
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </Form.Group>

          {error && <Alert variant="danger">{error}</Alert>}

          <Button variant="danger" type="submit" disabled={!listoParaRestaurar || restaurando}>
            {restaurando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Restaurando...
              </>
            ) : (
              "Restaurar"
            )}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}

// El GET de descarga usa responseType: "blob" (ver api/backup.js) -- con
// eso, axios entrega CUALQUIER respuesta como Blob, errores incluidos, así
// que err.response.data acá es un Blob, no el JSON {detail: "..."} que
// arma extraerMensajeError (api/client.js) para el resto de la app. Esto
// lo lee como texto y lo reintenta parsear como JSON antes de caer al
// mensaje genérico.
async function extraerMensajeErrorDescarga(error) {
  const blob = error?.response?.data;
  if (blob instanceof Blob) {
    try {
      const texto = await blob.text();
      const datos = JSON.parse(texto);
      if (typeof datos?.detail === "string") {
        return datos.detail;
      }
    } catch {
      // No era JSON legible -- cae al mensaje genérico de extraerMensajeError.
    }
  }
  return extraerMensajeError(error);
}
