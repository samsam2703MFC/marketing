// Préfixe des tables de la régie, à la main (service ARRÊTÉ) :
//   node deploy/prefixe.mjs <base.db> etat     — tables sig_* et mar_sig_*, avec leurs lignes (lecture seule)
//   node deploy/prefixe.mjs <base.db> aller    — sig_ → mar_sig_ (ce que fait le démarrage du service)
//   node deploy/prefixe.mjs <base.db> retour   — mar_sig_ → sig_ (pour relancer l'ancien code du dépôt signage)
// Renommage seul, tout ou rien, lignes comptées avant et après ; une table sous les deux noms = refus, rien ne change.
// Le retour ne touche pas au réglage prefixe_mar_sig (il reste, renommé avec sa table, comme trace).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { renommerPrefixe, ANCIEN_PREFIXE, NOUVEAU_PREFIXE } from '../server/prefixe.js';

const [file, mode = 'etat'] = process.argv.slice(2);
if (!file || !existsSync(file) || !['etat', 'aller', 'retour'].includes(mode)) {
  console.error('usage : node deploy/prefixe.mjs <base.db> etat|aller|retour');
  process.exit(2);
}
const db = new DatabaseSync(file, { readOnly: mode === 'etat' });
const etat = () => {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const out = { sig_: 0, mar_sig_: 0, lignes: 0 };
  for (const { name } of rows) {
    const p = name.startsWith(NOUVEAU_PREFIXE) ? 'mar_sig_' : name.startsWith(ANCIEN_PREFIXE) ? 'sig_' : null;
    if (!p) continue;
    const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n);
    out[p] += 1; out.lignes += n;
    console.log(`table ${name} ${n}`);
  }
  console.log(`total sig_ ${out.sig_} · mar_sig_ ${out.mar_sig_} · lignes ${out.lignes}`);
  return out;
};
try {
  if (mode !== 'etat') {
    db.exec('PRAGMA foreign_keys = ON;');
    const r = mode === 'aller' ? renommerPrefixe(db) : renommerPrefixe(db, NOUVEAU_PREFIXE, ANCIEN_PREFIXE);
    console.log(r.deja ? 'rien à renommer' : `${r.tables.length} table(s) renommée(s), lignes identiques`);
  }
  etat();
} catch (e) {
  console.error(`REFUS : ${e.message}`);
  process.exit(1);
} finally {
  db.close();
}
