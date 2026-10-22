import { useMemo, useState } from 'react'
import { module as api } from '../lib/api'
import type { CampaignDetail, OfferItem } from '../lib/api/module'
import { campaignChecks, campaignGaps } from '../lib/completeness'
import type { Check } from '../lib/completeness'
import { useAsync } from '../lib/useAsync'
import { describeError } from '../state/auth'
import { useReferences } from '../state/references'

/**
 * Compléter les campagnes : celles dont une donnée manque, une à une.
 *
 * Une campagne lancée ne se réécrit plus en bloc dans l'assistant (ses
 * adhésions, budgets locaux et objectifs par produit seraient effacés) : ce qui
 * lui manquait restait donc manquant, et son retour ne se mesurait jamais. Ici,
 * chaque manque se saisit à part et s'enregistre sans toucher au reste — les
 * colonnes en PATCH, l'objectif par levier et les produits par leurs routes
 * propres (ajout seul pour l'offre). Seules les boutiques d'une campagne locale
 * renvoient à l'assistant, et seulement tant qu'elle est un brouillon.
 */

interface FixProps {
  /** La campagne par laquelle commencer (depuis son suivi) ; sinon la première incomplète. */
  startId: number | null
  /** Le réseau complète toute campagne ; une boutique, ses campagnes locales (l'API tranche, l'écran ne propose que celles-là). */
  brandAdmin: boolean
  /** Ouvre l'assistant sur un brouillon, à l'étape où la donnée se saisit. */
  onOpenBuilder: (campaignId: number, step: string) => void
  onOpenCampaign: (campaignId: number) => void
  onClose: () => void
}

interface Form {
  type_id: string
  starts_on: string
  ends_on: string
  budget: string
  targets: Record<number, string>
  products: OfferItem[]
}

const emptyForm = (): Form => ({ type_id: '', starts_on: '', ends_on: '', budget: '', targets: {}, products: [] })

export default function CampaignFixView({ startId, brandAdmin, onOpenBuilder, onOpenCampaign, onClose }: FixProps) {
  const refs = useReferences()
  // Toutes les fiches, lues de front : la liste ne porte ni l'offre ni les objectifs.
  const campaigns = useAsync(async () => {
    const list = await api.listCampaigns()

    return Promise.all(list.map((c) => api.getCampaign(c.id)))
  }, [])
  // Les fiches relues après un enregistrement : seule la campagne touchée repart au serveur.
  const [fresh, setFresh] = useState<Record<number, CampaignDetail>>({})
  const catalog = useAsync(() => api.listOfferItems(), [])

  // La file est figée à l'ouverture : une campagne complétée y reste, cochée, au lieu de
  // disparaître sous le curseur et de décaler celle qu'on allait lire.
  const [queue, setQueue] = useState<number[] | null>(null)
  const [current, setCurrent] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const byId = useMemo(() => new Map((campaigns.data ?? []).map((c) => [c.id, fresh[c.id] ?? c])), [campaigns.data, fresh])

  if (queue === null && campaigns.data) {
    const incomplete = campaigns.data
      .filter((c) => (brandAdmin || c.scope === 'LOCALE') && campaignGaps(c).length > 0)
      .map((c) => c.id)
    const startable = startId !== null && byId.has(startId) && (brandAdmin || byId.get(startId)?.scope === 'LOCALE')
    const first = startable && !incomplete.includes(startId) ? [startId, ...incomplete] : incomplete
    setQueue(first)
    setCurrent(startId !== null && first.includes(startId) ? startId : (first[0] ?? null))
  }

  if (campaigns.error) return <p className="error">{campaigns.error}</p>
  if (campaigns.loading) return <p className="muted">Lecture des campagnes et de ce qui leur manque…</p>

  const ids = queue ?? []
  const campaign = current !== null ? byId.get(current) ?? null : null
  const position = current !== null ? ids.indexOf(current) : -1

  const go = (id: number | null) => {
    setCurrent(id)
    setForm(emptyForm())
    setSearch('')
    setFailure(null)
  }
  const next = () => go(position >= 0 && position < ids.length - 1 ? ids[position + 1] : null)

  if (ids.length === 0) {
    return (
      <section className="card">
        <h2>Toutes les campagnes sont complètes</h2>
        <p className="muted">Type, période, boutiques, produits, objectif et budget : rien ne manque pour mesurer leur retour.</p>
        <button type="button" className="btn" onClick={onClose}>
          ← Retour aux campagnes
        </button>
      </section>
    )
  }

  if (campaign === null) {
    const still = ids.map((id) => byId.get(id)).filter((c): c is CampaignDetail => c !== undefined && campaignGaps(c).length > 0)

    return (
      <section className="card fix">
        <h2>Tour terminé</h2>
        {still.length === 0 ? (
          <p>Les {ids.length} campagnes passées sont complètes.</p>
        ) : (
          <>
            <p>Encore incomplètes :</p>
            <ul className="fix__rest">
              {still.map((c) => (
                <li key={c.id}>
                  <button type="button" className="btn btn--sm" onClick={() => go(c.id)}>
                    {c.name}
                  </button>{' '}
                  <span className="muted">{campaignGaps(c).map((g) => g.label.toLowerCase()).join(', ')}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="btn" onClick={onClose}>
          ← Retour aux campagnes
        </button>
      </section>
    )
  }

  const checks = campaignChecks(campaign)
  const gaps = checks.filter((c) => !c.ok)
  const draft = campaign.status_code === 'draft'
  const already = new Set((campaign.offer?.items ?? []).map((i) => i.label.toLowerCase()))
  const needle = search.trim().toLowerCase()
  const found =
    needle.length < 2
      ? []
      : (catalog.data ?? [])
          .filter((p) => !already.has(p.name.toLowerCase()) && !form.products.some((q) => q.id === p.id))
          .filter((p) => `${p.name} ${p.detail ?? ''}`.toLowerCase().includes(needle))
          .slice(0, 8)

  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }))

  const columns: Record<string, unknown> = {}
  if (form.type_id !== '') columns.type_id = Number(form.type_id)
  if (form.starts_on !== '') columns.starts_on = form.starts_on
  if (form.ends_on !== '') columns.ends_on = form.ends_on
  if (form.budget.trim() !== '') columns.budget_amount = Number(form.budget.replace(',', '.'))
  const targets = Object.entries(form.targets)
    .filter(([, v]) => v.trim() !== '')
    .map(([lever, v]) => ({ lever_id: Number(lever), target_value: Number(v.replace(',', '.')) }))
  const dirty = Object.keys(columns).length > 0 || targets.length > 0 || form.products.length > 0

  const invalid =
    (form.starts_on !== '' && form.ends_on !== '' && form.ends_on < form.starts_on && 'La date de fin précède la date de début.') ||
    (form.ends_on !== '' && form.starts_on === '' && campaign.starts_on === null && 'Donnez d’abord une date de début.') ||
    (columns.budget_amount !== undefined && !(Number(columns.budget_amount) >= 0) && 'Le budget est un montant positif.') ||
    (targets.some((t) => !(t.target_value >= 0)) && 'Un objectif est un montant positif.') ||
    null

  async function save() {
    if (campaign === null) return
    const id = campaign.id
    setBusy(true)
    setFailure(null)
    let ok = false
    try {
      if (Object.keys(columns).length) await api.updateCampaign(id, columns)
      if (targets.length) await api.setLeverTargets(id, targets)
      if (form.products.length) await api.addOfferItems(id, form.products.map((p) => p.id))
      ok = true
    } catch (cause: unknown) {
      setFailure(describeError(cause))
    }
    // Relue dans les deux cas : les écritures partent l'une après l'autre, et ce qui est passé
    // avant un refus est en base — la fiche doit le montrer.
    try {
      const updated = await api.getCampaign(id)
      setFresh((f) => ({ ...f, [id]: updated }))
    } catch {
      // la fiche d'avant reste affichée ; l'enregistrement, lui, a eu lieu
    }
    setBusy(false)
    if (ok) next()
  }

  const editor = (check: Check) => {
    switch (check.key) {
      case 'type':
        return (
          <select value={form.type_id} onChange={(e) => set({ type_id: e.target.value })}>
            <option value="">Choisir un type…</option>
            {refs.campaignTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )
      case 'period':
        return (
          <div className="fix__inline">
            <label className="field">
              Du <input type="date" value={form.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
            </label>
            <label className="field">
              au <input type="date" value={form.ends_on} onChange={(e) => set({ ends_on: e.target.value })} />
            </label>
            <span className="muted">fin facultative : sans elle, la campagne est continue</span>
          </div>
        )
      case 'budget':
        return (
          <label className="field">
            <input inputMode="decimal" placeholder="0" value={form.budget} onChange={(e) => set({ budget: e.target.value })} /> €
          </label>
        )
      case 'objective':
        return (
          <div className="fix__levers">
            {refs.levers.map((lever) => (
              <label key={lever.id} className="field">
                <span className="chip chip--lever">
                  <span className="dot" style={{ background: lever.color_hex }} />
                  {lever.label}
                </span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={form.targets[lever.id] ?? ''}
                  onChange={(e) => set({ targets: { ...form.targets, [lever.id]: e.target.value } })}
                />
                € visés
              </label>
            ))}
          </div>
        )
      case 'products':
        return (
          <div className="fix__products">
            <input
              type="search"
              placeholder={catalog.loading ? 'Lecture du catalogue…' : 'Chercher un produit ou une gamme'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {found.length ? (
              <div className="fix__found">
                {found.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      set({ products: [...form.products, p] })
                      setSearch('')
                    }}
                  >
                    + {p.name}
                    {p.detail ? <span className="muted"> · {p.detail}</span> : null}
                  </button>
                ))}
              </div>
            ) : needle.length >= 2 && !catalog.loading ? (
              <p className="muted">Aucun produit du catalogue ne correspond.</p>
            ) : null}
            {form.products.length ? (
              <ul className="fix__chosen">
                {form.products.map((p) => (
                  <li key={p.id}>
                    {p.name}
                    <button
                      type="button"
                      className="btn btn--danger btn--icon"
                      aria-label={`Retirer ${p.name}`}
                      onClick={() => set({ products: form.products.filter((q) => q.id !== p.id) })}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="muted fix__why">Ajout seul : les lignes déjà dans l’offre ne bougent pas. Prix et remises se règlent dans l’assistant.</p>
          </div>
        )
      case 'shops':
        return draft ? (
          <button type="button" className="btn btn--sm" onClick={() => onOpenBuilder(campaign.id, check.step)}>
            Choisir les boutiques dans l’assistant ↗
          </button>
        ) : (
          <p className="muted">
            Campagne lancée : ses boutiques ne se rattachent plus après coup. Une campagne locale sans boutique est à recréer.
          </p>
        )
    }
  }

  return (
    <div className="fix">
      <nav className="hub-sub" aria-label="Campagnes à compléter">
        {ids.map((id, i) => {
          const c = byId.get(id)
          const left = c ? campaignGaps(c).length : 0

          return (
            <button
              key={id}
              type="button"
              className={`hub-sub__tab${id === current ? ' is-on' : ''}`}
              aria-current={id === current ? 'step' : undefined}
              onClick={() => go(id)}
            >
              {i + 1}. {c?.name ?? `n° ${id}`} {left === 0 ? '✓' : `· ${left}`}
            </button>
          )
        })}
      </nav>

      <section className="card">
        <header className="fix__head">
          <div>
            <p className="muted">
              Campagne {position + 1} sur {ids.length} ·{' '}
              <span className="chip" style={{ color: campaign.status_text_hex, background: campaign.status_bg_rgba }}>
                {campaign.status_label}
              </span>
            </p>
            <h3 className="fix__name">{campaign.name}</h3>
          </div>
          <div className="fix__links">
            <button type="button" className="btn btn--sm" onClick={() => onOpenCampaign(campaign.id)}>
              Voir le suivi
            </button>
            {draft ? (
              <button type="button" className="btn btn--sm" onClick={() => onOpenBuilder(campaign.id, gaps[0]?.step ?? 'framing')}>
                Reprendre dans l’assistant ↗
              </button>
            ) : null}
          </div>
        </header>

        <p className="muted">
          {gaps.length === 0
            ? 'Rien ne manque : son retour peut se mesurer.'
            : `${gaps.length} donnée${gaps.length > 1 ? 's' : ''} à compléter pour que son retour se mesure. Chacune s’enregistre seule, sans toucher au reste${draft ? '' : ', même campagne lancée'}.`}
        </p>

        <ol className="fix__list">
          {checks.map((check) => (
            <li key={check.key} className={check.ok ? 'is-ok' : 'is-gap'}>
              <div className="fix__label">
                {check.ok ? <span className="badge badge--mesure">Complet</span> : <span className="tag-warn">À compléter</span>}
                <b>{check.label}</b>
                <span className="muted">{check.value}</span>
              </div>
              {check.ok ? null : (
                <>
                  <p className="muted fix__why">{check.why}</p>
                  {editor(check)}
                </>
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="wizard-actions">
        <div className="wizard-actions__group">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Quitter
          </button>
          {failure ? <span className="error wizard-actions__state">{failure}</span> : null}
          {!failure && invalid ? <span className="error wizard-actions__state">{invalid}</span> : null}
        </div>
        <div className="wizard-actions__group wizard-actions__group--nav">
          <button type="button" className="btn" disabled={busy} onClick={next}>
            {dirty ? 'Passer sans enregistrer' : 'Campagne suivante →'}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || !dirty || invalid !== null} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : position < ids.length - 1 ? 'Enregistrer et suivante →' : 'Enregistrer et terminer'}
          </button>
        </div>
      </div>
    </div>
  )
}
