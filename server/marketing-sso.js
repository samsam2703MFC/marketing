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

const DEFAULT_URL = 'http://127.0.0.1/marketing/api/v1/marketing/session';

export const marketingSsoUrl = () => process.env.SIG_MARKETING_SSO_URL || DEFAULT_URL;
export const marketingSsoEnabled = () => process.env.SIG_MARKETING_SSO !== '0';

// Cookies du navigateur transmis au module, sans la session de la régie (elle
// ne regarde que lui).
function forwardedCookies(req) {
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
  const url = marketingSsoUrl();
  const headers = { accept: 'application/json' };
  const cookie = forwardedCookies(req);
  if (cookie) headers.cookie = cookie;
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  } catch (e) {
    return { ok: false, status: 502, error: `module Marketing injoignable (${url})` };
  }
  const json = await res.json().catch(() => null);
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
