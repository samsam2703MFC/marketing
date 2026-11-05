import { useAsync } from '../../lib/useAsync'
import { module as api } from '../../lib/api'
import type { Draft } from './CampaignBuilder'

/**
 * La prime de la marque pour le personnel (maquette du 05/11/2026) : payée par
 * la marque, pour l'équipe de vente de chaque boutique, quand la boutique
 * atteint son objectif — ou à la pièce, ou selon son rang au challenge.
 *
 * Elle se calcule au bilan, sur les ventes de la caisse. L'écran en montre
 * l'estimation : par boutique, à l'objectif et au palier, plafond compris. Son
 * plafond total entre dans « Budget & validation ».
 */

const RULES: Array<[Draft['staff_bonus_rule'], string, string]> = [
  ['attainment', 'Objectif atteint', 'dès le seuil de l’objectif de la boutique'],
  ['per_piece', 'À la pièce', 'un montant par pièce vendue au-delà du seuil'],
  ['ranking', 'Au classement', 'les boutiques en tête du challenge'],
]
const FORMS: Array<[Draft['staff_bonus_form'], string]> = [
  ['voucher', 'Bon d’achat L’Atelier'],
  ['gift_cheque', 'Chèques cadeaux'],
  ['franchisee', 'Versée au franchisé, qui la redistribue'],
]

function num(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  return value.trim() === '' || !Number.isFinite(n) ? null : n
}

function eur(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} €`
}

/** Plafond total de la prime (toutes boutiques), pour le budget. Null si on ne peut pas le dire. */
export function staffBonusCeiling(draft: Draft, shopIds: number[]): number | null {
  if (!draft.staff_bonus_enabled || draft.staff_bonus_rule === 'per_piece') return null
  const amount = num(draft.staff_bonus_amount)
  if (amount === null) return null
  const extra = num(draft.staff_bonus_extra_amount) ?? 0
  const cap = num(draft.staff_bonus_cap_amount)
  let total = 0
  for (const id of shopIds) {
    const people = num(draft.shop_headcounts[id] ?? '')
    if (people === null) continue
    const most = (amount + extra) * people
    total += cap !== null ? Math.min(cap, most) : most
  }
  return total
}

export default function StaffBonus({ draft, patch }: { draft: Draft; patch: (change: Partial<Draft>) => void }) {
  const shops = useAsync(() => api.listShops(), [])
  const list = (shops.data ?? []).filter((shop) => draft.scope !== 'LOCALE' || draft.shop_ids.includes(shop.id))
  const amount = num(draft.staff_bonus_amount)
  const extra = num(draft.staff_bonus_extra_amount)
  const cap = num(draft.staff_bonus_cap_amount)
  const capped = (v: number | null) => (v === null ? null : cap !== null ? Math.min(cap, v) : v)

  let totalAt = 0
  let totalExtra = 0
  let people = 0

  return (
    <section className="card wizard-card bonus">
      <h3 className="section-label">
        Prime de la marque pour le personnel
        <span className="section-label__aside">Facultatif · payée par la marque, pour l’équipe de vente de chaque boutique</span>
      </h3>
      <button
        type="button"
        className={draft.staff_bonus_enabled ? 'switch is-on' : 'switch'}
        aria-pressed={draft.staff_bonus_enabled}
        onClick={() => patch({ staff_bonus_enabled: !draft.staff_bonus_enabled })}
      >
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">Attacher une prime à cette campagne</span>
        <span className="switch__hint">
          {draft.staff_bonus_enabled
            ? 'Elle paraît dans le kit des franchisés, et son plafond dans le budget.'
            : 'Sans prime, les équipes ne jouent que l’objectif et, s’il y en a un, le challenge.'}
        </span>
      </button>

      {draft.staff_bonus_enabled ? (
        <div className="bonus__form">
          <span className="bonus__k">Pour qui</span>
          <div className="bonus__row">
            {(['team', 'named'] as const).map((who) => (
              <button key={who} type="button" className={`choice-pill${draft.staff_bonus_who === who ? ' is-on' : ''}`} onClick={() => patch({ staff_bonus_who: who })}>
                {who === 'team' ? 'Toute l’équipe de vente' : 'Les vendeurs nommés'}
              </button>
            ))}
          </div>

          <span className="bonus__k">Quand</span>
          <div className="bonus__rules">
            {RULES.map(([rule, label, hint]) => (
              <button key={rule} type="button" className={draft.staff_bonus_rule === rule ? 'is-on' : ''} onClick={() => patch({ staff_bonus_rule: rule })}>
                <b>{label}</b>{hint}
              </button>
            ))}
          </div>

          {draft.staff_bonus_rule !== 'ranking' ? (
            <>
              <span className="bonus__k">Seuil</span>
              <div className="bonus__row">
                <input className="bonus__in" inputMode="decimal" value={draft.staff_bonus_threshold_pct} onChange={(e) => patch({ staff_bonus_threshold_pct: e.target.value })} />
                <span className="muted">% de l’objectif de la boutique</span>
              </div>
            </>
          ) : null}

          <span className="bonus__k">Combien</span>
          <div className="bonus__row">
            <input className="bonus__in" inputMode="decimal" placeholder="40" value={draft.staff_bonus_amount} onChange={(e) => patch({ staff_bonus_amount: e.target.value })} />
            <span className="muted">€ {draft.staff_bonus_rule === 'per_piece' ? 'par pièce' : 'par personne'}</span>
            {draft.staff_bonus_rule === 'attainment' ? (
              <>
                <span className="muted">+</span>
                <input className="bonus__in" inputMode="decimal" placeholder="10" value={draft.staff_bonus_extra_amount} onChange={(e) => patch({ staff_bonus_extra_amount: e.target.value })} />
                <span className="muted">€ à</span>
                <input className="bonus__in" inputMode="decimal" placeholder="120" value={draft.staff_bonus_extra_pct} onChange={(e) => patch({ staff_bonus_extra_pct: e.target.value })} />
                <span className="muted">% de l’objectif</span>
              </>
            ) : null}
            <input className="bonus__in" inputMode="decimal" placeholder="200" value={draft.staff_bonus_cap_amount} onChange={(e) => patch({ staff_bonus_cap_amount: e.target.value })} />
            <span className="muted">€ de plafond par boutique</span>
          </div>

          <span className="bonus__k">Sous quelle forme</span>
          <div className="bonus__row">
            {FORMS.map(([form, label]) => (
              <button key={form} type="button" className={`choice-pill${draft.staff_bonus_form === form ? ' is-on' : ''}`} onClick={() => patch({ staff_bonus_form: form })}>{label}</button>
            ))}
          </div>

          <span className="bonus__k">Versée le</span>
          <div className="bonus__row">
            <input className="bonus__in bonus__in--date" type="date" value={draft.staff_bonus_paid_on} onChange={(e) => patch({ staff_bonus_paid_on: e.target.value })} />
            <span className="muted">après le bilan de la campagne</span>
          </div>
        </div>
      ) : null}

      {draft.staff_bonus_enabled ? (
        <div className="mq-detail bonus__table">
          <h4>Estimation <span className="muted">la prime se calcule au bilan, sur les ventes de la caisse</span></h4>
          <table>
            <thead>
              <tr><th>Boutique</th><th>Objectif</th><th>Équipe de vente</th>{draft.staff_bonus_rule === 'attainment' ? <><th>À l’objectif</th><th>Au palier</th></> : null}</tr>
            </thead>
            <tbody>
              {list.map((shop) => {
                const headcount = num(draft.shop_headcounts[shop.id] ?? '')
                const at = amount !== null && headcount !== null ? capped(amount * headcount) : null
                const atExtra = amount !== null && extra !== null && headcount !== null ? capped((amount + extra) * headcount) : at
                totalAt += at ?? 0
                totalExtra += atExtra ?? 0
                people += headcount ?? 0
                return (
                  <tr key={shop.id}>
                    <td>{shop.name}</td>
                    <td>{draft.shop_objectives[shop.id] ? `${draft.shop_objectives[shop.id]} pièces` : <span className="muted">—</span>}</td>
                    <td>
                      <input className="bonus__in bonus__in--sm" inputMode="numeric" value={draft.shop_headcounts[shop.id] ?? ''} placeholder="—"
                        onChange={(e) => patch({ shop_headcounts: { ...draft.shop_headcounts, [shop.id]: e.target.value.replace(/[^\d]/g, '').slice(0, 3) } })} />
                    </td>
                    {draft.staff_bonus_rule === 'attainment' ? <><td>{eur(at)}</td><td>{eur(atExtra)}</td></> : null}
                  </tr>
                )
              })}
              <tr className="bonus__total">
                <td>Total</td><td />
                <td>{people || '—'}</td>
                {draft.staff_bonus_rule === 'attainment' ? <><td>{eur(totalAt || null)}</td><td>{eur(totalExtra || null)}{totalExtra ? ' au plus' : ''}</td></> : null}
              </tr>
            </tbody>
          </table>
          <p className="muted bonus__note">L’équipe de vente se saisit ici : l’ERP ne la donne pas. Dans le kit des franchisés, une page « Prime de l’équipe » reprend la règle et ce qu’elle rapporte à la boutique.</p>
        </div>
      ) : null}
    </section>
  )
}
