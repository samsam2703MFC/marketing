// Catalogue de la régie lu sur l'API TFBuddy — la source principale ; la base
// PWA (server/pwadb.js) reste en secours. Mêmes identifiants que l'import PWA
// (catégorie pw{id}, produit pwp{id} : TFBuddy et la PWA partagent leurs ids),
// donc bundles, promotions, éléments liés et périodes restent reliés.
//
// Ce qui appartient à la régie survit à l'import : visuel et rupture d'un
// produit, illustration d'une catégorie, noms traduits, ordre des listes.
// Rien n'est effacé : une référence que TFBuddy ne liste plus reste, inactive ;
// ce qui a été créé à la main en régie (ids hors pw…) reste tel quel.
//
// Prix : chaque magasin relié garde SON prix pratiqué (TTC) ; le prix de base
// est celui que pratiquent le plus de magasins. Une référence qu'aucun magasin
// ne vend et dont la régie ne connaît aucun prix reste inactive : un produit à
// 0,00 € ne s'affiche pas. Les magasins TFBuddy sont reliés comme pour les
// bundles (correspondance manuelle de l'import PWA, puis slug / nom) ; un
// magasin non relié est signalé, jamais créé.
import { getDb, loadCatalog, saveCatalog, getSetting, setSetting } from './db.js';
import { fetchCatalog, tfbConfigured } from './tfbuddy.js';
import { pwaConfig, matchStore, importPwa, pwaBaseName } from './pwadb.js';

const eur = (n) => n.toFixed(2).replace('.', ',');
const isImported = (id) => /^pwp?\d+$/.test(String(id));
// Le prix le plus pratiqué ; à égalité, le plus bas.
const mostCommon = (list) => {
  const n = new Map();
  for (const x of list) n.set(x, (n.get(x) || 0) + 1);
  let best = null;
  for (const [x, c] of n) if (best == null || c > n.get(best) || (c === n.get(best) && x < best)) best = x;
  return best;
};

export function catalogImportStatus() {
  try { return JSON.parse(getSetting('catalog_import', '{}')) || {}; } catch { return {}; }
}

// Les éléments liés à une catégorie qui n'existe plus sont re-liés par nom
// (insensible à la casse), comme après l'import PWA.
function relinkByName(oldCats, newCats) {
  const db = getDb();
  const ids = new Set(newCats.map((c) => c.id));
  const oldName = new Map(oldCats.map((c) => [c.id, (c.name || '').trim().toLowerCase()]));
  const newByName = new Map(newCats.filter((c) => c.active !== false).map((c) => [(c.name || '').trim().toLowerCase(), c.id]));
  const upd = db.prepare('UPDATE sig_modules SET cat_ref = ? WHERE id = ?');
  let n = 0;
  for (const m of db.prepare("SELECT id, cat_ref FROM sig_modules WHERE cat_ref != ''").all()) {
    if (ids.has(m.cat_ref)) continue;
    const target = newByName.get(oldName.get(m.cat_ref) || '');
    if (target) { upd.run(target, m.id); n++; }
  }
  return n;
}

export async function importTfbCatalog() {
  const t0 = Date.now();
  const data = await fetchCatalog();
  if (!data.products.length) {
    throw new Error(`TFBuddy n'a rendu aucun produit${data.warnings.length ? ` (${data.warnings[0]})` : ''} — catalogue gardé tel quel`);
  }
  const db = getDb();
  const manualMap = {};
  for (const [storeId, extId] of Object.entries(pwaConfig().shopMap || {})) manualMap[String(extId)] = storeId;
  const sigStores = db.prepare('SELECT id, name FROM sig_stores').all();
  const byExt = new Map(data.shops.map((s) => [s.id, s]));
  const storeOf = (ext) => manualMap[ext] || (byExt.has(ext) ? ((matchStore(byExt.get(ext), sigStores).match || {}).id || '') : '');

  const before = loadCatalog();
  const prevCat = new Map(before.categories.map((c, i) => [c.id, { ...c, i }]));
  const prevProd = new Map(before.products.map((p, i) => [p.id, { ...p, i }]));

  // Catégories : celles de TFBuddy, puis celles de la régie qu'il ne liste pas.
  const categories = [];
  const seenCat = new Set();
  for (const c of data.categories) {
    const id = `pw${c.extId}`;
    if (seenCat.has(id)) continue;
    seenCat.add(id);
    const old = prevCat.get(id);
    categories.push({ id, name: c.name, active: c.active, img: (old && old.img) || '', aliases: (old && old.aliases) || {}, o: old ? old.i : Infinity, n: categories.length });
  }
  let retiredCats = 0;
  for (const old of before.categories) {
    if (seenCat.has(old.id)) continue;
    const imp = isImported(old.id);
    if (imp && old.active !== false) retiredCats++;
    categories.push({ ...old, active: imp ? false : old.active, o: prevCat.get(old.id).i, n: categories.length });
  }

  // Prix pratiqués : par magasin relié, et le plus courant comme prix de base.
  const pricesOf = new Map();
  const storePrices = new Map();
  const unmapped = new Set();
  const mapped = new Set();
  let nPrices = 0;
  for (const r of data.prices) {
    if (!pricesOf.has(r.extProductId)) pricesOf.set(r.extProductId, []);
    pricesOf.get(r.extProductId).push(r.price);
    const sid = storeOf(r.extShopId);
    if (!sid) { unmapped.add(r.extShopId); continue; }
    mapped.add(sid);
    if (!storePrices.has(r.extProductId)) storePrices.set(r.extProductId, {});
    storePrices.get(r.extProductId)[sid] = eur(r.price);
    nPrices++;
  }

  const catIds = new Set(categories.map((c) => c.id));
  const products = [];
  const seenProd = new Set();
  let kept = 0;
  let noPrice = 0;
  for (const p of data.products) {
    const id = `pwp${p.extId}`;
    if (seenProd.has(id)) continue;
    seenProd.add(id);
    const old = prevProd.get(id);
    const base = pricesOf.has(p.extId) ? eur(mostCommon(pricesOf.get(p.extId)))
      : (old && old.price && old.price !== '0,00' ? old.price : '');
    if (!base) noPrice++;
    if (old && old.img && old.img !== 'assets/cake.png') kept++;
    products.push({
      id,
      categoryId: p.catExtId && catIds.has(`pw${p.catExtId}`) ? `pw${p.catExtId}` : ((old && old.categoryId) || ''),
      name: p.name || (old && old.name) || `Produit ${p.extId}`,
      price: base || '0,00',
      img: (old && old.img) || 'assets/cake.png',
      src: old && old.src === 'photo' ? 'photo' : 'illus',
      unavailable: !!(old && old.unavailable),
      active: p.active && !!base,
      prices: storePrices.get(p.extId) || {},
      aliases: (old && old.aliases) || {},
      o: old ? old.i : Infinity, n: products.length,
    });
  }
  let retired = 0;
  for (const old of before.products) {
    if (seenProd.has(old.id)) continue;
    const imp = isImported(old.id);
    if (imp && old.active !== false) retired++;
    products.push({ ...old, active: imp ? false : old.active, o: prevProd.get(old.id).i, n: products.length });
  }

  // L'ordre de la régie d'abord ; les nouveautés à la suite, dans l'ordre de TFBuddy.
  const order = (a, b) => (a.o - b.o) || (a.n - b.n);
  const strip = ({ o, n, ...x }) => x;
  const cats = categories.sort(order).map(strip);
  saveCatalog({ categories: cats, products: products.sort(order).map(strip) });
  const relinked = relinkByName(before.categories, cats);

  const out = {
    ok: true, source: 'tfbuddy', at: new Date().toISOString(), ms: Date.now() - t0,
    categories: data.categories.length,
    products: data.products.length,
    sold: data.products.filter((p) => p.sold).length,
    storePrices: nPrices,
    stores: mapped.size,
    relinked,
    ...(retired ? { retired } : {}),
    ...(retiredCats ? { retiredCats } : {}),
    ...(noPrice ? { noPrice } : {}),
    ...(kept ? { visuelsConserves: kept } : {}),
    ...(unmapped.size ? { unmappedShops: [...unmapped].sort((a, b) => Number(a) - Number(b)) } : {}),
    ...(data.warnings.length ? { warnings: data.warnings.slice(0, 12) } : {}),
  };
  return out;
}

// L'import demandé en régie (ou l'automatique) : l'API d'abord ; si elle n'est
// pas configurée ou ne répond pas, la base PWA — dit tel quel dans le résultat.
// `source` : 'auto' (défaut), 'tfbuddy' (sans secours) ou 'pwa'.
let running = null;
export function importCatalog({ source = 'auto', fallback = true } = {}) {
  if (running) return running;
  running = (async () => {
    const prev = catalogImportStatus();
    let out;
    let apiError = '';
    if (source !== 'pwa') {
      if (!tfbConfigured()) apiError = 'compte TFBuddy non configuré (secrets TFBUDDY_PHONE et TFBUDDY_PASSWORD)';
      else {
        try { out = await importTfbCatalog(); } catch (e) { apiError = String(e.message || e); }
      }
    }
    if (!out && (source === 'pwa' || (source === 'auto' && fallback))) {
      try {
        // La base MySQL détectée à l'import devient la cible du miroir (comme /pwa-import).
        if (!getSetting('mirror_db', '')) { const b = await pwaBaseName().catch(() => ''); if (b) setSetting('mirror_db', b); }
        const r = await importPwa();
        out = r && r.ok
          ? { ...r, source: 'pwa', at: new Date().toISOString(), ...(apiError ? { apiError } : {}) }
          : { ok: false, source: 'pwa', at: new Date().toISOString(), error: (r && r.error) || 'import PWA en échec', ...(apiError ? { apiError } : {}) };
      } catch (e) {
        out = { ok: false, source: 'pwa', at: new Date().toISOString(), error: String(e.message || e), ...(apiError ? { apiError } : {}) };
      }
    }
    if (!out) out = { ok: false, source: 'tfbuddy', at: new Date().toISOString(), error: apiError || 'import impossible' };
    const lastOk = out.ok ? out.at : (prev.ok ? prev.at : (prev.lastOk || null));
    const st = { ...out, ...(out.ok ? {} : { lastOk, lastOkSource: prev.ok ? prev.source : (prev.lastOkSource || '') }) };
    setSetting('catalog_import', JSON.stringify(st));
    return st;
  })().finally(() => { running = null; });
  return running;
}

// Rafraîchissement quotidien depuis l'API (si le compte est configuré), sans
// repli automatique sur la base PWA : en cas d'échec, le catalogue reste tel
// quel et l'erreur est dite en régie. SIG_CATALOG_AUTO=0 le coupe.
export function startCatalogSync(onDone = () => {}) {
  if (process.env.SIG_CATALOG_AUTO === '0') return;
  const tick = async () => {
    if (!tfbConfigured()) return;
    const st = catalogImportStatus();
    const lastApi = st.source === 'tfbuddy' && st.ok ? Date.parse(st.at) : (st.lastOkSource === 'tfbuddy' ? Date.parse(st.lastOk || '') : 0);
    const lastTry = Date.parse(st.at || '') || 0;
    // Une fois par jour ; après un échec, nouvel essai six heures plus tard.
    if (lastApi && Date.now() - lastApi < 20 * 3600 * 1000) return;
    if (!st.ok && lastTry && Date.now() - lastTry < 6 * 3600 * 1000) return;
    try { onDone(await importCatalog({ source: 'tfbuddy', fallback: false })); } catch { /* dit dans le statut */ }
  };
  setTimeout(tick, 2 * 60000);
  setInterval(tick, 60 * 60000);
}
