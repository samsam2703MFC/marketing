// Serveur HTTP du CMS signage — fichiers statiques (back office + player) + API.
// Zéro dépendance : node:http + node:sqlite (Node ≥ 22.5).
//
// Peut être servi sous un sous-chemin (ex. reverse proxy Apache/Nginx sur
// http://185.180.206.46/pwa_consultant/signage/) : définir BASE_PATH=/pwa_consultant/signage.
// Le serveur accepte alors les requêtes avec ou sans le préfixe (proxy qui
// réécrit ou non), et le cookie de session est limité à ce chemin.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './db.js';
import { handleApi } from './api.js';
import { serviceWorkerSource } from './sw.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 25 * 1024 * 1024; // photos + vidéos importées en dataURL

const rawBase = (process.env.BASE_PATH || '').trim().replace(/^\/+|\/+$/g, '');
const BASE_PATH = rawBase ? `/${rawBase}` : '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  // Vidéos (médiathèque agence, vidéos surprise, animations) : sans leur vrai
  // type, certains lecteurs refusent de les jouer depuis le cache des écrans.
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  // Service worker des écrans : généré (liste + version de la coquille).
  if (pathname === '/sw.js') {
    const body = Buffer.from(serviceWorkerSource(PUBLIC_DIR));
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/player') pathname = '/player.html';
  if (pathname === '/film') pathname = '/film.html';
  if (pathname === '/report') pathname = '/report.html';
  if (pathname === '/agence') pathname = '/agence.html';
  if (pathname === '/magasin') pathname = '/magasin.html';
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — introuvable');
    return;
  }
  const ext = extname(file).toLowerCase();
  const st = statSync(file);
  const longCache = ['.png', '.jpg', '.jpeg', '.webp', '.ttf', '.otf', '.woff', '.woff2'].includes(ext);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': longCache ? 'public, max-age=86400' : 'no-cache',
    etag,
    'last-modified': st.mtime.toUTCString(),
    'accept-ranges': 'bytes',
  };
  // Revalidation : le cache des écrans (et du navigateur) redemande chaque
  // fichier avec son ETag ; inchangé → 304, rien n'est retéléchargé.
  const inm = req.headers['if-none-match'];
  const ims = Date.parse(req.headers['if-modified-since'] || '');
  if ((inm && inm.split(/\s*,\s*/).includes(etag)) || (!inm && ims && ims >= Math.floor(st.mtimeMs / 1000) * 1000)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  // Lecture partielle (Range) : une balise <video> avance dans le fichier
  // sans le télécharger en entier.
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && (r[1] !== '' || r[2] !== '') && st.size > 0) {
    let start; let end;
    if (r[1] === '') { start = Math.max(0, st.size - parseInt(r[2], 10)); end = st.size - 1; } // bytes=-N : les N derniers
    else { start = parseInt(r[1], 10); end = r[2] === '' ? st.size - 1 : Math.min(parseInt(r[2], 10), st.size - 1); }
    if (start > end || start >= st.size) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${st.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

function readBodyFactory(req) {
  return () => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

const ctx = {
  publicDir: PUBLIC_DIR,
  basePath: BASE_PATH,
  cookiePath: BASE_PATH ? `${BASE_PATH}/` : '/',
  localBase: `http://127.0.0.1:${PORT}`,
  // Les auto-tests de déploiement bouclent sur le serveur lui-même (127.0.0.1),
  // indépendamment du reverse proxy : on valide la pile HTTP réelle du CMS.
  selfBase() { return this.localBase; },
};

// Réduit le chemin entrant à un chemin interne (sans BASE_PATH).
function internalPath(pathname) {
  if (BASE_PATH) {
    if (pathname === BASE_PATH) return null; // → redirection vers BASE_PATH/
    if (pathname.startsWith(`${BASE_PATH}/`)) pathname = pathname.slice(BASE_PATH.length) || '/';
  }
  if (!pathname.startsWith('/api/v1/')) {
    const i = pathname.indexOf('/api/v1/');
    if (i > 0) pathname = pathname.slice(i); // proxy qui transmet un préfixe non configuré
  }
  return pathname;
}

export function createServer() {
  getDb(); // ouvre + migre + seed au démarrage
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      const pathname = internalPath(url.pathname);
      if (pathname === null) {
        res.writeHead(301, { location: `${BASE_PATH}/${url.search || ''}` });
        res.end();
        return;
      }
      if (pathname.startsWith('/api/v1/')) {
        await handleApi(req, res, url, readBodyFactory(req), ctx, pathname);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, pathname);
      } else {
        res.writeHead(405, { 'content-type': 'text/plain' });
        res.end('405');
      }
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    ctx.localBase = `http://127.0.0.1:${server.address().port}`;
    const pub = BASE_PATH ? ` (monté publiquement sous ${BASE_PATH}/)` : '';
    console.log(`▶ Signage CMS — back office : http://localhost:${PORT}${BASE_PATH}/${pub}`);
    console.log(`  player d'exemple        : http://localhost:${PORT}${BASE_PATH}/player.html?id=p1&token=plyr_9F3A2C7E`);
    console.log(`  API                     : http://localhost:${PORT}${BASE_PATH}/api/v1/health`);
    console.log(`  base SQLite (tables sig_) : ${DB_PATH}`);
    console.log(`  compte back office : admin (mot de passe : SIG_ADMIN_PASSWORD, défaut « signage »)`);
    // Miroir MySQL (best-effort) : réplique les tables sig_* dans la base PWA
    // pour consultation dans phpMyAdmin. Sans base cible, reste silencieux.
    import('./mirror.js').then(({ syncMirror }) => syncMirror().then((r) => {
      if (r && r.ok) console.log(`  miroir MySQL : ${r.tables} tables · ${r.rows} lignes → base « ${r.db} »`);
    }).catch(() => {})).catch(() => {});
  });
}
