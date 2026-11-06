import type { Boutique, EtatSocial, Objet, Serveur } from './store'
import { parId } from './store'
import { CONN } from './refs'

/**
 * Lectures communes aux écrans Calendrier et Publicités (reprises de social/public/social-data.js,
 * mêmes règles) : langues d'une boutique, variables d'un texte ({ville}, {prix}, {webshop}…),
 * adresse du webshop, pastille de profil, connexions à rétablir.
 */

/** Les langues d'une boutique (français à défaut). */
export function languesDe(etat: EtatSocial, boutique: string | Boutique | undefined | null): string[] {
  const s = typeof boutique === 'string' ? parId(etat.shops, boutique) : boutique
  return s?.langs?.length ? s.langs : ['fr']
}

interface Produit {
  name?: string
  nameNl?: string
  price?: number | string
  apiId?: number | string
  kind?: string
  categoryId?: number | string
}

/** Le plan du webshop : catégorie → groupe, produit → catégorie (servi avec l'état). */
function planDe(serveur: Serveur) {
  const plan = { cats: {} as Record<string, number>, prods: {} as Record<string, number> }
  const nav = (serveur.webshopPlan ?? null) as {
    categories?: { id?: number; groupe?: number }[]
    produits?: { id?: number; cat?: number }[]
    cats?: Record<string, number>
    prods?: Record<string, number>
  } | null
  if (!nav) return plan
  for (const c of nav.categories ?? []) if (c?.id) plan.cats[c.id] = Math.max(Number(c.groupe) || 0, plan.cats[c.id] || 0)
  for (const p of nav.produits ?? []) if (p?.id && p.cat) plan.prods[p.id] = p.cat
  for (const [k, v] of Object.entries(nav.cats ?? {})) plan.cats[k] = Math.max(Number(v) || 0, plan.cats[k] || 0)
  for (const [k, v] of Object.entries(nav.prods ?? {})) if (v) plan.prods[k] = Number(v)
  return plan
}

/**
 * Le webshop d'une boutique, ou une page de ce webshop (comme le serveur, src/publish.php) : catégorie
 * ?category=group:G · sous-catégorie &sub=category:C · produit &product=ID&open=product.
 */
export function adresseWebshop(
  etat: EtatSocial,
  serveur: Serveur,
  shopId: string,
  produit: Produit | null | undefined,
  categorie = 0,
  groupe = 0,
  fiche = true,
): string {
  const base = String(serveur.webshopUrl || 'https://webshop.atelierby.be/')
  const sh = shopId ? parId(etat.shops, shopId) : null
  const plan = planDe(serveur)
  const q: [string, string][] = []
  if (shopId && !sh?.test && /^\d+$/.test(shopId)) q.push(['shop', shopId])
  const pid = produit?.apiId && produit.kind !== 'gamme' ? Number(produit.apiId) : 0
  let cat = Number(categorie) || 0
  let grp = Number(groupe) || 0
  if (pid && !cat) cat = Number(produit?.categoryId) || plan.prods[pid] || 0
  if (cat) {
    grp = grp || plan.cats[cat] || 0
    if (grp) q.push(['category', `group:${grp}`], ['sub', `category:${cat}`])
    else q.push(['category', `category:${cat}`])
  } else if (grp) q.push(['category', `group:${grp}`])
  if (pid) {
    q.push(['product', String(pid)])
    if (fiche) q.push(['open', 'product'])
  }
  return q.length ? `${base}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%3A/g, ':')}`).join('&')}` : base
}

/** Sans horaires (magasin test), la phrase qui cite {horaires} disparaît (comme le serveur). */
const sansHoraires = (t: string) =>
  t.replace(/[ \t]*[^.!?\n]*\{horaires\}[^.!?\n]*[.!?]?/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(\n|$)/g, '$1')

/** Un texte de post avec ses variables remplies pour une boutique (SA.fill). */
export function remplir(
  etat: EtatSocial,
  serveur: Serveur,
  texte: string,
  boutique: string | Boutique | undefined | null,
  produit?: Produit | null,
  langue?: string,
): string {
  const s = typeof boutique === 'string' ? parId(etat.shops, boutique) : boutique
  const L = langue || (s ? languesDe(etat, s)[0] : 'fr')
  const h = s ? (L === 'nl' && s.hoursNl ? s.hoursNl : s.hours) : '{horaires}'
  const nom = (p: Produit) => (L === 'nl' && p.nameNl ? p.nameNl : p.name)
  const id = s ? s.id : ''
  const web = (p: Produit | null | undefined, c = 0, g = 0, f = true) => adresseWebshop(etat, serveur, id, p, c, g, f)
  const t = s && !String(h || '').trim() ? sansHoraires(String(texte || '')) : String(texte || '')
  return t
    .replace(/\{horaires\}/g, s ? String(h ?? '') : '{horaires}')
    .replace(/\{produit_du_jour\}/g, produit?.name ? String(nom(produit)) : L === 'nl' ? 'Krokante brioche' : 'Brioche croustillante')
    .replace(/\{ville\}/g, s ? s.name : '{ville}')
    .replace(/\{adresse\}/g, s ? String(s.address ?? '') : '{adresse}')
    .replace(/\{prix\}/g, produit?.price ? String(produit.price) : '{prix}')
    .replace(/\{webshop_produit:liste\}/g, web(produit, 0, 0, false))
    .replace(/\{webshop_(produit|categorie|groupe):(\d+)(:liste)?\}/g, (_m, k: string, n: string, liste?: string) =>
      k === 'produit' ? web({ apiId: Number(n), kind: 'produit' }, 0, 0, !liste) : k === 'categorie' ? web(null, Number(n)) : web(null, 0, Number(n)),
    )
    .replace(/\{webshop_produit\}/g, web(produit))
    .replace(/\{webshop_categorie\}/g, web(null, Number(produit?.categoryId) || 0))
    .replace(/\{webshop\}/g, web(null))
    .replace(/\{hashtag_ville\}/g, s ? `#${String(s.name || '').replace(/[^\p{L}\p{N}]/gu, '')}` : '{hashtag_ville}')
}

/** Une pastille de profil sans photo : les initiales sur un rond aux couleurs de la marque. */
export function avatar(nom: string | null | undefined, reseau?: string): string {
  const ini =
    String(nom || '?')
      .replace(/^l[’']atelier\s*by\s*[-–·]?\s*/i, '')
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || 'AB'
  const bg = reseau === 'instagram' ? '#C13584' : '#8D1D2C'
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${bg}"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`,
  )}`
}

/** Ce qui est unique au réseau : Instagram (compte de la marque) et le compte publicitaire. */
export const uniquesReseau = (serveur: Serveur) => serveur.reseau ?? { instagram: !!serveur.instagramUnique, publicite: false }

export interface Alerte {
  shop: string
  what: string
  st: string
}

/** Les connexions à rétablir (SA.alerts). */
export function alertes(etat: EtatSocial, serveur: Serveur): Alerte[] {
  const out: Alerte[] = []
  const R = uniquesReseau(serveur)
  for (const s of etat.shops) {
    if (s.fb !== 'connected') out.push({ shop: s.name, what: 'Page Facebook', st: String(s.fb ?? 'none') })
    if (!R.instagram && s.igs !== 'connected') out.push({ shop: s.name, what: 'Instagram', st: String(s.igs ?? 'none') })
    if (!R.publicite && s.ads !== 'connected') out.push({ shop: s.name, what: 'Compte publicitaire', st: String(s.ads ?? 'none') })
  }
  const b = (serveur.brand ?? {}) as Record<string, unknown>
  if (serveur.brand) {
    if (R.instagram && b.igs !== 'connected') out.push({ shop: 'Réseau', what: 'Instagram', st: String(b.igs || 'none') })
    if (R.publicite && b.ads !== 'connected') out.push({ shop: 'Réseau', what: 'Compte publicitaire', st: String(b.ads || 'none') })
  }
  return out
}

export const libelleConnexion = (st: string) => (CONN[st] ?? CONN.none).label ?? ''

/** Les anciens écrans de Social et leur écran du Marketing. */
const ECRANS: Record<string, string> = {
  'SA Calendrier.dc.html': 'social-cal', 'SA Post.dc.html': 'social-post', 'SA Controle.dc.html': 'social-ctrl',
  'SA Parametres.dc.html': 'social-set-conn', 'SA Publicites.dc.html': 'social-ads', 'SA Leads.dc.html': 'social-leads',
  'SA Grille.dc.html': 'social-grid', 'SA Campagnes.dc.html': 'social-camp', 'SA Repost.dc.html': 'social-repost',
}

/** L'écran du Marketing qui a remplacé une page de l'ancien module Social (`?ecran=social-…`). */
export function pageSocial(fichier: string, q?: string): string {
  return `${window.location.pathname}?${[`ecran=${ECRANS[fichier] ?? 'social-cal'}`, q].filter(Boolean).join('&')}`
}

/** Un objet du serveur lu comme un dictionnaire (les champs non typés du store). */
export const champ = <T = unknown>(o: Objet | null | undefined, k: string): T | undefined => (o ? (o[k] as T) : undefined)
