// Module Marketing simulé pour les tests locaux — la forme de ses réponses,
// lue dans le dépôt marketing (api/routes.php et ses contrôleurs) :
//   GET  /marketing/api/v1/marketing/session                → { authenticated, role, … }
//   GET  /marketing/api/v1/marketing/campaigns              → [ { id, name, status_code, starts_on, ends_on, image_url, … } ]
//   GET  /marketing/api/v1/marketing/campaigns/{id}         → la campagne : shops [{shop_id, shop_name, city}],
//                                                             offer { title, lever_label, voucher_code, items [{label, offer_item_id, …}] }
//   GET  /marketing/api/v1/marketing/offer-items            → [ { id, sku_ref: "erp-<id>", name } ]
//   GET  /marketing/api/v1/marketing/promotions | bundles | vouchers
//   GET  /marketing/api/v1/marketing/campaigns/{id}/production-sections        → { success, data: { sections: [{code, status}] } }
//   PUT  /marketing/api/v1/marketing/campaigns/{id}/production-sections/{code} → { success, data }
// Données de test : elles reprennent le TFBuddy simulé (test/tfbuddy-mock.js) —
// Croissant 901, Café 902 — et un produit que la régie ne connaît pas (999).
import { createServer } from 'node:http';

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (n) => iso(new Date(Date.now() + n * 86400000));

export function marketingFixtures() {
  const current = {
    id: 12, name: 'Matins viennoiseries', scope: 'network', status_code: 'live', status_label: 'En cours',
    starts_on: shift(-3), ends_on: shift(20), image_url: '', type_label: 'Saisonnière', shops_count: 3,
  };
  const upcoming = { id: 13, name: 'Saint-Nicolas — speculoos', scope: 'network', status_code: 'planned', status_label: 'Planifiée', starts_on: shift(18), ends_on: shift(30), image_url: '', type_label: 'Fête', shops_count: 0 };
  const past = { id: 9, name: 'Rentrée', status_code: 'done', starts_on: shift(-60), ends_on: shift(-30) };
  const detail = {
    ...current, brand_id: 1,
    shops: [
      { shop_id: 1, shop_name: 'Magasin Gare', city: 'Halle' },
      { shop_id: 2, shop_name: 'Magasin Centre-Ville', city: 'Halle' },
      { shop_id: 3, shop_name: 'Boulangerie Fantôme', city: 'Ailleurs' },
    ],
    levers: [{ label: 'Trafic' }],
    offer: {
      id: 5, title: '2e croissant -50 %', mechanic_text: 'Le deuxième à moitié prix', discount_label: '-50 %', price_label: null,
      image_url: null, voucher_code: null, lever_label: 'Trafic', starts_on: null, ends_on: null, weekdays_mask: 127,
      items: [
        { label: 'Croissant', offer_item_id: 101, mechanic_type: 'PERCENT', discount_pct: 50 },
        { label: 'Café', offer_item_id: 102, mechanic_type: null },
        { label: 'Produit fantôme', offer_item_id: 103, mechanic_type: null },
      ],
    },
    channels: [{ label: 'Écrans des magasins', family: 'PHYSIQUE', is_enabled: true }],
  };
  return {
    list: [current, upcoming, past],
    details: { 12: detail, 13: { ...upcoming, shops: [], levers: [], offer: null, channels: [] } },
    offerItems: [{ id: 101, sku_ref: 'erp-901', name: 'Croissant' }, { id: 102, sku_ref: 'erp-902', name: 'Café' }, { id: 103, sku_ref: 'erp-999', name: 'Produit fantôme' }],
    promotions: [{ id: 1, name: 'Croissants 2 + 1', mechanic_type: 'BUY_X_GET_Y', value_label: '2+1', campaign_id: 12 }, { id: 2, name: 'Promo absente de la caisse', mechanic_type: 'PERCENT', campaign_id: 12 }],
    bundles: [],
    vouchers: [],
    sections: { 12: [{ code: 'message', status: 'validated' }, { code: 'ecrans', label: 'Écrans des magasins', status: 'todo' }], 13: [{ code: 'message', status: 'todo' }] },
  };
}

// mock.reply : réponse de la route de session ; mock.down : le module ne
// répond plus (500) ; mock.lastCookie / mock.puts : ce qu'il a reçu.
export function startMarketingMock(port = 0) {
  return new Promise((resolve) => {
    const mock = { reply: { status: 200, body: { authenticated: false } }, lastCookie: '', down: false, puts: [], data: marketingFixtures(), calls: [] };
    const srv = createServer((req, res) => {
      mock.lastCookie = String(req.headers.cookie || '');
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/marketing\/api\/v1\/marketing/, '');
      mock.calls.push(`${req.method} ${p}`);
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body == null ? 'erreur' : JSON.stringify(body)); };
      if (p === '/session') return send(mock.reply.status, mock.reply.body);
      if (mock.down) return send(500, null);
      if (!/PHPSESSID=/.test(mock.lastCookie)) return send(401, { status: 'error', description: 'Authentification requise.' });
      const D = mock.data;
      let m;
      if (req.method === 'GET' && p === '/campaigns') return send(200, D.list);
      if (req.method === 'GET' && p === '/offer-items') return send(200, D.offerItems);
      if (req.method === 'GET' && p === '/promotions') return send(200, D.promotions);
      if (req.method === 'GET' && p === '/bundles') return send(200, D.bundles);
      if (req.method === 'GET' && p === '/vouchers') return send(200, D.vouchers);
      if (req.method === 'GET' && (m = /^\/campaigns\/(\d+)$/.exec(p))) return D.details[m[1]] ? send(200, D.details[m[1]]) : send(404, { status: 'error', description: 'Campagne introuvable.' });
      if (req.method === 'GET' && (m = /^\/campaigns\/(\d+)\/production-sections$/.exec(p))) return send(200, { success: true, data: { sections: D.sections[m[1]] || [] }, meta: {} });
      if (req.method === 'PUT' && (m = /^\/campaigns\/(\d+)\/production-sections\/(\w+)$/.exec(p))) {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const body = JSON.parse(raw || '{}');
          const sec = (D.sections[m[1]] || []).find((s) => s.code === m[2]);
          if (!sec) return send(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Cette section ne fait pas partie de la campagne.' } });
          sec.status = body.status;
          mock.puts.push({ campaign: m[1], section: m[2], body });
          return send(200, { success: true, data: { sections: D.sections[m[1]] } });
        });
        return undefined;
      }
      return send(404, { status: 'error', description: 'route inconnue' });
    });
    srv.listen(port, '127.0.0.1', () => {
      mock.url = `http://127.0.0.1:${srv.address().port}/marketing/api/v1/marketing/session`;
      mock.close = () => srv.close();
      resolve(mock);
    });
  });
}

// Lancé seul (vérification visuelle) : node test/marketing-mock.js [port]
if (process.argv[1] && process.argv[1].endsWith('marketing-mock.js')) {
  startMarketingMock(parseInt(process.argv[2], 10) || 0).then((m) => {
    m.reply = { status: 200, body: { authenticated: true, user_id: 1, role: 'BRAND_ADMIN', dev_auth: true } };
    console.log(`Marketing simulé : ${m.url}`);
  });
}
