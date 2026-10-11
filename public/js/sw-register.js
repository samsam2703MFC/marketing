// Service worker des écrans (player, liens de diffusion) : il garde la page
// elle-même et son code, pour qu'un écran redémarré SANS réseau rejoue son
// cache. Le navigateur ne l'autorise qu'en https (ou sur localhost) : en http,
// on ne fait rien — le cache IndexedDB tient quand même les coupures page
// ouverte.
export function registerOfflineShell() {
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) return false;
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Nouvelle version du code après une livraison : vérifiée toutes les heures.
    setInterval(() => { reg.update().catch(() => {}); }, 3600000);
  }).catch(() => {});
  // Une nouvelle version a pris la main : on recharge (le film repart du cache
  // local en une seconde). La toute première prise de contrôle, elle, ne
  // change rien au code qui tourne : on la laisse passer.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  return true;
}
