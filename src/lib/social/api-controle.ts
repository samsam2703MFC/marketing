import { socialApi } from './store'

/**
 * Appels de l'écran « Contrôle des posts » (repris de social/public/social-data.js) : les publications des Pages
 * et comptes Instagram entre deux dates, lues en direct chez Meta par le serveur du module (GET /meta/calendriers,
 * api/social/src/calendriers.php). Rien n'est gardé en base.
 */
export interface PostCalendrier {
  id: string
  status?: string
  /** Publication de la Page de la marque (écartée du contrôle des boutiques). */
  marque?: boolean
  shops?: string[]
  title: string
  img?: string | null
  date: string
  time?: string
  channel: string
  text?: string
  permalink?: string | null
  accountName?: string
}

export interface CompteCalendrier {
  type: string
  shop?: string
  picture?: string | null
}

export interface Calendriers {
  posts?: PostCalendrier[]
  comptes?: CompteCalendrier[]
  erreurs?: unknown[]
}

export const lireCalendriers = (du: string, au: string) =>
  socialApi<Calendriers>('GET', `/meta/calendriers?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}`)

/** Une pastille de profil sans photo : les initiales sur un rond aux couleurs de la marque (comme SA.avatar). */
export function avatarSocial(nom: string, reseau?: 'facebook' | 'instagram'): string {
  const ini =
    String(nom || '?')
      .replace(/^l[’']atelier\s*by\s*[-–·]?\s*/i, '')
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || 'AB'
  const fond = reseau === 'instagram' ? '#C13584' : '#8D1D2C'
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${fond}"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`,
    )
  )
}
