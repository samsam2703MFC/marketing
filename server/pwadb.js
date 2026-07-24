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
    // Sans utilisateur configuré : connexion par la socket locale (la régie
    // tourne sur le serveur des bases, en root → auth unix_socket).
    const args = [];
    if (cfg.user) {
      args.push('-h', cfg.host || '127.0.0.1', '-P', String(cfg.port || 3306), '-u', cfg.user);
    }
    if (cfg.db) args.push(cfg.db);
    args.push('--batch', '--raw', '-N', '--connect-timeout=8', '-e', sql);
    execFile(bin, args, {
      env: { ...process.env, MYSQL_PWD: cfg.password || '' },
      timeout: 20000, maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        // Le client mysql ré-affiche la requête entre lignes de tirets avant
        // le message : on remonte la ligne « ERROR … », pas le séparateur.
        const lines = (stderr || err.message || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
        err._stderr = lines.find((l) => /^ERROR/i.test(l)) || lines.find((l) => !/^-+$/.test(l)) || 'erreur mysql';
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

// ---------------------------------------------------------------------------
// Mode « un bouton » : tout est détecté automatiquement — la base qui contient
// product / product_category / shop_product, puis les colonnes utiles.
const qid = (x) => '`' + String(x).replace(/`/g, '') + '`';

async function detectSchema(cfg) {
  if (cfg.db) return cfg.db;
  const rows = await mysqlRows(cfg, `
    SELECT table_schema FROM information_schema.tables
    WHERE table_name IN ('product', 'product_category', 'shop_product')
      AND table_schema NOT IN ('mysql', 'sys', 'information_schema', 'performance_schema')
    GROUP BY table_schema
    HAVING COUNT(DISTINCT table_name) = 3
    ORDER BY table_schema`);
  if (!rows.length) throw new Error('aucune base avec les 3 tables product / product_category / shop_product — précise-la dans Réglages avancés');
  return rows[0][0];
}

async function tableCols(cfg, schema, table) {
  const rows = await mysqlRows(cfg, `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = '${schema.replace(/'/g, '')}' AND table_name = '${table}'
    ORDER BY ordinal_position`);
  return rows.map((r) => r[0]);
}

async function primaryKey(cfg, schema, table) {
  const rows = await mysqlRows(cfg, `
    SELECT column_name FROM information_schema.key_column_usage
    WHERE table_schema = '${schema.replace(/'/g, '')}' AND table_name = '${table}' AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position LIMIT 1`);
  return rows.length ? rows[0][0] : null;
}

// Colonne de liaison via la CLÉ ÉTRANGÈRE déclarée (le lien product →
// product_category se fait par une colonne de la table product : la contrainte
// dit exactement laquelle, quel que soit son nom).
async function fkColumn(cfg, schema, table, referencedTable) {
  const rows = await mysqlRows(cfg, `
    SELECT column_name FROM information_schema.key_column_usage
    WHERE table_schema = '${schema.replace(/'/g, '')}' AND table_name = '${table}'
      AND referenced_table_name = '${referencedTable.replace(/'/g, '')}'
    ORDER BY ordinal_position LIMIT 1`);
  return rows.length ? rows[0][0] : null;
}

function pickCol(cols, wanted, what, table, contains) {
  const low = new Map(cols.map((c) => [c.toLowerCase(), c]));
  for (const w of wanted) if (low.has(w)) return low.get(w);
  // Dernier recours : une colonne dont le nom contient le motif (ex. « categ »).
  if (contains) {
    const hit = cols.find((c) => c.toLowerCase().includes(contains));
    if (hit) return hit;
  }
  if (what === 'optionnel') return null;
  throw new Error(`colonne « ${what} » introuvable dans ${table} (colonnes : ${cols.join(', ')}) — ajuste les requêtes dans Réglages avancés`);
}

// Détecte base + colonnes et fabrique les 3 requêtes automatiquement.
export async function autoQueries(cfg) {
  const db = await detectSchema(cfg);
  const q = (t) => `${qid(db)}.${qid(t)}`;

  const catCols = await tableCols(cfg, db, 'product_category');
  const catId = (await primaryKey(cfg, db, 'product_category')) || pickCol(catCols, ['id', 'id_product_category', 'category_id'], 'id', 'product_category');
  const catName = pickCol(catCols, ['name', 'label', 'title', 'libelle', 'nom', 'designation', 'alias'], 'nom', 'product_category');

  const prodCols = await tableCols(cfg, db, 'product');
  const prodId = (await primaryKey(cfg, db, 'product')) || pickCol(prodCols, ['id', 'id_product', 'product_id'], 'id', 'product');
  // Le lien produit → catégorie est porté par la table product : la clé
  // étrangère vers product_category le dit exactement, sinon noms usuels.
  const prodCat = (await fkColumn(cfg, db, 'product', 'product_category'))
    || pickCol(prodCols, ['category_id', 'id_category', 'product_category_id', 'id_product_category', 'product_category', 'category', 'categorie', 'id_categorie', 'cat_id', 'categoryid', 'fk_category'], 'catégorie', 'product', 'categ');
  const prodName = pickCol(prodCols, ['name', 'label', 'title', 'libelle', 'nom', 'designation', 'alias'], 'nom', 'product');
  const prodPrice = pickCol(prodCols, ['price', 'prix', 'price_ttc', 'amount', 'price_ht', 'tarif'], 'prix', 'product', 'price');
  const prodActive = pickCol(prodCols, ['active', 'enabled', 'visible', 'actif', 'status'], 'optionnel');

  const spCols = await tableCols(cfg, db, 'shop_product');
  const spProd = (await fkColumn(cfg, db, 'shop_product', 'product'))
    || pickCol(spCols, ['product_id', 'id_product', 'fk_product'], 'produit', 'shop_product', 'product');
  const spShop = (await fkColumn(cfg, db, 'shop_product', 'shop'))
    || pickCol(spCols, ['shop_id', 'id_shop', 'store_id', 'id_store', 'boutique_id', 'fk_shop'], 'boutique', 'shop_product', 'shop');
  const spPrice = pickCol(spCols, ['price', 'prix', 'price_ttc', 'amount', 'price_ht', 'tarif'], 'prix', 'shop_product', 'price');

  return {
    db,
    qCategories: `SELECT ${qid(catId)}, ${qid(catName)} FROM ${q('product_category')}`,
    qProducts: `SELECT ${qid(prodId)}, ${qid(prodCat)}, ${qid(prodName)}, ${qid(prodPrice)}${prodActive ? `, ${qid(prodActive)}` : ''} FROM ${q('product')}`,
    qShopPrices: `SELECT ${qid(spProd)}, ${qid(spShop)}, ${qid(spPrice)} FROM ${q('shop_product')}`,
  };
}

// Requêtes effectives : celles de l'utilisateur s'il les a VRAIMENT
// personnalisées (comparaison insensible aux espaces) ET base précisée,
// sinon l'auto-détection.
async function effectiveQueries(cfg) {
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const customized = norm(cfg.qCategories) !== norm(DEFAULTS.qCategories)
    || norm(cfg.qProducts) !== norm(DEFAULTS.qProducts)
    || norm(cfg.qShopPrices) !== norm(DEFAULTS.qShopPrices);
  if (customized && cfg.db) {
    return { db: cfg.db, qCategories: cfg.qCategories, qProducts: cfg.qProducts, qShopPrices: cfg.qShopPrices, auto: false };
  }
  return { ...(await autoQueries(cfg)), auto: true };
}

// Filet de sécurité : si les réglages enregistrés échouent (colonne inconnue,
// mauvaise base…), on retombe automatiquement sur l'auto-détection — d'abord
// dans la base configurée, puis en redétectant la base elle-même.
async function withAutoFallback(cfg, fn) {
  let queries = null;
  try {
    queries = await effectiveQueries(cfg);
    return await fn(queries);
  } catch (e1) {
    if (queries && queries.auto && !cfg.db) throw e1; // déjà en auto complet
    try {
      const q2 = { ...(await autoQueries(cfg)), auto: true };
      const out = await fn(q2);
      out.note = 'réglages avancés en échec — colonnes auto-détectées à la place';
      return out;
    } catch {
      const q3 = { ...(await autoQueries({ ...cfg, db: '' })), auto: true };
      const out = await fn(q3);
      out.note = 'réglages avancés en échec — base et colonnes redétectées automatiquement';
      return out;
    }
  }
}

async function doTest(cfg, queries) {
  const counts = {};
  for (const [key, q] of [['catégories', queries.qCategories], ['produits', queries.qProducts], ['prix/boutique', queries.qShopPrices]]) {
    const rows = await mysqlRows(cfg, `SELECT COUNT(*) FROM (${q.replace(/;\s*$/, '')}) AS t`);
    counts[key] = parseInt((rows[0] || ['0'])[0], 10) || 0;
  }
  return { ok: true, db: queries.db, auto: queries.auto, counts };
}

export async function testPwa() {
  const cfg = pwaConfig();
  return withAutoFallback(cfg, (queries) => doTest(cfg, queries));
}

// Remise à zéro des réglages avancés (répare une vieille config cassée).
export function resetPwaConfig() {
  setSetting('pwa_import', '{}');
  return publicPwaConfig();
}

// Prix PWA (souvent « 12.50 ») → format d'affichage (« 12,50 »).
const frPrice = (v) => String(v == null ? '' : v).trim().replace('.', ',');

export async function importPwa() {
  const cfg = pwaConfig();
  return withAutoFallback(cfg, (queries) => doImport(cfg, queries));
}

async function doImport(cfg, queries) {
  const catRows = await mysqlRows(cfg, queries.qCategories);
  const prodRows = await mysqlRows(cfg, queries.qProducts);
  const priceRows = queries.qShopPrices.trim() ? await mysqlRows(cfg, queries.qShopPrices) : [];
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

  // shop_product : prix par boutique PWA → magasin signage. Mapping manuel
  // (Réglages avancés) s'il existe, sinon automatique : boutiques triées par
  // id, associées dans l'ordre aux magasins signage.
  const db0 = getDb();
  const sigStores = db0.prepare('SELECT id, name FROM sig_stores ORDER BY id').all();
  const extToStore = {};
  if (Object.keys(cfg.shopMap || {}).length) {
    for (const [storeId, extId] of Object.entries(cfg.shopMap)) extToStore[String(extId)] = storeId;
  } else {
    const shopIds = [...new Set(priceRows.map((r) => String(r[1])))]
      .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    shopIds.forEach((extId, i) => { if (sigStores[i]) extToStore[extId] = sigStores[i].id; });
  }
  const mapLabel = Object.entries(extToStore)
    .map(([ext, sid]) => `${ext}→${(sigStores.find((x) => x.id === sid) || {}).name || sid}`)
    .join(' · ');
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
    db: queries.db,
    auto: queries.auto,
    shopMap: mapLabel || 'aucune boutique mappée',
    categories: categories.length,
    products: products.length,
    storePrices: nPrices,
    aliases: nAliases,
    relinked,
  };
}
