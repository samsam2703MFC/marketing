// Assistant vidéo de campagne — régie d'affichage (Marketing en magasin).
//
// Sept étapes sur quatre écrans (maquette validée) : Campagne + Produits ·
// Quand + Où · Catégorie et tags + Film · Diffuser. À droite, l'aperçu du film
// mis à jour en direct, rendu par le moteur des écrans (renderer.js) — le même
// que le compositeur, le player et la visionneuse.
//
// Il remplace l'« Assistant de diffusion » et en reprend tout : type de film
// (continu ou playlist), contenu, écrans, aperçu, diffusion réelle et rapport.
// La campagne vient du module Marketing (lu par le serveur de la régie avec la
// session du navigateur) ; sans Marketing, l'assistant marche en « vidéo libre ».
//
// Ce que l'assistant produit vit là où vit tout le reste : des éléments de la
// bibliothèque et un film (brouillon de la régie, PUT /draft), une suite pour
// la place dans la boucle (PUT /sequences), la diffusion par le chemin de
// publication de la régie (snapshot, tests live, rapport) puis la fin
// automatique à la date de fin (POST /campaign-video/diffuse).
import { html, h } from './vendor/preact-htm.js';
import { W, H, SCREEN, renderModule, newTag, newPos, tfbPromoLabel } from './renderer.js';
import { continuousDefaults, normContinuous } from './continuous.js';
import { filmEditorCard, filmEditorPanel, seedScenes, scenesOf, previewItems } from './film-editor.js';
import { normScenes, scenesDuration } from './scenes.js';
import { qrSvg } from './vendor/qr.js';

const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; e.body = json; throw e; }
  return json;
}

let UIDC = 0;
const uid = (p = 'm') => p + Date.now().toString(36) + (UIDC++).toString(36);

export const CW_STEPS = ['cw.step.campaign', 'cw.step.products', 'cw.step.when', 'cw.step.where', 'cw.step.tags', 'cw.step.film', 'cw.step.broadcast'];
// Écran → ses étapes (1-indexées) : 1-2 · 3-4 · 5 · 6 (l'éditeur du film) · 7.
const SCREENS = [[1, 2], [3, 4], [5], [6], [7]];
const FILM = 3;
const LAST = SCREENS.length - 1;
const MOMENTS = ['matin', 'midi', 'aprem'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const RATIOS = [3, 6, 10];
const DURS = [10, 20, 30];
const TEMPLATES = ['offre', 'photo', 'prix'];
const CATS = ['campagne', 'produit-jour', 'saison', 'promo', 'marque'];
const WEEKS = ['A', 'B', 'C', 'D', 'E'];

const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = (x) => norm(x).replace(/[^a-z0-9%]+/g, '-').replace(/%/g, '').replace(/^-+|-+$/g, '').slice(0, 32);
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const eur = (v) => { const n = num(v); return n == null ? '' : `${n.toFixed(2).replace('.', ',')} €`; };
const fmtDay = (iso, lang) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
  const loc = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB', it: 'it-IT' }[lang] || 'fr-BE';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// ---------------------------------------------------------------------------
// Règles de vente (même logique que le serveur, momentTagFilters).
function saleRules(rows) {
  const out = {};
  for (const kind of ['produit', 'categorie', 'promotion', 'campagne']) {
    const incl = new Map(); const excl = new Map();
    for (const r of rows || []) {
      if ((r.kind || 'produit') !== kind) continue;
      const bag = r.exception ? excl : incl;
      if (!bag.has(r.productId)) bag.set(r.productId, new Set());
      bag.get(r.productId).add(r.moment);
    }
    out[kind] = (id, mo) => {
      if (!id) return true;
      if (excl.has(id) && excl.get(id).has(mo)) return false;
      const inc = incl.get(id);
      return inc && inc.size ? inc.has(mo) : true;
    };
  }
  return out;
}

// Une période de l'année (MM-JJ, JJ/MM ou date complète) croise-t-elle [from, to] ?
function seasonMD(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return +m[2] * 100 + +m[3];
  m = /^(\d{1,2})[/.](\d{1,2})/.exec(s); if (m) return +m[2] * 100 + +m[1];
  m = /^(\d{1,2})-(\d{1,2})$/.exec(s); if (m) return +m[1] * 100 + +m[2];
  return null;
}
function seasonOverlaps(se, from, to) {
  const a = seasonMD(se.from); const b = seasonMD(se.to);
  if (a == null || b == null || !from) return false;
  const end = to || from;
  for (let d = Date.parse(`${from}T12:00:00Z`), i = 0; d <= Date.parse(`${end}T12:00:00Z`) && i < 400; d += 86400000, i++) {
    const x = new Date(d); const md = (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
    if (a <= b ? (md >= a && md <= b) : (md >= a || md <= b)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// État de départ.
function blank() {
  return {
    screen: 0, mk: { loading: true }, campaignId: '', detail: null, detailBusy: false,
    products: [], promos: [], from: todayIso(), to: '', week: 'A', mode: 'continu', ratio: 6,
    grid: DAYS.map(() => [true, true, true]), gridTouched: false,
    players: [], playersTouched: false,
    cat: 'campagne', tags: [], tagsTouched: false, tagInput: '',
    template: 'offre', titleFr: '', titleNl: '', hookFr: '', hookNl: '', dur: 20,
    opening: '', openingOff: false, previewStore: '', addOpen: false, addQ: '',
    filmId: '', moduleIds: [], seqId: '', tr: null, trBusy: false,
    busy: '', done: null, ready: null, error: '', resumeOf: null,
    // Éditeur du film : scènes et calques, textes NL saisis par calque.
    scenes: [], sceneIdx: 0, layerId: '', orient: 'paysage', nl: {}, playT: 0, playing: false, drawer: null, legacyFilm: false,
  };
}

export function openCampaignWizard(app) {
  app.setState({ view: 'campaignVideo', cw: blank() });
  app.refreshFleet();
  if (!(app.state.mediaLib || []).length) app.loadMediaLib();
  if (!(app.state.prodMoments || []).length) app.loadProdMoments();
  if (!(app.state.seasons || []).length) app.loadSeasons();
  api('GET', '/campaign-video/campaigns').then((r) => {
    setCw(app, { mk: { loading: false, ...r } });
    // Une campagne EN COURS est prise d'office.
    if (r.ok && r.current && r.current[0]) pickCampaign(app, r.current[0].id);
  }).catch((e) => setCw(app, { mk: { loading: false, ok: false, error: e.message } }));
}

const cwOf = (app) => app.state.cw || blank();
function setCw(app, patch) { app.setState((s) => ({ cw: { ...(s.cw || blank()), ...(typeof patch === 'function' ? patch(s.cw || blank()) : patch) } })); }

// ---------------------------------------------------------------------------
// Campagne choisie : son détail résolu, puis tout ce qui se reprend d'office.
async function pickCampaign(app, id) {
  const resume = (app.state.playlists || []).find((p) => p.origin === 'assistant' && p.campaignId && p.campaignId === String(id));
  setCw(app, { campaignId: String(id), detail: null, detailBusy: true, error: '', resumeOf: resume ? resume.id : null });
  try {
    const d = await api('GET', `/campaign-video/campaigns/${encodeURIComponent(id)}`);
    if (cwOf(app).campaignId !== String(id)) return;
    applyDetail(app, d);
  } catch (e) {
    setCw(app, { detailBusy: false, detail: { ok: false, error: (e.body && e.body.error) || e.message } });
  }
}

function applyDetail(app, d) {
  const c = d.campaign || {};
  const st = app.state;
  const offerPromos = matchOfferPromos(app, d);
  const products = (d.products || []).map((p) => p.productId).filter((x, i, a) => a.indexOf(x) === i);
  const stores = new Set((d.stores || []).map((s) => s.storeId));
  const players = (st.fleet || []).filter((s) => stores.has(s.id)).flatMap((s) => (s.players || []).map((p) => p.id));
  const hook = (c.offer && (c.offer.title || c.offer.discount || c.offer.mechanic)) || '';
  setCw(app, (cw) => ({
    detail: d, detailBusy: false,
    products, promos: offerPromos,
    from: c.startsOn || todayIso(), to: c.endsOn || '',
    players, playersTouched: false, gridTouched: false, tagsTouched: false,
    titleFr: c.name || '', hookFr: hook, titleNl: '', hookNl: '',
    template: c.imageUrl || (c.offer && c.offer.imageUrl) ? cw.template : (cw.template === 'photo' ? 'offre' : cw.template),
    cat: 'campagne',
  }));
}

// Promotions et bundles de la régie qui font partie de l'offre : même nom
// qu'une promotion ou un bundle du Marketing rattaché à la campagne, ou même
// code de bon que l'offre.
function matchOfferPromos(app, d) {
  const st = app.state;
  const L = d.offerLinks || {};
  const names = new Set([...(L.promotions || []).map((p) => norm(p.name)), ...(L.bundles || []).filter((b) => (b.items || []).length).map((b) => norm(b.name))]);
  const offerName = norm(d.campaign && d.campaign.offer && d.campaign.offer.title);
  const code = norm(L.voucherCode);
  const out = [];
  for (const b of st.bundles || []) if (names.has(norm(b.name)) || (offerName && norm(b.name) === offerName)) out.push('b:' + b.id);
  for (const p of st.tfbPromos || []) {
    if (names.has(norm(p.name)) || (offerName && norm(p.name) === offerName)) out.push('p:' + p.id);
    else if (code && p.kind === 'voucher' && p.mech && norm(p.mech.code) === code) out.push('p:' + p.id);
  }
  return out;
}

function pickFree(app) {
  setCw(app, {
    campaignId: 'libre', detail: { ok: true, campaign: null, products: [], productsUnmatched: [], stores: [], storesUnmatched: [], offerLinks: {} },
    detailBusy: false, products: [], promos: [], from: todayIso(), to: '', players: [], playersTouched: false,
    titleFr: '', hookFr: '', titleNl: '', hookNl: '', template: 'offre', cat: 'produit-jour', resumeOf: null,
  });
}

// Reprendre le film déjà créé pour cette campagne : ses choix reviennent.
function resumeFilm(app, filmId) {
  const f = (app.state.playlists || []).find((p) => p.id === filmId);
  if (!f) return;
  const w = f.wizard || {};
  const c = w.choices || {};
  // Un film d'avant l'éditeur (sans scènes) garde son modèle tant qu'on ne le
  // recompose pas en scènes.
  setCw(app, (cw) => ({ ...cw, ...c, scenes: normScenes(c.scenes), nl: c.nl || {}, legacyFilm: !(Array.isArray(c.scenes) && c.scenes.length), filmId: f.id, moduleIds: w.moduleIds || [], seqId: w.seqId || '', resumeOf: null, screen: 0 }));
}

// ---------------------------------------------------------------------------
// Données calculées une fois par rendu.
function model(app) {
  const st = app.state;
  const cw = cwOf(app);
  const T = (k, v) => app.t(k, v);
  const lang = st.uiLang || 'fr';
  const prods = st.catalog.products || [];
  const cats = st.catalog.categories || [];
  const prodById = new Map(prods.map((p) => [p.id, p]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const rules = saleRules(st.prodMoments);
  const soldAt = (p, mo) => rules.categorie(p.categoryId, mo) && rules.produit(p.id, mo);
  const d = cw.detail && cw.detail.ok ? cw.detail : null;
  const camp = d && d.campaign;
  const fleet = (st.fleet || []).filter((s) => s.id !== 'st-new');
  const campStores = new Set((d && d.stores ? d.stores : []).map((s) => s.storeId));
  // Écrans cochés : d'office ceux des magasins de la campagne (le réseau
  // peut arriver après la campagne), jusqu'au premier changement à la main.
  const playerIds = cw.playersTouched ? cw.players
    : fleet.filter((s) => campStores.has(s.id)).flatMap((s) => (s.players || []).map((p) => p.id));
  const chosenPlayers = new Set(playerIds);
  // Magasins sans écran jumelé : ils diffusent par le lien de leur écran (film?store=…).
  // Cochés d'office quand ils sont dans la campagne, jusqu'au premier changement à la main.
  const sansEcran = (s) => !(s.players || []).length;
  const linkStores = (cw.linkTouched ? (cw.linkStores || []) : fleet.filter((s) => campStores.has(s.id) && sansEcran(s)).map((s) => s.id))
    .filter((id) => fleet.some((s) => s.id === id && sansEcran(s)));
  const linkSet = new Set(linkStores);
  const storesChosen = fleet.filter((s) => (s.players || []).some((p) => chosenPlayers.has(p.id)) || linkSet.has(s.id));
  const selProds = cw.products.map((id) => prodById.get(id)).filter(Boolean);
  // Prix d'un produit dans un magasin : celui de la caisse (TFBuddy), sinon rien.
  const priced = (p) => Object.keys(p.prices || {}).length > 0;
  const priceIn = (p, sid) => (p.prices && p.prices[sid]) || '';
  const soldIn = (p, sid) => !priced(p) || !!priceIn(p, sid);
  const priceStores = storesChosen.length ? storesChosen : fleet.filter((s) => campStores.has(s.id));
  // Moments où au moins un produit retenu se vend.
  const momentOk = MOMENTS.map((mo) => !selProds.length || selProds.some((p) => soldAt(p, mo)));
  const grid = cw.gridTouched ? cw.grid : DAYS.map(() => momentOk.slice());
  const gridOn = grid.map((row) => row.map((v, i) => v && momentOk[i]));
  const daysOn = DAYS.map((di) => gridOn[di].some(Boolean));
  const momentsOn = MOMENTS.filter((_, i) => gridOn.some((row) => row[i]));
  // Promotions de la régie actives pendant la période et portant sur les produits retenus.
  const from = cw.from; const to = cw.to || cw.from;
  const inPeriod = (x) => (!x.dateFrom || !to || x.dateFrom.slice(0, 10) <= to) && (!x.dateTo || !from || x.dateTo.slice(0, 10) >= from);
  const selIds = new Set(cw.products);
  const selCats = new Set(selProds.map((p) => p.categoryId));
  const promoList = [];
  for (const b of st.bundles || []) {
    if (b.status !== 'ACTIVE' || !inPeriod(b)) continue;
    if ((b.items || []).some((it) => selIds.has(it.productId)) || cw.promos.includes('b:' + b.id)) promoList.push({ key: 'b:' + b.id, kind: 'bundle', x: b, name: b.name, label: bundleLabel(b, prodById, T) });
  }
  for (const p of st.tfbPromos || []) {
    if (p.status !== 'ACTIVE' || !inPeriod(p)) continue;
    const hits = (p.products || []).some((x) => selIds.has(x.productId)) || (p.categories || []).some((c) => selCats.has(c.categoryId));
    if (hits || cw.promos.includes('p:' + p.id)) promoList.push({ key: 'p:' + p.id, kind: 'promo', x: p, name: p.name, label: tfbPromoLabel({ kind: p.kind, mech: p.mech }, ['nl', 'en'].includes(lang) ? lang : 'fr') });
  }
  const offerKeys = new Set(d ? matchOfferPromos(app, d) : []);
  // Écrans retenus.
  const players = fleet.flatMap((s) => (s.players || []).map((p) => ({ ...p, storeId: s.id, storeName: s.store, store: s })));
  const chosen = players.filter((p) => chosenPlayers.has(p.id));
  const portraitN = chosen.filter((p) => orientOf(p) === 'portrait').length;
  const offline = chosen.filter((p) => p.state === 'offline');
  // Langues : un magasin néerlandophone ciblé exige les textes NL validés.
  const nlStores = storesChosen.filter((s) => s.lang === 'nl');
  // Média d'ouverture proposé : mêmes produits, saison ou moment.
  const seasons = (st.seasons || []).filter((se) => se.active !== false && seasonOverlaps(se, from, to));
  const seasonIds = new Set(seasons.map((s) => s.id));
  const media = (st.mediaLib || []).filter((m) => m.kind === 'film' && m.present !== false).map((m) => ({
    m, score: (selIds.has(m.productId) ? 4 : 0) + (seasonIds.has(m.seasonId) ? 2 : 0) + (m.moment !== 'all' && momentsOn.includes(m.moment) ? 1 : 0),
  })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const opening = cw.openingOff ? null : ((st.mediaLib || []).find((m) => m.id === cw.opening) || (media[0] && media[0].m) || null);
  // Tags proposés : campagne, période, catégories, offre, moments.
  const proposed = [];
  const addTag = (t) => { const s = slug(t); if (s && !proposed.includes(s)) proposed.push(s); };
  for (const se of seasons) addTag(se.name);
  for (const p of selProds) addTag(catName.get(p.categoryId));
  if (camp && (camp.offer || promoList.some((x) => cw.promos.includes(x.key)))) addTag('promo');
  if (cw.hookFr) addTag(cw.hookFr);
  else if (camp && camp.offer && (camp.offer.title || camp.offer.discount)) addTag(camp.offer.title || camp.offer.discount);
  for (const mo of momentsOn) addTag(T('moment.' + mo));
  const tags = cw.tagsTouched ? cw.tags : proposed;
  const suggestions = [];
  if (camp && camp.type) suggestions.push(slug(camp.type));
  for (const p of selProds.slice(0, 4)) suggestions.push(slug(p.name));
  if (camp && camp.objective) suggestions.push(slug(camp.objective));
  const sugg = [...new Set(suggestions)].filter((s) => s && !tags.includes(s));
  return {
    st, cw, T, lang, playerIds, linkStores, linkSet, prods, cats, prodById, catName, soldAt, d, camp, fleet, campStores, storesChosen, selProds,
    priceIn, soldIn, priced, priceStores, momentOk, gridOn, daysOn, momentsOn, promoList, offerKeys,
    players, chosen, portraitN, offline, nlStores, media, opening, seasons, tags, sugg,
  };
}

// Rôle d'un élément du film dans l'assistant (le reprendre, pas le dupliquer).
const roleOf = (m) => (m.type === 'film' ? 'open' : (m.type === 'category' || m.type === 'campagne' || m.type === 'scenes') ? 'main'
  : m.type === 'bundle' ? 'promo:b:' + m.bundleRef : m.type === 'promotion' ? 'promo:p:' + m.tfbRef : '');
const orientOf = (p) => (/portrait/i.test(String(p.orient || '')) ? 'portrait' : 'paysage');
function bundleLabel(b, prodById, T) {
  const parts = (b.items || []).map((it) => `${(Number(it.qty) || 1) !== 1 ? `${it.qty}× ` : ''}${(prodById.get(it.productId) || {}).name || it.name || ''}`);
  return `${parts.join(' + ')}${b.price != null ? ` = ${eur(b.price)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Construction des éléments et du film (brouillon de la régie).
function buildFilm(app, M) {
  const { cw, st, camp } = M;
  const keep = new Set(cw.moduleIds || []);
  const ids = { open: '', main: '', promos: [] };
  const old = (st.library || []).filter((m) => keep.has(m.id));
  const oldBy = (role) => old.find((m) => roleOf(m) === role);
  const schedule = { days: M.daysOn.slice(), from: '00:00', to: '23:59' };
  const moments = M.momentsOn.length === 3 ? [] : M.momentsOn.slice();
  const base = (role, extra) => {
    const prev = oldBy(role);
    return {
      id: prev ? prev.id : uid(), name: '', sub: '', libTag: 'promo', motion: 'm1',
      tag: newTag(), schedule, pos: newPos(), items: [], catRef: '', productRef: '', productRefs: [],
      video: '', dur: 0, orient: 'paysage', moments, ...extra,
    };
  };
  const mods = [];
  if (M.opening) {
    const mm = base('open', { type: 'film', name: `${cw.titleFr || (camp && camp.name) || ''} · ${M.T('cw.film.opening')}`.trim(), video: 'media/' + encodeURIComponent(M.opening.filename), dur: 8, layout: 'cover' });
    ids.open = mm.id; mods.push(mm);
  }
  const title = cw.titleFr || (camp && camp.name) || M.T('cw.untitled');
  const tag = cw.hookFr ? { enabled: true, label: cw.hookFr, img: '' } : newTag();
  let campaignMirror = null;
  const scenes = scenesOf(cw);
  if (scenes.length) {
    // Film composé dans l'éditeur : un élément « scènes » (photos, textes animés,
    // prix du magasin). Ses lignes de produits = les produits des calques prix.
    const mm = base('main', { type: 'scenes', name: title, layout: 'scenes', scenes, motion: 'none', dur: 0 });
    ids.main = mm.id; mods.push(mm);
  } else if (cw.template === 'photo') {
    const cid = `mkt-${cw.campaignId === 'libre' ? (cw.filmId || 'libre') : cw.campaignId}`;
    campaignMirror = {
      id: cid, name: title, scope: 'gamme', productRef: '', theme: '', message: cw.hookFr || '',
      image: (camp && (camp.imageUrl || (camp.offer && camp.offer.imageUrl))) || '',
      dateFrom: cw.from || '', dateTo: cw.to || '', color: '#8D1D2C', active: true,
    };
    const mm = base('main', { type: 'campagne', name: title, layout: 'cover', campaignRef: cid, dur: cw.dur });
    ids.main = mm.id; mods.push(mm);
  } else {
    const mm = base('main', { type: 'category', name: title, layout: cw.template === 'prix' ? 'text-only' : 'illo-right', productRefs: cw.products.slice(), dur: cw.dur, tag });
    ids.main = mm.id; mods.push(mm);
  }
  for (const k of cw.promos) {
    const item = M.promoList.find((x) => x.key === k);
    if (!item) continue;
    const role = 'promo:' + k;
    if (item.kind === 'bundle') {
      const mm = base(role, { type: 'bundle', name: item.x.name, layout: 'composition', bundleRef: item.x.id, dur: 9 });
      ids.promos.push(mm.id); mods.push(mm);
    } else {
      const pids = app.tfbPromoProducts(item.x);
      const hero = pids.find((id) => cw.products.includes(id)) || pids[0] || '';
      const mm = base(role, { type: 'promotion', name: item.x.name, layout: hero || item.x.img ? 'hero-right' : 'band', tfbRef: item.x.id, promoType: app.tfbPromoTypeFor(item.x), productRef: hero, dur: 7 });
      ids.promos.push(mm.id); mods.push(mm);
    }
  }
  const order = [ids.open, ids.main, ...ids.promos].filter(Boolean);
  const filmId = cw.filmId || ('pl' + uid('c'));
  const seqId = cw.mode === 'continu' ? (cw.seqId || ('sq' + filmId)) : '';
  const choices = {
    campaignId: cw.campaignId, products: cw.products, promos: cw.promos, from: cw.from, to: cw.to, week: cw.week, mode: cw.mode,
    ratio: cw.ratio, grid: M.gridOn, gridTouched: true, players: M.playerIds, playersTouched: true, linkStores: M.linkStores, linkTouched: true, cat: cw.cat, tags: M.tags, tagsTouched: true,
    template: cw.template, titleFr: cw.titleFr, titleNl: cw.titleNl, hookFr: cw.hookFr, hookNl: cw.hookNl, dur: cw.dur,
    opening: M.opening ? M.opening.id : '', openingOff: cw.openingOff, detail: cw.detail,
    scenes, nl: cw.nl || {}, orient: cw.orient,
  };
  const film = app.normFilm({
    id: filmId, name: title, items: cw.mode === 'playlist' ? order : [], cat: cw.cat, tags: M.tags,
    schedule, planDays: M.daysOn.slice(), stores: M.storesChosen.map((s) => s.id), mode: cw.mode, origin: 'assistant',
    campaignId: cw.campaignId === 'libre' ? '' : cw.campaignId,
    continuous: normContinuous({ ...continuousDefaults(), perMoment: true, sequences: seqId ? [seqId] : [] }),
    wizard: { moduleIds: order, seqId, choices, savedAt: new Date().toISOString() },
  });
  const seq = seqId ? { id: seqId, name: `${M.T('cw.seqName')} · ${title}`, placement: 'boucle', ratio: cw.ratio, orient: 'paysage', active: true, items: order } : null;
  return { mods, film, seq, campaignMirror, order, ids };
}

// Enregistre le brouillon (éléments + film), la suite et le reflet de la
// campagne ; puis les textes néerlandais saisis (validés d'office).
async function saveFilm(app, M) {
  const built = buildFilm(app, M);
  const st = app.state;
  const prevIds = new Set(M.cw.moduleIds || []);
  const nextIds = new Set(built.mods.map((m) => m.id));
  const library = [...(st.library || []).filter((m) => !prevIds.has(m.id) || nextIds.has(m.id)).map((m) => built.mods.find((x) => x.id === m.id) || m),
    ...built.mods.filter((m) => !(st.library || []).some((x) => x.id === m.id))];
  const playlists = (st.playlists || []).some((p) => p.id === built.film.id)
    ? st.playlists.map((p) => (p.id === built.film.id ? built.film : p))
    : [...(st.playlists || []), built.film];
  // Suite (place dans la boucle) : la liste entière, celle du film remplacée.
  const seqs = (st.sequences || []).filter((s) => s.id !== (M.cw.seqId || '') && (!built.seq || s.id !== built.seq.id));
  if (built.seq) seqs.push(built.seq);
  app.setState({ library, playlists, dirty: false, saved: true });
  if (built.campaignMirror) {
    const list = (st.campaigns || []).filter((c) => c.id !== built.campaignMirror.id).concat([built.campaignMirror]);
    const r = await api('PUT', '/campaigns', { campaigns: list });
    app.setState({ campaigns: r.campaigns || list });
  }
  await api('PUT', '/draft', { ...app.draftBody(), modules: library, playlists });
  const sq = await api('PUT', '/sequences', { sequences: seqs });
  app.setState({ sequences: sq.sequences || seqs });
  setCw(app, { filmId: built.film.id, moduleIds: built.order, seqId: built.seq ? built.seq.id : '' });
  // Textes NL saisis à la main : enregistrés et validés.
  const key = (f) => `module:${built.ids.main}:${f}`;
  const writes = [];
  if (M.cw.template !== 'photo') {
    if (M.cw.titleNl.trim()) writes.push(['name', M.cw.titleNl]);
    if (M.cw.hookNl.trim() && M.cw.hookFr.trim()) writes.push(['tag', M.cw.hookNl]);
  }
  for (const [f, text] of writes) await api('PUT', '/translations', { lang: 'nl', key: key(f), text }).catch(() => {});
  // Film en scènes : le néerlandais saisi pour chaque texte (et chaque promo).
  if (built.film && scenesOf(M.cw).length) {
    for (const sc of scenesOf(M.cw)) {
      for (const l of sc.layers) {
        const nl = (M.cw.nl || {})[l.id] || {};
        if (l.kind === 'text' && l.text.trim() && String(nl.text || '').trim()) await api('PUT', '/translations', { lang: 'nl', key: `scene:${built.ids.main}.${l.id}:text`, text: nl.text }).catch(() => {});
        if (l.kind === 'price' && l.promo.trim() && String(nl.promo || '').trim()) await api('PUT', '/translations', { lang: 'nl', key: `scene:${built.ids.main}.${l.id}:promo`, text: nl.promo }).catch(() => {});
      }
    }
  }
  await loadTr(app, built.ids.main);
  return built;
}

// État des traductions NL du titre et de l'accroche (circuit sig_translations).
async function loadTr(app, mainId) {
  try {
    const r = await api('GET', '/translations?lang=nl');
    const by = (f) => (r.items || []).find((x) => x.key === `module:${mainId}:${f}`) || null;
    const scene = {};
    for (const x of r.items || []) if (x.kind === 'scene' && x.refId.startsWith(`${mainId}.`)) scene[`${x.refId.slice(mainId.length + 1)}:${x.field}`] = x;
    setCw(app, { tr: { name: by('name'), tag: by('tag'), scene, claude: r.claude || null, job: r.job || null } });
  } catch { setCw(app, { tr: null }); }
}

async function proposeNl(app, M) {
  setCw(app, { trBusy: true });
  try {
    const built = await saveFilm(app, M);
    await api('POST', '/translations/propose', { lang: 'nl', kinds: ['module', 'scene'] });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await api('GET', '/translations?lang=nl');
      if (!r.job || !r.job.running) break;
    }
    await loadTr(app, built.ids.main);
    const t = cwOf(app).tr || {};
    setCw(app, (cw) => {
      // Propositions de Claude reprises dans les champs NL encore vides.
      const nl = { ...(cw.nl || {}) };
      for (const [k, x] of Object.entries(t.scene || {})) {
        const [lid, f] = k.split(':');
        if (x.translation && !(nl[lid] || {})[f]) nl[lid] = { ...(nl[lid] || {}), [f]: x.translation.text };
      }
      return {
        trBusy: false, nl,
        titleNl: cw.titleNl || (t.name && t.name.translation ? t.name.translation.text : ''),
        hookNl: cw.hookNl || (t.tag && t.tag.translation ? t.tag.translation.text : ''),
      };
    });
  } catch (e) { setCw(app, { trBusy: false }); app.showToast(`${M.T('cw.err')} : ${(e.body && e.body.error) || e.message}`); }
}

async function validateNl(app, M) {
  const ids = buildFilm(app, M).ids;
  const keys = ['name', 'tag'].map((f) => `module:${ids.main}:${f}`);
  const edits = Object.fromEntries([[keys[0], M.cw.titleNl], [keys[1], M.cw.hookNl]].filter(([, v]) => String(v || '').trim()));
  for (const sc of scenesOf(M.cw)) {
    for (const l of sc.layers) {
      const nl = (M.cw.nl || {})[l.id] || {};
      for (const f of l.kind === 'text' ? ['text'] : l.kind === 'price' ? ['promo'] : []) {
        const k = `scene:${ids.main}.${l.id}:${f}`;
        keys.push(k);
        if (String(nl[f] || '').trim()) edits[k] = nl[f];
      }
    }
  }
  try {
    await api('POST', '/translations/validate', { lang: 'nl', keys, edits });
    await loadTr(app, ids.main);
  } catch (e) { app.showToast(`${M.T('cw.err')} : ${e.message}`); }
}

async function saveDraftOnly(app, M) {
  setCw(app, { busy: 'save' });
  try { await saveFilm(app, M); setCw(app, { busy: '' }); app.showToast(M.T('cw.saved')); }
  catch (e) { setCw(app, { busy: '' }); app.showToast(`${M.T('cw.err')} : ${(e.body && e.body.error) || e.message}`); }
}

async function viewFilm(app, M) {
  // La fenêtre s'ouvre tout de suite (sinon le navigateur la bloque), puis
  // reçoit l'adresse du film une fois le brouillon enregistré.
  const win = window.open('about:blank', '_blank');
  try {
    const built = await saveFilm(app, M);
    const url = app.filmUrl({ film: built.film.id, w: 3840, h: 2160 });
    if (win) win.location.href = url; else window.open(url, '_blank');
  } catch (e) { if (win) win.close(); app.showToast(`${M.T('cw.err')} : ${e.message}`); }
}

async function diffuse(app, M) {
  if (cwOf(app).busy) return;
  setCw(app, { busy: 'diffuse', error: '' });
  try {
    const built = await saveFilm(app, M);
    const cells = [];
    M.gridOn.forEach((row, d) => row.forEach((on, i) => { if (on) cells.push({ day: d, moment: MOMENTS[i] }); }));
    const out = await api('POST', '/campaign-video/diffuse', {
      filmId: built.film.id, players: M.playerIds, stores: M.linkStores, startsOn: M.cw.from, endsOn: M.cw.to, week: M.cw.week, cells,
      campaignId: M.cw.campaignId === 'libre' ? '' : M.cw.campaignId,
    });
    let ready = null;
    if (M.cw.campaignId && M.cw.campaignId !== 'libre') {
      ready = await api('POST', `/campaign-video/campaigns/${encodeURIComponent(M.cw.campaignId)}/screens-ready`, {})
        .then(() => ({ ok: true }), (e) => ({ ok: false, missing: e.status === 409, error: (e.body && e.body.error) || e.message }));
    }
    const okN = (out.tests || []).filter((t) => t.ok).length;
    setCw(app, { busy: '', ready, done: { ...out, testsOk: okN, testsTotal: (out.tests || []).length, name: built.film.name, url: app.filmUrl({ film: built.film.id, w: 3840, h: 2160 }) } });
    app.refreshFleet();
    api('GET', '/plan').then((p) => app.setState({ planByStore: p.byStore || {}, planWindows: p.windows || [] })).catch(() => {});
  } catch (e) {
    setCw(app, { busy: '', error: e.status === 401 ? M.T('cw.sessionExpired') : ((e.body && e.body.error) || e.message) });
  }
}

// ---------------------------------------------------------------------------
// Aperçu : le premier élément « principal » rendu par le moteur des écrans, à
// l'instant 2 s, en paysage (canevas entier) et en portrait (la dalle centrale,
// comme un écran 9:16 la montre).
function previewModule(app, M) {
  const { cw } = M;
  const built = buildFilm(app, M);
  const main = built.mods.find((m) => roleOf(m) === 'main');
  if (!main) return null;
  let m = main;
  const sid = cw.previewStore || (M.storesChosen[0] && M.storesChosen[0].id) || '';
  if (main.type === 'scenes') {
    m = { ...main, items: previewItems(M, main.scenes) };
  } else if (main.type === 'category') {
    const items = M.selProds.filter((p) => !sid || M.soldIn(p, sid)).map((p) => ({ name: p.name, price: (sid && M.priceIn(p, sid)) || p.price, img: p.img, src: p.src, active: true, productId: p.id }));
    m = { ...main, items };
  } else if (main.type === 'campagne') {
    m = { ...main, campaign: { ...built.campaignMirror } };
  }
  return m;
}
function stage(m, w, portrait) {
  if (!m) return html`<div class="cw-screen cw-screen--empty" style=${`width:${w}px;height:${Math.round(portrait ? w * 16 / 9 : w * H / W)}px;`}></div>`;
  const kids = renderModule(h, m, 2, { secPerLine: 4 });
  if (!portrait) {
    const s = w / W;
    return html`<div class="cw-screen" style=${`width:${w}px;height:${Math.round(H * s)}px;`}><div style=${`position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#F5EFE4;transform:scale(${s});transform-origin:top left;`}>${kids}</div></div>`;
  }
  const s = w / SCREEN;
  return html`<div class="cw-screen" style=${`width:${w}px;height:${Math.round(H * s)}px;`}><div style=${`position:absolute;left:${-SCREEN * s}px;top:0;width:${W}px;height:${H}px;background:#F5EFE4;transform:scale(${s});transform-origin:top left;`}>${kids}</div></div>`;
}

// ---------------------------------------------------------------------------
// Rendu.
export function renderCampaignWizard(app) {
  const M = model(app);
  const { cw, T } = M;
  const scr = cw.done ? LAST : cw.screen;
  const active = SCREENS[scr];
  const go = (n) => {
    const to = Math.max(0, Math.min(LAST, n));
    // L'éditeur du film s'ouvre sur une première composition tirée de la
    // campagne (sauf un film d'avant l'éditeur, repris tel quel).
    const seed = to === FILM && !scenesOf(cwOf(app)).length && !cwOf(app).legacyFilm ? { scenes: seedScenes(M), sceneIdx: 0, layerId: '' } : {};
    setCw(app, { screen: to, playing: false, ...seed });
    const el = document.querySelector('.app__body'); if (el) el.scrollTop = 0;
  };
  const filmOk = !!(cw.titleFr || (M.camp && M.camp.name)) && (scenesOf(cw).length > 0 || cw.legacyFilm);
  // Ce qui manque pour passer à l'étape suivante : dit en clair sous le bouton, jamais un bouton grisé muet.
  const blockers = [];
  if (scr === 0) {
    if (!cw.campaignId) blockers.push({ t: T('cw.blk.campaign'), go: 'campaign' });
    else if (cw.detailBusy) blockers.push({ t: T('cw.blk.reading') });
    else if (!(cw.products.length > 0 || cw.template === 'photo')) blockers.push({ t: T('cw.blk.products'), go: 'products' });
  } else if (scr === 1) {
    if (!M.daysOn.some(Boolean)) blockers.push({ t: T('cw.blk.days'), go: 'when' });
    if (!M.playerIds.length && !M.linkStores.length) blockers.push({ t: T('cw.blk.screens'), go: 'where' });
  } else if (scr === FILM) {
    if (!(cw.titleFr || (M.camp && M.camp.name))) blockers.push({ t: T('cw.blk.title'), go: 'filmmeta' });
    if (!(scenesOf(cw).length > 0 || cw.legacyFilm)) blockers.push({ t: T('cw.blk.scenes') });
  }
  const canNext = !blockers.length && (scr !== FILM || filmOk);
  const blockedTip = blockers.map((b) => b.t).join(' · ');
  // Un clic sur un problème mène là où il se règle (la carte, mise en évidence).
  const allerA = (id) => { const el = document.getElementById('cw-' + id); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.remove('cw-flash'); void el.offsetWidth; el.classList.add('cw-flash'); };
  const blockedNote = !canNext && blockers.length && !cw.done
    ? html`<div class="cw-note cw-note--warn cw-blocked" role="status"><span>${T('cw.blk.title0')}</span><ul>${blockers.map((b) => html`<li>${b.go
      ? html`<button type="button" class="cw-blocked__go" onClick=${() => allerA(b.go)}>${b.t} →</button>` : b.t}</li>`)}</ul></div>` : '';
  const stepper = html`
    <ol class="cw-steps">
      ${CW_STEPS.map((k, i) => {
        const n = i + 1;
        const on = active.includes(n);
        const ok = !on && n < active[0];
        return html`<li key=${k} class=${'cw-step' + (on ? ' is-on' : '') + (ok ? ' is-ok' : '')}>
          <button type="button" disabled=${!ok || !!cw.done} onClick=${() => go(SCREENS.findIndex((x) => x.includes(n)))}>
            <span class="cw-step__n">${ok ? '✓' : n}</span><span>${T(k)}</span>
          </button></li>`;
      })}
    </ol>`;
  const nextLabel = [T('cw.next.whenWhere'), T('cw.next.tags'), T('cw.next.film'), T('cw.next.broadcast')][scr];
  const backLabel = [T('cw.cancel'), T('cw.back.campaign'), T('cw.back.whenWhere'), T('cw.back.tags'), T('cw.back.film')][scr];
  let body;
  if (cw.done) body = doneScreen(app, M);
  else if (scr === 0) body = html`<div id="cw-campaign">${campaignCard(app, M)}</div><div id="cw-products">${productsCard(app, M)}</div>`;
  else if (scr === 1) body = html`<div id="cw-when">${whenCard(app, M)}</div><div id="cw-where">${whereCard(app, M)}</div>`;
  else if (scr === 2) body = tagsCard(app, M);
  else if (scr === FILM) {
    body = cw.legacyFilm && !scenesOf(cw).length
      ? html`${legacyNote(app, M)}${filmCard(app, M)}`
      : html`${filmEditorCard(app, M, setCw, { back: () => go(scr - 1), backLabel, next: () => go(scr + 1), nextLabel, canNext, blockedTip })}<div id="cw-filmmeta">${filmMetaCard(app, M)}</div>`;
  } else body = html`${checksCard(app, M)}${planningCard(app, M)}`;
  const nScreens = M.chosen.length + M.linkStores.length;
  const editorFoot = scr === FILM && !(cw.legacyFilm && !scenesOf(cw).length);
  const foot = cw.done || editorFoot ? null : html`
    <div class="cw-foot">
      <button type="button" class="btn" onClick=${() => (scr === 0 ? closeWizard(app) : go(scr - 1))}>${scr === 0 ? backLabel : `← ${backLabel}`}</button>
      ${scr < LAST ? html`<button type="button" class="btn btn--primary" disabled=${!canNext} title=${canNext ? '' : blockedTip} onClick=${() => go(scr + 1)}>${nextLabel} →</button>`
        : html`<span class="cw-foot__group">
            <button type="button" class="btn" disabled=${!!cw.busy} onClick=${() => saveDraftOnly(app, M)}>${cw.busy === 'save' ? T('cw.saving') : T('cw.saveDraft')}</button>
            <button type="button" class="btn" disabled=${!!cw.busy} onClick=${() => viewFilm(app, M)}>${T('cw.viewFilm')} ↗</button>
            <button type="button" class="btn btn--primary" disabled=${!!cw.busy || !nScreens} onClick=${() => diffuse(app, M)}>${cw.busy === 'diffuse' ? T('cw.diffusing') : T('cw.diffuseN', { n: nScreens })}</button>
          </span>`}
    </div>`;
  const aside = scr === FILM && !cw.done && !(cw.legacyFilm && !scenesOf(cw).length) ? filmEditorPanel(app, M, setCw, (l, f) => nlChip(M, l, f)) : sidePanel(app, M, scr);
  return html`
    <div class=${'cw' + (scr === FILM ? ' cw--film' : '')}>
      <div class="cw-head">${stepper}</div>
      <div class="cw-body">
        <div class="cw-main">${body}${cw.error ? html`<div class="cw-note cw-note--err">${cw.error}</div>` : ''}${blockedNote}${foot}</div>
        <aside class="cw-side">${aside}</aside>
      </div>
      ${cw.branche ? brancheModal(app, M) : ''}
    </div>`;
}

// État du néerlandais d'un texte de scène (circuit des Traductions).
function nlChip(M, l, f) {
  const { cw, T } = M;
  const typed = String(((cw.nl || {})[l.id] || {})[f] || '').trim();
  const x = ((cw.tr || {}).scene || {})[`${l.id}:${f}`];
  if (x && x.translation && x.translation.status === 'valide' && (!typed || typed === x.translation.text)) return chip(T('cw.nl.valid'), 'ok');
  if (typed) return chip(T('cw.nl.typed'), 'ok');
  if (x && x.translation) return chip(T('cw.nl.proposed'), 'gold');
  return chip(T('cw.nl.todo'), 'gold');
}

// Sous l'éditeur : le nom du film, la vidéo d'ouverture, le néerlandais.
function filmMetaCard(app, M) {
  const { cw, T } = M;
  const tr = cw.tr || {};
  const pending = Object.values(tr.scene || {}).some((x) => x.translation && x.translation.status === 'propose');
  return card('', T('fe.meta.title'), '', html`
    <div class="cw-row2">
      <label class="cw-field"><span>${T('fe.meta.name')}</span><input class="cw-input" value=${cw.titleFr} onInput=${(e) => setCw(app, { titleFr: e.target.value })} /></label>
      <div class="cw-field"><span>${T('cw.film.nl')}</span>
        <span class="cw-inline">
          <button type="button" class="btn btn--sm" disabled=${cw.trBusy} title=${tr.claude && tr.claude.configured === false ? T('cw.nl.noKey') : T('cw.nl.proposeTip')} onClick=${() => proposeNl(app, M)}>${cw.trBusy ? T('cw.nl.proposing') : T('cw.nl.propose')}</button>
          ${pending ? html`<button type="button" class="btn btn--sm" onClick=${() => validateNl(app, M)}>${T('cw.nl.validate')}</button>` : ''}
        </span></div>
    </div>
    ${openingNote(app, M)}`);
}

function openingNote(app, M) {
  const { cw, T } = M;
  if (M.opening) {
    return html`<div class="cw-note">
      <span>${T('cw.film.mediaFound', { f: M.opening.filename })}</span>
      <span class="cw-foot__group">
        ${M.media.length > 1 ? html`<select class="cw-input cw-input--sm" value=${M.opening.id} onChange=${(e) => setCw(app, { opening: e.target.value, openingOff: false })}>${M.media.map((x) => html`<option value=${x.m.id}>${x.m.filename}</option>`)}</select>` : ''}
        <button type="button" class="btn btn--sm btn--ghost" onClick=${() => setCw(app, { openingOff: true })}>${T('cw.film.noOpening')}</button>
      </span></div>`;
  }
  return cw.openingOff && M.media.length ? html`<div class="cw-note"><button type="button" class="btn btn--sm" onClick=${() => setCw(app, { openingOff: false })}>${T('cw.film.addOpening')}</button></div>` : '';
}

// Film repris d'avant l'éditeur : il garde son modèle ; « Composer en scènes »
// passe à l'éditeur.
function legacyNote(app, M) {
  const { T } = M;
  return html`<div class="cw-note cw-note--acc">
    <span>${T('fe.legacy')}</span>
    <button type="button" class="btn btn--sm" onClick=${() => setCw(app, { legacyFilm: false, scenes: seedScenes(M), sceneIdx: 0, layerId: '' })}>${T('fe.legacyGo')}</button>
  </div>`;
}

function closeWizard(app) { app.setState({ cw: null }); app.goView('home'); }

const card = (n, title, aside, content) => html`
  <section class="cw-card">
    <div class="cw-card__head"><span class="cw-card__title">${n ? `${n} · ` : ''}${title}</span>${aside ? html`<span class="cw-card__aside">${aside}</span>` : ''}</div>
    ${content}
  </section>`;
const chip = (text, tone = '') => html`<span class=${'cw-chip' + (tone ? ' cw-chip--' + tone : '')}>${text}</span>`;
const box = (on) => html`<span class=${'cw-box' + (on ? ' is-on' : '')} aria-hidden="true">${on ? '✓' : ''}</span>`;

// --- 1 · Campagne -----------------------------------------------------------
function campaignCard(app, M) {
  const { cw, T, lang } = M;
  const mk = cw.mk || {};
  const d = cw.detail;
  const resume = cw.resumeOf ? (app.state.playlists || []).find((p) => p.id === cw.resumeOf) : null;
  let head;
  if (mk.loading) head = html`<div class="cw-note">${T('cw.mk.loading')}</div>`;
  else if (!mk.ok) head = html`<div class="cw-note cw-note--warn">${T('cw.mk.down')} <span class="cw-muted">· ${mk.error || ''}</span></div>`;
  else if (!(mk.current || []).length) head = html`<div class="cw-note">${T('cw.mk.noneCurrent')}</div>`;
  const sel = cw.campaignId && cw.campaignId !== 'libre' ? [...(mk.current || []), ...(mk.upcoming || [])].find((c) => c.id === cw.campaignId) : null;
  const c = d && d.ok && d.campaign ? d.campaign : sel;
  const now = todayIso();
  const big = c ? html`
    <div class="cw-camp is-on">
      <div class="cw-camp__img">${c.imageUrl ? html`<img src=${c.imageUrl} alt="" />` : html`<span class="cw-muted">${T('cw.noVisual')}</span>`}</div>
      <div class="cw-camp__txt">
        ${c.phase === 'current' && c.startsOn && c.endsOn ? chip(T('cw.camp.currentDay', { j: daysBetween(c.startsOn, now) + 1, n: daysBetween(c.startsOn, c.endsOn) + 1 }), 'ok')
          : c.phase === 'upcoming' ? chip(T('cw.camp.startsOn', { d: fmtDay(c.startsOn, lang) }), 'gold') : ''}
        <h3>${c.name}</h3>
        ${d && d.ok && d.campaign ? html`<p class="cw-muted">${[d.campaign.objective && T('cw.camp.objective', { o: d.campaign.objective }), d.campaign.offer && d.campaign.offer.title && T('cw.camp.offer', { o: d.campaign.offer.title }), d.campaign.imageUrl && T('cw.camp.visual')].filter(Boolean).join(' · ')}</p>` : ''}
        <div class="cw-chips">
          ${c.startsOn ? chip(`${fmtDay(c.startsOn, lang)} → ${fmtDay(c.endsOn, lang) || '…'}`) : ''}
          ${d && d.ok ? (d.campaign.allShops ? chip(T('cw.camp.allShops')) : (d.stores || []).map((s) => chip(s.name))) : ''}
          ${d && d.ok && (d.storesUnmatched || []).map((s) => html`<span class="cw-chip cw-chip--warn" title=${T('cw.unmatchedStoreTip')}>${s.name} · ${T('cw.notLinked')}</span>`)}
          ${d && d.ok && d.production && d.production.screens ? chip(`${T('cw.camp.screensSection')} · ${T('cw.prodStatus.' + (['todo', 'doing', 'ready', 'validated'].includes(d.production.screens.status) ? d.production.screens.status : 'todo'))}`, 'acc') : ''}
        </div>
        ${cw.detailBusy ? html`<p class="cw-muted">${T('cw.mk.reading')}</p>` : ''}
        ${d && !d.ok ? html`<p class="cw-warn">${d.error}</p>` : ''}
        ${d && d.ok && (d.warnings || []).length ? html`<p class="cw-muted cw-small" title=${d.warnings.join('\n')}>${T('cw.mk.partial', { n: d.warnings.length })}</p>` : ''}
      </div>
    </div>` : null;
  const others = [...(mk.current || []).slice(1), ...(mk.upcoming || [])].filter((x) => x.id !== cw.campaignId);
  return card(1, T(c && c.phase === 'upcoming' ? 'cw.camp.chosen' : (c ? 'cw.camp.current' : 'cw.step.campaign')), mk.ok ? T('cw.camp.readMk') : '', html`
    ${head}
    ${resume ? html`<div class="cw-note cw-note--acc"><span>${T('cw.resume', { name: resume.name })}</span>
      <span class="cw-foot__group"><button type="button" class="btn btn--sm" onClick=${() => resumeFilm(app, resume.id)}>${T('cw.resumeBtn')}</button>
      <button type="button" class="btn btn--sm btn--ghost" onClick=${() => setCw(app, { resumeOf: null })}>${T('cw.resumeNew')}</button></span></div>` : ''}
    ${big}
    ${others.map((o) => html`<div class="cw-other" key=${o.id}>
      <span class=${'cw-dot' + (o.phase === 'upcoming' ? ' cw-dot--gold' : '')}></span><span>${o.name}</span>
      ${o.phase === 'upcoming' ? chip(T('cw.camp.startsOn', { d: fmtDay(o.startsOn, lang) }), 'gold') : chip(T('cw.camp.running'), 'ok')}
      <button type="button" class="btn btn--sm cw-other__r" onClick=${() => pickCampaign(app, o.id)}>${T('cw.choose')}</button></div>`)}
    <div class=${'cw-other' + (cw.campaignId === 'libre' ? ' is-on' : '')}>
      <span class="cw-dot cw-dot--grey"></span><span>${T('cw.free')}</span>
      <button type="button" class="btn btn--sm cw-other__r" onClick=${() => pickFree(app)}>${T('cw.choose')}</button></div>`);
}

// --- 2 · Produits (+ promotions) ---------------------------------------------
function productsCard(app, M) {
  const { cw, T } = M;
  if (!cw.campaignId) return null;
  const d = M.d;
  const stores = M.priceStores.slice(0, 6);
  const toggle = (id) => setCw(app, (c) => ({ products: c.products.includes(id) ? c.products.filter((x) => x !== id) : [...c.products, id] }));
  const sold = (p) => MOMENTS.filter((mo) => M.soldAt(p, mo));
  const soldLabel = (p) => { const s = sold(p); return s.length === 3 ? T('cw.allDay') : (s.length ? s.map((mo) => T('moment.' + mo)).join(' · ') : T('cw.neverSold')); };
  // Suggestions : même catégorie qu'un produit retenu, vendus, pas encore retenus.
  const selCats = new Set(M.selProds.map((p) => p.categoryId));
  const sugg = M.prods.filter((p) => p.active !== false && !p.unavailable && selCats.has(p.categoryId) && !cw.products.includes(p.id)).slice(0, 3);
  const row = (p, suggested) => html`
    <tr key=${p.id} class=${suggested ? 'is-sugg' : ''}>
      <td><button type="button" class="cw-tick" onClick=${() => toggle(p.id)} aria-pressed=${cw.products.includes(p.id) ? 'true' : 'false'}>${box(cw.products.includes(p.id))}</button></td>
      <td><img class="cw-pimg" src=${p.img} alt="" /></td>
      <td>${p.name}${suggested ? html` <span class="cw-muted cw-small">· ${T('cw.suggested')}</span>` : ''}</td>
      <td class="cw-muted">${M.catName.get(p.categoryId) || ''}</td>
      ${stores.length ? stores.map((s) => html`<td class="cw-price">${M.soldIn(p, s.id) ? eur(M.priceIn(p, s.id) || p.price) : html`<span class="cw-warn" title=${T('cw.notSoldTip', { s: s.store })}>— ${T('cw.notSold')}</span>`}</td>`) : html`<td class="cw-price">${eur(p.price)}</td>`}
      <td>${chip(soldLabel(p))}</td>
    </tr>`;
  const q = norm(cw.addQ);
  const addList = cw.addOpen ? M.prods.filter((p) => p.active !== false && !cw.products.includes(p.id) && (!q || norm(p.name).includes(q))).slice(0, 12) : [];
  const unmatched = d ? d.productsUnmatched || [] : [];
  return html`${card(2, T('cw.step.products'), d && d.campaign ? T('cw.prod.aside') : T('cw.prod.asideFree'), html`
    ${unmatched.length ? html`<div class="cw-note cw-note--warn">${T('cw.prod.unmatched', { n: unmatched.length })} ${unmatched.map((u) => html`<span class="cw-chip cw-chip--warn" title=${u.reason}>${u.label}</span>`)}</div>` : ''}
    <div class="cw-scroll"><table class="cw-table">
      <thead><tr><th></th><th></th><th>${T('cw.th.product')}</th><th>${T('cw.th.category')}</th>${stores.length ? stores.map((s) => html`<th>${s.store}</th>`) : html`<th>${T('cw.th.price')}</th>`}<th>${T('cw.th.sold')}</th></tr></thead>
      <tbody>${M.selProds.map((p) => row(p, false))}${sugg.map((p) => row(p, true))}</tbody>
    </table></div>
    ${!M.selProds.length ? html`<p class="cw-muted">${T('cw.prod.none')}</p>` : ''}
    <div class="cw-card__foot">
      <span class="cw-muted cw-small" title=${T('cw.prod.priceTip')}>${T('cw.prod.priceNote')}${app.state.catImport && app.state.catImport.at ? ` · ${String(app.state.catImport.at).slice(0, 10)}` : ''}</span>
      <button type="button" class="btn" onClick=${() => setCw(app, { addOpen: !cw.addOpen, addQ: '' })}>+ ${T('cw.prod.add')}</button>
    </div>
    ${cw.addOpen ? html`<div class="cw-add">
      <input class="cw-input" placeholder=${T('cw.prod.search')} value=${cw.addQ} onInput=${(e) => setCw(app, { addQ: e.target.value })} />
      <div class="cw-add__list">${addList.map((p) => html`<button type="button" class="cw-add__item" key=${p.id} onClick=${() => toggle(p.id)}><img class="cw-pimg" src=${p.img} alt="" /><span>${p.name}</span><span class="cw-muted">${M.catName.get(p.categoryId) || ''}</span></button>`)}</div>
    </div>` : ''}`)}
    ${promosCard(app, M)}`;
}

function promosCard(app, M) {
  const { cw, T } = M;
  const toggle = (k) => setCw(app, (c) => ({ promos: c.promos.includes(k) ? c.promos.filter((x) => x !== k) : [...c.promos, k] }));
  const L = (M.d && M.d.offerLinks) || {};
  const regieNames = new Set([...(app.state.bundles || []), ...(app.state.tfbPromos || [])].map((x) => norm(x.name)));
  const mkOnly = [...(L.promotions || []), ...(L.bundles || []).filter((b) => (b.items || []).length && norm(b.name) === norm(M.camp && M.camp.offer && M.camp.offer.title))]
    .filter((p) => !regieNames.has(norm(p.name)));
  return card('', T('cw.promo.title'), T('cw.promo.aside'), html`
    ${M.promoList.length ? html`<div class="cw-list">${M.promoList.map((p) => html`
      <button type="button" key=${p.key} class=${'cw-row' + (cw.promos.includes(p.key) ? ' is-on' : '')} onClick=${() => toggle(p.key)}>
        ${box(cw.promos.includes(p.key))}
        <span class="cw-row__main"><span>${p.name}</span><span class="cw-muted cw-small">${p.label}</span></span>
        ${M.offerKeys.has(p.key) ? chip(T('cw.promo.inOffer'), 'acc') : ''}
        ${chip(p.kind === 'bundle' ? T('cw.promo.bundle') : T('cw.promo.promo'))}
      </button>`)}</div>` : html`<p class="cw-muted">${T('cw.promo.none')}</p>`}
    ${mkOnly.length ? html`<div class="cw-note cw-note--warn">${T('cw.promo.mkOnly')} ${mkOnly.map((p) => chip(p.name, 'warn'))}</div>` : ''}`);
}

// --- 3 · Quand ---------------------------------------------------------------
function whenCard(app, M) {
  const { cw, T } = M;
  const setGrid = (d, i) => setCw(app, (c) => { const g = (c.gridTouched ? c.grid : M.gridOn).map((r) => r.slice()); g[d][i] = !g[d][i]; return { grid: g, gridTouched: true }; });
  const dayLbl = (d) => T('cw.day.' + d);
  const off = MOMENTS.filter((_, i) => !M.momentOk[i]);
  return card(3, T('cw.step.when'), M.camp ? T('cw.when.aside') : '', html`
    <div class="cw-row3">
      <label class="cw-field"><span>${T('cw.when.period')}</span>
        <span class="cw-inline"><input class="cw-input" type="date" value=${cw.from} onInput=${(e) => setCw(app, { from: e.target.value })} /> → <input class="cw-input" type="date" value=${cw.to} min=${cw.from} onInput=${(e) => setCw(app, { to: e.target.value })} /></span></label>
      <div class="cw-field"><span title=${T('cw.when.weekTip')}>${T('cw.when.week')}</span>
        <span class="cw-seg">${WEEKS.map((w) => html`<button type="button" key=${w} class=${cw.week === w ? 'is-on' : ''} onClick=${() => setCw(app, { week: w })}>${w}</button>`)}</span></div>
      <div class="cw-field"><span title=${T('cw.when.typeTip')}>${T('cw.when.type')}</span>
        <span class="cw-seg">${['continu', 'playlist'].map((md) => html`<button type="button" key=${md} class=${cw.mode === md ? 'is-on' : ''} onClick=${() => setCw(app, { mode: md })} title=${T('cw.mode.' + md + 'Tip')}>${T('cw.mode.' + md)}</button>`)}</span></div>
      <div class="cw-field"><span title=${T('cw.when.loopTip')}>${T('cw.when.loop')}</span>
        <span class="cw-seg">${RATIOS.map((r) => html`<button type="button" key=${r} disabled=${cw.mode !== 'continu'} title=${cw.mode !== 'continu' ? T('cw.when.loopOff') : ''} class=${cw.ratio === r && cw.mode === 'continu' ? 'is-on' : ''} onClick=${() => setCw(app, { ratio: r })}>1 / ${r}</button>`)}</span></div>
    </div>
    <div class="cw-scroll"><div class="cw-grid">
      <div></div>${DAYS.map((d) => html`<div class="cw-grid__h" key=${'h' + d}>${dayLbl(d)}</div>`)}
      ${MOMENTS.map((mo, i) => html`
        <div class="cw-grid__r">${T('moment.' + mo)}</div>
        ${DAYS.map((d) => {
          const can = M.momentOk[i];
          const on = M.gridOn[d][i];
          return html`<button type="button" key=${mo + d} class=${'cw-grid__c' + (on ? ' is-on' : '') + (!can ? ' is-off' : '')} disabled=${!can} title=${can ? '' : T('cw.when.offTip', { m: T('moment.' + mo) })} onClick=${() => setGrid(d, i)}>${on ? '✓' : '—'}</button>`;
        })}`)}
    </div></div>
    ${off.length ? html`<div class="cw-note">${T('cw.when.offNote', { m: off.map((mo) => T('moment.' + mo)).join(', ') })}</div>` : ''}`);
}

// --- 4 · Où ------------------------------------------------------------------
// Brancher l'écran d'un magasin : son lien (et son QR) à ouvrir en plein écran sur la TV ou
// la box du magasin, puis un test du lien. Fini : le magasin est coché.
function brancheModal(app, M) {
  const { cw, T } = M;
  const s = M.fleet.find((x) => x.id === cw.branche);
  if (!s) return '';
  const link = app.filmUrl({ store: s.id });
  const t = (app.state.onbTest || {})[s.id] || null;
  const fermer = () => setCw(app, { branche: '' });
  const fini = () => setCw(app, { branche: '', linkStores: [...new Set([...M.linkStores, s.id])], linkTouched: true });
  return html`<div class="cw-modal" onClick=${(e) => { if (e.target === e.currentTarget) fermer(); }}>
    <div class="cw-modal__box" role="dialog" aria-label=${T('cw.br.title', { s: s.store })}>
      <div class="cw-modal__h"><span>${T('cw.br.title', { s: s.store })}</span><button type="button" class="btn btn--sm" onClick=${fermer}>✕</button></div>
      <ol class="cw-br">
        <li><b>${T('cw.br.s1')}</b>
          <div class="cw-br__lien">
            <img src=${'data:image/svg+xml;utf8,' + encodeURIComponent(qrSvg(link, { scale: 5, margin: 2 }))} alt="QR" />
            <div class="cw-br__url">
              <input class="cw-input" readonly value=${link} onClick=${(e) => e.target.select()} />
              <span><button type="button" class="btn btn--sm" onClick=${() => app.copyLink(link)}>${T('cw.br.copy')}</button>
              <a class="btn btn--sm" href=${link} target="_blank" rel="noopener">${T('cw.br.openLink')} ↗</a></span>
              <span class="cw-muted cw-small">${T('cw.br.s1Tip')}</span>
            </div>
          </div></li>
        <li><b>${T('cw.br.s2')}</b>
          <div class="cw-br__test">
            <button type="button" class="btn btn--sm" onClick=${() => app.onbTestStore(s.id)}>${t && t.state === 'testing' ? T('cw.br.testing') : T('cw.br.test')}</button>
            ${t && t.state === 'ok' ? html`<span class="cw-ok">✓ ${T('cw.br.ok', { f: t.name, n: t.modules })}</span>` : ''}
            ${t && t.state === 'err' ? html`<span class="cw-warn">✗ ${t.error}</span>` : ''}
          </div></li>
        <li><b>${T('cw.br.s3')}</b></li>
      </ol>
      <div class="cw-modal__f">
        <button type="button" class="btn" onClick=${fermer}>${T('cw.br.later')}</button>
        <button type="button" class="btn btn--primary" onClick=${fini}>${T('cw.br.done')}</button>
      </div>
    </div>
  </div>`;
}

function whereCard(app, M) {
  const { cw, T } = M;
  const chosen = new Set(M.playerIds);
  const cur = M.playerIds;
  const togglePlayer = (id) => setCw(app, { players: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], playersTouched: true });
  const toggleStore = (s) => {
    const ids = (s.players || []).map((p) => p.id);
    const all = ids.length && ids.every((id) => cur.includes(id));
    setCw(app, { players: all ? cur.filter((x) => !ids.includes(x)) : [...new Set([...cur, ...ids])], playersTouched: true });
  };
  const toggleLink = (id) => { const l = M.linkStores; setCw(app, { linkStores: l.includes(id) ? l.filter((x) => x !== id) : [...l, id], linkTouched: true }); };
  const stores = [...M.fleet].sort((a, b) => Number(M.campStores.has(b.id)) - Number(M.campStores.has(a.id)));
  const ago = (p) => { const s = p.syncAgo; if (s == null || s >= 999999) return T('cw.where.never'); const dd = Math.floor(s / 86400); return dd >= 1 ? T('cw.where.offDays', { n: dd }) : T('cw.where.offHours', { n: Math.max(1, Math.floor(s / 3600)) }); };
  return card(4, T('cw.step.where'), M.camp ? T('cw.where.aside') : '', html`
    ${!stores.length ? html`<div class="cw-note cw-note--warn">${T('cw.blk.noFleet')}</div>` : ''}
    <div class="cw-stores">
      ${stores.map((s) => {
        const ps = s.players || [];
        const lien = !ps.length;
        const on = lien ? M.linkSet.has(s.id) : ps.every((p) => chosen.has(p.id));
        const some = lien ? on : ps.some((p) => chosen.has(p.id));
        const basculer = () => (lien ? toggleLink(s.id) : toggleStore(s));
        const onlineN = ps.filter((p) => p.state !== 'offline').length;
        const groupOf = (gid) => (s.groups || []).find((g) => g.id === gid);
        return html`<div class=${'cw-store' + (some ? ' is-on' : '')} key=${s.id}>
          <div class="cw-store__h">
            <button type="button" class="cw-tick" onClick=${basculer}>${box(on)}</button>
            <span class="cw-store__name" role="button" style="cursor:pointer" onClick=${basculer}>${s.store}</span>
            ${M.d && !M.campStores.has(s.id) ? chip(T('cw.where.outside')) : ''}
            ${s.lang === 'nl' ? chip('NL') : ''}
            ${ps.length ? chip(T('cw.where.online', { a: onlineN, b: ps.length }), onlineN === ps.length ? 'ok' : 'gold') : chip(T('cw.where.byLink'))}
          </div>
          ${lien ? html`<div class="cw-store__vide"><span>${T('cw.where.byLinkTip')}</span>
            <button type="button" class="btn btn--sm" onClick=${() => { setCw(app, { branche: s.id }); app.onbTestStore(s.id); }}>${T('cw.br.open')} →</button></div>` : ''}
          ${ps.map((p) => {
            const g = groupOf(p.groupId);
            const fmt = g ? g.format : s.format;
            const orient = fmt && fmt.orient ? fmt.orient : orientOf(p);
            const where = g ? ((g.cats || []).length && g.filter_cats !== 0 ? T('cw.where.zoneOwn', { z: g.name }) : T('cw.where.zone', { z: g.name })) : T('cw.where.storeFilm');
            return html`<div class="cw-scr" key=${p.id}>
              <button type="button" class="cw-tick" onClick=${() => togglePlayer(p.id)}>${box(chosen.has(p.id))}</button>
              <i class=${'cw-ico' + (orient === 'portrait' ? ' cw-ico--p' : '')}></i>
              <span>${p.name}${fmt ? ` · ${fmt.size}″ ${T('cw.orient.' + orient)}` : ''}</span>
              <span class="cw-scr__r">${p.state === 'offline' ? html`<span class="cw-warn">${ago(p)}</span>` : chip(where)}</span>
            </div>`;
          })}
        </div>`;
      })}
    </div>
    ${(M.d && M.d.storesUnmatched || []).length ? html`<div class="cw-note cw-note--warn">${T('cw.where.unmatched')} ${M.d.storesUnmatched.map((s) => chip(s.name, 'warn'))}</div>` : ''}
    <div class="cw-note">${T('cw.where.sum', { n: M.chosen.length + M.linkStores.length, p: M.portraitN })}</div>`);
}

// --- 5 · Catégorie et tags ---------------------------------------------------
function tagsCard(app, M) {
  const { cw, T } = M;
  const setTags = (list) => setCw(app, { tags: list, tagsTouched: true });
  const add = (t) => { const s = slug(t); if (s && !M.tags.includes(s)) setTags([...M.tags, s]); };
  return card(5, T('cw.tags.title'), T('cw.tags.aside'), html`
    <div class="cw-field"><span>${T('cw.tags.cat')}</span>
      <span class="cw-chips">${CATS.map((c) => html`<button type="button" key=${c} class=${'cw-pick' + (cw.cat === c ? ' is-on' : '')} onClick=${() => setCw(app, { cat: c })}>${T('cw.cat.' + c)}</button>`)}</span></div>
    <div class="cw-field"><span>${T('cw.tags.proposed')}</span>
      <span class="cw-chips">
        ${M.tags.map((t) => html`<button type="button" key=${t} class="cw-pick is-on" onClick=${() => setTags(M.tags.filter((x) => x !== t))} title=${T('cw.tags.remove')}>${t} ×</button>`)}
        ${M.sugg.map((t) => html`<button type="button" key=${'s' + t} class="cw-pick" onClick=${() => add(t)}>+ ${t}</button>`)}
        <input class="cw-input cw-input--sm" placeholder=${'+ ' + T('cw.tags.add')} value=${cw.tagInput}
          onInput=${(e) => setCw(app, { tagInput: e.target.value })}
          onKeyDown=${(e) => { if (e.key === 'Enter' && cw.tagInput.trim()) { add(cw.tagInput); setCw(app, { tagInput: '' }); } }} />
      </span></div>`);
}

// --- 6 · Film ----------------------------------------------------------------
function filmCard(app, M) {
  const { cw, T } = M;
  const visual = M.camp && (M.camp.imageUrl || (M.camp.offer && M.camp.offer.imageUrl));
  const tr = cw.tr || {};
  const trState = (x, val) => {
    if (!x) return val ? chip(T('cw.nl.typed'), 'ok') : chip(T('cw.nl.todo'), 'gold');
    if (x.fromErp) return chip(T('cw.nl.erp'), 'ok');
    if (x.translation && x.translation.status === 'valide') return chip(T('cw.nl.valid'), 'ok');
    if (x.translation) return chip(T('cw.nl.proposed'), 'gold');
    return chip(T('cw.nl.todo'), 'gold');
  };
  const proposedPending = (tr.name && tr.name.translation && tr.name.translation.status === 'propose') || (tr.tag && tr.tag.translation && tr.tag.translation.status === 'propose');
  const tplDisabled = (t) => (t === 'photo' && !visual) || (t !== 'photo' && !cw.products.length);
  return card(6, T('cw.film.title'), T('cw.film.aside'), html`
    <div class="cw-tpl">
      ${TEMPLATES.map((t) => html`<button type="button" key=${t} class=${'cw-tpl__i' + (cw.template === t ? ' is-on' : '')} disabled=${tplDisabled(t)} title=${tplDisabled(t) ? T('cw.tpl.' + t + 'Off') : ''} onClick=${() => setCw(app, { template: t })}>
        <span class=${'cw-tpl__mini cw-tpl__mini--' + t}>${t === 'photo' && visual ? html`<img src=${visual} alt="" />` : ''}</span>${T('cw.tpl.' + t)}</button>`)}
    </div>
    <div class="cw-row2">
      <label class="cw-field"><span>${T('cw.film.titleFr')}</span><input class="cw-input" value=${cw.titleFr} onInput=${(e) => setCw(app, { titleFr: e.target.value })} /></label>
      <label class="cw-field"><span>${T('cw.film.titleNl')} ${cw.template !== 'photo' ? trState(tr.name, cw.titleNl) : ''}</span><input class="cw-input" value=${cw.titleNl} disabled=${cw.template === 'photo'} title=${cw.template === 'photo' ? T('cw.nl.photoTip') : ''} onInput=${(e) => setCw(app, { titleNl: e.target.value })} /></label>
      <label class="cw-field"><span>${T('cw.film.hook')}</span><input class="cw-input" value=${cw.hookFr} onInput=${(e) => setCw(app, { hookFr: e.target.value })} /></label>
      <label class="cw-field"><span>${T('cw.film.hookNl')} ${cw.template !== 'photo' && cw.hookFr ? trState(tr.tag, cw.hookNl) : ''}</span><input class="cw-input" value=${cw.hookNl} disabled=${cw.template === 'photo' || !cw.hookFr} onInput=${(e) => setCw(app, { hookNl: e.target.value })} /></label>
      <div class="cw-field"><span>${T('cw.film.dur')}</span>
        <span class="cw-seg">${DURS.map((dd) => html`<button type="button" key=${dd} class=${cw.dur === dd ? 'is-on' : ''} onClick=${() => setCw(app, { dur: dd })}>${dd} s</button>`)}</span></div>
      <div class="cw-field"><span>${T('cw.film.nl')}</span>
        <span class="cw-inline">
          <button type="button" class="btn btn--sm" disabled=${cw.trBusy || cw.template === 'photo'} title=${tr.claude && tr.claude.configured === false ? T('cw.nl.noKey') : T('cw.nl.proposeTip')} onClick=${() => proposeNl(app, M)}>${cw.trBusy ? T('cw.nl.proposing') : T('cw.nl.propose')}</button>
          ${proposedPending ? html`<button type="button" class="btn btn--sm" onClick=${() => validateNl(app, M)}>${T('cw.nl.validate')}</button>` : ''}
        </span></div>
    </div>
    ${M.opening ? html`<div class="cw-note">
        <span>${T('cw.film.mediaFound', { f: M.opening.filename })}</span>
        <span class="cw-foot__group">
          ${M.media.length > 1 ? html`<select class="cw-input cw-input--sm" value=${M.opening.id} onChange=${(e) => setCw(app, { opening: e.target.value, openingOff: false })}>${M.media.map((x) => html`<option value=${x.m.id}>${x.m.filename}</option>`)}</select>` : ''}
          <button type="button" class="btn btn--sm btn--ghost" onClick=${() => setCw(app, { openingOff: true })}>${T('cw.film.noOpening')}</button>
        </span></div>`
      : (cw.openingOff && M.media.length ? html`<div class="cw-note"><button type="button" class="btn btn--sm" onClick=${() => setCw(app, { openingOff: false })}>${T('cw.film.addOpening')}</button></div>` : '')}`);
}

// --- 7 · Diffuser ------------------------------------------------------------
function checks(app, M) {
  const { cw, T, lang } = M;
  const out = [];
  const stores = M.storesChosen;
  const missing = [];
  for (const p of M.selProds) for (const s of stores) if (M.priced(p) && !M.soldIn(p, s.id)) missing.push({ p, s });
  const noPrice = M.selProds.filter((p) => !M.priced(p));
  const ci = app.state.catImport;
  out.push(noPrice.length
    ? { ok: false, text: T('cw.chk.noPrice', { n: noPrice.length }), sub: noPrice.map((p) => p.name).join(', ') }
    : { ok: true, text: T('cw.chk.prices', { n: stores.length }), sub: ci && ci.at ? T('cw.chk.readAt', { d: String(ci.at).slice(0, 16).replace('T', ' ') }) : '' });
  if (M.nlStores.length && scenesOf(cw).length) {
    // Film en scènes : chaque texte (et chaque promo) a son néerlandais saisi ou validé.
    const tr = (cw.tr || {}).scene || {};
    const missing = [];
    for (const sc of scenesOf(cw)) {
      for (const l of sc.layers) {
        const f = l.kind === 'text' ? 'text' : l.kind === 'price' && l.promo ? 'promo' : '';
        if (!f || !String(l[f] || '').trim()) continue;
        const typed = String(((cw.nl || {})[l.id] || {})[f] || '').trim();
        const x = tr[`${l.id}:${f}`];
        if (!typed && !(x && x.translation && x.translation.status === 'valide')) missing.push(l[f].split('\n')[0]);
      }
    }
    const s = M.nlStores.map((x) => x.store).join(', ');
    out.push(missing.length ? { ok: false, text: T('cw.chk.nlKo', { s }), sub: missing.join(' · ') } : { ok: true, text: T('cw.chk.nlOk', { s }) });
  } else if (M.nlStores.length && cw.template !== 'photo') {
    const tr = cw.tr || {};
    const ok = (x, typed) => !!typed || (x && (x.fromErp || (x.translation && x.translation.status === 'valide')));
    const good = ok(tr.name, cw.titleNl) && (!cw.hookFr || ok(tr.tag, cw.hookNl));
    out.push({ ok: good, text: good ? T('cw.chk.nlOk', { s: M.nlStores.map((s) => s.store).join(', ') }) : T('cw.chk.nlKo', { s: M.nlStores.map((s) => s.store).join(', ') }) });
  }
  for (const x of missing) out.push({ ok: true, text: T('cw.chk.removed', { p: x.p.name, s: x.s.store }), sub: T('cw.chk.notSoldHere') });
  for (const p of M.offline) out.push({ ok: false, text: T('cw.chk.offline', { s: p.storeName, p: p.name }), sub: T('cw.chk.offlineSub') });
  const unP = (M.d && M.d.productsUnmatched) || [];
  if (unP.length) out.push({ ok: false, text: T('cw.prod.unmatched', { n: unP.length }), sub: unP.map((u) => u.label).join(', ') });
  const unS = (M.d && M.d.storesUnmatched) || [];
  if (unS.length) out.push({ ok: false, text: T('cw.where.unmatched'), sub: unS.map((u) => u.name).join(', ') });
  out.push(cw.to ? { ok: true, text: T('cw.chk.end', { d: fmtDay(cw.to, lang) }) } : { ok: false, text: T('cw.chk.noEnd') });
  if (cw.from && cw.from > todayIso()) out.push({ ok: true, text: T('cw.chk.start', { d: fmtDay(cw.from, lang) }) });
  return out;
}
function checksCard(app, M) {
  const { T } = M;
  return card(7, T('cw.chk.title'), '', html`<div>${checks(app, M).map((c, i) => html`
    <div class="cw-check" key=${i}><span class=${c.ok ? 'cw-ok' : 'cw-warn'}>${c.ok ? '✓' : '!'}</span><span>${c.text}${c.sub ? html` <span class="cw-muted cw-small">— ${c.sub}</span>` : ''}</span></div>`)}</div>`);
}

function planningCard(app, M) {
  const { cw, T, st } = M;
  const p0 = M.chosen[0];
  if (!p0) return null;
  const sid = p0.storeId;
  const dayIdx = Math.max(0, M.daysOn.indexOf(true));
  const plan = ((st.planByStore || {})[sid] || {})[cw.week] || {};
  const cell = plan[dayIdx] || {};
  const films = new Map((st.playlists || []).map((f) => [f.id, f.name]));
  const wins = (st.planWindows && st.planWindows.length) ? st.planWindows : MOMENTS.map((id) => ({ id, from: '', to: '' }));
  const title = cw.titleFr || (M.camp && M.camp.name) || T('cw.untitled');
  return card('', T('cw.plan.title', { w: cw.week, d: T('cw.day.' + dayIdx) }), `${p0.storeName} · ${p0.name}`, html`
    <div class="cw-scroll"><div class="cw-timeline">${wins.map((w, i) => {
      const mine = M.gridOn[dayIdx][MOMENTS.indexOf(w.id)];
      const names = (cell[w.id] || []).map((id) => films.get(id) || id).filter((n) => n !== title);
      return html`<div key=${w.id} class=${'cw-tl' + (mine ? ' is-on' : '')}>
        <span class="cw-tl__h">${w.from ? `${w.from}–${w.to}` : ''} · ${T('moment.' + w.id)}</span>
        ${names.map((n) => html`<span class="cw-muted">${n}</span>`)}
        ${mine ? html`<span>${title}${cw.mode === 'continu' ? ` · 1/${cw.ratio}` : ''}</span>` : ''}
        ${!mine && !names.length ? html`<span class="cw-muted">${T('cw.plan.storeFilm')}</span>` : ''}
      </div>`;
    })}</div></div>`);
}

function doneScreen(app, M) {
  const { cw, T, lang } = M;
  const d = cw.done;
  const ready = cw.ready;
  return card('', T('cw.done.title'), '', html`
    <p>${T('cw.done.sum', { name: d.name, v: d.version, n: (d.players || []).length, ok: d.testsOk, t: d.testsTotal })}</p>
    ${d.scheduled ? html`<p class="cw-muted">${T('cw.done.scheduled', { d: fmtDay(cw.from, lang) })}</p>` : ''}
    ${d.endsAt ? html`<p class="cw-muted">${T('cw.done.ends', { d: fmtDay(cw.to, lang) })}</p>` : ''}
    ${d.planCells ? html`<p class="cw-muted">${T('cw.done.plan', { n: d.planCells, w: cw.week })}</p>` : ''}
    ${ready ? html`<p class=${ready.ok ? 'cw-ok' : 'cw-warn'}>${ready.ok ? T('cw.done.ready') : (ready.missing ? T('cw.done.noSection') : `${T('cw.done.readyKo')} · ${ready.error}`)}</p>` : ''}
    <div class="cw-foot">
      <span class="cw-foot__group">
        <button type="button" class="btn btn--primary" onClick=${() => app.openReport()}>${T('cw.done.report')}</button>
        <a class="btn" href=${d.url} target="_blank" rel="noopener">${T('cw.viewFilm')} ↗</a>
      </span>
      <button type="button" class="btn" onClick=${() => closeWizard(app)}>${T('cw.done.close')}</button>
    </div>`);
}

// --- colonne de droite ---------------------------------------------------------
function sidePanel(app, M, scr) {
  const { cw, T, lang } = M;
  const m = cw.campaignId ? previewModule(app, M) : null;
  const w = Math.max(220, Math.min(330, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 96));
  const both = scr === 2 || scr === FILM;
  const sumRows = [
    [T('cw.sum.campaign'), M.camp ? M.camp.name : (cw.campaignId === 'libre' ? T('cw.free') : '—')],
    [T('cw.sum.products'), M.selProds.length ? T('cw.sum.productsV', { n: M.selProds.length }) : '—'],
    [T('cw.sum.period'), cw.from ? `${fmtDay(cw.from, lang)} → ${cw.to ? fmtDay(cw.to, lang) : '…'}` : '—'],
    [T('cw.sum.moments'), M.momentsOn.map((mo) => T('moment.' + mo)).join(' · ') || '—'],
    [T('cw.sum.stores'), T('cw.sum.storesV', { s: M.storesChosen.length, n: M.chosen.length })],
    [T('cw.sum.tags'), M.tags.slice(0, 4).join(', ') || '—'],
    [T('cw.sum.duration'), `${scenesOf(cw).length ? Math.round(scenesDuration(scenesOf(cw))) : cw.dur} s${cw.mode === 'continu' ? ` · ${T('cw.sum.loop', { r: cw.ratio })}` : ` · ${T('cw.mode.playlist')}`}`],
  ];
  const stores = M.storesChosen;
  return html`
    <section class="cw-card cw-card--side">
      <div class="cw-card__head"><span class="cw-card__title">${scr === LAST ? T('cw.side.summary') : (both ? T('cw.side.both') : T('cw.side.live'))}</span></div>
      ${stores.length > 1 ? html`<select class="cw-input cw-input--sm cw-side__store" value=${cw.previewStore || stores[0].id} onChange=${(e) => setCw(app, { previewStore: e.target.value })} title=${T('cw.side.storeTip')}>${stores.map((s) => html`<option value=${s.id}>${s.store}</option>`)}</select>` : ''}
      ${stage(m, w, false)}
      ${both ? html`<div class="cw-side__p">${stage(m, 120, true)}<p class="cw-muted cw-small">${T('cw.side.portraitNote')}</p></div>` : ''}
      <dl class="cw-sum">${sumRows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    </section>`;
}
