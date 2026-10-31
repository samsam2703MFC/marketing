// Miroir MySQL — copie les tables sig_* du SQLite de la régie vers la base
// MySQL de la PWA (ex. atelierby_db), pour les consulter dans phpMyAdmin.
//
// Le SQLite reste la source de vérité (rapide, zéro dépendance) ; le miroir est
// « best-effort » : reconstruit à chaque enregistrement, non bloquant, et si
// MySQL est indisponible la régie continue de fonctionner normalement.
import { spawn } from 'node:child_process';
import { getDb, getSetting, setSetting } from './db.js';
import { pwaConfig, pwaBaseName } from './pwadb.js';

// Non répliquées : volumineuses / sans intérêt / sensibles (sig_users contient
// les empreintes de mots de passe — jamais dans la base PWA). Exporté pour la
// livraison, qui n'ouvre au compte MariaDB « signage » que les tables recopiées.
export const MIRROR_SKIP = new Set(['sig_sessions', 'sig_heartbeats', 'sig_snapshots', 'sig_users']);
const qid = (x) => '`' + String(x).replace(/`/g, '') + '`';

function myType(sqliteType) {
  const t = String(sqliteType || '').toUpperCase();
  if (/INT/.test(t)) return 'BIGINT';
  if (/REAL|FLOA|DOUB/.test(t)) return 'DOUBLE';
  return 'LONGTEXT';
}

// Échappement d'une valeur pour MySQL (les images data: sont remplacées par un
// marqueur — inutiles en consultation et très lourdes).
function esc(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  let s = String(v);
  if (s.startsWith('data:')) s = '(photo importée)';
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n')}'`;
}

// Réglages sensibles : jamais en clair dans la base PWA. Les mots de passe
// saisis en régie (base PWA, ancien « stockage HD »), un jeton de serveur…
// sont masqués dans le miroir ; le SQLite de la régie, lui, ne change pas.
const SECRET_SETTING = /(pass|password|secret|token|key)$/i;
export function mirrorRow(table, row) {
  if (table !== 'sig_settings' || !row || typeof row.key !== 'string') return row;
  if (SECRET_SETTING.test(row.key) && row.value) return { ...row, value: '(masqué)' };
  if (row.key === 'pwa_import' && row.value) {
    try {
      const j = JSON.parse(row.value);
      if (j && typeof j === 'object' && j.password) return { ...row, value: JSON.stringify({ ...j, password: '(masqué)' }) };
    } catch { /* pas du JSON : tel quel */ }
  }
  return row;
}

// Où répliquer : réglage mirror_db (posé à l'import PWA), sinon détection.
export async function mirrorTargetDb() {
  const saved = getSetting('mirror_db', '');
  if (saved) return saved;
  const detected = await pwaBaseName();
  if (detected) { setSetting('mirror_db', detected); return detected; }
  return '';
}

function runMysql(cfg, script) {
  const attempt = (bin) => new Promise((resolve, reject) => {
    const args = [];
    if (cfg.user) args.push('-h', cfg.host || '127.0.0.1', '-P', String(cfg.port || 3306), '-u', cfg.user);
    // pas de base par défaut : le script fait USE lui-même.
    const ch = spawn(bin, args, { env: { ...process.env, MYSQL_PWD: cfg.password || '' } });
    let err = '';
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('error', reject);
    ch.on('close', (code) => {
      if (code === 0) return resolve();
      const line = err.trim().split('\n').map((l) => l.trim()).find((l) => /error/i.test(l)) || err.trim() || `mysql code ${code}`;
      reject(new Error(line));
    });
    ch.stdin.on('error', () => {}); // EPIPE si le binaire manque
    ch.stdin.write(script);
    ch.stdin.end();
  });
  return attempt('mysql').catch((e) => {
    if (e.code === 'ENOENT') return attempt('mariadb');
    throw e;
  });
}

let _busy = false;
let _again = false;

// Reconstruit toutes les tables sig_* dans MySQL depuis le SQLite.
export async function syncMirror() {
  if (_busy) { _again = true; return { ok: true, queued: true }; }
  _busy = true;
  try {
    const db = getSetting('mirror_off', '') === '1' ? null : getDb();
    if (!db) return { ok: false, error: 'miroir désactivé' };
    const target = await mirrorTargetDb();
    if (!target) return { ok: false, error: 'aucune base MySQL cible (lance d’abord ⚙ Rafraîchir)' };
    const cfg = { ...pwaConfig(), db: '' };

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sig\\_%' ESCAPE '\\'")
      .all().map((r) => r.name).filter((n) => !MIRROR_SKIP.has(n));

    // La base cible existe toujours (c'est la base PWA, détectée ou réglée) :
    // pas de CREATE DATABASE, que le compte MariaDB du service n'a pas le
    // droit de faire — il ne peut créer, remplir et supprimer que ses sig_*.
    let script = `USE ${qid(target)};\nSET FOREIGN_KEY_CHECKS=0;\n`;
    let totalRows = 0;
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${qid(t)})`).all();
      if (!cols.length) continue;
      const defs = cols.map((c) => `${qid(c.name)} ${myType(c.type)}`).join(', ');
      script += `DROP TABLE IF EXISTS ${qid(t)};\nCREATE TABLE ${qid(t)} (${defs}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n`;
      const rows = db.prepare(`SELECT * FROM ${qid(t)}`).all().map((r) => mirrorRow(t, r));
      const colList = cols.map((c) => qid(c.name)).join(', ');
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200)
          .map((r) => `(${cols.map((c) => esc(r[c.name])).join(', ')})`).join(', ');
        script += `INSERT INTO ${qid(t)} (${colList}) VALUES ${batch};\n`;
      }
      totalRows += rows.length;
    }
    script += 'SET FOREIGN_KEY_CHECKS=1;\n';

    await runMysql(cfg, script);
    setSetting('mirror_at', new Date().toISOString());
    return { ok: true, db: target, tables: tables.length, rows: totalRows };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    _busy = false;
    if (_again) { _again = false; scheduleMirror(); }
  }
}

// Réplication différée (regroupe les enregistrements rapprochés).
let _timer = null;
export function scheduleMirror() {
  if (getSetting('mirror_off', '') === '1') return;
  clearTimeout(_timer);
  _timer = setTimeout(() => { syncMirror().catch(() => {}); }, 800);
}

export function mirrorStatus() {
  return {
    db: getSetting('mirror_db', ''),
    at: getSetting('mirror_at', ''),
    off: getSetting('mirror_off', '') === '1',
  };
}
