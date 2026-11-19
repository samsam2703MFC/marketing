// Assistant vidéo de campagne — côté serveur.
//
// 1. Lecture du module Marketing (/marketing, même serveur) : ses campagnes,
//    leur offre, leurs boutiques, ses promotions, bundles et bons, et le fil
//    de production d'une campagne. Comme l'ouverture sans mot de passe
//    (server/marketing-sso.js), la régie interroge le module avec les cookies
//    du navigateur — sauf celui de la régie — : c'est le module qui dit ce que
//    la personne connectée a le droit de voir. Rien n'est recopié en base.
//    L'adresse du module vient de la configuration, jamais de la requête :
//      SIG_MARKETING_API_URL=…  base des routes du module
//                               (défaut : celle de SIG_MARKETING_SSO_URL sans
//                               « /session », soit
//                               http://127.0.0.1/marketing/api/v1/marketing).
// 2. Rattachement aux données de la régie : un produit de l'offre se relie par
//    l'identifiant de l'ERP (référence « erp-<id> » du catalogue du module →
//    produit « pwp<id> » de la régie), une boutique par son identifiant ERP
//    (correspondance de l'import PWA) s'il est fourni, sinon par son nom. Ce
//    qui ne se relie pas est NOMMÉ, jamais ignoré.
// 3. Diffusion : le même chemin de publication que la régie (snapshot
//    versionné, tests live, rapport), restreint aux écrans cochés, puis la fin
//    automatique à la date de fin de la campagne (retour au film d'avant).
import { getDb, loadCatalog, loadPlaylists, endOfDayBrussels, PLAN_WEEKS, MAX_PLAN_FILMS } from './db.js';
import { marketingSsoUrl, forwardedCookies } from './marketing-sso.js';
import { pwaConfig, matchStore } from './pwadb.js';

export function marketingApiBase() {
  if (process.env.SIG_MARKETING_API_URL) return process.env.SIG_MARKETING_API_URL.replace(/\/+$/, '');
  return marketingSsoUrl().replace(/\/session\/?$/, '');
}

// Appel au module : { ok, status, data } ou { ok: false, status, error }.
// L'enveloppe du standard ({ success, data }) est déballée ; une erreur du
// module ({ status: 'error', description } ou { error: { message } }) est dite.
export async function mk(req, method, path, body) {
  const url = marketingApiBase() + path;
  const headers = { accept: 'application/json' };
  const cookie = forwardedCookies(req);
  if (cookie) headers.cookie = cookie;
  if (req.headers.authorization && !/^Bearer\s+[A-Za-z0-9]{20,}$/.test(req.headers.authorization)) headers.authorization = req.headers.authorization;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  } catch {
    return { ok: false, status: 502, error: `module Marketing injoignable (${marketingApiBase()})` };
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json == null) {
    const why = json && (json.description || (json.error && (json.error.message || json.error)) || json.message);
    const error = res.status === 401 ? 'aucune session dans le module Marketing'
      : res.status === 403 ? 'le module Marketing refuse cet accès (périmètre)'
        : `le module Marketing répond HTTP ${res.status}${why ? ` : ${String(why).slice(0, 160)}` : ''}`;
    return { ok: false, status: res.status || 502, error };
  }
  const wrapped = json && typeof json === 'object' && !Array.isArray(json) && 'success' in json && 'data' in json;
  return { ok: true, status: res.status, data: wrapped ? json.data : json, meta: wrapped ? (json.meta || {}) : {} };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// En cours : la période contient aujourd'hui (ou le module dit « live »), ni
// brouillon ni terminée. À venir : commence plus tard, planifiée ou en cours.
export function campaignPhase(c, now = today()) {
  const st = String(c.status_code || '');
  if (st === 'draft' || st === 'done') return st;
  const from = day(c.starts_on);
  const to = day(c.ends_on);
  if (to && to < now) return 'past';
  if (from && from > now) return 'upcoming';
  if ((!from || from <= now) && (!to || to >= now)) return 'current';
  return st === 'live' ? 'current' : 'other';
}

const summary = (c) => ({
  id: String(c.id), name: String(c.name || ''), status: String(c.status_code || ''), statusLabel: String(c.status_label || ''),
  startsOn: day(c.starts_on), endsOn: day(c.ends_on), imageUrl: String(c.image_url || ''), type: String(c.type_label || ''),
  shopsCount: Number(c.shops_count) || 0, phase: campaignPhase(c),
});

// Liste : la campagne en cours (la plus récente) et celles à venir.
export async function marketingCampaigns(req) {
  const r = await mk(req, 'GET', '/campaigns');
  if (!r.ok) return { ok: false, error: r.error, httpStatus: r.status, current: [], upcoming: [] };
  const rows = (Array.isArray(r.data) ? r.data : []).map(summary);
  const current = rows.filter((c) => c.phase === 'current').sort((a, b) => (b.startsOn || '').localeCompare(a.startsOn || ''));
  const upcoming = rows.filter((c) => c.phase === 'upcoming').sort((a, b) => (a.startsOn || '').localeCompare(b.startsOn || ''));
  return { ok: true, base: marketingApiBase(), current, upcoming, total: rows.length };
}

// ---- rattachements ---------------------------------------------------------
function storeMatcher() {
  const db = getDb();
  const sig = db.prepare("SELECT id, name FROM sig_stores WHERE id != 'st-new'").all();
  const byExt = {};
  for (const [storeId, extId] of Object.entries(pwaConfig().shopMap || {})) byExt[String(extId)] = storeId;
  return {
    all: sig,
    of(shop) {
      const ext = shop.erp_shop_id != null ? String(shop.erp_shop_id) : '';
      if (ext && byExt[ext] && sig.some((s) => s.id === byExt[ext])) return { storeId: byExt[ext], by: 'erp' };
      for (const nm of [shop.shop_name, shop.name, shop.city]) {
        if (!nm) continue;
        const exact = sig.find((s) => norm(s.name) === norm(nm));
        if (exact) return { storeId: exact.id, by: 'nom' };
      }
      const m = matchStore({ name: shop.shop_name || shop.name || '' }, sig).match
        || (shop.city ? matchStore({ name: shop.city }, sig).match : null);
      return m ? { storeId: m.id, by: 'nom' } : null;
    },
  };
}

function productMatcher(offerItems) {
  const { products } = loadCatalog();
  const byId = new Map(products.map((p) => [p.id, p]));
  const sku = new Map((offerItems || []).map((o) => [Number(o.id), String(o.sku_ref || '')]));
  return (item) => {
    const s = sku.get(Number(item.offer_item_id)) || '';
    const m = /^erp-(\d+)$/i.exec(s);
    if (m && byId.has(`pwp${m[1]}`)) return { productId: `pwp${m[1]}`, by: 'erp' };
    if (m) return { productId: '', by: 'erp-absent', erpId: m[1] };
    const label = norm(item.label);
    const p = label ? products.find((x) => norm(x.name) === label) : null;
    return p ? { productId: p.id, by: 'nom' } : null;
  };
}

// Détail résolu d'une campagne : ce que l'assistant reprend d'office.
export async function marketingCampaign(req, id) {
  const r = await mk(req, 'GET', `/campaigns/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, httpStatus: r.status, error: r.error };
  const c = r.data || {};
  // Lectures complémentaires : aucune n'est bloquante, chacune dit son échec.
  const [items, promos, bundles, vouchers, prod] = await Promise.all([
    mk(req, 'GET', '/offer-items'), mk(req, 'GET', '/promotions'), mk(req, 'GET', '/bundles'),
    mk(req, 'GET', '/vouchers'), mk(req, 'GET', `/campaigns/${encodeURIComponent(id)}/production-sections`),
  ]);
  const warnings = [];
  for (const [label, x] of [['références du catalogue (/offer-items)', items], ['promotions', promos], ['bundles', bundles], ['bons', vouchers], ['fil de production', prod]]) {
    if (!x.ok) warnings.push(`${label} : ${x.error}`);
  }
  const offer = c.offer && typeof c.offer === 'object' ? c.offer : null;
  const matchProduct = productMatcher(items.ok ? items.data : []);
  const products = [];
  const productsUnmatched = [];
  for (const it of (offer && Array.isArray(offer.items) ? offer.items : [])) {
    const hit = matchProduct(it);
    const row = {
      label: String(it.label || ''), offerItemId: it.offer_item_id ?? null, mechanic: String(it.mechanic_type || ''),
      discountPct: it.discount_pct ?? null, fixedPrice: it.fixed_price ?? null, buyQty: it.buy_qty ?? null, getQty: it.get_qty ?? null,
    };
    if (hit && hit.productId) products.push({ ...row, productId: hit.productId, by: hit.by });
    else productsUnmatched.push({ ...row, reason: hit && hit.by === 'erp-absent' ? `produit ERP ${hit.erpId} absent du catalogue de la régie` : 'aucun produit de la régie ne correspond' });
  }
  const sm = storeMatcher();
  const shops = Array.isArray(c.shops) ? c.shops : [];
  const stores = [];
  const storesUnmatched = [];
  for (const s of shops) {
    const hit = sm.of(s);
    const name = String(s.shop_name || s.name || '');
    if (hit && !stores.some((x) => x.storeId === hit.storeId)) stores.push({ storeId: hit.storeId, shopId: s.shop_id ?? null, name, by: hit.by });
    else if (!hit) storesUnmatched.push({ shopId: s.shop_id ?? null, name, city: String(s.city || '') });
  }
  const mine = (row) => String(row.campaign_id ?? '') === String(c.id);
  const sections = prod.ok && prod.data && Array.isArray(prod.data.sections) ? prod.data.sections : [];
  const screens = sections.find((x) => x.code === 'ecrans') || null;
  const levers = Array.isArray(c.levers) ? c.levers : [];
  return {
    ok: true,
    campaign: {
      ...summary(c),
      objective: String((offer && offer.lever_label) || (levers[0] && levers[0].label) || ''),
      offer: offer ? {
        title: String(offer.title || ''), mechanic: String(offer.mechanic_text || ''), discount: String(offer.discount_label || ''),
        price: String(offer.price_label || ''), imageUrl: String(offer.image_url || ''), voucherCode: String(offer.voucher_code || ''),
        startsOn: day(offer.starts_on), endsOn: day(offer.ends_on), hourFrom: String(offer.hour_from || ''), hourTo: String(offer.hour_to || ''),
        weekdaysMask: Number.isFinite(Number(offer.weekdays_mask)) ? Number(offer.weekdays_mask) : 127,
      } : null,
      channels: (Array.isArray(c.channels) ? c.channels : []).filter((x) => x.is_enabled !== false).map((x) => String(x.label || '')),
      allShops: shops.length === 0,
    },
    products, productsUnmatched,
    stores: shops.length ? stores : sm.all.map((s) => ({ storeId: s.id, shopId: null, name: s.name, by: 'reseau' })),
    storesUnmatched,
    // Promotions, bundles et bons du Marketing rattachés à CETTE campagne :
    // l'assistant coche d'office les promotions de la régie qui leur répondent.
    offerLinks: {
      promotions: promos.ok ? (Array.isArray(promos.data) ? promos.data : []).filter(mine).map((p) => ({ id: p.id, name: String(p.name || ''), mechanic: String(p.mechanic_type || ''), value: String(p.value_label || '') })) : [],
      bundles: bundles.ok ? (Array.isArray(bundles.data) ? bundles.data : []).map((b) => ({ id: b.id, name: String(b.name || ''), items: (b.items || []).map((x) => String(x.name || '')) })) : [],
      vouchers: vouchers.ok ? (Array.isArray(vouchers.data) ? vouchers.data : []).filter(mine).map((v) => ({ id: v.id, code: String(v.code || ''), mechanic: String(v.mechanic_label || '') })) : [],
      voucherCode: offer ? String(offer.voucher_code || '') : '',
    },
    production: { read: prod.ok, screens: screens ? { status: String(screens.status || 'todo'), label: String(screens.label || '') } : null },
    warnings,
  };
}

// Après la diffusion : la section « Écrans des magasins » du fil de
// production passe à « prête ». Sans section écrans, rien n'est inventé.
export async function markScreensReady(req, id) {
  const prod = await mk(req, 'GET', `/campaigns/${encodeURIComponent(id)}/production-sections`);
  if (!prod.ok) return { ok: false, error: prod.error };
  const sections = prod.data && Array.isArray(prod.data.sections) ? prod.data.sections : [];
  if (!sections.some((x) => x.code === 'ecrans')) return { ok: false, missing: true, error: 'la campagne n’a pas de section « Écrans des magasins » dans son fil de production' };
  const r = await mk(req, 'PUT', `/campaigns/${encodeURIComponent(id)}/production-sections/ecrans`, { status: 'ready', note: 'Vidéo diffusée depuis la régie (assistant vidéo de campagne)' });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ---- diffusion et fin automatique -------------------------------------------
export function ensureCampaignRuns() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS sig_campaign_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id     TEXT NOT NULL,
    campaign_id TEXT NOT NULL DEFAULT '',
    player_id   TEXT NOT NULL,
    version     INTEGER NOT NULL,
    prev_ver    INTEGER NOT NULL DEFAULT 0,
    ends_at     TEXT NOT NULL DEFAULT '',
    plan        TEXT NOT NULL DEFAULT '[]',
    done_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

// Minuit (heure de Bruxelles) au début du jour donné → ISO UTC.
const brusselsStart = (d) => endOfDayBrussels(new Date(Date.parse(`${d}T12:00:00Z`) - 86400000));

// players : écrans cochés ; cells : [{ day: 0..6, moment }] de la semaine type.
export async function diffuseFilm({ filmId, players, stores: linkStores, startsOn, endsOn, week, cells, campaignId, publish }) {
  ensureCampaignRuns();
  const db = getDb();
  const film = loadPlaylists().find((p) => p.id === filmId);
  if (!film) return { status: 404, json: { error: `film inconnu : ${filmId} — enregistre le brouillon d'abord` } };
  const rows = (Array.isArray(players) ? players : []).map(String)
    .map((id) => db.prepare('SELECT id, store_id, assigned_ver FROM sig_players WHERE id = ?').get(id)).filter(Boolean);
  // Magasins sans écran jumelé : ils diffusent par le lien de leur écran (film?store=…).
  const sansEcran = db.prepare("SELECT s.id FROM sig_stores s WHERE s.id = ? AND s.id != 'st-new' AND NOT EXISTS (SELECT 1 FROM sig_players p WHERE p.store_id = s.id)");
  const links = [...new Set((Array.isArray(linkStores) ? linkStores : []).map(String))].filter((id) => sansEcran.get(id));
  if (!rows.length && !links.length) return { status: 400, json: { error: 'aucun écran ni magasin coché' } };
  const stores = [...new Set([...rows.map((p) => p.store_id), ...links])];
  const chosen = new Set(rows.map((p) => p.id));
  const prev = new Map(db.prepare(`SELECT id, assigned_ver FROM sig_players WHERE store_id IN (${stores.map(() => '?').join(',')})`).all(...stores).map((p) => [p.id, p.assigned_ver]));
  const now = today();
  const from = day(startsOn);
  const to = day(endsOn);
  if (to && to < now) return { status: 400, json: { error: `la période est terminée (fin le ${to})` } };
  const scheduled = !!(from && from > now);
  const out = await publish({ mode: 'full', targets: stores, playlistId: filmId, when: scheduled ? 'scheduled' : 'now', activateAt: scheduled ? brusselsStart(from) : null, schedule: film.schedule, slot: `Vidéo de campagne · ${film.name}` });
  // Les écrans NON cochés d'un magasin ciblé gardent ce qu'ils jouaient.
  const keep = db.prepare('UPDATE sig_players SET assigned_ver = ?, activate_at = NULL WHERE id = ?');
  for (const [pid, ver] of prev) if (!chosen.has(pid)) keep.run(ver, pid);
  // Semaine type : le film rejoint les cases cochées (jour × moment) de chaque
  // magasin, après les films qui y sont déjà (au plus MAX_PLAN_FILMS).
  const wk = PLAN_WEEKS.includes(String(week)) ? String(week) : '';
  const added = [];
  if (wk && Array.isArray(cells)) {
    const exists = db.prepare('SELECT 1 FROM sig_weekplans WHERE store_id = ? AND week = ? AND day = ? AND moment = ? AND film_id = ?');
    const count = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS mx FROM sig_weekplans WHERE store_id = ? AND week = ? AND day = ? AND moment = ?');
    const ins = db.prepare('INSERT INTO sig_weekplans(store_id, week, day, moment, position, film_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const st of stores) {
      for (const c of cells) {
        const d = parseInt(c && c.day, 10);
        const mo = String((c && c.moment) || '');
        if (!(d >= 0 && d <= 6) || !['matin', 'midi', 'aprem'].includes(mo)) continue;
        if (exists.get(st, wk, d, mo, filmId)) continue;
        const k = count.get(st, wk, d, mo);
        if (k.n >= MAX_PLAN_FILMS) continue;
        ins.run(st, wk, d, mo, k.mx + 1, filmId);
        added.push({ store: st, week: wk, day: d, moment: mo });
      }
    }
  }
  // Fin automatique : à la fin du dernier jour (heure de Bruxelles), chaque
  // écran revient à ce qu'il jouait avant, et le film quitte la semaine type.
  const endsAt = to ? endOfDayBrussels(new Date(Date.parse(`${to}T12:00:00Z`))) : '';
  const insRun = db.prepare('INSERT INTO sig_campaign_runs(film_id, campaign_id, player_id, version, prev_ver, ends_at, plan) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const planJson = JSON.stringify(added);
  rows.forEach((p, i) => insRun.run(filmId, String(campaignId || ''), p.id, out.version, prev.get(p.id) || 0, endsAt, i === 0 ? planJson : '[]'));
  // Sans écran jumelé, une ligne par magasin (sans écran) porte la fin de la semaine type.
  if (!rows.length) insRun.run(filmId, String(campaignId || ''), '', out.version, 0, endsAt, planJson);
  return { status: 200, json: { ...out, players: rows.map((p) => p.id), stores: links, scheduled, activateAt: scheduled ? brusselsStart(from) : null, endsAt, planCells: added.length } };
}

// Passe régulière : les diffusions arrivées à leur fin rendent la main.
export function sweepCampaignRuns(now = new Date()) {
  ensureCampaignRuns();
  const db = getDb();
  const due = db.prepare("SELECT * FROM sig_campaign_runs WHERE done_at IS NULL AND ends_at != '' AND ends_at <= ?").all(now.toISOString());
  if (!due.length) return 0;
  const back = db.prepare('UPDATE sig_players SET assigned_ver = ?, activate_at = NULL WHERE id = ? AND assigned_ver = ?');
  const del = db.prepare('DELETE FROM sig_weekplans WHERE store_id = ? AND week = ? AND day = ? AND moment = ? AND film_id = ?');
  const done = db.prepare("UPDATE sig_campaign_runs SET done_at = datetime('now') WHERE id = ?");
  for (const r of due) {
    // Seulement si l'écran joue encore CETTE diffusion : une publication
    // faite depuis garde la main.
    if (r.prev_ver) back.run(r.prev_ver, r.player_id, r.version);
    let plan = [];
    try { plan = JSON.parse(r.plan || '[]'); } catch { plan = []; }
    for (const c of plan) del.run(c.store, c.week, c.day, c.moment, r.film_id);
    done.run(r.id);
  }
  return due.length;
}

export function campaignRunsOf(filmId) {
  ensureCampaignRuns();
  return getDb().prepare('SELECT player_id, version, prev_ver, ends_at, done_at, created_at FROM sig_campaign_runs WHERE film_id = ? ORDER BY id DESC').all(String(filmId))
    .map((r) => ({ playerId: r.player_id, version: r.version, prevVer: r.prev_ver, endsAt: r.ends_at, doneAt: r.done_at, at: r.created_at }));
}
