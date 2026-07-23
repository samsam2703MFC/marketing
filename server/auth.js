// Helpers d'authentification (purs, sans accès BDD) — scrypt + jetons de session.
import crypto from 'node:crypto';

export function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(String(password), String(salt), 64);
    const stored = Buffer.from(String(hash), 'hex');
    return h.length === stored.length && crypto.timingSafeEqual(h, stored);
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Anti-force-brute basique : verrouillage par IP après échecs répétés.
const attempts = new Map(); // ip → { fails, until }
export function loginAllowed(ip) {
  const a = attempts.get(ip);
  return !a || !a.until || a.until <= Date.now();
}
export function loginFailed(ip) {
  const a = attempts.get(ip) || { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= 8) { a.until = Date.now() + 60_000; a.fails = 0; }
  attempts.set(ip, a);
}
export function loginSucceeded(ip) {
  attempts.delete(ip);
}
