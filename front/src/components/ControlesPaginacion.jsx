import { Button } from "react-bootstrap";

// FIX (13/09/2026, auditoría UX/UI Punto Crítico #3: "límite silencioso de
// 100 registros sin paginación, repetido en 6 pantallas"). Controles
// "Anterior"/"Siguiente" compartidos por las 4 tablas de gestión (admin/
// Usuarios.jsx, admin/Productos.jsx, admin/Categorias.jsx,
// ConfiguracionStock.jsx) -- un solo lugar para esta lógica en vez de 4
// copias que se puedan desincronizar con el tiempo (mismo criterio que ya
// usa el proyecto para TarjetaProducto.jsx/ModalConfirmarPassword.jsx).
//
// Los listados del backend son listas simples, sin un total (ver
// list_products/list_users/list_categories en app/router) -- por eso
// "haySiguiente" no sale de un total, lo calcula cada pantalla pidiendo un
// elemento de más por página (limit+1) y descartándolo del render: si
// volvieron más elementos que el tamaño de página, hay una página siguiente.
// Ver el comentario de cada pantalla en su función de carga.
//
// "pagina" es 0-indexado puertas adentro (para sumar directo con
// skip = pagina * TAMANO_PAGINA) pero se muestra como "Página N" 1-indexada.
export default function ControlesPaginacion({ pagina, haySiguiente, cargando, onAnterior, onSiguiente }) {
  return (
    <div className="d-flex justify-content-between align-items-center mt-3">
      <div className="text-muted small">Página {pagina + 1}</div>
      <div className="d-flex gap-2">
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={pagina === 0 || cargando}
          onClick={onAnterior}
        >
          ← Anterior
        </Button>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={!haySiguiente || cargando}
          onClick={onSiguiente}
        >
          Siguiente →
        </Button>
      </div>
    </div>
  );
}
