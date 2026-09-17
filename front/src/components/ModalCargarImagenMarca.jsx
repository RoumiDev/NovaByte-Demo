import { useEffect, useState } from "react";
import { Alert, Button, Form, Image, Modal, Spinner } from "react-bootstrap";
import { listarMarcas, subirImagenProducto } from "../api/products";
import { extraerMensajeError } from "../api/client";
import { resolverUrlImagen } from "../utils/imagenes";

// Mismos límites que valida app/router/products.py (subir_imagen_producto)
// -- mismo criterio "duplicado a propósito" que ya usan Productos.jsx y
// Categorias.jsx (ver el comentario en router/categories.py): esto es
// solo un aviso rápido del lado del cliente antes de subir, el backend
// vuelve a verificarlo igual y es la última palabra.
const _MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const _TIPOS_IMAGEN_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];

// FEATURE (29/08/2026, pedido del cliente): "Marcas destacadas" --
// componente de carga/edición para una posición de GrillaMarcasDestacadas.jsx.
// Sirve para los dos casos:
//   - Posición vacía (marcaActual.imagen_url es null): archivo obligatorio.
//   - Posición ocupada (marcaActual.imagen_url ya tiene algo): se abre para
//     corregir la marca asociada -- FEATURE (30/08/2026, pedido del
//     cliente): "clic en la imagen del Home manda al catálogo con los
//     productos de esa marca", lo que exige guardar a qué marca
//     corresponde cada imagen (ver nombre_marca en app/models/store.py).
//     Acá el archivo es opcional: si no se elige uno nuevo, se conserva
//     la imagen que ya tenía la posición y solo cambia la marca.
//
// Pedido explícito del cliente (29/08/2026): "abrir el mismo componente/
// flujo de carga de imágenes que ya utiliza la carga de productos,
// reutilizando sus validaciones y comportamiento. No dupliques esa
// lógica". La subida en sí llama a subirImagenProducto (api/products.js)
// tal cual -- el mismo endpoint admin-only que ya usa el alta de
// productos, con la misma validación real (tamaño + Pillow) del lado del
// backend. Este componente no reimplementa esa validación: onGuardar
// recibe la URL final (la nueva, o la que ya tenía la posición) y es
// quien la guarda (GrillaMarcasDestacadas.jsx).
//
// El <select> de marca sale de listarMarcas() (api/products.js) -- las
// marcas REALES que ya tienen productos cargados, la misma fuente que usa
// el mega menú del navbar (CatalogoMegaMenu.jsx) para su columna de
// marcas. A propósito NO es un campo de texto libre: el catálogo filtra
// por igualdad exacta contra Producto.marca (ver list_products en
// app/router/products.py), así que un valor que no coincida letra por
// letra jamás encontraría productos al hacer clic.
export default function ModalCargarImagenMarca({ show, marcaActual, onGuardar, onCancelar }) {
  const [archivo, setArchivo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [nombreMarca, setNombreMarca] = useState("");
  const [marcasDisponibles, setMarcasDisponibles] = useState([]);
  const [cargandoMarcas, setCargandoMarcas] = useState(true);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);

  // true cuando la posición ya tenía una imagen (se abrió para corregir la
  // marca, con el archivo como opcional) -- false para una posición vacía
  // (archivo obligatorio).
  const editandoImagenExistente = Boolean(marcaActual?.imagen_url);

  // Reinicia el estado y precarga lo que ya tenía la posición cada vez
  // que el modal se abre -- evita mostrar la vista previa/marca/error de
  // la posición anterior si el admin cierra y abre otra.
  useEffect(() => {
    if (!show) {
      return;
    }
    setArchivo(null);
    setPreviewUrl(marcaActual?.imagen_url ? resolverUrlImagen(marcaActual.imagen_url) : "");
    setNombreMarca(marcaActual?.nombre_marca || "");
    setError("");
    setSubiendo(false);
  }, [show, marcaActual]);

  useEffect(() => {
    if (!show) {
      return;
    }
    setCargandoMarcas(true);
    listarMarcas()
      .then((respuesta) => setMarcasDisponibles(Array.isArray(respuesta.data) ? respuesta.data : []))
      .catch(() => setMarcasDisponibles([]))
      .finally(() => setCargandoMarcas(false));
  }, [show]);

  // Libera la URL de vista previa generada localmente (createObjectURL) al
  // reemplazarla o desmontar -- mismo motivo que en Productos.jsx/Categorias.jsx.
  // No aplica a la vista previa de una imagen ya existente (resolverUrlImagen
  // de una ruta del backend, no un blob: local), revokeObjectURL con eso
  // simplemente no hace nada.
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function manejarSeleccion(event) {
    const elegido = event.target.files?.[0];
    if (!elegido) {
      return;
    }
    if (!_TIPOS_IMAGEN_PERMITIDOS.includes(elegido.type)) {
      setError("La imagen tiene que ser JPG, PNG o WEBP.");
      event.target.value = "";
      return;
    }
    if (elegido.size > _MAX_IMAGEN_BYTES) {
      setError("La imagen no puede superar los 5MB.");
      event.target.value = "";
      return;
    }
    setError("");
    setArchivo(elegido);
    setPreviewUrl(URL.createObjectURL(elegido));
  }

  async function manejarGuardar() {
    if (!archivo && !editandoImagenExistente) {
      return;
    }
    if (!nombreMarca) {
      return;
    }
    setSubiendo(true);
    setError("");
    try {
      // Si no se eligió un archivo nuevo, se conserva la imagen que ya
      // tenía la posición -- este llamado solo está corrigiendo la marca.
      const imagenUrl = archivo ? (await subirImagenProducto(archivo)).data.url : marcaActual.imagen_url;
      // onGuardar es quien guarda (imagen, marca) en la posición y cierra
      // el modal (ver GrillaMarcasDestacadas.jsx) -- si eso falla, el
      // error también se muestra acá.
      await onGuardar(imagenUrl, nombreMarca);
    } catch (err) {
      setError(extraerMensajeError(err));
      setSubiendo(false);
    }
  }

  const sinMarcasCargadas = !cargandoMarcas && marcasDisponibles.length === 0;
  const puedeGuardar = (archivo || editandoImagenExistente) && nombreMarca && !sinMarcasCargadas;

  return (
    <Modal show={show} onHide={() => !subiendo && onCancelar()} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">{editandoImagenExistente ? "Editar marca destacada" : "Cargar imagen de marca"}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3" controlId="imagen-marca-destacada">
          <Form.Label>{editandoImagenExistente ? "Cambiar imagen (opcional)" : "Imagen"}</Form.Label>
          <Form.Control type="file" accept="image/jpeg,image/png,image/webp" onChange={manejarSeleccion} />
          <Form.Text className="text-muted">JPG, PNG o WEBP, hasta 5MB.</Form.Text>
        </Form.Group>

        {previewUrl && (
          <div className="mb-3 text-center">
            <Image src={resolverUrlImagen(previewUrl)} alt="Vista previa" thumbnail style={{ maxHeight: 160 }} />
          </div>
        )}

        <Form.Group controlId="marca-destacada-nombre">
          <Form.Label>Marca</Form.Label>
          {cargandoMarcas ? (
            <div>
              <Spinner animation="border" size="sm" />
            </div>
          ) : sinMarcasCargadas ? (
            <Alert variant="secondary" className="mb-0">
              Todavía no hay marcas cargadas en productos. Cargá algún producto con esa marca antes de poder
              asignarla acá.
            </Alert>
          ) : (
            <Form.Select value={nombreMarca} onChange={(event) => setNombreMarca(event.target.value)}>
              <option value="">Elegí una marca...</option>
              {marcasDisponibles.map((marca) => (
                <option key={marca} value={marca}>
                  {marca}
                </option>
              ))}
            </Form.Select>
          )}
          <Form.Text className="text-muted">
            Al hacer clic en esta imagen en el Home, va a mandar al catálogo filtrado por esta marca.
          </Form.Text>
        </Form.Group>

        {error && (
          <Alert variant="danger" className="mt-3 mb-0">
            {error}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancelar} disabled={subiendo}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={manejarGuardar} disabled={!puedeGuardar || subiendo}>
          {subiendo ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Guardando...
            </>
          ) : (
            "Guardar"
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
