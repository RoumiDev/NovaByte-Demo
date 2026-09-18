# NovaByte — Frontend (demo)

Frontend en React (Vite) para el backend en `../back`. Por ahora solo
tiene registro y login; el resto de la tienda (catálogo, carrito, checkout
con Mercado Pago) todavía no está armado.

## Setup

```
npm install
cp .env.example .env
```

Revisá `.env` y ajustá `VITE_API_BASE_URL` si el backend no corre en
`http://localhost:8000`.

## Correr en desarrollo

Con el backend ya corriendo (`uvicorn app.main:app --reload` en
`back`, puerto 8000):

```
npm run dev
```

Abre en `http://localhost:3000` (puerto fijado en `vite.config.js` para que
coincida con `ALLOWED_ORIGINS` del backend).

## Estructura

- `src/api/` — cliente HTTP (axios) y llamadas a la API del backend.
- `src/context/AuthContext.jsx` — guarda el access/refresh token de la sesión.
- `src/pages/` — pantallas (`Login`, `Register`, `Home`).
- `src/components/RutaProtegida.jsx` — redirige a `/login` si no hay sesión.

## Build de producción

```
npm run build
```

Genera `dist/`. Antes de desplegar, actualizar `VITE_API_BASE_URL` a la URL
real de la API en producción.
