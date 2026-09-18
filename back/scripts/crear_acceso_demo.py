"""Script MANUAL para dar de alta un acceso temporal a la demo pública.

FEATURE (17/09/2026, pedido del cliente): "cuando el usuario me pide un
acceso a la demo, desde mi portafolio pueda darle una credencial temporal
(como admin)... pero que ambas cuentas no choquen, que el usuario 'A' no
vea los productos que cargó el usuario 'B'". El dueño eligió el flujo
MANUAL (no un botón de autoservicio en el sitio): cada vez que alguien le
pide ver la demo, el dueño corre este script a mano y le manda por
WhatsApp/mail/LinkedIn el email + contraseña que imprime.

Qué hace, en orden:
  1. Crea una fila nueva en DemoTenant (app/models/demo.py) con
     expires_at = ahora + --horas.
  2. Crea un Usuario admin propio de ese tenant (tenant_id apuntando a la
     fila anterior) -- ver el comentario grande en Usuario.tenant_id
     (app/models/user.py) sobre cómo get_current_user/get_tenant_scope
     usan esta columna para aislar a cada visitante.
  3. Llama a sembrar_catalogo() (app/services/demo_catalog.py) para que
     ese tenant arranque con categorías/productos de muestra ya cargados
     -- así el visitante ve de entrada cómo luce el catálogo, y además
     puede probar el alta/edición sin partir de una pantalla vacía.
  4. Imprime el email, la contraseña generada y el vencimiento, para que
     el dueño los copie y se los mande a la persona.

email_verificado=True y debe_cambiar_password=False a propósito: es una
cuenta de prueba de duración acotada, no tiene sentido pedirle a un
visitante que verifique un mail que no existe ni que cambie una
contraseña que va a dejar de servir en un rato.

Cómo correrlo (con el venv activado, desde back/, contra la base que use
la demo -- Neon en producción, o la base local de siempre en desarrollo):
    python scripts/crear_acceso_demo.py --horas 4 --etiqueta "LinkedIn - Juan Perez"

--horas es opcional (default 4). --etiqueta es opcional (nota interna
nada más, nunca se le muestra a quien usa la demo -- ver el comentario en
DemoTenant.etiqueta).
"""

import argparse
import secrets
import string
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Permite correr el script como "python scripts/crear_acceso_demo.py" desde
# back/ sin que haga falta instalar el proyecto como paquete -- mismo
# problema que tendría cualquier script en scripts/ que necesite importar
# app.*, seed_demo.py no lo necesita porque vive directo en back/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.auth.security import get_password_hash  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.demo import DemoTenant  # noqa: E402
from app.models.user import TipoDocumento, Usuario, condicionIVA  # noqa: E402
from app.services.demo_catalog import sembrar_catalogo  # noqa: E402

_HORAS_DEFAULT = 4

# Alfabeto sin caracteres ambiguos (0/O, 1/l/I) -- la contraseña se lee y
# se tipea a mano (el dueño se la pasa a alguien por chat), así que vale la
# pena evitar que alguien confunda un 0 con una O al escribirla.
_ALFABETO_PASSWORD = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")


def _generar_password(longitud: int = 12) -> str:
    return "".join(secrets.choice(_ALFABETO_PASSWORD) for _ in range(longitud))


def _generar_numero_documento(tenant_id: int) -> str:
    """usuarios.numero_documento es unique=True -- se arma a partir del id
    del tenant (que ya es único) más un sufijo random corto, para que dos
    corridas de este script nunca puedan llegar a chocar."""
    return f"DEMO{tenant_id:06d}{secrets.token_hex(2)}"


def crear_acceso_demo(horas: int, etiqueta: str | None) -> None:
    db = SessionLocal()
    try:
        ahora = datetime.now(timezone.utc)
        vencimiento = ahora + timedelta(hours=horas)

        tenant = DemoTenant(etiqueta=etiqueta, expires_at=vencimiento)
        db.add(tenant)
        db.commit()
        db.refresh(tenant)

        email_demo = f"demo-{tenant.id}@novabyte-demo.local"
        password_demo = _generar_password()

        usuario = Usuario(
            email=email_demo,
            razon_social=etiqueta or f"Visitante demo #{tenant.id}",
            password_hash=get_password_hash(password_demo),
            tipo_documento=TipoDocumento.dni,
            numero_documento=_generar_numero_documento(tenant.id),
            condicion_iva=condicionIVA.consumidor_final,
            telefono="0000000000",
            direccion=None,
            ciudad=None,
            provincia=None,
            codigo_postal=None,
            is_active=True,
            # admin, no cliente: el pedido explícito era que la persona
            # pueda "ver como es la aplicación por dentro... como es cargar
            # un producto, categoría, etc." -- eso exige el panel admin.
            role="admin",
            tenant_id=tenant.id,
            email_verificado=True,
            debe_cambiar_password=False,
        )
        db.add(usuario)
        db.commit()

        # sembrar_catalogo hace sus propios commits (ver
        # app/services/demo_catalog.py) -- no hace falta uno más acá.
        sembrar_catalogo(db, tenant.id)

        print("Acceso demo creado.")
        print(f"  Tenant id:   {tenant.id}")
        if etiqueta:
            print(f"  Etiqueta:    {etiqueta}")
        print(f"  Vence:       {vencimiento.isoformat()} ({horas}hs desde ahora)")
        print()
        print("Credenciales para mandarle a la persona:")
        print(f"  Email:       {email_demo}")
        print(f"  Contraseña:  {password_demo}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crea un acceso temporal a la demo pública de NovaByte.")
    parser.add_argument(
        "--horas",
        type=int,
        default=_HORAS_DEFAULT,
        help=f"Horas hasta que el acceso expire solo (default: {_HORAS_DEFAULT}).",
    )
    parser.add_argument(
        "--etiqueta",
        type=str,
        default=None,
        help="Nota interna para identificar a quién corresponde este acceso (nunca se le muestra a la persona).",
    )
    args = parser.parse_args()
    if args.horas <= 0:
        parser.error("--horas tiene que ser un número mayor a 0.")
    crear_acceso_demo(args.horas, args.etiqueta)
