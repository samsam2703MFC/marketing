import { Children, createContext, isValidElement, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Route } from '../lib/navigation'

/**
 * Un message d'erreur lisible, avec son remède (audit du 27/11/2026, points 1 et 4).
 *
 * Les erreurs du module arrivent souvent telles que le serveur les écrit : « Route inconnue. », « Failed to connect to
 * 127.0.0.1 port 80… », « MAR_ERP_API_BASE n’est pas renseigné », « Paramètres → API Meta → Clés d’accès Meta ».
 * Ce composant, utilisé partout où un écran affiche une erreur, en fait :
 *
 * - une phrase en français qui dit ce qui ne va pas (`lireErreur`) — jamais une adresse, une variable
 *   d'environnement ou un nom de table ;
 * - un LIEN vers l'écran qui répare (« Paramètres → API Meta » ouvre l'onglet API Meta) ;
 * - le texte d'origine, replié dans « Détails » : utile au support, invisible sinon.
 */

/** Ouvre un écran du rail ; posé par l'application (App.tsx), absent dans les applications sans rail. */
export const NavigationContext = createContext<((route: Route) => void) | null>(null)

/** Où mène un chemin de réglage cité par un message (« Paramètres → API Meta → Clés d’accès Meta »). */
function routeDuChemin(chemin: string): Route {
  const c = chemin.toLowerCase()
  if (c.includes('version')) return 'social-set-version'
  if (c.includes('identifiants meta')) return 'social-set-ids'
  if (c.includes('meta') || c.includes('clés d’accès') || c.includes("clés d'accès")) return 'social-set-cles'
  if (c.includes('rédaction ia') || c.includes('ia')) return 'social-set-ia'
  if (c.includes('tfbuddy')) return 'social-set-tfb'
  if (c.includes('google')) return 'social-set-google'
  if (c.includes('modèle')) return 'social-set-tpl'
  if (c.includes('droit')) return 'social-set-rights'
  return 'social-set-conn'
}

/** Un chemin « Paramètres → … » dans un texte : ce qui suit la flèche, jusqu'à la ponctuation qui clôt la phrase. */
const CHEMIN = /Paramètres\s*→\s*[^.;:,()«»\n]+?(?:\s*→\s*[^.;:,()«»\n]+?)*(?=\s*(?:[.;:,()«»\n]|$|\s(?:ou|puis|et|pour|dans|si)\s))/g

export interface ErreurLue {
  /** La phrase à afficher, sans jargon. */
  texte: string
  /** L'écran qui répare, quand le message n'en cite pas déjà un. */
  remede: { route: Route; label: string } | null
  /** Le texte d'origine, quand la phrase l'a réécrit : replié dans « Détails ». */
  detail: string | null
}

const ADRESSES = { route: 'addresses' as Route, label: 'Adresses et réglages' }

/**
 * La phrase en français d'un message d'erreur technique. Ce qui n'est pas reconnu passe tel quel (le serveur écrit
 * déjà la plupart de ses messages en français) ; seuls les morceaux techniques en sont retirés.
 */
export function lireErreur(brut: string): ErreurLue {
  let texte = brut.trim()
  let remede: ErreurLue['remede'] = null
  // Les remèdes cités par le message (« Paramètres → … ») : gardés quoi qu'il arrive à la phrase.
  const chemins = [...texte.matchAll(CHEMIN)].map((m) => m[0])

  // Le service appelé n'existe pas à cette adresse (404 du routeur du module).
  if (/route inconnue\.?/i.test(texte)) {
    texte = texte.replace(/route inconnue\.?/i, 'ce service n’est pas disponible à l’adresse réglée pour cette version.')
    remede = ADRESSES
  }
  // Un serveur qui ne répond pas (cURL, fetch).
  if (/failed to connect|couldn['’]t connect|connection refused|could not resolve host|timed out|failed to fetch|networkerror|load failed/i.test(texte)) {
    const avant = texte.split(/\s*\(|\s*:\s*(?=failed|couldn|connection|could not|curl)/i)[0].trim()
    texte = avant && !/^(failed|couldn|connection|could|networkerror|load failed)/i.test(avant)
      ? /injoignable|ne répond pas/i.test(avant)
        ? `${avant.replace(/[.\s]+$/, '')} : le serveur ne répond pas.`.replace(/\s*injoignable\s*:\s*le serveur ne répond pas/i, ' ne répond pas')
        : `${avant.replace(/[.\s]+$/, '')} : le serveur ne répond pas.`
      : 'Le serveur ne répond pas : réessayez dans un instant ; si cela dure, vérifiez son adresse.'
    remede = remede ?? ADRESSES
  }
  // L'adresse de l'ERP (TFBuddy) n'est pas réglée.
  if (/MAR_ERP_API_BASE/.test(texte)) {
    texte = texte
      .replace(/\(?MAR_ERP_API_BASE\)?\s*n[’']est pas renseignée?/i, 'l’adresse de l’ERP n’est pas réglée')
      .replace(/\(?\s*MAR_ERP_API_BASE\s*\)?/g, '')
    remede = remede ?? { route: 'settings', label: 'Variables et clés' }
  }
  if (/compte API admin non renseigné/i.test(texte)) {
    texte = texte.replace(/compte API admin non renseigné/i, 'le compte de connexion à l’ERP (TFBuddy) n’est pas renseigné')
  }
  // Les préfixes qui ne disent rien à l'utilisateur.
  texte = texte.replace(/^erreur interne\s*:\s*/i, '')
  // Les « Token Meta absent » : la connexion n'est pas faite.
  texte = texte
    .replace(/\btoken Meta absent\b/gi, 'connexion à Meta non faite')
    .replace(/saisissez-le dans/gi, 'saisissez la clé d’accès dans')
    .replace(/\s*\(accès de Social\s*:[^)]*\)/gi, '')
  // Ce qui ne parle qu'au développeur : variables d'environnement, tables, adresses internes.
  texte = texte
    .replace(/\s*\(\s*`?(?:MAR|VITE|COCKPIT|SOCIAL)_[A-Z0-9_]+`?\s*\)/g, '')
    .replace(/`?\b(?:MAR|VITE|COCKPIT|SOCIAL)_[A-Z0-9_]+\b`?/g, 'un réglage du serveur')
    .replace(/\s*\(\s*`?mar_[a-z0-9_]+`?\s*\)/g, '')
    .replace(/\s*\(\s*https?:\/\/[^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
  // Un statut HTTP nu (« 502 Bad Gateway ») : le serveur a répondu par une erreur.
  if (/^\d{3}\b[\sA-Za-z]*$/.test(texte)) {
    texte = `Le serveur a répondu par une erreur (${texte.slice(0, 3)}) : réessayez dans un instant.`
  }
  // Un JSON illisible.
  if (/unexpected token|json\.parse|is not valid json/i.test(texte)) {
    texte = 'Le serveur a renvoyé une réponse illisible : réessayez dans un instant.'
  }

  for (const chemin of chemins) if (!texte.includes(chemin)) texte = `${texte.replace(/[.\s]+$/, '')} — ${chemin}.`
  texte = texte.replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim()
  if (texte && texte[0] !== texte[0].toUpperCase()) texte = texte[0].toUpperCase() + texte.slice(1)
  // Un remède déjà cité dans le message (« Paramètres → … ») devient un lien : pas besoin d'un second.
  if (CHEMIN.test(texte)) remede = null
  CHEMIN.lastIndex = 0

  const normal = (s: string) => s.replace(/\s+/g, ' ').trim()
  return { texte, remede, detail: normal(texte) === normal(brut) ? null : brut.trim() }
}

/** Le texte d'un nœud React fait de chaînes (« Ventes indisponibles : {erreur} »). */
function texteDe(node: ReactNode): string | null {
  let out = ''
  let ok = true
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child)
    else if (child === null || child === undefined || typeof child === 'boolean') return
    else if (isValidElement(child)) ok = false
    else ok = false
  })
  return ok ? out : null
}

/** Un lien vers un écran du rail ; sans rail (aperçu, espace boutique), le texte reste du texte. */
export function LienEcran({ route, children }: { route: Route; children: ReactNode }) {
  const aller = useContext(NavigationContext)
  if (!aller) return <>{children}</>
  return (
    <a
      className="erreur__lien"
      href={`?ecran=${route}`}
      onClick={(event) => {
        event.preventDefault()
        aller(route)
      }}
    >
      {children}
    </a>
  )
}

/** Un texte dont les « Paramètres → … » deviennent des liens vers le bon onglet. */
export function TexteAvecRemedes({ texte }: { texte: string }) {
  const morceaux: ReactNode[] = []
  let dernier = 0
  for (const m of texte.matchAll(CHEMIN)) {
    const debut = m.index ?? 0
    if (debut > dernier) morceaux.push(texte.slice(dernier, debut))
    morceaux.push(
      <LienEcran key={debut} route={routeDuChemin(m[0])}>
        {m[0].replace(/\s*→\s*/g, ' › ')}
      </LienEcran>,
    )
    dernier = debut + m[0].length
  }
  if (dernier < texte.length) morceaux.push(texte.slice(dernier))
  return <>{morceaux}</>
}

/**
 * Le message d'erreur d'un écran. `inline` pour une erreur dans une ligne de formulaire ou de tableau (un `span`) ;
 * sinon un paragraphe. Les enfants sont le texte du message, tel qu'il était écrit avant
 * (« Ventes indisponibles : {sales.error} »).
 */
export default function Erreur({ children, inline = false, className = '' }: { children: ReactNode; inline?: boolean; className?: string }) {
  const brut = texteDe(children)
  const classes = `error${className ? ` ${className}` : ''}`
  if (brut === null) {
    return inline ? <span className={classes}>{children}</span> : <p className={classes}>{children}</p>
  }
  const corps = <MessageErreur texte={brut} />
  return inline ? (
    <span className={classes}>{corps}</span>
  ) : (
    <div className={classes}>{corps}</div>
  )
}

/** Le message lisible d'une erreur, sans cadre : pour un bandeau qui a déjà son style (avertissement, alerte). */
export function MessageErreur({ texte }: { texte: string }) {
  const lu = lireErreur(texte)
  return (
    <>
      <TexteAvecRemedes texte={lu.texte} />
      {lu.remede ? (
        <>
          {' '}
          <LienEcran route={lu.remede.route}>Ouvrir {lu.remede.label}</LienEcran>
        </>
      ) : null}
      {lu.detail ? (
        <details className="erreur__detail">
          <summary>Détails</summary>
          <code>{lu.detail}</code>
        </details>
      ) : null}
    </>
  )
}
