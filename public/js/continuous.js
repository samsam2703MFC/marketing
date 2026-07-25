// Configuration du mode « continu » — SOURCE UNIQUE, partagée par le serveur
// (server/db.js) et la régie (public/js/app.js) pour qu'elles ne divergent
// jamais. JS pur (aucune dépendance Node ni navigateur) : importable des deux
// côtés. Ajouter un paramètre ici le rend disponible partout d'un coup.
//
// Le film n'est plus une séquence figée mais une recette : la boucle est
// composée en direct depuis le catalogue + saisons + moments + tags.
export function continuousDefaults() {
  return {
    source: 'saison',        // 'saison' | 'categories' (= tout sauf) | 'tout'
    categories: [],          // ids de catégories EXCLUES si source === 'categories'
    catsInclude: [],         // liste BLANCHE de catégories (zones/groupes d'écrans) : ne garder que celles-ci

    perMoment: true,         // filtrer les produits par période de vente (moment)
    order: 'catalogue',      // 'catalogue' | 'aleatoire'
    prodDur: 6,              // durée d'une fiche produit (s)
    clipDur: 12,             // durée d'un clip vidéo (s)
    maxItems: 12,            // nb max de slots dans la boucle
    // Ratios « 1 : N » par type d'élément (0 = jamais).
    ratios: { liaison: 5, produitSeul: 6, media: 3, animation: 0, surprise: 8 },
    refresh: 'moment',       // 'moment' (au changement moment/saison) | 'minutes'
    refreshMin: 10,          // recomposition toutes les N minutes si refresh==='minutes'
    fallback: 'tout',        // 'tout' | 'aucun' si rien en saison/moment
    exceptionFilms: [],      // playlists figées jouées EN PLUS à chaque boucle (plusieurs)
  };
}

export function normContinuous(c) {
  const d = continuousDefaults();
  c = (c && typeof c === 'object') ? c : {};
  const num = (v, fb, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
  const rr = (c.ratios && typeof c.ratios === 'object') ? c.ratios : {};
  return {
    source: ['saison', 'categories', 'tout'].includes(c.source) ? c.source : d.source,
    categories: Array.isArray(c.categories) ? c.categories.map(String) : [],
    catsInclude: Array.isArray(c.catsInclude) ? c.catsInclude.map(String).filter(Boolean) : [],
    perMoment: c.perMoment !== false,
    order: c.order === 'aleatoire' ? 'aleatoire' : 'catalogue',
    prodDur: num(c.prodDur, d.prodDur, 2, 60),
    clipDur: num(c.clipDur, d.clipDur, 2, 120),
    maxItems: num(c.maxItems, d.maxItems, 4, 40),
    ratios: {
      liaison: num(rr.liaison, d.ratios.liaison, 0, 99),
      produitSeul: num(rr.produitSeul, d.ratios.produitSeul, 0, 99),
      media: num(rr.media, d.ratios.media, 0, 99),
      animation: num(rr.animation, d.ratios.animation, 0, 99),
      surprise: num(rr.surprise, d.ratios.surprise, 0, 99),
    },
    refresh: c.refresh === 'minutes' ? 'minutes' : 'moment',
    refreshMin: num(c.refreshMin, d.refreshMin, 1, 240),
    fallback: c.fallback === 'aucun' ? 'aucun' : 'tout',
    // Plusieurs playlists d'exception possibles. Compat : ancien champ unique.
    exceptionFilms: Array.isArray(c.exceptionFilms) ? c.exceptionFilms.map(String).filter(Boolean)
      : (c.exceptionFilm ? [String(c.exceptionFilm)] : []),
  };
}
