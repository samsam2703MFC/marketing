// Base de données du module signage — node:sqlite (zéro dépendance).
// Toutes les tables sont préfixées `sig_`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newSessionToken } from './auth.js';
// Config du mode « continu » : source unique partagée avec la régie.
import { continuousDefaults, normContinuous } from '../public/js/continuous.js';

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
  ensurePromoTypes(db);
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

  -- Groupes d'écrans d'un magasin (grands points de vente) : chaque groupe a son
  -- combo de dalles (taille/orientation propre) et un filtre de catégories. Un
  -- groupe avec des catégories diffuse une boucle continue de ces catégories
  -- TOUTE LA JOURNÉE (sans moment ni saison) ; sans catégorie il suit le film du
  -- magasin. Les players rattachés à un groupe (sig_players.group_id) prennent
  -- son contenu et son format ; un player sans groupe suit le magasin (défaut).
  CREATE TABLE IF NOT EXISTS sig_screen_groups (
    id            TEXT PRIMARY KEY,
    store_id      TEXT NOT NULL REFERENCES sig_stores(id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT 'Zone',
    screens       INTEGER NOT NULL DEFAULT 1,
    screen_size   INTEGER NOT NULL DEFAULT 55,
    screen_orient TEXT NOT NULL DEFAULT 'portrait',
    cats          TEXT NOT NULL DEFAULT '[]',
    sort_order    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sig_screen_groups_store ON sig_screen_groups(store_id, sort_order);

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
  // Mode du film : 'playlist' (séquence montée à la main) ou 'continu' (boucle
  // composée en direct depuis le catalogue + saisons + moments + tags).
  if (!plCols.includes('mode')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN mode TEXT NOT NULL DEFAULT 'playlist'`);
  if (!plCols.includes('continuous')) db.exec(`ALTER TABLE sig_playlists ADD COLUMN continuous TEXT NOT NULL DEFAULT '{}'`);
  // Vocabulaire des moments unifié (matin/midi/aprem) : on réaligne les médias
  // historiquement tagués « soir » sur « aprem » (même créneau). No-op ensuite.
  try { db.exec(`UPDATE sig_media SET moment = 'aprem' WHERE moment = 'soir'`); } catch { /* table absente */ }
  // Combo d'écrans du magasin (ex. 3 × 55″ portrait) → taille du film en px.
  const stCols = db.prepare('PRAGMA table_info(sig_stores)').all().map((c) => c.name);
  if (!stCols.includes('screens')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screens INTEGER NOT NULL DEFAULT 1`);
  if (!stCols.includes('screen_size')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screen_size INTEGER NOT NULL DEFAULT 55`);
  if (!stCols.includes('screen_orient')) db.exec(`ALTER TABLE sig_stores ADD COLUMN screen_orient TEXT NOT NULL DEFAULT 'paysage'`);
  if (!stCols.includes('active')) db.exec(`ALTER TABLE sig_stores ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
  // Coordonnées du magasin : alimentent les champs dynamiques {{adresse}},
  // {{horaires}}, {{tel}} des gabarits, résolus par magasin à la diffusion.
  if (!stCols.includes('address')) db.exec(`ALTER TABLE sig_stores ADD COLUMN address TEXT NOT NULL DEFAULT ''`);
  if (!stCols.includes('hours')) db.exec(`ALTER TABLE sig_stores ADD COLUMN hours TEXT NOT NULL DEFAULT ''`);
  if (!stCols.includes('phone')) db.exec(`ALTER TABLE sig_stores ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
  // Produit en rupture / indisponible : masqué des boucles continues et signalé
  // en régie (toggle manuel, ou futur signal de stock ERP).
  const prodCols0 = db.prepare('PRAGMA table_info(sig_products)').all().map((c) => c.name);
  if (prodCols0.length && !prodCols0.includes('unavailable')) db.exec(`ALTER TABLE sig_products ADD COLUMN unavailable INTEGER NOT NULL DEFAULT 0`);
  // Rattachement d'un player à un groupe d'écrans (vide = niveau magasin, défaut).
  const plColsG = db.prepare('PRAGMA table_info(sig_players)').all().map((c) => c.name);
  if (plColsG.length && !plColsG.includes('group_id')) db.exec(`ALTER TABLE sig_players ADD COLUMN group_id TEXT NOT NULL DEFAULT ''`);

  // Illustration de période (importable depuis ws_season si la table l'expose,
  // ou saisie à la main) : URL/chemin de l'image affichée dans l'onglet Périodes.
  const seasonCols = db.prepare('PRAGMA table_info(sig_seasons)').all().map((c) => c.name);
  if (seasonCols.length && !seasonCols.includes('image')) db.exec(`ALTER TABLE sig_seasons ADD COLUMN image TEXT NOT NULL DEFAULT ''`);

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
  // Élément « promotion » : sous-type d'offre (référence sig_promo_types, dynamique).
  if (!modCols2.includes('promo_type')) db.exec(`ALTER TABLE sig_modules ADD COLUMN promo_type TEXT NOT NULL DEFAULT ''`);
  // Élément « campagne » : référence une campagne marketing (sig_campaigns).
  if (!modCols2.includes('campaign_ref')) db.exec(`ALTER TABLE sig_modules ADD COLUMN campaign_ref TEXT NOT NULL DEFAULT ''`);
  // Élément « gabarit HTML » : code collé par la régie + taille de sa maquette
  // source (ex. 1920 × 1080 pour du 16:9, 840 × 1189 pour une affiche A1).
  // Orientation de l'élément : 'paysage' (16:9) ou 'portrait' (9:16) — un écran
  // est l'un ou l'autre. Sert de filtre des items disponibles au montage.
  if (!modCols2.includes('orient')) db.exec(`ALTER TABLE sig_modules ADD COLUMN orient TEXT NOT NULL DEFAULT 'paysage'`);
  if (!modCols2.includes('html')) db.exec(`ALTER TABLE sig_modules ADD COLUMN html TEXT NOT NULL DEFAULT ''`);
  // Liaisons des variables du gabarit HTML vers les données (JSON) :
  // { nomVariable: { src: 'literal|magasin|produit|promotion|campagne', field, value } }
  if (!modCols2.includes('html_vars')) db.exec(`ALTER TABLE sig_modules ADD COLUMN html_vars TEXT NOT NULL DEFAULT '{}'`);
  if (!modCols2.includes('html_w')) db.exec(`ALTER TABLE sig_modules ADD COLUMN html_w INTEGER NOT NULL DEFAULT 1920`);
  if (!modCols2.includes('html_h')) db.exec(`ALTER TABLE sig_modules ADD COLUMN html_h INTEGER NOT NULL DEFAULT 1080`);
  // Reprise unique de l'ancien état « auto » (tous formats) : un écran est
  // portrait OU paysage. Un gabarit HTML retombe sur la forme de sa maquette,
  // le reste sur paysage (16:9, le format d'écran courant).
  if (!getSetting('mig_orient_binaire')) {
    db.prepare(`UPDATE sig_modules SET orient = 'portrait' WHERE orient NOT IN ('paysage', 'portrait') AND type = 'html' AND html_h > html_w`).run();
    db.prepare(`UPDATE sig_modules SET orient = 'paysage' WHERE orient NOT IN ('paysage', 'portrait')`).run();
    setSetting('mig_orient_binaire', '1');
  }


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
        dur          REAL NOT NULL DEFAULT 0,
        surprise     INTEGER NOT NULL DEFAULT 0,
        watermark    TEXT NOT NULL DEFAULT 'none',
        promo_type   TEXT NOT NULL DEFAULT '',
        campaign_ref TEXT NOT NULL DEFAULT '',
        orient       TEXT NOT NULL DEFAULT 'paysage',
        html         TEXT NOT NULL DEFAULT '',
        html_vars    TEXT NOT NULL DEFAULT '{}',
        html_w       INTEGER NOT NULL DEFAULT 1920,
        html_h       INTEGER NOT NULL DEFAULT 1080
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
    unavailable INTEGER NOT NULL DEFAULT 0,
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
    image      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  -- Sous-types de promotion (dynamiques, pilotés par la base — rien en dur côté
  -- interface). Happy hour, vente flash, bundle… Gérable en régie et importable
  -- depuis l'ERP (menu « Promotions ») ensuite. Un élément « promotion » pointe
  -- vers l'un de ces sous-types via sig_modules.promo_type.
  CREATE TABLE IF NOT EXISTS sig_promo_types (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    icon       TEXT NOT NULL DEFAULT '🏷️',
    color      TEXT NOT NULL DEFAULT '#C0392B',
    descr      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  -- Campagnes marketing : entités listées (nom, portée produit/gamme, visuel,
  -- accroche, période). Gérable en régie et importable depuis l'ERP ensuite.
  -- L'utilisateur n'a qu'à les DÉPOSER comme item : un élément « campagne »
  -- pointe vers l'une d'elles via sig_modules.campaign_ref, et son contenu
  -- (nom, visuel, produit lié, dates) est résolu à l'affichage.
  CREATE TABLE IF NOT EXISTS sig_campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    scope       TEXT NOT NULL DEFAULT 'produit',
    product_ref TEXT NOT NULL DEFAULT '',
    theme       TEXT NOT NULL DEFAULT '',
    image       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL DEFAULT '',
    date_from   TEXT NOT NULL DEFAULT '',
    date_to     TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#8D1D2C',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
  );

  -- Table de jointure produit ↔ période de vente (moment de la journée).
  -- Dit à quels moments un produit est vendu (matin/midi/aprem). « exception »
  -- = 1 inverse la règle (produit exclu à ce moment). Sert au mode « continu »
  -- pour ne montrer que les produits pertinents à l'heure courante.
  CREATE TABLE IF NOT EXISTS sig_product_moments (
    product_id TEXT NOT NULL,
    moment     TEXT NOT NULL,
    exception  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, moment)
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
  const promoLayouts = JSON.stringify([
    { id: 'band', icon: '▬', label: 'Bandeau — badge + offre' },
    { id: 'center', icon: '▣', label: 'Centré — badge + offre' },
    { id: 'hero-right', icon: '▥', label: 'Offre à gauche · photo produit à droite' },
    { id: 'hero-left', icon: '▥', label: 'Photo produit à gauche · offre à droite' },
  ]);
  const campaignLayouts = JSON.stringify([
    { id: 'cover', icon: '◼', label: 'Visuel plein écran + accroche' },
    { id: 'center', icon: '▣', label: 'Centré — nom + accroche' },
    { id: 'hero-right', icon: '▥', label: 'Texte à gauche · visuel/produit à droite' },
    { id: 'hero-left', icon: '▥', label: 'Visuel/produit à gauche · texte à droite' },
  ]);
  // Type « média ciblé » : ajouté même sur une base existante (hors seed initial).
  const ensureMedia = () => {
    if (!db.prepare('SELECT 1 FROM sig_element_types WHERE id = ?').get('media')) {
      insType.run('media', 'Média ciblé — agence', '🎯',
        'Diffuse une vidéo/photo de la médiathèque agence, tirée au sort selon le moment (matin/midi/après-midi) et la saison active.',
        mediaLayouts, 0, 5);
    }
  };
  // Type « promotion » : ajouté même sur une base existante (hors seed initial).
  // Le sous-type (happy hour, flash, bundle…) vient de la table sig_promo_types.
  const ensurePromotion = () => {
    if (!db.prepare('SELECT 1 FROM sig_element_types WHERE id = ?').get('promotion')) {
      insType.run('promotion', 'Promotion — offre', '🏷️',
        'Met en avant une offre commerciale (happy hour, vente flash, bundle, achetez X obtenez Y, remise planifiée, bon d\'achat…). Le sous-type est piloté par la base (menu Promotions).',
        promoLayouts, 0, 6);
    }
  };
  // Type « campagne marketing » : ajouté même sur une base existante. Le contenu
  // vient d'une campagne listée dans la table sig_campaigns (menu Campagnes) —
  // il suffit de choisir la campagne à diffuser.
  const ensureCampaign = () => {
    if (!db.prepare('SELECT 1 FROM sig_element_types WHERE id = ?').get('campagne')) {
      insType.run('campagne', 'Campagne marketing', '📣',
        'Diffuse une campagne marketing (produit ou gamme thématique) choisie dans la liste des campagnes (menu Campagnes). Visuel, accroche, produit lié et période sont portés par la campagne.',
        campaignLayouts, 0, 7);
    }
  };
  // Type « gabarit HTML » : on colle du code (maquette, affiche…) et il est mis
  // à l'échelle sur l'écran. Les variables {{…}} y sont résolues par magasin.
  const htmlLayouts = JSON.stringify([
    { id: 'fit', icon: '▭', label: 'Adapter — maquette entière visible' },
    { id: 'cover', icon: '◼', label: 'Remplir l\'écran (recadre les bords)' },
    { id: 'stretch', icon: '⤢', label: 'Étirer aux dimensions de l\'écran' },
  ]);
  const ensureHtml = () => {
    if (!db.prepare('SELECT 1 FROM sig_element_types WHERE id = ?').get('html')) {
      insType.run('html', 'Gabarit HTML — coller du code', '⟨⟩',
        'Colle du HTML (maquette, affiche, gabarit généré) : il est mis à l\'échelle sur l\'écran. Les variables {{magasin}}, {{adresse}}, {{date}}, {{saison}}… y sont remplacées par magasin à la diffusion.',
        htmlLayouts, 0, 8);
    }
  };
  const n = db.prepare('SELECT COUNT(*) AS n FROM sig_element_types').get().n;
  if (n > 0) { ensureMedia(); ensurePromotion(); ensureCampaign(); ensureHtml(); return; }
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
  ensurePromotion();
  ensureCampaign();
  ensureHtml();
}

// ---------------------------------------------------------------------------
// Sous-types de promotion — table dynamique (rien en dur côté interface). Au
// premier lancement, elle est amorcée avec les cas courants (happy hour, vente
// flash, bundle, achetez X obtenez Y, remise planifiée, bon d'achat) ; la régie
// peut ensuite les modifier, et l'ERP (menu « Promotions ») les alimenter.
function ensurePromoTypes(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM sig_promo_types').get().n;
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO sig_promo_types(id, name, icon, color, descr, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)');
  const seed = [
    ['happy-hour', 'Happy hour', '🕒', '#8E44AD', 'Réduction sur un créneau horaire précis (ex. 16h–18h).'],
    ['flash', 'Vente flash', '⚡', '#E67E22', 'Offre à durée très limitée, forte remise.'],
    ['bundle', 'Bundle de produits', '🎁', '#16A085', 'Lot de produits vendus ensemble à prix avantageux.'],
    ['bxgy', 'Achetez X, obtenez Y', '➕', '#2980B9', 'Ex. 2 achetés = 1 offert.'],
    ['scheduled', 'Remise planifiée', '📅', '#C0392B', 'Remise sur une période datée (du … au …).'],
    ['voucher', "Bon d'achat", '🎟️', '#D35400', "Bon ou coupon à valoir sur un prochain achat."],
  ];
  seed.forEach((s, i) => ins.run(s[0], s[1], s[2], s[3], s[4], i));
}

export function loadPromoTypes() {
  return getDb().prepare('SELECT * FROM sig_promo_types ORDER BY sort_order, name').all().map((t) => ({
    id: t.id, name: t.name, icon: t.icon, color: t.color, descr: t.descr,
    active: !!t.active,
  }));
}

export function promoTypeById(id) {
  if (!id) return null;
  const t = getDb().prepare('SELECT * FROM sig_promo_types WHERE id = ?').get(id);
  return t ? { id: t.id, name: t.name, icon: t.icon, color: t.color, descr: t.descr, active: !!t.active } : null;
}

// Remplace l'ensemble des sous-types de promotion (édition en régie). Les
// éléments « promotion » qui pointaient vers un sous-type supprimé gardent leur
// identifiant (résolu en repli neutre à l'affichage) — aucune donnée perdue.
export function savePromoTypes(list) {
  const db = getDb();
  const rows = (Array.isArray(list) ? list : [])
    .map((t) => ({
      id: String(t.id || '').trim(),
      name: String(t.name || '').trim(),
      icon: String(t.icon || '🏷️').trim() || '🏷️',
      color: /^#[0-9a-fA-F]{3,8}$/.test(String(t.color || '')) ? t.color : '#C0392B',
      descr: String(t.descr || '').trim(),
      active: t.active === false ? 0 : 1,
    }))
    .filter((t) => t.id && t.name);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_promo_types');
    const ins = db.prepare('INSERT OR REPLACE INTO sig_promo_types(id, name, icon, color, descr, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)');
    rows.forEach((t, i) => ins.run(t.id, t.name, t.icon, t.color, t.descr, i, t.active));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return loadPromoTypes();
}

// ---------------------------------------------------------------------------
// Campagnes marketing — liste d'entités gérée en régie (et importable de l'ERP
// ensuite). L'utilisateur les DÉPOSE simplement comme item (élément « campagne »
// qui pointe vers l'une d'elles). Portée : produit (photo/prix depuis le
// catalogue) ou gamme thématique (libellé de thème). En démo, deux exemples.
const CAMPAIGN_SCOPES = new Set(['produit', 'gamme']);
function campaignRow(c) {
  return {
    id: c.id, name: c.name, scope: CAMPAIGN_SCOPES.has(c.scope) ? c.scope : 'produit',
    productRef: c.product_ref || '', theme: c.theme || '', image: c.image || '',
    message: c.message || '', dateFrom: c.date_from || '', dateTo: c.date_to || '',
    color: c.color || '#8D1D2C', active: !!c.active,
  };
}

export function loadCampaigns() {
  return getDb().prepare('SELECT * FROM sig_campaigns ORDER BY sort_order, name').all().map(campaignRow);
}

export function campaignById(id) {
  if (!id) return null;
  const c = getDb().prepare('SELECT * FROM sig_campaigns WHERE id = ?').get(id);
  return c ? campaignRow(c) : null;
}

// Remplace l'ensemble des campagnes (édition en régie). Les éléments qui
// pointaient vers une campagne supprimée gardent leur identifiant (résolu en
// repli neutre à l'affichage) — aucune donnée perdue.
export function saveCampaigns(list) {
  const db = getDb();
  const rows = (Array.isArray(list) ? list : [])
    .map((c) => ({
      id: String(c.id || '').trim(),
      name: String(c.name || '').trim(),
      scope: CAMPAIGN_SCOPES.has(c.scope) ? c.scope : 'produit',
      productRef: String(c.productRef || '').trim(),
      theme: String(c.theme || '').trim().slice(0, 120),
      image: String(c.image || '').trim().slice(0, 2000),
      message: String(c.message || '').trim().slice(0, 240),
      dateFrom: String(c.dateFrom || '').trim().slice(0, 20),
      dateTo: String(c.dateTo || '').trim().slice(0, 20),
      color: /^#[0-9a-fA-F]{3,8}$/.test(String(c.color || '')) ? c.color : '#8D1D2C',
      active: c.active === false ? 0 : 1,
    }))
    .filter((c) => c.id && c.name);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_campaigns');
    const ins = db.prepare(`INSERT OR REPLACE INTO sig_campaigns
      (id, name, scope, product_ref, theme, image, message, date_from, date_to, color, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    rows.forEach((c, i) => ins.run(c.id, c.name, c.scope, c.productRef, c.theme, c.image, c.message, c.dateFrom, c.dateTo, c.color, i, c.active));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return loadCampaigns();
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
    img: p.img, src: p.src, active: !!p.active, unavailable: !!p.unavailable,
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
    const insProd = db.prepare('INSERT OR REPLACE INTO sig_products(id, category_id, name, price, img, src, active, unavailable, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
        p.active === false ? 0 : 1, p.unavailable ? 1 : 0, i);
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
    color: s.color || '#C97B4A', image: s.image || '', active: !!s.active,
  }));
}

export function saveSeasons(seasons) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_seasons');
    const ins = db.prepare('INSERT INTO sig_seasons(id, name, date_from, date_to, products, color, image, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    (Array.isArray(seasons) ? seasons : []).forEach((s, i) => {
      ins.run(String(s.id || 'se' + i), String(s.name || ''), String(s.from || ''), String(s.to || ''),
        JSON.stringify(Array.isArray(s.products) ? s.products.map(String) : []),
        String(s.color || '#C97B4A'), String(s.image || ''), i, s.active === false ? 0 : 1);
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
// Périodes de vente (moments de la journée) par produit — table de jointure.
// moment ∈ {matin, midi, aprem}. exception = true → produit EXCLU à ce moment.
export const SALE_MOMENTS = ['matin', 'midi', 'aprem'];
export function loadProductMoments() {
  return getDb().prepare('SELECT product_id, moment, exception FROM sig_product_moments ORDER BY product_id, moment').all()
    .map((r) => ({ productId: r.product_id, moment: r.moment, exception: !!r.exception }));
}
export function saveProductMoments(rows) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_product_moments');
    const ins = db.prepare('INSERT OR REPLACE INTO sig_product_moments(product_id, moment, exception) VALUES (?, ?, ?)');
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (!r || !r.productId || !SALE_MOMENTS.includes(r.moment)) continue;
      ins.run(String(r.productId), String(r.moment), r.exception ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return loadProductMoments();
}
// Alias historique — le vocabulaire est désormais unifié (matin/midi/aprem),
// donc c'est simplement currentMoment(). Conservé pour compat des appels.
export function currentSaleMoment(date = new Date()) { return currentMoment(date); }
// Un produit est-il vendu au moment donné ? Règle : si le produit a au moins
// une ligne d'inclusion (exception=0), il n'est vendu QU'À ces moments-là ;
// une ligne exception=1 retire ce moment. Sans aucune ligne → tous les moments.
export function productMomentFilter(date = new Date()) {
  const rows = loadProductMoments();
  const moment = currentSaleMoment(date);
  const incl = new Map();   // productId -> Set(moments inclus)
  const excl = new Map();   // productId -> Set(moments exclus)
  for (const r of rows) {
    const bag = r.exception ? excl : incl;
    if (!bag.has(r.productId)) bag.set(r.productId, new Set());
    bag.get(r.productId).add(r.moment);
  }
  return (productId) => {
    if (excl.has(productId) && excl.get(productId).has(moment)) return false;
    const inc = incl.get(productId);
    if (inc && inc.size) return inc.has(moment);
    return true; // aucune règle d'inclusion : vendu à tous les moments
  };
}

// ---------------------------------------------------------------------------
// Ré-exportées pour les appelants qui importent depuis db.js (importées en tête).
export { continuousDefaults, normContinuous };
// PRNG déterministe : la boucle est stable dans une « fenêtre » (bucket) donnée
// et ne change qu'au changement de moment/saison (ou toutes les N minutes).
function strHash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffleWith(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
export function continuousBucket(cfg, date = new Date()) {
  cfg = normContinuous(cfg);
  const moment = currentMoment(date);
  const seasons = currentSeasons(date).map((s) => s.id).sort().join(',');
  let slot = '';
  if (cfg.refresh === 'minutes') slot = 'm' + Math.floor((date.getHours() * 60 + date.getMinutes()) / cfg.refreshMin);
  return `${moment}|${seasons}|${slot}`;
}
export function continuousRevision(cfg, date = new Date()) { return String(strHash(continuousBucket(cfg, date))); }

const ANIM_MSG = { matin: 'Bonne journée', midi: 'Bon appétit', aprem: 'À emporter' };

// Compose la boucle du mode continu. ctx.surprise = [urls] (fourni par l'API,
// db.js ne touche pas au système de fichiers). Modules AUTO-SUFFISANTS : ils
// jouent tels quels sur l'écran comme dans la visionneuse.
export function buildContinuous(cfg, date = new Date(), ctx = {}) {
  cfg = normContinuous(cfg);
  const rng = mulberry32(strHash(continuousBucket(cfg, date)));
  const { categories, products } = loadCatalog();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const momentOk = cfg.perMoment ? productMomentFilter(date) : () => true;
  const moment = currentMoment(date);
  const activeSeasons = new Set(currentSeasons(date).map((s) => s.id));

  // 1) Pool de produits éligibles : actif + pas en rupture + source + moment de vente.
  let pool = products.filter((p) => p.active && !p.unavailable && momentOk(p.id));
  if (cfg.source === 'categories') {
    // Les catégories choisies sont des EXCEPTIONS : tout SAUF ces catégories.
    const cats = new Set(cfg.categories);
    pool = pool.filter((p) => !cats.has(p.categoryId));
  } else if (cfg.source === 'saison') {
    const inSeason = new Set(currentSeasons(date).flatMap((s) => s.products || []));
    const seasonPool = inSeason.size ? pool.filter((p) => inSeason.has(p.id)) : [];
    pool = seasonPool.length ? seasonPool : (cfg.fallback === 'aucun' ? [] : pool);
  }
  // Liste blanche de catégories (zones/groupes d'écrans) : ne garder que ces
  // catégories. S'applique après la source (ex. « tout » + catsInclude = ces
  // catégories, toute la journée).
  if (Array.isArray(cfg.catsInclude) && cfg.catsInclude.length) {
    const inc = new Set(cfg.catsInclude.map(String));
    pool = pool.filter((p) => inc.has(p.categoryId));
  }
  if (cfg.order === 'aleatoire') pool = shuffleWith(pool.slice(), rng);
  pool = pool.slice(0, cfg.maxItems);

  // 2) Listes par catégorie (l'ossature de la boucle).
  const byCat = new Map();
  for (const p of pool) { if (!byCat.has(p.categoryId)) byCat.set(p.categoryId, []); byCat.get(p.categoryId).push(p); }
  const catLists = [...byCat.entries()].map(([cid, ps]) => ({ name: catName.get(cid) || 'Nos produits', products: ps }));

  // 3) Clips ciblés disponibles (moment + saison) — comme « média ciblé ».
  const clips = loadMedia().filter((mm) => (!cfg.perMoment || mm.moment === moment || mm.moment === 'all') && (!mm.seasonId || activeSeasons.has(mm.seasonId)));
  const surprise = Array.isArray(ctx.surprise) ? ctx.surprise : [];

  const item = (p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: true, productId: p.id });
  const clipModule = (c, id) => (c.kind === 'photo'
    ? { id, type: 'media', layout: 'cover', mediaKind: 'photo', mediaUrl: 'media/' + encodeURIComponent(c.filename), dur: cfg.clipDur, items: [], tag: { enabled: false } }
    : { id, type: 'film', video: 'media/' + encodeURIComponent(c.filename), dur: cfg.clipDur, items: [], tag: { enabled: false } });

  // 4) Composition : slots avec ratios « 1 : N » par type d'élément.
  const modules = [];
  const R = cfg.ratios;
  const hit = (n, i) => n > 0 && (i % n === 0);
  const L = Math.max(4, Math.min(cfg.maxItems, (Math.max(catLists.length, pool.length) || 2) * 2));
  let catI = 0, prodI = 0;
  for (let i = 1; i <= L; i++) {
    if (hit(R.liaison, i)) { modules.push({ id: `k-lia-${i}`, type: 'liaison', name: "L'Atelier By", sub: '', items: [], tag: { enabled: false } }); continue; }
    if (hit(R.media, i) && clips.length) { modules.push(clipModule(clips[Math.floor(rng() * clips.length)], `k-clip-${i}`)); continue; }
    if (hit(R.produitSeul, i) && pool.length) { const p = pool[prodI++ % pool.length]; modules.push({ id: `k-prod-${i}`, type: 'produit', name: catName.get(p.categoryId) || 'À la une', layout: 'hero-left', motion: 'm1', productRef: p.id, dur: cfg.prodDur, items: [item(p)], tag: { enabled: false } }); continue; }
    if (hit(R.animation, i)) { modules.push({ id: `k-ani-${i}`, type: 'animation', name: ANIM_MSG[moment] || "L'Atelier By", sub: '', layout: 'band', motion: 'm2', dur: cfg.prodDur, items: [], tag: { enabled: false } }); continue; }
    if (catLists.length) { const cl = catLists[catI++ % catLists.length]; modules.push({ id: `k-cat-${i}`, type: 'category', name: cl.name, layout: 'illo-right', motion: 'm1', items: cl.products.map(item), tag: { enabled: false } }); }
    else if (pool.length) { const p = pool[prodI++ % pool.length]; modules.push({ id: `k-prod-${i}`, type: 'produit', name: catName.get(p.categoryId) || 'À la une', layout: 'hero-left', motion: 'm1', productRef: p.id, dur: cfg.prodDur, items: [item(p)], tag: { enabled: false } }); }
  }
  // 5) Playlists d'exception : jouées EN PLUS à chaque boucle (plusieurs possibles).
  if (cfg.exceptionFilms.length) {
    const pls = loadPlaylists();
    const byId = new Map(loadModules().map((mm) => [mm.id, mm]));
    for (const fid of cfg.exceptionFilms) {
      const exf = pls.find((p) => p.id === fid && p.mode !== 'continu');
      if (!exf || !exf.items.length) continue;
      for (const id of exf.items) { const mm = byId.get(id); if (mm) modules.push({ ...mm, id: `k-exc-${fid}-${id}` }); }
    }
  }
  // 6) Vidéo surprise en clôture (si ratio > 0 et dossier non vide).
  if (R.surprise > 0 && surprise.length) modules.push({ id: 'k-surprise', type: 'film', video: surprise[Math.floor(rng() * surprise.length)], dur: cfg.clipDur, items: [], tag: { enabled: false } });
  // 7) Boucle vide : slide d'attente.
  if (!modules.length) modules.push({ id: 'k-empty', type: 'liaison', name: "L'Atelier By", sub: 'boucle en préparation', items: [], tag: { enabled: false } });

  const media = modules.flatMap((m) => (m.items || []).map((it) => it.img)).filter((u) => u && !String(u).startsWith('data:'));
  return {
    modules,
    playlist: modules.map((m) => m.id),
    media,
    revision: continuousRevision(cfg, date),
    meta: { moment, seasons: [...activeSeasons], products: pool.length, clips: clips.length, slots: modules.length },
  };
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
      ['matin', 'midi', 'aprem'].includes(m.moment) ? m.moment : 'all',
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

// Champs dynamiques : remplace les jetons {{…}} des textes d'éléments (titre et
// sous-titre) par les valeurs du magasin (nom/adresse/horaires/tél) et du
// contexte (date/saison/moment). Résolu PAR MAGASIN à la diffusion : un seul
// gabarit affiche les bonnes valeurs selon le point de vente. Sans magasin
// (aperçu générique) les jetons magasin deviennent vides ; un jeton inconnu est
// laissé tel quel pour que l'auteur repère sa faute de frappe.
export const STORE_TOKENS = [
  { key: 'magasin', label: 'Nom du magasin' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'horaires', label: 'Horaires' },
  { key: 'tel', label: 'Téléphone' },
  { key: 'date', label: 'Date du jour (ex. vendredi 25 juillet)' },
  { key: 'saison', label: 'Période(s) active(s) du jour' },
  { key: 'moment', label: 'Moment (matin / midi / après-midi)' },
];
// ---------------------------------------------------------------------------
// Variables d'un gabarit HTML — chaque {{ variable }} détectée dans le code est
// liée à une source de données (produit, promotion, campagne, magasin) ou à une
// valeur libre. On résout ici, AVANT les jetons magasin : ce qui n'est pas lié
// retombe donc sur {{magasin}}, {{date}}… s'il porte l'un de ces noms.
// Catalogue des champs proposés (source unique régie ↔ serveur).
export const HTML_VAR_SOURCES = [
  { id: 'literal', label: 'Valeur libre', fields: [] },
  { id: 'produit', label: 'Produit', fields: [
    { id: 'nom', label: 'Nom' }, { id: 'prix', label: 'Prix' },
    { id: 'image', label: 'Photo / illustration' }, { id: 'categorie', label: 'Catégorie' },
  ] },
  { id: 'promotion', label: 'Promotion', fields: [
    { id: 'nom', label: 'Nom du type' }, { id: 'icone', label: 'Icône' },
    { id: 'couleur', label: 'Couleur' }, { id: 'description', label: 'Description' },
  ] },
  { id: 'campagne', label: 'Campagne', fields: [
    { id: 'nom', label: 'Nom' }, { id: 'message', label: 'Accroche' },
    { id: 'theme', label: 'Thème / gamme' }, { id: 'image', label: 'Visuel' },
    { id: 'couleur', label: 'Couleur' }, { id: 'du', label: 'Date de début' }, { id: 'au', label: 'Date de fin' },
  ] },
  { id: 'magasin', label: 'Magasin / contexte', fields: [
    { id: 'nom', label: 'Nom du magasin' }, { id: 'adresse', label: 'Adresse' },
    { id: 'horaires', label: 'Horaires' }, { id: 'tel', label: 'Téléphone' },
    { id: 'date', label: 'Date du jour' }, { id: 'saison', label: 'Période active' },
    { id: 'moment', label: 'Moment' },
  ] },
];
// Extrait les noms de variables d'un code HTML : {{ titre }}, {{titreAccent}}…
export function htmlVarNames(code) {
  const out = [];
  const seen = new Set();
  String(code || '').replace(/\{\{([^{}]+)\}\}/g, (m0, raw) => {
    const name = String(raw).trim();
    const k = name.toLowerCase();
    if (name && !seen.has(k)) { seen.add(k); out.push(name); }
    return m0;
  });
  return out;
}
export function applyHtmlVars(modules, storeId, date = new Date()) {
  const list = (modules || []).filter((m) => m && m.type === 'html' && typeof m.html === 'string' && m.html.indexOf('{{') !== -1);
  if (!list.length) return;
  const db = getDb();
  const store = storeId ? db.prepare('SELECT name, address, hours, phone FROM sig_stores WHERE id = ?').get(storeId) : null;
  const oneProd = db.prepare('SELECT * FROM sig_products WHERE id = ?');
  const oneCat = db.prepare('SELECT name FROM sig_product_categories WHERE id = ?');
  const onePromo = db.prepare('SELECT * FROM sig_promo_types WHERE id = ?');
  const oneCamp = db.prepare('SELECT * FROM sig_campaigns WHERE id = ?');
  const seasonNames = currentSeasons(date).map((s) => s.name).filter(Boolean).join(', ');
  const momentLabel = { matin: 'matin', midi: 'midi', aprem: 'après-midi' }[currentMoment(date)] || '';
  let dateLabel = '';
  try { dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { dateLabel = ''; }
  // Prix du magasin s'il existe, sinon prix par défaut du produit.
  const priceOf = (p) => {
    if (!p) return '';
    if (storeId) {
      const r = db.prepare('SELECT price FROM sig_product_prices WHERE product_id = ? AND store_id = ?').get(p.id, storeId);
      if (r && r.price) return r.price;
    }
    return p.price || '';
  };
  const resolve = (bind) => {
    if (!bind || typeof bind !== 'object') return null;
    const val = String(bind.value || '');
    const field = String(bind.field || '');
    switch (bind.src) {
      case 'literal': return val;
      case 'produit': {
        const p = val ? oneProd.get(val) : null;
        if (!p) return '';
        if (field === 'prix') return priceOf(p);
        if (field === 'image') return p.img || '';
        if (field === 'categorie') { const c = oneCat.get(p.category_id); return c ? c.name : ''; }
        return p.name || '';
      }
      case 'promotion': {
        const t = val ? onePromo.get(val) : null;
        if (!t) return '';
        if (field === 'icone') return t.icon || '';
        if (field === 'couleur') return t.color || '';
        if (field === 'description') return t.descr || '';
        return t.name || '';
      }
      case 'campagne': {
        const c = val ? oneCamp.get(val) : null;
        if (!c) return '';
        if (field === 'message') return c.message || '';
        if (field === 'theme') return c.theme || '';
        if (field === 'image') return c.image || '';
        if (field === 'couleur') return c.color || '';
        if (field === 'du') return c.date_from || '';
        if (field === 'au') return c.date_to || '';
        return c.name || '';
      }
      case 'magasin': {
        if (field === 'adresse') return store ? (store.address || '') : '';
        if (field === 'horaires') return store ? (store.hours || '') : '';
        if (field === 'tel') return store ? (store.phone || '') : '';
        if (field === 'date') return dateLabel;
        if (field === 'saison') return seasonNames;
        if (field === 'moment') return momentLabel;
        return store ? (store.name || '') : '';
      }
      default: return null;
    }
  };
  for (const m of list) {
    const binds = (m.htmlVars && typeof m.htmlVars === 'object') ? m.htmlVars : {};
    // Index insensible à la casse (les noms viennent du code collé).
    const byKey = new Map();
    for (const k of Object.keys(binds)) byKey.set(String(k).trim().toLowerCase(), binds[k]);
    if (!byKey.size) continue;
    m.html = m.html.replace(/\{\{([^{}]+)\}\}/g, (m0, raw) => {
      const out = resolve(byKey.get(String(raw).trim().toLowerCase()));
      return out == null ? m0 : out;   // non liée : laissée aux jetons magasin
    });
  }
}
export function applyStoreTokens(modules, storeId, date = new Date()) {
  const db = getDb();
  const store = storeId ? db.prepare('SELECT name, address, hours, phone FROM sig_stores WHERE id = ?').get(storeId) : null;
  const seasonNames = currentSeasons(date).map((s) => s.name).filter(Boolean).join(', ');
  const momentLabel = { matin: 'matin', midi: 'midi', aprem: 'après-midi' }[currentMoment(date)] || '';
  let dateLabel = '';
  try { dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { dateLabel = ''; }
  const map = {
    magasin: store ? (store.name || '') : '', adresse: store ? (store.address || '') : '',
    horaires: store ? (store.hours || '') : '', tel: store ? (store.phone || '') : '',
    telephone: store ? (store.phone || '') : '', date: dateLabel, saison: seasonNames, moment: momentLabel,
  };
  // Alias pointés : {{magasin.nom}}, {{magasin.adresse}}…
  map['magasin.nom'] = map.magasin; map['magasin.adresse'] = map.adresse;
  map['magasin.horaires'] = map.horaires; map['magasin.tel'] = map.tel;
  const norm = (k) => String(k).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sub = (txt) => String(txt).replace(/\{\{([^{}]+)\}\}/g, (m0, raw) => {
    const k = norm(raw);
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m0;
  });
  for (const m of modules || []) {
    if (typeof m.name === 'string' && m.name.indexOf('{{') !== -1) m.name = sub(m.name);
    if (typeof m.sub === 'string' && m.sub.indexOf('{{') !== -1) m.sub = sub(m.sub);
    // Gabarit HTML : les mêmes variables sont résolues DANS le code collé.
    if (typeof m.html === 'string' && m.html.indexOf('{{') !== -1) m.html = sub(m.html);
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

// Moment courant (matin/midi/aprem) selon les 3 fenêtres horaires du planning ;
// hors fenêtres, on retombe par tiers de journée. UN SEUL vocabulaire partout
// (médias, périodes de vente, planning) : matin / midi / après-midi.
export function currentMoment(date = new Date()) {
  const wins = planWindows();
  const mins = date.getHours() * 60 + date.getMinutes();
  const toMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  const names = ['matin', 'midi', 'aprem'];
  for (let i = 0; i < wins.length && i < 3; i++) {
    const a = toMin(wins[i].from); const b = toMin(wins[i].to);
    const inW = a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
    if (inW) return names[i];
  }
  const h = date.getHours();
  return h < 11 ? 'matin' : (h < 16 ? 'midi' : 'aprem');
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

// --- Groupes d'écrans (zones à filtre de catégories) -----------------------
// Un groupe partage les champs de format d'un magasin (screens/screen_size/
// screen_orient) → storeFormat s'applique directement.
export function loadScreenGroups(storeId) {
  const rows = getDb().prepare('SELECT * FROM sig_screen_groups WHERE store_id = ? ORDER BY sort_order, name').all(storeId);
  return rows.map((g) => ({
    id: g.id, storeId: g.store_id, name: g.name,
    screens: g.screens, size: g.screen_size, orient: g.screen_orient,
    cats: (() => { try { return JSON.parse(g.cats || '[]'); } catch { return []; } })(),
    format: storeFormat(g),
  }));
}
export function screenGroupById(id) {
  return getDb().prepare('SELECT * FROM sig_screen_groups WHERE id = ?').get(id) || null;
}
export function saveScreenGroup(storeId, patch) {
  const db = getDb();
  const cur = patch.id ? db.prepare('SELECT * FROM sig_screen_groups WHERE id = ?').get(patch.id) : null;
  const id = (cur && cur.id) || String(patch.id || ('grp' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)));
  const name = (String(patch.name != null ? patch.name : (cur ? cur.name : 'Zone')).trim() || 'Zone').slice(0, 80);
  const screens = Math.min(6, Math.max(1, parseInt(patch.screens != null ? patch.screens : (cur ? cur.screens : 1), 10) || 1));
  const size = Math.min(120, Math.max(20, parseInt(patch.size != null ? patch.size : (cur ? cur.screen_size : 55), 10) || 55));
  const orient = (patch.orient === 'portrait' || patch.orient === 'paysage') ? patch.orient : (cur ? cur.screen_orient : 'portrait');
  const curCats = cur ? (() => { try { return JSON.parse(cur.cats || '[]'); } catch { return []; } })() : [];
  const cats = JSON.stringify(Array.isArray(patch.cats) ? patch.cats.map(String) : curCats);
  const sort = cur ? cur.sort_order : (db.prepare('SELECT COUNT(*) AS n FROM sig_screen_groups WHERE store_id = ?').get(storeId).n);
  db.prepare('INSERT OR REPLACE INTO sig_screen_groups(id, store_id, name, screens, screen_size, screen_orient, cats, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, storeId, name, screens, size, orient, cats, sort);
  return loadScreenGroups(storeId).find((x) => x.id === id) || null;
}
export function deleteScreenGroup(id) {
  const db = getDb();
  db.prepare("UPDATE sig_players SET group_id = '' WHERE group_id = ?").run(id); // détacher les écrans
  db.prepare('DELETE FROM sig_screen_groups WHERE id = ?').run(id);
}
export function setPlayerGroup(playerId, groupId) {
  const db = getDb();
  const gid = String(groupId || '');
  // on ne rattache qu'à un groupe du MÊME magasin que le player (cohérence)
  if (gid) {
    const p = db.prepare('SELECT store_id FROM sig_players WHERE id = ?').get(playerId);
    const g = db.prepare('SELECT store_id FROM sig_screen_groups WHERE id = ?').get(gid);
    if (!p || !g || p.store_id !== g.store_id) return false;
  }
  db.prepare('UPDATE sig_players SET group_id = ? WHERE id = ?').run(gid, playerId);
  return true;
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

  // Deux campagnes marketing d'exemple (démo) : une gamme thématique, un produit.
  const insCamp = db.prepare(`INSERT INTO sig_campaigns
    (id, name, scope, product_ref, theme, image, message, date_from, date_to, color, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  insCamp.run('cmp1', 'Rentrée gourmande', 'gamme', '', 'Viennoiseries', '', 'La rentrée en douceur', '01/09', '30/09', '#C97B4A', 0);
  insCamp.run('cmp2', 'Notre signature', 'produit', 'pr1', '', '', 'Le Brookie fait maison', '', '', '#8D1D2C', 1);

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
    // Campagnes marketing de démonstration.
    db.prepare(`DELETE FROM sig_campaigns WHERE id IN ('cmp1', 'cmp2')`).run();
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
  // Sous-types de promotion résolus une fois (badge : icône · couleur · libellé).
  const promoTypes = new Map(db.prepare('SELECT * FROM sig_promo_types').all().map((t) => [t.id, t]));
  // Campagnes marketing résolues une fois (contenu déposé comme item).
  const campaigns = new Map(db.prepare('SELECT * FROM sig_campaigns').all().map((c) => [c.id, campaignRow(c)]));
  return mods.map((m) => {
    // Campagne : contenu porté par la campagne référencée (produit lié éventuel).
    const campaign = m.type === 'campagne' ? (campaigns.get(m.campaign_ref) || null) : null;
    // Élément lié au catalogue : ses lignes viennent de la table produits
    // (toujours à jour) — sinon, les items propres à l'élément.
    let items;
    if (campaign) {
      // Une campagne « produit » tire la photo/le prix du produit lié.
      const p = campaign.productRef ? oneProd.get(campaign.productRef) : null;
      items = p ? [prodItem(p)] : [];
    } else if (m.cat_ref) items = catProds.all(m.cat_ref).map(prodItem);
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
      promoType: m.promo_type || '',
      // Badge résolu pour l'affichage (icône · couleur · libellé du sous-type).
      promo: (() => {
        if (m.type !== 'promotion') return undefined;
        const t = promoTypes.get(m.promo_type);
        return t
          ? { type: t.id, name: t.name, icon: t.icon, color: t.color }
          : { type: m.promo_type || '', name: 'Offre', icon: '🏷️', color: '#C0392B' };
      })(),
      campaignRef: m.campaign_ref || '',
      orient: m.orient === 'portrait' ? 'portrait' : 'paysage',
      html: m.html || '',
      htmlVars: (() => { try { return JSON.parse(m.html_vars || '{}') || {}; } catch { return {}; } })(),
      htmlW: m.html_w || 1920,
      htmlH: m.html_h || 1080,
      // Campagne résolue pour l'affichage (nom · portée · visuel · thème · dates).
      campaign: m.type === 'campagne'
        ? (campaign || { id: m.campaign_ref || '', name: 'Campagne', scope: 'produit', productRef: '', theme: '', image: '', message: '', dateFrom: '', dateTo: '', color: '#8D1D2C', active: true })
        : undefined,
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
    mode: p.mode === 'continu' ? 'continu' : 'playlist',
    continuous: (() => { try { return { ...continuousDefaults(), ...(JSON.parse(p.continuous || '{}') || {}) }; } catch { return continuousDefaults(); } })(),
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
       cat_ref, product_ref, video, surprise, watermark, dur, promo_type, campaign_ref,
       orient, html, html_vars, html_w, html_h, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
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
        Number.isFinite(parseFloat(m.dur)) ? Math.max(0, Math.min(120, parseFloat(m.dur))) : 0,
        String(m.promoType || ''), String(m.campaignRef || ''),
        m.orient === 'portrait' ? 'portrait' : 'paysage',
        String(m.html || ''),
        JSON.stringify(m.htmlVars && typeof m.htmlVars === 'object' ? m.htmlVars : {}),
        Math.max(64, Math.min(20000, parseInt(m.htmlW, 10) || 1920)),
        Math.max(64, Math.min(20000, parseInt(m.htmlH, 10) || 1080))
      );
      // Un élément lié au catalogue (ou une campagne) ne stocke pas d'items propres.
      if (!m.catRef && !m.productRef && m.type !== 'campagne') {
        (m.items || []).forEach((it, j) => insItem.run(
          m.id, j, String(it.name || ''), String(it.price || ''), String(it.img || ''),
          it.src === 'photo' ? 'photo' : 'illus', it.active ? 1 : 0
        ));
      }
    });
    const validIds = new Set(modules.map((m) => m.id));
    const insPls = db.prepare('INSERT INTO sig_playlists(id, name, sort_order, sched_days, sched_from, sched_to, stores, cat, tags, plan_days, mode, continuous) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
        JSON.stringify((Array.isArray(pl.planDays) && pl.planDays.length === 7 ? pl.planDays : [1, 1, 1, 1, 1, 1, 1]).map((d) => (d ? 1 : 0))),
        pl.mode === 'continu' ? 'continu' : 'playlist',
        JSON.stringify(normContinuous(pl.continuous))
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
