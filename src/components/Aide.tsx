/**
 * Une explication à la demande : un « ? » discret, son texte en info-bulle (et lu par un lecteur d'écran).
 *
 * Le design system interdit l'aide permanente à l'écran (paragraphes « mode d'emploi », notes de bas
 * d'écran) : ce qui reste utile passe ici. Focusable au clavier, le texte s'affiche au survol comme au focus.
 */
export default function Aide({ texte }: { texte: string }) {
  return (
    <span className="aide" tabIndex={0} role="note" aria-label={texte} title={texte}>
      ?
    </span>
  )
}
