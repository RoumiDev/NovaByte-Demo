# Desplegar la demo pública en Vercel

Esta guía es solo para la **demo pública** que se muestra en el portafolio
(el "todo en Vercel: frontend + backend como funciones serverless" que
eligió el dueño) -- no tiene nada que ver con cómo corre la tienda real
hoy (esa sigue en su propio hosting, sin tocar).

## Arquitectura, en una frase

Dos proyectos de Vercel separados, cada uno apuntando a una carpeta de
este mismo repo:

- **`novabyte-demo-api`** -- Root Directory = `back/`. Se despliega como
  funciones serverless de Python (ver `back/vercel.json` y
  `back/api/index.py`). Habla con una base Postgres en **Neon** y (para
  las imágenes que se suban durante la demo) con **Vercel Blob**.
- **`novabyte-demo-front`** -- Root Directory = `front/`. Se despliega
  como sitio estático (Vercel detecta Vite solo, build de siempre:
  `npm run build`, carpeta `dist/`). Habla con el proyecto de arriba por
  HTTP, en un dominio `.vercel.app` distinto -- por eso hacen falta los
  ajustes de CORS/cookies de más abajo, que NO hacen falta cuando el
  frontend se sirve desde la propia API (ver `FRONTEND_DIST_DIR` en
  `app/core/config.py`, pensado para el otro escenario: un túnel local).

Por qué dos proyectos y no uno solo sirviendo todo: `FRONTEND_DIST_DIR`
(pensado para túneles de desarrollo, ver el comentario ahí) espera
encontrar la carpeta `front/dist` DENTRO del mismo directorio que
despliega la API -- con Root Directory = `back/`, Vercel nunca sube
`front/` a esa función, así que ese modo "todo en un origen" no aplica
acá. Dos proyectos con Root Directory distinto es la forma estándar de
Vercel para un monorepo con back y front separados.

## 1. Base de datos (Neon)

1. Crear un proyecto en [neon.tech](https://neon.tech) (plan gratuito
   alcanza).
2. Copiar la **connection string en modo pooled** (la que Neon marca como
   "Pooled connection", con `-pooler` en el host) -- es la que hay que usar
   como `DATABASE_URL`. El motor ya se configuró en modo `NullPool` +
   `pool_pre_ping=True` (ver `app/core/database.py`) porque una función
   serverless no puede mantener un pool de conexiones propio entre
   invocaciones -- confía en el pooler de Neon para eso.
3. Correr las migraciones UNA VEZ, desde tu máquina, apuntando
   `DATABASE_URL` (en tu `.env` local o exportada en la shell) a esa
   connection string de Neon:
   ```
   cd back
   alembic upgrade head
   ```

## 2. Imágenes (Vercel Blob)

1. En el dashboard del proyecto `novabyte-demo-api` (una vez creado, ver
   paso 4): **Storage → Create → Blob**.
2. Al conectarlo, Vercel agrega solo la variable de entorno
   `BLOB_READ_WRITE_TOKEN` al proyecto -- no hace falta copiarla a mano.
3. Sin este store conectado, la app sigue funcionando (las subidas de
   imagen caerían al disco local, que en Vercel es de solo lectura fuera
   de `/tmp` -- ver `blob_habilitado()` en `app/services/vercel_blob.py`),
   así que conectarlo es un paso obligatorio, no opcional, para que
   `POST /productos/imagenes` y `POST /categorias/imagenes` funcionen ahí.

## 3. Proyecto `novabyte-demo-api` (backend)

1. Importar el repo en Vercel, con **Root Directory = `back`**.
2. Framework Preset: "Other" (no es Next.js ni ningún framework de Node --
   Vercel arma la función Python a partir de `back/vercel.json`).
3. Variables de entorno del proyecto (Settings → Environment Variables):

   | Variable | Valor | Notas |
   |---|---|---|
   | `DATABASE_URL` | connection string pooled de Neon | ver paso 1 |
   | `SECRET_KEY` | string aleatorio de 32+ caracteres | firma los JWT -- generar uno nuevo, propio de la demo, NUNCA reusar el de la tienda real |
   | `ALGORITHM` | `HS256` | default si se omite |
   | `CRON_SECRET` | string aleatorio de 16+ caracteres | ver sección 5 más abajo |
   | `BLOB_READ_WRITE_TOKEN` | (la agrega Vercel solo al conectar Blob, paso 2) | |
   | `ALLOWED_ORIGINS` | `https://<tu-proyecto-front>.vercel.app` | la URL del proyecto `novabyte-demo-front` (paso 4) -- sin `https://`, el navegador rechaza el CORS |
   | `REFRESH_COOKIE_SAMESITE` | `none` | back y front viven en dominios `.vercel.app` DISTINTOS -- `lax` (el default fuera de este escenario, ver el comentario en `app/core/config.py`) no alcanza para una cookie cross-site |
   | `REFRESH_COOKIE_SECURE` | `true` | obligatorio junto con `SameSite=None` (el navegador descarta la cookie si no) -- ya es el default con `DEBUG=False`, se deja explícito acá para que no dependa de otra variable |
   | `MP_ACCESS_TOKEN` | access token de **PRUEBA** de Mercado Pago | usar credenciales de test, nunca las de la cuenta real -- esta demo no debe poder mover dinero real |
   | `MP_WEBHOOK_SECRET` | secret de test correspondiente | |
   | `MP_SUCCESS_URL` / `MP_FAILURE_URL` / `MP_PENDING_URL` | URLs del proyecto front (ej. `https://<front>.vercel.app/pago/exito`) | |
   | `API_PUBLIC_BASE_URL` | `https://<tu-proyecto-api>.vercel.app` | la URL de ESTE mismo proyecto, para el `notification_url` del webhook de MP |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | credenciales de una cuenta de Gmail (ver el comentario en `app/core/config.py` sobre "Contraseñas de aplicaciones") | se puede reusar una cuenta de Gmail dedicada solo a la demo, para no mezclar mails reales con los de prueba |
   | `SMTP_FROM_NAME` | ej. `NovaByte Demo` | opcional, default = `APP_NAME` |
   | `APP_NAME` | ej. `NovaByte Demo` | opcional |
   | `DEBUG` | `False` (o directamente no setearla) | con `True` se exponen `/docs`, `/redoc` y `/openapi.json` -- no conviene en algo público |

   Todas estas son las mismas variables que ya usa `app/core/config.py`
   fuera de Vercel -- no se inventó ninguna nueva para el deploy salvo
   `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET`, específicas de este modo.

4. Deploy. Anotar la URL que Vercel asigna (ej.
   `https://novabyte-demo-api.vercel.app`).

## 4. Proyecto `novabyte-demo-front` (frontend)

1. Importar el mismo repo de nuevo, esta vez con **Root Directory =
   `front`**. Vercel detecta Vite solo (build `npm run build`, output
   `dist/`).
2. Variable de entorno del proyecto: `VITE_API_BASE_URL` =
   `https://<tu-proyecto-api>.vercel.app/api/v1` (la URL real del backend
   del paso 3, CON el sufijo `/api/v1`). Esto pisa, solo en este deploy, el
   `/api/v1` relativo de `front/.env.production` (pensado para cuando el
   propio backend sirve el build, no para dos dominios separados) -- se
   configura como variable de entorno del proyecto en el dashboard de
   Vercel, no editando ese archivo (así `front/.env.production` sigue
   sirviendo sin cambios al escenario de túnel local de siempre).
3. Deploy. Anotar esta URL también -- es la que hay que haber puesto en
   `ALLOWED_ORIGINS` del backend (paso 3).

## 5. Cron Job de limpieza (Vercel Cron)

`back/vercel.json` ya declara el cron:
```json
"crons": [{ "path": "/api/v1/demo/limpieza", "schedule": "0 6 * * *" }]
```
Se activa solo al desplegar -- no hace falta ningún paso manual extra en
el dashboard, salvo tener seteada la variable `CRON_SECRET` (paso 3): sin
ella, el endpoint rechaza incluso la llamada del propio cron (ver
`_verificar_secreto_cron` en `app/router/demo.py`, falla cerrado a
propósito).

Qué hace esa llamada diaria (ver `app/router/demo.py`): borra en cascada
todo `DemoTenant` vencido (y, con él, sus usuarios/categorías/productos/
pedidos -- `ondelete="CASCADE"`, ver `app/models/demo.py`) y corre de
paso la reconciliación de pedidos pendientes que en cualquier otro
hosting corre sola cada 1 minuto (ver el comentario en `app/main.py`
sobre por qué eso no es viable en una función serverless).

**Limitación del plan Hobby, aceptada a propósito:** un acceso vencido
deja de funcionar al toque igual (`get_current_user` en
`app/dependencies/auth.py` corta el acceso en cada request comparando
contra `expires_at`, sin depender del cron) -- lo único que tarda hasta
un día en pasar es el BORRADO físico de esas filas. Además, Vercel puede
disparar el cron en cualquier momento dentro de la hora indicada (con
`0 6 * * *`, en cualquier punto entre las 06:00:00 y las 06:59:59 UTC),
no exactamente a esa hora -- normal y documentado por Vercel para cuentas
Hobby, no es un bug.

Cambiar la hora del cron: editar el `schedule` en `back/vercel.json`
(formato cron estándar, siempre en UTC) y volver a desplegar.

## 6. Dar de alta un acceso temporal a un visitante

Manual, siempre (fue la elección explícita del dueño: "vos generás y les
mandás la credencial a cada persona") -- correr desde tu máquina, con
`DATABASE_URL` apuntando a la MISMA base de Neon que usa el deploy (no a
tu base local):

```
cd back
python scripts/crear_acceso_demo.py --horas 4 --etiqueta "LinkedIn - Juan Perez"
```

El script imprime el email, la contraseña generada y el vencimiento --
copiarlos y mandárselos a la persona por el medio que sea (WhatsApp,
mail, el mensaje de LinkedIn donde te los pidió). `--etiqueta` es solo una
nota interna tuya (nunca se le muestra a la persona) para poder
reconocer después, mirando la tabla `demo_tenants`, a quién correspondía
cada acceso. Ver `back/scripts/crear_acceso_demo.py` para el resto de las
opciones.

## 7. Verificación del flujo completo

Antes de mandarle el primer link a un visitante real:

1. Correr `crear_acceso_demo.py` una vez (paso 6) y loguearse con esas
   credenciales en `https://<tu-proyecto-front>.vercel.app`.
2. Confirmar que el catálogo NO está vacío (lo siembra
   `sembrar_catalogo`, ver `app/services/demo_catalog.py`) y que las
   imágenes cargan (vienen de Vercel Blob).
3. Cargar un producto o categoría nueva desde el panel admin, confirmar
   que aparece.
4. Correr `crear_acceso_demo.py` una SEGUNDA vez (un tenant nuevo) y
   loguearse con esas otras credenciales: confirmar que este segundo
   acceso ve su propio catálogo de muestra recién sembrado, NO el
   producto que cargó el primero -- ése es el aislamiento que pidió el
   dueño.
5. Esperar a que venza el primer acceso (o crearlo con `--horas` chico
   para probar más rápido) y confirmar que devuelve 401 al intentar
   loguearse o al seguir usando un token ya emitido.
6. Llamar a mano `GET https://<tu-proyecto-api>.vercel.app/api/v1/demo/limpieza`
   con el header `Authorization: Bearer <CRON_SECRET>` (ej. con `curl` o
   Postman) y confirmar que borra el tenant vencido del paso anterior --
   así no hace falta esperar a que corra el cron real para validar que la
   limpieza funciona.
