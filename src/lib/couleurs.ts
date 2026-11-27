import type { CSSProperties } from 'react'

/**
 * Couleurs venues de la base (statuts, leviers) rendues lisibles à l'écran.
 *
 * Les référentiels portent des couleurs d'identification (`#b26a00` « Planifiée », `#8A847C` « Brouillon »,
 * leviers saturés) qui, écrites telles quelles en petit texte sur leur fond teinté, tombaient sous 4,5:1
 * (audit d'interface du 27/11/2026). On garde la teinte, on l'assombrit vers l'encre : la base ne change pas.
 */
export function encreLisible(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  return `color-mix(in srgb, ${hex} 70%, #1c1a17)`
}

/** Pastille de levier : la couleur du levier passe en variable CSS (`.lever-tag` en fait une teinte + un point). */
export function styleLevier(hex: string | null | undefined): CSSProperties | undefined {
  if (!hex) return undefined
  return { '--lever': hex } as CSSProperties
}
