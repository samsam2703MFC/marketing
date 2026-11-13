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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Médiathèque commune (GET …/media-library, …/media-assets — forme lue dans
// api/src/Controller/MediaController.php et Service/MediaService.php : fiches
// camelCase, URL ABSOLUES construites avec l'hôte de la requête) et module
// Social (/marketing/social/api/v1/social : /catalogue/nav, /media/webshop,
// /media/detourer). Les fichiers servis sont des images du décor de la régie
// (public/assets), ou ceux d'un dossier donné par MK_MOCK_MEDIA_DIR pour une
// vérification visuelle.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_FILES = { 'croissant.png': 'sweet-tart-big.png', 'brioche.png': 'cake.png', 'cafe.png': 'cherry.png', 'pain.png': 'rhubarb.png' };
const mediaFile = (name) => {
  const dir = process.env.MK_MOCK_MEDIA_DIR;
  if (dir && existsSync(join(dir, name))) return readFileSync(join(dir, name));
  const f = MEDIA_FILES[name];
  return f && existsSync(join(ROOT, 'public', 'assets', f)) ? readFileSync(join(ROOT, 'public', 'assets', f)) : null;
};

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
    // Médiathèque commune : `url`/`webUrl` construites sur un autre hôte que
    // l'API (cas d'un module derrière Apache) — la régie relit le chemin.
    media: [
      { id: '31', kind: 'image', name: 'Croissant au beurre', file: 'croissant.png', width: 2400, height: 1600, category: { code: 'viennoiseries', label: 'Viennoiseries' }, season: null, offerItem: { id: '101', name: 'Croissant' }, cutout: false },
      { id: '32', kind: 'image', name: 'Brioche croustillante', file: 'brioche.png', width: 1600, height: 1600, category: { code: 'viennoiseries', label: 'Viennoiseries' }, season: { code: 'automne', label: 'Automne' }, offerItem: null, cutout: true },
      { id: '33', kind: 'image', name: 'Café', file: 'cafe.png', width: 1200, height: 800, category: { code: 'boissons', label: 'Boissons' }, season: null, offerItem: { id: '102', name: 'Café' }, cutout: false },
      { id: '34', kind: 'image', name: 'Pain au four', file: 'pain.png', width: 1200, height: 800, category: { code: 'pains', label: 'Pains' }, season: null, offerItem: null, cutout: false },
    ],
    webshop: {
      groupes: [], gammes: [], lu: '2026-11-13 08:00', source: '1',
      categories: [{ id: 5, name: 'Viennoiseries', image: null }],
      produits: [
        { id: 901, name: 'Croissant', nameNl: 'Croissant', image: 'https://cdn.r2.dev/webshop/p901.png', cat: 5, prix: null },
        { id: 902, name: 'Café', nameNl: 'Koffie', image: 'https://cdn.r2.dev/webshop/p902.png', cat: 5, prix: null },
        { id: 903, name: 'Sans photo', image: null, cat: 5, prix: null },
      ],
    },
    sections: { 12: [{ code: 'message', status: 'validated' }, { code: 'ecrans', label: 'Écrans des magasins', status: 'todo' }], 13: [{ code: 'message', status: 'todo' }] },
  };
}

// mock.reply : réponse de la route de session ; mock.down : le module ne
// répond plus (500) ; mock.lastCookie / mock.puts : ce qu'il a reçu.
export function startMarketingMock(port = 0) {
  return new Promise((resolve) => {
    const mock = { reply: { status: 200, body: { authenticated: false } }, lastCookie: '', down: false, puts: [], data: marketingFixtures(), calls: [], removebg: true, cutouts: 0, fileGets: 0 };
    const srv = createServer((req, res) => {
      mock.lastCookie = String(req.headers.cookie || '');
      const url = new URL(req.url, 'http://x');
      const origin = `http://127.0.0.1:${srv.address().port}`;
      // Fichiers de la médiathèque (servis sans session, comme les fichiers du module).
      const fm = /^\/marketing\/uploads\/media\/([\w.-]+)$/.exec(url.pathname);
      if (fm) {
        const buf = mediaFile(fm[1]);
        mock.fileGets++;
        if (!buf) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length }); res.end(buf); return;
      }
      if (url.pathname.startsWith('/marketing/social/api/v1/social/')) {
        const sp = url.pathname.slice('/marketing/social/api/v1/social'.length);
        const json = (st, b) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
        mock.calls.push(`${req.method} social${sp}`);
        if (mock.down) return json(500, { error: 'erreur' });
        if (!/PHPSESSID=/.test(mock.lastCookie)) return json(401, { error: 'session du cockpit requise' });
        if (req.method === 'GET' && sp === '/catalogue/nav') return json(200, mock.data.webshop);
        if (req.method === 'GET' && sp === '/media/webshop') {
          const u = url.searchParams.get('u') || '';
          const m = /^https:\/\/cdn\.r2\.dev\/webshop\/p(\d+)\.png$/.exec(u);
          if (!m) return json(422, { error: 'image refusée : seules les images du catalogue du webshop passent' });
          const buf = mediaFile(m[1] === '901' ? 'croissant.png' : 'cafe.png');
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length }); res.end(buf); return;
        }
        if (req.method === 'POST' && sp === '/media/detourer') {
          let raw = '';
          req.on('data', (c) => { raw += c; });
          req.on('end', () => {
            if (!mock.removebg) return json(409, { error: 'détourage non configuré : saisissez la clé remove.bg dans Paramètres → Rédaction IA & charte' });
            const b = JSON.parse(raw || '{}');
            if (!/^data:image\/(png|jpe?g|webp);base64,/.test(String(b.image || ''))) return json(422, { error: 'image refusée' });
            mock.cutouts++;
            return json(200, { src: `data:image/png;base64,${mediaFile('brioche.png').toString('base64')}`, credits: 1 });
          });
          return undefined;
        }
        return json(404, { error: 'route inconnue' });
      }
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
      const asset = (a) => ({
        id: a.id, kind: a.kind, name: a.name, mimeType: 'image/png', bytes: 1000, width: a.width, height: a.height,
        url: `https://cockpit.example/marketing/uploads/media/${a.file}`, webUrl: `https://cockpit.example/marketing/uploads/media/${a.file}`,
        thumbnailUrl: `${origin}/marketing/uploads/media/${a.file}`, path: `uploads/media/${a.file}`,
        category: a.category, subcategory: null, season: a.season, offerItem: a.offerItem, shop: null, cutout: a.cutout,
        source: 'marketing', archived: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z',
      });
      if (req.method === 'GET' && p === '/media-library') {
        return send(200, { success: true, data: { categories: [{ code: 'viennoiseries', label: 'Viennoiseries', files: 2, subcategories: [] }, { code: 'boissons', label: 'Boissons', files: 1, subcategories: [] }], seasons: [{ code: 'automne', label: 'Automne' }], counts: {}, limits: {} }, meta: {} });
      }
      if (req.method === 'GET' && p === '/media-assets') {
        const q = (url.searchParams.get('filter[name][contains]') || '').toLowerCase();
        const kind = url.searchParams.get('filter[kind][eq]');
        const rows = D.media.filter((a) => (!q || a.name.toLowerCase().includes(q)) && (!kind || a.kind === kind));
        return send(200, { success: true, data: rows.map(asset), meta: { pagination: { page: 1, perPage: 100, total: rows.length, totalPages: 1 } } });
      }
      if (req.method === 'GET' && (m = /^\/media-assets\/(\d+)$/.exec(p))) {
        const a = D.media.find((x) => x.id === m[1]);
        return a ? send(200, { success: true, data: asset(a), meta: {} }) : send(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Fichier introuvable dans la médiathèque.', details: [] } });
      }
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
