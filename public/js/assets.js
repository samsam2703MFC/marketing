// Fichiers dont un écran a besoin pour jouer un snapshot — y compris hors
// ligne. UNE seule liste, partagée : le player et la visionneuse s'en servent
// pour leur cache local, le serveur pour le champ `media` des snapshots.
// Les data: URL (photos et vidéos importées en régie) voyagent DANS le
// snapshot : elles n'ont rien à télécharger et ne sont pas listées.
// Aucun import : ce module tourne aussi côté serveur.

// Décor susceptible d'apparaître quel que soit le film (logos, fonds de
// catégorie, pastille « nouveauté » par défaut).
export const STATIC_ASSETS = ['assets/logo.png', 'assets/logo-white.png', 'assets/cherry.png', 'assets/sweet-tart-big.png', 'assets/rhubarb.png'];

const isUrl = (u) => typeof u === 'string' && u.trim() !== '' && !/^(data|blob):/i.test(u.trim());

// URLs citées par un gabarit HTML : src, srcset, poster, href d'image SVG,
// url() CSS. Les variables encore non liées ({{ logo }}) sont ignorées.
export function htmlAssetUrls(src) {
  const s = String(src || '');
  const out = [];
  for (const m of s.matchAll(/\b(?:src|poster|data-src)\s*=\s*("|')([^"']+)\1/gi)) out.push(m[2]);
  for (const m of s.matchAll(/\bsrcset\s*=\s*("|')([^"']+)\1/gi)) {
    for (const part of m[2].split(',')) out.push(part.trim().split(/\s+/)[0]);
  }
  for (const m of s.matchAll(/\b(?:xlink:)?href\s*=\s*("|')([^"']+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#][^"']*)?)\1/gi)) out.push(m[2]);
  for (const m of s.matchAll(/url\(\s*("|'|)([^"')]+)\1\s*\)/gi)) out.push(m[2]);
  return out.map((u) => u.trim()).filter((u) => isUrl(u) && !u.includes('{{') && !u.startsWith('#'));
}

// Fichiers d'un module : exactement les champs que renderer.js affiche.
export function moduleAssets(m) {
  if (!m) return [];
  const out = [];
  const add = (u) => { if (isUrl(u)) out.push(u.trim()); };
  if (m.tag && m.tag.enabled) add(m.tag.img);
  for (const it of m.items || []) add(it && it.img);
  add(m.video);            // film, média ciblé (vidéo), vidéo surprise piochée
  add(m.mediaUrl);         // média ciblé (photo)
  add(m.animFile);         // animation « fichier »
  add(m.animBg);           // fond d'une animation « texte »
  add(m.catImg);           // illustration de catégorie
  if (m.campaign) add(m.campaign.image);
  if (m.bundle) add(m.bundle.img);     // visuel d'un bundle TFBuddy (choisi en régie)
  if (m.tfb) add(m.tfb.img);           // visuel d'une promotion TFBuddy (idem)
  if (m.type === 'html') for (const u of htmlAssetUrls(m.html)) add(u);
  // Film en scènes : les photos et vidéos de ses calques.
  for (const s of (m.type === 'scenes' && Array.isArray(m.scenes) ? m.scenes : [])) {
    for (const l of (s && s.layers) || []) if (l && l.kind === 'photo') add(l.src);
  }
  return out;
}

// Tous les fichiers d'un snapshot, sans doublon, décor compris.
export function snapshotAssets(snap) {
  const set = new Set(STATIC_ASSETS);
  for (const m of (snap && snap.modules) || []) for (const u of moduleAssets(m)) set.add(u);
  return [...set];
}
