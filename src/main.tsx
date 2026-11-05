import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installAuthRefresh } from './lib/api/auth'
import App from './App'
import KitPublic from './views/production/KitPublic'
import './styles/global.css'

// Branche la rotation des refresh tokens avant le premier appel API.
installAuthRefresh()

const container = document.getElementById('root')
if (!container) throw new Error('Élément #root introuvable dans index.html.')

// Le kit d'une boutique, ouvert par son lien personnel (`?kit=…`) : lecture seule,
// sans session ni menu — c'est la tablette de la boutique qui l'ouvre.
const kitToken = new URLSearchParams(window.location.search).get('kit')

createRoot(container).render(
  <StrictMode>
    {kitToken && /^[A-Za-z0-9_-]{43}$/.test(kitToken) ? <KitPublic token={kitToken} /> : <App />}
  </StrictMode>,
)
