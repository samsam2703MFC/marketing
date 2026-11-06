import { useSyncExternalStore } from 'react'
import { ROOTS } from '../api/module'
import { request as httpRequest } from '../api/http'

/**
 * L'état du module Social & Ads, lu au serveur du module (`GET /state`) et réécrit par différence
 * (`POST /state`) — le même protocole que social/public/social-data.js, porté pour les écrans réécrits
 * dans le Marketing (docs/PORTAILS.md, étape 2f). Une seule instance par onglet ; les écrans s'y
 * abonnent par `useSocial()`.
 *
 * Pas de mode démonstration : sans serveur, l'écran dit l'erreur (règle du dépôt : pas de données
 * inventées).
 */

/** Un objet du serveur : les champs nommés sont ceux que les écrans lisent, le reste passe tel quel. */
export interface Objet {
  id: string
  [cle: string]: unknown
}

export interface Boutique extends Objet {
  name: string
  langs?: string[]
  address?: string
  hours?: string
  hoursNl?: string
  page?: string
  ig?: string
  fb?: string
  igs?: string
  ads?: string
  test?: boolean
}

export interface Operation extends Objet {
  name: string
  type?: string
  typeLabel?: string
  status?: string
  start?: string
  end?: string
  shops: string[]
  budget?: number
  split?: Record<string, number>
  goal?: { metric?: string; value?: number; label?: string }
  products?: string[]
  lien?: string
  source?: string
  boId?: number
}

/** Résultats d'une opération par boutique (Meta + ventes caisse), calculés par le serveur (src/results.php). */
export interface Resultat {
  spend: number
  reach: number
  impr: number
  clicks: number
  eng: number
  vv: number
  caRef: number | null
  caCamp: number | null
  tRef: number | null
  tCamp: number | null
  qRef: number | null
  qCamp: number | null
  [cle: string]: unknown
}

export interface EtatSocial {
  posts: Objet[]
  ads: Objet[]
  campaigns: Operation[]
  shops: Boutique[]
  activity: { at: string; who: string; what: string; detail?: string }[]
  leadforms: Objet[]
  groups: Objet[]
  templates: Objet[]
  leads: Objet[]
  ftemplates: Objet[]
  franchise: { rules: Record<string, unknown>; url?: string }
  params: Record<string, unknown>
  meta: { version?: string; dsa?: Record<string, string>; ids?: Record<string, Record<string, string>>; networkAccount?: string; lastCheck?: string }
}

/** Ce que `GET /state` rend en plus de l'état : la journée du serveur, la marge, les résultats… */
export interface Serveur {
  mode: 'live'
  today: string
  now?: string
  margin: number
  user: { name: string; role?: string; shops?: number }
  boUrl?: string
  brand?: Record<string, unknown> | null
  reseau?: { instagram: boolean; publicite: boolean }
  instagramUnique?: boolean
  metaStatus?: unknown
  operations?: { erreur?: string | null; api?: string; lien?: string }
  results: Record<string, Record<string, Resultat>>
  catalogue?: Objet[]
  darkPosts?: Objet[]
  metaImport?: unknown
  ia?: Record<string, unknown>
  [cle: string]: unknown
}

type Methode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const RACINE = `${ROOTS.social.replace(/\/+$/, '')}/api/v1/social`
const ENSEMBLES = ['posts', 'ads', 'campaigns', 'leadforms', 'groups', 'templates', 'ftemplates'] as const

/** Un appel à l'API du module Social. Une erreur porte le message du module (`{ error }`). */
export function socialApi<T = unknown>(method: Methode, chemin: string, corps?: unknown): Promise<T> {
  return httpRequest<T>(`${RACINE}${chemin}`, { method, body: corps, baseUrl: '' })
}

type Instantane = Record<string, string>
const instantane = (liste: { id?: unknown }[] | undefined): Instantane => {
  const m: Instantane = {}
  for (const x of liste ?? []) if (x && x.id != null) m[String(x.id)] = JSON.stringify(x)
  return m
}

interface Etat {
  chargement: 'attente' | 'pret' | 'erreur'
  erreur: string | null
  serveur: Serveur | null
  etat: EtatSocial | null
  /** Les messages de Meta rendus par un enregistrement (« Enregistré, mais Meta a répondu : … »). */
  avis: string | null
}

let courant: Etat = { chargement: 'attente', erreur: null, serveur: null, etat: null, avis: null }
const abonnes = new Set<() => void>()
let base: Record<string, Instantane | string> = {}
let journalConnu = new WeakSet<object>()
let file: Promise<unknown> = Promise.resolve()
let enAttente = 0
let lecture: Promise<void> | null = null

function publier(suite: Partial<Etat>) {
  courant = { ...courant, ...suite }
  abonnes.forEach((f) => f())
}

function appliquer(L: Serveur & Partial<EtatSocial> & { meta?: EtatSocial['meta'] }) {
  const etat: EtatSocial = {
    posts: (L.posts as Objet[]) ?? [],
    ads: (L.ads as Objet[]) ?? [],
    campaigns: (L.campaigns as Operation[]) ?? [],
    shops: (L.shops as Boutique[]) ?? [],
    activity: (L.activity as EtatSocial['activity']) ?? [],
    leadforms: (L.leadforms as Objet[]) ?? [],
    groups: (L.groups as Objet[]) ?? [],
    templates: (L.templates as Objet[]) ?? [],
    leads: (L.leads as Objet[]) ?? [],
    ftemplates: (L.ftemplates as Objet[]) ?? [],
    franchise: (L.franchise as EtatSocial['franchise']) ?? { rules: {} },
    params: (L.params as Record<string, unknown>) ?? {},
    meta: L.meta ?? {},
  }
  base = {}
  for (const k of ENSEMBLES) base[k] = instantane(etat[k])
  base.shops = instantane(etat.shops)
  base.meta = JSON.stringify(etat.meta)
  journalConnu = new WeakSet()
  etat.activity.forEach((a) => journalConnu.add(a))
  publier({ chargement: 'pret', erreur: null, serveur: L, etat })
}

/** Lit (ou relit) l'état au serveur. Une lecture en cours est partagée ; rien ne se relit pendant un envoi. */
export function charger(): Promise<void> {
  if (lecture) return lecture
  if (enAttente) return Promise.resolve()
  lecture = socialApi<Serveur & Partial<EtatSocial>>('GET', '/state')
    .then((L) => {
      if (L?.mode !== 'live') throw new Error('le module Social ne répond pas en mode réel')
      if (!enAttente) appliquer(L)
    })
    .catch((cause: unknown) => {
      publier({ chargement: courant.etat ? 'pret' : 'erreur', erreur: cause instanceof Error ? cause.message : String(cause) })
    })
    .finally(() => {
      lecture = null
    })
  return lecture
}

/** N'envoie que les objets changés depuis la dernière lecture (même protocole que social-data.js). */
function pousser(patch: Partial<EtatSocial>) {
  const corps: { changes: Record<string, { upsert: unknown[]; delete: string[] }>; shops?: unknown[]; meta?: unknown; activity?: unknown[] } = { changes: {} }
  for (const k of ENSEMBLES) {
    if (!(k in patch)) continue
    const cur = instantane(patch[k] as Objet[])
    const old = (base[k] as Instantane) ?? {}
    const upsert = ((patch[k] as Objet[]) ?? []).filter((x) => x && x.id != null && cur[String(x.id)] !== old[String(x.id)])
    const del = Object.keys(old).filter((id) => !(id in cur))
    if (upsert.length || del.length) corps.changes[k] = { upsert, delete: del }
    base[k] = cur
  }
  if (patch.shops) {
    const cur = instantane(patch.shops)
    const old = (base.shops as Instantane) ?? {}
    const ch = patch.shops.filter((x) => cur[x.id] !== old[x.id])
    if (ch.length) corps.shops = ch.map((x) => ({ id: x.id, langs: x.langs, address: x.address, hours: x.hours, hoursNl: x.hoursNl }))
    base.shops = cur
  }
  if (patch.meta && JSON.stringify(patch.meta) !== base.meta) {
    corps.meta = patch.meta
    base.meta = JSON.stringify(patch.meta)
  }
  if (patch.activity) {
    const neufs = patch.activity.filter((a) => !journalConnu.has(a))
    neufs.forEach((a) => journalConnu.add(a))
    if (neufs.length) corps.activity = neufs
  }
  if (!Object.keys(corps.changes).length && !corps.shops && !corps.meta && !corps.activity) return
  enAttente++
  file = file
    .then(() => socialApi<{ items?: [keyof EtatSocial, Objet][]; errors?: { error: string }[] }>('POST', '/state', corps))
    .then((r) => {
      // Le serveur rend chaque objet tel qu'il l'a gardé (statut Meta, échecs, médias enregistrés).
      const etat = courant.etat
      if (etat && r.items?.length) {
        const suite = { ...etat } as unknown as Record<string, Objet[]>
        for (const [k, it] of r.items) {
          const liste = suite[k]
          if (!it || !Array.isArray(liste)) continue
          suite[k] = liste.some((x) => x.id === it.id) ? liste.map((x) => (x.id === it.id ? it : x)) : liste.concat(it)
          base[k] = { ...((base[k] as Instantane) ?? {}), [it.id]: JSON.stringify(it) }
        }
        publier({ etat: suite as unknown as EtatSocial })
      }
      if (r.errors?.length) publier({ avis: `Enregistré, mais Meta a répondu : ${r.errors.map((e) => e.error).join(' · ')}` })
    })
    .catch((cause: unknown) => publier({ avis: `Échec de l’enregistrement : ${cause instanceof Error ? cause.message : String(cause)} — rechargez la page.` }))
    .finally(() => {
      enAttente--
    })
}

/** Modifie l'état (affiché tout de suite) et envoie la différence au serveur. */
export function enregistrer(patch: Partial<EtatSocial>) {
  if (!courant.etat) return
  publier({ etat: { ...courant.etat, ...patch } })
  pousser(patch)
}

/** Ajoute une ligne au journal d'activité du module, au nom de l'utilisateur connecté. */
export function journaliser(quoi: string, detail?: string) {
  const s = courant
  if (!s.etat || !s.serveur) return
  const now = new Date()
  const at = `${s.serveur.today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  enregistrer({ activity: [{ at, who: s.serveur.user.name, what: quoi, detail }, ...s.etat.activity] })
}

/**
 * Rattache (op = « bo-… ») ou détache (null) un post ou une publicité à une opération du Marketing.
 * Publication lue chez Meta (mfb-…, mig-…) : le lien seul, côté serveur.
 */
export async function rattacher(genre: 'post' | 'ad', id: string, op: string | null) {
  const r = await socialApi('POST', '/operations/rattacher', { kind: genre, id, operation: op })
  const etat = courant.etat
  if (etat && !(genre === 'post' && /^m(fb|ig)-/.test(id))) {
    const col = genre === 'post' ? 'posts' : 'ads'
    publier({ etat: { ...etat, [col]: etat[col].map((x) => (x.id === id ? { ...x, campaign: op } : x)) } })
  }
  return r
}

export function effacerAvis() {
  publier({ avis: null })
}

function abonner(f: () => void) {
  abonnes.add(f)
  return () => abonnes.delete(f)
}

/** L'état du module Social, relu à l'ouverture du premier écran qui s'y abonne. */
export function useSocial(): Etat {
  const s = useSyncExternalStore(abonner, () => courant)
  if (s.chargement === 'attente' && !lecture) void charger()
  return s
}

// ---------------------------------------------------------------------------
// Lectures dérivées (mêmes règles que social-data.js)
// ---------------------------------------------------------------------------

/** Les boutiques du réseau (les magasins test n'y sont pas : ni rapports, ni compteurs). */
export const boutiquesReseau = (e: EtatSocial) => e.shops.filter((x) => !x.test)

export const parId = <T extends { id: string }>(liste: T[], id: string | null | undefined) => liste.find((x) => x.id === id)

/** « Réseau » quand toutes les boutiques du réseau sont visées, sinon leurs noms. */
export function libelleBoutiques(e: EtatSocial, ids: string[] | 'all' | null | undefined): string {
  const reseau = boutiquesReseau(e)
  if (!ids || ids === 'all' || ids.length === reseau.length) return 'Réseau'
  return ids.map((id) => parId(e.shops, id)?.name ?? id).join(', ')
}
