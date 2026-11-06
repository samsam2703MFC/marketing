import { ROOTS } from '../api/module'
import { request as httpRequest, TfBuddyError } from '../api/http'

/**
 * Espace franchisé — les appels à l'API du module Social & Ads (`/franchise/*`, social/src/franchise.php),
 * repris de social/franchisee/franchise-data.js. Le serveur décide de la boutique : `GET /franchise/etat`
 * rend celle de la session (l'ERP l'a ouverte) ; les appels suivants portent l'identifiant qu'il a rendu
 * (`poserBoutique`, appelé par le store), jamais une boutique choisie par le navigateur.
 *
 * Pas de mode démonstration (règle du dépôt : pas de données inventées).
 */

type Methode = 'GET' | 'POST'

/** Sans session : l'espace s'ouvre depuis l'ERP, où le gérant est déjà connecté. */
export const HORS_SESSION = 'Ouvrez votre espace boutique depuis l’ERP : vous y êtes déjà connecté.'

const RACINE = `${ROOTS.social.replace(/\/+$/, '')}/api/v1/social`

/** L'erreur d'un appel : le message du module, et son code HTTP (0 = réseau). */
export class ErreurFranchise extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ErreurFranchise'
    this.status = status
  }
}

/** Un appel brut à l'API de l'espace. Une erreur porte le message du module (`{ error }`). */
export async function franchiseApi<T = unknown>(method: Methode, chemin: string, corps?: unknown): Promise<T> {
  try {
    return await httpRequest<T>(`${RACINE}${chemin}`, { method, body: corps, baseUrl: '' })
  } catch (e) {
    const status = e instanceof TfBuddyError ? e.status : 0
    if (status === 401) throw new ErreurFranchise(HORS_SESSION, 401)
    throw new ErreurFranchise(e instanceof Error ? e.message || 'erreur' : String(e), status)
  }
}

// ---------------------------------------------------------------------------
// La boutique de la session (celle que le serveur a rendue)
// ---------------------------------------------------------------------------

let BOUTIQUE = ''
/** Posée par le store après `GET /franchise/etat` : l'identifiant de la boutique ouverte par le serveur. */
export function poserBoutique(id: string) {
  BOUTIQUE = String(id || '')
}
export const boutiqueOuverte = () => BOUTIQUE
const sh = () => `shop=${encodeURIComponent(BOUTIQUE)}`
const avecShop = <B extends object>(b: B) => ({ shop: BOUTIQUE, ...b })

/** L'état de la boutique (`shop` : une des boutiques de la session, sinon celle que le serveur choisit). */
export function lireEtat<T>(shop?: string): Promise<T> {
  return franchiseApi<T>('GET', `/franchise/etat${shop ? `?shop=${encodeURIComponent(shop)}` : ''}`)
}

// ---------------------------------------------------------------------------
// Posts de la boutique
// ---------------------------------------------------------------------------

/** Publie depuis un modèle : le serveur revérifie toutes les règles du réseau. */
export function envoyerPost<T>(corps: object): Promise<T> {
  return franchiseApi<T>('POST', '/franchise/posts', avecShop(corps))
}
/** Annule un post non publié ; `serie` : et les dates encore à venir de sa série. */
export function envoyerAnnulation(id: string, serie: boolean): Promise<{ ok: boolean; retires?: number }> {
  return franchiseApi('POST', `/franchise/posts/${encodeURIComponent(id)}/annuler`, avecShop({ serie }))
}
/** Ferme l'aperçu du franchiseur (la session du gérant, elle, est celle de l'ERP). */
export function deconnexion(): Promise<unknown> {
  return franchiseApi('POST', '/franchise/deconnexion', {})
}

// ---------------------------------------------------------------------------
// Lectures chez Meta (rien n'est copié)
// ---------------------------------------------------------------------------

/** Suivi : abonnés gagnés / perdus de la Page face au budget publicitaire, jour par jour. */
export const lireSuivi = <T = unknown>(jours: number) => franchiseApi<T>('GET', `/franchise/suivi?jours=${jours}&${sh()}`)
/** Vues de la Page (et de l'Instagram), vues par publication, abonnés. */
export const lireVues = <T = unknown>(jours: number) => franchiseApi<T>('GET', `/franchise/vues?jours=${jours}&${sh()}`)
/** Le calendrier Meta de la boutique entre deux dates (publications et programmation Business Suite). */
export const lireCalendrier = <T = unknown>(du: string, au: string) => franchiseApi<T>('GET', `/franchise/calendrier?${sh()}&du=${du}&au=${au}`)
/** Les chiffres (vues, personnes touchées…) d'une publication Meta. */
export const lireChiffresPublication = <T = unknown>(id: string, compte: string) =>
  franchiseApi<T>('GET', `/franchise/calendrier/stats?${sh()}&id=${encodeURIComponent(id)}&compte=${encodeURIComponent(compte)}`)
/** La grille Instagram de la boutique (celle du réseau en Instagram unique) et ce qui y est programmé. */
export const lireInstagram = <T = unknown>() => franchiseApi<T>('GET', `/franchise/instagram?${sh()}`)
/** Les abonnés Instagram jour par jour (30 jours) et les comptes touchés. */
export const lireInstagramAbonnes = <T = unknown>() => franchiseApi<T>('GET', `/franchise/instagram/abonnes?${sh()}`)

// ---------------------------------------------------------------------------
// Catalogue (TFBuddy) et webshop
// ---------------------------------------------------------------------------

const OFFRES = new Map<string, Promise<unknown>>()
/** Promotions, bundles et formules d'un produit, valables dans la boutique (lus une fois par produit). */
export function lireOffres<T = unknown>(produit: string): Promise<T> {
  if (!produit) return Promise.resolve({ promotions: [], formules: [] } as T)
  const k = `${BOUTIQUE}|${produit}`
  if (!OFFRES.has(k)) {
    const q = franchiseApi<T>('GET', `/franchise/catalogue/offres?${sh()}&produit=${encodeURIComponent(produit)}`)
    OFFRES.set(k, q)
    q.catch(() => OFFRES.delete(k))
  }
  return OFFRES.get(k) as Promise<T>
}

const LOCALES = new Map<string, Promise<string>>()
/**
 * Une photo du webshop (Cloudflare R2, sans en-tête CORS) rapatriée par le module et remise en JPEG (data:) :
 * le visuel qui la dessine peut alors être exporté. Une adresse locale est rendue telle quelle.
 */
export function photoLocale(src: string): Promise<string> {
  src = String(src || '')
  if (!/^https?:\/\//i.test(src)) return Promise.resolve(src)
  const k = `${BOUTIQUE}|${src}`
  const deja = LOCALES.get(k)
  if (deja) return deja
  const p = (async () => {
    const r = await fetch(`${RACINE}/franchise/media/webshop?${sh()}&u=${encodeURIComponent(src)}`, { credentials: 'same-origin' })
    if (!r.ok) {
      let m = `HTTP ${r.status}`
      try {
        m = ((await r.json()) as { error?: string }).error || m
      } catch {
        /* corps illisible */
      }
      throw new Error(`photo du webshop illisible : ${m}`)
    }
    const url = URL.createObjectURL(await r.blob())
    try {
      const img = await new Promise<HTMLImageElement>((ok, ko) => {
        const i = new Image()
        i.onload = () => ok(i)
        i.onerror = () => ko(new Error('photo du webshop illisible'))
        i.src = url
      })
      const k2 = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k2))
      c.height = Math.max(1, Math.round(img.naturalHeight * k2))
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
  LOCALES.set(k, p)
  p.catch(() => LOCALES.delete(k))
  return p
}

// ---------------------------------------------------------------------------
// Réseau : opérations, publicités, kit, repost, boost, bilan
// ---------------------------------------------------------------------------

/** Les opérations du réseau où figure la boutique (lecture seule). */
export const lireOperations = <T = unknown>() => franchiseApi<T>('GET', `/franchise/operations?${sh()}`)
/** Les publicités Meta qui touchent la boutique (lecture seule). */
export const lirePublicites = <T = unknown>() => franchiseApi<T>('GET', `/franchise/publicites?${sh()}`)
/** Le kit du mois : les posts que le réseau demande ce mois-ci et le suivant. */
export const lireKit = <T = unknown>() => franchiseApi<T>('GET', `/franchise/kit?${sh()}`)
/** « Ma semaine » : la ligne de la boutique dans le bilan du réseau, la moyenne des autres et son rang. */
export const lireMaSemaine = <T = unknown>() => franchiseApi<T>('GET', `/franchise/semaine?${sh()}`)
/** Repost automatique : les publications de la marque proposées à la boutique. */
export const lireReposts = <T = unknown>() => franchiseApi<T>('GET', `/franchise/reposts?${sh()}`)
export const repondreRepost = <T = unknown>(source: string, accepter: boolean, motif?: string) =>
  franchiseApi<T>('POST', '/franchise/reposts/repondre', avecShop({ source, accepter: !!accepter, motif: motif || '' }))
/** Les demandes de boost de la boutique. */
export const lireBoosts = <T = unknown>() => franchiseApi<T>('GET', `/franchise/boost?${sh()}`)
/** Propose au réseau de sponsoriser une publication de la Page (ou de l'Instagram) de la boutique. */
export const proposerBoost = <T = unknown>(publication: { id: string; account: string }, message: string) =>
  franchiseApi<T>('POST', `/franchise/boost?${sh()}`, { id: publication.id, compte: publication.account, message })

// ---------------------------------------------------------------------------
// Commentaires, avis Google, messages privés
// ---------------------------------------------------------------------------

/** Les commentaires de la Page de la boutique (et de ses publicités), classés vert / orange / rouge. */
export const lireCommentaires = <T = unknown>(jours: number) => franchiseApi<T>('GET', `/franchise/commentaires?${sh()}&jours=${jours}`)
export const repondreCommentaire = <T = unknown>(id: string, message: string) =>
  franchiseApi<T>('POST', '/franchise/commentaires/repondre', avecShop({ id, message }))
/** Avis Google : une réponse proposée. */
export const proposerReponse = <T = unknown>(id: string) => franchiseApi<T>('POST', '/franchise/commentaires/proposer', avecShop({ id }))
/** Avis Google : « J'ai répondu sur la fiche ». */
export const avisRepondu = <T = unknown>(id: string, message: string) =>
  franchiseApi<T>('POST', '/franchise/commentaires/repondu', avecShop({ id, message }))
export const traiterCommentaire = <T = unknown>(id: string, traite: boolean) =>
  franchiseApi<T>('POST', '/franchise/commentaires/traiter', avecShop({ id, traite }))
/** Les avis Google de la boutique, sa note et la cible du réseau. */
export const lireGoogle = <T = unknown>(jours: number) => franchiseApi<T>('GET', `/franchise/google?${sh()}&jours=${jours}`)
/** Les messages privés Instagram confiés à la boutique. */
export const lireMessages = <T = unknown>() => franchiseApi<T>('GET', `/franchise/messages?${sh()}`)
export const lireConversation = <T = unknown>(id: string) =>
  franchiseApi<T>('GET', `/franchise/messages/conversation?${sh()}&id=${encodeURIComponent(id)}`)
export const repondreMessage = <T = unknown>(id: string, texte: string) =>
  franchiseApi<T>('POST', '/franchise/messages/repondre', avecShop({ id, texte }))
export const traiterMessage = <T = unknown>(id: string, traite: boolean) =>
  franchiseApi<T>('POST', '/franchise/messages/traiter', avecShop({ id, traite }))
