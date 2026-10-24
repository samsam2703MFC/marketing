import { useState } from 'react'
import { module as api } from '../../lib/api'
import type { AttachableVoucher, CampaignVoucher, CampaignVouchers, VoucherInput, VoucherMechanic, WebshopVoucher } from '../../lib/api/module'
import { describeError } from '../../state/auth'
import { formatDate, formatEur, formatNumber, useAsync } from '../../lib/useAsync'
import type { Draft } from './CampaignBuilder'
import { slugOf, useAttached } from './Hub'

/**
 * Sous-étape « Bons » de « Offre & promotions ».
 *
 * Un bon se crée comme une promotion — une mécanique, ce qu'elle touche, quand
 * elle vaut — mais c'est un CODE : il ne vaut que pour qui l'a, et c'est ce qui
 * dit ce qu'un flyer, un post ou un e-mail a vraiment rapporté.
 *
 * Il vit dans le moteur de bons du webshop, qui l'applique au panier. L'écran
 * ne garde rien : chaque geste part à l'API, chaque liste en revient.
 */

const MECHANICS: Array<[VoucherMechanic, string]> = [
  ['percent', 'Pourcentage'],
  ['fixed', 'Montant en €'],
  ['product', 'Produit offert'],
  ['free_delivery', 'Livraison offerte'],
]

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

/** Code proposé d'après le nom de la campagne : « Reve » + 10 % → REVE10. */
function codePropose(name: string, form: Form): string {
  const base = slugOf(name).replace(/-/g, '').toUpperCase().slice(0, 12) || 'CAMPAGNE'
  if (form.mechanic === 'percent' && /^\d{1,3}$/.test(form.value.trim())) return `${base}${form.value.trim()}`
  if (form.mechanic === 'fixed' && /^\d{1,4}$/.test(form.value.trim())) return `${base}${form.value.trim()}E`
  if (form.mechanic === 'free_delivery') return `${base}-PORT`
  if (form.mechanic === 'product') return `${base}-CADEAU`

  return base
}

interface Form {
  mechanic: VoucherMechanic
  value: string
  scope: 'cart' | 'product'
  offer_item_id: number | null
  max_qty: string
  min_order: string
  code: string
  codeTouched: boolean
  starts_on: string
  ends_on: string
  usage_total: string
  per_customer: string
  target_kind: 'NETWORK' | 'OFFICE'
  target_id: number | null
  target_label: string
}

function blankForm(draft: Draft): Form {
  return {
    mechanic: 'percent',
    value: '',
    scope: 'cart',
    offer_item_id: null,
    max_qty: '',
    min_order: '',
    code: '',
    codeTouched: false,
    starts_on: draft.starts_on,
    ends_on: draft.ends_on,
    usage_total: '',
    per_customer: '',
    target_kind: 'NETWORK',
    target_id: null,
    target_label: '',
  }
}

function formOf(v: CampaignVoucher, draft: Draft): Form {
  return {
    ...blankForm(draft),
    mechanic: v.mechanic ?? 'percent',
    value: v.value !== null && v.mechanic !== 'product' ? String(v.value) : '',
    min_order: v.min_order ? String(v.min_order) : '',
    code: v.code,
    codeTouched: true,
    starts_on: v.starts_on ?? '',
    ends_on: v.ends_on ?? '',
    usage_total: v.usage_limit !== null ? String(v.usage_limit) : '',
    per_customer: v.per_customer !== null ? String(v.per_customer) : '',
  }
}

type VouchersState = ReturnType<typeof useCampaignVouchers>

/**
 * `state` : les bons, lus une fois par l'assistant (le résumé de droite et le
 * récap s'en servent aussi) ; `onChanged` relance cette lecture.
 */
export function VouchersStep({
  draft,
  campaignId,
  isBrand,
  state,
  onChanged,
}: {
  draft: Draft
  campaignId: number | null
  isBrand: boolean
  state: VouchersState
  onChanged: () => void
}) {
  const attached = useAttached(campaignId)
  const [panel, setPanel] = useState<'none' | 'create' | 'attach'>('none')
  const [editing, setEditing] = useState<CampaignVoucher | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const data = state.data
  const slug = slugOf(draft.name)
  const webshop = attached.data?.webshop ?? null

  async function retirer(v: CampaignVoucher) {
    const effet = v.origin === 'created'
      ? `Le bon ${v.code} sera suspendu dans le webshop : il ne vaudra plus. Ses commandes passées restent.`
      : `Le bon ${v.code} ne sera plus suivi par la campagne ; il reste valable dans le webshop.`
    if (!window.confirm(effet)) return
    setBusy(v.code)
    setFailure(null)
    try {
      await api.detachCampaignVoucher(campaignId as number, v.code)
      onChanged()
    } catch (cause: unknown) {
      setFailure(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h2>Bons</h2>
      <p className="muted">
        Un bon est un code que le client tape au webshop. Contrairement à une promotion de l’étape « Prix », il ne
        vaut que pour qui a le code : c’est ce qui dit ce qu’un flyer, un post ou un e-mail a vraiment rapporté.
        Créez-le ici comme une promotion, ou rattachez un bon qui existe déjà.
      </p>

      {campaignId === null ? (
        <p className="pending">La campagne s’enregistre à l’étape suivante : ses bons se créent ensuite.</p>
      ) : state.loading && data === null ? (
        <p className="vouchers__hint">Lecture des bons dans le webshop…</p>
      ) : state.error !== null ? (
        <p className="error">{state.error}</p>
      ) : data !== null ? (
        <>
          {data.message !== null ? <p className="tag-warn vouchers__notice">{data.message}</p> : null}

          <h3 className="section-label">
            Bons de la campagne
            <span className="section-label__aside">Code saisi par le client au webshop · lus dans le webshop</span>
          </h3>
          {data.vouchers.length === 0 ? (
            <p className="vouchers__hint">{data.configured ? 'Aucun bon pour cette campagne.' : 'Liste indisponible tant que la connexion au webshop n’est pas configurée.'}</p>
          ) : (
            <div className="table-card">
              <div className="table-scroll">
                <table className="vouchers vouchers--list">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Remise</th>
                      <th>Pour qui</th>
                      <th>Validité</th>
                      <th className="num">Utilisé</th>
                      <th>Origine</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.vouchers.map((v) => (
                      <tr key={v.code}>
                        <td>
                          <span className="vouchers__code">{v.code}</span>
                          <span className="sub">Canal : webshop{v.active === false ? ' · suspendu' : ''}</span>
                        </td>
                        <td>{v.found ? remiseOf(v) : <span className="muted">introuvable dans le webshop</span>}</td>
                        <td>
                          {cibleOf(v)}
                          {v.per_customer ? <span className="sub">{v.per_customer} fois par client</span> : null}
                        </td>
                        <td>{v.found ? validiteOf(v) : '—'}</td>
                        <td className="num">
                          {v.usage_count ?? '—'}
                          {v.usage_limit !== null ? ` / ${formatNumber(v.usage_limit)}` : ''}
                        </td>
                        <td>
                          <span className={`vouchers__origin vouchers__origin--${v.origin}`}>
                            {v.origin === 'created' ? 'Créé ici' : 'Rattaché'}
                          </span>
                          {v.issuer ? <span className="sub">émis par {v.issuer === 'Marque' ? 'la marque' : v.issuer}</span> : null}
                        </td>
                        <td>
                          {data.can_edit ? (
                            <span className="vouchers__actions">
                              {v.origin === 'created' && v.found ? (
                                <button type="button" className="linklike" onClick={() => { setEditing(v); setPanel('create') }}>
                                  Modifier
                                </button>
                              ) : null}
                              <button type="button" className="linklike" disabled={busy === v.code} onClick={() => retirer(v)}>
                                {v.origin === 'created' ? 'Retirer' : 'Détacher'}
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {failure !== null ? <p className="error">{failure}</p> : null}

          {data.can_edit && data.configured ? (
            <div className="vouchers__bar">
              <button
                type="button"
                className={`btn${panel === 'create' && editing === null ? ' btn--primary' : ''}`}
                onClick={() => { setEditing(null); setPanel(panel === 'create' && editing === null ? 'none' : 'create') }}
              >
                + Créer un bon
              </button>
              <button
                type="button"
                className={`btn${panel === 'attach' ? ' btn--primary' : ''}`}
                onClick={() => { setEditing(null); setPanel(panel === 'attach' ? 'none' : 'attach') }}
              >
                Rattacher un bon existant
              </button>
            </div>
          ) : !data.can_edit ? (
            <p className="vouchers__hint">Les bons d’une campagne réseau se gèrent au niveau du réseau.</p>
          ) : null}

          {panel === 'create' ? (
            <VoucherForm
              key={editing?.code ?? 'nouveau'}
              draft={draft}
              campaignId={campaignId}
              isBrand={isBrand}
              editing={editing}
              lien={(code) => `${webshop ?? ''}?voucher=${encodeURIComponent(code)}&utm_campaign=${slug}`}
              onClose={() => { setPanel('none'); setEditing(null) }}
              onSaved={() => { setPanel('none'); setEditing(null); onChanged() }}
            />
          ) : null}
          {panel === 'attach' ? (
            <AttachPanel campaignId={campaignId} onClose={() => setPanel('none')} onAttached={onChanged} />
          ) : null}
        </>
      ) : null}
    </>
  )
}

function VoucherForm({
  draft,
  campaignId,
  isBrand,
  editing,
  lien,
  onClose,
  onSaved,
}: {
  draft: Draft
  campaignId: number
  isBrand: boolean
  editing: CampaignVoucher | null
  lien: (code: string) => string
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Form>(() => (editing ? formOf(editing, draft) : blankForm(draft)))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [officeQuery, setOfficeQuery] = useState('')
  const offices = useAsync(
    () => (form.target_kind === 'OFFICE' && isBrand ? api.webshopOffices(officeQuery) : Promise.resolve([])),
    [form.target_kind, officeQuery],
  )
  const set = (change: Partial<Form>) => setForm((previous) => ({ ...previous, ...change }))
  const produits = draft.offer_items.filter((item) => item.category === 'produit' && item.offer_item_id !== null)
  const code = form.codeTouched ? form.code : codePropose(draft.name, form)

  async function enregistrer() {
    setSaving(true)
    setFailure(null)
    const commun: VoucherInput = {
      min_order: form.min_order,
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      usage_total: form.usage_total,
      per_customer: form.per_customer,
      ...(form.mechanic === 'product' || form.mechanic === 'free_delivery' ? {} : { value: form.value }),
    }
    try {
      if (editing !== null) {
        await api.updateCampaignVoucher(campaignId, editing.code, commun)
      } else {
        await api.createCampaignVoucher(campaignId, {
          ...commun,
          mechanic: form.mechanic,
          code,
          offer_item_id: form.mechanic === 'product' || form.scope === 'product' ? form.offer_item_id : null,
          max_qty: form.max_qty,
          target_kind: form.target_kind,
          target_id: form.target_kind === 'OFFICE' ? form.target_id : null,
        })
      }
      onSaved()
    } catch (cause: unknown) {
      setFailure(describeError(cause))
      setSaving(false)
    }
  }

  const surProduit = form.mechanic === 'product' || form.scope === 'product'

  return (
    <div className="vouchers__form">
      <h3>{editing ? `Modifier ${editing.code}` : 'Nouveau bon'}</h3>
      <p className="vouchers__hint">
        {editing
          ? 'La mécanique et ce qu’elle touche restent : pour en changer, retirez ce bon et créez-en un autre.'
          : 'Comme une promotion : la mécanique, ce qu’elle touche et quand elle vaut. Le bon est créé dans le webshop dès que vous l’ajoutez.'}
      </p>
      <div className="vouchers__grid">
        {editing === null ? (
          <>
            <span className="vouchers__label">Mécanique</span>
            <div className="vouchers__row">
              {MECHANICS.map(([key, label]) => (
                <button key={key} type="button" className={`choice-pill${form.mechanic === key ? ' is-on' : ''}`} onClick={() => set({ mechanic: key })}>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {form.mechanic === 'percent' || form.mechanic === 'fixed' ? (
          <>
            <span className="vouchers__label">Remise</span>
            <div className="vouchers__row">
              <input className="vouchers__input vouchers__input--n" inputMode="decimal" value={form.value} placeholder={form.mechanic === 'percent' ? '10' : '5'} onChange={(e) => set({ value: e.target.value })} />
              <span className="vouchers__hint">{form.mechanic === 'percent' ? '%' : '€ TTC'}</span>
            </div>
          </>
        ) : null}

        {editing === null && form.mechanic !== 'free_delivery' ? (
          <>
            <span className="vouchers__label">Sur</span>
            <div className="vouchers__row">
              {form.mechanic !== 'product' ? (
                <>
                  <button type="button" className={`choice-pill${form.scope === 'cart' ? ' is-on' : ''}`} onClick={() => set({ scope: 'cart' })}>
                    Tout le panier
                  </button>
                  <button type="button" className={`choice-pill${form.scope === 'product' ? ' is-on' : ''}`} onClick={() => set({ scope: 'product' })}>
                    Un produit de l’offre
                  </button>
                </>
              ) : null}
              {surProduit ? (
                produits.length === 0 ? (
                  <span className="vouchers__hint">L’offre (étape « Offre ») n’a pas encore de produit.</span>
                ) : (
                  <select className="vouchers__input" value={form.offer_item_id ?? ''} onChange={(e) => set({ offer_item_id: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Choisir le produit…</option>
                    {produits.map((item) => (
                      <option key={item.offer_item_id} value={item.offer_item_id as number}>{item.label}</option>
                    ))}
                  </select>
                )
              ) : null}
              {surProduit ? (
                <>
                  <input className="vouchers__input vouchers__input--n" inputMode="numeric" value={form.max_qty} placeholder={form.mechanic === 'product' ? '1' : '—'} onChange={(e) => set({ max_qty: e.target.value })} />
                  <span className="vouchers__hint">pièce(s) au plus</span>
                </>
              ) : null}
            </div>
          </>
        ) : null}

        <span className="vouchers__label">Commande minimum</span>
        <div className="vouchers__row">
          <input className="vouchers__input vouchers__input--n" inputMode="decimal" value={form.min_order} placeholder="—" onChange={(e) => set({ min_order: e.target.value })} />
          <span className="vouchers__hint">€ TTC — vide : sans minimum</span>
        </div>

        {editing === null ? (
          <>
            <span className="vouchers__label">Code</span>
            <div className="vouchers__row">
              <input className="vouchers__input vouchers__input--code" value={code} onChange={(e) => set({ code: e.target.value.toUpperCase(), codeTouched: true })} />
              <span className="vouchers__hint">proposé d’après le nom de la campagne · vide : code généré par le webshop</span>
            </div>
          </>
        ) : null}

        <span className="vouchers__label">Valable</span>
        <div className="vouchers__row">
          <input type="date" className="vouchers__input" value={form.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
          <span aria-hidden="true">→</span>
          <input type="date" className="vouchers__input" value={form.ends_on} onChange={(e) => set({ ends_on: e.target.value })} />
          <span className="vouchers__hint">par défaut, les dates de la campagne</span>
        </div>

        <span className="vouchers__label">Utilisations</span>
        <div className="vouchers__row">
          <input className="vouchers__input vouchers__input--n" inputMode="numeric" value={form.usage_total} placeholder="—" onChange={(e) => set({ usage_total: e.target.value })} />
          <span className="vouchers__hint">au total</span>
          <input className="vouchers__input vouchers__input--n" inputMode="numeric" value={form.per_customer} placeholder="—" onChange={(e) => set({ per_customer: e.target.value })} />
          <span className="vouchers__hint">par client — le client devra alors être connecté</span>
        </div>

        {editing === null ? (
          <>
            <span className="vouchers__label">Pour qui</span>
            <div className="vouchers__row">
              <button type="button" className={`choice-pill${form.target_kind === 'NETWORK' ? ' is-on' : ''}`} onClick={() => set({ target_kind: 'NETWORK', target_id: null, target_label: '' })}>
                Tout le monde
              </button>
              {isBrand ? (
                <button type="button" className={`choice-pill${form.target_kind === 'OFFICE' ? ' is-on' : ''}`} onClick={() => set({ target_kind: 'OFFICE' })}>
                  Un bureau
                </button>
              ) : null}
              {form.target_kind === 'OFFICE' ? (
                form.target_id !== null ? (
                  <span>
                    <strong>{form.target_label}</strong>{' '}
                    <button type="button" className="linklike" onClick={() => set({ target_id: null, target_label: '' })}>changer</button>
                  </span>
                ) : (
                  <>
                    <input className="vouchers__input" placeholder="Nom ou ville du bureau" value={officeQuery} onChange={(e) => setOfficeQuery(e.target.value)} />
                    {(offices.data ?? []).slice(0, 8).map((office) => (
                      <button key={office.id} type="button" className="choice-pill" onClick={() => set({ target_id: office.id, target_label: office.name })}>
                        {office.name}{office.city ? ` · ${office.city}` : ''}
                      </button>
                    ))}
                  </>
                )
              ) : null}
            </div>
          </>
        ) : null}

        <span className="vouchers__label">Canal</span>
        <div className="vouchers__row">
          <label className="vouchers__check"><input type="checkbox" checked disabled /> Webshop</label>
          <label className="vouchers__check vouchers__check--off"><input type="checkbox" disabled /> Caisse</label>
          <span className="vouchers__hint">la caisse n’applique pas ces bons</span>
        </div>
      </div>

      <div className="vouchers__info">
        <p>
          <strong>Lien prêt à partager</strong> (code déjà saisi au panier) :{' '}
          <code>{lien(editing?.code ?? (code || 'CODE'))}</code>
        </p>
        <p><strong>Cumul</strong> : le bon s’ajoute aux promotions de l’étape « Prix » — la règle actuelle du webshop.</p>
      </div>
      {failure !== null ? <p className="error">{failure}</p> : null}
      <div className="vouchers__actions-bar">
        <button type="button" className="btn" onClick={onClose} disabled={saving}>Annuler</button>
        <button type="button" className="btn btn--primary" onClick={enregistrer} disabled={saving}>
          {saving ? 'Envoi au webshop…' : editing ? 'Enregistrer' : 'Ajouter à la campagne'}
        </button>
      </div>
    </div>
  )
}

function AttachPanel({ campaignId, onClose, onAttached }: { campaignId: number; onClose: () => void; onAttached: () => void }) {
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const list = useAsync(() => api.webshopVouchers(query), [query, version])

  async function rattacher(v: AttachableVoucher) {
    setBusy(v.code)
    setFailure(null)
    try {
      await api.attachCampaignVoucher(campaignId, v.code)
      setVersion((n) => n + 1)
      onAttached()
    } catch (cause: unknown) {
      setFailure(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  const rows = list.data?.vouchers ?? []

  return (
    <div className="vouchers__form">
      <h3>Rattacher un bon existant</h3>
      <p className="vouchers__hint">
        Les bons déjà émis, lus dans le webshop. Un bon ne suit qu’une campagne : ses commandes lui reviennent sans
        double compte.
      </p>
      <div className="vouchers__row">
        <input className="vouchers__input vouchers__input--search" placeholder="Code, motif ou boutique" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="vouchers__hint">{list.loading ? 'Lecture…' : `${rows.length} bon${rows.length > 1 ? 's' : ''}`}</span>
      </div>
      {list.error !== null ? <p className="error">{list.error}</p> : null}
      {list.data?.message ? <p className="tag-warn vouchers__notice">{list.data.message}</p> : null}
      {failure !== null ? <p className="error">{failure}</p> : null}
      {rows.length > 0 ? (
        <div className="table-card">
          <div className="table-scroll">
            <table className="vouchers">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Remise</th>
                  <th>Émetteur</th>
                  <th>Pour qui</th>
                  <th>Validité</th>
                  <th>Campagne</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.code}>
                    <td><span className="vouchers__code">{v.code}</span>{v.active === false ? <span className="sub">suspendu</span> : null}</td>
                    <td>{remiseOf(v)}</td>
                    <td>{v.issuer}</td>
                    <td>{cibleOf(v)}</td>
                    <td>{validiteOf(v)}</td>
                    <td>
                      {v.campaign_id === null ? (
                        <span className="vouchers__origin vouchers__origin--none">aucune</span>
                      ) : (
                        <span className="vouchers__origin vouchers__origin--none">{v.campaign_name ?? `campagne #${v.campaign_id}`}</span>
                      )}
                    </td>
                    <td>
                      {v.campaign_id === campaignId ? (
                        <span className="vouchers__hint">déjà ici</span>
                      ) : v.campaign_id !== null ? (
                        <span className="vouchers__hint">déjà suivi</span>
                      ) : (
                        <button type="button" className="btn btn--sm btn--primary" disabled={busy === v.code} onClick={() => rattacher(v)}>
                          Rattacher
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="vouchers__actions-bar">
        <button type="button" className="btn" onClick={onClose}>Fermer</button>
      </div>
    </div>
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
