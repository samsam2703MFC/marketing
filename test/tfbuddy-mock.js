// TFBuddy simulé pour les tests locaux — la forme de l'API réelle, lue dans
// son document OpenAPI (https://atelierby.tfbuddy.com/api/swagger/openapi.json) :
//   POST /api/v1/{admin|consultant|owner}/auth/login {phone, password} → JWT
//   GET  /api/v1/admin/promotions/bundles?page&limit → {items, pagination}
//        (403 « Bearer token lacks MENU.BUNDLE.MANAGE » sans le droit)
//   GET  /api/v1/admin/promotions/bundles/{id}      → l'état complet du bundle
//   GET  /api/v1/admin/promotions/{buy-x-get-y | quantity | scheduled-product-discount}[/{id}]
//   GET  /api/v1/admin/voucher-campaigns            → campagnes de bons (liste complète)
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
// Les autres familles : la liste ne porte que l'en-tête, le détail le reste.
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, time_from: '00:00:00', time_to: '23:59:00' }));
export const MOCK_PROMOS = {
  'buy-x-get-y': [
    { id: 41, name: 'Croissants 2 + 1', description: 'Le troisième est offert', promotion_type: 'BUY_X_GET_Y', status: 'ACTIVE', priority: 4,
      shop_scope_type: 'ALL_SHOPS', activation_mode: 'AUTOMATIC', valid_from: '2026-01-01 00:00:00', valid_to: '2030-12-31 23:59:59',
      trigger: { quantity: 2, product_ids: [901] }, reward: { quantity: 1, product_ids: [{ id_product: 901 }], type: 'FREE', value: null, selection_strategy: 'CHEAPEST' },
      shop_ids: [], schedule: ALL_WEEK },
    { id: 42, name: 'Brouillon 1 + 1', promotion_type: 'BUY_X_GET_Y', status: 'DRAFT', shop_scope_type: 'ALL_SHOPS',
      trigger: { quantity: 1, category_ids: [5] }, reward: { quantity: 1, category_ids: [5], type: 'PERCENTAGE_DISCOUNT', value: 50 }, shop_ids: [], schedule: [] },
  ],
  quantity: [
    { id: 51, name: '3 cookies pour 2', status: 'ACTIVE', shop_scope_type: 'SELECTED_SHOPS', shop_ids: [4],
      quantity_promotion: { mechanism_type: 'BUY_X_GET_Y', bundle_quantity: 3, free_quantity: 1 }, eligible_product_ids: [903], schedule: ALL_WEEK },
  ],
  'scheduled-product-discount': [
    { id: 61, name: 'Happy hour café', status: 'ACTIVE', shop_scope_type: 'ALL_SHOPS', shop_ids: [],
      discount_type: 'PERCENTAGE_DISCOUNT', discount_value: 20, reward_product_ids: [902],
      schedule: [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, time_from: '14:00', time_to: '16:00' })) },
    { id: 62, name: 'Tartes à prix doux', status: 'INACTIVE', shop_scope_type: 'ALL_SHOPS', shop_ids: [],
      discount_type: 'FIXED_PRICE', discount_value: 2.5, reward_category_ids: [5], schedule: [] },
  ],
};
export const MOCK_VOUCHERS = [
  { id: 71, name: 'Rentrée', description: 'Code à donner en caisse', status: 'ACTIVE', code_type: 'SHARED', shared_code: 'RENTREE10',
    valid_from: '2026-09-01 00:00:00', valid_to: '2030-10-31 23:59:59', id_promotion: 41, promotion: { id: 41, name: 'Croissants 2 + 1' } },
  { id: 72, name: 'Fidélité', status: 'ACTIVE', code_type: 'UNIQUE', requires_customer: true },
];
// Champs que la liste ne porte pas (le détail, si).
const DETAIL_ONLY = ['trigger', 'reward', 'quantity_promotion', 'eligible_product_ids', 'discount_type', 'discount_value', 'reward_product_ids', 'reward_category_ids', 'schedule', 'shop_ids'];

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
      // Autres familles de promotions, et campagnes de bons : même droit que les bundles.
      const fam = /^\/api\/v1\/admin\/promotions\/(buy-x-get-y|quantity|scheduled-product-discount)(?:\/(\d+))?$/.exec(url.pathname);
      const vouchers = url.pathname === '/api/v1/admin/voucher-campaigns';
      if (fam || vouchers) {
        if (role !== 'admin' || revoked) return send(403, { status: 'error', description: 'Bearer token lacks MENU.BUNDLE.MANAGE' });
        const all = vouchers ? MOCK_VOUCHERS : MOCK_PROMOS[fam[1]];
        if (fam && fam[2]) {
          const p = all.find((x) => String(x.id) === fam[2]);
          return p ? send(200, { status: 'success', data: p }) : send(404, { status: 'error', description: 'NOT_FOUND' });
        }
        const page = Math.max(1, +url.searchParams.get('page') || 1);
        const limit = Math.min(100, Math.max(1, +url.searchParams.get('limit') || 25));
        const slice = all.slice((page - 1) * limit, page * limit)
          .map((x) => (vouchers ? x : Object.fromEntries(Object.entries(x).filter(([k]) => !DETAIL_ONLY.includes(k)))));
        return send(200, { items: slice, pagination: { page, limit, total: all.length, pages: Math.max(1, Math.ceil(all.length / limit)) } });
      }
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
