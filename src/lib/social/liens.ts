/**
 * Les liens d'un écran Social réécrit vers un autre écran du module, dans le rail du Marketing :
 * `?ecran=social-<page>&<paramètres de l'écran>` (la même adresse que celle où Social ouvert seul renvoie).
 * Les paramètres propres à l'écran visé (`c=`, `ad=`, `operation=`…) sont ceux qu'il lisait dans le module.
 */
export function lienSocial(page: string, query?: string): string {
  const q = [`ecran=social-${page}`, query ?? ''].filter(Boolean).join('&')
  return `${window.location.pathname}?${q}`
}

/** Une pastille de profil sans photo : les initiales sur un rond aux couleurs de la marque (comme SA.avatar). */
export function avatar(nom: string | null | undefined, reseau?: 'instagram' | 'facebook'): string {
  const ini =
    String(nom || '?')
      .replace(/^l[’']atelier\s*by\s*[-–·]?\s*/i, '')
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || 'AB'
  const bg = reseau === 'instagram' ? '#C13584' : '#8D1D2C'
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${bg}"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`,
    )
  )
}
