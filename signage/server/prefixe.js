// Préfixe des tables de la régie : `sig_` → `mar_sig_` (le signage est entré dans le Marketing le 20/11/2026 ;
// registre docs/PORTAILS.md). Renommage SEUL (ALTER TABLE … RENAME TO), jamais de suppression : les lignes ne
// bougent pas, les index gardent leur nom, SQLite reporte le nouveau nom dans les clés étrangères des autres tables.
//
// Aller : au démarrage (getDb), avant toute création de table — sinon le code créerait des tables vides sous les
// nouveaux noms à côté des anciennes. Retour : deploy/prefixe-retour.mjs, service arrêté.
//
// Refus (exception, rien n'est renommé) : une table existe sous les DEUX noms. Une seule transaction : tout ou rien.

export const ANCIEN_PREFIXE = 'sig_';
export const NOUVEAU_PREFIXE = 'mar_sig_';

const qid = (x) => '"' + String(x).replace(/"/g, '""') + '"';
const motif = (p) => p.replace(/[\\_%]/g, (c) => '\\' + c) + '%';

/** Tables dont le nom commence par `de` (et pas par `vers`, qui peut le contenir). */
function tablesDe(db, de, vers) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\' ORDER BY name")
    .all(motif(de)).map((r) => r.name).filter((n) => !n.startsWith(vers));
}

/**
 * Renomme toutes les tables `de*` en `vers*`. Rend le bilan { tables: [{de, vers, lignes}], deja } ;
 * lève une exception (et ne change rien) si une table existe sous les deux noms ou si un compte de lignes diffère.
 */
export function renommerPrefixe(db, de = ANCIEN_PREFIXE, vers = NOUVEAU_PREFIXE) {
  const anciennes = tablesDe(db, de, vers);
  if (!anciennes.length) return { tables: [], deja: true };
  const existe = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const conflits = anciennes.filter((t) => existe.has(vers + t.slice(de.length)));
  if (conflits.length) {
    throw new Error(`préfixe ${de} → ${vers} refusé : table(s) présente(s) sous les deux noms (${conflits.join(', ')}) — rien n'a été renommé`);
  }
  const bilan = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of anciennes) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${qid(t)}`).get().n;
      const cible = vers + t.slice(de.length);
      db.exec(`ALTER TABLE ${qid(t)} RENAME TO ${qid(cible)}`);
      const apres = db.prepare(`SELECT COUNT(*) AS n FROM ${qid(cible)}`).get().n;
      if (apres !== n) throw new Error(`${t} → ${cible} : ${n} ligne(s) avant, ${apres} après`);
      bilan.push({ de: t, vers: cible, lignes: Number(n) });
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ }
    throw e;
  }
  return { tables: bilan, deja: false };
}
