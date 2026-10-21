import { useEffect, useRef, useState } from 'react'

interface SocialViewProps {
  /** Fichier de l'écran du module Social & Ads à ouvrir (ex. `SA Calendrier.dc.html`). */
  file: string
  /** Paramètres de l'écran (ex. `tab=api&section=cles` pour les Paramètres). */
  query?: string
  /** `franchise` : une page de l'espace franchisé (/social_franchisee) ; sinon un écran du réseau (/social). */
  space?: 'franchise'
  /**
   * Campagne à présélectionner comme « Opération liée » d'un nouveau post. Le
   * module Social lit les campagnes de ce module par l'API : l'opération `bo-19`
   * est la campagne 19 d'ici.
   */
  campaignId: number | null
  /** Appelé quand on change d'écran à l'intérieur du cadre (clé de page du module Social). */
  onPage: (key: string) => void
}

/**
 * Un écran du module Social & Ads, affiché dans un cadre.
 *
 * Les écrans ne sont pas recopiés : ils vivent dans le module Social, servi sous
 * /marketing/social, qui détient les
 * Pages, le token Meta, la médiathèque, le calendrier et les publicités. Le
 * paramètre `embed=1` leur retire leur propre menu, et chaque lien qu'on y suit
 * le garde — on reste dans le cadre. L'écran ouvert est annoncé par message,
 * pour que le menu de gauche suive sans recharger le cadre.
 */
export default function SocialView({ file, query, space, campaignId, onPage }: SocialViewProps) {
  // Le module Social est servi sous /marketing (même serveur) : ses écrans à /marketing/social,
  // son espace boutique à /marketing/franchise. Les anciennes adresses (/social, /social_franchisee)
  // restent servies pour les liens de l'ERP, les QR codes imprimés et les notifications de Meta.
  const base = (space === 'franchise' ? import.meta.env.VITE_SOCIAL_FRANCHISEE_BASE || '/marketing/franchise/' : import.meta.env.VITE_SOCIAL_BASE || '/marketing/social/').replace(/\/?$/, '/')
  // La boutique de l'adresse (`/marketingc/?shop=2`) passe à l'espace boutique : sans elle, il ouvre la
  // première boutique de la session. L'espace vérifie lui-même qu'elle est ouverte à ce visiteur.
  const shop = space === 'franchise' ? new URLSearchParams(window.location.search).get('shop')?.trim() ?? '' : ''
  const params = [query, campaignId !== null ? `op=${campaignId}` : '', /^[\w-]{1,32}$/.test(shop) ? `shop=${shop}` : ''].filter(Boolean).join('&')
  // L'adresse du cadre est fixée à l'ouverture : la suite de la navigation
  // appartient au cadre, et la recalculer le rechargerait.
  const [src] = useState(() => `${base}${encodeURIComponent(file)}?embed=1${params ? `&${params}` : ''}`)
  const [initial] = useState(file)
  const [current, setCurrent] = useState(file)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    function listen(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: string; page?: string } | null
      if (data?.type !== 'social:page' || typeof data.page !== 'string') return
      const path = frame.current?.contentWindow?.location.pathname ?? ''
      setCurrent(decodeURIComponent(path.split('/').pop() || initial))
      onPage(data.page)
    }

    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [initial, onPage])

  // Le lien « ouvrir » suit l'écran affiché ; ses paramètres (onglet, présélection) ne valent que pour l'écran d'origine.
  const full = `${base}${encodeURIComponent(current)}${params && current === initial ? `?${params}` : ''}`

  return (
    <div className="social-frame">
      <div className="social-frame__bar">
        <span className="muted">
          {space === 'franchise' ? 'Espace boutique du module Social & Ads' : 'Écran du module Social & Ads'}
          {campaignId !== null ? ' — campagne présélectionnée comme opération liée' : ''}
        </span>
        <a href={full} target="_blank" rel="noopener">
          Ouvrir dans le module Social &amp; Ads ↗
        </a>
      </div>
      <iframe ref={frame} className="social-frame__page" title="Module Social & Ads" src={src} />
    </div>
  )
}
