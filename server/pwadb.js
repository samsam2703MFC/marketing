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

// Nom de la base MySQL de la PWA (best-effort) — cible par défaut du miroir.
export async function pwaBaseName() {
  try { return await detectSchema(pwaConfig()); } catch { return ''; }
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

// Table shops de la PWA (id + slug + nom) : c'est elle qui fait le lien entre
// les id_shop de shop_product et les magasins signage.
// Ramène un code langue quelconque (« fr », « FR », « fr_BE », « français »,
// « dutch »…) vers un de nos identifiants supportés (fr / nl / en / de).
function normLang(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(nl|nld|dut|vla|flemish|neerlandais|néerlandais)/.test(s) || s.startsWith('nl_')) return 'nl';
  if (/^(en|eng|ang|anglais|english)/.test(s) || s.startsWith('en_')) return 'en';
  if (/^(de|deu|ger|all|allemand|deutsch|german)/.test(s) || s.startsWith('de_')) return 'de';
  if (/^(fr|fra|fre|français|francais|french)/.test(s) || s.startsWith('fr_')) return 'fr';
  return '';
}

// Table des langues de la PWA (id → code iso) pour résoudre un language_id.
async function langMap(cfg, db) {
  for (const t of ['language', 'lang', 'languages', 'langue', 'langues']) {
    try {
      const cols = await tableCols(cfg, db, t);
      if (!cols.length) continue;
      const id = (await primaryKey(cfg, db, t)) || pickCol(cols, ['id', 'id_lang', 'language_id'], 'id', t);
      const code = pickCol(cols, ['iso_code', 'code', 'locale', 'iso', 'slug', 'lang', 'name', 'label'], 'optionnel');
      if (!code) continue;
      const rows = await mysqlRows(cfg, `SELECT ${qid(id)}, ${qid(code)} FROM ${qid(db)}.${qid(t)}`);
      const m = new Map();
      for (const [i, c] of rows) { const n = normLang(c); if (n) m.set(String(i), n); }
      if (m.size) return m;
    } catch { /* table absente : suivante */ }
  }
  return null;
}

async function detectShops(cfg, db) {
  for (const t of ['shops', 'shop']) {
    try {
      const cols = await tableCols(cfg, db, t);
      if (!cols.length) continue;
      const id = (await primaryKey(cfg, db, t)) || pickCol(cols, ['id', 'id_shop', 'shop_id'], 'id', t);
      const slug = pickCol(cols, ['slug', 'code', 'alias'], 'optionnel');
      const name = pickCol(cols, ['name', 'label', 'title', 'nom', 'libelle'], 'optionnel');
      const active = pickCol(cols, ['active', 'enabled', 'visible', 'actif', 'status'], 'optionnel');
      if (!slug && !name) continue;
      // Langue préférée du shop : d'abord une colonne code direct
      // (lang / locale), sinon un id de langue (preferred_language_id…).
      const langCode = pickCol(cols, ['lang', 'locale', 'langue', 'language', 'default_lang', 'iso_code'], 'optionnel');
      const langId = langCode ? null
        : pickCol(cols, ['preferred_language_id', 'language_id', 'id_lang', 'default_language_id', 'lang_id', 'default_lang_id'], 'optionnel');
      const langSel = langCode ? qid(langCode) : (langId ? qid(langId) : "''");
      const idMap = langId ? await langMap(cfg, db) : null;
      const rows = await mysqlRows(cfg, `SELECT ${qid(id)}, ${slug ? qid(slug) : "''"}, ${name ? qid(name) : "''"}, ${active ? qid(active) : "'1'"}, ${langSel} FROM ${qid(db)}.${qid(t)}`);
      const all = rows.map(([i, sl, nm, act, lg]) => ({
        id: String(i), slug: String(sl || '').trim(), name: String(nm || '').trim(),
        active: act == null || !(act === '0' || act === '' || /^(false|no|non)$/i.test(String(act))),
        lang: langCode ? normLang(lg) : (idMap ? (idMap.get(String(lg)) || '') : ''),
      }));
      const langFound = langCode ? `colonne « ${langCode} »` : (langId ? `id de langue « ${langId} »${idMap ? '' : ' (table des langues introuvable)'}` : '');
      return { shops: all, inactive: all.filter((x) => !x.active).length, langFound };
    } catch { /* table absente ou illisible : on essaie la suivante */ }
  }
  return { shops: [], inactive: 0, langFound: '' };
}

// P\u00e9riodes de l'ann\u00e9e depuis ws_season (best-effort : colonnes auto-d\u00e9tect\u00e9es).
// `preferred` : nom de table impos\u00e9 par l'utilisateur (R\u00e9glages avanc\u00e9s).
async function tableColsTyped(cfg, schema, table) {
  const rows = await mysqlRows(cfg, `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = '${String(schema).replace(/'/g, '')}' AND table_name = '${String(table).replace(/'/g, '')}'
    ORDER BY ordinal_position`);
  return rows.map((r) => ({ name: r[0], type: String(r[1] || '').toLowerCase() }));
}

// Enrichissement best-effort pour le motif « table de base + <table>_connection
// + <table>_name_alias » (schéma type PrestaShop : les dates sont dans la table
// de base, les produits liés dans une table de liaison, les libellés i18n dans
// une table d'alias). Chaque étape est isolée : si une table sœur manque, on
// garde simplement ce qu'on a déjà détecté dans la table de base.
async function enrichSeasons(cfg, db, baseTable, seasons, rawIds) {
  // Produits : table de liaison <base>_connection (via les clés étrangères).
  try {
    const connTable = `${baseTable}_connection`;
    const connCols = await tableCols(cfg, db, connTable);
    if (connCols.length) {
      const periodFk = (await fkColumn(cfg, db, connTable, baseTable))
        || pickCol(connCols, [`${baseTable}_id`, 'period_id', 'id_period', 'season_id'], 'optionnel', connTable, 'period');
      const prodFk = (await fkColumn(cfg, db, connTable, 'product'))
        || pickCol(connCols, ['product_id', 'id_product'], 'optionnel', connTable, 'product');
      if (periodFk && prodFk) {
        const rows = await mysqlRows(cfg, `SELECT ${qid(periodFk)}, ${qid(prodFk)} FROM ${qid(db)}.${qid(connTable)}`);
        const byPeriod = new Map();
        for (const [pid, prod] of rows) {
          const key = String(pid);
          if (!byPeriod.has(key)) byPeriod.set(key, []);
          if (String(prod).trim()) byPeriod.get(key).push(`pwp${String(prod).trim()}`);
        }
        seasons.forEach((s, k) => { const list = byPeriod.get(String(rawIds[k])); if (list && list.length) s.products = list; });
      }
    }
  } catch { /* pas de table de liaison : on garde les produits de la table de base */ }
  // Libellés : table i18n <base>_name_alias (une ligne par langue → on préfère le fr).
  try {
    const aliasTable = `${baseTable}_name_alias`;
    const aliasColsT = await tableColsTyped(cfg, db, aliasTable);
    const aliasCols = aliasColsT.map((c) => c.name);
    if (aliasCols.length) {
      const periodFk = (await fkColumn(cfg, db, aliasTable, baseTable))
        || pickCol(aliasCols, [`${baseTable}_id`, 'period_id', 'id_period', 'season_id'], 'optionnel', aliasTable, 'period');
      const locale = pickCol(aliasCols, ['locale', 'lang', 'language', 'lang_code', 'id_lang', 'langue'], 'optionnel');
      const label = pickCol(aliasCols, ['name', 'title', 'label', 'nom', 'libelle', 'designation'], 'optionnel')
        || (aliasColsT.find((c) => /char|text/.test(c.type) && c.name !== periodFk && c.name !== locale) || {}).name || null;
      if (periodFk && label) {
        const rows = await mysqlRows(cfg, `SELECT ${qid(periodFk)}, ${qid(label)}${locale ? `, ${qid(locale)}` : ''} FROM ${qid(db)}.${qid(aliasTable)}`);
        const byPeriod = new Map();
        for (const r of rows) {
          const key = String(r[0]); const val = String(r[1] || '').trim();
          if (!val) continue;
          const loc = locale ? String(r[2] || '').toLowerCase() : '';
          const cur = byPeriod.get(key);
          // On garde la 1re valeur rencontrée, mais une langue française l'emporte.
          if (!cur || (/fr/.test(loc) && !/fr/.test(cur.loc))) byPeriod.set(key, { val, loc });
        }
        seasons.forEach((s, k) => { const hit = byPeriod.get(String(rawIds[k])); if (hit) s.name = hit.val; });
      }
    }
  } catch { /* pas de table d'alias : on garde le nom de la table de base */ }
  // Illustration : certaines bases rangent l'image dans une table sœur i18n
  // (<base>_lang / <base>_name_alias) ou dédiée (<base>_image). Best-effort :
  // ne remplit que les périodes encore sans image trouvée dans la table de base.
  try {
    if (seasons.some((s) => !s.image)) {
      for (const sib of [`${baseTable}_lang`, `${baseTable}_name_alias`, `${baseTable}_image`, `${baseTable}_images`]) {
        const sibColsT = await tableColsTyped(cfg, db, sib);
        if (!sibColsT.length) continue;
        const sibCols = sibColsT.map((c) => c.name);
        const imgCol = detectImageCol(sibColsT);
        if (!imgCol) continue;
        const periodFk = (await fkColumn(cfg, db, sib, baseTable))
          || pickCol(sibCols, [`${baseTable}_id`, 'period_id', 'id_period', 'season_id'], 'optionnel', sib, 'period');
        if (!periodFk) continue;
        const rows = await mysqlRows(cfg, `SELECT ${qid(periodFk)}, ${qid(imgCol)} FROM ${qid(db)}.${qid(sib)}`);
        const byPeriod = new Map();
        for (const [pid, im] of rows) { const v = String(im || '').trim(); if (v && !byPeriod.has(String(pid))) byPeriod.set(String(pid), v); }
        seasons.forEach((s, k) => { if (!s.image) { const hit = byPeriod.get(String(rawIds[k])); if (hit) s.image = hit; } });
        if (!seasons.some((s) => !s.image)) break;
      }
    }
  } catch { /* pas de table sœur d'images : on garde ce qu'on a */ }
  // Bibliothèque d'icônes de saison : une table type ws_season (name/slug/img,
  // souvent SANS dates, donc pas la table importée) sert de banque d'illustrations.
  // On rapproche chaque période importée d'une icône par nom/slug normalisé
  // (égalité puis inclusion : « Collection Printemps » ↔ « printemps »).
  try {
    if (seasons.some((s) => !s.image)) {
      for (const lib of ['ws_season', 'ws_seasons', 'wc_season', 'season', 'seasons']) {
        if (lib === baseTable) continue;
        const libColsT = await tableColsTyped(cfg, db, lib);
        if (!libColsT.length) continue;
        const libCols = libColsT.map((c) => c.name);
        const imgCol = detectImageCol(libColsT);
        const nameCol = pickCol(libCols, ['name', 'label', 'title', 'nom', 'libelle', 'designation'], 'optionnel', lib, 'name');
        const slugCol = pickCol(libCols, ['slug', 'code', 'alias'], 'optionnel');
        if (!imgCol || (!nameCol && !slugCol)) continue;
        const sel = [nameCol, slugCol, imgCol].filter(Boolean);
        const rows = await mysqlRows(cfg, `SELECT ${sel.map(qid).join(', ')} FROM ${qid(db)}.${qid(lib)}`);
        const byKey = new Map(); // slug/nom normalisé → img
        for (const r of rows) {
          let i = 0;
          const nm = nameCol ? String(r[i++] || '') : '';
          const sg = slugCol ? String(r[i++] || '') : '';
          const im = String(r[i] || '').trim();
          if (!im) continue;
          for (const k of [slugify(nm), slugify(sg)]) if (k && !byKey.has(k)) byKey.set(k, im);
        }
        seasons.forEach((s) => {
          if (s.image) return;
          const key = slugify(s.name);
          if (!key) return;
          let hit = byKey.get(key);
          if (!hit) for (const [k, v] of byKey) { if (k && (key.includes(k) || k.includes(key))) { hit = v; break; } }
          if (hit) s.image = hit;
        });
        if (!seasons.some((s) => !s.image)) break;
      }
    }
  } catch { /* pas de bibliothèque d'icônes de saison exploitable */ }
  return seasons;
}

// Colonne d'illustration éventuelle d'une table de périodes (best-effort) :
// noms usuels d'abord, puis toute colonne dont le nom évoque une image — en
// écartant les colonnes de dimensions / d'id / de texte alternatif.
function detectImageCol(colsT) {
  const cols = colsT.map((c) => c.name);
  const direct = pickCol(cols, ['image', 'img', 'illustration', 'illustration_url', 'picture',
    'photo', 'cover', 'cover_image', 'visual', 'visuel', 'thumbnail', 'thumb', 'banner',
    'image_url', 'img_url', 'picture_url', 'photo_url', 'media', 'media_url', 'file',
    'filename', 'icon', 'logo', 'vignette'], 'optionnel');
  if (direct) return direct;
  const guess = colsT.find((c) => /(image|img|photo|illustr|picture|visuel|cover|banner|thumb|icon|logo|vignette)/i.test(c.name)
    && !/(width|height|size|_id$|^id_|alt|title|desc|position|order|sort)/i.test(c.name));
  return guess ? guess.name : null;
}

async function detectSeasons(cfg, db, preferred) {
  const candidates = preferred
    ? [preferred]
    : ['ws_season', 'ws_seasons', 'wc_season', 'product_availability_period', 'season', 'seasons', 'periode', 'periods', 'periodes'];
  const inspected = [];
  for (const t of candidates) {
    try {
      const colsT = await tableColsTyped(cfg, db, t);
      const cols = colsT.map((c) => c.name);
      if (!cols.length) continue;
      const id = (await primaryKey(cfg, db, t)) || pickCol(cols, ['id', 'id_season', 'season_id', 'id_period', 'period_id'], 'optionnel') || cols[0];
      let name = pickCol(cols, ['name', 'label', 'title', 'nom', 'libelle', 'season', 'periode', 'saison'], 'optionnel', t, 'name');
      let from = pickCol(cols, ['date_from', 'from', 'start', 'start_date', 'begin', 'debut', 'date_debut', 'date_start', 'available_from', 'from_date'], 'optionnel', t, 'debut');
      let to = pickCol(cols, ['date_to', 'to', 'end', 'end_date', 'finish', 'fin', 'date_fin', 'date_end', 'available_to', 'to_date'], 'optionnel', t, 'fin');
      if (!from || !to) {
        const dateCols = colsT.filter((c) => /date|time/.test(c.type)).map((c) => c.name);
        if (dateCols.length >= 2) { from = from || dateCols[0]; to = to || dateCols[1]; }
      }
      if (!name) name = (colsT.find((c) => /char|text/.test(c.type) && c.name !== from && c.name !== to) || {}).name || null;
      const prod = pickCol(cols, ['product_id', 'id_product', 'product', 'produit'], 'optionnel', t, 'product')
        || (colsT.find((c) => /product|produit/i.test(c.name)) || {}).name || null;
      const img = detectImageCol(colsT);
      if (!from || !to) {
        // Colonnes de dates introuvables : on garde la table pour le diagnostic,
        // avec les types de colonnes et une ligne d'exemple (pour câbler le mapping).
        let sample = [];
        try { const s = await mysqlRows(cfg, `SELECT * FROM ${qid(db)}.${qid(t)} LIMIT 1`); sample = (s[0] || []).map((x) => String(x).slice(0, 40)); } catch { /* table vide/illisible */ }
        inspected.push({ table: t, columns: cols, types: colsT.map((c) => `${c.name} (${c.type})`), sample });
        continue;
      } // colonnes de dates introuvables — on garde pour le diagnostic. Anciennement de p\u00e9riodes
      const rows = await mysqlRows(cfg, `SELECT ${qid(id)}, ${name ? qid(name) : "''"}, ${qid(from)}, ${qid(to)}, ${prod ? qid(prod) : "''"}, ${img ? qid(img) : "''"} FROM ${qid(db)}.${qid(t)}`);
      const rawIds = rows.map(([i], k) => ((i != null && String(i).trim()) ? String(i).trim() : String(k)));
      const seasons = rows.map(([i, nm, fr, to2, pr, im], k) => ({
        id: `ws_${i || k}`,
        name: String(nm || '').trim() || `Saison ${i || k + 1}`,
        from: String(fr || '').trim(),
        to: String(to2 || '').trim(),
        products: String(pr || '').trim() ? [`pwp${String(pr).trim()}`] : [],
        image: String(im || '').trim(),
        color: '#C97B4A', active: true,
      }));
      await enrichSeasons(cfg, db, t, seasons, rawIds);
      return { table: t, seasons, colsUsed: { id, name, from, to, prod, img } };
    } catch { /* table absente / illisible : on essaie la suivante */ }
  }
  return { table: '', seasons: [], inspected };
}

export async function importSeasons(table) {
  const cfg = pwaConfig();
  const db = await detectSchema(cfg);
  const det = await detectSeasons(cfg, db, table && String(table).trim());
  // Aide au diagnostic : si rien trouvé, on liste les tables qui « ressemblent »
  // à des saisons/périodes pour que l'utilisateur pointe la bonne.
  if (!det.seasons.length) {
    try {
      const rows = await mysqlRows(cfg, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = '${String(db).replace(/'/g, '')}'
          AND (table_name LIKE '%season%' OR table_name LIKE '%periode%' OR table_name LIKE '%period%' OR table_name LIKE '%saison%')
        ORDER BY table_name LIMIT 20`);
      det.candidates = rows.map((r) => r[0]);
    } catch { det.candidates = []; }
  }
  return { db, ...det };
}

// Diagnostic \u00ab colonnes r\u00e9elles \u00bb : pour chaque table de p\u00e9riodes candidate
// (ou celle impos\u00e9e), liste toutes ses colonnes + types + 1 ligne d'exemple et
// signale la colonne d'illustration d\u00e9tect\u00e9e. Lecture seule (information_schema
// + un SELECT \u2026 LIMIT 1) : ne modifie jamais rien. Sert au bouton \u00ab Diagnostic \u00bb
// de la r\u00e9gie et au test live (le log CI r\u00e9v\u00e8le le sch\u00e9ma r\u00e9el c\u00f4t\u00e9 prod).
export async function inspectSeasons(table) {
  const cfg = pwaConfig();
  const db = await detectSchema(cfg);
  const candidates = (table && String(table).trim())
    ? [String(table).trim()]
    : ['ws_season', 'ws_seasons', 'wc_season', 'product_availability_period', 'season', 'seasons', 'periode', 'periods', 'periodes'];
  const inspected = [];
  for (const t of candidates) {
    try {
      const colsT = await tableColsTyped(cfg, db, t);
      if (!colsT.length) continue;
      const cols = colsT.map((c) => c.name);
      const imageCol = detectImageCol(colsT);
      let sample = [];
      try {
        const s = await mysqlRows(cfg, `SELECT * FROM ${qid(db)}.${qid(t)} LIMIT 1`);
        sample = (s[0] || []).map((x) => String(x == null ? '' : x).slice(0, 60));
      } catch { /* table vide/illisible */ }
      const imageSample = imageCol ? String(sample[cols.indexOf(imageCol)] || '').slice(0, 160) : '';
      inspected.push({ table: t, columns: cols, types: colsT.map((c) => `${c.name} (${c.type})`), sample, imageCol, imageSample });
    } catch { /* table absente : suivante */ }
  }
  return { db, inspected };
}

const slugify = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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

  // Certaines bases ont plusieurs lignes par produit ou par catégorie (une
  // par langue, par boutique…) : on garde la première de chaque id.
  let dupes = 0;
  const categories = [];
  const seenCat = new Set();
  for (const [id, name] of catRows) {
    const cid = `pw${id}`;
    if (seenCat.has(cid)) { dupes++; continue; }
    seenCat.add(cid);
    categories.push({ id: cid, name: name || `Catégorie ${id}`, active: true, aliases: {} });
  }
  const catIds = new Set(categories.map((c) => c.id));

  const products = [];
  const byId = new Map();
  for (const [id, catId, name, price, active] of prodRows) {
    const pid = `pwp${id}`;
    if (byId.has(pid)) { dupes++; continue; }
    const p = {
      id: pid,
      categoryId: catIds.has(`pw${catId}`) ? `pw${catId}` : '',
      name: name || `Produit ${id}`,
      price: frPrice(price) || '0,00',
      img: 'assets/cake.png', src: 'illus',
      active: active == null || !(active === '0' || active === '' || /^(false|no|non)$/i.test(active)),
      prices: {}, aliases: {},
    };
    byId.set(pid, p);
    products.push(p);
  }

  // shop_product : prix par boutique PWA → magasin signage.
  // 1. mapping manuel (Réglages avancés) s'il existe ;
  // 2. sinon la table shops (champ slug) : correspondance par slug avec les
  //    magasins signage, et CRÉATION du magasin s'il n'existe pas encore ;
  // 3. sinon (pas de table shops) : boutiques triées par id, dans l'ordre.
  const db0 = getDb();
  const sigStores = db0.prepare('SELECT id, name FROM sig_stores ORDER BY id').all();
  const extToStore = {};
  const extLabel = {};
  const created = [];
  let inactiveShops = 0;
  let langFound = '';
  let langSet = 0;
  if (Object.keys(cfg.shopMap || {}).length) {
    for (const [storeId, extId] of Object.entries(cfg.shopMap)) { extToStore[String(extId)] = storeId; extLabel[String(extId)] = String(extId); }
  } else {
    const det = await detectShops(cfg, queries.db);
    const shops = det.shops;
    inactiveShops = det.inactive;
    langFound = det.langFound;
    if (shops.length) {
      const insStore = db0.prepare(`INSERT OR IGNORE INTO sig_stores(id, name, grp, conn, screens, screen_size, screen_orient, lang)
        VALUES (?, ?, 'Boutiques PWA', 'fibre', 1, 55, 'paysage', ?)`);
      const setActive = db0.prepare('UPDATE sig_stores SET active = ? WHERE id = ?');
      const setLang = db0.prepare('UPDATE sig_stores SET lang = ? WHERE id = ?');
      const findMatch = (sh) => {
        const key = sh.slug || slugify(sh.name) || `shop${sh.id}`;
        return {
          key,
          match: sigStores.find((x) => x.id === key)
            || sigStores.find((x) => slugify(x.name) === key)
            || (key.length >= 3 ? sigStores.find((x) => slugify(x.name).includes(key) || key.includes(slugify(x.name))) : null),
        };
      };
      // Boutiques inactives : on désactive le magasin correspondant s'il
      // existe (sans le créer) — il disparaît de la grille produits / planning.
      for (const sh of shops.filter((s) => !s.active)) {
        const { match } = findMatch(sh);
        if (match) setActive.run(0, match.id);
      }
      for (const sh of shops.filter((s) => s.active)) {
        const { key } = findMatch(sh);
        let { match } = findMatch(sh);
        if (!match) {
          const nm = sh.name || (key.charAt(0).toUpperCase() + key.slice(1));
          insStore.run(key, nm, sh.lang || 'fr');
          match = { id: key, name: nm };
          sigStores.push(match);
          created.push(`${nm} (${key})`);
        }
        setActive.run(1, match.id); // réactive si elle l'était
        if (sh.lang) { setLang.run(sh.lang, match.id); langSet++; } // langue préférée du shop
        extToStore[sh.id] = match.id;
        extLabel[sh.id] = sh.slug || sh.id;
      }
    } else {
      const shopIds = [...new Set(priceRows.map((r) => String(r[1])))]
        .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
      shopIds.forEach((extId, i) => { if (sigStores[i]) { extToStore[extId] = sigStores[i].id; extLabel[extId] = extId; } });
    }
  }
  const mapLabel = Object.entries(extToStore)
    .map(([ext, sid]) => `${extLabel[ext] || ext}→${(sigStores.find((x) => x.id === sid) || {}).name || sid}`)
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
    ...(dupes ? { dupes } : {}),
    ...(created.length ? { createdStores: created } : {}),
    ...(inactiveShops ? { inactiveShops } : {}),
    ...(langSet ? { langSet, langSource: langFound } : (langFound ? { langSource: langFound } : {})),
  };
}
