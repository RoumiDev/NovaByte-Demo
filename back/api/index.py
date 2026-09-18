"""Punto de entrada que espera el runtime de Python de Vercel
(@vercel/python) para desplegar el backend COMPLETO como funciones
serverless -- respuesta del dueño a "¿Cómo vas a hospedar la demo?":
"Todo en Vercel: frontend + backend como funciones serverless".

vercel.json (en la raíz de back/) apunta acá como el único build/función
Python del proyecto; toda request HTTP que llega, sea a /api/v1/... o a
/health, termina invocando este archivo (ver la sección "routes" ahí). El
runtime de Vercel para Python sabe envolver una app ASGI (FastAPI lo es)
con tal de que el archivo exponga una variable de módulo llamada "app" --
por eso esto no hace nada más que reexportar la app real bajo ese nombre.
Toda la configuración real (CORS, routers, manejo de errores, static
mounts, etc.) sigue viviendo en un único lugar, app/main.py -- así el
comportamiento es idéntico corriendo acá o con
`uvicorn app.main:app` en desarrollo local.

No mover ni renombrar: vercel.json referencia este archivo por su ruta
exacta, "api/index.py".
"""

import sys
from pathlib import Path

# El runtime de Vercel corre las funciones Python con back/ (el directorio
# que contiene vercel.json) como raíz del proyecto -- pero por las dudas
# (mismo cuidado que back/scripts/crear_acceso_demo.py, ver el comentario
# ahí) se agrega a mano el directorio padre de este archivo (back/) al
# principio de sys.path, así "from app.main import app" encuentra el
# paquete app/ sin depender de cómo Vercel haya resuelto el working
# directory en un caso particular.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402,F401
