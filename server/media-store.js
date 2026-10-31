// Médiathèque : où vivent les fichiers. Sans stockage objet configuré, dans
// public/media/ du serveur (comme avant) ; avec OVHcloud Object Storage
// (secrets → SIG_S3_*, voir server/s3.js), dans le bucket. L'adresse reste
// media/<fichier> dans les deux cas : la régie relaie l'objet du bucket
// (lecture par morceaux, ETag), si bien que le cache hors-ligne des écrans,
// l'aperçu de la régie et l'espace agence ne changent pas, et que le bucket
// reste privé (aucune règle CORS, aucun accès public à ouvrir).
import { createReadStream, createWriteStream, existsSync, statSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { s3Config, s3Configured, s3PublicConfig, objectKey, putObject, deleteObject, headObject, checkBucket, s3Request } from './s3.js';
import { loadMedia, mediaByFilename, setMediaStorage } from './db.js';

export const MEDIA_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.ogg': 'video/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};
export const mediaType = (filename) => MEDIA_TYPES[extname(String(filename)).toLowerCase()] || 'application/octet-stream';
// Taille maximale d'un envoi (Mo) ; une vidéo 4K d'une minute pèse ~400 Mo.
export const mediaMaxBytes = () => (parseInt(process.env.SIG_MEDIA_MAX_MB, 10) || 4096) * 1024 * 1024;
export const mediaStorage = () => (s3Configured() ? 's3' : 'local');

// Range un nouveau fichier : flux (avec sa taille annoncée) ou Buffer.
// Rend { storage, size, ctype }. Rien n'est enregistré si l'envoi échoue.
export async function storeMediaFile(mediaDir, filename, body, { length = null } = {}) {
  const ctype = mediaType(filename);
  const size = Buffer.isBuffer(body) ? body.length : Number(length);
  if (s3Configured()) {
    const c = s3Config();
    await putObject(c, objectKey(c, filename), body, { contentType: ctype, length: size });
    return { storage: 's3', size, ctype };
  }
  mkdirSync(mediaDir, { recursive: true });
  const final = join(mediaDir, filename);
  const tmp = `${final}.part-${randomBytes(4).toString('hex')}`;
  try {
    await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(tmp));
    const got = statSync(tmp).size;
    if (Number.isFinite(size) && got !== size) throw new Error(`envoi interrompu (${got} octets reçus sur ${size})`);
    renameSync(tmp, final);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* rien à nettoyer */ }
    throw e;
  }
  return { storage: 'local', size: statSync(final).size, ctype };
}

// Un nom libre : « nom.mp4 », sinon « nom-2.mp4 », « nom-3.mp4 »…
export function freeMediaName(mediaDir, filename) {
  const ext = extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  const taken = (n) => !!mediaByFilename(n) || existsSync(join(mediaDir, n));
  if (!taken(filename)) return filename;
  for (let i = 2; i < 1000; i++) { const n = `${base}-${i}${ext}`; if (!taken(n)) return n; }
  return `${base}-${Date.now().toString(36)}${ext}`;
}

// media/<fichier> d'un média rangé dans le bucket : la régie relaie l'objet —
// Range, If-None-Match et If-Modified-Since transmis ; type, taille, ETag et
// plage rendus. Rend false si ce n'est pas un média du bucket (fichier local).
export async function serveStoredMedia(req, res, pathname) {
  if (!pathname.startsWith('/media/')) return false;
  let filename;
  try { filename = decodeURIComponent(pathname.slice('/media/'.length)); } catch { return false; }
  if (!filename || filename.includes('/') || filename.includes('\\')) return false;
  const row = mediaByFilename(filename);
  if (!row || row.storage !== 's3') return false;
  const text = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' }); res.end(msg); return true; };
  if (!s3Configured()) return text(503, 'média rangé sur OVHcloud, stockage non configuré sur ce serveur');
  const c = s3Config();
  const fwd = {};
  for (const h of ['range', 'if-range', 'if-none-match', 'if-modified-since']) if (req.headers[h]) fwd[h] = req.headers[h];
  let up;
  try { up = await s3Request(c, req.method === 'HEAD' ? 'HEAD' : 'GET', objectKey(c, filename), { headers: fwd, timeoutMs: 60000, untimedBody: true }); }
  catch (e) { return text(502, String(e.message || e)); }
  const st = up.statusCode;
  if (st === 404) { up.resume(); return text(404, '404 — absent du stockage'); }
  if (st >= 400 && st !== 416 && st !== 412) { up.resume(); return text(502, `stockage S3 : HTTP ${st}`); }
  const headers = { 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
  for (const h of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) if (up.headers[h]) headers[h] = up.headers[h];
  if (!headers['content-type'] || /octet-stream/.test(headers['content-type'])) headers['content-type'] = row.ctype || mediaType(filename);
  res.writeHead(st, headers);
  if (req.method === 'HEAD' || st === 304) { up.resume(); res.end(); return true; }
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  up.pipe(res);
  return true;
}

// Supprime le fichier d'un média : dans le bucket s'il y est, et la copie
// locale s'il en reste une.
export async function removeMediaFile(mediaDir, row) {
  if (row.storage === 's3') {
    if (!s3Configured()) throw new Error('média rangé sur OVHcloud, stockage non configuré sur ce serveur : rien n’est supprimé');
    const c = s3Config();
    await deleteObject(c, objectKey(c, row.filename));
  }
  const f = join(mediaDir, row.filename);
  if (f.startsWith(mediaDir) && existsSync(f)) { try { unlinkSync(f); } catch { /* déjà supprimé */ } }
}

// ---- État du stockage, vérification, envoi des médias locaux vers OVH --------
let lastCheck = null;
export async function checkMediaStorage() {
  const at = new Date().toISOString();
  if (!s3Configured()) { lastCheck = { ok: false, at, error: 'stockage OVH non configuré' }; return lastCheck; }
  try { const r = await checkBucket(s3Config()); lastCheck = { ok: true, at, objects: r.count }; }
  catch (e) { lastCheck = { ok: false, at, error: String(e.message || e) }; }
  return lastCheck;
}

let job = null;
// Copie chaque média local vers le bucket, vérifie la taille relue, puis le
// média est servi depuis OVH. La copie locale reste sur le serveur (rien n'est
// effacé) : on peut la retirer à la main une fois le bucket vérifié.
export function startMediaMigration(mediaDir, onDone = () => {}) {
  if (job && job.running) return job;
  if (!s3Configured()) throw new Error('stockage OVH non configuré');
  const c = s3Config();
  const todo = loadMedia().filter((m) => m.storage !== 's3' && existsSync(join(mediaDir, m.filename)));
  job = { running: true, total: todo.length, done: 0, moved: 0, bytes: 0, errors: [], startedAt: new Date().toISOString() };
  const run = job;
  (async () => {
    for (const m of todo) {
      const f = join(mediaDir, m.filename);
      try {
        const size = statSync(f).size;
        const key = objectKey(c, m.filename);
        await putObject(c, key, createReadStream(f), { contentType: mediaType(m.filename), length: size });
        const h = await headObject(c, key);
        if (!h || h.size !== size) throw new Error(`taille relue ${h ? h.size : 'absente'} au lieu de ${size}`);
        setMediaStorage(m.id, 's3', mediaType(m.filename));
        run.moved++;
        run.bytes += size;
      } catch (e) { run.errors.push(`${m.filename} : ${e.message || e}`); }
      run.done++;
    }
    run.running = false;
    run.endedAt = new Date().toISOString();
    onDone(run);
  })();
  return job;
}

export function mediaStorageStatus(mediaDir) {
  const list = loadMedia();
  const local = list.filter((m) => m.storage !== 's3');
  return {
    mode: mediaStorage(),
    s3: s3PublicConfig(),
    check: lastCheck,
    maxMb: Math.round(mediaMaxBytes() / 1048576),
    counts: {
      total: list.length,
      s3: list.length - local.length,
      local: local.length,
      localOnDisk: local.filter((m) => existsSync(join(mediaDir, m.filename))).length,
    },
    job,
  };
}
