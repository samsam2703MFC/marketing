/**
 * Badge de rattachement à une campagne.
 *
 * Le prototype utilisait le caractère ⛓. Ni Gotham ni les polices système de
 * repli ne le portent : il s'affichait en carré vide sur les trois écrans qui
 * l'emploient — grand livre, promotions, bons. Un tracé vectoriel ne dépend
 * d'aucune police et suit la couleur du texte, y compris celle du levier.
 */
export default function LinkBadge({ color, title }: { color?: string; title?: string }) {
  return (
    <svg
      className="link-badge"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title ?? 'Rattaché à une campagne'}
    >
      <title>{title ?? 'Rattaché à une campagne'}</title>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  )
}
