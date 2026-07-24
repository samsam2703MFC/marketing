// Connexion directe à la base PWA existante (tables product / shop_product /
// product_category) pour importer le catalogue dans les tables sig_*.
//
// Zéro dépendance npm : on passe par le client mysql/mariadb déjà présent sur
// le serveur (installé par le provisioning). Les requêtes SQL sont
// configurables — l'important est l'ORDRE des colonnes retournées :
//   catégories : id, nom
//   produits   : id, id_catégorie, nom, prix[, actif]
//   prix/magasin : id_produit, id_boutique, prix
//   alias (optionnel) : id_produit, langue, nom
import { execFile } from 'node:child_process';
import { getDb, getSetting, setSetting, saveCatalog, loadCatalog } from './db.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 3306,
  db: '',
  user: '',
  password: '',
  qCategories: 'SELECT id, name FROM product_category',
  qProducts: 'SELECT id, category_id, name, price, active FROM product',
  qShopPrices: 'SELECT product_id, shop_id, price FROM shop_product',
  qAliases: '',
  shopMap: {},
};

export function pwaConfig() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(getSetting('pwa_import', '{}')) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePwaConfig(patch) {
  const cur = pwaConfig();
  const next = { ...cur };
  for (const k of ['host', 'db', 'user', 'qCategories', 'qProducts', 'qShopPrices', 'qAliases']) {
    if (patch[k] != null) next[k] = String(patch[k]);
  }
  if (patch.port != null) next.port = Math.max(1, Math.min(65535, parseInt(patch.port, 10) || 3306));
  // Le mot de passe n'est remplacé que s'il est fourni (jamais renvoyé au client).
  if (patch.password != null && String(patch.password) !== '') next.password = String(patch.password);
  if (patch.clearPassword) next.password = '';
  if (patch.shopMap && typeof patch.shopMap === 'object') {
    next.shopMap = {};
    for (const [k, v] of Object.entries(patch.shopMap)) if (String(v).trim()) next.shopMap[k] = String(v).trim();
  }
  setSetting('pwa_import', JSON.stringify(next));
  return publicPwaConfig();
}

// Version montrable au client : jamais le mot de passe en clair.
export function publicPwaConfig() {
  const c = pwaConfig();
  return { ...c, password: '', hasPassword: !!c.password };
}

function mysqlRows(cfg, sql) {
  const run = (bin) => new Promise((resolve, reject) => {
    const args = [
      '-h', cfg.host || '127.0.0.1', '-P', String(cfg.port || 3306),
      '-u', cfg.user, cfg.db, '--batch', '--raw', '-N', '--connect-timeout=8', '-e', sql,
    ];
    execFile(bin, args, {
      env: { ...process.env, MYSQL_PWD: cfg.password || '' },
      timeout: 20000, maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        err._stderr = (stderr || err.message || '').trim().split('\n')[0];
        return reject(err);
      }
      resolve(String(stdout).split('\n').filter((l) => l.length).map((l) => l.split('\t').map((c) => (c === 'NULL' ? '' : c))));
    });
  });
  return run('mysql').catch((e) => {
    if (e.code === 'ENOENT') {
      return run('mariadb').catch((e2) => {
        if (e2.code === 'ENOENT') throw new Error('client mysql/mariadb introuvable sur le serveur — installe mariadb-client');
        throw new Error(e2._stderr || e2.message);
      });
    }
    throw new Error(e._stderr || e.message);
  });
}

function checkCfg(cfg) {
  if (!cfg.db || !cfg.user) throw new Error('configuration incomplète — renseigne base et utilisateur dans Paramètres');
}

export async function testPwa() {
  const cfg = pwaConfig();
  checkCfg(cfg);
  const counts = {};
  for (const [key, q] of [['catégories', cfg.qCategories], ['produits', cfg.qProducts], ['prix/magasin', cfg.qShopPrices]]) {
    const rows = await mysqlRows(cfg, `SELECT COUNT(*) FROM (${q.replace(/;\s*$/, '')}) AS t`);
    counts[key] = parseInt((rows[0] || ['0'])[0], 10) || 0;
  }
  return { ok: true, counts };
}

// Prix PWA (souvent « 12.50 ») → format d'affichage (« 12,50 »).
const frPrice = (v) => String(v == null ? '' : v).trim().replace('.', ',');

export async function importPwa() {
  const cfg = pwaConfig();
  checkCfg(cfg);
  const catRows = await mysqlRows(cfg, cfg.qCategories);
  const prodRows = await mysqlRows(cfg, cfg.qProducts);
  const priceRows = cfg.qShopPrices.trim() ? await mysqlRows(cfg, cfg.qShopPrices) : [];
  const aliasRows = cfg.qAliases.trim() ? await mysqlRows(cfg, cfg.qAliases) : [];

  const categories = catRows.map(([id, name]) => ({ id: `pw${id}`, name: name || `Catégorie ${id}`, active: true, aliases: {} }));
  const catIds = new Set(categories.map((c) => c.id));

  const products = prodRows.map(([id, catId, name, price, active]) => ({
    id: `pwp${id}`,
    categoryId: catIds.has(`pw${catId}`) ? `pw${catId}` : '',
    name: name || `Produit ${id}`,
    price: frPrice(price) || '0,00',
    img: 'assets/cake.png', src: 'illus',
    active: active == null || !(active === '0' || active === '' || /^(false|no|non)$/i.test(active)),
    prices: {}, aliases: {},
  }));
  const byId = new Map(products.map((p) => [p.id, p]));

  // shop_product : prix par boutique PWA → magasin signage via le mapping.
  const extToStore = {};
  for (const [storeId, extId] of Object.entries(cfg.shopMap || {})) extToStore[String(extId)] = storeId;
  let nPrices = 0;
  for (const [prodId, shopId, price] of priceRows) {
    const p = byId.get(`pwp${prodId}`);
    const storeId = extToStore[String(shopId)];
    if (p && storeId && frPrice(price)) { p.prices[storeId] = frPrice(price); nPrices++; }
  }

  let nAliases = 0;
  for (const [prodId, lang, name] of aliasRows) {
    const p = byId.get(`pwp${prodId}`);
    if (p && lang && name) { p.aliases[String(lang).toLowerCase().slice(0, 2)] = name; nAliases++; }
  }

  // Les éléments liés à une catégorie de l'ancien catalogue sont re-liés par
  // nom (insensible à la casse) pour ne pas casser les films existants.
  const db = getDb();
  const oldCats = loadCatalog().categories;
  const oldName = new Map(oldCats.map((c) => [c.id, (c.name || '').trim().toLowerCase()]));
  const newByName = new Map(categories.map((c) => [(c.name || '').trim().toLowerCase(), c.id]));

  saveCatalog({ categories, products });

  let relinked = 0;
  const linked = db.prepare(`SELECT id, cat_ref FROM sig_modules WHERE cat_ref != ''`).all();
  const upd = db.prepare('UPDATE sig_modules SET cat_ref = ? WHERE id = ?');
  for (const m of linked) {
    if (catIds.has(m.cat_ref)) continue;
    const target = newByName.get(oldName.get(m.cat_ref) || '');
    if (target) { upd.run(target, m.id); relinked++; }
  }

  return {
    ok: true,
    categories: categories.length,
    products: products.length,
    storePrices: nPrices,
    aliases: nAliases,
    relinked,
  };
}
