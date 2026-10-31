import { useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api/module'

/**
 * Connexion au module par les identifiants de l'ERP TFBuddy.
 *
 * Le module ne garde aucun mot de passe : il les présente à l'ERP, qui tranche.
 * Un compte du réseau ouvre la version réseau ; un compte de boutique, ses
 * boutiques seules. Le périmètre vient de l'ERP, jamais de cet écran.
 */
interface Props {
  space: 'reseau' | 'franchise'
  onDone: () => void
  /** Présent quand une identité existe déjà (identité de développement) : on peut revenir sans se connecter. */
  onCancel?: () => void
}

export default function LoginView({ space, onDone, onCancel }: Props) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api.openSession(phone.trim(), password)
      setPassword('')
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth__card login" onSubmit={submit}>
        <img src={`${import.meta.env.BASE_URL}img/logo.png`} alt="L'Atelier By" className="login__logo" />
        <h1 className="login__title">Module Marketing</h1>
        <p className="muted login__sub">
          {space === 'reseau' ? 'Espace réseau' : 'Espace boutique'} · connectez-vous avec vos identifiants de l’ERP TFBuddy.
        </p>

        <label htmlFor="login-phone">Téléphone</label>
        <input
          id="login-phone"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          placeholder="+32 470 12 34 56"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
          autoFocus
        />

        <label htmlFor="login-password">Mot de passe</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error ? (
          <p className="error login__error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending || phone.trim() === '' || password === ''}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
        {onCancel ? (
          <button type="button" className="ghost login__cancel" onClick={onCancel}>
            Revenir sans se connecter
          </button>
        ) : null}
        <p className="muted login__note">
          Le module ne garde pas votre mot de passe. La session dure douze heures.
        </p>
      </form>
    </div>
  )
}
