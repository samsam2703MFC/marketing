// La régie sait-elle répondre en https ? Elle le vérifie elle-même, sur la
// machine : une requête vers le port 443 local, qui lit au passage le
// certificat (adresse, date de fin). Rien à configurer : c'est la livraison
// qui pose le certificat Let's Encrypt et l'hôte https d'Apache ; ici, on
// constate. Résultat gardé 10 minutes.
import https from 'node:https';

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, value: null, pending: null };

function probe(basePath) {
  return new Promise((resolve) => {
    const req = https.get({
      host: '127.0.0.1', port: 443, path: `${basePath || ''}/api/v1/health`,
      // Le certificat porte l'adresse publique, pas 127.0.0.1 : on le lit
      // pour le décrire, sans le valider ici (le navigateur, lui, le valide).
      rejectUnauthorized: false, timeout: 3000,
    }, (res) => {
      const cert = res.socket.getPeerCertificate() || {};
      res.resume();
      const san = String(cert.subjectaltname || '');
      const host = (san.match(/IP Address:([0-9a-fA-F.:]+)/) || san.match(/DNS:([^,\s]+)/) || [])[1] || '';
      const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString() : '';
      resolve(res.statusCode === 200 && host ? {
        ok: true,
        base: `https://${host.includes(':') ? `[${host}]` : host}${basePath || ''}/`,
        validTo,
        daysLeft: validTo ? Math.floor((Date.parse(validTo) - Date.now()) / 86400000) : null,
        issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || '',
      } : null);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// État https (ou null), sans jamais bloquer une réponse : la première demande
// lance la vérification, les suivantes lisent le dernier résultat.
export function httpsStatus(basePath) {
  if (Date.now() - cache.at > TTL_MS && !cache.pending) {
    cache.pending = probe(basePath).then((v) => { cache = { at: Date.now(), value: v, pending: null }; return v; });
  }
  return cache.value;
}
export async function httpsStatusNow(basePath) {
  httpsStatus(basePath);
  return cache.pending ? cache.pending : cache.value;
}
