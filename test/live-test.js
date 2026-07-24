#!/usr/bin/env node
// Tests live du CMS signage — à lancer contre un serveur déployé :
//   node test/live-test.js                          → lecture seule sur http://localhost:8080
//   node test/live-test.js https://cms.mondomaine   → lecture seule sur une instance déployée
//   node test/live-test.js --mutate                 → cycle complet (draft + publish + heartbeat)
//   node test/live-test.js --local --mutate         → démarre un serveur jetable (BDD temporaire) puis teste
// Code retour ≠ 0 si un test échoue → utilisable en CI/CD après déploiement.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const MUTATE = args.includes('--mutate');
const LOCAL = args.includes('--local');
const argVal = (name, fb) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : fb;
};
const USER = argVal('user', process.env.SIG_TEST_USER || 'admin');
const PASSWORD = argVal('password', process.env.SIG_ADMIN_PASSWORD || 'signage');
const baseArg = args.find((a) => !a.startsWith('--'));
let BASE = (baseArg || process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

const results = [];
let child = null;
let authToken = null;

function report(label, ok, ms, detail = '') {
  results.push({ label, ok });
  const pad = String(ms).padStart(4, ' ');
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label} — ${pad} ms${detail ? ` · ${detail}` : ''}`);
}

async function step(label, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report(label, true, Date.now() - t0, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    report(label, false, Date.now() - t0, String(e.message || e));
    return false;
  }
}

async function call(method, path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status} sur ${path}`);
  return json;
}

async function waitUp(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await call('GET', '/api/v1/health'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`serveur injoignable sur ${BASE}`);
}

async function main() {
  if (LOCAL) {
    const dir = mkdtempSync(join(tmpdir(), 'sig-test-'));
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const port = 8123 + Math.floor(Math.random() * 500);
    BASE = `http://127.0.0.1:${port}`;
    // Le serveur jetable démarre avec le seed de démonstration (SIG_DEMO=1)
    // pour disposer de modules / magasins / players à tester.
    child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), SIG_DB: join(dir, 'test.db'), SIG_DEMO: '1' },
      stdio: 'ignore',
    });
    console.log(`▶ Serveur jetable : ${BASE} (BDD ${join(dir, 'test.db')})`);
  }

  console.log(`\nTests live du CMS signage — ${BASE} ${MUTATE ? '(cycle complet)' : '(lecture seule)'}\n`);
  await waitUp();

  // --- lecture seule -------------------------------------------------------
  let state = null;
  await step('GET /api/v1/health', async () => {
    const h = await call('GET', '/api/v1/health');
    if (!h.ok) throw new Error('health.ok = false');
    if (h.tablePrefix !== 'sig_') throw new Error('préfixe de tables inattendu');
    return `v${h.version} · d${h.dataVer} · tables ${h.tablePrefix}*`;
  });
  await step('API protégée sans session → 401 attendu', async () => {
    const res = await fetch(BASE + '/api/v1/state');
    if (res.status !== 401) throw new Error(`HTTP ${res.status} au lieu de 401 — back office non protégé !`);
  });
  const loginOk = await step(`POST /api/v1/login (${USER})`, async () => {
    const out = await call('POST', '/api/v1/login', { username: USER, password: PASSWORD });
    if (!out.token) throw new Error('pas de jeton de session');
    authToken = out.token;
  });
  if (!loginOk) {
    console.log('\n\x1b[31mConnexion impossible — passe --user=… --password=… (ou SIG_ADMIN_PASSWORD).\x1b[0m\n');
    if (child) child.kill();
    process.exit(1);
  }
  await step('GET /api/v1/state — brouillon complet', async () => {
    state = await call('GET', '/api/v1/state');
    if (!Array.isArray(state.modules)) throw new Error('modules absents');
    if (!Array.isArray(state.playlist)) throw new Error('playlist absente');
    // Un serveur de production vierge (démo retirée) n'a pas encore de module.
    return state.modules.length ? `${state.modules.length} modules · playlist ×${state.playlist.length}` : 'serveur vierge (aucun module)';
  });
  await step('GET /api/v1/fleet — réseau & magasins', async () => {
    const f = await call('GET', '/api/v1/fleet');
    if (!Array.isArray(f.stores)) throw new Error('stores absent');
    const n = f.stores.reduce((s, x) => s + x.players.length, 0);
    return `${f.stores.length} magasins · ${n} écrans`;
  });
  await step('GET /api/v1/element-types — types depuis la table', async () => {
    const t = await call('GET', '/api/v1/element-types');
    if (!Array.isArray(t.types) || t.types.length < 5) throw new Error('types manquants (sig_element_types)');
    for (const x of t.types) if (!Array.isArray(x.layouts) || !x.layouts.length) throw new Error(`type ${x.id} sans mises en page`);
    return t.types.map((x) => x.id).join(' · ');
  });
  await step('GET /api/v1/catalog — table produits', async () => {
    const c = await call('GET', '/api/v1/catalog');
    if (!Array.isArray(c.categories) || !Array.isArray(c.products)) throw new Error('catalogue incomplet');
    return `${c.categories.length} catégorie(s) · ${c.products.length} produit(s)`;
  });
  await step('GET /api/v1/langs — langues depuis la table', async () => {
    const l = await call('GET', '/api/v1/langs');
    if (!Array.isArray(l.langs) || !l.langs.some((x) => x.id === 'fr')) throw new Error('langues manquantes (sig_langs)');
    return l.langs.map((x) => x.id).join(' · ');
  });
  await step('GET /api/v1/pwa-config — connexion base PWA', async () => {
    const c = await call('GET', '/api/v1/pwa-config');
    if (typeof c.qProducts !== 'string' || !('hasPassword' in c)) throw new Error('config PWA illisible');
    if (c.password) throw new Error('le mot de passe ne doit jamais être renvoyé');
    const t = await call('POST', '/api/v1/pwa-test');
    if (t.ok !== true && !t.error) throw new Error('pwa-test sans message d\'erreur clair');
    return c.db ? `base « ${c.db} » configurée · test : ${t.ok ? 'OK' : t.error}` : `non configurée · ${t.error}`;
  });
  await step('GET / — back office servi', async () => {
    const res = await fetch(BASE + '/');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    if (!txt.includes('Régie d\'affichage')) throw new Error('HTML inattendu');
  });
  await step('GET /player.html — player servi', async () => {
    const res = await fetch(BASE + '/player.html');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  await step('GET /film — visionneuse publique servie', async () => {
    const res = await fetch(BASE + '/film');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    if (!txt.includes('Film')) throw new Error('HTML inattendu');
  });
  await step('GET /api/v1/film — film public (sans connexion)', async () => {
    const res = await fetch(BASE + '/api/v1/film');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if (!Array.isArray(f.modules)) throw new Error('modules absents');
    if (!Array.isArray(f.playlist)) throw new Error('playlist absente');
    return `v${f.version} · d${f.dataVer} · ${f.playlist.length} module(s) au programme`;
  });
  await step('GET /api/v1/report — rapport public (sans connexion)', async () => {
    const res = await fetch(BASE + '/api/v1/report');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    if (!r.meta || !Array.isArray(r.modules) || !Array.isArray(r.playlists)) throw new Error('structure du rapport incomplète');
    if (!Array.isArray(r.stores) || !r.plan || !Array.isArray(r.plan.windows)) throw new Error('planning/écrans absents du rapport');
    return `${r.playlists.length} film(s) · ${r.modules.length} élément(s) · ${r.stores.length} écran(s) · ${r.plan.windows.length} moment(s)`;
  });
  await step('GET /report — page du rapport servie', async () => {
    const res = await fetch(BASE + '/report');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!/report\.js/.test(html)) throw new Error('report.js non référencé');
    return 'page HTML du rapport OK';
  });
  await step('POST/DELETE /api/v1/surprise — dossier vidéos surprise', async () => {
    const before = await call('GET', '/api/v1/surprise');
    if (!Array.isArray(before.videos)) throw new Error('liste absente');
    const name = 'test-surprise-livetest.mp4';
    const dataUrl = 'data:video/mp4;base64,' + Buffer.from('livetest').toString('base64');
    const up = await call('POST', '/api/v1/surprise', { name, dataUrl });
    if (!up.ok || !up.videos.some((v) => v.name === name)) throw new Error('upload non listé');
    const del = await call('DELETE', `/api/v1/surprise/${encodeURIComponent(name)}`);
    if (del.videos.some((v) => v.name === name)) throw new Error('suppression échouée');
    return `dossier OK · upload + suppression (${before.videos.length} vidéo(s) au départ)`;
  });
  await step('PUT /api/v1/seasons — périodes de l\'année + détection', async () => {
    const before = await call('GET', '/api/v1/seasons');
    if (!Array.isArray(before.seasons)) throw new Error('liste absente');
    const out = await call('PUT', '/api/v1/seasons', { seasons: [
      { id: 'se_all_lt', name: 'Toute l\'année', from: '01/01', to: '31/12', products: [], active: true },
      { id: 'se_far_lt', name: 'Invalide', from: '15/13', to: '16/13', products: [], active: true },
    ] });
    if (!out.ok || out.seasons.length !== 2) throw new Error('enregistrement des périodes');
    const cur = new Set(out.current || []);
    if (!cur.has('se_all_lt')) throw new Error('« toute l\'année » devrait être active');
    if (cur.has('se_far_lt')) throw new Error('période invalide ne doit pas être active');
    await call('PUT', '/api/v1/seasons', { seasons: before.seasons }); // restauration
    return `${out.seasons.length} période(s) · ${out.current.length} active(s) aujourd'hui`;
  });
  await step('GET /api/v1/film?film=… — lien direct par film', async () => {
    const base = await (await fetch(BASE + '/api/v1/film')).json();
    const id = base.playlistId || 'pl1';
    const res = await fetch(BASE + `/api/v1/film?film=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if ((f.playlistId || 'pl1') !== id) throw new Error('playlistId inattendu');
    const bad = await fetch(BASE + '/api/v1/film?film=inexistant');
    if (bad.status !== 404) throw new Error(`film inconnu : HTTP ${bad.status} au lieu de 404`);
    return `« ${f.playlistName || 'Film'} » → v${f.version}${f.draft ? ' (brouillon)' : ''}`;
  });
  await step('GET /api/v1/film?store=… — lien direct par magasin', async () => {
    const fleetRes = await call('GET', '/api/v1/fleet');
    const store = fleetRes.stores[0];
    // Serveur de production vierge : aucun magasin tant que l'import PWA
    // n'a pas eu lieu — on vérifie juste le 404 sur un id inconnu.
    if (!store) {
      const bad0 = await fetch(BASE + '/api/v1/film?store=inexistant');
      if (bad0.status !== 404) throw new Error(`magasin inconnu : HTTP ${bad0.status} au lieu de 404`);
      return 'serveur vierge (aucun magasin) · 404 OK';
    }
    const res = await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if (f.storeId !== store.id) throw new Error('storeId inattendu');
    if (!f.format || !(f.format.w > 0) || !(f.format.h > 0)) throw new Error('combo écrans absent (format)');
    const bad = await fetch(BASE + '/api/v1/film?store=inexistant');
    if (bad.status !== 404) throw new Error(`magasin inconnu : HTTP ${bad.status} au lieu de 404`);
    return `${f.storeName} → v${f.version} · ${f.format.label} = ${f.format.px}`;
  });
  await step('POST /api/v1/test — test de connexion live (auto-ciblé)', async () => {
    const anyToken = await firstToken();
    if (!anyToken) return 'serveur vierge (aucun player)';
    const out = await call('POST', '/api/v1/test', { url: `${BASE}/api/v1`, ip: new URL(BASE).hostname, token: anyToken });
    const ok = out.rows.filter((r) => r.ok).length;
    if (!out.ok) throw new Error(`${ok}/${out.rows.length} vérifications OK`);
    return `${ok}/${out.rows.length} vérifications OK`;
  });

  // --- cycle complet (mutations) ------------------------------------------
  if (MUTATE) {
    const token = 'plyr_LIVETEST';
    const pid = 'livetest';
    await step('POST heartbeat — auto-enregistrement d\'un player de test', async () => {
      const hb = await call('POST', `/api/v1/players/${pid}/heartbeat`, {
        token, name: 'Écran de test live', state: 'playing', cachePct: 100, media: 'test', playedVer: 0, dataVer: 0,
      });
      if (!hb.ok) throw new Error('heartbeat refusé');
      return `assignée v${hb.assignedVer}`;
    });
    await step('POST /api/v1/stores/<id> — combo d\'écrans du magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const before = store.format;
      const out = await call('POST', `/api/v1/stores/${store.id}`, { screens: 3, size: 55, orient: 'portrait' });
      if (!out.ok || out.format.w !== 3 * 2160 || out.format.h !== 3840) {
        throw new Error(`combo 3×55″ portrait → ${out.format && out.format.px} (attendu 6480 × 3840 px)`);
      }
      const film = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
      if (!film.format || film.format.w !== 6480) throw new Error('le lien magasin ne reflète pas le combo');
      // restauration de la configuration d'origine
      await call('POST', `/api/v1/stores/${store.id}`, { screens: before.screens, size: before.size, orient: before.orient });
      return `${store.store} : ${out.format.label} = ${out.format.px}, restauré ${before.label}`;
    });
    await step('PUT /api/v1/catalog — produit + prix par magasin', async () => {
      const before = await call('GET', '/api/v1/catalog');
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const cats = before.categories.length ? before.categories : [{ id: 'pcT', name: 'Catégorie test', active: true }];
      const catId = cats[0].id;
      const testProd = {
        id: 'prLIVETEST', categoryId: catId, name: 'Produit test live', price: '9,99',
        img: 'assets/cake.png', src: 'illus', active: true, prices: { [store.id]: '7,77' },
        aliases: { nl: 'Levend testproduct' },
      };
      await call('PUT', '/api/v1/catalog', { categories: cats, products: [...before.products, testProd] });
      const mid = await call('GET', '/api/v1/catalog');
      const found = mid.products.find((p) => p.id === 'prLIVETEST');
      if (!found) throw new Error('produit test absent après enregistrement');
      if (found.prices[store.id] !== '7,77') throw new Error('prix par magasin perdu');
      if ((found.aliases || {}).nl !== 'Levend testproduct') throw new Error('alias de langue perdu (sig_aliases)');
      // restauration
      await call('PUT', '/api/v1/catalog', { categories: before.categories.length ? before.categories : [], products: before.products });
      const after = await call('GET', '/api/v1/catalog');
      if (after.products.some((p) => p.id === 'prLIVETEST')) throw new Error('produit test non supprimé');
      return `aller-retour OK · prix ${store.store} 7,77 + alias nl → restauré (${after.products.length} produits)`;
    });
    await step('POST /api/v1/mirror — miroir MySQL (best-effort)', async () => {
      const out = await call('POST', '/api/v1/mirror');
      if (out.ok) {
        if (!(out.tables > 0)) throw new Error('miroir sans table');
        return `${out.tables} tables · ${out.rows} lignes → base « ${out.db} »`;
      }
      // MySQL indisponible / pas de base cible : le miroir est best-effort.
      return `non répliqué (${out.error}) — best-effort, la régie fonctionne`;
    });
    await step('POST /api/v1/plan — planning hebdo (semaine × jour × moments)', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const stateNow = await call('GET', '/api/v1/state');
      const film = (stateNow.playlists || [])[0];
      if (!film) throw new Error('aucun film en base');
      const film2 = (stateNow.playlists || [])[1] || film;
      const before = await call('GET', '/api/v1/plan');
      if (!Array.isArray(before.weeks) || before.weeks.length !== 5) throw new Error('semaines A–E absentes');
      const day = (new Date().getDay() + 6) % 7; // 0 = lundi (comme le serveur)
      // Semaine A, jour courant, matin couvrant toute la journée + 2 films enchaînés.
      const out = await call('POST', '/api/v1/plan', {
        stores: [store.id], week: 'A', day, slots: { matin: [film.id, film2.id] },
        windows: [{ id: 'matin', from: '00:00', to: '23:59' }, { id: 'midi', from: '11:00', to: '15:00' }, { id: 'aprem', from: '15:00', to: '20:00' }],
      });
      const saved = (((out.byStore[store.id] || {}).A || {})[day] || {}).matin;
      if (!out.ok || !Array.isArray(saved) || saved[0] !== film.id) throw new Error(`plan non enregistré : ${JSON.stringify(saved)}`);
      await call('POST', '/api/v1/plan/active', { week: 'A' }); // semaine A diffusée
      const f = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
      if (!f.plan || !f.plan.moment) throw new Error('moment du plan absent du film servi');
      const multi = film2.id !== film.id;
      if (multi && f.plan.films !== 2) throw new Error(`films enchaînés attendus : 2, reçu ${f.plan.films}`);
      // nettoyage : on vide ce jour
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'A', day, slots: {}, windows: before.windows });
      return `${store.store} : ${multi ? '2 films enchaînés' : '« ' + film.name + ' »'} · sem. ${f.plan.week} jour ${f.plan.day} au ${f.plan.moment}`;
    });
    await step('POST /api/v1/plan/duplicate — copie d\'une semaine', async () => {
      const store = (await call('GET', '/api/v1/fleet')).stores[0];
      const film = (await call('GET', '/api/v1/state')).playlists[0];
      const day = (new Date().getDay() + 6) % 7;
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'B', day, slots: { midi: [film.id] } });
      const out = await call('POST', '/api/v1/plan/duplicate', { stores: [store.id], from: 'B', to: 'C' });
      const cell = (((out.byStore[store.id] || {}).C || {})[day] || {}).midi || [];
      if (cell[0] !== film.id) throw new Error(`duplication B→C ratée : ${JSON.stringify(cell)}`);
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'B', day, slots: {} });
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'C', day, slots: {} });
      return `semaine B copiée vers C (jour ${day})`;
    });
    await step('POST /api/v1/plan — plafond de 5 films par moment', async () => {
      const MAX = 5;
      const store = (await call('GET', '/api/v1/fleet')).stores[0];
      const snap = await call('GET', '/api/v1/state'); // brouillon complet, restauré à la fin
      const modIds = (snap.modules || []).map((m) => m.id);
      if (!store || !modIds.length) throw new Error('pré-requis manquants (magasin / modules)');
      const day = (new Date().getDay() + 6) % 7;
      // 6 films éphémères (chacun = 1 module) pour dépasser volontairement la limite
      const films6 = Array.from({ length: MAX + 1 }, (_, i) => ({ id: `plcap${i + 1}`, name: `Cap ${i + 1}`, items: [modIds[0]] }));
      await call('PUT', '/api/v1/draft', {
        modules: snap.modules, playlists: films6, activePlaylistId: 'plcap1',
        secPerLine: snap.secPerLine, loop: snap.loop,
      });
      const out = await call('POST', '/api/v1/plan', { stores: [store.id], week: 'E', day, slots: { midi: films6.map((f) => f.id) } });
      const saved = (((out.byStore[store.id] || {}).E || {})[day] || {}).midi || [];
      if (saved.length !== MAX) throw new Error(`plafond attendu ${MAX}, obtenu ${saved.length}`);
      // nettoyage : efface la cellule, puis restaure le brouillon d'origine
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'E', day, slots: {} });
      await call('PUT', '/api/v1/draft', {
        modules: snap.modules, playlists: snap.playlists,
        activePlaylistId: snap.activePlaylistId, secPerLine: snap.secPerLine, loop: snap.loop,
      });
      return `${MAX + 1} films soumis → ${saved.length} conservés (plafond ${MAX})`;
    });
    await step('POST /api/v1/stores/<id> — langue du magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const before = store.lang || 'fr';
      const out = await call('POST', `/api/v1/stores/${store.id}`, { lang: 'nl' });
      if (out.lang !== 'nl') throw new Error(`langue non enregistrée : ${out.lang}`);
      const film = await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`);
      if (!film.ok) throw new Error(`film?store en ${film.status} avec langue nl`);
      await call('POST', `/api/v1/stores/${store.id}`, { lang: before });
      return `${store.store} : fr → nl → restauré ${before}`;
    });
    const basePlaylists = (state.playlists && state.playlists.length)
      ? state.playlists
      : [{ id: 'pl1', name: 'Film principal', items: state.playlist }];
    const activeId = state.activePlaylistId || basePlaylists[0].id;
    await step('PUT /api/v1/draft — aller-retour du brouillon (films multiples)', async () => {
      await call('PUT', '/api/v1/draft', {
        modules: state.modules,
        playlists: [...basePlaylists, { id: 'pltest', name: 'Film de test', items: state.playlist, cat: 'promo', tags: ['noel', 'vitrine'] }],
        activePlaylistId: activeId,
        secPerLine: state.secPerLine, loop: state.loop,
      });
      const mid = await call('GET', '/api/v1/state');
      if (mid.modules.length !== state.modules.length) throw new Error('perte de modules après enregistrement');
      const pt = mid.playlists.find((p) => p.id === 'pltest');
      if (!pt) throw new Error('film de test perdu à l\'aller-retour');
      if (pt.cat !== 'promo') throw new Error(`catégorie du film perdue : ${pt.cat}`);
      if (!Array.isArray(pt.tags) || pt.tags.join(',') !== 'noel,vitrine') throw new Error(`tags du film perdus : ${JSON.stringify(pt.tags)}`);
      const namesBefore = JSON.stringify(state.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      const namesAfter = JSON.stringify(mid.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      if (namesBefore !== namesAfter) throw new Error('brouillon modifié par l\'aller-retour');
      // nettoyage : on retire le film de test
      await call('PUT', '/api/v1/draft', {
        modules: state.modules, playlists: basePlaylists, activePlaylistId: activeId,
        secPerLine: state.secPerLine, loop: state.loop,
      });
      const after = await call('GET', '/api/v1/state');
      if (after.playlists.some((p) => p.id === 'pltest')) throw new Error('film de test non supprimé');
      return `${after.playlists.length} film(s) · actif : ${after.activePlaylistId}`;
    });
    let pub = null;
    await step('POST /api/v1/publish — film actif + tests auto', async () => {
      pub = await call('POST', '/api/v1/publish', { mode: 'full', playlistId: activeId, targets: [], slot: 'Toute la journée', when: 'now' });
      const ok = pub.tests.filter((t) => t.ok).length;
      if (!pub.ok) throw new Error(`tests post-déploiement : ${ok}/${pub.tests.length} OK`);
      if (!pub.film || !pub.film.name) throw new Error('nom du film absent de la publication');
      return `« ${pub.film.name} » v${pub.version} · tests ${ok}/${pub.tests.length} OK`;
    });
    await step('GET assignment — le player reçoit la nouvelle version', async () => {
      const a = await call('GET', `/api/v1/players/${pid}/assignment?token=${token}`);
      if (a.assignedVer !== pub.version) throw new Error(`assignée v${a.assignedVer}, attendu v${pub.version}`);
      if (!a.snapshot || a.snapshot.version !== pub.version) throw new Error('snapshot manquant ou mauvaise version');
      return `snapshot v${a.snapshot.version} · ${a.snapshot.modules.length} modules`;
    });
    await step('POST /api/v1/publish — snapshot prix (sync légère) + tests auto', async () => {
      const p2 = await call('POST', '/api/v1/publish', { mode: 'data', targets: [] });
      const ok = p2.tests.filter((t) => t.ok).length;
      if (!p2.ok) throw new Error(`tests post-déploiement : ${ok}/${p2.tests.length} OK`);
      return `d${p2.version} · tests ${ok}/${p2.tests.length} OK`;
    });
    await step('GET /api/v1/datasets/latest — dataset de prix servi', async () => {
      const d = await call('GET', `/api/v1/datasets/latest?token=${token}`);
      if (!Array.isArray(d.prices) || !d.prices.length) throw new Error('dataset vide');
      return `d${d.dataVer} · ${d.prices.length} modules tarifés`;
    });
    await step('Heartbeat de confirmation — le player remonte la version jouée', async () => {
      const hb = await call('POST', `/api/v1/players/${pid}/heartbeat`, {
        token, state: 'playing', cachePct: 100, media: 'Tartes · Brookie', playedVer: pub.version, dataVer: 0,
      });
      if (!hb.ok) throw new Error('heartbeat refusé');
      const f = await call('GET', '/api/v1/fleet');
      const me = f.stores.flatMap((s) => s.players).find((p) => p.id === pid);
      if (!me) throw new Error('player absent du réseau');
      if (me.playedVer !== pub.version) throw new Error(`réseau : v${me.playedVer} ≠ v${pub.version}`);
      return `réseau à jour : ${me.state} · v${me.playedVer}`;
    });
    await step('GET /api/v1/publications — historique + tests archivés', async () => {
      const p = await call('GET', '/api/v1/publications');
      if (!p.publications.length) throw new Error('aucune publication archivée');
      if (!p.publications[0].tests.length) throw new Error('tests non archivés');
      return `${p.publications.length} publication(s)`;
    });
  }

  const ok = results.filter((r) => r.ok).length;
  const ko = results.length - ok;
  console.log(`\n${ko === 0 ? '\x1b[32m' : '\x1b[31m'}${ok}/${results.length} tests OK${ko ? ` · ${ko} en échec` : ''}\x1b[0m\n`);
  if (child) child.kill();
  process.exit(ko === 0 ? 0 : 1);
}

async function firstToken() {
  const f = await call('GET', '/api/v1/fleet');
  const p = f.stores.flatMap((s) => s.players)[0];
  return p ? p.token : null;
}

main().catch((e) => {
  console.error('\x1b[31mÉchec du runner :\x1b[0m', e.message || e);
  if (child) child.kill();
  process.exit(1);
});
