// Montage d'une animation Lottie (.json) dans un conteneur DOM.
//
// Le lecteur (public/js/vendor/lottie.js, ~165 Ko) n'est chargé QU'À la
// première animation Lottie réellement diffusée : une balise <script> classique
// injectée une seule fois, dont la promesse est mémorisée. Tant qu'aucun
// élément Animation ne diffuse de .json, rien n'est téléchargé.
//
// Ce module est importé par renderer.js, qui tourne AUSSI côté serveur : il ne
// doit toucher au DOM que dans les fonctions, jamais au chargement.

let _loading = null;

function loadPlayer() {
  if (typeof document === 'undefined') return Promise.reject(new Error('hors navigateur'));
  if (globalThis.lottie) return Promise.resolve(globalThis.lottie);
  if (_loading) return _loading;
  _loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // Chemin relatif : l'app peut vivre sous un sous-chemin (/signage/).
    s.src = new URL('js/vendor/lottie.js', document.baseURI).toString();
    s.async = true;
    s.onload = () => (globalThis.lottie ? resolve(globalThis.lottie) : reject(new Error('lecteur Lottie illisible')));
    s.onerror = () => { _loading = null; reject(new Error('lecteur Lottie introuvable')); };
    document.head.appendChild(s);
  });
  return _loading;
}

// Monte (ou remonte) l'animation `url` dans `el`. Idempotent : appelé à chaque
// rendu — et l'aperçu de la régie rend à 60 images/s —, il ne refait le travail
// que si l'URL a changé.
export function mountLottie(el, url, fit) {
  if (!el || typeof document === 'undefined') return;
  if (!url) { destroyLottie(el); return; }
  // `fit` fait partie de la clé : changer le cadrage doit remonter l'animation,
  // la mise à l'échelle du SVG étant fixée à la création.
  const key = url + '|' + (fit === 'contain' ? 'contain' : 'cover');
  if (el.__sigLottieUrl === key) return;
  destroyLottie(el);
  el.__sigLottieUrl = key;
  loadPlayer().then((lottie) => {
    // L'élément a pu être démonté (ou changer d'animation) pendant le chargement.
    if (el.__sigLottieUrl !== key || !el.isConnected) return;
    el.__sigLottieAnim = lottie.loadAnimation({
      container: el, renderer: 'svg', loop: true, autoplay: true, path: url,
      // « Remplir » recadre (slice), « Adapter » montre tout (meet).
      rendererSettings: { preserveAspectRatio: fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice' },
    });
  }).catch(() => {
    // Lecteur indisponible : on le dit à l'écran plutôt que de laisser un trou.
    if (el.__sigLottieUrl !== url) return;
    el.textContent = 'Animation Lottie indisponible';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.font = '600 64px system-ui, sans-serif';
    el.style.color = 'rgba(35,34,32,0.45)';
  });
}

export function destroyLottie(el) {
  if (!el) return;
  if (el.__sigLottieAnim) { try { el.__sigLottieAnim.destroy(); } catch { /* déjà détruite */ } }
  el.__sigLottieAnim = null;
  el.__sigLottieUrl = '';
}
