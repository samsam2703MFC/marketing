// Serveur HTTP du CMS signage — fichiers statiques (back office + player) + API.
// Zéro dépendance : node:http + node:sqlite (Node ≥ 22.5).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './db.js';
import { handleApi } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 15 * 1024 * 1024; // photos importées en dataURL

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
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/player') pathname = '/player.html';
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — introuvable');
    return;
  }
  const ext = extname(file).toLowerCase();
  const longCache = ['.png', '.jpg', '.jpeg', '.webp', '.ttf', '.otf', '.woff', '.woff2'].includes(ext);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': longCache ? 'public, max-age=86400' : 'no-cache',
  });
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
  selfBase(req) {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    return `http://${host}`;
  },
};

export function createServer() {
  getDb(); // ouvre + migre + seed au démarrage
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/v1/')) {
        await handleApi(req, res, url, readBodyFactory(req), ctx);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url.pathname);
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
  createServer().listen(PORT, HOST, () => {
    console.log(`▶ Signage CMS — back office : http://localhost:${PORT}/`);
    console.log(`  player d'exemple        : http://localhost:${PORT}/player.html?id=p1&token=plyr_9F3A2C7E`);
    console.log(`  API                     : http://localhost:${PORT}/api/v1/health`);
    console.log(`  base SQLite (tables sig_) : ${DB_PATH}`);
  });
}
