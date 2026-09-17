// FEATURE (26/08/2026, pedido del cliente): las 24 provincias argentinas
// (23 provincias + CABA), en el mismo orden y con los mismos "value" que
// el Enum Provincia del backend (app/models/user.py) -- si se agrega o
// renombra algo ahí, actualizar acá también.
//
// Único lugar donde vive esta lista en el frontend: tanto Register.jsx
// como ConfiguracionPrivacidad.jsx la importan de acá, para no mantener
// 24 opciones duplicadas en dos formularios (mismo criterio que
// components/iconos.jsx con los íconos repetidos).
export const PROVINCIAS = [
  { value: "Buenos Aires", label: "Buenos Aires" },
  { value: "Catamarca", label: "Catamarca" },
  { value: "Chaco", label: "Chaco" },
  { value: "Chubut", label: "Chubut" },
  { value: "Ciudad Autónoma de Buenos Aires", label: "Ciudad Autónoma de Buenos Aires (CABA)" },
  { value: "Córdoba", label: "Córdoba" },
  { value: "Corrientes", label: "Corrientes" },
  { value: "Entre Ríos", label: "Entre Ríos" },
  { value: "Formosa", label: "Formosa" },
  { value: "Jujuy", label: "Jujuy" },
  { value: "La Pampa", label: "La Pampa" },
  { value: "La Rioja", label: "La Rioja" },
  { value: "Mendoza", label: "Mendoza" },
  { value: "Misiones", label: "Misiones" },
  { value: "Neuquén", label: "Neuquén" },
  { value: "Río Negro", label: "Río Negro" },
  { value: "Salta", label: "Salta" },
  { value: "San Juan", label: "San Juan" },
  { value: "San Luis", label: "San Luis" },
  { value: "Santa Cruz", label: "Santa Cruz" },
  { value: "Santa Fe", label: "Santa Fe" },
  { value: "Santiago del Estero", label: "Santiago del Estero" },
  { value: "Tierra del Fuego, Antártida e Islas del Atlántico Sur", label: "Tierra del Fuego" },
  { value: "Tucumán", label: "Tucumán" },
];
