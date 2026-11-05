import { module as api } from '../../lib/api'
import type {
  CampaignVouchers,
  WebshopVoucher,
} from '../../lib/api/module'
import { formatDate, formatEur, formatNumber, useAsync } from '../../lib/useAsync'
import type { Draft } from './CampaignBuilder'
import ErpVouchers from './ErpVouchers'

/**
 * Sous-étape « Bons » de « Offre & promotions ».
 *
 * Un bon se crée comme une promotion — une mécanique, ce qu'elle touche, quand
 * elle vaut — mais c'est un CODE : il ne vaut que pour qui l'a, et c'est ce qui
 * dit ce qu'un flyer, un post ou un e-mail a vraiment rapporté.
 *
 * Depuis le 05/11/2026, il vit dans TFBuddy (`ErpVouchers`) : une campagne de
 * bons rattachée à une promotion de l'étape « Prix » passée en « bon seulement »,
 * qui vaut en caisse comme au webshop. Les bons de l'ancien moteur du webshop
 * restent affichés ici, en lecture seule, avec ce qu'ils ont rapporté.
 */

/** Les bons d'une campagne. `version` relance la lecture après un changement. */
export function useCampaignVouchers(campaignId: number | null, version = 0) {
  return useAsync<CampaignVouchers | null>(
    () => (campaignId === null ? Promise.resolve(null) : api.campaignVouchers(campaignId)),
    [campaignId, version],
  )
}

/** « −10 % sur le panier · dès 25 € », « 1 × Bûche offerte », « Livraison offerte ». */
export function remiseOf(v: WebshopVoucher): string {
  const produit = v.scope_product_name
  let texte: string
  switch (v.mechanic) {
    case 'promotions': {
      const n = v.promotions?.length ?? 0
      texte = `Déclenche ${n} promotion${n > 1 ? 's' : ''} de la campagne`
      break
    }
    case 'product':
      texte = `${v.scope_max_qty ?? 1} × ${produit ?? 'produit'} offert`
      break
    case 'free_delivery':
      texte = 'Livraison offerte'
      break
    case 'fixed':
      texte = `−${formatEur(v.value ?? 0, 2)} ${produit ? `sur ${produit}` : 'sur le panier'}`
      break
    case 'percent':
      texte = `−${formatNumber(v.value)} % ${produit ? `sur ${produit}` : 'sur le panier'}`
      break
    default:
      texte = 'Remise'
  }
  if (v.mechanic !== 'product' && produit && v.scope_max_qty) {
    texte += ` (${v.scope_max_qty} pièce${v.scope_max_qty > 1 ? 's' : ''} au plus)`
  }

  return v.min_order ? `${texte} · dès ${formatEur(v.min_order, 0)}` : texte
}

function validiteOf(v: WebshopVoucher): string {
  if (v.starts_on && v.ends_on) return `${formatDate(v.starts_on)} → ${formatDate(v.ends_on)}`
  if (v.ends_on) return `jusqu’au ${formatDate(v.ends_on)}`
  if (v.starts_on) return `dès le ${formatDate(v.starts_on)}`

  return 'sans date de fin'
}

function cibleOf(v: WebshopVoucher): string {
  if (v.target_kind === 'OFFICE') return v.target_label ?? 'Un bureau'
  if (v.target_kind === 'CUSTOMER' || v.target_kind === 'GROUP') return v.target_label ?? 'Ciblé'

  return 'Tout le monde'
}

type VouchersState = ReturnType<typeof useCampaignVouchers>

/**
 * `state` : les bons, lus une fois par l'assistant (le résumé de droite et le
 * récap s'en servent aussi) ; `onChanged` relance cette lecture.
 */
export function VouchersStep({
  draft,
  campaignId,
  state,
  printed,
}: {
  draft: Draft
  campaignId: number | null
  isBrand: boolean
  state: VouchersState
  onChanged: () => void
  /** Le support « Bons imprimés » : les cartes remises en caisse, avec le code d'un bon. */
  printed?: { on: boolean; quantity: string; details: string; toggle: () => void; set: (change: { quantity?: string; details?: string }) => void }
}) {
  const data = state.data

  return (
    <>
      <h2>Bons</h2>
      <p className="muted">
        Un bon est un code : il ne vaut que pour qui l’a, et c’est ce qui dit ce qu’un flyer, un post ou un e-mail a
        vraiment rapporté. Il se crée dans TFBuddy à partir d’une promotion de l’étape « Prix » (qui ne s’applique
        alors qu’avec le code) et vaut en caisse comme au webshop : un code pour tous, ou des codes uniques à imprimer.
      </p>

      {printed ? (
        <section className={`vouchers__printed${printed.on ? ' is-on' : ''}`}>
          <button type="button" className={printed.on ? 'switch is-on' : 'switch'} aria-pressed={printed.on} onClick={printed.toggle}>
            <span className="switch__track" aria-hidden="true" />
            <span className="switch__label">Imprimer le bon et le remettre en boutique</span>
            <span className="switch__hint">
              Une carte remise en caisse avec un code du bon. Elle devient le support « Bons imprimés » : elle passe dans
              le fil de production et dans le kit des franchisés.
            </span>
          </button>
          {printed.on ? (
            <div className="vouchers__printed-row">
              <label className="field">Cartes au total
                <input inputMode="numeric" value={printed.quantity} placeholder="2000" onChange={(e) => printed.set({ quantity: e.target.value.replace(/[^\d]/g, '').slice(0, 7) })} />
              </label>
              <label className="field vouchers__printed-details">Quand la remettre
                <input value={printed.details} maxLength={300} placeholder="avec chaque bûche retirée" onChange={(e) => printed.set({ details: e.target.value })} />
              </label>
              <p className="vouchers__hint">Avec des codes uniques (un par carte), chaque utilisation dit quelle carte, donc quelle boutique, a rapporté.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {campaignId === null ? (
        <p className="pending">La campagne s’enregistre à l’étape suivante : ses bons se créent ensuite.</p>
      ) : (
        <ErpVouchers campaignId={campaignId} startsOn={draft.starts_on} endsOn={draft.ends_on} />
      )}

      {campaignId !== null && data !== null && data.vouchers.length > 0 ? (
        <>
          <h3 className="section-label">
            Anciens bons du webshop
            <span className="section-label__aside">lecture seule · l’ancien moteur du webshop, remplacé par TFBuddy</span>
          </h3>
          {data.message !== null ? <p className="tag-warn vouchers__notice">{data.message}</p> : null}
          <div className="table-card">
            <div className="table-scroll">
              <table className="vouchers vouchers--list">
                <thead>
                  <tr><th>Code</th><th>Remise</th><th>Pour qui</th><th>Validité</th><th className="num">Utilisé</th></tr>
                </thead>
                <tbody>
                  {data.vouchers.map((v) => (
                    <tr key={v.code}>
                      <td><span className="vouchers__code">{v.code}</span><span className="sub">webshop{v.active === false ? ' · suspendu' : ''}</span></td>
                      <td>{v.found ? remiseOf(v) : <span className="muted">introuvable dans le webshop</span>}</td>
                      <td>{v.found ? cibleOf(v) : '—'}</td>
                      <td>{v.found ? validiteOf(v) : '—'}</td>
                      <td className="num">{v.found ? `${formatNumber(v.usage_count)}${v.usage_limit !== null ? ` / ${formatNumber(v.usage_limit)}` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

/** Récap & résultats : ce que les bons ont donné. Rien si la campagne n'en a pas. */
export function VoucherResults({ state }: { state: VouchersState }) {
  const data = state.data
  if (data === null || data.vouchers.length === 0) return null

  const totals = data.totals

  return (
    <div className="vouchers__results">
      <h3 className="section-label">
        Bons · ce qu’ils ont donné
        <span className="section-label__aside">Commandes webshop passées avec un code de la campagne, hors annulées</span>
      </h3>
      {data.message !== null ? <p className="tag-warn vouchers__notice">{data.message}</p> : null}
      {totals !== null ? (
        <div className="hub-kpis">
          <div className="hub-kpi"><span className="muted">Commandes avec un bon</span><b>{formatNumber(totals.orders)}</b><span className="muted">{data.vouchers.length} bon{data.vouchers.length > 1 ? 's' : ''}</span></div>
          <div className="hub-kpi"><span className="muted">Chiffre d’affaires</span><b>{formatEur(totals.revenue, 2)}</b><span className="muted">TTC, commandes avec un bon</span></div>
          <div className="hub-kpi"><span className="muted">Remise accordée</span><b>{formatEur(totals.discount, 2)}</b><span className="muted">par les bons</span></div>
          <div className="hub-kpi"><span className="muted">Panier moyen</span><b>{totals.average_basket === null ? '—' : formatEur(totals.average_basket, 2)}</b><span className="muted">avec un bon</span></div>
        </div>
      ) : null}
      <div className="table-card">
        <div className="table-scroll">
          <table className="vouchers">
            <thead>
              <tr>
                <th>Code</th>
                <th className="num">Commandes</th>
                <th className="num">Chiffre d’affaires</th>
                <th className="num">Remise</th>
                <th>Par boutique</th>
              </tr>
            </thead>
            <tbody>
              {data.vouchers.map((v) => (
                <tr key={v.code}>
                  <td><span className="vouchers__code">{v.code}</span></td>
                  <td className="num">
                    {v.results ? formatNumber(v.results.orders) : '—'}
                    {v.usage_limit !== null ? <span className="sub">sur {formatNumber(v.usage_limit)} prévues</span> : null}
                  </td>
                  <td className="num">{v.results ? formatEur(v.results.revenue, 2) : '—'}</td>
                  <td className="num">{v.results ? formatEur(v.results.discount, 2) : '—'}</td>
                  <td>
                    {v.results && v.results.by_shop.length > 0
                      ? v.results.by_shop.map((shop) => `${shop.shop_name} ${shop.orders}`).join(' · ')
                      : <span className="muted">aucune commande</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
