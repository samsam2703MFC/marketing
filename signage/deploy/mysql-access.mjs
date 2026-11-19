// Livraison — ce que la régie demande à MariaDB, lu dans SA base SQLite, en
// lecture seule et sans passer par getDb() : aucune migration, aucun compte
// touché. .github/workflows/deploy.yml s'en sert pour ouvrir au compte système
// « signage » un accès MariaDB à sa mesure.
//   node deploy/mysql-access.mjs /var/www/signage/data/signage.db
// Une information par ligne :
//   mode socket|compte   « compte » : un utilisateur MySQL est réglé en régie
//   base <nom>           base PWA réglée en régie (absente : détection)
//   miroir <nom>         base cible du miroir, si déjà connue
//   table <sig_…>        tables que le miroir y recopie
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { MIRROR_SKIP } from '../server/mirror.js';

const file = process.argv[2];
const lines = [];
if (file && existsSync(file)) {
  const db = new DatabaseSync(file, { readOnly: true });
  const get = (k) => (db.prepare('SELECT value FROM mar_sig_settings WHERE key = ?').get(k) || {}).value || '';
  let cfg = {};
  try { cfg = JSON.parse(get('pwa_import') || '{}') || {}; } catch { /* réglage illisible : défauts */ }
  lines.push(`mode ${cfg.user ? 'compte' : 'socket'}`);
  if (cfg.db) lines.push(`base ${cfg.db}`);
  const mirror = get('mirror_db');
  if (mirror) lines.push(`miroir ${mirror}`);
  if (get('mirror_off') !== '1') {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mar\\_sig\\_%' ESCAPE '\\' ORDER BY name").all();
    for (const { name } of tables) if (!MIRROR_SKIP.has(name)) lines.push(`table ${name}`);
  }
  db.close();
} else {
  lines.push('mode socket');
}
console.log(lines.join('\n'));
