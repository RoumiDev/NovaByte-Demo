import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Puerto fijo en 3000: coincide con ALLOWED_ORIGINS=http://localhost:3000
    // ya configurado en el .env del backend (app/core/config.py). Si se
    // cambia acá, hay que actualizar también esa variable en el backend.
    port: 3000,
    proxy: {
      // Proxy de desarrollo: reenvía /api/* al backend (localhost:8000)
      // desde el proceso de Node de Vite, no desde el navegador. Se agregó
      // para poder generar capturas del panel de admin con el navegador
      // automatizado de Claude, que bloquea por seguridad los pedidos en
      // segundo plano hacia otros puertos locales aunque el sitio esté
      // permitido. No afecta producción: en producción, Nginx es el que
      // reenvía /api/ al backend (ver Nginx conf del servidor), y este
      // bloque de "proxy" solo existe durante `npm run dev`.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Silencia el aluvión de "Deprecation Warning" que tira `npm run
        // dev`/`build` al compilar el Sass de Bootstrap 5.3 (@import,
        // if-function, global-builtin, color-functions -- ver la consola:
        // más de 300 avisos repetidos). No son errores ni afectan el CSS
        // generado: es Bootstrap usando todavía la sintaxis vieja de Sass
        // (@import en vez de @use, funciones globales de color en vez del
        // módulo "sass:color"), que Dart Sass viene avisando desde hace
        // varias versiones que va a sacar recién en Dart Sass 3.0 -- no es
        // nada que theme.scss esté haciendo mal, es código de la librería
        // (node_modules/bootstrap/scss/**), no del proyecto. Se puede sacar
        // este bloque el día que se actualice a una versión de Bootstrap
        // que ya haya migrado su Sass a la sintaxis nueva.
        quietDeps: true,
        silenceDeprecations: ["import", "global-builtin", "color-functions", "if-function"],
      },
    },
  },
})
