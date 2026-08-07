import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Deux sources distinctes en développement :
 *
 * • `/api` → le module marketing (tables `mar_`), servi en local par PHP :
 *       MAR_DEV_AUTH=1 MAR_DB_NAME=marketing php -S 127.0.0.1:8000 -t api/public
 * • `/erp` → l'ERP TFBuddy, relayé vers l'environnement de test (seul serveur
 *       listé dans le swagger). Passer par le proxy évite de dépendre du CORS.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/erp': {
        target: 'https://test.tfbuddy.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/erp/, ''),
      },
    },
  },
})
