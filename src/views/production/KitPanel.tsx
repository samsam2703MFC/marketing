import { useEffect, useState } from 'react'
import { module as api } from '../../lib/api'
import type { Kit, KitVersions, Production } from '../../lib/api/module'
import { describeError } from '../../state/auth'
import KitReader from './KitReader'
import { shortDate } from './ProductionPanel'

/**
 * L'envoi du kit des franchisés : une version figée, un lien personnel par
 * boutique (lecture sur la tablette, PDF par l'impression), et qui l'a lu.
 */

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${shortDate(iso.slice(0, 10))} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface Props {
  campaignId: number
  brandAdmin: boolean
  production: Production
}

export default function KitPanel({ campaignId, brandAdmin, production }: Props) {
  const [kit, setKit] = useState<KitVersions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<Kit | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getKitVersions(campaignId)
      .then((data) => { if (!cancelled) setKit(data) })
      .catch((cause: unknown) => { if (!cancelled) setError(describeError(cause)) })
    return () => { cancelled = true }
  }, [campaignId, production.validated])

  async function send() {
    setBusy(true)
    setError(null)
    setNotice(null)
    let posts: Awaited<ReturnType<typeof api.campaignPostsForKit>> = []
    let sansPosts = false
    try {
      posts = await api.campaignPostsForKit(campaignId)
    } catch {
      sansPosts = true
    }
    try {
      const sent = await api.sendKit(campaignId, posts)
      setKit(sent)
      setNotice(sansPosts
        ? `Version ${sent.createdVersion} envoyée, sans le calendrier des posts : Social ne répond pas. Renvoyez une version quand il répondra.`
        : `Version ${sent.createdVersion} envoyée : ${posts.length} post${posts.length > 1 ? 's' : ''} de Social repris dans le calendrier.`)
    } catch (cause: unknown) {
      setError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function open(shopId: number) {
    setError(null)
    try {
      const [base, posts] = await Promise.all([api.getKitPreview(campaignId, shopId), api.campaignPostsForKit(campaignId).catch(() => [])])
      const erp = base.shop.erpShopId
      setPreview({ ...base, posts: posts.filter((p) => p.shops.length === 0 || (erp !== null && p.shops.includes(erp))) })
    } catch (cause: unknown) {
      setError(describeError(cause))
    }
  }

  async function copy(shopId: number, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(shopId)
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      window.prompt('Lien du kit', url)
    }
  }

  const ready = kit?.kitReady ?? production.kitReady
  const read = (kit?.shops ?? []).filter((s) => s.readAt).length

  return (
    <section className="card wizard-card">
      <div className="ps-head">
        <div>
          <h3>Kit franchisé</h3>
          <p>
            Un kit par boutique, monté à partir des sections validées : ce que la boutique affiche, porte, dit et publie, avec ses dates.
            {kit?.currentVersion ? ` Version ${kit.currentVersion} du ${shortDate(kit.versions[0]?.createdAt.slice(0, 10) ?? null)} · lu par ${read} boutique${read > 1 ? 's' : ''} sur ${kit.shops.length}.` : ''}
          </p>
        </div>
        {brandAdmin ? (
          <div className="ps-head__side">
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || !ready} onClick={send}>
              {busy ? 'Envoi…' : kit?.currentVersion ? `Envoyer la version ${kit.currentVersion + 1}` : `Envoyer aux ${kit?.shops.length ?? production.shops.length} boutiques`}
            </button>
          </div>
        ) : null}
      </div>
      {!ready ? <p className="why">Le kit s’envoie quand les {production.total} sections sont validées : il en reste {production.total - production.validated}.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ps-notice">{notice}</p> : null}

      <table className="ps-table kit-send">
        <thead><tr><th>Boutique</th><th>Lecture</th><th>Lien</th><th /></tr></thead>
        <tbody>
          {(kit?.shops ?? production.shops.map((s) => ({ shopId: s.shopId, shopName: s.shopName, url: null, expiresOn: null, sent: false, readAt: null }))).map((shop) => (
            <tr key={shop.shopId}>
              <td><b>{shop.shopName}</b></td>
              <td>
                {shop.readAt ? <span className="ps-st ps-st--ok">Lu le {when(shop.readAt)}</span>
                  : shop.sent ? <span className="ps-st ps-st--wa">Envoyé, pas encore ouvert</span>
                    : <span className="ps-st ps-st--no">Pas encore envoyé</span>}
              </td>
              <td>
                {shop.url ? (
                  <span className="kit-link">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy(shop.shopId, shop.url as string)}>{copied === shop.shopId ? 'Copié' : 'Copier le lien'}</button>
                    <a className="btn btn--ghost btn--sm" href={`mailto:?subject=${encodeURIComponent('Kit campagne')}&body=${encodeURIComponent(`Le kit de la campagne pour ${shop.shopName} : ${shop.url}`)}`}>E-mail</a>
                    <a className="btn btn--ghost btn--sm" href={shop.url} target="_blank" rel="noreferrer">Ouvrir</a>
                  </span>
                ) : <span className="muted">—</span>}
                {shop.expiresOn ? <small className="muted kit-exp">valable jusqu’au {shortDate(shop.expiresOn)}</small> : null}
              </td>
              <td style={{ textAlign: 'right' }}>
                <button type="button" className="btn btn--sm" onClick={() => open(shop.shopId)}>Aperçu</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="kit-note">
        <b>Un envoi = un lien personnel par boutique</b>, en lecture seule : il s’ouvre sur la tablette de la boutique, et « Télécharger le PDF »
        l’imprime en A4. On voit qui l’a lu. Une section modifiée après l’envoi : renvoyez une version ; le lien ne change pas, et la lecture repart de zéro.
      </p>

      {preview ? (
        <div className="kit-modal" role="dialog" aria-label="Aperçu du kit">
          <div className="kit-modal__bar">
            <span>Aperçu — tel que la boutique le recevrait maintenant</span>
            <button type="button" className="btn btn--sm" onClick={() => setPreview(null)}>Fermer</button>
          </div>
          <KitReader kit={preview} />
        </div>
      ) : null}
    </section>
  )
}
