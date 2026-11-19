// Éditeur du film — médias pris hors de la régie.
//
// Le tiroir « Médiathèque » de l'éditeur (assistant vidéo de campagne, étape 6)
// propose quatre sources :
//   1. la médiathèque COMMUNE du Marketing (`GET …/media-library`,
//      `GET …/media-assets`, lues avec les cookies du navigateur comme le
//      reste de l'assistant — server/campaign-video.js) ;
//   2. la médiathèque de la régie (mar_sig_media, déjà servie par /media) ;
//   3. les photos du webshop, lues par le module Social du Marketing
//      (`GET /catalogue/nav`, la même lecture que « Créer un post ») ;
//   4. un import (envoi en flux, POST /media/upload).
// Un fichier pris au Marketing ou au webshop est COPIÉ dans le stockage de la
// régie (server/media-store.js, disque ou bucket OVH) au moment de l'ajout :
// les écrans des magasins n'ont jamais à joindre le Marketing, et le fichier
// voyage dans le cache hors ligne comme toute la médiathèque. Une copie déjà
// faite est reprise (mar_sig_media_sources).
//
// Détourage : le module Social sait détourer (remove.bg, `POST /media/detourer`,
// clé gardée par le Social). La régie lui envoie la photo et range le PNG
// détouré comme un nouveau média. Sans clé chez le Social, c'est dit.
//
// Adresses : celles du module, toujours tirées de la configuration —
//   SIG_MARKETING_API_URL / SIG_MARKETING_SSO_URL (voir campaign-video.js),
//   SIG_MARKETING_SOCIAL_URL (défaut : …/marketing/social/api/v1/social),
//   SIG_MARKETING_MEDIA_ORIGINS (origines supplémentaires des fichiers,
//   séparées par des virgules, si le Marketing les sert sous une autre adresse).
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { getDb, addMediaRow, getMediaRow, loadCatalog } from './db.js';
import { mk, marketingApiBase } from './campaign-video.js';
import { forwardedCookies } from './marketing-sso.js';
import { storeMediaFile, freeMediaName } from './media-store.js';
import { s3Config, s3Configured, objectKey, s3Request } from './s3.js';

export function socialApiBase() {
  if (process.env.SIG_MARKETING_SOCIAL_URL) return process.env.SIG_MARKETING_SOCIAL_URL.replace(/\/+$/, '');
  return marketingApiBase().replace(/\/api\/v1\/marketing$/, '/social/api/v1/social');
}

export function ensureMediaSources() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS mar_sig_media_sources (
    source     TEXT NOT NULL,
    ext_id     TEXT NOT NULL,
    media_id   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source, ext_id)
  )`);
}

const IMG_MAX = 40 * 1024 * 1024;
const VID_MAX = 400 * 1024 * 1024;

// Type d'un fichier d'après ses premiers octets (jamais d'après son nom).
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  const s = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', kind: 'photo' };
  if (s(0, 8) === '\x89PNG\r\n\x1a\n') return { ext: '.png', kind: 'photo' };
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { ext: '.webp', kind: 'photo' };
  if (s(0, 6) === 'GIF87a' || s(0, 6) === 'GIF89a') return { ext: '.gif', kind: 'photo' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: '.webm', kind: 'film' };
  if (s(4, 8) === 'ftyp') return { ext: /qt {2}/.test(s(8, 12)) ? '.mov' : '.mp4', kind: 'film' };
  return null;
}

const slug = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'media';

// Un fichier servi par le Marketing : son adresse absolue est construite par le
// module avec l'hôte de la requête (MediaService::publicUrl). La régie ne suit
// que les fichiers du module — même origine que son API, une origine déclarée,
// ou le même chemin (/marketing/…) relu sur l'origine de l'API.
export function marketingFileUrl(u) {
  let url;
  try { url = new URL(String(u || ''), marketingApiBase()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const api = new URL(marketingApiBase());
  const extra = String(process.env.SIG_MARKETING_MEDIA_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
  if (url.origin === api.origin || extra.includes(url.origin)) return url.toString();
  // Le préfixe du module (« /marketing/ ») : l'API vit sous <préfixe>/api/v1/…
  const root = api.pathname.replace(/\/api\/v1\/.*$/, '/');
  if (root.length > 1 && url.pathname.startsWith(root) && !url.pathname.includes('/../')) return `${api.origin}${url.pathname}${url.search}`;
  return null;
}

async function fetchBytes(req, url, max) {
  const headers = { accept: '*/*' };
  const cookie = forwardedCookies(req);
  if (cookie) headers.cookie = cookie;
  let res;
  try { res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) }); }
  catch { throw Object.assign(new Error('fichier du Marketing injoignable'), { status: 502 }); }
  if (!res.ok) throw Object.assign(new Error(`le Marketing répond HTTP ${res.status} pour le fichier`), { status: 502 });
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) throw Object.assign(new Error(`fichier trop lourd (${Math.round(len / 1048576)} Mo)`), { status: 413 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw Object.assign(new Error('fichier trop lourd'), { status: 413 });
  return { buf, type: res.headers.get('content-type') || '' };
}

// ---- 1 · médiathèque du Marketing -------------------------------------------
const proxied = (u) => (u ? `api/v1/film-media/file?u=${encodeURIComponent(u)}` : '');
function assetRow(a) {
  return {
    id: String(a.id), kind: a.kind === 'video' ? 'video' : 'image', name: String(a.name || ''),
    thumb: proxied(a.thumbnailUrl || a.webUrl || (a.kind === 'video' ? '' : a.url)),
    width: a.width ?? null, height: a.height ?? null,
    category: a.category ? { code: a.category.code, label: a.category.label } : null,
    subcategory: a.subcategory ? { code: a.subcategory.code, label: a.subcategory.label } : null,
    season: a.season ? { code: a.season.code, label: a.season.label } : null,
    offerItem: a.offerItem ? { id: String(a.offerItem.id), name: String(a.offerItem.name || '') } : null,
    cutout: !!a.cutout, mime: String(a.mimeType || ''),
  };
}
export async function marketingLibrary(req, q) {
  const params = new URLSearchParams({ page: String(Math.max(1, parseInt(q.get('page'), 10) || 1)), perPage: '100', sort: '-createdAt' });
  const name = String(q.get('q') || '').trim().slice(0, 100);
  if (name) params.set('filter[name][contains]', name);
  if (['image', 'video'].includes(q.get('kind'))) params.set('filter[kind][eq]', q.get('kind'));
  if (/^[a-z0-9-]{1,40}$/.test(q.get('category') || '')) params.set('filter[category][eq]', q.get('category'));
  if (/^[a-z0-9-]{1,40}$/.test(q.get('season') || '')) params.set('filter[season][eq]', q.get('season'));
  const [lib, list] = await Promise.all([mk(req, 'GET', '/media-library'), mk(req, 'GET', `/media-assets?${params}`)]);
  if (!list.ok) return { ok: false, error: list.error, items: [] };
  const pg = (list.meta && list.meta.pagination) || {};
  return {
    ok: true,
    items: (Array.isArray(list.data) ? list.data : []).map(assetRow),
    total: Number(pg.total) || 0, page: Number(pg.page) || 1,
    categories: lib.ok && Array.isArray(lib.data && lib.data.categories) ? lib.data.categories.map((c) => ({ code: c.code, label: c.label })) : [],
    seasons: lib.ok && Array.isArray(lib.data && lib.data.seasons) ? lib.data.seasons : [],
  };
}

// ---- 3 · photos du webshop (module Social du Marketing) ---------------------
async function social(req, method, path, body) {
  const headers = { accept: 'application/json' };
  const cookie = forwardedCookies(req);
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try { res = await fetch(socialApiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(90000) }); }
  catch { return { ok: false, status: 502, error: `module Social du Marketing injoignable (${socialApiBase()})` }; }
  return { ok: res.ok, status: res.status, res };
}
async function socialError(r) {
  if (r.error) return r.error;
  const j = r.res ? await r.res.json().catch(() => null) : null;
  return `module Social du Marketing, HTTP ${r.status}${j && j.error ? ` : ${String(j.error).slice(0, 200)}` : ''}`;
}
export async function webshopPhotos(req) {
  const r = await social(req, 'GET', '/catalogue/nav');
  if (!r.ok) return { ok: false, error: await socialError(r), items: [] };
  const j = await r.res.json().catch(() => null);
  const data = j && j.data && j.produits == null ? j.data : j;
  const cats = new Map(((data && data.categories) || []).map((c) => [Number(c.id), String(c.name || '')]));
  const known = new Set(loadCatalog().products.map((p) => p.id));
  const items = ((data && data.produits) || []).filter((p) => p && /^https:\/\//.test(String(p.image || ''))).map((p) => ({
    id: String(p.id), name: String(p.name || ''), image: String(p.image), thumb: `api/v1/film-media/file?w=${encodeURIComponent(p.image)}`,
    category: cats.get(Number(p.cat)) || '', productId: known.has(`pwp${p.id}`) ? `pwp${p.id}` : '',
  }));
  return { ok: true, items, readAt: String((data && data.lu) || '') };
}

// Un fichier pour l'aperçu du tiroir (vignette), relayé par la régie.
export async function relayFile(req, res, q) {
  const fail = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg); };
  try {
    let got;
    if (q.get('w')) {
      const u = String(q.get('w'));
      if (!/^https:\/\//.test(u)) return fail(400, 'adresse refusée');
      const r = await social(req, 'GET', `/media/webshop?u=${encodeURIComponent(u)}`);
      if (!r.ok) return fail(502, await socialError(r));
      got = { buf: Buffer.from(await r.res.arrayBuffer()), type: r.res.headers.get('content-type') || '' };
    } else {
      const url = marketingFileUrl(q.get('u'));
      if (!url) return fail(400, 'adresse refusée : seuls les fichiers du module Marketing passent');
      got = await fetchBytes(req, url, VID_MAX);
    }
    const t = sniff(got.buf);
    if (!t) return fail(415, 'pas une image ni une vidéo');
    res.writeHead(200, { 'content-type': got.type && !/json|html/.test(got.type) ? got.type : (t.kind === 'photo' ? `image/${t.ext.slice(1).replace('jpg', 'jpeg')}` : `video/${t.ext.slice(1)}`), 'cache-control': 'private, max-age=3600', 'content-length': got.buf.length });
    res.end(got.buf);
  } catch (e) { fail(e.status || 502, String(e.message || e)); }
  return undefined;
}

// ---- copie dans la régie ------------------------------------------------------
async function keep(mediaDir, { source, extId, buf, name, productId = '', seasonId = '' }) {
  const t = sniff(buf);
  if (!t) throw Object.assign(new Error('le fichier n’est ni une image ni une vidéo reconnue'), { status: 415 });
  const base = slug(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, ''));
  const filename = freeMediaName(mediaDir, `${base}${t.ext}`);
  const stored = await storeMediaFile(mediaDir, filename, buf);
  const id = 'md' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  addMediaRow({ id, filename, kind: t.kind, moment: 'all', productId, seasonId, size: stored.size, storage: stored.storage, ctype: stored.ctype });
  if (source) getDb().prepare('INSERT OR REPLACE INTO mar_sig_media_sources(source, ext_id, media_id) VALUES (?, ?, ?)').run(source, String(extId), id);
  return getMediaRow(id);
}
const already = (source, extId) => {
  const r = getDb().prepare('SELECT media_id FROM mar_sig_media_sources WHERE source = ? AND ext_id = ?').get(source, String(extId));
  const row = r ? getMediaRow(r.media_id) : null;
  return row || null;
};

export async function importFilmMedia(req, mediaDir, body) {
  ensureMediaSources();
  const source = String(body.source || '');
  if (source === 'marketing') {
    const id = String(body.id || '');
    if (!/^\d{1,12}$/.test(id)) return { status: 400, json: { error: 'identifiant de média du Marketing invalide' } };
    const prev = already('marketing', id);
    if (prev) return { status: 200, json: { ok: true, media: prev, reused: true } };
    const a = await mk(req, 'GET', `/media-assets/${id}`);
    if (!a.ok) return { status: a.status === 404 ? 404 : 502, json: { error: a.error } };
    const asset = a.data || {};
    // Une photo : la version web (2 048 px), assez pour un écran 4K en plein
    // cadre ; une vidéo : l'original.
    const src = marketingFileUrl(asset.kind === 'video' ? asset.url : (asset.webUrl || asset.url));
    if (!src) return { status: 502, json: { error: 'adresse du fichier du Marketing inattendue' } };
    const { buf } = await fetchBytes(req, src, asset.kind === 'video' ? VID_MAX : IMG_MAX);
    const media = await keep(mediaDir, { source: 'marketing', extId: id, buf, name: asset.name || `marketing-${id}` });
    return { status: 200, json: { ok: true, media } };
  }
  if (source === 'webshop') {
    const url = String(body.url || '');
    if (!/^https:\/\/[^\s]{1,600}$/.test(url)) return { status: 400, json: { error: 'adresse de photo du webshop invalide' } };
    const prev = already('webshop', url);
    if (prev) return { status: 200, json: { ok: true, media: prev, reused: true } };
    const r = await social(req, 'GET', `/media/webshop?u=${encodeURIComponent(url)}`);
    if (!r.ok) return { status: 502, json: { error: await socialError(r) } };
    const buf = Buffer.from(await r.res.arrayBuffer());
    const pid = String(body.productId || '');
    const media = await keep(mediaDir, { source: 'webshop', extId: url, buf, name: body.name || 'webshop', productId: loadCatalog().products.some((p) => p.id === pid) ? pid : '' });
    return { status: 200, json: { ok: true, media } };
  }
  return { status: 400, json: { error: 'source inconnue (marketing | webshop)' } };
}

async function mediaBytes(mediaDir, row) {
  if (row.storage === 's3') {
    if (!s3Configured()) throw Object.assign(new Error('média rangé sur OVHcloud, stockage non configuré'), { status: 503 });
    const c = s3Config();
    const up = await s3Request(c, 'GET', objectKey(c, row.filename), { timeoutMs: 60000 });
    const chunks = [];
    for await (const ch of up) chunks.push(ch);
    if (up.statusCode !== 200) throw Object.assign(new Error(`stockage S3 : HTTP ${up.statusCode}`), { status: 502 });
    return Buffer.concat(chunks);
  }
  const f = join(mediaDir, row.filename);
  if (!f.startsWith(mediaDir) || !existsSync(f)) throw Object.assign(new Error('fichier absent du serveur'), { status: 404 });
  return readFileSync(f);
}

// Détourer une photo de la régie par le module Social (remove.bg).
export async function cutoutMedia(req, mediaDir, mediaId) {
  ensureMediaSources();
  const row = getMediaRow(String(mediaId || ''));
  if (!row) return { status: 404, json: { error: 'média inconnu' } };
  if (row.kind !== 'photo') return { status: 400, json: { error: 'seule une photo se détoure' } };
  const prev = already('detourage', row.id);
  if (prev) return { status: 200, json: { ok: true, media: prev, reused: true } };
  const buf = await mediaBytes(mediaDir, row);
  const t = sniff(buf);
  if (!t || !['.jpg', '.png', '.webp'].includes(t.ext)) return { status: 400, json: { error: 'photo JPEG, PNG ou WebP attendue' } };
  if (buf.length > 12 * 1024 * 1024) return { status: 413, json: { error: 'photo trop lourde pour le détourage (12 Mo au plus)' } };
  const mime = t.ext === '.jpg' ? 'image/jpeg' : `image/${t.ext.slice(1)}`;
  const r = await social(req, 'POST', '/media/detourer', { image: `data:${mime};base64,${buf.toString('base64')}` });
  const j = r.res ? await r.res.json().catch(() => null) : null;
  if (!r.ok) return { status: r.status === 409 ? 409 : 502, json: { error: (j && (j.error || j.message)) || r.error || `module Social : HTTP ${r.status}` } };
  const m = /^data:image\/png;base64,(.+)$/s.exec(String((j && (j.src || (j.data && j.data.src))) || ''));
  if (!m) return { status: 502, json: { error: 'le module Social n’a pas rendu de PNG détouré' } };
  const png = Buffer.from(m[1], 'base64');
  const media = await keep(mediaDir, { source: 'detourage', extId: row.id, buf: png, name: `${row.filename.replace(extname(row.filename), '')}-detoure`, productId: row.productId, seasonId: row.seasonId });
  return { status: 200, json: { ok: true, media, credits: j && j.credits != null ? j.credits : null } };
}
