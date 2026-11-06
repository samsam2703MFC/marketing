import { socialApi } from './store'
import { ROOTS } from '../api/module'
import { getTokens } from '../api/tokens'
import type { OffrePost } from './post-outils'

/**
 * Appels de l'écran « Créer un post » au module Social (mêmes routes que social/public/SA Post.dc.html et
 * social-data.js) : catalogue du webshop et ses offres, prix par boutique, vérification avant publication,
 * idées de posts et « ce qui marche », rédaction assistée et relecture, détourage, grille Instagram,
 * médiathèque commune du marketing, photo du webshop rapatriée.
 */

// ── Catalogue du webshop (TFBuddy) ──────────────────────────────────────────

export interface NavProduit {
  id: number
  name: string
  nameNl?: string
  cat?: number
  groupe?: number
  image?: string
  prix?: number | null
  formules?: boolean | number | unknown[]
  gammes?: number[]
}
export interface NavGroupe {
  id: number
  name: string
  image?: string
  n: number
  cats: number[]
}
export interface NavCategorie {
  id: number
  name: string
  image?: string
  n: number
  groupe?: number
}
export interface NavGamme {
  id: number
  name: string
  image?: string
  n: number
  du?: string
  au?: string
  webshop?: boolean | number
  description?: string
}
export interface NavCatalogue {
  prix: boolean
  shop?: string | null
  produits: NavProduit[]
  groupes: NavGroupe[]
  categories: NavCategorie[]
  gammes: NavGamme[]
  cats?: Record<string, number>
  prods?: Record<string, number>
}

/** Le catalogue du webshop, avec le prix de vente d'UNE boutique (`shop` ; vide : plusieurs boutiques, pas de prix). */
export const lireCatalogue = (shop: string) => socialApi<NavCatalogue>('GET', `/catalogue/nav?shop=${encodeURIComponent(shop || '')}`)

export interface PromoCatalogue {
  id: number | string
  type?: string
  nom: string
  court?: string
  libelle: string
  du?: string | null
  au?: string | null
  tous?: boolean
  shops?: string[]
  portee?: string
  ici?: boolean
}
export interface FormuleCatalogue {
  nom: string
  court?: string
  libelle: string
  prix?: number | null
  choix?: string[]
}
export interface OffresCatalogue {
  promotions: PromoCatalogue[]
  formules: FormuleCatalogue[]
  erreur?: string | null
}

/** Les promotions, bundles et formules liés à la sélection (q : {shop, produit | categorie | groupe | gamme}). */
export function lireOffres(q: Record<string, string | number | null | undefined>) {
  const qs = Object.keys(q)
    .filter((k) => q[k] != null && q[k] !== '')
    .map((k) => `${k}=${encodeURIComponent(String(q[k]))}`)
    .join('&')
  return socialApi<OffresCatalogue>('GET', `/catalogue/offres?${qs}`)
}

/** Le prix d'un produit dans chaque boutique visée (TFBuddy) : { prix: { shopId: prix | null } }. */
export const lirePrixBoutiques = (produit: string | number, shops: string[]) =>
  socialApi<{ prix?: Record<string, number | null> }>('GET', `/catalogue/prix?produit=${encodeURIComponent(String(produit))}&shops=${shops.map(encodeURIComponent).join(',')}`)

/** Avant de publier : le prix et la promotion du post sont-ils encore ceux de TFBuddy ? */
export const verifierCatalogue = (corps: { catalogue: unknown; offre: OffrePost | null; shops: string[]; date: string; prixParBoutique: Record<string, number> | null }) =>
  socialApi<{ ecarts?: string[] }>('POST', '/catalogue/verifier', corps)

// ── Idées de posts et ce qui marche ─────────────────────────────────────────

export interface Idee {
  id: string
  genre: string
  titre: string
  detail: string
  prefill?: {
    shops?: string[]
    date?: string
    time?: string
    campaign?: string
    catalogue?: { kind: string; id: number }
    offre?: OffrePost | null
    objectif?: string
  }
}
export const lireIdees = () => socialApi<{ idees?: Idee[]; muettes?: string[] }>('GET', '/idees')

export interface Reco {
  conseil?: { jour: string; creneau: string; indiceJour: number; indiceCreneau: number; date: string; heure: string } | null
  constats?: { texte: string }[]
  min?: number
  comparees?: number
  publications?: number
  comptesCompares?: number
  du?: string
  au?: string
  le?: string
}
/** Ce qui marche : les publications des 90 derniers jours chez Meta (gardé 12 h côté serveur ; `cache` : sans relire). */
export const lireRecommandations = (mode: '' | 'cache' | 'forcer') =>
  socialApi<{ reco?: Reco | null }>('GET', `/recommandations${mode === 'cache' ? '?cache=1' : mode === 'forcer' ? '?forcer=1' : ''}`)

// ── Rédaction assistée (Claude, côté serveur) ───────────────────────────────

export interface Variante {
  angle?: string
  fr?: string
  nl?: string
  surtitre?: string
  titre?: string
  titreNl?: string
  phrase?: string
}
export const proposerTextes = (corps: Record<string, unknown>) => socialApi<{ variantes?: Variante[]; hashtags?: string[] }>('POST', '/redaction/proposer', corps)

export interface Correction {
  textes?: { cle: string; texte: string; change?: boolean }[]
  corrections?: { cle: string; avant: string; apres: string; raison: string }[]
  remarques?: string[]
}
export const corrigerTextes = (corps: { contexte: string; textes: { cle: string; langue: string; texte: string }[] }) =>
  socialApi<Correction>('POST', '/redaction/corriger', corps)

/** Détoure une photo (remove.bg, côté serveur) : le PNG détouré et les crédits consommés. */
export const detourer = (image: string) => socialApi<{ src: string; credits?: number | null }>('POST', '/media/detourer', { image })

/** Les publications en ligne d'un compte Instagram (la grille du profil, relue par l'écran Grille). */
export const lireGrilleInstagram = (shop: string) => socialApi<{ media?: { src: string }[] }>('GET', `/instagram/grille?shop=${encodeURIComponent(shop)}`)

// ── Médiathèque commune du marketing ────────────────────────────────────────

export interface MediaCommun {
  id: number | string
  kind?: string
  url: string
  webUrl?: string | null
  thumbnailUrl?: string | null
  name: string
  category?: { label: string } | null
  subcategory?: { label: string } | null
  season?: { label: string } | null
  cutout?: boolean
}
export interface Classements {
  categories?: { code: string; label: string; subcategories?: { code: string; label: string }[] }[]
  seasons?: { code: string; label: string }[]
}
export const lireClassements = () => socialApi<{ data?: Classements }>('GET', '/mediatheque/bibliotheque')
export const lireMediatheque = (page: number) =>
  socialApi<{ data?: MediaCommun[]; meta?: { pagination?: { totalPages?: number } } }>('GET', `/mediatheque?perPage=100&page=${page}`)

type ChampsMedia = { name: string; cutout: boolean; category: string | null; subcategory: string | null; season: string | null }
const enQuery = (o: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()

/** Verse un fichier tel quel (l'original : une affiche ou une bâche en a besoin). */
export const deposerFichier = (fichier: Blob, champs: ChampsMedia) => socialApi<{ data?: MediaCommun }>('POST', `/mediatheque?${enQuery(champs)}`, fichier)
/** Verse un visuel déjà lu (data: ou adresse), avec sa couverture pour une vidéo. */
export const deposerContenu = (content: string, poster: string | undefined, champs: ChampsMedia) =>
  socialApi<{ data?: MediaCommun }>('POST', '/mediatheque', { content, poster, ...champs })
export const poserCouverture = (id: number | string, image: Blob) => socialApi<{ data?: MediaCommun }>('PUT', `/mediatheque/${id}/couverture`, image)
export const reclasserMedia = (id: number | string, champs: ChampsMedia) => socialApi('PATCH', `/mediatheque/${id}`, champs)
export const retirerMedia = (id: number | string) => socialApi('DELETE', `/mediatheque/${id}`)

// ── Photo du webshop rapatriée ──────────────────────────────────────────────

const RACINE = `${ROOTS.social.replace(/\/+$/, '')}/api/v1/social`
const LOCALES = new Map<string, Promise<string>>()

/**
 * Une photo du webshop (Cloudflare R2, sans en-tête CORS) rapatriée par le module et remise en JPEG (data:) :
 * le visuel composé qui la dessine peut alors être exporté pour Meta. Une image déjà locale (même origine,
 * data:, blob:) est rendue telle quelle. La route rend une image, pas du JSON : appel direct, même session.
 */
export function photoLocale(src: string): Promise<string> {
  src = String(src || '')
  if (!/^https?:\/\//i.test(src)) return Promise.resolve(src)
  try {
    if (new URL(src, window.location.href).origin === window.location.origin) return Promise.resolve(src)
  } catch {
    return Promise.resolve(src)
  }
  const deja = LOCALES.get(src)
  if (deja) return deja
  const p = (async () => {
    const jeton = getTokens()?.accessToken
    const r = await fetch(`${RACINE}/media/webshop?u=${encodeURIComponent(src)}`, {
      credentials: 'same-origin',
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : undefined,
    })
    if (!r.ok) {
      let m = `HTTP ${r.status}`
      try {
        m = ((await r.json()) as { error?: string }).error || m
      } catch {
        /* corps illisible */
      }
      throw new Error(`photo du webshop illisible : ${m}`)
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((ok, ko) => {
        const i = new Image()
        i.onload = () => ok(i)
        i.onerror = () => ko(new Error('photo du webshop illisible'))
        i.src = url
      })
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k))
      c.height = Math.max(1, Math.round(img.naturalHeight * k))
      const g = c.getContext('2d')
      if (!g) throw new Error('photo du webshop illisible')
      g.fillStyle = '#FFFFFF'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/jpeg', 0.9)
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  LOCALES.set(src, p)
  p.catch(() => LOCALES.delete(src))
  return p
}
