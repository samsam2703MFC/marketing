// Stockage objet compatible S3 — la médiathèque sur OVHcloud Object Storage.
// Zéro dépendance : signature AWS v4 (« AWS4-HMAC-SHA256 ») faite ici, requêtes
// par node:http(s) pour garder la main sur Content-Length (un envoi en flux
// vers S3 doit annoncer sa taille : pas de « chunked »).
//
// Réglages : variables d'environnement, posées par la livraison dans
// /etc/signage/signage.env (root, 0600) depuis les secrets GitHub — jamais dans
// la base (le miroir MySQL la recopie) ni dans le dépôt :
//   SIG_S3_ENDPOINT    https://s3.<région>.io.cloud.ovh.net (OVHcloud)
//   SIG_S3_BUCKET      nom du bucket
//   SIG_S3_ACCESS_KEY  clé d'accès de l'utilisateur S3
//   SIG_S3_SECRET_KEY  clé secrète
//   SIG_S3_REGION      facultatif : déduite de l'adresse OVH (gra, sbg, de…)
//   SIG_S3_PREFIX      facultatif : dossier dans le bucket (défaut « media/ »)
//   SIG_S3_PATH_STYLE  1 = adresse « endpoint/bucket/clé » (défaut : le bucket
//                      en sous-domaine, la forme documentée par OVHcloud)
import http from 'node:http';
import https from 'node:https';
import { createHash, createHmac } from 'node:crypto';

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
export const EMPTY_SHA256 = sha256hex('');

// Encodage RFC 3986 attendu par S3 (tout sauf A-Z a-z 0-9 - _ . ~) ; dans un
// chemin, les « / » restent.
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => String(p).split('/').map(enc).join('/');

export function s3Config(env = process.env) {
  const endpoint = String(env.SIG_S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  let region = String(env.SIG_S3_REGION || '').trim().toLowerCase();
  if (!region) {
    const m = /^https?:\/\/s3\.([a-z0-9-]+)\.(?:io|perf)\.cloud\.ovh\.(?:net|us)(?::\d+)?$/i.exec(endpoint);
    region = m ? m[1].toLowerCase() : 'us-east-1';
  }
  let prefix = env.SIG_S3_PREFIX == null ? 'media/' : String(env.SIG_S3_PREFIX).trim().replace(/^\/+/, '');
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  return {
    endpoint,
    bucket: String(env.SIG_S3_BUCKET || '').trim(),
    accessKey: String(env.SIG_S3_ACCESS_KEY || '').trim(),
    secretKey: String(env.SIG_S3_SECRET_KEY || ''),
    region,
    prefix,
    pathStyle: String(env.SIG_S3_PATH_STYLE || '') === '1',
  };
}
export const s3Configured = (c = s3Config()) => !!(c.endpoint && c.bucket && c.accessKey && c.secretKey);

// Pour l'écran de la régie : jamais les clés.
export function s3PublicConfig(c = s3Config()) {
  let host = '';
  try { host = new URL(c.endpoint).host; } catch { /* adresse invalide */ }
  return { configured: s3Configured(c), host, bucket: c.bucket, region: c.region, prefix: c.prefix, pathStyle: c.pathStyle };
}

// Hôte et chemin d'un objet (clé '' = le bucket lui-même).
export function s3Target(c, key = '') {
  const u = new URL(c.endpoint);
  if (c.pathStyle) return { protocol: u.protocol, host: u.host, path: `/${enc(c.bucket)}/${key ? encPath(key) : ''}` };
  return { protocol: u.protocol, host: `${c.bucket}.${u.host}`, path: `/${key ? encPath(key) : ''}` };
}

const amzDates = (now) => {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate: iso, day: iso.slice(0, 8) };
};
const canonicalQuery = (query) => Object.entries(query || {})
  .map(([k, v]) => [enc(k), enc(v == null ? '' : v)])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  .map(([k, v]) => `${k}=${v}`)
  .join('&');
function signingKey(secret, day, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
}
function signature(c, { method, path, query, headers, payloadHash, amzDate, day }) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, path, canonicalQuery(query), canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  return { sig: createHmac('sha256', signingKey(c.secretKey, day, c.region)).update(toSign).digest('hex'), signedHeaders, scope };
}

// En-têtes signés d'une requête (exporté pour les tests, sur les exemples de
// la documentation AWS). `headers` : ceux à signer en plus de host et x-amz-*.
export function signHeaders(c, { method, key = '', query = {}, headers = {}, payloadHash = EMPTY_SHA256, now = new Date() }) {
  const t = s3Target(c, key);
  const { amzDate, day } = amzDates(now);
  const h = { host: t.host, ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const { sig, signedHeaders, scope } = signature(c, { method, path: t.path, query, headers: h, payloadHash, amzDate, day });
  return {
    target: t,
    headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope},SignedHeaders=${signedHeaders},Signature=${sig}` },
  };
}

// URL présignée (lecture ou dépôt direct), valable `expires` secondes.
export function presignUrl(c, { method = 'GET', key, expires = 3600, now = new Date() }) {
  const t = s3Target(c, key);
  const { amzDate, day } = amzDates(now);
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.accessKey}/${day}/${c.region}/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const { sig } = signature(c, { method, path: t.path, query, headers: { host: t.host }, payloadHash: 'UNSIGNED-PAYLOAD', amzDate, day });
  return `${t.protocol}//${t.host}${t.path}?${canonicalQuery(query)}&X-Amz-Signature=${sig}`;
}

export class S3Error extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}
// Message lisible d'une réponse d'erreur S3 (<Error><Code>…</Code><Message>…</Message>).
const xmlTag = (xml, tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml || ''); return m ? m[1] : ''; };
async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

// Requête brute : rend la réponse (flux) sans la lire. `body` : Buffer/chaîne
// (empreinte calculée) ou flux lisible avec `length` (charge non signée).
// `untimedBody` : une fois les en-têtes reçus, plus de délai d'inactivité (un
// objet relayé à un écran lent ne doit pas être coupé en route).
export function s3Request(c, method, key = '', { query = {}, headers = {}, body = null, length = null, timeoutMs = 30000, untimedBody = false } = {}) {
  return new Promise((resolve, reject) => {
    const stream = body && typeof body.pipe === 'function';
    const buf = body == null || stream ? null : (Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    const payloadHash = stream ? 'UNSIGNED-PAYLOAD' : sha256hex(buf || '');
    const signed = signHeaders(c, { method, key, query, headers, payloadHash });
    const t = signed.target;
    const qs = canonicalQuery(query);
    const outHeaders = { ...signed.headers };
    delete outHeaders.host;
    if (buf) outHeaders['content-length'] = buf.length;
    else if (stream) outHeaders['content-length'] = length;
    else if (method === 'PUT' || method === 'POST') outHeaders['content-length'] = 0;
    const lib = t.protocol === 'http:' ? http : https;
    const [hostname, port] = t.host.split(':');
    const req = lib.request({ method, hostname, port: port || undefined, path: t.path + (qs ? `?${qs}` : ''), headers: { host: t.host, ...outHeaders } }, (res) => {
      if (untimedBody) req.setTimeout(0);
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new S3Error(`stockage S3 : pas de réponse en ${Math.round(timeoutMs / 1000)} s`)));
    req.on('error', (e) => reject(e instanceof S3Error ? e : new S3Error(`stockage S3 injoignable (${e.code || e.message})`)));
    if (stream) {
      body.on('error', (e) => req.destroy(e));
      // Envoi du navigateur interrompu : on coupe aussitôt vers le stockage.
      if ('complete' in body) body.once('close', () => { if (!body.complete) req.destroy(new S3Error('envoi interrompu avant la fin du fichier')); });
      body.pipe(req);
    } else req.end(buf || undefined);
  });
}
// Même requête, réponse lue ; une erreur S3 devient une S3Error lisible.
export async function s3Call(c, method, key = '', opts = {}) {
  const res = await s3Request(c, method, key, opts);
  const body = await readAll(res);
  if (res.statusCode >= 300 && !(opts.ok || []).includes(res.statusCode)) {
    const xml = body.toString('utf8');
    const code = xmlTag(xml, 'Code');
    const msg = xmlTag(xml, 'Message');
    throw new S3Error(`stockage S3 : HTTP ${res.statusCode}${code ? ` ${code}` : ''}${msg ? ` — ${msg}` : ''}`, res.statusCode, code);
  }
  return { status: res.statusCode, headers: res.headers, body };
}

// ---- opérations utiles à la médiathèque --------------------------------------
export const objectKey = (c, filename) => `${c.prefix}${filename}`;
export function putObject(c, key, body, { contentType = 'application/octet-stream', length = null } = {}) {
  return s3Call(c, 'PUT', key, { body, length, headers: { 'content-type': contentType }, timeoutMs: 120000 });
}
export async function headObject(c, key) {
  const r = await s3Call(c, 'HEAD', key, { ok: [404] });
  return r.status === 404 ? null : { size: Number(r.headers['content-length'] || 0), etag: r.headers.etag || '', type: r.headers['content-type'] || '' };
}
export const deleteObject = (c, key) => s3Call(c, 'DELETE', key, { ok: [404] });
// Le bucket répond-il, avec ces clés ? Une liste d'un objet sous le préfixe.
export async function checkBucket(c) {
  const r = await s3Call(c, 'GET', '', { query: { 'list-type': '2', 'max-keys': '1', prefix: c.prefix } });
  return { ok: true, count: Number(xmlTag(r.body.toString('utf8'), 'KeyCount') || 0) };
}
