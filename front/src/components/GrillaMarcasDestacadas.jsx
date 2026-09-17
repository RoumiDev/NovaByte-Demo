import { useEffect, useState } from "react";
import { Alert, Spinner } from "react-bootstrap";
import {
  eliminarMarcaDestacada,
  establecerMarcaDestacada,
  listarMarcasDestacadas,
} from "../api/store";
import { extraerMensajeError } from "../api/client";
import { resolverUrlImagen } from "../utils/imagenes";
import { IconoCerrarMenu, IconoMas } from "./iconos";
import ModalCargarImagenMarca from "./ModalCargarImagenMarca";
import ModalConfirmarPassword from "./ModalConfirmarPassword";
import { notificarExito } from "../utils/notificaciones";

// FEATURE (29/08/2026, pedido del cliente): grilla de administración de
// "Marcas destacadas" (Configuración → General, solo admin -- ver
// ConfiguracionGeneral.jsx, que la monta). Especificación exacta del
// cliente:
//   - 10 posiciones FIJAS, cuadradas, nunca una 11ª.
//   - Posición con imagen: la imagen ocupa el cuadrado; al pasar el mouse
//     aparece una X arriba a la derecha para eliminarla; al eliminar, la
//     posición queda vacía y las demás NO se corren ni reorganizan.
//   - Posición vacía: marco cuadrado de líneas discontinuas blancas con un
//     "+" centrado; un clic abre el mismo flujo de carga de imágenes que
//     ya usan los productos (ver ModalCargarImagenMarca.jsx).
//   - Eliminar pide la contraseña del admin (mismo componente que
//     Productos.jsx/Categorias.jsx, ver ModalConfirmarPassword).
// El número de posiciones -- y que sean siempre 1..10, sin correrse -- lo
// garantiza el backend (ver MarcaDestacada en app/models/store.py):
// eliminar solo vacía imagen_url, nunca borra la fila.
//
// FEATURE (30/08/2026, pedido del cliente): "al hacer clic en cualquiera
// de estas imágenes [en el Home], que mande al catálogo y muestre todos
// los productos de dicha marca". Para eso cada imagen necesita una marca
// asociada (nombre_marca) -- acá, un clic en una posición OCUPADA (fuera
// del botón X) también abre ModalCargarImagenMarca, precargado con la
// imagen y marca actuales, para asignarla o corregirla sin tener que
// borrar y volver a subir el archivo. Las posiciones que ya tenían imagen
// antes de este campo (nombre_marca NULL) se marcan con un aviso.
export default function GrillaMarcasDestacadas() {
  const [marcas, setMarcas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Posición cuyo modal de carga está abierto (null = ninguno).
  const [posicionCargando, setPosicionCargando] = useState(null);
  // Posición pendiente de confirmar eliminación con contraseña (null = ninguna).
  const [posicionEliminando, setPosicionEliminando] = useState(null);

  async function cargarDatos() {
    setCargando(true);
    setError("");
    try {
      const respuesta = await listarMarcasDestacadas();
      if (!Array.isArray(respuesta.data)) {
        // A diferencia de FilaMarcasDestacadas.jsx (Home, decorativa: ahí
        // sí conviene no mostrar nada) -- ACÁ es la pantalla de carga del
        // admin, así que si el backend todavía no tiene este endpoint
        // (falta reiniciar el proceso y/o correr la migración de
        // marca_destacada) o algo intermedio devuelve otra cosa con 200
        // (ej. el fallback de servir_frontend en main.py, que responde
        // index.html para cualquier ruta que no reconoce), hay que
        // avisarlo en vez de mostrar una grilla vacía sin explicación.
        setError(
          "No se pudo cargar la sección de marcas destacadas. Verificá que el backend tenga aplicada " +
            "la migración de marca_destacada (alembic upgrade head) y que el proceso se haya reiniciado."
        );
        return;
      }
      setMarcas(respuesta.data);
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarDatos();
  }, []);

  // Se llama desde ModalCargarImagenMarca una vez que ya tiene la URL final
  // de la imagen (nueva, o la misma que ya tenía la posición si solo se
  // corrigió la marca) y la marca elegida -- acá se guardan las dos en la
  // posición elegida.
  async function manejarGuardarImagen(url, nombreMarca) {
    await establecerMarcaDestacada(posicionCargando, url, nombreMarca);
    setMarcas((prev) =>
      prev.map((marca) =>
        marca.posicion === posicionCargando ? { ...marca, imagen_url: url, nombre_marca: nombreMarca } : marca
      )
    );
    setPosicionCargando(null);
    notificarExito("Marca destacada guardada.");
  }

  // Se llama desde ModalConfirmarPassword una vez confirmada la contraseña.
  async function confirmarEliminar(password) {
    await eliminarMarcaDestacada(posicionEliminando, password);
    setMarcas((prev) =>
      prev.map((marca) =>
        marca.posicion === posicionEliminando ? { ...marca, imagen_url: null, nombre_marca: null } : marca
      )
    );
    setPosicionEliminando(null);
    notificarExito("Imagen eliminada.");
  }

  // Posición cuyo modal está abierto (para precargar imagen/marca actuales
  // en ModalCargarImagenMarca) -- null mientras el modal está cerrado.
  const marcaEnEdicion =
    posicionCargando !== null ? marcas.find((marca) => marca.posicion === posicionCargando) || null : null;

  if (cargando) {
    return <Spinner animation="border" size="sm" />;
  }

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  return (
    <>
      <div className="grilla-marcas-destacadas">
        {marcas.map((marca) => (
          <div key={marca.posicion} className="grilla-marcas-destacadas__celda">
            {marca.imagen_url ? (
              <div
                className="marca-destacada-slot"
                role="button"
                tabIndex={0}
                title={marca.nombre_marca ? `Editar "${marca.nombre_marca}"` : "Asignarle una marca a esta imagen"}
                onClick={() => setPosicionCargando(marca.posicion)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPosicionCargando(marca.posicion);
                  }
                }}
              >
                <img src={resolverUrlImagen(marca.imagen_url)} alt={marca.nombre_marca || `Marca destacada ${marca.posicion}`} />
                {/* FEATURE (30/08/2026): posiciones con imagen pero sin
                    marca asignada todavía (cargadas antes de este campo) --
                    sin esto el clic en el Home no tendría a dónde mandar. */}
                {!marca.nombre_marca && (
                  <span className="marca-destacada-slot__etiqueta marca-destacada-slot__etiqueta--aviso">
                    Sin marca asignada
                  </span>
                )}
                <button
                  type="button"
                  className="marca-destacada-slot__eliminar"
                  title="Eliminar imagen"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPosicionEliminando(marca.posicion);
                  }}
                >
                  <IconoCerrarMenu width={14} height={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="marca-destacada-slot marca-destacada-slot--vacio"
                title={`Cargar imagen (posición ${marca.posicion})`}
                onClick={() => setPosicionCargando(marca.posicion)}
              >
                <IconoMas width={26} height={26} />
              </button>
            )}
          </div>
        ))}
      </div>

      <ModalCargarImagenMarca
        show={posicionCargando !== null}
        marcaActual={marcaEnEdicion}
        onGuardar={manejarGuardarImagen}
        onCancelar={() => setPosicionCargando(null)}
      />

      <ModalConfirmarPassword
        show={posicionEliminando !== null}
        titulo="Confirmar eliminación"
        mensaje="¿Eliminar esta imagen de marca destacada? Confirmá tu contraseña para continuar."
        textoConfirmar="Eliminar"
        variantConfirmar="danger"
        onConfirmar={confirmarEliminar}
        onCancelar={() => setPosicionEliminando(null)}
      />
    </>
  );
}
