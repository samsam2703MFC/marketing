import { useMemo, useState } from 'react'
import type { Kit, KitPost } from '../../lib/api/module'
import { shortDate } from './ProductionPanel'
import './production.css'

/**
 * Le kit d'une boutique, lu sur la tablette (paysage ou portrait) et imprimé en
 * A4 : « Télécharger le PDF » passe par l'impression du navigateur, qui
 * enregistre en PDF — sur une tablette comme sur un ordinateur.
 */

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const NETWORKS: Record<string, string> = { fb: 'Facebook', ig: 'Instagram', google: 'Google' }

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return `${DAYS[date.getUTCDay()]} ${shortDate(iso)}`
}

function weekOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000)
  return monday.toISOString().slice(0, 10)
}

function euros(cents: number | null): string {
  if (cents === null) return '—'
  return `${(cents / 100).toLocaleString('fr-BE', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`
}

function size(s: { widthCm: number | null; heightCm: number | null; paperFormat: string | null }): string {
  return s.widthCm && s.heightCm ? `${s.widthCm} × ${s.heightCm} cm` : s.paperFormat ?? '—'
}

interface Props {
  kit: Kit
  /** Lecture par le lien de la boutique : l'accusé de lecture est proposé. */
  onRead?: () => void
  reading?: boolean
}

export default function KitReader({ kit, onRead, reading = false }: Props) {
  const langs = (['fr', 'nl'] as const).filter((l) => kit.messages[l]?.title || kit.messages[l]?.hook)
  const [lang, setLang] = useState<'fr' | 'nl'>(langs[0] ?? 'fr')
  const message = kit.messages[lang] ?? null

  const weeks = useMemo(() => {
    const out: Array<{ monday: string; posts: KitPost[] }> = []
    for (const post of kit.posts) {
      const monday = weekOf(post.date)
      const last = out[out.length - 1]
      if (last && last.monday === monday) last.posts.push(post)
      else out.push({ monday, posts: [post] })
    }
    return out
  }, [kit.posts])

  const sections = [
    { id: 'essentiel', label: 'À retenir', show: true },
    { id: 'posts', label: 'Calendrier des posts', show: true, count: kit.posts.length },
    { id: 'affichage', label: 'Affiches & bâches', show: kit.displays.baches.length + kit.displays.affiches.length > 0, count: kit.displays.baches.length + kit.displays.affiches.length },
    { id: 'supports', label: 'Supports & goodies', show: kit.supports.length > 0, count: kit.supports.length },
    { id: 'equipe', label: 'Tenues & consignes', show: kit.uniforms.length > 0 || kit.counter.questions.length > 0 },
    { id: 'prime', label: 'Prime de l’équipe', show: kit.bonus !== null },
  ].filter((s) => s.show)

  const [active, setActive] = useState('essentiel')
  function go(id: string) {
    setActive(id)
    document.getElementById(`kit-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const bonus = kit.bonus
  return (
    <div className="kit">
      <header className="kit__bar">
        <div>
          <div className="kit__title">Kit campagne · {kit.campaign.name}</div>
          <div className="kit__sub">
            {kit.shop.name}{kit.version ? ` · version ${kit.version} du ${shortDate(kit.createdAt?.slice(0, 10) ?? null)}` : ' · aperçu'}
          </div>
        </div>
        <span className="kit__sp" />
        {langs.length > 1 ? (
          <span className="kit__langs">
            {langs.map((l) => <button key={l} type="button" className={l === lang ? 'is-on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
          </span>
        ) : null}
        <button type="button" className="kit__btn" onClick={() => window.print()}>Télécharger le PDF</button>
      </header>

      <div className="kit__body">
        <nav className="kit__nav" aria-label="Sommaire du kit">
          {sections.map((s) => (
            <button key={s.id} type="button" className={active === s.id ? 'is-on' : ''} onClick={() => go(s.id)}>
              {s.label}{s.count ? <small>{s.count}</small> : null}
            </button>
          ))}
          {onRead ? (
            <button type="button" className={`kit__read${kit.readAt ? ' is-done' : ''}`} onClick={onRead} disabled={reading || kit.readAt !== null}>
              {kit.readAt ? '✓ Kit lu' : reading ? 'Envoi…' : '✓ J’ai lu le kit'}
              <small>{kit.readAt ? `le ${shortDate(kit.readAt.slice(0, 10))}` : 'la marque voit que c’est fait'}</small>
            </button>
          ) : null}
        </nav>

        <main className="kit__main">
          <section className="kit__cover" aria-hidden="true">
            <div className="kit__cover-k">Kit campagne</div>
            <h1>{message?.title || kit.campaign.name}</h1>
            {message?.hook ? <p className="kit__hook">{message.hook}</p> : null}
            <div className="kit__cover-shop">{kit.shop.name}</div>
            <div className="kit__cover-dates">{shortDate(kit.campaign.startsOn)} → {shortDate(kit.campaign.endsOn)}{kit.version ? ` · version ${kit.version}` : ''}</div>
          </section>

          <section id="kit-essentiel" className="kit__sec">
            <h2>À retenir</h2>
            <p className="kit__lead">Ce que vos clients vont voir, et ce qu’on attend de la boutique.</p>
            {message ? (
              <div className="kit__msg">
                <b>{message.title}</b>{message.hook ? <span> — {message.hook}</span> : null}
                {message.offerLine ? <div>{message.offerLine}</div> : null}
                {message.cta ? <div className="kit__cta">{message.cta}</div> : null}
              </div>
            ) : null}
            {kit.offer ? (
              <>
                <h3>L’offre</h3>
                <p>{[kit.offer.title, kit.offer.mechanicText, kit.offer.discountLabel, kit.offer.priceLabel].filter(Boolean).join(' · ') || '—'}
                  {kit.offer.startsOn || kit.offer.endsOn ? ` (${shortDate(kit.offer.startsOn)} → ${shortDate(kit.offer.endsOn)})` : ''}</p>
                {kit.offer.items.length > 0 ? <p className="kit__muted">{kit.offer.items.map((i) => i.label).join(' · ')}</p> : null}
              </>
            ) : null}
            <h3>Les dates</h3>
            <table className="kit__table">
              <tbody>
                {kit.dates.map((d, i) => (
                  <tr key={i} className={d.shopTask ? 'is-task' : ''}>
                    <td className="kit__date">{dayLabel(d.on)}</td>
                    <td>{d.label}{d.shopTask ? <em> à faire en boutique</em> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="kit-posts" className="kit__sec">
            <h2>Calendrier des posts</h2>
            <p className="kit__lead">Ce qui paraît sur la page de votre boutique. La marque les publie : rien à faire, sinon les liker et les partager.</p>
            {weeks.length === 0 ? <p className="kit__muted">Aucun post rattaché à la campagne pour votre boutique.</p> : weeks.map((w) => (
              <div key={w.monday} className="kit__week">
                <b>Semaine du {shortDate(w.monday)}</b>
                <div className="kit__posts">
                  {w.posts.map((p, i) => (
                    <div key={i} className="kit__post">
                      {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="kit__ph">{p.kind === 'story' ? 'Story' : 'Post'}</span>}
                      <div>
                        <b>{p.title}</b>
                        <small>{dayLabel(p.date)}{p.time ? ` · ${p.time}` : ''}</small>
                        <small>{p.networks.map((n) => NETWORKS[n] ?? n).join(' + ') || '—'}{p.kind === 'story' ? ' · story' : ''}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {kit.displays.baches.length + kit.displays.affiches.length > 0 ? (
            <section id="kit-affichage" className="kit__sec">
              <h2>Affiches & bâches</h2>
              <table className="kit__table">
                <thead><tr><th>Support</th><th>Emplacement</th><th>Format</th><th>Qté</th></tr></thead>
                <tbody>
                  {kit.displays.baches.map((s, i) => (
                    <tr key={`b${i}`}><td>Bâche</td><td>{s.placement ?? '—'}</td><td>{size(s)}{s.material ? ` · ${s.material}` : ''}{s.fixing ? ` · ${s.fixing}` : ''}</td><td>{s.quantity}</td></tr>
                  ))}
                  {kit.displays.affiches.map((s, i) => (
                    <tr key={`a${i}`}><td>Affiche</td><td>{s.placement ?? '—'}</td><td>{size(s)}</td><td>{s.quantity}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {kit.supports.length > 0 ? (
            <section id="kit-supports" className="kit__sec">
              <h2>Supports & goodies</h2>
              <table className="kit__table">
                <thead><tr><th /><th>Support</th><th>Quantité · précisions</th><th>Pour le</th></tr></thead>
                <tbody>
                  {kit.supports.map((s) => (
                    <tr key={s.code}>
                      <td><span className="kit__chk" aria-hidden="true" /></td>
                      <td>{s.label}<small className="kit__muted"> {s.group}</small></td>
                      <td>{[s.quantity ? String(s.quantity) : null, s.details, s.agency ? `par ${s.agency}` : null].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="kit__date">{s.dueOn ? shortDate(s.dueOn) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {kit.uniforms.length > 0 || kit.counter.questions.length > 0 ? (
            <section id="kit-equipe" className="kit__sec">
              <h2>Tenues & consignes</h2>
              {kit.uniforms.length > 0 ? (
                <>
                  <h3>À porter pendant la campagne</h3>
                  <ul className="kit__list">{kit.uniforms.map((u) => <li key={u}>{u}</li>)}</ul>
                </>
              ) : null}
              {kit.counter.questions.length > 0 ? (
                <>
                  <h3>En caisse</h3>
                  <ul className="kit__list kit__list--say">{kit.counter.questions.map((q) => <li key={q}>« {q} »</li>)}</ul>
                </>
              ) : null}
              {message?.cta ? <p className="kit__muted">Appel à l’action de la campagne : {message.cta}</p> : null}
            </section>
          ) : null}

          {bonus ? (
            <section id="kit-prime" className="kit__sec">
              <h2>Prime de l’équipe</h2>
              <p className="kit__big">
                {bonus.rule === 'per_piece'
                  ? `${euros(bonus.amountCents)} par pièce vendue${bonus.thresholdPct !== null ? ` au-delà de ${bonus.thresholdPct} % de l’objectif` : ''}`
                  : bonus.rule === 'ranking'
                    ? `${euros(bonus.amountCents)} par personne pour les boutiques en tête du challenge`
                    : `${euros(bonus.amountCents)} par personne dès ${bonus.thresholdPct ?? 100} % de l’objectif`}
              </p>
              <table className="kit__table">
                <tbody>
                  {bonus.targetPieces !== null ? <tr><td>Objectif de la boutique</td><td>{bonus.targetPieces.toLocaleString('fr-BE')} pièces</td></tr> : null}
                  {bonus.extraAmountCents !== null && bonus.extraPct !== null ? <tr><td>Palier</td><td>+ {euros(bonus.extraAmountCents)} par personne à {bonus.extraPct} %</td></tr> : null}
                  {bonus.capAmountCents !== null ? <tr><td>Plafond</td><td>{euros(bonus.capAmountCents)} pour la boutique</td></tr> : null}
                  {bonus.headcount !== null ? <tr><td>Équipe de vente</td><td>{bonus.headcount} personne{bonus.headcount > 1 ? 's' : ''}</td></tr> : null}
                  {bonus.atThresholdCents !== null ? <tr><td>Pour l’équipe, à l’objectif</td><td>{euros(bonus.atThresholdCents)}</td></tr> : null}
                  {bonus.atExtraCents !== null ? <tr><td>Au palier</td><td>{euros(bonus.atExtraCents)}</td></tr> : null}
                  <tr><td>Versée</td><td>{[bonus.formLabel, bonus.paidOn ? `le ${shortDate(bonus.paidOn)}` : null].filter(Boolean).join(', ') || '—'}</td></tr>
                </tbody>
              </table>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  )
}
