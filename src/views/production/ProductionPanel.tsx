import { useEffect, useMemo, useState } from 'react'
import { module as api } from '../../lib/api'
import type { Production, ProductionSection, ProductionShop, ProductionShopStatus, ProductionStatus } from '../../lib/api/module'
import { describeError } from '../../state/auth'
import KitPanel from './KitPanel'
import './production.css'

/**
 * Le fil de production d'une campagne validée (maquette du 05/11/2026).
 *
 * Un fil d'Ariane réunit toutes les sections de la campagne — le message,
 * chaque support coché, les consignes, les tenues, la prime — groupées par
 * famille, chacune avec son état. Un clic ouvre la section : ce qu'elle
 * demande, son échéance, son état ; pour les bâches et les affiches, le BAT de
 * chaque boutique, que le franchisé valide ou renvoie avec son retour.
 *
 * Quand tout est validé, le kit des franchisés s'envoie (KitPanel).
 */

const STATUS_LABELS: Record<ProductionStatus, string> = { todo: 'À faire', doing: 'En cours', ready: 'Prête à valider', validated: 'Validée' }
const SHOP_LABELS: Record<ProductionShopStatus, string> = { todo: 'À envoyer', sent: 'BAT envoyé', validated: 'BAT validé', redo: 'À refaire' }
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const thisYear = new Date().getFullYear()
  return `${d} ${MONTHS[(m || 1) - 1]}${y !== thisYear ? ` ${y}` : ''}`
}

function crumbState(section: ProductionSection): string {
  if (section.status === 'validated') return 'ok'
  if (section.status === 'doing' || section.status === 'ready') return 'wip'
  if (section.perShop && (section.shopsValidated ?? 0) > 0) return 'wip'
  return 'todo'
}

function supportsText(shop: ProductionShop): string {
  if (shop.supports.length === 0) return 'aucun emplacement déclaré'
  return shop.supports
    .map((s) => {
      const size = s.widthCm && s.heightCm ? `${s.widthCm}×${s.heightCm}` : s.paperFormat ?? ''
      return [s.placement, size, s.quantity > 1 ? `×${s.quantity}` : ''].filter(Boolean).join(' ')
    })
    .join(' · ')
}

interface Props {
  campaignId: number
  brandAdmin: boolean
  /** Ouvre l'éditeur d'un support : brochures, Créer un post… (null : pas d'éditeur dans le module). */
  onOpenEditor?: (editor: string) => void
}

export default function ProductionPanel({ campaignId, brandAdmin, onOpenEditor }: Props) {
  const [production, setProduction] = useState<Production | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [shopNotes, setShopNotes] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false
    api.getProduction(campaignId)
      .then((data) => {
        if (cancelled) return
        setProduction(data)
        setCurrent((code) => code ?? (data.sections.find((s) => s.status !== 'validated') ?? data.sections[0])?.code ?? null)
      })
      .catch((cause: unknown) => { if (!cancelled) setError(describeError(cause)) })
    return () => { cancelled = true }
  }, [campaignId])

  const section = useMemo(() => production?.sections.find((s) => s.code === current) ?? null, [production, current])
  useEffect(() => {
    setNote(section?.note ?? '')
    setShopNotes(Object.fromEntries((section?.shops ?? []).map((s) => [s.shopId, s.note ?? ''])))
  }, [section?.code, section?.note, section?.shops])

  if (error) return <section className="card prod"><p className="error">{error}</p></section>
  if (!production) return <section className="card prod"><p className="muted">Lecture du fil de production…</p></section>
  if (production.sections.length === 0) return null

  const groups: Array<{ label: string; sections: ProductionSection[] }> = []
  for (const s of production.sections) {
    const last = groups[groups.length - 1]
    if (last && last.label === s.groupLabel) last.sections.push(s)
    else groups.push({ label: s.groupLabel, sections: [s] })
  }
  const index = production.sections.findIndex((s) => s.code === current)
  const previous = index > 0 ? production.sections[index - 1] : null
  const next = index >= 0 && index < production.sections.length - 1 ? production.sections[index + 1] : null
  const pct = Math.round((production.validated / Math.max(1, production.total)) * 100)

  async function save(status: ProductionStatus) {
    if (!section) return
    setBusy(true)
    setError(null)
    try {
      setProduction(await api.setProductionSection(campaignId, section.code, status, note.trim() === '' ? null : note))
    } catch (cause: unknown) {
      setError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveShop(shopId: number, status: ProductionShopStatus) {
    if (!section) return
    setBusy(true)
    setError(null)
    try {
      const text = (shopNotes[shopId] ?? '').trim()
      setProduction(await api.setProductionShop(campaignId, section.code, shopId, status, text === '' ? null : text))
    } catch (cause: unknown) {
      setError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  const missingShops = section?.perShop ? section.shops.length - (section.shopsValidated ?? 0) : 0
  const upcoming = production.sections
    .filter((s) => s.dueOn && s.status !== 'validated')
    .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
    .slice(0, 6)

  return (
    <div className="prod">
      <nav className="pa" aria-label="Fil de production">
        <div className="pa__top">
          <b>Fil de production</b>
          <span className="pa__count">{production.validated} sur {production.total} sections validées</span>
          <div className="pa__bar"><i style={{ width: `${pct}%` }} /></div>
          <span className="pa__hint">Chaque section se produit, se relit, se valide ; le kit des franchisés se monte à partir de ce qui est validé.</span>
        </div>
        <div className="pa__chain">
          {groups.map((group, gi) => (
            <div key={group.label} className="pa__item">
              {gi > 0 ? <span className="pa__sep" aria-hidden="true">›</span> : null}
              <div className="pa__grp">
                <span>{group.label}</span>
                <div>
                  {group.sections.map((s) => (
                    <button key={s.code} type="button" className={`pa__c is-${crumbState(s)}${s.code === current ? ' is-cur' : ''}`} onClick={() => setCurrent(s.code)} aria-current={s.code === current ? 'step' : undefined}>
                      <i aria-hidden="true">{s.status === 'validated' ? '✓' : crumbState(s) === 'wip' ? '●' : ''}</i>
                      {s.label}
                      {s.perShop ? <small>{s.shopsValidated ?? 0}/{s.shops.length}</small> : s.quantity ? <small>{s.quantity}</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <div className="pa__item">
            <span className="pa__sep" aria-hidden="true">›</span>
            <div className="pa__grp">
              <span>Pour les franchisés</span>
              <div>
                <button type="button" className={`pa__c ${production.kitReady ? 'is-kit' : 'is-lock'}${current === '__kit' ? ' is-cur' : ''}`} onClick={() => setCurrent('__kit')}>
                  <i aria-hidden="true">{production.kitReady ? '✓' : '🔒'}</i>Kit franchisé<small>PDF · tablette</small>
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="hub-layout">
        <div className="hub-main">
          {error ? <p className="error">{error}</p> : null}
          {current === '__kit' ? (
            <KitPanel campaignId={campaignId} brandAdmin={brandAdmin} production={production} />
          ) : section ? (
            <section className="card wizard-card">
              <div className="ps-head">
                <div>
                  <h3>{section.label}</h3>
                  <p>
                    {[section.description, section.quantity ? `${section.quantity} prévus` : null, section.details, section.agency ? `prestataire : ${section.agency}` : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="ps-head__side">
                  <span className={`ps-st ps-st--${section.status === 'validated' ? 'ok' : section.status === 'todo' ? 'no' : 'wa'}`}>{STATUS_LABELS[section.status]}</span>
                  {section.dueOn ? <span className="muted">échéance {shortDate(section.dueOn)}</span> : null}
                  {section.editor && onOpenEditor && ['brochures', 'social-post'].includes(section.editor) ? (
                    <button type="button" className="btn btn--sm" onClick={() => onOpenEditor(section.editor as string)}>
                      {section.editor === 'brochures' ? 'Ouvrir Brochures & leaflets' : 'Ouvrir Créer un post'}
                    </button>
                  ) : null}
                </div>
              </div>

              {section.perShop ? (
                <table className="ps-table">
                  <thead>
                    <tr><th>Boutique</th><th>Emplacements</th><th>État du BAT</th><th>Retour</th><th /></tr>
                  </thead>
                  <tbody>
                    {section.shops.map((shop) => (
                      <tr key={shop.shopId}>
                        <td><b>{shop.shopName}</b></td>
                        <td>{supportsText(shop)}</td>
                        <td><span className={`ps-st ps-st--${shop.status === 'validated' ? 'ok' : shop.status === 'redo' ? 'ko' : shop.status === 'sent' ? 'wa' : 'no'}`}>{SHOP_LABELS[shop.status]}</span></td>
                        <td>
                          <input className="ps-note" value={shopNotes[shop.shopId] ?? ''} maxLength={300} placeholder="Retour du franchisé…"
                            onChange={(e) => setShopNotes((all) => ({ ...all, [shop.shopId]: e.target.value }))} />
                        </td>
                        <td className="ps-actions-cell">
                          {brandAdmin ? (
                            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => saveShop(shop.shopId, 'sent')}>BAT envoyé</button>
                          ) : null}
                          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => saveShop(shop.shopId, 'validated')}>Valider</button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => saveShop(shop.shopId, 'redo')}>À refaire</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {brandAdmin ? (
                <>
                  <label className="ps-field">
                    <span>Note de la section</span>
                    <textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Ce qui reste à faire, qui s’en charge, où sont les fichiers…" />
                  </label>
                  <div className="ps-status">
                    {(['todo', 'doing', 'ready'] as ProductionStatus[]).map((status) => (
                      <button key={status} type="button" className={`choice-pill${section.status === status ? ' is-on' : ''}`} disabled={busy} onClick={() => save(status)}>
                        {STATUS_LABELS[status]}
                      </button>
                    ))}
                  </div>
                </>
              ) : section.note ? <p className="muted ps-readnote">{section.note}</p> : null}

              <div className="ps-actions">
                <button type="button" className="btn" disabled={!previous} onClick={() => previous && setCurrent(previous.code)}>← {previous?.label ?? 'Début'}</button>
                <span className="ps-actions__right">
                  {brandAdmin && missingShops > 0 ? <span className="why">{missingShops} BAT à valider</span> : null}
                  {brandAdmin ? (
                    <button type="button" className="btn btn--primary" disabled={busy || missingShops > 0 || section.status === 'validated'} onClick={() => save('validated')}>
                      {section.status === 'validated' ? 'Section validée' : 'Valider la section'}
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={() => setCurrent(next ? next.code : '__kit')}>Suivant : {next?.label ?? 'Kit franchisé'} →</button>
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="hub-aside">
          <section className="card hub-aside__card">
            <span className="hub-aside__kicker">Échéances</span>
            <h3>Ce qui presse</h3>
            {upcoming.length === 0 ? <p>Rien en retard ni à venir parmi les sections ouvertes.</p> : upcoming.map((s) => (
              <button key={s.code} type="button" className="ps-due" onClick={() => setCurrent(s.code)}>
                <b>{shortDate(s.dueOn)}</b>
                <span>{s.label}<small>{STATUS_LABELS[s.status]}</small></span>
              </button>
            ))}
            {production.startsOn ? (
              <div className="ps-due ps-due--static"><b>{shortDate(production.startsOn)}</b><span>Lancement<small>début de la campagne</small></span></div>
            ) : null}
          </section>
          <section className="card hub-aside__card">
            <span className="hub-aside__kicker">Kit franchisé</span>
            <h3>{production.kitReady ? 'Prêt à envoyer' : 'Se monte tout seul'}</h3>
            <p>Chaque section validée y entre, à la mesure de chaque boutique. L’envoi s’ouvre quand les {production.total} sont validées.</p>
            <ul className="ps-kitlist">
              {production.sections.map((s) => (
                <li key={s.code}><i className={s.status === 'validated' ? '' : 'no'}>{s.status === 'validated' ? '✓' : ''}</i>{s.label}</li>
              ))}
            </ul>
            <button type="button" className="btn btn--sm ps-kitbtn" onClick={() => setCurrent('__kit')}>
              {production.kitReady ? 'Ouvrir le kit' : `Kit · ${production.validated} sur ${production.total}`}
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
