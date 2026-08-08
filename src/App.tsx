import { useState } from 'react'
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
        <img className="app__logo" src="/img/logo.png" alt="L’Atelier By" />
        <div>
          <h1>Module Marketing</h1>
          <p className="muted">{view === 'network' ? 'Vue Réseau' : 'Offres'}</p>
        </div>
        <nav className="tabs" aria-label="Navigation">
          <button
            type="button"
            className={view === 'network' ? 'tab tab--active' : 'tab'}
            onClick={() => setView('network')}
          >
            Réseau
          </button>
          <button
            type="button"
            className={view === 'offers' ? 'tab tab--active' : 'tab'}
            onClick={() => setView('offers')}
          >
            Offres
          </button>
        </nav>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          Déconnexion
        </button>
      </header>

      <main className="app__body">
        {view === 'network' ? <NetworkOverview /> : <OfferBuilder />}
      </main>
    </div>
  )
}
