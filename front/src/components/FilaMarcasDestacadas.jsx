import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listarMarcasDestacadas } from "../api/store";
import { resolverUrlImagen } from "../utils/imagenes";

// FEATURE (29/08/2026, pedido del cliente): franja pública de "Marcas
// destacadas" en el Home (ver Home.jsx) -- dos filas fijas de 5
// posiciones cada una (1-5 arriba, 6-10 abajo), en el mismo orden que
// carga el admin en Configuración → General (ver
// GrillaMarcasDestacadas.jsx). Las posiciones son fijas a propósito: si
// se elimina una imagen y no se carga otra nueva, las 10 posiciones
// siguen existiendo acá (la que quedó vacía deja el lugar reservado en
// blanco, no se corren ni reorganizan las demás) -- mismo criterio que la
// grilla de carga admin.
//
// FEATURE (30/08/2026, pedido del cliente): "al hacer clic en cualquiera
// de estas imágenes, que mande al catálogo y muestre todos los productos
// de dicha marca" -- mismo destino y mismo parámetro (?marca=...) que ya
// arma el mega menú del navbar (ver irACategoriaYMarca en
// CatalogoMegaMenu.jsx) y que ya sabe leer Catalogo.jsx. Solo se hace
// clickeable si la posición tiene nombre_marca asignado (ver
// GrillaMarcasDestacadas.jsx) -- una imagen cargada antes de que existiera
// este campo, sin marca todavía, se muestra igual pero sin link (el admin
// la termina de configurar desde el panel).
export default function FilaMarcasDestacadas() {
  const [marcas, setMarcas] = useState([]);

  useEffect(() => {
    // Sin estado de error propio: es una franja decorativa del Home, si
    // falla simplemente no se muestra nada (no tiene sentido tapar el
    // resto de la página por esto). Array.isArray por las dudas: si el
    // backend todavía no tiene este endpoint (falta reiniciar el proceso
    // y/o correr la migración de marca_destacada) o algo intermedio
    // devuelve otra cosa con 200 (ej. el fallback de servir_frontend en
    // main.py, que responde index.html para cualquier ruta que no
    // reconoce), respuesta.data no sería un array y marcas.some/.map de
    // acá abajo tirarían un TypeError -- mejor no mostrar nada que romper
    // el Home entero.
    listarMarcasDestacadas()
      .then((respuesta) => setMarcas(Array.isArray(respuesta.data) ? respuesta.data : []))
      .catch(() => {});
  }, []);

  const hayAlgunaImagen = marcas.some((marca) => marca.imagen_url);
  if (!hayAlgunaImagen) {
    return null;
  }

  return (
    <div className="fila-marcas-destacadas">
      {marcas.map((marca) => {
        if (!marca.imagen_url) {
          return (
            <div
              key={marca.posicion}
              className="fila-marcas-destacadas__celda fila-marcas-destacadas__celda--vacia"
            />
          );
        }
        if (!marca.nombre_marca) {
          // Tiene imagen pero todavía no tiene marca asignada -- se
          // muestra igual (así no desaparece de golpe una imagen ya
          // cargada) pero sin link, no hay a qué catálogo mandar.
          return (
            <div key={marca.posicion} className="fila-marcas-destacadas__celda">
              <img src={resolverUrlImagen(marca.imagen_url)} alt="" />
            </div>
          );
        }
        return (
          <Link
            key={marca.posicion}
            to={`/catalogo?marca=${encodeURIComponent(marca.nombre_marca)}`}
            className="fila-marcas-destacadas__celda"
            title={`Ver productos de ${marca.nombre_marca}`}
          >
            <img src={resolverUrlImagen(marca.imagen_url)} alt={marca.nombre_marca} />
          </Link>
        );
      })}
    </div>
  );
}
