import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installAuthRefresh } from './lib/api/auth'
import App from './App'
import './styles/global.css'

// Branche la rotation des refresh tokens avant le premier appel API.
installAuthRefresh()

const container = document.getElementById('root')
if (!container) throw new Error('Élément #root introuvable dans index.html.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
