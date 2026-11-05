import { useEffect, useState } from 'react'
import { module as api } from '../../lib/api'
import type { ErpVoucher, ErpVoucherInput, ErpVouchers as ErpVouchersData } from '../../lib/api/module'
import { describeError } from '../../state/auth'
import { formatDate } from '../../lib/useAsync'

/**
 * Les bons de la campagne, dans TFBuddy (05/11/2026) : ils valent en caisse et au webshop.
 *
 * Un bon part d'une ligne de l'étape Prix (pourcentage, prix barré, offre liée) : le module crée la promotion
 * dans l'ERP en mode « bon seulement », puis la campagne de bons — un code pour tous, ou des codes uniques —
 * et les rattache. Il reste en brouillon tant qu'on ne l'active pas : rien ne passe en caisse avant.
 */

const STATUS: Record<string, [string, string]> = {
  ACTIVE: ['Actif · en caisse et au webshop', 'ok'],
  DRAFT: ['Brouillon · pas encore en caisse', 'no'],
  INACTIVE: ['Suspendu', 'wa'],
}

interface Form {
  offerItemId: number | null
  codeType: 'SHARED' | 'UNIQUE'
  sharedCode: string
  usageLimitTotal: string
  count: string
  perShop: boolean
  prefix: string
  validFrom: string
  validTo: string
  usageLimitPerCustomer: string
  activate: boolean
}

const blank = (validFrom: string, validTo: string): Form => ({
  offerItemId: null, codeType: 'SHARED', sharedCode: '', usageLimitTotal: '', count: '100', perShop: false, prefix: '',
  validFrom, validTo, usageLimitPerCustomer: '', activate: false,
})

export default function ErpVouchers({ campaignId, startsOn, endsOn }: { campaignId: number; startsOn: string; endsOn: string }) {
  const [data, setData] = useState<ErpVouchersData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getErpVouchers(campaignId).then((d) => { if (!cancelled) setData(d) }).catch((e: unknown) => { if (!cancelled) setError(describeError(e)) })
    return () => { cancelled = true }
  }, [campaignId])

  const set = (change: Partial<Form>) => setForm((f) => (f ? { ...f, ...change } : f))

  async function create() {
    if (!form || form.offerItemId === null) return
    if (form.activate && !window.confirm('Activer le bon maintenant ? Il vaudra aussitôt en caisse et au webshop, dans les boutiques de la campagne.')) return
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v))
    const input: ErpVoucherInput = {
      offerItemId: form.offerItemId, codeType: form.codeType, activate: form.activate,
      validFrom: form.validFrom || undefined, validTo: form.validTo || undefined, usageLimitPerCustomer: n(form.usageLimitPerCustomer),
      ...(form.codeType === 'SHARED'
        ? { sharedCode: form.sharedCode.trim() || undefined, usageLimitTotal: n(form.usageLimitTotal) }
        : { count: Number(form.count), perShop: form.perShop, prefix: form.prefix.trim() || undefined }),
    }
    setBusy(true); setError(null); setNotice(null)
    try {
      const v = await api.createErpVoucher(campaignId, input)
      setData((d) => (d ? { ...d, vouchers: [v, ...d.vouchers] } : d))
      setForm(null)
      setNotice(v.warning ?? (v.status === 'ACTIVE' ? 'Bon créé et activé dans TFBuddy.' : 'Bon créé dans TFBuddy, en brouillon : activez-le quand la campagne démarre.'))
    } catch (e: unknown) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function status(v: ErpVoucher, next: 'ACTIVE' | 'INACTIVE') {
    if (next === 'ACTIVE' && !window.confirm('Activer ce bon ? Il vaudra aussitôt en caisse et au webshop.')) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await api.setErpVoucherStatus(campaignId, v.id, next)
      setData((d) => (d ? { ...d, vouchers: d.vouchers.map((x) => (x.id === v.id ? r : x)) } : d))
      setNotice(next === 'ACTIVE' ? 'Bon activé.' : 'Bon suspendu : il ne vaut plus, ni en caisse ni au webshop.')
    } catch (e: unknown) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  function copyCodes(v: ErpVoucher) {
    const text = v.codeType === 'SHARED' ? (v.sharedCode ?? '') : v.codes.map((c) => c.code).join('\n')
    try { void navigator.clipboard.writeText(text); setNotice(v.codeType === 'SHARED' ? 'Code copié.' : `${v.codes.length} codes copiés (un par ligne).`) } catch { setNotice('Copie impossible : sélectionnez le texte à la main.') }
  }

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="vouchers__hint">Lecture des bons dans TFBuddy…</p>

  const eligible = data.lines.filter((l) => l.eligible)
  return (
    <section className="erpv">
      <h3 className="section-label">
        Bons de la campagne
        <span className="section-label__aside">dans TFBuddy · valables en caisse et au webshop</span>
      </h3>
      {!data.configured ? <p className="tag-warn vouchers__notice">{data.message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="erpv__notice">{notice}</p> : null}

      {data.vouchers.length === 0 ? <p className="vouchers__hint">Aucun bon pour cette campagne.</p> : (
        <div className="table-card"><div className="table-scroll">
          <table className="vouchers erpv__table">
            <thead><tr><th>Bon</th><th>Codes</th><th>État</th><th className="num">Utilisations</th><th>Jusqu’au</th><th /></tr></thead>
            <tbody>
              {data.vouchers.map((v) => {
                const [label, tone] = STATUS[v.status ?? ''] ?? ['État inconnu', 'no']
                return (
                  <tr key={v.id}>
                    <td><b>{v.name}</b><span className="sub">TFBuddy n° {v.erpVoucherCampaignId}{v.erpPromotionId ? ` · promotion n° ${v.erpPromotionId}` : ''}</span></td>
                    <td>
                      {v.codeType === 'SHARED'
                        ? <span className="vouchers__code">{v.sharedCode}</span>
                        : <button type="button" className="linklike" onClick={() => setOpen(open === v.id ? null : v.id)}>{v.codesTotal ?? v.codesRequested} codes uniques</button>}
                      {v.readError ? <span className="sub error">{v.readError}</span> : null}
                      {v.complete === false && v.missing.length > 0 ? <span className="sub">incomplet : {v.missing.join(', ')}</span> : null}
                    </td>
                    <td><span className={`erpv__st erpv__st--${tone}`}>{label}</span></td>
                    <td className="num">{v.redemptions ?? '—'}</td>
                    <td>{v.validTo ? formatDate(v.validTo) : '—'}</td>
                    <td>
                      {data.canEdit ? (
                        <span className="vouchers__actions">
                          {v.status !== 'ACTIVE' ? <button type="button" className="linklike" disabled={busy} onClick={() => status(v, 'ACTIVE')}>Activer</button> : null}
                          {v.status === 'ACTIVE' ? <button type="button" className="linklike" disabled={busy} onClick={() => status(v, 'INACTIVE')}>Suspendre</button> : null}
                          <button type="button" className="linklike" onClick={() => copyCodes(v)}>Copier</button>
                        </span>
                      ) : <button type="button" className="linklike" onClick={() => copyCodes(v)}>Copier</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div></div>
      )}
      {open !== null ? (() => {
        const v = data.vouchers.find((x) => x.id === open)
        if (!v) return null
        return (
          <div className="erpv__codes">
            {v.codes.slice(0, 120).map((c) => <span key={c.code} className={c.status !== 'ACTIVE' ? 'is-off' : c.usages > 0 ? 'is-used' : ''}>{c.code}</span>)}
            {v.codes.length > 120 ? <span className="muted">… et {v.codes.length - 120} autres (« Copier » les prend tous)</span> : null}
          </div>
        )
      })() : null}

      {data.canEdit && data.configured && form === null ? (
        <div className="vouchers__bar">
          <button type="button" className="btn" disabled={eligible.length === 0} onClick={() => setForm(blank(startsOn, endsOn))}>+ Créer un bon dans TFBuddy</button>
          {eligible.length === 0 ? <span className="vouchers__hint">Un bon part d’une promotion de l’étape Prix (pourcentage, prix barré ou offre liée sur un produit de l’ERP).</span> : null}
        </div>
      ) : null}

      {form !== null ? (
        <div className="erpv__form">
          <h4>Nouveau bon</h4>
          <span className="erpv__k">La remise</span>
          <div className="erpv__lines">
            {data.lines.map((l) => (
              <button key={l.offerItemId} type="button" disabled={!l.eligible}
                className={`erpv__line${form.offerItemId === l.offerItemId ? ' is-on' : ''}`} onClick={() => set({ offerItemId: l.offerItemId })}>
                <b>{l.label}</b><span>{l.mechanicLabel} · {l.summary}</span>
                {!l.eligible ? <small>{l.reason}</small> : null}
              </button>
            ))}
          </div>
          <span className="erpv__k">Les codes</span>
          <div className="erpv__row">
            <button type="button" className={`choice-pill${form.codeType === 'SHARED' ? ' is-on' : ''}`} onClick={() => set({ codeType: 'SHARED' })}>Un code pour tous</button>
            <button type="button" className={`choice-pill${form.codeType === 'UNIQUE' ? ' is-on' : ''}`} onClick={() => set({ codeType: 'UNIQUE' })}>Des codes uniques (un par carte)</button>
          </div>
          {form.codeType === 'SHARED' ? (
            <div className="erpv__row">
              <label className="field">Code<input value={form.sharedCode} maxLength={20} placeholder="créé si vide" onChange={(e) => set({ sharedCode: e.target.value.toUpperCase() })} /></label>
              <label className="field">Utilisations au plus<input inputMode="numeric" value={form.usageLimitTotal} placeholder="sans limite" onChange={(e) => set({ usageLimitTotal: e.target.value.replace(/[^\d]/g, '') })} /></label>
            </div>
          ) : (
            <div className="erpv__row">
              <label className="field">Nombre de codes<input inputMode="numeric" value={form.count} onChange={(e) => set({ count: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} /></label>
              <label className="erpv__check"><input type="checkbox" checked={form.perShop} onChange={(e) => set({ perShop: e.target.checked })} /> autant par boutique (préfixe de la boutique)</label>
              {!form.perShop ? <label className="field">Préfixe<input value={form.prefix} maxLength={8} placeholder="NOEL-" onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} /></label> : null}
            </div>
          )}
          <span className="erpv__k">Valable</span>
          <div className="erpv__row">
            <label className="field">Du<input type="date" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} /></label>
            <label className="field">Au<input type="date" value={form.validTo} onChange={(e) => set({ validTo: e.target.value })} /></label>
            <label className="field">Par client, au plus<input inputMode="numeric" value={form.usageLimitPerCustomer} placeholder="sans limite" onChange={(e) => set({ usageLimitPerCustomer: e.target.value.replace(/[^\d]/g, '') })} /></label>
          </div>
          <label className="erpv__check"><input type="checkbox" checked={form.activate} onChange={(e) => set({ activate: e.target.checked })} /> L’activer tout de suite (sinon il reste en brouillon, rien ne passe en caisse)</label>
          <div className="erpv__actions">
            <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>Annuler</button>
            <button type="button" className="btn btn--primary" disabled={busy || form.offerItemId === null || (form.codeType === 'UNIQUE' && !(Number(form.count) > 0))} onClick={create}>
              {busy ? 'Écriture dans TFBuddy…' : 'Créer dans TFBuddy'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
