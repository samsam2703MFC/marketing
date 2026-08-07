import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Le back-office appelle l'ERP TFBuddy depuis le navigateur. Plutôt que de
 * dépendre du CORS de l'API, les appels passent en dev par le préfixe `/erp`,
 * relayé ici vers l'environnement de test (seul serveur listé dans le swagger).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/erp': {
        target: 'https://test.tfbuddy.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/erp/, ''),
      },
    },
  },
})
