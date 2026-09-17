import { useEffect, useState } from "react";
import { Alert, Container, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import { extraerMensajeError } from "../api/client";
import { listarFavoritos } from "../api/products";
import { useCart } from "../context/CartContext";
import GrillaProductos from "../components/GrillaProductos";

// "Favoritos" del sidebar (ver SiteLayout.jsx): productos que el usuario
// marcó con la estrella en ProductoDetalle.jsx. Mismo componente de grilla
// que Home/Catalogo (GrillaProductos) -- para sacar un producto de acá no
// hay un botón aparte en la tarjeta: se entra a su ficha (clic en la
// tarjeta) y se lo desmarca con la misma estrella con la que se marcó, así
// no hay dos formas distintas de hacer lo mismo en dos pantallas.
export default function Favoritos() {
  const [favoritos, setFavoritos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Feedback momentáneo de "Agregado" en el botón que se tocó -- mismo
  // patrón que Catalogo.jsx.
  const [agregadoId, setAgregadoId] = useState(null);
  const { agregarAlCarrito } = useCart();

  useEffect(() => {
    listarFavoritos()
      .then((respuesta) => setFavoritos(respuesta.data))
      .catch((err) => setError(extraerMensajeError(err)))
      .finally(() => setCargando(false));
  }, []);

  function manejarAgregar(producto) {
    agregarAlCarrito(producto, 1);
    setAgregadoId(producto.id);
    setTimeout(() => setAgregadoId((actual) => (actual === producto.id ? null : actual)), 1500);
  }

  const productos = favoritos.map((favorito) => favorito.producto);

  return (
    <Container className="pb-5 pt-4">
      <h1 className="h3 mb-4">Favoritos</h1>

      {error && <Alert variant="danger">{error}</Alert>}

      {cargando ? (
        <Spinner animation="border" />
      ) : productos.length === 0 ? (
        <Alert variant="secondary">
          Todavía no marcaste ningún producto como favorito. Entrá a la ficha de un producto y tocá la
          estrella para guardarlo acá.{" "}
          <Alert.Link as={Link} to="/catalogo">
            Ir al catálogo
          </Alert.Link>
        </Alert>
      ) : (
        <GrillaProductos productos={productos} agregadoId={agregadoId} onAgregar={manejarAgregar} />
      )}
    </Container>
  );
}
