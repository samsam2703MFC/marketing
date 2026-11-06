import { useSyncExternalStore } from 'react'
import { ROOTS } from '../api/module'
import { DAYS, MONTHS, addDays, d2, dLabel, dShort, iso } from '../social/format'
import { HORS_SESSION, ErreurFranchise, deconnexion, envoyerAnnulation, envoyerPost, lireEtat, poserBoutique } from './api'
import { fill as remplirModele, vars as varsModele } from './visuel'
import type { ModeleVisuel } from './visuel'

/**
 * Espace franchisé — l'état de la boutique, lu à l'API du module Social & Ads (`GET /franchise/etat`), et les
 * règles du réseau appliquées dans l'écran (le serveur les impose de toute façon). Port de
 * social/franchisee/franchise-data.js pour les écrans réécrits dans le Marketing ; une seule instance par onglet,
 * les écrans s'y abonnent par `useFranchise()`.
 *
 * La boutique est celle que le serveur rend pour la session (ouverte par l'ERP) : le navigateur ne la choisit
 * pas. Pas de mode démonstration : sans session, l'écran dit d'ouvrir l'espace depuis l'ERP.
 */

export { DAYS, MONTHS, addDays, d2, dLabel, dShort, iso }
export { HORS_SESSION }

// ---------------------------------------------------------------------------
// Types (les champs que les écrans lisent ; le reste passe tel quel)
// ---------------------------------------------------------------------------

export interface Regles {
  actif?: boolean
  validation?: 'toujours' | 'modele' | 'jamais' | string
  quotaSemaine: number
  delaiMinHeures: number
  horizonJours: number
  jours: number[]
  heureMin: string
  heureMax: string
  fb: boolean
  ig: boolean
  remiseMax: number
  promoDureeMax: number
  voirReseau?: boolean
  voirCampagnes?: boolean
  voirResultats?: boolean
  voirSuivi?: boolean
  voirAnalyse?: boolean
  voirPublicites?: boolean
  voirBudgetPub?: boolean
  voirCommentaires?: boolean
  voirAvisGoogle?: boolean
  repondreCommentaires?: boolean
  rouges?: string
  delaiReponseHeures?: number
  voirClassement?: boolean
  proposerBoost?: boolean
  voirMessages?: boolean
  repondreMessages?: boolean
  story?: boolean
  recurrenceMax?: number
  persoVisuel?: boolean
  message?: string
  [cle: string]: unknown
}

export interface Modele extends ModeleVisuel {
  id: string
  order?: number
  name: string
  description?: string
  active?: boolean
  type?: string
  fb?: boolean
  ig?: boolean
  validation?: boolean
  text?: string
  textNl?: string
  link?: string
  campaign?: string | null
  [cle: string]: unknown
}

export interface Produit {
  id: string
  apiId?: number | string
  webshop?: boolean
  categoryId?: number | string
  groupId?: number | string
  name: string
  nameNl?: string
  price?: string
  img?: string
  /** La photo du produit sur le webshop (R2). */
  photo?: string
  gamme?: string
  [cle: string]: unknown
}

export interface Serie {
  id: string
  freq: string
  n: number
  rang: number
}

export interface PostFranchise {
  id: string
  date: string
  time: string
  title: string
  status: string
  own: boolean
  type?: string
  img?: string
  text?: string
  textNl?: string
  fb?: boolean
  ig?: boolean
  template?: string
  promo?: { kind: string; value?: unknown; label: string; from?: string | null; to?: string | null } | null
  refus?: string | null
  reason?: string | null
  campaign?: string | null
  story?: 'seule' | 'aussi' | null
  serie?: Serie | null
  link?: string
  [cle: string]: unknown
}

export interface BoutiqueFranchise {
  id: string
  name: string
  langs?: string[]
  hours?: string
  hoursNl?: string
  address?: string
  page?: string
  ig?: string
  fb?: string
  igs?: string
}

export interface OperationBoutique {
  id: string
  name: string
  type?: string
  start?: string
  end?: string
  status?: string
  products?: string[]
  levers?: string[]
  description?: string
  budget?: number | null
  result?: Record<string, unknown> | null
}

export interface AlertesBoutique {
  com?: { rouges?: number; oranges?: number; enRetard?: number; pourBoutique?: number; pourReseau?: number }
  google?: { rouges?: number; oranges?: number; enRetard?: number; pourBoutique?: number; pourReseau?: number }
  messages?: { aRepondre?: number }
}

export interface EtatFranchise {
  today: string
  now: string
  mode: string
  me: { name: string; via: 'hote' | 'apercu' | 'libre' | string; shops: { id: string; name: string }[] }
  shop: BoutiqueFranchise
  rules: Regles
  templates: Modele[]
  posts: PostFranchise[]
  campaigns: OperationBoutique[]
  catalogue: Produit[]
  quota: { week?: string; used: number; max: number }
  instagramUnique?: boolean
  visuelsModeles?: { id: string; nom: string; v: Record<string, unknown> }[]
  etiquettesModeles?: { id: string; nom: string; [cle: string]: unknown }[]
  grilleInstagram?: boolean
  webshopPlan?: unknown
  webshopUrl?: string
  franchisorUrl?: string
  alertes?: AlertesBoutique
  [cle: string]: unknown
}

/** Ce que l'écran envoie pour publier (le corps de `POST /franchise/posts`). */
export interface SaisiePost {
  template: string | null
  product: string | null
  discount?: number
  offer?: string
  promoPrice?: string
  from?: string
  to?: string
  free?: string
  photo?: string | null
  link?: string
  fb: boolean
  ig: boolean
  date: string
  time: string
  offre?: { genre: 'formule'; nom: string } | { genre: 'promotion'; id: number | string; nom: string; du?: string | null; au?: string | null } | null
  format?: 'post' | 'story' | 'post_story'
  recurrence?: { freq: string; n: number } | null
  visual?: string
  visualStory?: string
}

// ---------------------------------------------------------------------------
// L'état partagé
// ---------------------------------------------------------------------------

interface Etat {
  chargement: 'attente' | 'pret' | 'erreur'
  erreur: string | null
  etat: EtatFranchise | null
}

let courant: Etat = { chargement: 'attente', erreur: null, etat: null }
const abonnes = new Set<() => void>()
let lecture: Promise<void> | null = null

function publier(suite: Partial<Etat>) {
  courant = { ...courant, ...suite }
  abonnes.forEach((f) => f())
}
function poserEtat(etat: EtatFranchise) {
  publier({ etat: { ...etat } })
}

/**
 * Lit (ou relit) l'état de la boutique. `shop` : une autre boutique de la session (le serveur refuse une
 * boutique qui n'est pas au compte) ; sans lui, celle que le serveur ouvre.
 */
export function charger(shop?: string): Promise<void> {
  if (lecture && !shop) return lecture
  lecture = lireEtat<EtatFranchise>(shop)
    .then((L) => {
      if (!L || L.mode !== 'live' || !L.shop) throw new ErreurFranchise('Espace indisponible.', 0)
      poserBoutique(L.shop.id)
      publier({ chargement: 'pret', erreur: null, etat: L })
    })
    .catch((e: unknown) => {
      const m = e instanceof Error ? e.message : String(e)
      const st = e instanceof ErreurFranchise ? e.status : 0
      const msg = st === 401 ? HORS_SESSION : st === 403 ? m || 'Accès refusé.' : st ? m || `Espace indisponible (HTTP ${st}).` : m || 'Espace indisponible.'
      // Une relecture ratée garde l'état déjà lu (l'erreur est dite) ; une première lecture ratée, non.
      publier({ chargement: courant.etat && !shop ? 'pret' : 'erreur', erreur: msg, etat: shop ? null : courant.etat })
    })
    .finally(() => {
      lecture = null
    })
  return lecture
}

/** Ouvre une autre boutique de la session (`me.shops`) : le serveur la vérifie. */
export const changerBoutique = (id: string) => charger(id)

/** L'état courant, hors de React (null avant la première lecture). */
export const etatFranchise = () => courant.etat

/** Une relecture à la demande quand un écran a changé quelque chose côté serveur (repost publié…). */
export const relire = () => charger()

function abonner(f: () => void) {
  abonnes.add(f)
  return () => abonnes.delete(f)
}

/** L'état de l'espace franchisé, lu à l'ouverture du premier écran qui s'y abonne. */
export function useFranchise(): Etat {
  const s = useSyncExternalStore(abonner, () => courant)
  if (s.chargement === 'attente' && !lecture) void charger()
  return s
}

// ---------------------------------------------------------------------------
// Dates, médias, textes (mêmes règles que franchise-data.js)
// ---------------------------------------------------------------------------

export const pad = (n: number) => String(n).padStart(2, '0')
/** L'instant d'une date (AAAA-MM-JJ) et d'une heure (HH:MM), en heure locale. */
export function at(date: string, time?: string): number {
  const d = d2(date)
  const [h, m] = String(time || '00:00').split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return /^\d{4}-\d{2}-\d{2}/.test(String(date || '')) ? d.getTime() : Number.NaN
}
export const lundi = (d: string) => addDays(d, -((d2(d).getDay() + 6) % 7))

/** Une image du module : absolue telle quelle ; `uploads/…` et `img/…` sont servis par le module Social. */
export function media(src: string | null | undefined): string {
  if (!src) return ''
  return /^(https?:|data:|blob:|\/)/.test(src) ? src : `${ROOTS.social}${src}`
}

/** Un texte de post avec {ville}, {adresse} et {horaires} remplis pour la boutique (comme le serveur). */
export function remplir(etat: EtatFranchise, texte: string | undefined, lang?: string): string {
  const s = etat.shop
  const h = lang === 'nl' ? s.hoursNl || s.hours || '' : s.hours || ''
  // {lien} : ajouté par le serveur à la publication ; pas dans l'aperçu du texte.
  const t = String(texte || '')
    .replace(/[ \t]*\{lien\}[ \t]*/g, ' ')
    .replace(/[ \t]+(\n|$)/g, '$1')
  // Sans horaires, la phrase qui les cite disparaît plutôt que « Ouvert . ».
  const t2 = !String(h).trim()
    ? t.replace(/[ \t]*[^.!?\n]*\{horaires\}[^.!?\n]*[.!?]?/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(\n|$)/g, '$1')
    : t
  return t2.replace(/\{ville\}/g, s.name || '').replace(/\{adresse\}/g, s.address || '').replace(/\{horaires\}/g, h)
}

/** Les couleurs des statuts d'un post (rectangles de 6 px). */
export const STATUS: Record<string, { bg: string; fg: string }> = {
  'À valider': { bg: '#F6E7CE', fg: '#7A5207' },
  Programmé: { bg: '#F2E2CE', fg: '#6b4420' },
  Publié: { bg: '#E2F0E8', fg: '#3f7a52' },
  Refusé: { bg: '#F6DCDF', fg: '#8D1D2C' },
  Échec: { bg: '#8D1D2C', fg: '#FFFFFF' },
  Brouillon: { bg: '#EDE7DE', fg: '#5c5852' },
}

/** Le post a-t-il besoin du réseau (validation) ? */
export const aValider = (r: Regles, t: Modele) => r.validation === 'toujours' || (r.validation === 'modele' && !!t.validation)

// ---------------------------------------------------------------------------
// Webshop (comme le serveur, src/publish.php)
// ---------------------------------------------------------------------------

/**
 * Le webshop de la boutique, ou une page de ce webshop : catégorie ?category=group:G · sous-catégorie
 * &sub=category:C · produit : sa sous-catégorie + &product=ID, et &open=product pour ouvrir sa fiche
 * (`fiche` false : le produit reste dans la liste).
 */
export function webshopUrl(
  etat: EtatFranchise,
  product?: { apiId?: number | string; categoryId?: number | string; groupId?: number | string } | null,
  kind?: 'produit' | 'categorie' | 'groupe',
  fiche?: boolean,
): string {
  const base = etat.webshopUrl || 'https://webshop.atelierby.be/'
  const sid = String(etat.shop.id)
  const plan = (etat.webshopPlan || {}) as { cats?: Record<string, number>; prods?: Record<string, number> }
  const cats = plan.cats || {}
  const prods = plan.prods || {}
  const q: [string, string][] = []
  if (/^\d+$/.test(sid)) q.push(['shop', sid])
  const pid = kind === 'produit' && product?.apiId ? Number(product.apiId) : 0
  const cat = kind === 'groupe' ? 0 : Number(product?.categoryId) || (pid && prods[pid]) || 0
  const grp = kind === 'groupe' ? Number(product?.groupId) || 0 : cat ? Number(cats[cat]) || 0 : 0
  if (kind !== 'produit' && kind !== 'categorie' && kind !== 'groupe') return q.length ? `${base}?shop=${sid}` : base
  if (cat) {
    if (grp) q.push(['category', `group:${grp}`], ['sub', `category:${cat}`])
    else q.push(['category', `category:${cat}`])
  } else if (grp) q.push(['category', `group:${grp}`])
  if (pid) {
    q.push(['product', String(pid)])
    if (fiche !== false) q.push(['open', 'product'])
  }
  return q.length ? `${base}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%3A/g, ':')}`).join('&')}` : base
}

// ---------------------------------------------------------------------------
// Règles du réseau appliquées à une saisie (l'écran les montre ; le serveur les impose)
// ---------------------------------------------------------------------------

/** Les dates d'un post récurrent (comme le serveur) : chaque jour, semaine, 2 semaines ou mois (même jour, borné). */
export function datesSerie(date: string, freq: string, n: number): string[] {
  const out: string[] = []
  const d0 = d2(date)
  for (let k = 0; k < n; k++) {
    if (freq === 'mois') {
      const y = d0.getFullYear()
      const m = d0.getMonth() + k
      out.push(iso(new Date(y, m, Math.min(d0.getDate(), new Date(y, m + 1, 0).getDate()))))
    } else out.push(addDays(date, k * ({ jour: 1, semaine: 7, '2semaines': 14 }[freq] || 7)))
  }
  return out
}

/** Chaque date d'une série face aux règles du réseau (horizon, jours, quota de sa semaine, promotion). */
export function serieDates(etat: EtatFranchise, b: SaisiePost): { date: string; rang: number; ok: boolean; motif: string }[] {
  const r = etat.rules
  const rec = b.recurrence
  if (!rec || !rec.freq || rec.freq === 'une' || !b.date) return []
  const parSemaine: Record<string, number> = {}
  const promo = b.offre && b.offre.genre === 'promotion' ? b.offre : null
  const deja = (d: string) => etat.posts.filter((p) => p.own && p.status !== 'Refusé' && p.date && lundi(p.date) === lundi(d)).length
  return datesSerie(b.date, rec.freq, Math.max(2, Number(rec.n) || 2)).map((d, k) => {
    const w = lundi(d)
    parSemaine[w] = (parSemaine[w] || 0) + 1
    const motif =
      at(d, b.time || '12:00') > Date.now() + r.horizonJours * 86400000
        ? `au-delà de ${r.horizonJours} jours`
        : !(r.jours || []).includes(d2(d).getDay())
          ? 'jour fermé à la publication'
          : deja(d) + parSemaine[w] > r.quotaSemaine
            ? `quota de la semaine atteint (${r.quotaSemaine})`
            : promo && ((promo.au && promo.au < d) || (promo.du && promo.du > d))
              ? 'la promotion ne vaut pas ce jour-là'
              : ''
    return { date: d, rang: k + 1, ok: !motif, motif }
  })
}

/** Les règles du réseau appliquées à une saisie : la liste des erreurs (vide = publiable). */
export function check(etat: EtatFranchise, b: SaisiePost): string[] {
  const r = etat.rules
  const tpl = etat.templates.find((t) => t.id === b.template)
  const err: string[] = []
  if (!tpl) return ['Ce modèle n’est plus ouvert.']
  if (!(b.fb && tpl.fb && r.fb) && !(b.ig && tpl.ig && r.ig)) err.push('Choisissez au moins un canal.')
  const when = at(b.date, b.time)
  const now = Date.now()
  if (!b.date || !b.time || Number.isNaN(when)) err.push('Choisissez la date et l’heure.')
  else {
    if (when < now + r.delaiMinHeures * 3600000) err.push(`Programmez au moins ${r.delaiMinHeures} h à l’avance.`)
    if (when > now + r.horizonJours * 86400000) err.push(`Pas plus de ${r.horizonJours} jours à l’avance.`)
    if (!(r.jours || []).includes(d2(b.date).getDay())) err.push('Ce jour n’est pas ouvert à la publication.')
    if (b.time < r.heureMin || b.time > r.heureMax) err.push(`Heure entre ${r.heureMin} et ${r.heureMax}.`)
  }
  if (etat.quota.used >= r.quotaSemaine) err.push(`Quota de la semaine atteint (${r.quotaSemaine}).`)
  if (tpl.product === 'choix' && !etat.catalogue.some((p) => p.id === b.product)) err.push('Choisissez un produit.')
  const p = tpl.promo || {}
  if (p.kind === 'remise') {
    const max = Math.min(Number(p.max), Number(r.remiseMax))
    if (!(Number(b.discount) >= Number(p.min) && Number(b.discount) <= max)) err.push(`Remise entre ${p.min} et ${max} %.`)
  }
  const api = b.offre && b.offre.genre ? b.offre : null
  if (api && (p.kind === 'remise' || p.kind === 'prix')) err.push('Ce modèle a sa propre remise : la promotion du réseau se publie avec un modèle sans remise.')
  if (p.kind === 'offre' && !api && !(p.offres || []).includes(String(b.offer))) err.push('Choisissez une offre.')
  if (p.kind === 'prix' && !(parseFloat(String(b.promoPrice).replace(',', '.')) > 0)) err.push('Indiquez le prix promotionnel.')
  const promo = api && api.genre === 'promotion' ? api : null
  if (promo && promo.au && b.date && promo.au < b.date) err.push(`La promotion « ${promo.nom} » se termine avant la publication.`)
  if (promo && promo.du && b.date && promo.du > b.date) err.push(`La promotion « ${promo.nom} » ne commence que le ${dShort(promo.du)} : publiez à partir de cette date.`)
  if (tpl.period && !(promo && promo.du && promo.au)) {
    if (!b.from || !b.to || b.to < b.from) err.push('Indiquez la période (du … au …).')
    else if ((d2(b.to).getTime() - d2(b.from).getTime()) / 86400000 + 1 > r.promoDureeMax) err.push(`Une promotion dure au plus ${r.promoDureeMax} jours.`)
  }
  if (Number(tpl.free) > 0) {
    const f = String(b.free || '').trim()
    if (!f) err.push('Complétez la phrase.')
    if (f.length > Number(tpl.free)) err.push(`Phrase limitée à ${tpl.free} caractères.`)
    if (/https?:\/\/|www\.|@\w|#\w/i.test(f)) err.push('Pas de lien, de compte (@) ni de hashtag.')
  }
  if (tpl.photo === 'upload' && !b.photo) err.push('Ajoutez votre photo.')
  if (b.format && b.format !== 'post') {
    if (r.story === false) err.push('Le réseau n’ouvre pas les stories dans cet espace.')
    if (tpl.visual?.style === 'fixe') err.push('Ce modèle a un visuel du réseau : il ne part qu’en post.')
  }
  const rec = b.recurrence
  if (rec && rec.freq && rec.freq !== 'une') {
    if (!(Number(r.recurrenceMax) >= 2)) err.push('Le réseau n’ouvre pas les posts récurrents dans cet espace.')
    else if (!(Number(rec.n) >= 2 && Number(rec.n) <= Number(r.recurrenceMax))) err.push(`Répétez le post de 2 à ${r.recurrenceMax} fois.`)
    else if (tpl.period) err.push('Une promotion datée ne se répète pas : publiez-la une fois.')
    else {
      const ko = serieDates(etat, b).filter((x) => !x.ok)
      if (ko.length) err.push(`Le ${dLabel(ko[0].date)} : ${ko[0].motif}${ko.length > 1 ? ` (et ${ko.length - 1} autre(s) date(s))` : ''}.`)
    }
  }
  return err
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/** Publie depuis un modèle (le serveur vérifie tout) ; le post et le quota rendus rejoignent l'état. */
export async function creerPost(b: SaisiePost): Promise<PostFranchise> {
  const etat = courant.etat
  if (!etat) throw new Error('Espace non chargé.')
  const r = await envoyerPost<{ post: PostFranchise | PostFranchise[]; quota?: Partial<EtatFranchise['quota']> }>(b)
  const neufs = Array.isArray(r.post) ? r.post : [r.post]
  const e = courant.etat ?? etat
  poserEtat({ ...e, posts: e.posts.concat(neufs.filter(Boolean)), quota: { ...e.quota, ...(r.quota || {}) } })
  return neufs[0]
}

/** Annule un post non publié ; `serie` : et les dates encore à venir de sa série. Rend le nombre de posts retirés. */
export async function annulerPost(id: string, serie = false): Promise<number> {
  const etat = courant.etat
  if (!etat) return 0
  await envoyerAnnulation(id, serie)
  const e = courant.etat ?? etat
  const p = e.posts.find((x) => x.id === id)
  const sid = serie && p?.serie ? p.serie.id : null
  const out = e.posts.filter((x) =>
    sid ? x.serie && x.serie.id === sid && ['À valider', 'Programmé', 'Refusé', 'Brouillon'].includes(x.status) : x.id === id,
  )
  const used = p && p.status !== 'Refusé' && e.quota.used > 0 ? e.quota.used - 1 : e.quota.used
  poserEtat({ ...e, posts: e.posts.filter((x) => !out.includes(x)), quota: { ...e.quota, used } })
  return out.length
}

/** Ferme l'aperçu du franchiseur, puis relit (sans session, l'écran le dit). */
export async function fermerApercu() {
  try {
    await deconnexion()
  } catch {
    /* déjà fermée */
  }
  await charger()
}

// ---------------------------------------------------------------------------
// Lectures dérivées
// ---------------------------------------------------------------------------

/** Les langues de la boutique (français à défaut). */
export const langues = (etat: EtatFranchise) => (etat.shop.langs?.length ? etat.shop.langs : ['fr'])

/** Le titre et les textes d'un post depuis un modèle (aperçu ; le serveur fait foi). */
export const texteModele = (tpl: Modele, champs: Parameters<typeof varsModele>[1], lang: string) =>
  remplirModele(lang === 'nl' ? tpl.textNl || tpl.text : tpl.text, varsModele(tpl, champs, lang))

/** Les jours de publication ouverts, dans l'ordre de la semaine (« lun. mar. … »). */
export const joursOuverts = (r: Regles) => [1, 2, 3, 4, 5, 6, 0].filter((j) => (r.jours || []).includes(j)).map((j) => DAYS[j])

/** La ligne des règles (menu, écran Publier). */
export function ligneRegles(r: Regles): string {
  const j = joursOuverts(r)
  return `${j.length === 7 ? 'Tous les jours' : j.join(' ')}, ${r.heureMin}–${r.heureMax} · au moins ${r.delaiMinHeures} h à l’avance${r.validation === 'toujours' ? ' · validés par le réseau' : ''}`
}

/** Les pastilles de l'espace : posts refusés / à valider, commentaires, avis Google et messages qui attendent la boutique. */
export function pastilles(etat: EtatFranchise) {
  const al = etat.alertes || {}
  const r = etat.rules
  return {
    refuses: etat.posts.filter((p) => p.own && p.status === 'Refusé').length,
    aValider: etat.posts.filter((p) => p.own && p.status === 'À valider').length,
    commentaires: al.com?.pourBoutique || 0,
    google: al.google?.pourBoutique || 0,
    messages: r.voirMessages !== false ? al.messages?.aRepondre || 0 : 0,
  }
}

/** « Connecté par l'ERP » · « Aperçu du franchiseur » · « Accès ouvert ». */
export const libelleAcces = (via: string) =>
  via === 'hote' ? 'Connecté par l’ERP' : via === 'apercu' ? 'Aperçu du franchiseur' : via === 'libre' ? 'Accès ouvert (en attendant l’ERP)' : ''

// ---------------------------------------------------------------------------
// Liens entre les pages de l'espace (dans le rail du Marketing)
// ---------------------------------------------------------------------------

/** Les pages de l'espace franchisé : leur entrée dans le rail du Marketing (`sf-<page>`). */
export type PageFranchise = 'cal' | 'pub' | 'com' | 'msg' | 'google' | 'camp' | 'ig'

/** L'adresse d'une page de l'espace dans le Marketing : `?ecran=sf-<page>&<paramètres>`. */
export function lienFranchise(page: PageFranchise, query?: string): string {
  const q = [`ecran=sf-${page}`, query ?? ''].filter(Boolean).join('&')
  return `${window.location.pathname}?${q}`
}
