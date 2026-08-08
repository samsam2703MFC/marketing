import { useState } from 'react'
import { asset } from './lib/assets'
import { useLogin, useSession } from './state/auth'
import LoginView from './views/LoginView'
import NetworkOverview from './views/NetworkOverview'
import OfferBuilder from './views/OfferBuilder'

type View = 'network' | 'offers'

export default function App() {
  const session = useSession()
  const { signOut } = useLogin()
  const [view, setView] = useState<View>('network')

  if (!session) return <LoginView />

  return (
    <div className="app">
      <header className="app__header">
        <img className="app__logo" src={asset('/img/logo.png')} alt="L’Atelier By" />
        <div>
          <h1>Module Marketing</h1>
          <p className="muted">{view === 'network' ? 'Pilotage — Campagnes' : 'Offres — Nouvelle offre'}</p>
        </div>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          Déconnexion
        </button>
      </header>

      <div className="app__frame">
        <nav className="rail" aria-label="Navigation">
          <div className="rail__group">
            <span className="rail__label">Pilotage</span>
            <button
              type="button"
              className={view === 'network' ? 'rail__item rail__item--active' : 'rail__item'}
              onClick={() => setView('network')}
            >
              Campagnes
            </button>
          </div>
          <div className="rail__group">
            <span className="rail__label">Offres</span>
            <button
              type="button"
              className={view === 'offers' ? 'rail__item rail__item--active' : 'rail__item'}
              onClick={() => setView('offers')}
            >
              Nouvelle offre
            </button>
          </div>
        </nav>

        <main className="app__body">
          {view === 'network' ? <NetworkOverview /> : <OfferBuilder />}
        </main>
      </div>
    </div>
  )
}
