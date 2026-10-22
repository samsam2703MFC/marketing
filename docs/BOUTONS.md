# Boutons — règles du module

Audit de l'assistant de campagne (`/marketing/?nouvelle=1`), 22/10/2026. Ce qui
n'allait pas, et la règle qui le remplace. Les classes sont dans
`src/styles/global.css` (section « Boutons d'action »).

## Ce que l'audit a trouvé

| Constat | Exemple | Effet |
|---|---|---|
| Une seule classe, `.filter`, pour cinq rôles | « Suivant », l'onglet « Offre », la pastille « Mois en cours », « Retirer », « + Ajouter un jalon » | rien ne dit si un clic choisit, navigue ou agit |
| Le bordeaux plein voulait dire deux choses | `.filter.is-on` = sélection **et** action principale | l'onglet « Objectifs de vente » et « Mois en cours » ressemblaient à « Suivant » |
| Deux aspects pour « sélectionné » | `.filter.is-on` plein, `.choice-pill.is-on` / `.choice-card.is-on` liseré | deux choix exclusifs voisins ne se lisaient pas pareil |
| Quitter à deux endroits, sous deux noms | « ← Annuler » en haut, « Enregistrer et quitter » en bas | la sortie sans enregistrer était loin de celle qui enregistre |
| Action principale au milieu du pied | Précédent · **Suivant** · Enregistrer et quitter | le geste attendu n'était pas au bout de la rangée |
| Pied au bout de pages de 2 400 px | Offre, Objectifs, Canaux | « Suivant » ne se trouvait qu'en défilant |
| Liens externes en bordeaux plein | « Planifier les posts ↗ » | une deuxième « action principale » dans le contenu |
| Suppressions sans style commun | « Retirer » (pastille), « ✕ » (deux classes), « Effacer » (une troisième) | « Retirer » débordait du rétroplanning |

## La règle

**Un bouton fait, une pastille choisit, un onglet navigue.** Les trois ne se
ressemblent pas.

| Rôle | Classe | Aspect | Exemples |
|---|---|---|---|
| Action principale (une par écran) | `.btn.btn--primary` | bordeaux plein | Suivant : …, Valider la campagne |
| Action | `.btn` (`.btn--sm` dans le contenu) | blanc, filet | Précédent, Enregistrer et quitter, Reprendre l'historique, Envoyer un fichier, Créer un post ↗ |
| Sortie discrète | `.btn.btn--ghost` | texte seul | Quitter sans enregistrer |
| Retirer, effacer, réinitialiser | `.btn.btn--danger` (`--sm`, `--icon` pour ✕) | texte discret, rouge au survol | Retirer, Effacer, Réinitialiser, ✕ |
| Choix (un ou plusieurs) | `.filter`, `.choice-pill`, `.choice-card` | sélection = liseré bordeaux sur fond teinté | Mois en cours, Cumulable, B2C, Réseau |
| Sous-étape | `.hub-sub__tab` | onglet souligné | Offre · Objectifs de vente · Prix |

- Le bordeaux plein n'est **jamais** un état sélectionné.
- Les mêmes classes vont sur `<a>` (lien externe, suffixe ↗) et `<label>`
  (dépôt de fichier) : l'aspect suit le rôle, pas la balise.
- Pied de l'assistant : barre collée au bas de l'écran ; à gauche *Quitter
  sans enregistrer* puis *Enregistrer et quitter*, à droite *← Précédent*
  puis l'action principale, en dernier. « Précédent » n'apparaît pas à la
  première étape.

## Hors de ce passage

Le système `.btn` vaut pour tout le module, mais seul l'assistant a été
repris. Dans les autres écrans, `.filter.is-on` reste en bordeaux plein (dans
l'assistant, la règle est limitée par `.builder`). Les reprendre, c'est appliquer
le même tableau.
