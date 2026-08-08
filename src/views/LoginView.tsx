import { useState } from 'react'
import { AUTH_MODE } from '../lib/api/config'
import { setTokens } from '../lib/api/tokens'
import { asset } from '../lib/assets'
import { useLogin } from '../state/auth'

/**
 * Connexion à l'ERP. Les champs suivent le réalm configuré :
 * téléphone (E.164) pour `/admin/auth/login`, identifiant pour `/admin/authenticate`.
 */
export default function LoginView() {
  const { submit, pending, error } = useLogin()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  const usesPhone = AUTH_MODE === 'phone'

  /**
   * Session de démonstration : ouvre l'interface sans identifiants ERP.
   * Les vues qui appellent l'API affichent alors leur état d'erreur ;
   * l'écran Offres, entièrement local, reste pleinement utilisable.
   */
  const enterDemo = () => {
    setTokens({
      accessToken: 'demo',
      refreshToken: 'demo',
      expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
      sessionId: 'demo',
    })
  }

  return (
    <main className="auth">
      <form
        className="card auth__card"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(
            usesPhone
              ? { phone: identifier, password }
              : { login: identifier, password },
          )
        }}
      >
        <img className="auth__logo" src={asset('/img/logo.png')} alt="L’Atelier By" />
        <h1>Module Marketing</h1>
        <p className="muted">Connexion à l’ERP — vue Réseau</p>

        <label htmlFor="identifier">{usesPhone ? 'Téléphone' : 'Identifiant'}</label>
        <input
          id="identifier"
          type={usesPhone ? 'tel' : 'text'}
          autoComplete={usesPhone ? 'tel' : 'username'}
          placeholder={usesPhone ? '+33 6 12 34 56 78' : 'identifiant'}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />

        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>

        <button type="button" className="ghost auth__demo" onClick={enterDemo}>
          Explorer la démo (sans connexion)
        </button>
        <p className="muted auth__hint">
          La démo montre l’interface sans données ERP : les vues connectées affichent leur état
          d’erreur, l’écran Offres est complet.
        </p>
      </form>
    </main>
  )
}
