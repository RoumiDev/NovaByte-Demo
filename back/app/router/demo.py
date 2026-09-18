"""Limpieza de accesos temporales a la demo vencidos.

FEATURE (17/09/2026, pedido del cliente -- "accesos temporales a la
demo... expiración automática"): esta es la SEGUNDA mitad del mecanismo de
expiración de dos tiempos que ya arranca en get_current_user
(app/dependencies/auth.py) -- ver el comentario grande en DemoTenant
(app/models/demo.py) para el diseño completo. Ese primer chequeo (en cada
request) corta el ACCESO apenas se cumple expires_at, pero no borra nada
de la base: eso lo hace este endpoint, pensado para que lo llame un solo
consumidor -- el Cron Job diario de Vercel (ver vercel.json) -- nunca un
navegador ni el frontend.

Por qué UN SOLO endpoint hace todo el trabajo de limpieza (tenants
vencidos Y reconciliación de pagos pendientes), en vez de dos: el plan
Hobby de Vercel (elegido por el dueño) solo permite UN Cron Job por día
por proyecto -- no hay margen para un segundo cron aparte para
app/jobs/reconciliacion_pagos.py (que en cualquier hosting con proceso
persistente corre solo, cada 1 minuto, vía el scheduler de app/main.py;
ver el comentario ahí sobre por qué eso no es viable en una función
serverless). Ambas tareas son formas de "trabajo de limpieza diferido"
así que comparten el mismo disparador.

GET, no POST (verificado contra la documentación de Vercel, 17/09/2026):
un Cron Job de Vercel SIEMPRE dispara con una petición HTTP GET -- nunca
hay forma de configurarlo para que mande POST. Ese mismo GET viene con un
header "Authorization: Bearer <CRON_SECRET>" agregado automáticamente por
Vercel, siempre y cuando el proyecto tenga una variable de entorno
CRON_SECRET configurada (ver _verificar_secreto_cron más abajo) -- eso es
lo que hace que este endpoint sea seguro pese a ser un GET sin body.
"""

import hmac
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.config import CRON_SECRET
from app.core.database import get_db
from app.jobs.reconciliacion_pagos import procesar_pedidos_pendientes
from app.models.demo import DemoTenant

router = APIRouter()
logger = logging.getLogger("app.demo")


def _verificar_secreto_cron(authorization: str | None = Header(default=None)) -> None:
    """Vercel Cron Jobs agregan solos el header "Authorization: Bearer
    <CRON_SECRET>" a la llamada, cuando el proyecto tiene una variable de
    entorno CRON_SECRET configurada (ver back/DEPLOY.md) -- así es como
    este endpoint distingue esa llamada de cualquier otra. Sin este
    chequeo, cualquiera que adivinara la URL podría disparar la limpieza
    (o, peor, mantenerla siempre vacía llamándola en loop) a voluntad.

    Falla CERRADO si CRON_SECRET no está configurado (ver el comentario en
    app/core/config.py): un despliegue mal configurado rechaza todo en vez
    de aceptar cualquier llamada sin credencial.
    """
    if not CRON_SECRET:
        logger.error("POST /demo/limpieza llamado pero CRON_SECRET no está configurado -- rechazando.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Limpieza no disponible.")

    secreto_recibido = (authorization or "").removeprefix("Bearer ").strip()
    if not secreto_recibido or not hmac.compare_digest(secreto_recibido, CRON_SECRET):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autorizado.")


@router.get("/limpieza", dependencies=[Depends(_verificar_secreto_cron)])
def limpiar_demo(db: Session = Depends(get_db)) -> dict:
    """Borra en cascada todo tenant de demo vencido (y, vía ondelete=CASCADE
    en cada tenant_id -- ver app/models/demo.py -- todo Usuario/Categoria/
    Producto/Pedido que le pertenecía), y de paso corre la reconciliación de
    pedidos pendientes (ver el docstring del módulo, más arriba, sobre por
    qué comparten este mismo disparador en Vercel)."""
    ahora = datetime.now(timezone.utc)

    tenants_vencidos = list(
        db.execute(select(DemoTenant.id).where(DemoTenant.expires_at <= ahora)).scalars()
    )
    if tenants_vencidos:
        db.execute(delete(DemoTenant).where(DemoTenant.id.in_(tenants_vencidos)))
        db.commit()
        logger.info("Limpieza demo: %s tenant(s) vencido(s) eliminado(s): %s", len(tenants_vencidos), tenants_vencidos)

    # Mismo trabajo que hacía el BackgroundScheduler cada 1 minuto fuera de
    # Vercel (ver app/main.py) -- acá corre una vez por día nada más, ver el
    # docstring del módulo sobre por qué eso es aceptable para la demo.
    procesar_pedidos_pendientes()

    return {"tenants_eliminados": len(tenants_vencidos)}
