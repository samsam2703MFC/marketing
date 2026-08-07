import { TfBuddyError } from '../lib/api/http'

/**
 * Traduction des erreurs d'appel en message lisible.
 *
 * Ce fichier ne porte plus de gestion de connexion : le module n'a pas d'écran
 * de login. Embarqué dans l'ERP, l'identité vient de son middleware ; le front
 * se contente de demander à `/session` si elle est établie.
 *
 * Le client d'authentification ERP reste disponible dans `lib/api/auth.ts` pour
 * les appels à l'ERP lui-même, qui eux ont besoin d'un jeton.
 */
export function describeError(error: unknown): string {
  if (error instanceof TfBuddyError) {
    if (error.status === 401) return 'Session expirée ou absente.'
    if (error.status === 403) return 'Ce compte n’a pas les droits requis.'
    return error.description
  }

  if (error instanceof Error) return error.message

  return 'Erreur inconnue.'
}
