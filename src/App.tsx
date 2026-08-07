import { useLogin, useSession } from './state/auth'
import LoginView from './views/LoginView'
import NetworkOverview from './views/NetworkOverview'

export default function App() {
  const session = useSession()
  const { signOut } = useLogin()

  if (!session) return <LoginView />

  return (
    <div className="app">
      <header className="app__header">
        <img className="app__logo" src="/img/logo.png" alt="L’Atelier By" />
        <div>
          <h1>Module Marketing</h1>
          <p className="muted">Vue Réseau</p>
        </div>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          Déconnexion
        </button>
      </header>

      <main className="app__body">
        <NetworkOverview />
      </main>
    </div>
  )
}
