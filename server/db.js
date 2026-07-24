// Base de données du module signage — node:sqlite (zéro dépendance).
// Toutes les tables sont préfixées `sig_`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newSessionToken } from './auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.SIG_DB || join(ROOT, 'data', 'signage.db');

export const TABLE_PREFIX = 'sig_';

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  seed(db);
  clearDemoSeed(db);
  ensureAdmin(db);
  ensurePlaylists(db);
  ensureElementTypes(db);
  ensureCatalog(db);
  // Migration ponctuelle : l'ancien créneau par défaut (08:00–20:00) éteignait
  // les écrans le soir sans que ce soit un choix — passage en 24h/24.
  if (!getSetting('mig_sched_24h')) {
    db.prepare(`UPDATE sig_modules SET sched_from = '00:00', sched_to = '23:59' WHERE sched_from = '08:00' AND sched_to = '20:00'`).run();
    setSetting('mig_sched_24h', '1');
  }
  db.prepare(`DELETE FROM sig_sessions WHERE expires_at < datetime('now')`).run();
  return db;
}

// Migration : les bases existantes n'avaient qu'une playlist anonyme
// (sig_playlist) — on la promeut en premier film nommé.
function ensurePlaylists(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM sig_playlists').get().n;
  if (n === 0) {
    db.prepare(`INSERT INTO sig_playlists(id, name, sort_order) VALUES ('pl1', 'Film principal', 0)`).run();
    const legacy = db.prepare('SELECT module_id FROM sig_playlist ORDER BY position').all();
    const ins = db.prepare('INSERT INTO sig_playlist_items(playlist_id, position, module_id) VALUES (?, ?, ?)');
    legacy.forEach((r, i) => ins.run('pl1', i, r.module_id));
  }
  const act = getSetting('active_playlist');
  const exists = act && db.prepare('SELECT 1 AS ok FROM sig_playlists WHERE id = ?').get(act);
  if (!exists) {
    const first = db.prepare('SELECT id FROM sig_playlists ORDER BY sort_order, created_at').get();
    if (first) setSetting('active_playlist', first.id);
  }
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS sig_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sig_modules (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    sub          TEXT NOT NULL DEFAULT '',
    layout       TEXT NOT NULL DEFAULT 'illo-right',
    motion       TEXT NOT NULL DEFAULT 'm1',
    motion_title TEXT,
    motion_list  TEXT,
    motion_illo  TEXT,
    tag_enabled  INTEGER NOT NULL DEFAULT 0,
    tag_label    TEXT NOT NULL DEFAULT 'Nouveauté',
    tag_img      TEXT NOT NULL DEFAULT 'assets/cherry.png',
    sched_days   TEXT NOT NULL DEFAULT '[1,1,1,1,1,1,1]',
    sched_from   TEXT NOT NULL DEFAULT '00:00',
    sched_to     TEXT NOT NULL DEFAULT '23:59',
    pos          TEXT NOT NULL DEFAULT '{}',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sig_module_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id TEXT NOT NULL REFERENCES sig_modules(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    name      TEXT NOT NULL DEFAULT '',
    price     TEXT NOT NULL DEFAULT '0,00',
    img       TEXT NOT NULL DEFAULT 'assets/cake.png',
    src       TEXT NOT NULL DEFAULT 'illus',
    active    INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS sig_module_items_module ON sig_module_items(module_id, position);

  CREATE TABLE IF NOT EXISTS sig_playlist (
    position  INTEGER PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES sig_modules(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sig_playlists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sig_playlist_items (
    playlist_id TEXT NOT NULL REFERENCES sig_playlists(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    module_id   TEXT NOT NULL REFERENCES sig_modules(id) ON DELETE CASCADE,
    PRIMARY KEY (playlist_id, position)
  );

  CREATE TABLE IF NOT EXISTS sig_stores (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grp  TEXT NOT NULL DEFAULT '',
    conn TEXT NOT NULL DEFAULT 'fibre'
  );

  CREATE TABLE IF NOT EXISTS sig_players (
    id           TEXT PRIMARY KEY,
    store_id     TEXT NOT NULL REFERENCES sig_stores(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    hw           TEXT NOT NULL DEFAULT 'Android · MediaBox 4K',
    kiosk        INTEGER NOT NULL DEFAULT 1,
    orient       TEXT NOT NULL DEFAULT 'Paysage',
    token        TEXT NOT NULL,
    state        TEXT NOT NULL DEFAULT 'offline',
    played_ver   INTEGER NOT NULL DEFAULT 0,
    assigned_ver INTEGER NOT NULL DEFAULT 0,
    data_ver     INTEGER NOT NULL DEFAULT 0,
    cache_pct    INTEGER NOT NULL DEFAULT 100,
    media        TEXT NOT NULL DEFAULT '—',
    disk         TEXT NOT NULL DEFAULT '—',
    temp         TEXT NOT NULL DEFAULT '—',
    activate_at  TEXT,
    last_seen    TEXT,
    data_at      TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sig_players_token ON sig_players(token);

  CREATE TABLE IF NOT EXISTS sig_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('playlist','data')),
    version    INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sig_snapshots_kv ON sig_snapshots(kind, version);

  CREATE TABLE IF NOT EXISTS sig_publications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mode        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    targets     TEXT NOT NULL DEFAULT '[]',
    slot        TEXT NOT NULL DEFAULT 'Toute la journée',
    activate_at TEXT,
    tests       TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sig_heartbeats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    at        TEXT NOT NULL DEFAULT (datetime('now')),
    state     TEXT NOT NULL,
    cache_pct INTEGER,
    media     TEXT,
    disk      TEXT,
    temp      TEXT
  );
  CREATE INDEX IF NOT EXISTS sig_heartbeats_player ON sig_heartbeats(player_id, at);

  CREATE TABLE IF NOT EXISTS sig_users (
    username   TEXT PRIMARY KEY,
    pass_salt  TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sig_sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES sig_users(username) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_used  TEXT
  );
  CREATE INDEX IF NOT EXISTS sig_sessions_user ON sig_sessions(username);
  `);
  // Tag de bibliothèque (Produit / Fêtes / Promo / Liaison…) porté par l'élément.
  const modCols = db.prepare('PRAGMA table_info(sig_modules)').all().map((c) => c.name);
  if (!modCols.includes('lib_tag')) db.exec(`ALTER TABLE sig_modules ADD COLUMN lib_tag TEXT NOT NULL DEFAULT ''`);
  // Le film porte sa programmation (jours + fenêtre) et ses magasins cibles.
  const plCols = db.prepare('PRAGMA table_info(sig_playlists)').all().map((c) => c.name);
  if (!plCols.includes('sched_days')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN sched_days TEXT NOT NULL DEFAULT '[1,1,1,1,1,1,1]'`);
  if (!plCols.includes('sched_from')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN sched_from TEXT NOT NULL DEFAULT '00:00'`);
  if (!plCols.includes('sched_to')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN sched_to TEXT NOT NULL DEFAULT '23:59'`);
  if (!plCols.includes('stores')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN stores TEXT NOT NULL DEFAULT '[]'`);
  // Le film est rangé dans une catégorie colorée + porte des tags libres.
  if (!plCols.includes('cat')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN cat TEXT NOT NULL DEFAULT ''`);
  if (!plCols.includes('tags')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
  // Jours de planning dédiés (indépendants des jours de diffusion) : filtrent
  // les films proposés quand on remplit un jour du planning hebdo (ex. crêpes = mercredi).
  if (!plCols.includes('plan_days')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN plan_days TEXT NOT NULL DEFAULT '[1,1,1,1,1,1,1]'`);
  // Combo d'écrans du magasin (ex. 3 × 55″ portrait) → taille du film en px.
  const stCols = db.prepare('PRAGMA table_info(sig_stores)').all().map((c) => c.name);
  if (!stCols.includes('screens')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screens INTEGER NOT NULL DEFAULT 1`);
  if (!stCols.includes('screen_size')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screen_size INTEGER NOT NULL DEFAULT 55`);
  if (!stCols.includes('screen_orient')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screen_orient TEXT NOT NULL DEFAULT 'paysage'`);
  if (!stCols.includes('active')) db.exec(`ALTER TABLE sig_stores ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);

  // Planning : passage à plusieurs films par moment (ajout de la colonne
  // position → reconstruction de la table dont la PK interdisait les doublons).
  const dpCols = db.prepare('PRAGMA table_info(sig_dayplans)').all().map((c) => c.name);
  if (dpCols.length && !dpCols.includes('position')) {
    db.exec(`
      BEGIN;
      CREATE TABLE sig_dayplans_new (
        store_id TEXT NOT NULL, moment TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0, film_id TEXT NOT NULL,
        PRIMARY KEY (store_id, moment, position)
      );
      INSERT INTO sig_dayplans_new (store_id, moment, position, film_id)
        SELECT store_id, moment, 0, film_id FROM sig_dayplans;
      DROP TABLE sig_dayplans;
      ALTER TABLE sig_dayplans_new RENAME TO sig_dayplans;
      COMMIT;
    `);
  }

  // Éléments typés : produit, film (vidéo), animation… + liens vers le catalogue.
  const modCols2 = db.prepare('PRAGMA table_info(sig_modules)').all().map((c) => c.name);
  if (!modCols2.includes('cat_ref')) db.exec(`ALTER TABLE sig_modules ADD COLUMN cat_ref TEXT NOT NULL DEFAULT ''`);
  if (!modCols2.includes('product_ref')) db.exec(`ALTER TABLE sig_modules ADD COLUMN product_ref TEXT NOT NULL DEFAULT ''`);
  if (!modCols2.includes('video')) db.exec(`ALTER TABLE sig_modules ADD COLUMN video TEXT NOT NULL DEFAULT ''`);
  if (!modCols2.includes('dur')) db.exec(`ALTER TABLE sig_modules ADD COLUMN dur REAL NOT NULL DEFAULT 0`);
  // Élément film en mode « surprise » : pioche une vidéo au hasard dans le dossier serveur.
  if (!modCols2.includes('surprise')) db.exec(`ALTER TABLE sig_modules ADD COLUMN surprise INTEGER NOT NULL DEFAULT 0`);
  // Filtre « filigrane / logo » superposé (surtout sur les photos) : none|filigrane|logo|nouveau.
  if (!modCols2.includes('watermark')) db.exec(`ALTER TABLE sig_modules ADD COLUMN watermark TEXT NOT NULL DEFAULT 'none'`);

  // Les anciennes bases limitaient le type par un CHECK (category|liaison) —
  // les types vivent désormais dans sig_element_types : on reconstruit la
  // table sans la contrainte (SQLite ne sait pas la retirer autrement).
  const modDef = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sig_modules'`).get();
  if (modDef && /CHECK/i.test(modDef.sql)) {
    const cols = db.prepare('PRAGMA table_info(sig_modules)').all().map((c) => c.name).join(', ');
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE sig_modules_new (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        name         TEXT NOT NULL DEFAULT '',
        sub          TEXT NOT NULL DEFAULT '',
        layout       TEXT NOT NULL DEFAULT 'illo-right',
        motion       TEXT NOT NULL DEFAULT 'm1',
        motion_title TEXT,
        motion_list  TEXT,
        motion_illo  TEXT,
        tag_enabled  INTEGER NOT NULL DEFAULT 0,
        tag_label    TEXT NOT NULL DEFAULT 'Nouveauté',
        tag_img      TEXT NOT NULL DEFAULT 'assets/cherry.png',
        sched_days   TEXT NOT NULL DEFAULT '[1,1,1,1,1,1,1]',
        sched_from   TEXT NOT NULL DEFAULT '00:00',
        sched_to     TEXT NOT NULL DEFAULT '23:59',
        pos          TEXT NOT NULL DEFAULT '{}',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        lib_tag      TEXT NOT NULL DEFAULT '',
        cat_ref      TEXT NOT NULL DEFAULT '',
        product_ref  TEXT NOT NULL DEFAULT '',
        video        TEXT NOT NULL DEFAULT '',
        dur          REAL NOT NULL DEFAULT 0
      );
      INSERT INTO sig_modules_new (${cols}) SELECT ${cols} FROM sig_modules;
      DROP TABLE sig_modules;
      ALTER TABLE sig_modules_new RENAME TO sig_modules;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS sig_element_types (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '▤',
    descr      TEXT NOT NULL DEFAULT '',
    layouts    TEXT NOT NULL DEFAULT '[]',
    has_items  INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sig_product_categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sig_products (
    id          TEXT PRIMARY KEY,
    category_id TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    price       TEXT NOT NULL DEFAULT '0,00',
    img         TEXT NOT NULL DEFAULT 'assets/cake.png',
    src         TEXT NOT NULL DEFAULT 'illus',
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sig_products_cat ON sig_products(category_id, sort_order);

  CREATE TABLE IF NOT EXISTS sig_product_prices (
    product_id TEXT NOT NULL,
    store_id   TEXT NOT NULL,
    price      TEXT NOT NULL,
    PRIMARY KEY (product_id, store_id)
  );

  -- Périodes de l'année (saisons) : nom + du → au + produits liés. Sert à
  -- cibler les vidéos/animations de saison. Peut être importé depuis ws_season.
  CREATE TABLE IF NOT EXISTS sig_seasons (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    date_from  TEXT NOT NULL DEFAULT '',
    date_to    TEXT NOT NULL DEFAULT '',
    products   TEXT NOT NULL DEFAULT '[]',
    color      TEXT NOT NULL DEFAULT '#C97B4A',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  -- Médiathèque agence : vidéos/photos uploadées par les agences, taguées
  -- (moment de la journée · produit · saison) pour une diffusion ciblée.
  CREATE TABLE IF NOT EXISTS sig_media (
    id         TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'film',
    moment     TEXT NOT NULL DEFAULT 'all',
    product_id TEXT NOT NULL DEFAULT '',
    season_id  TEXT NOT NULL DEFAULT '',
    size       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Planning journalier : un ou plusieurs films par moment, par magasin
  -- (joués l'un après l'autre pendant le créneau).
  CREATE TABLE IF NOT EXISTS sig_dayplans (
    store_id TEXT NOT NULL,
    moment   TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    film_id  TEXT NOT NULL,
    PRIMARY KEY (store_id, moment, position)
  );

  -- Planning hebdomadaire : 5 modèles de semaine réutilisables (A–E),
  -- 7 jours × 3 moments, un ou plusieurs films par cellule, par magasin.
  CREATE TABLE IF NOT EXISTS sig_weekplans (
    store_id TEXT NOT NULL,
    week     TEXT NOT NULL,
    day      INTEGER NOT NULL,
    moment   TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    film_id  TEXT NOT NULL,
    PRIMARY KEY (store_id, week, day, moment, position)
  );

  CREATE TABLE IF NOT EXISTS sig_langs (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sig_aliases (
    kind   TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    lang   TEXT NOT NULL,
    name   TEXT NOT NULL,
    PRIMARY KEY (kind, ref_id, lang)
  );
  `);

  // Langue d'affichage du magasin (les alias produits/catégories la suivent).
  const stCols2 = db.prepare('PRAGMA table_info(sig_stores)').all().map((c) => c.name);
  if (!stCols2.includes('lang')) db.exec(`ALTER TABLE sig_stores ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr'`);

  const nLangs = db.prepare('SELECT COUNT(*) AS n FROM sig_langs').get().n;
  if (nLangs === 0) {
    const insL = db.prepare('INSERT INTO sig_langs(id, label, sort_order, enabled) VALUES (?, ?, ?, 1)');
    insL.run('fr', 'Français', 0);
    insL.run('nl', 'Nederlands', 1);
    insL.run('en', 'English', 2);
    insL.run('de', 'Deutsch', 3);
  }

  // Planning hebdo : reprise unique de l'ancien planning journalier dans la
  // semaine A (appliqué aux 7 jours), et semaine active par défaut = A.
  if (!getSetting('mig_weekplans')) {
    const old = db.prepare('SELECT store_id, moment, position, film_id FROM sig_dayplans').all();
    if (old.length) {
      const insW = db.prepare('INSERT OR IGNORE INTO sig_weekplans(store_id, week, day, moment, position, film_id) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of old) for (let d = 0; d < 7; d++) insW.run(r.store_id, 'A', d, r.moment, r.position, r.film_id);
    }
    setSetting('mig_weekplans', '1');
  }
  if (getSetting('active_week') == null) setSetting('active_week', 'A');
}

export function loadLangs() {
  return getDb().prepare('SELECT * FROM sig_langs WHERE enabled = 1 ORDER BY sort_order').all()
    .map((l) => ({ id: l.id, label: l.label }));
}

// ---------------------------------------------------------------------------
// Types d'éléments — pilotés par la table sig_element_types (rien en dur côté
// interface) : le « + Élément » et les mises en page par type en découlent.
function ensureElementTypes(db) {
  const insType = db.prepare('INSERT INTO sig_element_types(id, label, icon, descr, layouts, has_items, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
  const mediaLayouts = JSON.stringify([
    { id: 'cover', icon: '◼', label: 'Plein écran (remplir)' },
    { id: 'contain', icon: '▭', label: 'Adapter (letterbox)' },
  ]);
  // Type « média ciblé » : ajouté même sur une base existante (hors seed initial).
  const ensureMedia = () => {
    if (!db.prepare('SELECT 1 FROM sig_element_types WHERE id = ?').get('media')) {
      insType.run('media', 'Média ciblé — agence', '🎯',
        'Diffuse une vidéo/photo de la médiathèque agence, tirée au sort selon le moment (matin/midi/soir) et la saison active.',
        mediaLayouts, 0, 5);
    }
  };
  const n = db.prepare('SELECT COUNT(*) AS n FROM sig_element_types').get().n;
  if (n > 0) { ensureMedia(); return; }
  const catLayouts = [
    { id: 'illo-right', icon: '▤', label: 'Texte à gauche · illustration à droite' },
    { id: 'illo-left', icon: '▤', label: 'Texte à droite · illustration à gauche' },
    { id: 'text-only', icon: '☰', label: 'Liste centrée, sans illustration' },
    { id: 'illo-bg', icon: '◉', label: 'Illustration centrée en fond' },
    { id: 'two-col', icon: '▦', label: 'Deux colonnes (listes longues)' },
    { id: 'illo-top', icon: '⬒', label: 'Illustration en haut · liste dessous' },
  ];
  const types = [
    { id: 'category', label: 'Catégorie — liste de prix', icon: '▤', descr: 'Liste de produits avec prix, manuelle ou liée à la table produits.', layouts: catLayouts, hasItems: 1, sort: 0 },
    { id: 'produit', label: 'Produit — mise en avant', icon: '◆', descr: 'Un seul produit en grand : photo, nom, prix.', layouts: [
      { id: 'hero-right', icon: '▥', label: 'Texte à gauche · photo à droite' },
      { id: 'hero-left', icon: '▥', label: 'Photo à gauche · texte à droite' },
      { id: 'hero-full', icon: '◼', label: 'Photo plein écran · texte dessus' },
    ], hasItems: 0, sort: 1 },
    { id: 'liaison', label: 'Liaison', icon: '⧉', descr: 'Écran de transition : logo + accroche.', layouts: [
      { id: 'center', icon: '▣', label: 'Centré' },
    ], hasItems: 0, sort: 2 },
    { id: 'film', label: 'Film — vidéo (upload)', icon: '▶', descr: 'Une vidéo importée (mp4/webm ≤ 8 Mo), jouée dans le film.', layouts: [
      { id: 'cover', icon: '◼', label: 'Plein écran (remplir)' },
      { id: 'contain', icon: '▭', label: 'Adapter (letterbox)' },
    ], hasItems: 0, sort: 3 },
    { id: 'animation', label: 'Animation — texte animé', icon: '✦', descr: 'Titre + accroche animés, aux couleurs de la marque.', layouts: [
      { id: 'center', icon: '▣', label: 'Fond crème · texte encre' },
      { id: 'band', icon: '▬', label: 'Fond rubis · texte blanc' },
    ], hasItems: 0, sort: 4 },
  ];
  for (const t of types) insType.run(t.id, t.label, t.icon, t.descr, JSON.stringify(t.layouts), t.hasItems, t.sort);
  ensureMedia();
}

export function loadElementTypes() {
  return getDb().prepare('SELECT * FROM sig_element_types WHERE enabled = 1 ORDER BY sort_order').all().map((t) => ({
    id: t.id, label: t.label, icon: t.icon, descr: t.descr,
    layouts: JSON.parse(t.layouts || '[]'), hasItems: !!t.has_items,
  }));
}

// ---------------------------------------------------------------------------
// Catalogue produits — la table centrale (catégories → produits, prix par
// magasin). Au premier lancement sur une base existante, il est construit à
// partir des éléments « catégorie » déjà présents.
function ensureCatalog(db) {
  const nCat = db.prepare('SELECT COUNT(*) AS n FROM sig_product_categories').get().n;
  const nProd = db.prepare('SELECT COUNT(*) AS n FROM sig_products').get().n;
  if (nCat > 0 || nProd > 0) return;
  const mods = db.prepare(`SELECT * FROM sig_modules WHERE type = 'category' ORDER BY sort_order`).all();
  const insCat = db.prepare('INSERT INTO sig_product_categories(id, name, sort_order, active) VALUES (?, ?, ?, 1)');
  const insProd = db.prepare('INSERT INTO sig_products(id, category_id, name, price, img, src, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let pn = 0;
  mods.forEach((m, i) => {
    const catId = 'pc_' + m.id;
    insCat.run(catId, m.name || `Catégorie ${i + 1}`, i);
    const items = db.prepare('SELECT * FROM sig_module_items WHERE module_id = ? ORDER BY position').all(m.id);
    items.forEach((it, j) => insProd.run('pr' + (++pn), catId, it.name, it.price, it.img, it.src, it.active ? 1 : 0, j));
  });
}

export function loadCatalog() {
  const db = getDb();
  // Alias par langue (nom du produit / de la catégorie dans chaque langue).
  const aliasRows = db.prepare('SELECT * FROM sig_aliases').all();
  const aliasesOf = (kind, id) => {
    const out = {};
    for (const a of aliasRows) if (a.kind === kind && a.ref_id === id) out[a.lang] = a.name;
    return out;
  };
  const categories = db.prepare('SELECT * FROM sig_product_categories ORDER BY sort_order').all()
    .map((c) => ({ id: c.id, name: c.name, active: !!c.active, aliases: aliasesOf('category', c.id) }));
  const priceRows = db.prepare('SELECT * FROM sig_product_prices').all();
  const pricesByProduct = new Map();
  for (const r of priceRows) {
    if (!pricesByProduct.has(r.product_id)) pricesByProduct.set(r.product_id, {});
    pricesByProduct.get(r.product_id)[r.store_id] = r.price;
  }
  const products = db.prepare('SELECT * FROM sig_products ORDER BY category_id, sort_order').all().map((p) => ({
    id: p.id, categoryId: p.category_id, name: p.name, price: p.price,
    img: p.img, src: p.src, active: !!p.active,
    prices: pricesByProduct.get(p.id) || {},
    aliases: aliasesOf('product', p.id),
  }));
  return { categories, products };
}

export function saveCatalog({ categories, products }) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_product_prices');
    db.exec('DELETE FROM sig_aliases');
    db.exec('DELETE FROM sig_products');
    db.exec('DELETE FROM sig_product_categories');
    const insCat = db.prepare('INSERT OR REPLACE INTO sig_product_categories(id, name, sort_order, active) VALUES (?, ?, ?, ?)');
    const insProd = db.prepare('INSERT OR REPLACE INTO sig_products(id, category_id, name, price, img, src, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insPrice = db.prepare('INSERT OR REPLACE INTO sig_product_prices(product_id, store_id, price) VALUES (?, ?, ?)');
    const insAlias = db.prepare('INSERT OR REPLACE INTO sig_aliases(kind, ref_id, lang, name) VALUES (?, ?, ?, ?)');
    const putAliases = (kind, id, aliases) => {
      for (const [lang, name] of Object.entries(aliases || {})) {
        if (String(name).trim()) insAlias.run(kind, String(id), String(lang), String(name).trim());
      }
    };
    (categories || []).forEach((c, i) => {
      insCat.run(String(c.id), String(c.name || `Catégorie ${i + 1}`), i, c.active === false ? 0 : 1);
      putAliases('category', c.id, c.aliases);
    });
    const catIds = new Set((categories || []).map((c) => String(c.id)));
    (products || []).forEach((p, i) => {
      insProd.run(String(p.id), catIds.has(String(p.categoryId)) ? String(p.categoryId) : '', String(p.name || ''),
        String(p.price || '0,00'), String(p.img || 'assets/cake.png'), p.src === 'photo' ? 'photo' : 'illus',
        p.active === false ? 0 : 1, i);
      for (const [storeId, price] of Object.entries(p.prices || {})) {
        if (String(price).trim()) insPrice.run(String(p.id), String(storeId), String(price).trim());
      }
      putAliases('product', p.id, p.aliases);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Périodes de l'année (saisons) — nom + du → au + produits liés.
export function loadSeasons() {
  return getDb().prepare('SELECT * FROM sig_seasons ORDER BY sort_order, name').all().map((s) => ({
    id: s.id, name: s.name, from: s.date_from, to: s.date_to,
    products: (() => { try { return JSON.parse(s.products || '[]'); } catch { return []; } })(),
    color: s.color || '#C97B4A', active: !!s.active,
  }));
}

export function saveSeasons(seasons) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_seasons');
    const ins = db.prepare('INSERT INTO sig_seasons(id, name, date_from, date_to, products, color, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    (Array.isArray(seasons) ? seasons : []).forEach((s, i) => {
      ins.run(String(s.id || 'se' + i), String(s.name || ''), String(s.from || ''), String(s.to || ''),
        JSON.stringify(Array.isArray(s.products) ? s.products.map(String) : []),
        String(s.color || '#C97B4A'), i, s.active === false ? 0 : 1);
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return loadSeasons();
}

// Analyse une date de saison en {m, d} (jour de l'année, année ignorée pour la
// récurrence). Accepte AAAA-MM-JJ, JJ/MM(/AAAA), MM-JJ, JJ.MM…
function seasonMD(v) {
  const s = String(v || '').trim();
  let mm = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);            // 2026-06-21
  if (mm) return { m: +mm[2], d: +mm[3] };
  mm = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(s);  // 21/06 ou 21/06/2026
  if (mm) return { m: +mm[2], d: +mm[1] };
  mm = /^(\d{1,2})-(\d{1,2})$/.exec(s);                       // 06-21 (MM-JJ)
  if (mm) return { m: +mm[1], d: +mm[2] };
  return null;
}

// Saisons actives à une date donnée (récurrence annuelle : on compare mois/jour).
export function currentSeasons(date = new Date()) {
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  return loadSeasons().filter((s) => {
    if (!s.active) return false;
    const a = seasonMD(s.from); const b = seasonMD(s.to);
    if (!a || !b) return false;
    const from = a.m * 100 + a.d; const to = b.m * 100 + b.d;
    return from <= to ? (today >= from && today <= to) : (today >= from || today <= to); // à cheval sur l'an
  });
}

// ---------------------------------------------------------------------------
// Médiathèque agence — métadonnées (le fichier vit dans public/media/).
export function loadMedia() {
  return getDb().prepare('SELECT * FROM sig_media ORDER BY created_at DESC').all().map((r) => ({
    id: r.id, filename: r.filename, kind: r.kind, moment: r.moment,
    productId: r.product_id, seasonId: r.season_id, size: r.size, createdAt: r.created_at,
  }));
}
export function addMediaRow(m) {
  getDb().prepare('INSERT INTO sig_media(id, filename, kind, moment, product_id, season_id, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(String(m.id), String(m.filename), m.kind === 'photo' ? 'photo' : 'film',
      ['matin', 'midi', 'soir'].includes(m.moment) ? m.moment : 'all',
      String(m.productId || ''), String(m.seasonId || ''), parseInt(m.size, 10) || 0);
  return loadMedia();
}
export function getMediaRow(id) {
  const r = getDb().prepare('SELECT * FROM sig_media WHERE id = ?').get(String(id));
  return r ? { id: r.id, filename: r.filename, kind: r.kind } : null;
}
export function delMediaRow(id) { getDb().prepare('DELETE FROM sig_media WHERE id = ?').run(String(id)); }

// Prix par magasin : remplace le prix par défaut des items liés au catalogue.
export function applyStorePrices(modules, storeId) {
  if (!storeId) return;
  const rows = getDb().prepare('SELECT product_id, price FROM sig_product_prices WHERE store_id = ?').all(storeId);
  if (!rows.length) return;
  const by = new Map(rows.map((r) => [r.product_id, r.price]));
  for (const m of modules || []) {
    for (const it of m.items || []) {
      if (it.productId && by.has(it.productId)) it.price = by.get(it.productId);
    }
  }
}

// Langue du magasin : les noms des produits liés (et le titre des listes
// liées) basculent sur l'alias de cette langue quand il existe.
export function applyStoreLang(modules, storeId) {
  if (!storeId) return;
  const db = getDb();
  const store = db.prepare('SELECT lang FROM sig_stores WHERE id = ?').get(storeId);
  const lang = store && store.lang;
  if (!lang || lang === 'fr') return;
  const rows = db.prepare('SELECT kind, ref_id, name FROM sig_aliases WHERE lang = ?').all(lang);
  if (!rows.length) return;
  const prodAlias = new Map(rows.filter((r) => r.kind === 'product').map((r) => [r.ref_id, r.name]));
  const catAlias = new Map(rows.filter((r) => r.kind === 'category').map((r) => [r.ref_id, r.name]));
  const catNames = new Map(db.prepare('SELECT id, name FROM sig_product_categories').all().map((c) => [c.id, c.name]));
  for (const m of modules || []) {
    for (const it of m.items || []) {
      if (it.productId && prodAlias.has(it.productId)) it.name = prodAlias.get(it.productId);
    }
    // Le titre suit l'alias seulement s'il n'a pas été personnalisé.
    if (m.catRef && catAlias.has(m.catRef) && m.name === catNames.get(m.catRef)) {
      m.name = catAlias.get(m.catRef);
    }
  }
}

// ---------------------------------------------------------------------------
// Planning journalier — 3 moments (matin / midi / après-midi) avec leurs
// fenêtres horaires (réglables), un film par moment et par magasin.
export const PLAN_MOMENTS = [
  { id: 'matin', label: 'Matin', from: '06:00', to: '11:00' },
  { id: 'midi', label: 'Midi', from: '11:00', to: '15:00' },
  { id: 'aprem', label: 'Après-midi', from: '15:00', to: '20:00' },
];
const HHMM = (v, fb) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : fb);

// Nombre maximum de films par moment de la journée.
export const MAX_PLAN_FILMS = 5;
// Modèles de semaine réutilisables (l'un est « actif » = diffusé).
export const PLAN_WEEKS = ['A', 'B', 'C', 'D', 'E'];
const okWeek = (w) => (PLAN_WEEKS.includes(String(w)) ? String(w) : 'A');
const okDay = (d) => { const n = parseInt(d, 10); return n >= 0 && n <= 6 ? n : 0; };

export function planWindows() {
  let saved = {};
  try { saved = JSON.parse(getSetting('plan_windows', '{}')) || {}; } catch { saved = {}; }
  return PLAN_MOMENTS.map((m) => ({
    id: m.id, label: m.label,
    from: HHMM(saved[m.id] && saved[m.id].from, m.from),
    to: HHMM(saved[m.id] && saved[m.id].to, m.to),
  }));
}

export function activeWeek() { return okWeek(getSetting('active_week', 'A')); }

// Moment courant (matin/midi/soir) selon les 3 fenêtres horaires du planning ;
// hors fenêtres, on retombe par tiers de journée. Sert aux « médias ciblés ».
export function currentMoment(date = new Date()) {
  const wins = planWindows();
  const mins = date.getHours() * 60 + date.getMinutes();
  const toMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  const names = ['matin', 'midi', 'soir'];
  for (let i = 0; i < wins.length && i < 3; i++) {
    const a = toMin(wins[i].from); const b = toMin(wins[i].to);
    const inW = a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
    if (inW) return names[i];
  }
  const h = date.getHours();
  return h < 11 ? 'matin' : (h < 16 ? 'midi' : 'soir');
}

// Planning hebdomadaire complet : byStore[store][week][day][moment] = [films].
export function loadPlan() {
  const db = getDb();
  const rows = db.prepare('SELECT store_id, week, day, moment, film_id FROM sig_weekplans ORDER BY store_id, week, day, moment, position').all();
  const byStore = {};
  for (const r of rows) {
    const s = (byStore[r.store_id] ||= {});
    const w = (s[r.week] ||= {});
    const d = (w[r.day] ||= {});
    (d[r.moment] ||= []).push(r.film_id);
  }
  return { windows: planWindows(), weeks: PLAN_WEEKS, activeWeek: activeWeek(), byStore };
}

// Normalise un slot : filmId, [filmId, …] ou '' → tableau d'ids.
const slotFilms = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String).filter(Boolean);

// Écrit UN jour (les 3 moments) d'un modèle de semaine, pour chaque magasin.
// { stores, week, day, slots: { matin:[…], midi:[…], aprem:[…] }, windows }.
export function savePlan({ stores, week, day, slots, windows }) {
  const db = getDb();
  if (Array.isArray(windows) && windows.length) {
    const w = {};
    for (const win of windows) {
      const m = PLAN_MOMENTS.find((x) => x.id === win.id);
      if (m) w[m.id] = { from: HHMM(win.from, m.from), to: HHMM(win.to, m.to) };
    }
    setSetting('plan_windows', JSON.stringify(w));
  }
  const targets = (Array.isArray(stores) ? stores : []).map(String);
  const wk = okWeek(week);
  const dy = okDay(day);
  if (!targets.length) return loadPlan();
  const validFilms = new Set(db.prepare('SELECT id FROM sig_playlists').all().map((p) => p.id));
  db.exec('BEGIN');
  try {
    const del = db.prepare('DELETE FROM sig_weekplans WHERE store_id = ? AND week = ? AND day = ? AND moment = ?');
    const ins = db.prepare('INSERT INTO sig_weekplans(store_id, week, day, moment, position, film_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const sid of targets) {
      for (const m of PLAN_MOMENTS) {
        del.run(sid, wk, dy, m.id);
        // Dédoublonnage + plafond : au plus MAX_PLAN_FILMS films par moment.
        const films = [...new Set(slotFilms(slots && slots[m.id]).filter((fid) => validFilms.has(fid)))].slice(0, MAX_PLAN_FILMS);
        films.forEach((fid, i) => ins.run(sid, wk, dy, m.id, i, fid));
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return loadPlan();
}

// Choisit la semaine active (globale : le modèle actuellement diffusé).
export function setActiveWeek(week) {
  setSetting('active_week', okWeek(week));
  return loadPlan();
}

// Copie tout le contenu d'un modèle de semaine vers un autre, pour des magasins.
export function duplicateWeek({ stores, from, to }) {
  const db = getDb();
  const src = okWeek(from);
  const dst = okWeek(to);
  const targets = (Array.isArray(stores) ? stores : []).map(String);
  if (!targets.length || src === dst) return loadPlan();
  db.exec('BEGIN');
  try {
    const del = db.prepare('DELETE FROM sig_weekplans WHERE store_id = ? AND week = ?');
    const rows = db.prepare('SELECT day, moment, position, film_id FROM sig_weekplans WHERE store_id = ? AND week = ?');
    const ins = db.prepare('INSERT INTO sig_weekplans(store_id, week, day, moment, position, film_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const sid of targets) {
      del.run(sid, dst);
      for (const r of rows.all(sid, src)) ins.run(sid, dst, r.day, r.moment, r.position, r.film_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return loadPlan();
}

// Films programmés pour un magasin à un instant donné : semaine active + jour
// courant + fenêtre horaire. Renvoie { films, moment, label, window, week, day }.
export function planFilmAt(storeId, date) {
  if (!storeId) return null;
  const db = getDb();
  const wk = activeWeek();
  const day = (date.getDay() + 6) % 7; // 0 = lundi
  const rows = db.prepare('SELECT moment, film_id FROM sig_weekplans WHERE store_id = ? AND week = ? AND day = ? ORDER BY moment, position').all(storeId, wk, day);
  if (!rows.length) return null;
  const byMoment = new Map();
  for (const r of rows) { if (!byMoment.has(r.moment)) byMoment.set(r.moment, []); byMoment.get(r.moment).push(r.film_id); }
  const wins = planWindows();
  const mins = date.getHours() * 60 + date.getMinutes();
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  for (const w of wins) {
    const a = toMin(w.from), b = toMin(w.to);
    const inWin = a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
    if (inWin && byMoment.has(w.id)) return { films: byMoment.get(w.id), moment: w.id, label: w.label, window: `${w.from}–${w.to}`, week: wk, day };
  }
  return null;
}

// Un écran signage standard est une dalle UHD : 3840×2160 en paysage,
// 2160×3840 en portrait — quelle que soit sa diagonale (43″, 55″, 65″…).
// Un combo de N écrans les aligne côte à côte : la largeur est multipliée.
export function storeFormat(s) {
  const n = Math.min(6, Math.max(1, parseInt(s.screens, 10) || 1));
  const size = Math.min(120, Math.max(20, parseInt(s.screen_size, 10) || 55));
  const portrait = s.screen_orient === 'portrait';
  const w1 = portrait ? 2160 : 3840;
  const h1 = portrait ? 3840 : 2160;
  return {
    screens: n, size, orient: portrait ? 'portrait' : 'paysage',
    w: w1 * n, h: h1,
    label: `${n} × ${size}″ ${portrait ? 'portrait' : 'paysage'}`,
    px: `${w1 * n} × ${h1} px`,
  };
}

// ---------------------------------------------------------------------------
// Compte d'administration du back office.
// Mot de passe : SIG_ADMIN_PASSWORD (env) — défaut « signage ». Si la variable
// est définie au démarrage, le mot de passe du compte admin est aligné dessus.
function ensureAdmin(db) {
  ensureUser(db, 'admin', process.env.SIG_ADMIN_PASSWORD, 'signage');
  // Compte « agence » (upload de vidéos/photos uniquement). Mot de passe :
  // SIG_AGENCY_PASSWORD (env), défaut « agence ».
  ensureUser(db, 'agence', process.env.SIG_AGENCY_PASSWORD, 'agence');
}
function ensureUser(db, username, envPw, fallback) {
  const row = db.prepare('SELECT pass_salt, pass_hash FROM sig_users WHERE username = ?').get(username);
  if (!row) {
    const { salt, hash } = hashPassword(envPw || fallback);
    db.prepare('INSERT INTO sig_users(username, pass_salt, pass_hash) VALUES (?, ?, ?)').run(username, salt, hash);
  } else if (envPw && !verifyPassword(envPw, row.pass_salt, row.pass_hash)) {
    const { salt, hash } = hashPassword(envPw);
    db.prepare(`UPDATE sig_users SET pass_salt = ?, pass_hash = ?, updated_at = datetime('now') WHERE username = ?`).run(salt, hash, username);
    db.prepare(`DELETE FROM sig_sessions WHERE username = ?`).run(username);
  }
}

export function checkLogin(username, password) {
  const row = getDb().prepare('SELECT pass_salt, pass_hash FROM sig_users WHERE username = ?').get(String(username || ''));
  return !!row && verifyPassword(password, row.pass_salt, row.pass_hash);
}

export function createSession(username) {
  const token = newSessionToken();
  getDb().prepare(`INSERT INTO sig_sessions(token, username, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`)
    .run(token, String(username));
  return token;
}

export function sessionUser(token) {
  if (!token) return null;
  const row = getDb().prepare(`SELECT username FROM sig_sessions WHERE token = ? AND expires_at > datetime('now')`).get(String(token));
  if (!row) return null;
  getDb().prepare(`UPDATE sig_sessions SET last_used = datetime('now') WHERE token = ?`).run(String(token));
  return row.username;
}

export function destroySession(token) {
  if (token) getDb().prepare('DELETE FROM sig_sessions WHERE token = ?').run(String(token));
}

// ---------------------------------------------------------------------------
// Settings helpers
export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM sig_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO sig_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}
export function getIntSetting(key, fallback = 0) {
  const v = getSetting(key);
  return v == null ? fallback : parseInt(v, 10);
}

// ---------------------------------------------------------------------------
// Réglages par défaut d'une base neuve (toujours posés, même sans démo).
function ensureDefaults() {
  if (getSetting('version') != null) return;
  const defaults = {
    version: '1', data_ver: '1', sec_per_line: '4', loop: '1', override: '0',
    srv_url: '', srv_ip: '127.0.0.1', srv_token: '',
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);
}

// Seed de DÉMONSTRATION (Tartes + liaison + réseau fictif) : uniquement quand
// SIG_DEMO=1 (tests, découverte). En production la base démarre vide et se
// remplit par l'import PWA — aucun « Magasin Centre-Ville » factice.
function seed(db) {
  ensureDefaults();
  if (process.env.SIG_DEMO !== '1') return;
  const count = db.prepare('SELECT COUNT(*) AS n FROM sig_modules').get().n;
  if (count > 0) return;

  const now = new Date().toISOString();
  const insMod = db.prepare(`INSERT INTO sig_modules
    (id, type, name, sub, layout, motion, tag_enabled, tag_label, tag_img, sched_days, sched_from, sched_to, pos, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insItem = db.prepare(`INSERT INTO sig_module_items
    (module_id, position, name, price, img, src, active) VALUES (?, ?, ?, ?, ?, ?, 1)`);

  insMod.run('c1', 'category', 'Tartes', '', 'illo-right', 'm1', 0, 'Nouveauté', 'assets/cherry.png',
    '[1,1,1,1,1,1,1]', '00:00', '23:59', '{}', 0);
  const items = [
    ['Brookie', '24,90', 'assets/cookies.png'],
    ['Brownies', '24,90', 'assets/cake-slice.png'],
    ['Cerise', '21,90', 'assets/cherry.png'],
    ['Fromage', '21,90', 'assets/cake.png'],
    ['Pommes Amandes', '21,90', 'assets/apple.png'],
    ['Pommes Parisienne', '21,90', 'assets/sweet-tart-small.png'],
    ['Pommes Tranches', '21,90', 'assets/sweet-tart-big.png'],
    ['Rhubarbe', '21,90', 'assets/rhubarb.png'],
  ];
  items.forEach(([name, price, img], i) => insItem.run('c1', i, name, price, img, 'illus'));

  insMod.run('l1', 'liaison', 'Fait maison', 'faites maison chaque matin', 'illo-right', 'm1', 0, 'Nouveauté',
    'assets/cherry.png', '[1,1,1,1,1,1,1]', '00:00', '23:59', '{}', 1);

  db.prepare('INSERT INTO sig_playlist(position, module_id) VALUES (0, ?), (1, ?)').run('c1', 'l1');

  const insStore = db.prepare('INSERT INTO sig_stores(id, name, grp, conn, screens, screen_size, screen_orient) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insStore.run('st1', 'Magasin Centre-Ville', 'Groupe Ville', 'fibre', 3, 55, 'portrait');
  insStore.run('st2', 'Magasin Gare', 'Groupe Ville', '4G', 1, 55, 'paysage');
  insStore.run('st3', 'Magasin Nord', 'Groupe Périphérie', 'fibre', 1, 55, 'paysage');

  const insPlayer = db.prepare(`INSERT INTO sig_players
    (id, store_id, name, hw, kiosk, orient, token, state, played_ver, assigned_ver, data_ver, cache_pct, media, disk, temp, last_seen, data_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`);
  insPlayer.run('p1', 'st1', 'Vitrine — 3× portrait', 'Android · MediaBox 4K', 1, 'Portrait', 'plyr_9F3A2C7E', 7, 7, 23, 100, 'Tartes · Brookie', '62 Go libres', '41°C', now);
  insPlayer.run('p2', 'st1', 'Comptoir — 55″', 'Android · TV-Box Pro', 1, 'Paysage', 'plyr_A51C88D0', 7, 7, 23, 100, 'Liaison · Fait maison', '12 Go libres', '44°C', now);
  insPlayer.run('p3', 'st2', 'Vitrine — 3× portrait', 'Android · MediaBox 4K', 1, 'Portrait', 'plyr_63F00B41', 6, 7, 23, 72, 'Tartes · Cerise', '5 Go libres', '52°C', now);
  insPlayer.run('p4', 'st3', 'Vitrine — 55″', 'Android · TV-Box Pro', 1, 'Paysage', 'plyr_7E2D91AC', 6, 6, 21, 100, 'Tartes · Rhubarbe (cache local)', '20 Go libres', '—', now);
  insPlayer.run('p5', 'st3', 'Comptoir — 43″', 'Android · MediaBox 4K', 0, 'Paysage', 'plyr_C4019BB7', 6, 7, 22, 38, '—', '0,4 Go libres', '58°C', now);

  for (const [k, v] of Object.entries({ version: '7', data_ver: '23', srv_token: 'plyr_9F3A2C7E' })) setSetting(k, v);
}

// Nettoyage unique des données de démonstration d'une base existante
// (« retire le mock up ») : on retire EXACTEMENT les lignes du seed d'origine
// par leur id — les magasins importés (slug), produits (pwp…) et films créés
// sont épargnés. Ne s'exécute pas en mode démo (tests).
function clearDemoSeed(db) {
  if (process.env.SIG_DEMO === '1') return;
  if (getSetting('mig_clear_demo')) return;
  const demoStores = ['st1', 'st2', 'st3'];
  const demoPlayers = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const demoModules = ['c1', 'l1'];
  const q = (arr) => arr.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM sig_players WHERE id IN (${q(demoPlayers)})`).run(...demoPlayers);
    db.prepare(`DELETE FROM sig_stores WHERE id IN (${q(demoStores)})`).run(...demoStores);
    // Catalogue démo issu de la catégorie c1 (ids pc_c1 / pr1…).
    db.prepare(`DELETE FROM sig_product_prices WHERE product_id IN (SELECT id FROM sig_products WHERE category_id = 'pc_c1')`).run();
    db.prepare(`DELETE FROM sig_products WHERE category_id = 'pc_c1'`).run();
    db.prepare(`DELETE FROM sig_product_categories WHERE id = 'pc_c1'`).run();
    // Modules démo + leurs références (items, playlist plate, films).
    db.prepare(`DELETE FROM sig_module_items WHERE module_id IN (${q(demoModules)})`).run(...demoModules);
    db.prepare(`DELETE FROM sig_playlist_items WHERE module_id IN (${q(demoModules)})`).run(...demoModules);
    db.prepare(`DELETE FROM sig_playlist WHERE module_id IN (${q(demoModules)})`).run(...demoModules);
    db.prepare(`DELETE FROM sig_modules WHERE id IN (${q(demoModules)})`).run(...demoModules);
    // Le srv_token pointait sur un player démo : on le neutralise s'il l'était.
    if (getSetting('srv_token') === 'plyr_9F3A2C7E') setSetting('srv_token', '');
    setSetting('mig_clear_demo', '1');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Lectures composées
export function loadModules() {
  const db = getDb();
  const mods = db.prepare('SELECT * FROM sig_modules ORDER BY sort_order, created_at').all();
  const itemsStmt = db.prepare('SELECT * FROM sig_module_items WHERE module_id = ? ORDER BY position');
  const catProds = db.prepare('SELECT * FROM sig_products WHERE category_id = ? ORDER BY sort_order');
  const oneProd = db.prepare('SELECT * FROM sig_products WHERE id = ?');
  const prodItem = (p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: !!p.active, productId: p.id });
  return mods.map((m) => {
    // Élément lié au catalogue : ses lignes viennent de la table produits
    // (toujours à jour) — sinon, les items propres à l'élément.
    let items;
    if (m.cat_ref) items = catProds.all(m.cat_ref).map(prodItem);
    else if (m.product_ref) {
      const p = oneProd.get(m.product_ref);
      items = p ? [prodItem(p)] : [];
    } else {
      items = itemsStmt.all(m.id).map((it) => ({
        name: it.name, price: it.price, img: it.img, src: it.src, active: !!it.active,
      }));
    }
    return {
      id: m.id,
      type: m.type,
      name: m.name,
      sub: m.sub,
      libTag: m.lib_tag || (m.type === 'liaison' ? 'liaison' : 'produit'),
      layout: m.layout,
      motion: m.motion,
      motionTitle: m.motion_title || undefined,
      motionList: m.motion_list || undefined,
      motionIllo: m.motion_illo || undefined,
      catRef: m.cat_ref || '',
      productRef: m.product_ref || '',
      video: m.video || '',
      surprise: !!m.surprise,
      watermark: m.watermark || 'none',
      dur: m.dur || 0,
      tag: { enabled: !!m.tag_enabled, label: m.tag_label, img: m.tag_img },
      schedule: { days: JSON.parse(m.sched_days).map(Boolean), from: m.sched_from, to: m.sched_to },
      pos: { titleY: 0, listX: 0, listY: 0, illoX: 0, illoY: 0, illoScale: 1, ...JSON.parse(m.pos || '{}') },
      items,
    };
  });
}

export function loadPlaylists() {
  const db = getDb();
  const pls = db.prepare('SELECT * FROM sig_playlists ORDER BY sort_order, created_at').all();
  const it = db.prepare('SELECT module_id FROM sig_playlist_items WHERE playlist_id = ? ORDER BY position');
  return pls.map((p) => ({
    id: p.id,
    name: p.name,
    items: it.all(p.id).map((r) => r.module_id),
    cat: p.cat || '',
    tags: (() => { try { return JSON.parse(p.tags || '[]'); } catch { return []; } })(),
    schedule: {
      days: JSON.parse(p.sched_days || '[1,1,1,1,1,1,1]').map(Boolean),
      from: p.sched_from || '00:00',
      to: p.sched_to || '23:59',
    },
    planDays: (() => { try { return JSON.parse(p.plan_days || '[1,1,1,1,1,1,1]').map(Boolean); } catch { return [true, true, true, true, true, true, true]; } })(),
    stores: JSON.parse(p.stores || '[]'),
  }));
}

export function activePlaylistId() {
  const pls = loadPlaylists();
  const act = getSetting('active_playlist');
  const found = pls.find((p) => p.id === act);
  return found ? found.id : (pls[0] ? pls[0].id : null);
}

// Items du film actif (compat : le « film » historique unique).
export function loadPlaylist() {
  const pls = loadPlaylists();
  const act = activePlaylistId();
  const p = pls.find((x) => x.id === act) || pls[0];
  return p ? p.items : [];
}

export function saveDraft({ modules, playlist, playlists, activePlaylistId: activeId, secPerLine, loop }) {
  const db = getDb();
  // Compat : un client qui n'envoie qu'une liste plate devient un film unique.
  if (!Array.isArray(playlists) || playlists.length === 0) {
    playlists = [{ id: 'pl1', name: 'Film principal', items: Array.isArray(playlist) ? playlist : [] }];
    activeId = 'pl1';
  }
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_module_items');
    db.exec('DELETE FROM sig_playlist');
    db.exec('DELETE FROM sig_playlist_items');
    db.exec('DELETE FROM sig_playlists');
    db.exec('DELETE FROM sig_modules');
    const insMod = db.prepare(`INSERT INTO sig_modules
      (id, type, name, sub, layout, motion, motion_title, motion_list, motion_illo,
       tag_enabled, tag_label, tag_img, sched_days, sched_from, sched_to, pos, sort_order, lib_tag,
       cat_ref, product_ref, video, surprise, watermark, dur, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
    const insItem = db.prepare(`INSERT INTO sig_module_items
      (module_id, position, name, price, img, src, active) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    // Les types valides viennent de la table sig_element_types (rien en dur).
    const validTypes = new Set(db.prepare('SELECT id FROM sig_element_types').all().map((r) => r.id));
    modules.forEach((m, i) => {
      const tag = m.tag || {};
      const sched = m.schedule || {};
      insMod.run(
        m.id, validTypes.has(m.type) ? m.type : 'category', String(m.name || ''), String(m.sub || ''),
        String(m.layout || 'illo-right'), String(m.motion || 'm1'),
        m.motionTitle || null, m.motionList || null, m.motionIllo || null,
        tag.enabled ? 1 : 0, String(tag.label || ''), String(tag.img || ''),
        JSON.stringify((sched.days || [1, 1, 1, 1, 1, 1, 1]).map((d) => (d ? 1 : 0))),
        String(sched.from || '00:00'), String(sched.to || '23:59'),
        JSON.stringify(m.pos || {}), i, String(m.libTag || ''),
        String(m.catRef || ''), String(m.productRef || ''), String(m.video || ''),
        m.surprise ? 1 : 0,
        ['filigrane', 'logo', 'nouveau'].includes(m.watermark) ? m.watermark : 'none',
        Number.isFinite(parseFloat(m.dur)) ? Math.max(0, Math.min(120, parseFloat(m.dur))) : 0
      );
      // Un élément lié au catalogue ne stocke pas d'items propres.
      if (!m.catRef && !m.productRef) {
        (m.items || []).forEach((it, j) => insItem.run(
          m.id, j, String(it.name || ''), String(it.price || ''), String(it.img || ''),
          it.src === 'photo' ? 'photo' : 'illus', it.active ? 1 : 0
        ));
      }
    });
    const validIds = new Set(modules.map((m) => m.id));
    const insPls = db.prepare('INSERT INTO sig_playlists(id, name, sort_order, sched_days, sched_from, sched_to, stores, cat, tags, plan_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insIt = db.prepare('INSERT INTO sig_playlist_items(playlist_id, position, module_id) VALUES (?, ?, ?)');
    playlists.forEach((pl, i) => {
      const sched = pl.schedule || {};
      insPls.run(
        String(pl.id), String(pl.name || `Film ${i + 1}`), i,
        JSON.stringify((Array.isArray(sched.days) && sched.days.length === 7 ? sched.days : [1, 1, 1, 1, 1, 1, 1]).map((d) => (d ? 1 : 0))),
        String(sched.from || '00:00'), String(sched.to || '23:59'),
        JSON.stringify(Array.isArray(pl.stores) ? pl.stores.map(String) : []),
        String(pl.cat || ''),
        JSON.stringify(Array.isArray(pl.tags) ? pl.tags.map(String).filter(Boolean) : []),
        JSON.stringify((Array.isArray(pl.planDays) && pl.planDays.length === 7 ? pl.planDays : [1, 1, 1, 1, 1, 1, 1]).map((d) => (d ? 1 : 0)))
      );
      (pl.items || []).filter((id) => validIds.has(id)).forEach((id, j) => insIt.run(String(pl.id), j, id));
    });
    const act = playlists.some((p) => p.id === activeId) ? activeId : playlists[0].id;
    setSetting('active_playlist', String(act));
    // Table historique maintenue en miroir du film actif (compat).
    const insPl = db.prepare('INSERT INTO sig_playlist(position, module_id) VALUES (?, ?)');
    const actItems = (playlists.find((p) => p.id === act) || playlists[0]).items || [];
    actItems.filter((id) => validIds.has(id)).forEach((id, i) => insPl.run(i, id));
    if (secPerLine != null) setSetting('sec_per_line', String(secPerLine));
    if (loop != null) setSetting('loop', loop ? '1' : '0');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
