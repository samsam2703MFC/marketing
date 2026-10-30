// Client TFBuddy — l'API du panel (https://atelierby.tfbuddy.com/api/v1).
// La régie y lit les PROMOTIONS de TFBuddy : les bundles (prix, produits et
// quantités), les « X achetés = Y offert », les promotions de quantité, les
// remises programmées, et les campagnes de bons d'achat — avec leurs
// magasins, leurs jours et heures, leurs dates.
// Même API et même méthode que le cockpit consultant (consultant_bo,
// src/panel_api.php) : POST /<rôle>/auth/login {phone, password} → jeton JWT,
// puis « Authorization: Bearer ». Lire les bundles demande le droit
// MENU.BUNDLE.MANAGE (GET /admin/promotions/…) : sans lui, 403.
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

// Produit visé par une promotion : un id, ou un objet {id_product | product_id | id}.
const prodIdOf = (v) => str(v && typeof v === 'object' ? (v.id_product ?? v.product_id ?? (v.product && v.product.id) ?? v.id) : v);
const prodIds = (a) => (Array.isArray(a) ? a : []).map(prodIdOf).filter(Boolean);
const idList = (a) => (Array.isArray(a) ? a : []).map(idOf).filter(Boolean);
const upper = (v) => str(v).toUpperCase();
// Sous-objet propre à une famille (« bundle_promotion », « quantity_promotion »…).
const subObj = (o, ...keys) => {
  for (const k of keys) if (o && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) return o[k];
  return {};
};
const shopsOf = (b) => (Array.isArray(b.shop_ids) ? b.shop_ids : (Array.isArray(b.shops) ? b.shops : [])).map(idOf).filter(Boolean);
const scheduleOf = (b) => (Array.isArray(b.schedule) ? b.schedule : (Array.isArray(b.schedules) ? b.schedules : []))
  .map((x) => ({ dow: Number(x.day_of_week ?? x.dayOfWeek ?? x.day), from: hhmm(x.time_from ?? x.timeFrom ?? x.from), to: hhmm(x.time_to ?? x.timeTo ?? x.to) }))
  .filter((x) => x.dow >= 1 && x.dow <= 7 && x.from && x.to);
const scopeOf = (b, shopIds) => {
  const raw = upper(b.shop_scope_type);
  return raw === 'SELECTED_SHOPS' || (!raw && shopIds.length) ? 'selected' : 'all';
};

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
  const shopIds = shopsOf(b);
  const schedule = scheduleOf(b);
  return {
    extId: idOf(b.id),
    name: str(b.name) || `Bundle ${idOf(b.id)}`,
    descr: str(b.description),
    status: (str(b.status) || 'ACTIVE').toUpperCase(),
    activation: (str(b.activation_mode) || 'AUTOMATIC').toUpperCase(),
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0,
    price: num(bp.bundle_price ?? b.bundle_price ?? b.price),
    items,
    scope: scopeOf(b, shopIds),
    shopIds,
    schedule,
    dateFrom: day(b.valid_from ?? b.date_from ?? b.start_date ?? b.starts_at),
    dateTo: day(b.valid_to ?? b.date_to ?? b.end_date ?? b.ends_at),
  };
}

// ---- Les autres promotions ------------------------------------------------
// Même droit que les bundles, même liste paginée ({items, pagination}). Le
// détail n'est pas décrit par le contrat (« état dynamique ») : on lit ce qui
// se présente, sous les noms des contrats d'écriture (trigger / reward,
// quantity_promotion, discount_type…), avec ou sans sous-objet de famille.
export const PROMO_KINDS = {
  buy_x_get_y: { path: '/admin/promotions/buy-x-get-y', prefix: 'bx', detail: true },
  quantity: { path: '/admin/promotions/quantity', prefix: 'qt', detail: true },
  scheduled_discount: { path: '/admin/promotions/scheduled-product-discount', prefix: 'sd', detail: true },
  voucher: { path: '/admin/voucher-campaigns', prefix: 'vc', detail: false },
};

// Un côté d'une offre « X achetés = Y » : quantité, produits, catégories, et
// pour la récompense son type (offert, remise en %, en €, prix fixe) et sa valeur.
function sideOf(o) {
  const x = o && typeof o === 'object' ? o : {};
  return {
    qty: num(x.quantity ?? x.qty),
    products: prodIds(x.product_ids ?? x.products),
    categories: idList(x.category_ids ?? x.categories),
    type: upper(x.type ?? x.reward_type),
    value: num(x.value ?? x.reward_value),
  };
}

function mechanicOf(kind, p) {
  if (kind === 'buy_x_get_y') {
    const bx = subObj(p, 'buy_x_get_y_promotion', 'buyXGetYPromotion', 'buy_x_get_y');
    const trigger = sideOf(p.trigger || bx.trigger || {
      quantity: p.trigger_quantity ?? bx.trigger_quantity ?? bx.buy_quantity ?? p.buy_quantity,
      product_ids: p.trigger_product_ids ?? bx.trigger_product_ids, category_ids: p.trigger_category_ids ?? bx.trigger_category_ids,
    });
    const reward = sideOf(p.reward || bx.reward || {
      quantity: p.reward_quantity ?? bx.reward_quantity ?? bx.get_quantity ?? p.get_quantity,
      product_ids: p.reward_product_ids ?? bx.reward_product_ids, category_ids: p.reward_category_ids ?? bx.reward_category_ids,
      type: p.reward_type ?? bx.reward_type, value: p.reward_value ?? bx.reward_value,
    });
    // Composition en lignes, chacune avec son rôle (déclencheur / récompense).
    for (const it of Array.isArray(p.items) ? p.items : []) {
      const pid = prodIdOf(it);
      if (!pid) continue;
      (/^(REWARD|GET|FREE)/.test(upper(it.role ?? it.side ?? it.item_type ?? it.type)) ? reward : trigger).products.push(pid);
    }
    return {
      buy: trigger.qty || 1, get: reward.qty || 1, rewardType: reward.type || 'FREE', rewardValue: reward.value,
      triggerProducts: trigger.products, triggerCategories: trigger.categories,
      rewardProducts: reward.products, rewardCategories: reward.categories,
    };
  }
  if (kind === 'quantity') {
    const q = subObj(p, 'quantity_promotion', 'quantityPromotion');
    return {
      mechanism: upper(q.mechanism_type ?? p.mechanism_type),
      qty: num(q.bundle_quantity ?? q.buy_quantity ?? q.min_quantity ?? q.quantity ?? p.bundle_quantity),
      free: num(q.free_quantity ?? q.get_quantity ?? p.free_quantity),
      discountType: upper(q.discount_type ?? q.reward_type ?? p.discount_type),
      discountValue: num(q.discount_value ?? q.reward_value ?? q.value ?? p.discount_value),
      price: num(q.bundle_price ?? q.fixed_price ?? q.price ?? p.bundle_price),
      products: prodIds(p.eligible_product_ids ?? q.eligible_product_ids ?? p.product_ids),
      categories: idList(p.eligible_category_ids ?? q.eligible_category_ids ?? p.category_ids),
    };
  }
  if (kind === 'scheduled_discount') {
    const d = subObj(p, 'scheduled_product_discount', 'scheduled_product_discount_promotion', 'scheduledProductDiscount');
    return {
      discountType: upper(p.discount_type ?? d.discount_type),
      discountValue: num(p.discount_value ?? d.discount_value),
      products: prodIds(p.reward_product_ids ?? d.reward_product_ids ?? p.product_ids),
      categories: idList(p.reward_category_ids ?? d.reward_category_ids ?? p.category_ids),
      excluded: prodIds(p.excluded_product_ids ?? d.excluded_product_ids),
    };
  }
  // Campagne de bons : un code partagé (affichable) ou des codes uniques.
  const promo = p.promotion && typeof p.promotion === 'object' ? p.promotion : {};
  return {
    codeType: upper(p.code_type) || 'SHARED',
    code: str(p.shared_code),
    plannedType: upper(p.planned_promotion_type),
    promotionId: idOf(p.id_promotion ?? promo.id),
    promotionName: str(promo.name ?? p.promotion_name),
    requiresCustomer: !!p.requires_customer,
  };
}

// Une promotion TFBuddy (toute famille) → la forme de la régie.
export function normPromotion(kind, p) {
  const shopIds = shopsOf(p);
  const mech = mechanicOf(kind, p);
  // Produits et catégories visés : la récompense d'abord (c'est elle qu'on montre).
  const products = kind === 'buy_x_get_y'
    ? [...new Set([...mech.rewardProducts, ...mech.triggerProducts])]
    : (mech.products || []);
  const categories = kind === 'buy_x_get_y'
    ? [...new Set([...mech.rewardCategories, ...mech.triggerCategories])]
    : (mech.categories || []);
  return {
    kind,
    extId: idOf(p.id),
    name: str(p.name) || `${kind} ${idOf(p.id)}`,
    descr: str(p.description),
    status: (str(p.status) || 'ACTIVE').toUpperCase(),
    activation: (str(p.activation_mode) || 'AUTOMATIC').toUpperCase(),
    priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 0,
    scope: kind === 'voucher' ? 'all' : scopeOf(p, shopIds),
    shopIds,
    schedule: scheduleOf(p),
    dateFrom: day(p.valid_from ?? p.date_from ?? p.start_date ?? p.starts_at),
    dateTo: day(p.valid_to ?? p.date_to ?? p.end_date ?? p.ends_at),
    mech,
    products,
    categories,
  };
}

// Toutes les promotions d'une famille, complètes : la liste, puis le détail
// de chacune (4 à la fois) — sauf les campagnes de bons, entières dans la liste.
export async function fetchPromotions(kind) {
  const k = PROMO_KINDS[kind];
  if (!k) throw new TfbError(`famille de promotions inconnue : ${kind}`);
  const list = await listAll(k.path);
  const full = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const p = list[i];
      if (!k.detail || p.id == null) { full[i] = p; continue; }
      const d = await tfbGet(`${k.path}/${encodeURIComponent(String(p.id))}`);
      const det = (d && typeof d === 'object' && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) ? d.data : d;
      full[i] = { ...p, ...(det || {}) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return full.map((p) => normPromotion(kind, p)).filter((p) => p.extId);
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
