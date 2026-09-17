// Estado del carrito de compras: varios productos por pedido, cada uno con
// su cantidad. Vive en localStorage para no perderse si el comprador
// recarga la página a mitad de una compra (por ejemplo, entre agregar
// productos y finalizar) -- pero es solo para UX, nunca la fuente de
// verdad del precio. Igual que en el pedido final, el backend siempre
// recalcula precio_unitario/subtotal/total_pedido por su cuenta a partir
// del precio_venta VIGENTE de cada producto (ver PedidoDetalleCreate en
// app/schemas/order.py) -- nada de lo que se guarda acá viaja como precio
// al crear el pedido, solo producto_id y cantidad.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "lti_carrito";

function leerDeStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState(leerDeStorage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Agregar 1 unidad (o la cantidad indicada) de un producto. Si ya estaba
  // en el carrito, suma a lo que había -- en ambos casos, nunca deja
  // cargar más que el stock que el catálogo mostraba en ese momento (el
  // backend igual vuelve a validar el stock real al crear el pedido, esto
  // es solo para no dejar armar un carrito absurdo desde la UI).
  const agregarAlCarrito = useCallback((producto, cantidad = 1) => {
    setItems((actuales) => {
      const tope = producto.stock;
      const existente = actuales.find((item) => item.productoId === producto.id);
      if (existente) {
        const nuevaCantidad = Math.min(existente.cantidad + cantidad, tope);
        return actuales.map((item) =>
          item.productoId === producto.id ? { ...item, cantidad: nuevaCantidad } : item,
        );
      }
      return [
        ...actuales,
        {
          productoId: producto.id,
          nombre: producto.nombre,
          marca: producto.marca,
          precioUnitario: Number(producto.precio_venta),
          imagenUrl: producto.imagen_url,
          stockDisponible: tope,
          cantidad: Math.min(Math.max(cantidad, 1), tope),
        },
      ];
    });
  }, []);

  const actualizarCantidad = useCallback((productoId, cantidad) => {
    setItems((actuales) =>
      actuales.map((item) =>
        item.productoId === productoId
          ? { ...item, cantidad: Math.max(1, Math.min(cantidad, item.stockDisponible)) }
          : item,
      ),
    );
  }, []);

  const quitarDelCarrito = useCallback((productoId) => {
    setItems((actuales) => actuales.filter((item) => item.productoId !== productoId));
  }, []);

  // FIX UX-A3 (auditoría UX/UI 12/09/2026, Punto Crítico #3 "Alto"): hasta
  // acá item.stockDisponible quedaba "congelado" en el valor que tenía el
  // catálogo en el momento de agregarAlCarrito, y nunca se volvía a
  // consultar -- si el stock bajaba (otro comprador se lo llevaba) mientras
  // el producto esperaba en el carrito, el comprador recién se enteraba
  // cuando fallaba "Finalizar compra" (ver Carrito.jsx). Esta función la
  // llama Carrito.jsx al montar, con el stock real recién consultado al
  // backend, para: (a) actualizar el número que se le muestra ("N
  // disponibles"), y (b) bajar la cantidad elegida si ahora supera el stock
  // real -- nunca la sube sola. Si el stock real es 0, la cantidad queda en
  // 0 (en vez del mínimo de 1 que usa el resto del carrito) para que
  // Carrito.jsx pueda distinguir "sin stock" de "cantidad normal" y bloquear
  // el checkout hasta que se quite el producto.
  const actualizarStockDisponible = useCallback((productoId, stockReal) => {
    setItems((actuales) =>
      actuales.map((item) =>
        item.productoId === productoId
          ? {
              ...item,
              stockDisponible: stockReal,
              cantidad: stockReal <= 0 ? 0 : Math.min(item.cantidad, stockReal),
            }
          : item,
      ),
    );
  }, []);

  const vaciarCarrito = useCallback(() => setItems([]), []);

  const cantidadTotal = useMemo(() => items.reduce((total, item) => total + item.cantidad, 0), [items]);

  // Solo para mostrarle al comprador una referencia en la pantalla del
  // carrito -- el total real que se cobra lo calcula el backend en
  // create_order() a partir del precio vigente, nunca este valor.
  const totalEstimado = useMemo(
    () => items.reduce((total, item) => total + item.precioUnitario * item.cantidad, 0),
    [items],
  );

  const value = {
    items,
    agregarAlCarrito,
    actualizarCantidad,
    actualizarStockDisponible,
    quitarDelCarrito,
    vaciarCarrito,
    cantidadTotal,
    totalEstimado,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart debe usarse dentro de <CartProvider>");
  }
  return context;
}
