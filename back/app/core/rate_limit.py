"""Rate limiting simple en memoria para endpoints sensibles (login, registro).

No se agregó una dependencia externa (slowapi u otra) a propósito: para un
único proceso esto alcanza y queda auditable en pocas líneas. Limitación
conocida: si el despliegue de producción corre más de un worker/instancia
(lo habitual detrás de un balanceador), cada proceso lleva su propio conteo
y el límite real efectivo se multiplica por la cantidad de procesos. Para
rate limiting compartido entre procesos hace falta un backend centralizado
(por ejemplo Redis), o aplicarlo a nivel de gateway/WAF/reverse proxy.

También asume que request.client.host refleja la IP real del cliente. Detrás
de un proxy (Nginx, un balanceador, Cloudflare, etc.) eso va a ser la IP del
proxy salvo que el servidor ASGI esté configurado para confiar en cabeceras
tipo X-Forwarded-For de un proxy conocido (en uvicorn: --proxy-headers y
--forwarded-allow-ips). Configurar eso es una decisión de infraestructura
que queda fuera del código de la aplicación.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    """Limita a max_requests la cantidad de llamadas por IP en window_seconds."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        client_ip = request.client.host if request.client else "desconocido"
        now = time.monotonic()
        with self._lock:
            hits = self._hits.get(client_ip)
            if hits is not None:
                while hits and now - hits[0] > self.window_seconds:
                    hits.popleft()
                if not hits:
                    # No quedan intentos dentro de la ventana: borrar la
                    # clave en vez de dejar un deque vacío colgado para
                    # siempre. Sin esto, self._hits crece sin límite durante
                    # toda la vida del proceso, una entrada por cada IP
                    # distinta que haya pasado alguna vez por acá (hallazgo
                    # R-04 del informe de auditoría).
                    del self._hits[client_ip]
                    hits = None

            if hits is not None and len(hits) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Demasiados intentos. Probá de nuevo en unos minutos.",
                )
            self._hits[client_ip].append(now)


# Instancias compartidas (un solo objeto por proceso: el estado debe persistir
# entre requests, por eso se crean acá y no dentro de la función del endpoint).
login_rate_limiter = RateLimiter(max_requests=5, window_seconds=60)
register_rate_limiter = RateLimiter(max_requests=3, window_seconds=60)
# Cambio de contraseña: no tenía límite (hallazgo R-02). Ventana más laja que
# el login porque quien llega acá ya está autenticado, pero igual acota el
# intento de fuerza bruta contra password_actual con un access_token robado.
password_change_rate_limiter = RateLimiter(max_requests=5, window_seconds=300)

# FEATURE (30/08/2026, hallazgo del informe QA+Seguridad 30/08/2026 --
# "Falta de rate limiting y de logging de auditoría en la confirmación de
# contraseña ('sudo') para acciones administrativas destructivas"):
# verificar_password_admin (app/dependencies/auth.py) nunca tuvo límite de
# intentos, a diferencia de login/cambio de contraseña propio -- alguien con
# una sesión de admin robada (pero sin la contraseña real) podía probar
# contraseñas sin límite contra los cinco endpoints que la usan (edición/baja
# de productos y categorías, vaciar una marca destacada) más el sexto que se
# sumó después (cambiar rol/activar-desactivar un usuario, ver
# admin_update_user en router/users.py). Mismo criterio que
# password_change_rate_limiter (5/300s): quien llega hasta acá ya está
# autenticado, así que la ventana es más laja que login, pero igual acota la
# fuerza bruta.
#
# OJO al usarlo: en los endpoints donde password_actual es OPCIONAL (solo se
# exige si el PATCH toca ciertos campos -- ver update_product en
# router/products.py, update_category en router/categories.py y
# admin_update_user en router/users.py) este limiter NO va como
# dependencies=[] del decorador -- eso lo contaría en CADA request al
# endpoint, incluidas las que no tocan contraseña para nada (ej. los updates
# de stock sueltos de ConfiguracionStock.jsx), y terminaría bloqueando ese
# uso legítimo y frecuente. En esos casos se llama a mano --
# confirmar_password_admin_rate_limiter(request) -- solo dentro del bloque
# que efectivamente exige la contraseña. En los endpoints donde la
# contraseña SIEMPRE es obligatoria (deactivate_product, delete_category,
# eliminar_marca_destacada) sí va como dependencies=[], igual que
# password_change_rate_limiter acá arriba.
confirmar_password_admin_rate_limiter = RateLimiter(max_requests=5, window_seconds=300)

# Códigos de 6 dígitos por mail (ver app/services/verification_service.py):
# dos limiters separados porque "pedir un código" y "probar un código" son
# abusos distintos. _solicitud es más estricto -- cada pedido dispara un
# mail real (costo/cuota del proveedor SMTP), y además es el punto donde
# alguien podría intentar bombardear de mails la casilla de otra persona.
codigo_solicitud_rate_limiter = RateLimiter(max_requests=3, window_seconds=300)
# _intento es más laja (typos pasan), pero sigue acotando el ataque de
# fuerza bruta contra el espacio de 1.000.000 de códigos posibles -- en
# conjunto con el límite de intentos por código puntual (_INTENTOS_MAXIMOS
# en verification_service.py), que actúa aunque se reparta esto entre
# varias IPs.
codigo_intento_rate_limiter = RateLimiter(max_requests=10, window_seconds=300)

# BORRADO (29/08/2026, pedido del cliente): acá vivían
# backup_descarga_rate_limiter y backup_restaurar_rate_limiter, usadas por
# router/backup.py (dado de baja, ver comentario en app/router/__init__.py).