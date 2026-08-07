import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * L'application n'est pas servie à la racine du domaine mais sous un
 * sous-répertoire (`/marketing`). Deux conséquences, toutes deux pilotées par
 * l'environnement pour qu'une erreur de chemin se corrige sans toucher au code :
 *
 * • `base` préfixe les URL d'assets. Laissé à `/`, le JS et le CSS répondent 404
 *   dès que la page vit ailleurs qu'à la racine.
 * • `VITE_API_BASE` préfixe les appels au module marketing, qui sinon partent à
 *   la racine du domaine au lieu du sous-répertoire.
 *
 * En développement, les deux restent vides : le proxy ci-dessous sert `/api`.
 */
export default defineConfig(({ mode }) => {
  // Racine du projet en second argument plutôt que `process.cwd()` : évite de
  // tirer @types/node juste pour lire deux variables.
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    base: env.VITE_BASE || '/',
    server: {
      port: 5173,
      proxy: {
        // Le module marketing, servi en local par PHP :
        //   MAR_DEV_AUTH=1 MAR_DB_NAME=marketing php -S 127.0.0.1:8000 -t api/public
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        // L'ERP TFBuddy, relayé vers l'environnement de test (seul serveur du
        // swagger). Passer par le proxy évite de dépendre de son CORS.
        '/erp': {
          target: 'https://test.tfbuddy.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/erp/, ''),
        },
      },
    },
  }
})
