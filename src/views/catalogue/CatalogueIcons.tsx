import type { CatalogueLayout, CatalogueTemplate } from '../../lib/api/module'
import { isPresentation } from './CataloguePages'
import type * as api from '../../lib/api/module'

/** Les petits dessins des choix de l'éditeur : gabarit, en-tête, mise en page (partagés avec l'assistant). */
export function TemplateIcon({ family, template }: { family: 'products' | 'presentation'; template: CatalogueTemplate }) {
  const ink = 'currentColor'
  if (family === 'presentation') {
    return (
      <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
        <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill={template === 'B' ? ink : 'none'} fillOpacity={template === 'B' ? 0.85 : 0} stroke={ink} strokeWidth="1.2" />
        {template === 'C' ? <rect x="0.6" y="0.6" width="38.8" height="28" rx="2" fill={ink} fillOpacity="0.25" /> : <circle cx="20" cy="17" r="9" fill="none" stroke={template === 'B' ? '#fff' : ink} strokeWidth="1.2" />}
        <rect x={template === 'C' ? 5 : 9} y="34" width="22" height="4" rx="1" fill={template === 'B' ? '#fff' : ink} />
        <rect x={template === 'C' ? 5 : 12} y="41" width="16" height="2" rx="1" fill={template === 'B' ? '#fff' : ink} opacity="0.6" />
      </svg>
    )
  }
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill="none" stroke={ink} strokeWidth="1.2" />
      {template === 'B' ? <rect x="0.6" y="0.6" width="38.8" height="10" fill={ink} fillOpacity="0.85" /> : null}
      <rect x={template === 'A' ? 11 : 4} y={template === 'B' ? 4 : 4} width="18" height="3" rx="1" fill={template === 'B' ? '#fff' : ink} />
      {template === 'C' ? <rect x="4" y="9.5" width="32" height="0.8" fill={ink} /> : null}
      {[14, 26, 38].map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="15" height="10" rx="1.5" fill={template === 'C' ? ink : 'none'} fillOpacity={template === 'C' ? 0.18 : 0} stroke={template === 'C' ? 'none' : ink} strokeWidth="1" />
          <rect x="21" y={y} width="15" height="10" rx="1.5" fill={template === 'C' ? ink : 'none'} fillOpacity={template === 'C' ? 0.18 : 0} stroke={template === 'C' ? 'none' : ink} strokeWidth="1" />
        </g>
      ))}
    </svg>
  )
}

/** Vignette d'un en-tête de page : titre seul · bandeau · grande illustration. */
export function HeaderIcon({ header }: { header: api.CatalogueHeader }) {
  const ink = 'currentColor'
  const drawing = (cx: number, cy: number, r: number, color: string) => (
    <g fill="none" stroke={color} strokeWidth="1.1">
      <path d={`M${cx - r} ${cy + r * 0.5} Q${cx} ${cy - r * 1.1} ${cx + r} ${cy + r * 0.5} Z`} />
      <path d={`M${cx - r * 0.4} ${cy - r * 0.1} L${cx - r * 0.1} ${cy + r * 0.4} M${cx + r * 0.2} ${cy - r * 0.2} L${cx + r * 0.5} ${cy + r * 0.3}`} />
    </g>
  )
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill="none" stroke={ink} strokeWidth="1.2" />
      {header === 'bandeau' ? <rect x="0.6" y="0.6" width="38.8" height="13" fill={ink} fillOpacity="0.85" /> : null}
      {header === 'titre' ? (
        <>
          {drawing(10, 6.5, 3, ink)}
          <rect x="15" y="5" width="16" height="3" rx="1" fill={ink} />
        </>
      ) : header === 'bandeau' ? (
        <>
          {drawing(8.5, 7, 4.5, '#fff')}
          <rect x="16" y="5.5" width="18" height="3" rx="1" fill="#fff" />
        </>
      ) : (
        <>
          {drawing(20, 10, 7, ink)}
          <rect x="11" y="18" width="18" height="3" rx="1" fill={ink} />
        </>
      )}
      {(header === 'grande' ? [25, 37] : [17, 29, 41]).map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="15" height={header === 'grande' ? 10 : 9} rx="1.5" fill="none" stroke={ink} strokeWidth="1" />
          <rect x="21" y={y} width="15" height={header === 'grande' ? 10 : 9} rx="1.5" fill="none" stroke={ink} strokeWidth="1" />
        </g>
      ))}
    </svg>
  )
}

export function LayoutIcon({ layout }: { layout: CatalogueLayout }) {
  if (isPresentation(layout)) {
    const list = layout === 'presentation_liste'
    return (
      <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
        <circle cx="20" cy={list ? 11 : 17} r={list ? 7 : 11} fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9" y={list ? 21 : 33} width="22" height="3.5" rx="1" fill="currentColor" />
        {list ? [28, 34, 40, 46].map((y) => <rect key={y} x="3" y={y} width="34" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />) : <rect x="12" y="40" width="16" height="2" rx="1" fill="currentColor" opacity="0.6" />}
      </svg>
    )
  }
  const cells =
    layout === 'vedette'
      ? [[2, 2, 36, 18], [2, 22, 17, 13], [21, 22, 17, 13], [2, 37, 17, 13], [21, 37, 17, 13]]
      : layout === 'grille'
        ? [[2, 2, 17, 15], [21, 2, 17, 15], [2, 19, 17, 15], [21, 19, 17, 15], [2, 36, 17, 14], [21, 36, 17, 14]]
        : layout === 'mosaique'
          ? [[2, 2, 17, 23], [21, 2, 17, 23], [2, 27, 17, 23], [21, 27, 17, 23]]
        : layout === 'pleine'
          ? [[2, 2, 36, 34], [2, 39, 36, 11]]
        : [[2, 3, 36, 7], [2, 13, 36, 7], [2, 23, 36, 7], [2, 33, 36, 7], [2, 43, 36, 6]]
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      {cells.map(([x, y, w, h], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  )
}

