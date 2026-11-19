// Cache hors ligne des écrans (player et liens de diffusion) — IndexedDB.
//
// Un écran garde sur son disque le dernier film reçu (le snapshot) ET chaque
// fichier qu'il affiche (photos, vidéos, animations). Au démarrage il rejoue
// ce cache tout de suite, réseau ou pas ; il ne bascule sur une nouvelle
// version qu'une fois tous ses fichiers réellement téléchargés.
//
// IndexedDB fonctionne aussi en http (pas le Cache API ni le service worker) :
// en http, l'écran tient une coupure réseau page ouverte ; en https, le
// service worker garde en plus la page elle-même (redémarrage hors ligne).
//
// Les fichiers sont rejoués via des URL locales (blob:) ; l'extension d'origine
// est gardée après « # » (renderer.js en déduit le lecteur d'une animation).
import { snapshotAssets } from './assets.js';

const DB_NAME = 'signage-offline';
const DB_VERSION = 1;
const KEEP_DAYS = 7; // un film enregistré plus vieux ne retient plus ses fichiers

export const offlineSupported = typeof indexedDB !== 'undefined';

let _db = null;
function openDb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { _db = null; reject(req.error); };
  });
  return _db;
}
function done(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function store(name, mode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

// URL absolue : la même clé que l'on écrive « media/x.mp4 » ou l'URL complète.
const abs = (u) => new URL(u, document.baseURI).href;
const sameOrigin = (u) => new URL(u, document.baseURI).origin === location.origin;
const fileName = (u) => {
  const p = new URL(u, document.baseURI).pathname;
  return decodeURIComponent(p.slice(p.lastIndexOf('/') + 1)) || 'fichier';
};

// ---- film (snapshot) --------------------------------------------------------
export async function loadSnapshot(key) {
  if (!offlineSupported) return null;
  try { return (await done((await store('kv', 'readonly')).get('snap:' + key))) || null; }
  catch { return null; }
}
export async function saveSnapshot(key, snap, meta = {}) {
  if (!offlineSupported) return false;
  try { await done((await store('kv', 'readwrite')).put({ snap, meta, savedAt: Date.now() }, 'snap:' + key)); return true; }
  catch { return false; }
}

// ---- fichiers -----------------------------------------------------------------
async function getAsset(url) {
  try { return (await done((await store('assets', 'readonly')).get(abs(url)))) || null; }
  catch { return null; }
}
async function putAsset(url, rec) {
  await done((await store('assets', 'readwrite')).put(rec, abs(url)));
}

// Télécharge (ou revalide) chaque fichier. Résultat par fichier :
//   ok       → en cache et à jour (ou serveur injoignable mais copie présente)
//   missing  → le serveur ne l'a pas (404/410) et aucune copie locale
//   external → autre domaine qui refuse la lecture (CORS) : affiché en ligne,
//              jamais mis en cache
//   error    → réseau ou serveur en panne, aucune copie : à retenter
// onProgress({ done, total }) après chaque fichier.
export async function syncAssets(urls, { onProgress, concurrency = 3 } = {}) {
  const list = [...new Set(urls.filter(Boolean))];
  const out = { total: list.length, ok: [], missing: [], external: [], error: [], quota: false };
  let n = 0;
  const one = async (u) => {
    const prev = offlineSupported ? await getAsset(u) : null;
    let status = 'error';
    try {
      const headers = {};
      if (prev && prev.etag && sameOrigin(u)) headers['if-none-match'] = prev.etag;
      const res = await fetch(abs(u), { headers, cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 304 && prev) status = 'ok';
      else if (res.ok) {
        const blob = await res.blob();
        if (offlineSupported) {
          try {
            await putAsset(u, { blob, type: blob.type || res.headers.get('content-type') || '', size: blob.size, etag: res.headers.get('etag') || '', savedAt: Date.now() });
          } catch (e) {
            if (e && e.name === 'QuotaExceededError') out.quota = true;
            throw e;
          }
        }
        status = 'ok';
      } else if (res.status === 404 || res.status === 410) status = prev ? 'ok' : 'missing';
      else status = prev ? 'ok' : 'error';
    } catch {
      if (prev) status = 'ok';
      else if (!sameOrigin(u)) {
        // Autre domaine : joignable mais sans CORS → « externe » ; sinon réseau.
        try { await fetch(abs(u), { mode: 'no-cors', cache: 'no-store' }); status = 'external'; }
        catch { status = 'error'; }
      }
    }
    out[status].push(u);
    n += 1;
    if (onProgress) onProgress({ done: n, total: list.length });
  };
  const queue = list.slice();
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await one(queue.shift());
  });
  await Promise.all(workers);
  if (!list.length && onProgress) onProgress({ done: 0, total: 0 });
  return out;
}

// Combien des fichiers d'un film sont réellement sur le disque.
export async function cacheStats(snap) {
  const urls = snapshotAssets(snap);
  let cached = 0;
  for (const u of urls) if (await getAsset(u)) cached += 1;
  return { total: urls.length, cached };
}

// ---- rejouer depuis le cache ---------------------------------------------------
const live = new Map(); // URL absolue → URL locale (blob:…#nom)

async function localUrl(u) {
  const a = abs(u);
  if (live.has(a)) return live.get(a);
  const rec = await getAsset(a);
  if (!rec || !rec.blob) return null;
  const lu = URL.createObjectURL(rec.blob) + '#' + fileName(a);
  live.set(a, lu);
  return lu;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Copie du snapshot où chaque fichier en cache pointe vers sa copie locale.
// Les fichiers absents gardent leur URL (affichés en ligne s'il y a réseau).
export async function resolveSnapshot(snap) {
  if (!snap || !offlineSupported) return snap;
  const map = new Map();
  for (const u of snapshotAssets(snap)) {
    const lu = await localUrl(u);
    if (lu) map.set(u, lu);
  }
  if (!map.size) return snap;
  const walk = (v) => {
    if (typeof v === 'string') return map.has(v) ? map.get(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  const copy = walk(snap);
  // Gabarits HTML : les URLs sont DANS le code — remplacées seulement entre
  // délimiteurs (guillemets, parenthèses), jamais au milieu d'une autre URL.
  for (const m of copy.modules || []) {
    if (m.type !== 'html' || !m.html) continue;
    let s = m.html;
    for (const [u, lu] of map) s = s.replace(new RegExp(`(["'(\\s,])${esc(u)}(?=["')\\s,])`, 'g'), `$1${lu}`);
    m.html = s;
  }
  return copy;
}

// Libère les URL locales qui ne servent plus (fichiers hors du film courant).
export function releaseExcept(snap) {
  const keep = new Set(snapshotAssets(snap).map(abs));
  for (const [a, lu] of live) {
    if (keep.has(a)) continue;
    URL.revokeObjectURL(lu.split('#')[0]);
    live.delete(a);
  }
}

// Supprime du disque les fichiers qu'aucun film récent de cet écran n'utilise.
export async function gcAssets() {
  if (!offlineSupported) return 0;
  try {
    const kv = await store('kv', 'readonly');
    const keys = await done(kv.getAllKeys());
    const keep = new Set();
    const limit = Date.now() - KEEP_DAYS * 86400000;
    for (const k of keys) {
      if (!String(k).startsWith('snap:')) continue;
      const rec = await done((await store('kv', 'readonly')).get(k));
      if (!rec || rec.savedAt < limit) continue;
      for (const u of snapshotAssets(rec.snap)) keep.add(abs(u));
    }
    const st = await store('assets', 'readwrite');
    const all = await done(st.getAllKeys());
    let removed = 0;
    for (const k of all) if (!keep.has(k)) { st.delete(k); removed += 1; }
    return removed;
  } catch { return 0; }
}

// Stockage « persistant » : le navigateur ne vide plus ce cache sous pression.
export async function requestPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch { return false; }
}
export async function storageInfo() {
  const info = { persisted: false, usage: 0, quota: 0 };
  try {
    if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage || 0; info.quota = e.quota || 0;
    }
  } catch { /* indisponible */ }
  return info;
}
