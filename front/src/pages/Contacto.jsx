import { useEffect, useState } from "react";
import { Card, Col, Container, Row } from "react-bootstrap";
import { obtenerConfiguracionTienda } from "../api/store";
// FIX UX-05 (auditoría UX/UI 26/08/2026, Media #3): íconos movidos a
// components/iconos.jsx, ver ese archivo.
import { IconoInstagram, IconoWhatsapp } from "../components/iconos";

// -----------------------------------------------------------------------
// Datos de la tienda.
//   DIRECCION: solo texto, para mostrarlo arriba del mapa (el mapa en sí
//     usa MAPA_EMBED_SRC, que ya trae la ubicación exacta).
//   MAPA_EMBED_SRC: el src del <iframe> que exporta Google Maps
//     (Compartir > Insertar un mapa) -- pegalo tal cual, ya apunta al
//     local exacto (usa el place ID, no una búsqueda por texto).
//   WHATSAPP: el local usa dos líneas -- una entrada del array por cada
//     número. numero va con código de país, sin "+", sin espacios ni
//     guiones (ej. Argentina: "549" + código de área sin 0 + número sin
//     15 -- típicamente "5493511234567"). etiqueta es el texto del botón,
//     cambialo si "Ventas"/"Servicio técnico" no es lo que corresponde a
//     cada línea.
//   INSTAGRAM_USUARIO: el @ de Instagram, sin el "@".
// -----------------------------------------------------------------------
// Datos ficticios para la demo (ver DEMO.md en la raíz del repo) -- el
// negocio real detrás de este código no es "NovaByte" ni tiene local en
// esta dirección. Reemplazar por los datos reales si este archivo se usa
// para una tienda de verdad.
const DIRECCION = "Av. Siempre Viva 123, Ciudad Autónoma de Buenos Aires";
const MAPA_EMBED_SRC =
  "https://www.google.com/maps?q=Buenos+Aires,+Argentina&output=embed";
const WHATSAPP = [
  { numero: "5491100000001", etiqueta: "Ventas" },
  { numero: "5491100000002", etiqueta: "Servicio técnico" },
];
const INSTAGRAM_USUARIO = "novabyte.demo";

const WHATSAPP_MENSAJE = "Hola! Quería hacer una consulta.";

// Página de Contacto: sin formulario propio -- el canal de consulta es
// WhatsApp/Instagram directo, más el mapa para ubicar el local. Si más
// adelante se agrega un formulario que guarde consultas en el backend,
// va acá adentro, en una card aparte.
export default function Contacto() {
  const linkInstagram = `https://instagram.com/${INSTAGRAM_USUARIO}`;

  // Horarios: los carga el dueño desde Configuración (solo admin) -- acá
  // se muestran tal cual los haya escrito, no hay formato fijo. Si todavía
  // no cargó nada (horarios_atencion null) no se muestra la sección.
  const [horarios, setHorarios] = useState(null);

  useEffect(() => {
    obtenerConfiguracionTienda()
      .then((respuesta) => setHorarios(respuesta.data.horarios_atencion))
      .catch(() => {
        // Si falla, simplemente no se muestra la sección -- no es un dato
        // crítico como para bloquear el resto de la página con un error.
      });
  }, []);

  return (
    <Container className="pb-5 pt-4">
      <h1 className="h3 mb-4">Contacto</h1>

      <Row className="g-4">
        <Col md={5}>
          <Card className="superficie shadow-sm h-100">
            <Card.Body className="d-flex flex-column gap-3">
              <div>
                <Card.Subtitle className="text-muted mb-1">Dirección</Card.Subtitle>
                <Card.Text className="mb-0">{DIRECCION}</Card.Text>
              </div>

              <div className="d-flex flex-column gap-2 mt-2">
                {WHATSAPP.map(({ numero, etiqueta }) => (
                  <a
                    key={numero + etiqueta}
                    href={`https://wa.me/${numero}?text=${encodeURIComponent(WHATSAPP_MENSAJE)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-success d-flex align-items-center justify-content-center gap-2"
                  >
                    <IconoWhatsapp />
                    WhatsApp {etiqueta}
                  </a>
                ))}
                <a
                  href={linkInstagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-instagram d-flex align-items-center justify-content-center gap-2"
                >
                  <IconoInstagram />
                  Seguinos en Instagram
                </a>
              </div>

              {horarios && (
                <div>
                  <Card.Subtitle className="text-muted mb-1">Horario de atención</Card.Subtitle>
                  <Card.Text className="mb-0" style={{ whiteSpace: "pre-line" }}>
                    {horarios}
                  </Card.Text>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col md={7}>
          <Card className="superficie shadow-sm h-100 overflow-hidden">
            <iframe
              title="Ubicación de NovaByte"
              src={MAPA_EMBED_SRC}
              width="100%"
              height="100%"
              style={{ border: 0, minHeight: 320 }}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
