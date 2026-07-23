// Base de données du module signage — node:sqlite (zéro dépendance).
// Toutes les tables sont préfixées `sig_`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return db;
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS sig_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sig_modules (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK (type IN ('category','liaison')),
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
    sched_from   TEXT NOT NULL DEFAULT '08:00',
    sched_to     TEXT NOT NULL DEFAULT '20:00',
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
  `);
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
// Seed — contenu par défaut identique à la maquette (Tartes + liaison), flotte démo.
function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM sig_modules').get().n;
  if (count > 0) return;

  const now = new Date().toISOString();
  const insMod = db.prepare(`INSERT INTO sig_modules
    (id, type, name, sub, layout, motion, tag_enabled, tag_label, tag_img, sched_days, sched_from, sched_to, pos, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insItem = db.prepare(`INSERT INTO sig_module_items
    (module_id, position, name, price, img, src, active) VALUES (?, ?, ?, ?, ?, ?, 1)`);

  insMod.run('c1', 'category', 'Tartes', '', 'illo-right', 'm1', 0, 'Nouveauté', 'assets/cherry.png',
    '[1,1,1,1,1,1,1]', '08:00', '20:00', '{}', 0);
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
    'assets/cherry.png', '[1,1,1,1,1,1,1]', '08:00', '20:00', '{}', 1);

  db.prepare('INSERT INTO sig_playlist(position, module_id) VALUES (0, ?), (1, ?)').run('c1', 'l1');

  const insStore = db.prepare('INSERT INTO sig_stores(id, name, grp, conn) VALUES (?, ?, ?, ?)');
  insStore.run('st1', 'Magasin Centre-Ville', 'Groupe Ville', 'fibre');
  insStore.run('st2', 'Magasin Gare', 'Groupe Ville', '4G');
  insStore.run('st3', 'Magasin Nord', 'Groupe Périphérie', 'fibre');

  const insPlayer = db.prepare(`INSERT INTO sig_players
    (id, store_id, name, hw, kiosk, orient, token, state, played_ver, assigned_ver, data_ver, cache_pct, media, disk, temp, last_seen, data_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`);
  insPlayer.run('p1', 'st1', 'Vitrine — 3× portrait', 'Android · MediaBox 4K', 1, 'Portrait', 'plyr_9F3A2C7E', 7, 7, 23, 100, 'Tartes · Brookie', '62 Go libres', '41°C', now);
  insPlayer.run('p2', 'st1', 'Comptoir — 55″', 'Android · TV-Box Pro', 1, 'Paysage', 'plyr_A51C88D0', 7, 7, 23, 100, 'Liaison · Fait maison', '12 Go libres', '44°C', now);
  insPlayer.run('p3', 'st2', 'Vitrine — 3× portrait', 'Android · MediaBox 4K', 1, 'Portrait', 'plyr_63F00B41', 6, 7, 23, 72, 'Tartes · Cerise', '5 Go libres', '52°C', now);
  insPlayer.run('p4', 'st3', 'Vitrine — 55″', 'Android · TV-Box Pro', 1, 'Paysage', 'plyr_7E2D91AC', 6, 6, 21, 100, 'Tartes · Rhubarbe (cache local)', '20 Go libres', '—', now);
  insPlayer.run('p5', 'st3', 'Comptoir — 43″', 'Android · MediaBox 4K', 0, 'Paysage', 'plyr_C4019BB7', 6, 7, 22, 38, '—', '0,4 Go libres', '58°C', now);

  const defaults = {
    version: '7',
    data_ver: '23',
    sec_per_line: '4',
    loop: '1',
    override: '0',
    srv_url: '',
    srv_ip: '127.0.0.1',
    srv_token: 'plyr_9F3A2C7E',
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);
}

// ---------------------------------------------------------------------------
// Lectures composées
export function loadModules() {
  const db = getDb();
  const mods = db.prepare('SELECT * FROM sig_modules ORDER BY sort_order, created_at').all();
  const itemsStmt = db.prepare('SELECT * FROM sig_module_items WHERE module_id = ? ORDER BY position');
  return mods.map((m) => ({
    id: m.id,
    type: m.type,
    name: m.name,
    sub: m.sub,
    layout: m.layout,
    motion: m.motion,
    motionTitle: m.motion_title || undefined,
    motionList: m.motion_list || undefined,
    motionIllo: m.motion_illo || undefined,
    tag: { enabled: !!m.tag_enabled, label: m.tag_label, img: m.tag_img },
    schedule: { days: JSON.parse(m.sched_days).map(Boolean), from: m.sched_from, to: m.sched_to },
    pos: { titleY: 0, listX: 0, listY: 0, illoX: 0, illoY: 0, illoScale: 1, ...JSON.parse(m.pos || '{}') },
    items: itemsStmt.all(m.id).map((it) => ({
      name: it.name, price: it.price, img: it.img, src: it.src, active: !!it.active,
    })),
  }));
}

export function loadPlaylist() {
  return getDb().prepare('SELECT module_id FROM sig_playlist ORDER BY position').all().map((r) => r.module_id);
}

export function saveDraft({ modules, playlist, secPerLine, loop }) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM sig_module_items');
    db.exec('DELETE FROM sig_playlist');
    db.exec('DELETE FROM sig_modules');
    const insMod = db.prepare(`INSERT INTO sig_modules
      (id, type, name, sub, layout, motion, motion_title, motion_list, motion_illo,
       tag_enabled, tag_label, tag_img, sched_days, sched_from, sched_to, pos, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
    const insItem = db.prepare(`INSERT INTO sig_module_items
      (module_id, position, name, price, img, src, active) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    modules.forEach((m, i) => {
      const tag = m.tag || {};
      const sched = m.schedule || {};
      insMod.run(
        m.id, m.type === 'liaison' ? 'liaison' : 'category', String(m.name || ''), String(m.sub || ''),
        String(m.layout || 'illo-right'), String(m.motion || 'm1'),
        m.motionTitle || null, m.motionList || null, m.motionIllo || null,
        tag.enabled ? 1 : 0, String(tag.label || ''), String(tag.img || ''),
        JSON.stringify((sched.days || [1, 1, 1, 1, 1, 1, 1]).map((d) => (d ? 1 : 0))),
        String(sched.from || '08:00'), String(sched.to || '20:00'),
        JSON.stringify(m.pos || {}), i
      );
      (m.items || []).forEach((it, j) => insItem.run(
        m.id, j, String(it.name || ''), String(it.price || ''), String(it.img || ''),
        it.src === 'photo' ? 'photo' : 'illus', it.active ? 1 : 0
      ));
    });
    const validIds = new Set(modules.map((m) => m.id));
    const insPl = db.prepare('INSERT INTO sig_playlist(position, module_id) VALUES (?, ?)');
    (playlist || []).filter((id) => validIds.has(id)).forEach((id, i) => insPl.run(i, id));
    if (secPerLine != null) setSetting('sec_per_line', String(secPerLine));
    if (loop != null) setSetting('loop', loop ? '1' : '0');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
