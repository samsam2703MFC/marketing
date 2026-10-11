// Service worker des écrans, généré à la demande (GET /sw.js).
//
// Il garde la « coquille » des écrans — player.html, film.html, leur code,
// la CSS, les polices et les logos — pour qu'un écran redémarré SANS réseau
// rouvre sa page ; le film et ses fichiers, eux, sont dans IndexedDB
// (public/js/offline.js). Il ne touche ni à l'API ni aux fichiers uploadés.
//
// Sa version est l'empreinte (taille + date) des fichiers de la coquille :
// une livraison qui change le code change le service worker, et les écrans
// prennent la nouvelle version d'eux-mêmes.
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { createHash } from 'node:crypto';
// Décor écrit en dur dans le rendu (logos, fonds de catégorie) : la même
// liste que le cache des écrans.
import { STATIC_ASSETS } from '../public/js/assets.js';

const PAGES = ['player.html', 'film.html'];
const ENTRY_SCRIPTS = ['js/player.js', 'js/film.js'];
const EXTRA = ['js/vendor/lottie.js', ...STATIC_ASSETS];

// Modules importés (statiquement ou dynamiquement), de proche en proche.
function scriptClosure(publicDir, entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const file = join(publicDir, rel);
    if (!existsSync(file)) continue;
    seen.add(rel);
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      stack.push(normalize(join(dirname(rel), m[1])).replace(/\\/g, '/'));
    }
  }
  return [...seen];
}

// Polices et images citées par la CSS des pages.
function cssClosure(publicDir) {
  const out = [];
  const cssDir = join(publicDir, 'css');
  if (!existsSync(cssDir)) return out;
  for (const f of readdirSync(cssDir).filter((n) => n.endsWith('.css'))) {
    out.push(`css/${f}`);
    const src = readFileSync(join(cssDir, f), 'utf-8');
    for (const m of src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (/^(data:|https?:|\/)/.test(m[1])) continue;
      out.push(normalize(join('css', m[1])).replace(/\\/g, '/'));
    }
  }
  return out;
}

export function shellFiles(publicDir) {
  const files = new Set([...PAGES, ...scriptClosure(publicDir, ENTRY_SCRIPTS), ...cssClosure(publicDir), ...EXTRA]);
  return [...files].filter((f) => existsSync(join(publicDir, f))).sort();
}

export function serviceWorkerSource(publicDir) {
  const shell = shellFiles(publicDir);
  const hash = createHash('sha256');
  for (const f of shell) {
    const st = statSync(join(publicDir, f));
    hash.update(`${f}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
  }
  const version = hash.digest('hex').slice(0, 12);
  return `// Service worker des écrans — généré par server/sw.js (version ${version}).
const VERSION = ${JSON.stringify(version)};
const SHELL = ${JSON.stringify(shell)};
const CACHE = 'signage-shell-' + VERSION;
// Pages d'écran, avec ou sans « .html » (le serveur sert /film et /player).
const PAGE_ALIASES = { 'player': 'player.html', 'film': 'film.html' };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('signage-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (toujours la dernière version en ligne) ; la copie gardée
// sert si le réseau manque, traîne (navigation > 4 s) ou si le serveur est
// en panne (502 du proxy pendant un redémarrage, par exemple).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const scope = self.registration.scope;
  if (!req.url.startsWith(scope)) return;
  let rel = req.url.slice(scope.length).split(/[?#]/)[0];
  if (PAGE_ALIASES[rel]) rel = PAGE_ALIASES[rel];
  if (!SHELL.includes(rel)) return; // API, fichiers uploadés, régie : intouchés
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(rel);
    try {
      const net = fetch(req);
      const res = req.mode === 'navigate' && cached
        ? await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 4000))])
        : await net;
      if (res.ok || !cached) return res;
      return cached;
    } catch (e) {
      if (cached) return cached;
      throw e;
    }
  })());
});
`;
}
