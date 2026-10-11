// TFBuddy simulé pour les tests locaux — la forme de l'API réelle, lue dans
// son document OpenAPI (https://atelierby.tfbuddy.com/api/swagger/openapi.json) :
//   POST /api/v1/{admin|consultant|owner}/auth/login {phone, password} → JWT
//   GET  /api/v1/admin/promotions/bundles?page&limit → {items, pagination}
//        (403 « Bearer token lacks MENU.BUNDLE.MANAGE » sans le droit)
//   GET  /api/v1/admin/promotions/bundles/{id}      → l'état complet du bundle
//   GET  /api/v1/shops                              → les magasins
// Comptes : admin (0470000001 / admin-pass) a le droit ; consultant
// (0470000002 / consult-pass) se connecte mais reçoit 403 sur les bundles.
import http from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

export const MOCK_ACCOUNTS = {
  admin: { phone: '0470000001', password: 'admin-pass' },
  consultant: { phone: '0470000002', password: 'consult-pass' },
};

// Trois bundles : un pour tous les magasins (petit-déj, lun → ven avant 11 h),
// un pour un seul magasin (id TFBuddy 4 = « Magasin Gare »), un inactif.
export const MOCK_BUNDLES = [
  {
    id: 31, name: 'Le petit-déj', description: 'Café + croissant', promotion_type: 'BUNDLE_PROMOTION', status: 'ACTIVE',
    priority: 5, shop_scope_type: 'ALL_SHOPS', activation_mode: 'AUTOMATIC', calculation_shop_id: 4,
    bundle_promotion: { bundle_price: 3.5 },
    items: [{ id_product: 901, quantity: 1, sort_order: 0, product_name: 'Croissant' }, { id_product: 902, quantity: 1, sort_order: 1, product_name: 'Café' }],
    shop_ids: [],
    schedule: [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, time_from: '06:00:00', time_to: '11:00:00' })),
  },
  {
    id: 32, name: '4 + 2 croissants', description: null, promotion_type: 'BUNDLE_PROMOTION', status: 'ACTIVE',
    priority: 3, shop_scope_type: 'SELECTED_SHOPS', activation_mode: 'AUTOMATIC', calculation_shop_id: 4,
    bundle_promotion: { bundle_price: 6.9 },
    items: [{ id_product: 901, quantity: 6, sort_order: 0, product_name: 'Croissant' }],
    shop_ids: [4, 77],
    schedule: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, time_from: '00:00', time_to: '23:59' })),
  },
  {
    id: 33, name: 'Goûter (brouillon)', promotion_type: 'BUNDLE_PROMOTION', status: 'INACTIVE', priority: 1,
    shop_scope_type: 'ALL_SHOPS', bundle_promotion: { bundle_price: 4 },
    items: [{ id_product: 903, quantity: 2, sort_order: 0, product_name: 'Cookie' }], shop_ids: [], schedule: [],
  },
];
export const MOCK_SHOPS = [{ id: 4, name: 'Magasin Gare', slug: '' }, { id: 77, name: 'Boutique inconnue', slug: 'inconnue' }];

export function startTfbMock() {
  const calls = [];
  const tokens = new Map();   // jeton → rôle
  let revoked = false;        // revoke() : le compte admin perd MENU.BUNDLE.MANAGE
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const login = /^\/api\/v1\/(admin|consultant|owner)\/auth\/login$/.exec(url.pathname);
      if (req.method === 'POST' && login) {
        const role = login[1];
        let j = {}; try { j = JSON.parse(body || '{}'); } catch { /* corps vide */ }
        const acc = MOCK_ACCOUNTS[role];
        if (!acc || j.phone !== acc.phone || j.password !== acc.password) return send(401, { status: 'error', description: 'INVALID_CREDENTIALS' });
        const t = jwt(role); tokens.set(t, role);
        return send(200, { status: 'success', data: { access_token: t } });
      }
      const role = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!role) return send(401, { status: 'error', description: 'Missing or invalid Bearer token' });
      if (url.pathname === '/api/v1/shops') return send(200, { data: MOCK_SHOPS });
      if (url.pathname.startsWith('/api/v1/admin/promotions/bundles')) {
        if (role !== 'admin' || revoked) return send(403, { status: 'error', description: 'Bearer token lacks MENU.BUNDLE.MANAGE' });
        const one = /\/bundles\/(\d+)$/.exec(url.pathname);
        if (one) {
          const b = MOCK_BUNDLES.find((x) => String(x.id) === one[1]);
          return b ? send(200, { status: 'success', data: b }) : send(404, { status: 'error', description: 'NOT_FOUND' });
        }
        // Pagination réelle (2 par page) ; la liste ne porte pas la composition.
        const page = Math.max(1, +url.searchParams.get('page') || 1);
        const limit = Math.min(2, Math.max(1, +url.searchParams.get('limit') || 25));
        const slice = MOCK_BUNDLES.slice((page - 1) * limit, page * limit)
          .map(({ items, schedule, shop_ids, ...rest }) => rest);
        return send(200, { items: slice, pagination: { page, limit, total: MOCK_BUNDLES.length, pages: Math.ceil(MOCK_BUNDLES.length / limit) } });
      }
      return send(404, { status: 'error', description: 'NOT_FOUND' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({
      url: `http://127.0.0.1:${server.address().port}/api/v1`, calls,
      revoke: (on = true) => { revoked = on; },
      close: () => server.close(),
    });
  }));
}
