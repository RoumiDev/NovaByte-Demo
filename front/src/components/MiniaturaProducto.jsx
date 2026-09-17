import { useState } from "react";
// FIX UX-05 (auditoría UX/UI 26/08/2026, Media #3): ícono movido a
// components/iconos.jsx, ver ese archivo.
import { IconoImagen } from "./iconos";
// FIX B-03 (auditoría QA+Seguridad 28/08/2026): url llega tal cual vino de
// producto.imagen_url (ruta relativa) -- resolverUrlImagen.js arma la URL
// completa acá, en el único componente que renderiza esta miniatura, para
// no repetirlo en MisPedidos.jsx y admin/Pedidos.jsx.
import { resolverUrlImagen } from "../utils/imagenes";

// Miniatura de un producto (pedidos, carrito, lo que haga falta), con
// manejo de imagen rota: si imagen_url está vacío, o el navegador no
// puede cargarlo (link caído), muestra un placeholder en vez del ícono de
// imagen rota del navegador. Compartido entre MisPedidos.jsx y
// pages/admin/Pedidos.jsx para no duplicar la misma lógica dos veces.
export default function MiniaturaProducto({ url, alt, size = 40 }) {
  const [fallo, setFallo] = useState(false);
  const urlResuelta = resolverUrlImagen(url);

  if (!urlResuelta || fallo) {
    return (
      <div
        className="superficie rounded d-flex align-items-center justify-content-center flex-shrink-0 text-muted"
        style={{ width: size, height: size }}
      >
        <IconoImagen />
      </div>
    );
  }

  return (
    <img
      src={urlResuelta}
      alt={alt}
      width={size}
      height={size}
      className="rounded flex-shrink-0 border"
      style={{ objectFit: "cover" }}
      onError={() => setFallo(true)}
    />
  );
}
