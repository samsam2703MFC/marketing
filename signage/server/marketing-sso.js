// Ouverture de la régie depuis le module Marketing, sans second mot de passe.
//
// La régie est le « Marketing en magasin » du module Marketing (/marketing).
// Affichée dans son cadre, elle ne redemande pas de mot de passe : le serveur
// demande au module, par sa route de session et avec les cookies du
// navigateur, qui est connecté, et ouvre la régie en administrateur pour un
// administrateur du réseau (BRAND_ADMIN).
//
// C'est le module qui fait foi. Tant qu'il tourne en identité de développement
// (MAR_DEV_AUTH, « dev_auth »), tout visiteur y est administrateur : cette
// ouverture est alors une commodité, pas un verrou (choix de Sam, 31/10/2026).
// Le jour où le module vérifie l'identité (JWT de l'ERP), la régie suit sans
// changement. Ouverte seule (/signage/), la régie garde son mot de passe :
// seule la page affichée dans le cadre du module demande cette ouverture.
//
// L'adresse du module vient de la configuration, jamais de la requête : un
// en-tête Host forgé ferait sinon interroger un faux module.
//   SIG_MARKETING_SSO=0        coupe l'ouverture (mot de passe partout) ;
//   SIG_MARKETING_SSO_URL=…    route de session du module (défaut : celle du
//                              même serveur, derrière Apache).
//
// Sans réglage, la régie essaie le même serveur par « localhost » (l'adresse que
// la recette du Marketing vérifie après chaque livraison), puis par 127.0.0.1 ;
// la première qui répond en JSON est retenue pour la suite (campagnes, films).

export const DEFAULT_URLS = [
  'http://localhost/marketing/api/v1/marketing/session',
  'http://127.0.0.1/marketing/api/v1/marketing/session',
];
let retenue = null;

export const marketingSsoUrl = () => process.env.SIG_MARKETING_SSO_URL || retenue || DEFAULT_URLS[0];
const candidates = () => (process.env.SIG_MARKETING_SSO_URL
  ? [process.env.SIG_MARKETING_SSO_URL]
  : [...new Set([retenue, ...DEFAULT_URLS].filter(Boolean))]);
export const marketingSsoEnabled = () => process.env.SIG_MARKETING_SSO !== '0';

// Cookies du navigateur transmis au module, sans la session de la régie (elle
// ne regarde que lui).
export function forwardedCookies(req) {
  return String(req.headers.cookie || '')
    .split(/;\s*/)
    .filter((c) => c && !/^sig_session=/.test(c))
    .join('; ');
}

// { ok, userId, devAuth } ou { ok: false, status, error }.
export async function marketingSession(req) {
  if (!marketingSsoEnabled()) {
    return { ok: false, status: 404, error: 'ouverture depuis le Marketing coupée (SIG_MARKETING_SSO=0)' };
  }
  const headers = { accept: 'application/json' };
  const cookie = forwardedCookies(req);
  if (cookie) headers.cookie = cookie;
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  // Une adresse qui ne répond pas, ou pas en JSON (page HTML d'un autre site), fait essayer la suivante.
  let res = null;
  let json = null;
  const essais = [];
  for (const url of candidates()) {
    let r;
    try {
      r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    } catch (e) {
      essais.push(url);
      continue;
    }
    const j = await r.json().catch(() => null);
    if (j === null && !process.env.SIG_MARKETING_SSO_URL) { essais.push(url); res = res || r; continue; }
    res = r;
    json = j;
    essais.length = 0;
    if (!process.env.SIG_MARKETING_SSO_URL) retenue = url;
    break;
  }
  if (!res) return { ok: false, status: 502, error: `module Marketing injoignable (${essais.join(', ')})` };
  // Le module répond { authenticated, role, … } ; accepte aussi l'enveloppe du standard.
  const s = json && json.data && typeof json.data === 'object' && 'authenticated' in json.data ? json.data : json;
  if (!res.ok || !s || typeof s !== 'object') {
    return { ok: false, status: 401, error: `le module Marketing ne reconnaît pas cette session (HTTP ${res.status})` };
  }
  if (s.authenticated !== true) return { ok: false, status: 401, error: 'aucune session dans le module Marketing' };
  if (s.role !== 'BRAND_ADMIN') {
    return { ok: false, status: 403, error: `rôle « ${s.role || '?'} » dans le module Marketing : la régie s'ouvre aux administrateurs du réseau` };
  }
  return { ok: true, userId: s.user_id ?? null, devAuth: s.dev_auth === true };
}
