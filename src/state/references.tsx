import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { labelOf } from '../lib/api/module'
import type { CodeLabel, References } from '../lib/api/module'

/**
 * Référentiels mis à disposition de tous les écrans.
 *
 * Ils sont chargés une fois au démarrage et traversent l'application. Un
 * contexte plutôt qu'une propriété passée d'écran en écran : la traduction d'un
 * code en libellé concerne des composants profondément imbriqués — un tableau
 * de coûts, une pastille de canal — dont la signature n'a rien à voir avec les
 * référentiels. Les faire descendre à la main aurait ajouté un paramètre à
 * chaque niveau intermédiaire pour le seul besoin du dernier.
 */
const ReferencesContext = createContext<References | null>(null)

export function ReferencesProvider({
  value,
  children,
}: {
  value: References
  children: ReactNode
}) {
  return <ReferencesContext.Provider value={value}>{children}</ReferencesContext.Provider>
}

export function useReferences(): References {
  const references = useContext(ReferencesContext)

  if (references === null) {
    // Une erreur explicite plutôt qu'un écran vide : le fournisseur manquant
    // est un défaut de montage, pas un cas de données.
    throw new Error('useReferences appelé hors du ReferencesProvider.')
  }

  return references
}

/** Raccourci : le libellé d'un code dans l'un des référentiels plats. */
export function useLabel(pick: (references: References) => CodeLabel[]) {
  const references = useReferences()

  return (code: string | null | undefined): string => labelOf(pick(references), code)
}
