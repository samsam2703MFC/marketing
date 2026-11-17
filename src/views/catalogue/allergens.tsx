import type { CSSProperties } from 'react'

/**
 * Les 14 allergènes du règlement (UE) n° 1169/2011 (annexe II) au catalogue imprimé (17/11/2026, Sam : « les
 * allergènes, obligatoires, avec leur explication sur l'avant-dernière page ») : leur nom (FR, NL) et leur pictogramme.
 * Les codes sont ceux de l'API (`Marketing\Support\Allergens::CODES`), dans le même ordre.
 *
 * Pictogrammes : ceux de la tablette du comptoir (dépôt consultant_BO, `public/tablette`), dessinés au trait sur une
 * grille de 24 × 24 — d'après Lucide (https://lucide.dev ; icônes wheat, shrimp, egg, fish, bean, milk, nut,
 * leafy-green, wine, flower, shell), ISC License, Copyright (c) 2026 Lucide Icons and Contributors : « Permission to
 * use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided
 * that the above copyright notice and this permission notice appear in all copies. »
 */
export type AllergenCode =
  | 'gluten' | 'crustaces' | 'oeufs' | 'poisson' | 'arachides' | 'soja' | 'lait'
  | 'fruits_coque' | 'celeri' | 'moutarde' | 'sesame' | 'sulfites' | 'lupin' | 'mollusques'

export const ALLERGEN_CODES: AllergenCode[] = ['gluten', 'crustaces', 'oeufs', 'poisson', 'arachides', 'soja', 'lait', 'fruits_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques']

export const ALLERGEN_NAMES: Record<AllergenCode, { fr: string; nl: string }> = {
  gluten: { fr: "Gluten", nl: "Gluten" },
  crustaces: { fr: "Crustacés", nl: "Schaaldieren" },
  oeufs: { fr: "Œufs", nl: "Eieren" },
  poisson: { fr: "Poisson", nl: "Vis" },
  arachides: { fr: "Arachides", nl: "Pinda’s" },
  soja: { fr: "Soja", nl: "Soja" },
  lait: { fr: "Lait", nl: "Melk" },
  fruits_coque: { fr: "Fruits à coque", nl: "Noten" },
  celeri: { fr: "Céleri", nl: "Selderij" },
  moutarde: { fr: "Moutarde", nl: "Mosterd" },
  sesame: { fr: "Sésame", nl: "Sesam" },
  sulfites: { fr: "Sulfites", nl: "Sulfieten" },
  lupin: { fr: "Lupin", nl: "Lupine" },
  mollusques: { fr: "Mollusques", nl: "Weekdieren" },
}

type El = [string, Record<string, string>]
const ICONS: Record<AllergenCode, El[]> = {
  gluten: [['path', { d: "M2 22 16 8" }], ['path', { d: "M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" }], ['path', { d: "M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" }], ['path', { d: "M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" }], ['path', { d: "M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" }], ['path', { d: "M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" }], ['path', { d: "M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" }], ['path', { d: "M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" }]],
  crustaces: [['path', { d: "M10 2a3.28 3.28 0 003.227 1.798l6.17-.561A1 1 0 1119.614 8H8.5a6.44 6.44 0 00-5.63 9.75A6.5 6.5 0 008.5 21c1.38 0 2-.5 2.5-1" }], ['path', { d: "M10 8a8.5 8.5 0 000 8" }], ['path', { d: "M11 22c-.5-.5-1.12-1-2.5-1a1 1 0 010-5H12a7 7 0 007-7V8" }], ['path', { d: "M13 12h.01" }], ['path', { d: "M8 16c-2 0-4.5-4-4-6" }]],
  oeufs: [['path', { d: "M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12" }]],
  poisson: [['path', { d: "M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z" }], ['path', { d: "M18 12v.5" }], ['path', { d: "M16 17.93a9.77 9.77 0 0 1 0-11.86" }], ['path', { d: "M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" }], ['path', { d: "M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4" }], ['path', { d: "m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98" }]],
  arachides: [['path', { transform: "translate(12 12) rotate(-40) scale(1.08) translate(-12 -12)", d: "M12 2.5c2.6 0 4.5 2 4.5 4.6 0 1.6-.8 2.6-1.3 3.6-.4.8 0 1.4.6 2.3.6.9 1.2 2 1.2 3.4 0 3-2.3 5.1-5 5.1s-5-2.1-5-5.1c0-1.4.6-2.5 1.2-3.4.6-.9 1-1.5.6-2.3-.5-1-1.3-2-1.3-3.6 0-2.6 1.9-4.6 4.5-4.6Z" }], ['path', { transform: "translate(12 12) rotate(-40) scale(1.08) translate(-12 -12)", d: "M10.5 6.5h.01M13.5 8h.01M10.5 15.5h.01M13.5 17h.01" }]],
  soja: [['path', { d: "M10.165 6.598C9.954 7.478 9.64 8.36 9 9c-.64.64-1.521.954-2.402 1.165A6 6 0 0 0 8 22c7.732 0 14-6.268 14-14a6 6 0 0 0-11.835-1.402Z" }], ['path', { d: "M5.341 10.62a4 4 0 1 0 5.279-5.28" }]],
  lait: [['path', { d: "M8 2h8" }], ['path', { d: "M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2" }], ['path', { d: "M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0" }]],
  fruits_coque: [['path', { d: "M16.847 5.847 20 9a7.23 7.23 0 011.551 7.516C21.241 17.352 21 17.932 21 19v1a1 1 0 01-1 1h-1c-1.069 0-1.648.242-2.485.552A7.2 7.2 0 019.002 20l-3.155-3.153" }], ['path', { d: "M18.21 5.43c-1.71.69-5.07 1.07-6.71 1.07.46 1.38.91 2.74.61 4.88a.88.88 0 01-.73.74c-1.78.28-3.54-.17-4.88-.62 0 1.64-.38 5-1.07 6.71-.21.52-.82.55-1.17.12A10 10 0 0118.33 4.26c.43.35.4.97-.12 1.17" }], ['path', { d: "M4.93 4.93 3 3a.7.7 0 010-1" }]],
  celeri: [['path', { d: "M2 22c1.25-.987 2.27-1.975 3.9-2.2a5.56 5.56 0 0 1 3.8 1.5 4 4 0 0 0 6.187-2.353 3.5 3.5 0 0 0 3.69-5.116A3.5 3.5 0 0 0 20.95 8 3.5 3.5 0 1 0 16 3.05a3.5 3.5 0 0 0-5.831 1.373 3.5 3.5 0 0 0-5.116 3.69 4 4 0 0 0-2.348 6.155C3.499 15.42 4.409 16.712 4.2 18.1 3.926 19.743 3.014 20.732 2 22" }], ['path', { d: "M2 22 17 7" }]],
  moutarde: [['rect', { x: "7", y: "5", width: "10", height: "3", rx: "1" }], ['path', { d: "M8 8v11a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8" }], ['path', { d: "M8 13h8" }], ['path', { d: "M14.5 5 18 1.5" }]],
  sesame: [['path', { transform: "translate(12 7.5)", d: "M0-4.8c1.7 2 2.5 3.6 2.5 4.9a2.5 2.5 0 0 1-5 0c0-1.3.8-2.9 2.5-4.9Z" }], ['path', { transform: "translate(6.8 16.2) rotate(-40)", d: "M0-4.8c1.7 2 2.5 3.6 2.5 4.9a2.5 2.5 0 0 1-5 0c0-1.3.8-2.9 2.5-4.9Z" }], ['path', { transform: "translate(17.2 16.2) rotate(40)", d: "M0-4.8c1.7 2 2.5 3.6 2.5 4.9a2.5 2.5 0 0 1-5 0c0-1.3.8-2.9 2.5-4.9Z" }]],
  sulfites: [['path', { d: "M8 22h8" }], ['path', { d: "M7 10h10" }], ['path', { d: "M12 15v7" }], ['path', { d: "M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z" }]],
  lupin: [['circle', { cx: "12", cy: "12", r: "3" }], ['path', { d: "M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5" }], ['path', { d: "M12 7.5V9" }], ['path', { d: "M7.5 12H9" }], ['path', { d: "M16.5 12H15" }], ['path', { d: "M12 16.5V15" }], ['path', { d: "m8 8 1.88 1.88" }], ['path', { d: "M14.12 9.88 16 8" }], ['path', { d: "m8 16 1.88-1.88" }], ['path', { d: "M14.12 14.12 16 16" }]],
  mollusques: [['path', { d: "M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44" }]],
}

/** Le pictogramme d'un allergène, au trait, dans un rond (taille en mm via la feuille de style du catalogue). */
export function AllergenIcon({ code, title, style }: { code: string; title?: string; style?: CSSProperties }) {
  const els = ICONS[code as AllergenCode]
  if (!els) return null
  return (
    <svg className="cat-al" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={title} style={style}>
      {title ? <title>{title}</title> : null}
      {els.map(([tag, attrs], i) =>
        tag === 'circle' ? <circle key={i} {...attrs} /> : tag === 'rect' ? <rect key={i} {...attrs} /> : <path key={i} {...attrs} />,
      )}
    </svg>
  )
}

/** Les pictogrammes d'un produit, sur une ligne. */
export function Allergens({ codes, lang }: { codes?: string[] | null; lang: 'fr' | 'nl' }) {
  if (!codes || !codes.length) return null
  return (
    <span className="cat-als">
      {codes.map((c) => (
        <AllergenIcon key={c} code={c} title={ALLERGEN_NAMES[c as AllergenCode]?.[lang] ?? c} />
      ))}
    </span>
  )
}
