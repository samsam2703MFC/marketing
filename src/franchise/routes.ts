/**
 * Les adresses de l'espace boutique (/marketing/franchise/<page>) : une page = un chemin, ses
 * paramètres dans la requête (`?post=…`, `?vue=semaine&date=…`). Les anciennes adresses de l'espace
 * franchisé (/social_franchisee/publier, …/Calendrier.dc.html) y renvoient avec le même nom de page.
 */
export type PageEspace = 'cal' | 'pub' | 'com' | 'msg' | 'google' | 'camp' | 'ig' | 'suivi'

export const CHEMINS: Record<Exclude<PageEspace, 'suivi'>, string> = {
  cal: 'calendrier',
  pub: 'publier',
  com: 'commentaires',
  msg: 'messages',
  google: 'avis-google',
  camp: 'operations',
  ig: 'instagram',
}

/** La racine de l'espace, sous l'adresse de l'application (`/marketing/franchise/`). */
export const RACINE_ESPACE = `${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}franchise/`

/** L'adresse d'une page de l'espace. « Suivi » est un onglet du calendrier (`?vue=suivi`). */
export function adresseEspace(page: PageEspace, query = ''): string {
  if (page === 'suivi') return adresseEspace('cal', ['vue=suivi', query].filter(Boolean).join('&'))
  return `${RACINE_ESPACE}${CHEMINS[page]}${query ? `?${query}` : ''}`
}

/** Les anciens noms de fichier de l'espace (liens de l'ERP, favoris) : la même page. */
const ANCIENS: Record<string, Exclude<PageEspace, 'suivi'>> = {
  'Calendrier.dc.html': 'cal',
  'Suivi.dc.html': 'cal',
  'Promotions.dc.html': 'cal',
  'Publier.dc.html': 'pub',
  'Campagnes.dc.html': 'camp',
  'Instagram.dc.html': 'ig',
  'Commentaires.dc.html': 'com',
  'Messages.dc.html': 'msg',
  'Google.dc.html': 'google',
}

/** La page affichée, lue dans le chemin (calendrier par défaut). */
export function pageCourante(): Exclude<PageEspace, 'suivi'> {
  const seg = decodeURIComponent(window.location.pathname.replace(/\/+$/, '').split('/').pop() ?? '')
  const k = (Object.keys(CHEMINS) as (keyof typeof CHEMINS)[]).find((p) => CHEMINS[p] === seg)
  return k ?? ANCIENS[seg] ?? 'cal'
}

/**
 * Une ancienne adresse (« …/Publier.dc.html », « …/Suivi.dc.html ») est réécrite sous son nom propre, sans
 * recharger : `?vue=suivi` pour le suivi, `?vue=liste` pour les promotions, les autres paramètres gardés.
 */
export function normaliserAdresse() {
  const seg = decodeURIComponent(window.location.pathname.split('/').pop() ?? '')
  const page = ANCIENS[seg]
  if (!page) return
  const q = new URLSearchParams(window.location.search)
  if (seg === 'Suivi.dc.html' && !q.has('vue')) q.set('vue', 'suivi')
  if (seg === 'Promotions.dc.html' && !q.has('vue')) q.set('vue', 'liste')
  window.history.replaceState(null, '', adresseEspace(page, q.toString()))
}
