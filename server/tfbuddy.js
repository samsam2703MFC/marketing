// Client TFBuddy — l'API du panel (https://atelierby.tfbuddy.com/api/v1).
// La régie y lit les BUNDLES : les promotions « bundle » de TFBuddy, avec leur
// prix, leurs produits et quantités, leurs magasins, leurs jours et heures.
// Même API et même méthode que le cockpit consultant (consultant_bo,
// src/panel_api.php) : POST /<rôle>/auth/login {phone, password} → jeton JWT,
// puis « Authorization: Bearer ». Lire les bundles demande le droit
// MENU.BUNDLE.MANAGE (GET /admin/promotions/bundles) : sans lui, 403.
//
// Identifiants : variables d'environnement, posées par la livraison dans
// /etc/signage/signage.env (root, 0600) — jamais dans la base (miroir MySQL)
// ni dans le dépôt :
//   TFBUDDY_PHONE, TFBUDDY_PASSWORD
//   TFBUDDY_API_BASE (défaut https://atelierby.tfbuddy.com/api/v1)
//   TFBUDDY_ROLE     (admin | consultant | owner ; vide = essayés dans cet ordre)

const DEFAULT_BASE = 'https://atelierby.tfbuddy.com/api/v1';
const ROLES = ['admin', 'consultant', 'owner'];
const TIMEOUT_MS = 20000;

let session = null;        // { token, role, exp }
let lastRole = '';         // le rôle qui a marché : essayé en premier à la reconnexion
let authFailedAt = 0;      // identifiants refusés : la synchro automatique attend

export function tfbConfig() {
  const env = (k) => String(process.env[k] || '').trim();
  const role = env('TFBUDDY_ROLE').toLowerCase();
  return {
    base: (env('TFBUDDY_API_BASE') || DEFAULT_BASE).replace(/\/+$/, ''),
    phone: env('TFBUDDY_PHONE'),
    password: String(process.env.TFBUDDY_PASSWORD || ''),
    role: ROLES.includes(role) ? role : '',
  };
}
export const tfbConfigured = () => { const c = tfbConfig(); return !!(c.phone && c.password); };

// Pour l'écran de la régie : JAMAIS le mot de passe, et le numéro masqué.
export function tfbPublicConfig() {
  const c = tfbConfig();
  return {
    configured: !!(c.phone && c.password),
    base: c.base,
    phone: c.phone ? `${'•'.repeat(Math.max(0, c.phone.length - 3))}${c.phone.slice(-3)}` : '',
    role: (session && session.role) || c.role || '',
  };
}

export class TfbError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function http(method, url, { token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new TfbError(`TFBuddy injoignable (${e.name === 'TimeoutError' ? `pas de réponse en ${TIMEOUT_MS / 1000} s` : (e.cause && e.cause.code) || e.message})`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corps non JSON */ }
  return { status: res.status, json };
}

// La forme du jeton varie selon les routes (access_token, token, data.…).
function tokenOf(j) {
  for (const c of [j && j.access_token, j && j.token, j && j.data && j.data.access_token, j && j.data && j.data.token, j && j.data && j.data.accessToken]) {
    if (typeof c === 'string' && c.length > 10) return c;
  }
  return '';
}
// Fin de validité lue dans le jeton (JWT « exp »), sinon 25 minutes.
function expOf(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (p && Number.isFinite(p.exp)) return p.exp * 1000 - 60000;
  } catch { /* jeton opaque */ }
  return Date.now() + 25 * 60000;
}

async function login(force = false) {
  if (!force && session && session.exp > Date.now()) return session;
  const c = tfbConfig();
  if (!c.phone || !c.password) throw new TfbError('compte TFBuddy non configuré (TFBUDDY_PHONE / TFBUDDY_PASSWORD)');
  const refused = [];
  const order = c.role ? [c.role] : [lastRole, ...ROLES.filter((r) => r !== lastRole)].filter(Boolean);
  for (const role of order) {
    const r = await http('POST', `${c.base}/${role}/auth/login`, { body: { phone: c.phone, password: c.password } });
    const token = r.status >= 200 && r.status < 300 ? tokenOf(r.json) : '';
    if (token) {
      session = { token, role, exp: expOf(token) };
      lastRole = role;
      authFailedAt = 0;
      return session;
    }
    refused.push(`${role} → HTTP ${r.status}`);
  }
  session = null;
  authFailedAt = Date.now();
  throw new TfbError(`connexion TFBuddy refusée (${refused.join(', ')}) — numéro ou mot de passe à vérifier`, 401);
}

// GET authentifié ; un 401 (jeton expiré) relance UNE connexion.
export async function tfbGet(path) {
  const c = tfbConfig();
  let s = await login();
  let r = await http('GET', c.base + path, { token: s.token });
  if (r.status === 401) {
    s = await login(true);
    r = await http('GET', c.base + path, { token: s.token });
  }
  if (r.status === 403) {
    throw new TfbError(`TFBuddy refuse ${path.split('?')[0]} au compte « ${s.role} » (403) — il lui faut le droit MENU.BUNDLE.MANAGE`, 403);
  }
  if (r.status < 200 || r.status >= 300) {
    const why = r.json && (r.json.description || r.json.message || r.json.error);
    throw new TfbError(`TFBuddy ${path.split('?')[0]} → HTTP ${r.status}${why ? ` (${why})` : ''}`, r.status);
  }
  return r.json;
}

// Une liste, quelle que soit l'enveloppe : {items}, {data: […]}, {data: {items}}, […].
export function asList(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  for (const c of [j.items, j.data, j.data && j.data.items, j.data && j.data.data, j.results]) if (Array.isArray(c)) return c;
  return [];
}
// Nombre de pages annoncé par la réponse, ou 0 si elle n'en dit rien.
const pagesOf = (j) => {
  const p = (j && (j.pagination || (j.meta && j.meta.pagination) || j.meta)) || {};
  const n = Number(p.pages || p.last_page || p.total_pages || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Toutes les pages : la pagination annoncée fait foi (le serveur peut servir
// moins que la limite demandée) ; sans elle, une page incomplète est la dernière.
async function listAll(path, limit = 100) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const j = await tfbGet(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`);
    const items = asList(j);
    out.push(...items);
    const pages = pagesOf(j);
    if (!items.length || (pages ? page >= pages : items.length < limit)) break;
  }
  return out;
}

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const hhmm = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(str(v)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const day = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v)); return m ? m[1] : ''; };
const idOf = (v) => str(v && typeof v === 'object' ? (v.id ?? v.id_shop ?? v.shop_id ?? v.id_product ?? v.product_id) : v);

// Un bundle TFBuddy → la forme de la régie. Le détail porte la composition
// (items), les magasins (shop_ids) et les créneaux (schedule) ; la liste peut
// n'en porter qu'une partie.
export function normBundle(b) {
  const bp = b.bundle_promotion || b.bundlePromotion || {};
  const items = (Array.isArray(b.items) ? b.items : (Array.isArray(b.bundle_items) ? b.bundle_items : []))
    .map((it, i) => ({
      extProductId: idOf(it.id_product ?? it.product_id ?? it.product),
      portionId: it.id_product_portion ?? it.product_portion_id ?? null,
      qty: num(it.quantity ?? it.qty) || 1,
      sort: Number.isFinite(Number(it.sort_order)) ? Number(it.sort_order) : i,
      name: str(it.product_name ?? it.name ?? (it.product && (it.product.name || it.product.title))),
    }))
    .filter((it) => it.extProductId)
    .sort((a, b2) => a.sort - b2.sort);
  const shopIds = (Array.isArray(b.shop_ids) ? b.shop_ids : (Array.isArray(b.shops) ? b.shops : [])).map(idOf).filter(Boolean);
  const scopeRaw = str(b.shop_scope_type).toUpperCase();
  const schedule = (Array.isArray(b.schedule) ? b.schedule : (Array.isArray(b.schedules) ? b.schedules : []))
    .map((s) => ({ dow: Number(s.day_of_week ?? s.dayOfWeek ?? s.day), from: hhmm(s.time_from ?? s.timeFrom ?? s.from), to: hhmm(s.time_to ?? s.timeTo ?? s.to) }))
    .filter((s) => s.dow >= 1 && s.dow <= 7 && s.from && s.to);
  return {
    extId: idOf(b.id),
    name: str(b.name) || `Bundle ${idOf(b.id)}`,
    descr: str(b.description),
    status: (str(b.status) || 'ACTIVE').toUpperCase(),
    activation: (str(b.activation_mode) || 'AUTOMATIC').toUpperCase(),
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0,
    price: num(bp.bundle_price ?? b.bundle_price ?? b.price),
    items,
    scope: scopeRaw === 'SELECTED_SHOPS' || (!scopeRaw && shopIds.length) ? 'selected' : 'all',
    shopIds,
    schedule,
    dateFrom: day(b.valid_from ?? b.date_from ?? b.start_date ?? b.starts_at),
    dateTo: day(b.valid_to ?? b.date_to ?? b.end_date ?? b.ends_at),
  };
}

// Tous les bundles, complets : la liste, puis le détail de chacun (4 à la fois).
export async function fetchBundles() {
  const list = await listAll('/admin/promotions/bundles');
  const full = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const b = list[i];
      const complete = Array.isArray(b.items) && Array.isArray(b.schedule) && (Array.isArray(b.shop_ids) || b.shop_scope_type === 'ALL_SHOPS');
      if (complete || b.id == null) { full[i] = b; continue; }
      const d = await tfbGet(`/admin/promotions/bundles/${encodeURIComponent(String(b.id))}`);
      const det = (d && typeof d === 'object' && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) ? d.data : d;
      full[i] = { ...b, ...(det || {}) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return full.map(normBundle).filter((b) => b.extId);
}

// Les magasins TFBuddy (id, nom, slug) — pour relier leurs ids à ceux de la régie.
export async function fetchShops() {
  const j = await tfbGet('/shops');
  return asList(j).map((s) => ({
    id: idOf(s),
    name: str(s.name || s.shop_name || s.title || s.label),
    slug: str(s.slug || s.code || s.alias),
  })).filter((s) => s.id);
}

// La synchro automatique ne réessaie pas des identifiants refusés avant 6 h
// (pas de blocage du compte) ; la synchro demandée en régie, si.
export const tfbAuthBackoff = () => authFailedAt > 0 && Date.now() - authFailedAt < 6 * 3600 * 1000;
export function tfbForget() { session = null; authFailedAt = 0; }
