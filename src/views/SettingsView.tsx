import { useEffect, useState } from 'react'
import * as api from '../lib/api/module'
import type { ModuleKey, ModuleVariable, SettingSource } from '../lib/api/module'
import Erreur from '../components/Erreur'
import Aide from '../components/Aide'

/**
 * Paramètres › Variables et clés.
 *
 * Le module se déplace avec ses réglages : ils vivent en base (`mar_variable`), et
 * ses secrets chiffrés (`mar_keys`). Une clé ne se relit jamais — l'écran ne reçoit
 * que ses quatre derniers caractères. L'accès à la base et la clé maîtresse restent,
 * par construction, dans la configuration du serveur.
 */

const SOURCE: Record<SettingSource, { label: string; className: string }> = {
  base: { label: 'en base', className: 'settings__src settings__src--base' },
  fichier: { label: 'fichier du serveur', className: 'settings__src settings__src--file' },
  absente: { label: 'non renseignée', className: 'settings__src' },
}

export default function SettingsView() {
  const [variables, setVariables] = useState<ModuleVariable[] | null>(null)
  const [keys, setKeys] = useState<ModuleKey[] | null>(null)
  const [masterKey, setMasterKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listModuleVariables(), api.listModuleKeys()])
      .then(([v, k]) => {
        setVariables(v)
        setKeys(k.keys)
        setMasterKey(k.masterKey)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  async function run<T>(name: string, action: () => Promise<T>, done: (result: T) => void, message: string) {
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      done(await action())
      setDrafts((d) => {
        const next = { ...d }
        delete next[name]
        return next
      })
      setNotice(message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (error && !variables) return <Erreur>{error}</Erreur>
  if (!variables || !keys) return <p className="muted">Chargement…</p>

  const groups = [...new Set(variables.map((v) => v.group).concat(keys.map((k) => k.group)))]

  return (
    <div className="settings">
      <section className="card settings__intro">
        <p>
          Les réglages et les clés du module, enregistrés avec lui : une valeur posée ici l’emporte sur le fichier du serveur.
          <Aide texte="Ils vivent dans la base du module, les clés y sont chiffrées : le module se déplace avec eux. Retirée, une valeur laisse le fichier du serveur reprendre. Restent dans la configuration du serveur l’accès à la base et la clé maîtresse qui déchiffre les clés." />
        </p>
        {masterKey ? null : (
          <p className="settings__notice settings__notice--warn">Clé maîtresse absente sur ce serveur : les clés ne peuvent pas être enregistrées.</p>
        )}
      </section>
      {notice ? <p className="settings__notice">{notice}</p> : null}
      {error ? <Erreur>{error}</Erreur> : null}

      {groups.map((group) => (
        <section key={group} className="card table-card">
          <h2 className="settings__group">{group}</h2>
          <div className="table-scroll">
            <table className="settings__table">
              <tbody>
                {variables
                  .filter((v) => v.group === group)
                  .map((v) => {
                    const draft = drafts[v.name]
                    const shown = draft ?? (v.value === null ? '' : String(v.value))
                    return (
                      <tr key={v.name}>
                        <td className="settings__name">
                          <b title={v.name}>
                            {v.label}
                            {v.help ? <Aide texte={v.help} /> : null}
                          </b>
                        </td>
                        <td className="settings__value">
                          <input value={shown} onChange={(e) => setDrafts((d) => ({ ...d, [v.name]: e.target.value }))} aria-label={v.label} />
                          <span className={SOURCE[v.source].className}>{SOURCE[v.source].label}</span>
                        </td>
                        <td className="settings__actions">
                          <button
                            type="button"
                            className={draft === undefined ? 'btn btn--sm' : 'btn btn--sm btn--primary'}
                            disabled={busy !== null || draft === undefined || draft.trim() === ''}
                            onClick={() => void run(v.name, () => api.saveModuleVariable(v.name, draft ?? ''), setVariables, `${v.label} : enregistré en base.`)}
                          >
                            Enregistrer
                          </button>
                          {v.source === 'base' ? (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              disabled={busy !== null}
                              onClick={() => void run(v.name, () => api.resetModuleVariable(v.name), setVariables, `${v.label} : retiré de la base, le fichier du serveur reprend.`)}
                            >
                              Retirer
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                {keys
                  .filter((k) => k.group === group)
                  .map((k) => {
                    const draft = drafts[k.name]
                    return (
                      <tr key={k.name} className="settings__key">
                        <td className="settings__name">
                          <b title={k.name}>
                            <svg className="settings__lock" viewBox="0 0 24 24" aria-label="Clé secrète" role="img">
                              <path d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" />
                            </svg>
                            {k.label}
                            {k.help ? <Aide texte={k.help} /> : null}
                          </b>
                        </td>
                        <td className="settings__value">
                          {k.managedByDeploy ? (
                            <span className="muted">Tirée et entretenue par le déploiement.</span>
                          ) : (
                            <input
                              type="password"
                              autoComplete="new-password"
                              placeholder={k.hint ? `définie · ${k.hint} — saisir pour remplacer` : 'saisir la clé'}
                              value={draft ?? ''}
                              onChange={(e) => setDrafts((d) => ({ ...d, [k.name]: e.target.value }))}
                              aria-label={k.label}
                            />
                          )}
                          <span className={SOURCE[k.source].className}>
                            {SOURCE[k.source].label}
                            {k.hint ? ` · ${k.hint}` : ''}
                            {k.readable === false ? ' · illisible avec la clé maîtresse de ce serveur' : ''}
                          </span>
                        </td>
                        <td className="settings__actions">
                          {!k.managedByDeploy ? (
                            <>
                              <button
                                type="button"
                                className={draft ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
                                disabled={busy !== null || !masterKey || !draft || draft.trim() === ''}
                                onClick={() => void run(k.name, () => api.saveModuleKey(k.name, draft ?? ''), setKeys, `${k.label} : enregistrée, chiffrée.`)}
                              >
                                Enregistrer
                              </button>
                              {k.source === 'base' ? (
                                <button
                                  type="button"
                                  className="btn btn--sm btn--ghost"
                                  disabled={busy !== null}
                                  onClick={() => void run(k.name, () => api.removeModuleKey(k.name), setKeys, `${k.label} : retirée de la base.`)}
                                >
                                  Retirer
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
