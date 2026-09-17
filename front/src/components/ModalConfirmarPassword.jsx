import { useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { extraerMensajeError } from "../api/client";

// FEATURE (27/08/2026, pedido del cliente): "cuando se quiera confirmar un
// cambio o dar de baja alguna Categoría o Producto, pida la contraseña del
// admin" -- modal reutilizable, lo usan tanto Productos.jsx (editar/dar de
// baja) como Categorias.jsx (editar/eliminar).
//
// No reemplaza el login: el admin ya está autenticado (ver require_admin en
// el backend) -- es un paso extra tipo "sudo" para frenar un cambio hecho
// sin querer, o una sesión dejada abierta en una computadora compartida. La
// verificación real es del lado del backend (verificar_password_admin en
// app/dependencies/auth.py); este modal solo la pide y muestra el error si
// el backend la rechaza (contraseña incorrecta -- 403, ver el comentario en
// esa función sobre por qué no es 401).
//
// onConfirmar(password) hace la llamada real a la API -- si tira, el modal
// se queda abierto mostrando el motivo (extraerMensajeError) para
// reintentar; si resuelve, es responsabilidad de quien lo usa cerrar el
// modal (onCancelar) y refrescar lo que corresponda.
export default function ModalConfirmarPassword({
  show,
  titulo,
  mensaje,
  textoConfirmar = "Confirmar",
  variantConfirmar = "primary",
  onConfirmar,
  onCancelar,
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  function cerrar() {
    if (enviando) {
      return;
    }
    setPassword("");
    setError("");
    onCancelar();
  }

  async function manejarEnvio(event) {
    event.preventDefault();
    setError("");
    setEnviando(true);
    try {
      await onConfirmar(password);
      setPassword("");
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal show={show} onHide={cerrar} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">{titulo}</Modal.Title>
      </Modal.Header>
      <Form onSubmit={manejarEnvio} noValidate>
        <Modal.Body>
          {mensaje && <p>{mensaje}</p>}
          <Form.Group controlId="confirmar-password-admin">
            <Form.Label>Tu contraseña</Form.Label>
            <Form.Control
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoFocus
              autoComplete="current-password"
            />
          </Form.Group>
          {error && (
            <Alert variant="danger" className="mt-3 mb-0">
              {error}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={cerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant={variantConfirmar} type="submit" disabled={enviando || !password}>
            {enviando ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Confirmando...
              </>
            ) : (
              textoConfirmar
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
