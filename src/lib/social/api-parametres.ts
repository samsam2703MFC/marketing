import { socialApi } from './store'
import type { Boutique } from './store'

/**
 * Les appels de l'écran « Paramètres et connexions » du module Social (social/public/SA Parametres.dc.html),
 * portés dans le Marketing. Les secrets (tokens Meta, clés Google, Anthropic, remove.bg, mots de passe
 * TFBuddy) ne font que PARTIR au serveur : il ne les renvoie jamais, l'écran ne dit que leur état.
 */

/** L'état de la connexion Meta (`metaStatus` de `/state`, src/meta.php → Meta::statut). */
export interface MetaStatus {
  appId?: string
  tokenDefini?: boolean
  secretDefini?: boolean
  verifyDefini?: boolean
  jeton?: { valide?: boolean; erreur?: string; expire?: string; type?: string; scopes?: string[] } | null
  sources?: Record<string, string>
  crm?: { dispo?: boolean; appId?: string }
  [cle: string]: unknown
}

export interface ResultatIds {
  ok?: boolean
  le?: string
  appliques?: string[]
  erreurs?: string[]
}

export interface IdsAuto {
  config?: { actif: boolean; ecraser: boolean; frequence: number }
  dernier?: ResultatIds | null
}

export interface Portefeuille {
  le?: string
  business?: { id?: string; name?: string }
  pages?: LignePf[]
  comptes?: LignePf[]
  instagram?: LignePf[]
  pixels?: LignePf[]
  erreurs?: string[]
}
export interface LignePf {
  id: string
  name?: string
  username?: string
  lien?: string
  actif?: boolean
  devise?: string
  boutique?: string | null
}

/** Ce que rend `GET /google/connexion` (src/google.php → socGapiEcran). */
export interface EcranGoogle {
  erreur?: string
  statut?: {
    configure?: boolean
    clientId?: string
    secretDefini?: boolean
    jetonDefini?: boolean
    mcc?: string
    verification?: { valide?: boolean; email?: string; le?: string; erreur?: string; apis?: Record<string, { ok?: boolean; erreur?: string }> } | null
  }
  decouverte?: {
    le?: string
    fiches?: { id: string; nom: string; adresse?: string }[]
    ads?: { id: string; nom?: string; devise?: string; administrateur?: boolean }[]
    ga4?: { id: string; nom: string }[]
    erreurs?: Record<string, string>
  } | null
  ids?: { boutiques: Record<string, { fiche?: string; ads?: string }>; reseau: { ads: string; ga4: string } }
  suggestions?: Record<string, string>
  trouves?: { fiches: number; ads: number; ga4: number }
}

export interface RouteAudit {
  chemin: string
  statut: string
  tag?: string
  http?: number | string
  ms?: number | null
  utilise?: string
  apercu?: string
  resume?: string
}
export interface Audit {
  routes?: RouteAudit[]
  resume?: {
    ok: number
    refuse?: number
    erreur?: number
    injoignable?: number
    absent?: number
    parametre?: number
    non_teste?: number
    total: number
    le: string
    duree: number
  } | null
  enCours?: boolean
}

// Connexions -------------------------------------------------------------------------------------------

/** Revérifie chez Meta les connexions d'une boutique (`marque` : celles du réseau), ou de toutes. */
export const testerConnexions = (shop?: string) =>
  socialApi<{ resultats: ({ shop: string; detail?: Record<string, string> } & Record<string, unknown>)[]; shops: Boutique[] }>(
    'POST',
    '/connexions/test',
    shop ? { shop } : {},
  )

// Clés et réglages -------------------------------------------------------------------------------------

/** Écrit des clés en base (chiffrées) : un champ vide ne change rien. */
export const enregistrerCles = (cles: Record<string, string>) =>
  socialApi<{ ok: boolean; maj: string[]; metaStatus?: MetaStatus; ids?: ResultatIds | null }>('POST', '/parametres/cles', cles)

/** Vide les clés Meta saisies ici : la connexion partagée du CRM candidat est reprise. */
export const reprendreCrm = () => socialApi<{ ok: boolean; metaStatus?: MetaStatus }>('POST', '/parametres/cles/crm', {})

/** Un réglage du module (`marketing_api`, `url_publique`, `ia_modele`, `charte_editoriale`). */
export const enregistrerParametres = (p: Record<string, unknown>) => socialApi('POST', '/parametres', p)

export const testerIa = () => socialApi<{ modele: string }>('POST', '/redaction/tester', {})

// Portefeuille Business Manager et identifiants ---------------------------------------------------------

export const lirePortefeuille = () => socialApi<{ portefeuille?: Portefeuille; businessId?: string }>('GET', '/meta/portefeuille')
export const rafraichirPortefeuille = (businessId: string) =>
  socialApi<{ portefeuille: Portefeuille }>('POST', '/meta/portefeuille/rafraichir', { businessId })
export const appliquerPortefeuille = (ecraser: boolean) =>
  socialApi<{ appliques: string[] }>('POST', '/meta/portefeuille/appliquer', { ecraser })

export const lireIdsAuto = () => socialApi<IdsAuto>('GET', '/meta/ids/auto')
export const enregistrerIdsAuto = (c: NonNullable<IdsAuto['config']>) => socialApi<IdsAuto>('POST', '/meta/ids/auto', c)
export const lancerIdsAuto = () => socialApi<IdsAuto & { portefeuille?: Portefeuille }>('POST', '/meta/ids/auto/lancer', {})

// Google -----------------------------------------------------------------------------------------------

export const lireGoogle = () => socialApi<EcranGoogle>('GET', '/google/connexion')
export const enregistrerGoogle = (corps: Record<string, string>) => socialApi<EcranGoogle>('POST', '/parametres/google', corps)
export const verifierGoogle = () => socialApi<EcranGoogle>('POST', '/google/connexion/verifier', {})
export const decouvrirGoogle = () => socialApi<EcranGoogle>('POST', '/google/decouvrir', {})
export const enregistrerIdsGoogle = (ids: NonNullable<EcranGoogle['ids']>) => socialApi<EcranGoogle>('POST', '/google/ids', ids)
export const deconnecterGoogle = () => socialApi<EcranGoogle>('POST', '/google/deconnecter', {})

// TFBuddy ----------------------------------------------------------------------------------------------

export const enregistrerTfb = (corps: Record<string, string>) =>
  socialApi<{ ok: boolean; test: { admin: string; consultant: string } }>('POST', '/parametres/tfb', corps)
export const relireBoutiquesApi = () => socialApi('GET', '/shops/api?forcer=1')
export const lireAudit = () => socialApi<Audit>('GET', '/audit/api')
export const lancerAudit = () => socialApi('POST', '/audit/api', {})
