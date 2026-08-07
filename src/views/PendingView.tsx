/**
 * Écran non encore porté.
 *
 * Affiché tel quel plutôt qu'avec des données de démonstration : une maquette
 * remplie de chiffres inventés se prend pour une fonctionnalité livrée, et
 * personne ne sait plus ce qui marche.
 */
export default function PendingView({ title }: { title: string }) {
  return (
    <section className="card pending">
      <span className="chip pending__chip">À porter</span>
      <h2>{title}</h2>
      <p className="muted">
        Cet écran est spécifié dans le handoff de design et son modèle de données existe
        (tables <code>mar_</code>), mais l’interface n’est pas encore portée.
      </p>
      <p className="muted">
        Aucune donnée de démonstration n’est affichée ici volontairement : elle laisserait
        croire que l’écran fonctionne.
      </p>
    </section>
  )
}
