import { socialApi } from './store'

/**
 * Appels de l'écran « Formulaires de leads » (repris de social/public/SA Leads.dc.html) : le relecteur des
 * textes du formulaire. Le reste (formulaires, publicités) passe par l'état du module (`enregistrer`).
 */
export interface TexteARelire {
  cle: string
  langue: 'fr' | 'nl' | 'en'
  texte: string
}

export interface Relecture {
  /** Chaque texte, corrigé ou non (`change` : le relecteur l'a modifié). */
  textes?: { cle: string; texte: string; change?: boolean }[]
  corrections?: { cle: string; avant: string; apres: string; raison: string }[]
  remarques?: string[]
}

/** Le relecteur (Claude, côté serveur) : orthographe, grammaire, typographie et charte, sans réécrire. */
export function corrigerTextes(contexte: string, textes: TexteARelire[]): Promise<Relecture> {
  return socialApi<Relecture>('POST', '/redaction/corriger', { contexte, textes })
}
