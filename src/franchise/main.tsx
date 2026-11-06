import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EspaceFranchise from './EspaceFranchise'
import { normaliserAdresse } from './routes'
import '../styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Élément #root introuvable dans franchise/index.html.')

normaliserAdresse()

createRoot(container).render(
  <StrictMode>
    <EspaceFranchise />
  </StrictMode>,
)
