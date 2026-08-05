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
    if (!t.types.some((x) => x.id === 'promotion')) throw new Error('type « promotion » manquant');
    if (!t.types.some((x) => x.id === 'campagne')) throw new Error('type « campagne » manquant');
    if (!t.types.some((x) => x.id === 'html')) throw new Error('type « html » (gabarit) manquant');
    return t.types.map((x) => x.id).join(' · ');
  });
  await step('GET /api/v1/promo-types — sous-types de promotion (dynamiques)', async () => {
    const p = await call('GET', '/api/v1/promo-types');
    if (!Array.isArray(p.promoTypes) || p.promoTypes.length < 3) throw new Error('sous-types de promotion manquants (sig_promo_types)');
    for (const x of p.promoTypes) if (!x.id || !x.name || !x.icon) throw new Error(`sous-type ${x.id} incomplet`);
    return p.promoTypes.map((x) => `${x.icon} ${x.name}`).join(' · ');
  });
  await step('GET /api/v1/campaigns — campagnes marketing (liste)', async () => {
    const c = await call('GET', '/api/v1/campaigns');
    if (!Array.isArray(c.campaigns)) throw new Error('campagnes illisibles (sig_campaigns)');
    for (const x of c.campaigns) if (!x.id || !x.name || !x.scope) throw new Error(`campagne ${x.id} incomplète`);
    return c.campaigns.length ? c.campaigns.map((x) => `${x.name} (${x.scope})`).join(' · ') : 'liste vide (prod démarre vide)';
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
  await step('GET /api/v1/surprise — dossier vidéos surprise (lecture)', async () => {
    const r = await call('GET', '/api/v1/surprise');
    if (!Array.isArray(r.videos)) throw new Error('liste absente');
    return `${r.videos.length} vidéo(s) dans le dossier`;
  });
  await step('GET /api/v1/seasons — périodes de l\'année (lecture)', async () => {
    const r = await call('GET', '/api/v1/seasons');
    if (!Array.isArray(r.seasons) || !Array.isArray(r.current)) throw new Error('structure des périodes');
    const withImg = r.seasons.filter((s) => s.image).length;
    return `${r.seasons.length} période(s) · ${r.current.length} active(s)${withImg ? ` · ${withImg} illustration(s)` : ''}`;
  });
  // Diagnostic ws_season (lecture seule) : révèle les colonnes réelles de la
  // table de périodes et signale une éventuelle colonne d'illustration. Contre
  // la prod (MySQL branché) le détail imprimé montre le schéma réel ; en local
  // (pas de MySQL) l'étape passe en signalant « non lisible ». Ne fait jamais
  // échouer le déploiement (l'endpoint renvoie toujours 200 + ok:true/false).
  await step('POST /api/v1/seasons/inspect — diagnostic ws_season (illustration)', async () => {
    const r = await call('POST', '/api/v1/seasons/inspect', {});
    if (typeof r.ok !== 'boolean' || !Array.isArray(r.inspected)) throw new Error('réponse de diagnostic invalide');
    if (!r.ok) return `base non lisible ici : ${r.error || 'non configurée'}`;
    const imgTxt = r.imageFound
      ? `IMAGE=[${r.imageCols.map((c) => `${c.column}@${c.table}${c.sample ? `="${c.sample}"` : ''}`).join(', ')}]`
      : 'aucune colonne image détectée';
    const tables = r.inspected.map((t) => {
      const cols = (t.types || t.columns || []).join(', ');
      const ex = (t.sample && t.sample.length) ? ` ex[${t.sample.join(' | ')}]` : '';
      return `${t.table}{${cols}}${ex}`;
    }).join(' ;; ');
    return `${r.inspected.length} table(s) · ${imgTxt} · ${tables}`.slice(0, 1600);
  });
  await step('GET /api/v1/media — médiathèque agence (lecture)', async () => {
    const r = await call('GET', '/api/v1/media');
    if (!Array.isArray(r.media)) throw new Error('liste média absente');
    return `${r.media.length} média(s) · dossier ${r.dir}`;
  });
  await step('GET /api/v1/product-moments — périodes de vente (lecture)', async () => {
    const r = await call('GET', '/api/v1/product-moments');
    if (!Array.isArray(r.moments) || !Array.isArray(r.rows)) throw new Error('structure périodes de vente');
    return `${r.rows.length} règle(s) · ${r.moments.join('/')} · moment courant ${r.current}`;
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
    await step('POST/DELETE /api/v1/surprise — upload + suppression', async () => {
      const before = await call('GET', '/api/v1/surprise');
      const name = 'test-surprise-livetest.mp4';
      const dataUrl = 'data:video/mp4;base64,' + Buffer.from('livetest').toString('base64');
      const up = await call('POST', '/api/v1/surprise', { name, dataUrl });
      if (!up.ok || !up.videos.some((v) => v.name === name)) throw new Error('upload non listé');
      const del = await call('DELETE', `/api/v1/surprise/${encodeURIComponent(name)}`);
      if (del.videos.some((v) => v.name === name)) throw new Error('suppression échouée');
      return `upload + suppression (${before.videos.length} au départ)`;
    });
    await step('PUT /api/v1/seasons — enregistrement + détection', async () => {
      const before = await call('GET', '/api/v1/seasons');
      const out = await call('PUT', '/api/v1/seasons', { seasons: [
        { id: 'se_all_lt', name: 'Toute l\'année', from: '01/01', to: '31/12', products: [], image: 'https://exemple.test/galette.jpg', active: true },
        { id: 'se_far_lt', name: 'Invalide', from: '15/13', to: '16/13', products: [], active: true },
      ] });
      if (!out.ok || out.seasons.length !== 2) throw new Error('enregistrement des périodes');
      const cur = new Set(out.current || []);
      if (!cur.has('se_all_lt')) throw new Error('« toute l\'année » devrait être active');
      if (cur.has('se_far_lt')) throw new Error('période invalide ne doit pas être active');
      const saved = out.seasons.find((s) => s.id === 'se_all_lt');
      if (!saved || saved.image !== 'https://exemple.test/galette.jpg') throw new Error('illustration de période non persistée');
      await call('PUT', '/api/v1/seasons', { seasons: before.seasons }); // restauration
      return `${out.seasons.length} période(s) · ${out.current.length} active(s) · illustration OK`;
    });
    await step('Médiathèque agence — upload tagué + accès séparé', async () => {
      const dataUrl = 'data:video/mp4;base64,' + Buffer.from('lt').toString('base64');
      const up = await call('POST', '/api/v1/media', { name: 'lt-clip.mp4', kind: 'film', moment: 'aprem', productId: '', seasonId: '', dataUrl });
      const item = (up.media || []).find((x) => x.filename === '3_lt-clip.mp4');
      if (!up.ok || !item || !item.present || item.moment !== 'aprem') throw new Error('upload/tag/préfixe média');
      const ag = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'agence', password: process.env.SIG_AGENCY_PASSWORD || 'agence' }) })).json().catch(() => ({}));
      let agencyIsolated = 'compte agence absent';
      if (ag && ag.token) {
        const h = { authorization: `Bearer ${ag.token}` };
        const s = await fetch(BASE + '/api/v1/state', { headers: h });
        const md = await fetch(BASE + '/api/v1/media', { headers: h });
        if (s.status !== 403) throw new Error(`agence devrait être bloquée sur /state (reçu ${s.status})`);
        if (!md.ok) throw new Error('agence devrait lire /media');
        agencyIsolated = 'agence cloisonnée (/state 403 · /media OK)';
      }
      await call('DELETE', `/api/v1/media/${encodeURIComponent(item.id)}`);
      return `« 3_lt-clip.mp4 » (après-midi) · ${agencyIsolated}`;
    });
    await step('Élément « média ciblé » — pioche selon moment + saison', async () => {
      // moment courant calculé EXACTEMENT comme le serveur (fenêtres par défaut).
      const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
      const moment = (mins >= 360 && mins < 660) ? 'matin' : (mins >= 660 && mins < 900) ? 'midi'
        : (mins >= 900 && mins < 1200) ? 'aprem' : (now.getHours() < 11 ? 'matin' : now.getHours() < 16 ? 'midi' : 'aprem');
      const bad = moment === 'matin' ? 'aprem' : 'matin';
      const dU = (s) => 'data:video/mp4;base64,' + Buffer.from(s).toString('base64');
      await call('POST', '/api/v1/media', { name: 'mediael-good.mp4', kind: 'film', moment, dataUrl: dU('g') });
      await call('POST', '/api/v1/media', { name: 'mediael-bad.mp4', kind: 'film', moment: bad, dataUrl: dU('b') });
      const st = await call('GET', '/api/v1/state');
      const mods = st.modules.concat([{ id: 'mediaLT', type: 'media', name: 'Média ciblé', layout: 'cover', dur: 12, schedule: { days: [1, 1, 1, 1, 1, 1, 1], from: '00:00', to: '23:59' }, items: [] }]);
      const pls = st.playlists.map((p) => (p.id === st.activePlaylistId ? { ...p, items: [...p.items, 'mediaLT'] } : p));
      await call('PUT', '/api/v1/draft', { modules: mods, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      let ok2 = false, badPicked = false, cnt = null;
      for (let i = 0; i < 10; i++) {
        const f = await (await fetch(BASE + `/api/v1/film?film=${encodeURIComponent(st.activePlaylistId)}`)).json();
        const em = (f.modules || []).find((x) => x.id === 'mediaLT');
        if (em) { cnt = em.mediaCount; if (em.mediaUrl) ok2 = true; if (/mediael-bad/.test(em.mediaUrl || '')) badPicked = true; }
      }
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      for (const mm of (await call('GET', '/api/v1/media')).media || []) if (/mediael-/.test(mm.filename)) await call('DELETE', `/api/v1/media/${encodeURIComponent(mm.id)}`);
      if (!ok2) throw new Error('aucun média pioché');
      if (badPicked) throw new Error('média du mauvais moment pioché');
      if (cnt !== 1) throw new Error(`éligibles attendus 1, reçu ${cnt}`);
      return `moment ${moment} · 1 éligible pioché, mauvais moment exclu`;
    });
    await step('PUT /api/v1/product-moments — produit × moment (aller-retour)', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || [])[0];
      if (!p) return 'catalogue vide (aucun produit)';
      const before = await call('GET', '/api/v1/product-moments');
      const out = await call('PUT', '/api/v1/product-moments', { rows: [
        { productId: p.id, moment: 'matin', exception: false },
        { productId: p.id, moment: 'midi', exception: true },
      ] });
      const inc = (out.rows || []).find((r) => r.productId === p.id && r.moment === 'matin');
      const exc = (out.rows || []).find((r) => r.productId === p.id && r.moment === 'midi');
      if (!inc || inc.exception) throw new Error('inclusion (matin) non enregistrée');
      if (!exc || !exc.exception) throw new Error('exception (midi) non enregistrée');
      await call('PUT', '/api/v1/product-moments', { rows: before.rows }); // restauration
      return `${p.name} : matin vendu + midi exclu`;
    });
    await step('Film « continu » — boucle générée · moment · exception', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const actives = (cat.products || []).filter((p) => p.active !== false);
      if (actives.length < 2) return `catalogue insuffisant (${actives.length} produit actif)`;
      const p0 = actives[0]; const p1 = actives[1];
      const st = await call('GET', '/api/v1/state');
      const pmBefore = await call('GET', '/api/v1/product-moments');
      // moment courant dans le vocabulaire des périodes de vente (matin/midi/aprem).
      const moment = pmBefore.current;
      // p0 exclu au moment courant ; p1 laissé par défaut (vendu partout).
      await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p0.id, moment, exception: true }] });
      const contFilm = {
        id: 'pl-contLT', name: 'Boucle continue LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: true, order: 'catalogue', maxItems: 20,
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 },
          exceptionFilms: [st.activePlaylistId] },
      };
      const pls = [...st.playlists, contFilm];
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const f = await (await fetch(BASE + '/api/v1/film?film=pl-contLT')).json();
      // restauration AVANT les assertions (pour ne rien laisser derrière)
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      if (!f.continuous) throw new Error('film non marqué continu');
      if (!f.revision) throw new Error('révision absente');
      if (!Array.isArray(f.modules) || !f.modules.length) throw new Error('boucle vide');
      const itemPids = f.modules.flatMap((m) => (m.items || []).map((it) => it.productId));
      if (itemPids.includes(p0.id)) throw new Error('produit exclu au moment courant présent dans la boucle');
      if (!itemPids.includes(p1.id)) throw new Error('produit vendu absent de la boucle');
      if (!f.modules.some((m) => String(m.id).startsWith('k-exc-'))) throw new Error('playlist d\'exception non injectée');
      return `${f.modules.length} slot(s) · moment ${moment} · p0 exclu, p1 présent, exception OK`;
    });
    await step('Rupture produit — exclu de la boucle continue', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const actives = (cat.products || []).filter((p) => p.active !== false && !p.unavailable);
      if (actives.length < 2) return `catalogue insuffisant (${actives.length} produit dispo)`;
      const target = actives[0];
      const st = await call('GET', '/api/v1/state');
      const prods = cat.products.map((p) => (p.id === target.id ? { ...p, unavailable: true } : p));
      await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: prods });
      const contFilm = { id: 'pl-ruptLT', name: 'Rupture LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 40,
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 } } };
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: [...st.playlists, contFilm], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const f = await (await fetch(BASE + '/api/v1/film?film=pl-ruptLT')).json();
      // restauration AVANT les assertions
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
      const pids = (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
      if (pids.includes(target.id)) throw new Error(`produit en rupture (${target.name}) présent dans la boucle`);
      return `${target.name} en rupture → exclu · ${f.modules ? f.modules.length : 0} slot(s)`;
    });
    await step('Jetons dynamiques — {{magasin}}/{{adresse}} résolus par magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const st = await call('GET', '/api/v1/state');
      const coord0 = { address: store.address || '' };
      const tokMod = { id: 'mTOKLT', type: 'liaison', name: 'Bienvenue à {{magasin}}', sub: '{{adresse}} · {{moment}} · {{xyz}}', dur: 6, items: [] };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'TESTADDR-Corbais' });
      await call('PUT', '/api/v1/draft', {
        modules: [...st.modules, tokMod],
        playlists: [...st.playlists, { id: 'pl-tokLT', name: 'Film jetons LT', items: [] }],
        activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
      });
      const f = await (await fetch(BASE + `/api/v1/film?film=pl-tokLT&store=${encodeURIComponent(store.id)}`)).json();
      // restauration AVANT les assertions (brouillon + coordonnées d'origine)
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('POST', `/api/v1/stores/${store.id}`, coord0);
      const m = (f.modules || []).find((x) => x.id === 'mTOKLT');
      if (!m) throw new Error('module à jetons absent du film');
      if (m.name !== `Bienvenue à ${store.store}`) throw new Error(`{{magasin}} non injecté : ${m.name}`);
      if (!String(m.sub).startsWith('TESTADDR-Corbais')) throw new Error(`{{adresse}} non injectée : ${m.sub}`);
      if (!/\{\{\s*xyz\s*\}\}/.test(m.sub)) throw new Error('un jeton inconnu doit rester littéral');
      return `« ${m.name} » · sous-titre résolu, jeton inconnu conservé`;
    });
    await step('Groupe d\'écrans — zone catégories (toute la journée) + rattachement', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin');
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!c0) return 'aucune catégorie au catalogue';
      const catOf = new Map(cat.products.map((p) => [p.id, p.categoryId]));
      // 1) créer une zone (combo portrait propre) avec cette catégorie
      const created = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Zone LT', screens: 1, size: 55, orient: 'portrait', cats: [c0.id] });
      if (!created.ok || !created.group || !created.group.id) throw new Error('création de zone échouée');
      const gid = created.group.id;
      try {
        if (created.group.format.w !== 2160 || created.group.format.h !== 3840) throw new Error(`format zone inattendu : ${created.group.format.px}`);
        // 2) aperçu ?group= : la boucle ne contient QUE cette catégorie
        const prev = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(gid)}`)).json();
        const pids = (prev.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
        if (!pids.length || !pids.every((pid) => catOf.get(pid) === c0.id)) throw new Error('aperçu zone : produit hors catégorie');
        if (!prev.format || prev.format.w !== 2160) throw new Error('aperçu zone : format du groupe non appliqué');
        // 3) rattacher un écran → son assignment sert la boucle catégories au format du groupe
        const player = (store.players || [])[0];
        let assignTxt = 'pas d\'écran à rattacher';
        if (player) {
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: gid });
          const a = await call('GET', `/api/v1/players/${player.id}/assignment?token=${player.token}`);
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: '' }); // détacher AVANT assertions
          if (a.groupId !== gid) throw new Error('assignment ne reflète pas la zone');
          const apids = (a.snapshot.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
          if (apids.length && !apids.every((pid) => catOf.get(pid) === c0.id)) throw new Error('produit hors catégorie dans la zone assignée');
          if (!a.snapshot.format || a.snapshot.format.w !== 2160) throw new Error('format du groupe non appliqué à l\'écran');
          assignTxt = `écran « ${player.name} » → zone (${apids.length} slot(s), ${a.snapshot.format.px})`;
        }
        return `zone « ${c0.name} » ${created.group.format.px} · aperçu ${pids.length} produit(s) en catégorie · ${assignTxt}`;
      } finally {
        // 4) nettoyage : suppression de la zone (détache aussi les écrans)
        await call('DELETE', `/api/v1/groups/${gid}`);
      }
    });
    await step('Secteurs d\'écrans — position + nombre, config INDÉPENDANTE', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin');
      const storePx0 = store.format.px;
      // Deux secteurs du MÊME magasin, configurés différemment.
      const a = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur A LT', screens: 3, size: 55, orient: 'portrait', cats: [] });
      const b = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur B LT', screens: 1, size: 43, orient: 'paysage', cats: [] });
      try {
        if (a.group.format.w !== 6480 || a.group.format.h !== 3840) throw new Error(`secteur A (3 × portrait) → ${a.group.format.px}`);
        if (b.group.format.w !== 3840 || b.group.format.h !== 2160) throw new Error(`secteur B (1 × paysage) → ${b.group.format.px}`);
        // Modifier A ne doit toucher NI B NI le magasin.
        await call('POST', `/api/v1/groups/${a.group.id}`, { screens: 2, orient: 'paysage' });
        const fl2 = await call('GET', '/api/v1/fleet');
        const st2 = fl2.stores.find((s) => s.id === store.id);
        const gA = st2.groups.find((g) => g.id === a.group.id);
        const gB = st2.groups.find((g) => g.id === b.group.id);
        if (!gA || gA.format.w !== 7680 || gA.format.h !== 2160) throw new Error(`secteur A non mis à jour → ${gA && gA.format.px}`);
        if (!gB || gB.format.px !== b.group.format.px) throw new Error('secteur B modifié par la config de A — pas indépendant');
        if (st2.format.px !== storePx0) throw new Error('le format du MAGASIN a été modifié par un secteur');
        // Un écran rattaché prend le format de SON secteur.
        const player = (store.players || [])[0];
        let asgTxt = 'pas d\'écran à rattacher';
        if (player) {
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: b.group.id });
          const asg = await call('GET', `/api/v1/players/${player.id}/assignment?token=${player.token}`);
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: '' }); // détacher AVANT assertions
          if (!asg.snapshot.format || asg.snapshot.format.w !== 3840 || asg.snapshot.format.h !== 2160) {
            throw new Error(`l'écran ne reçoit pas le format de SON secteur → ${asg.snapshot.format && asg.snapshot.format.px}`);
          }
          asgTxt = `écran « ${player.name} » → secteur B (${asg.snapshot.format.px})`;
        }
        return `A ${gA.format.label} (${gA.format.px}) · B ${gB.format.label} (${gB.format.px}) · magasin inchangé · ${asgTxt}`;
      } finally {
        await call('DELETE', `/api/v1/groups/${a.group.id}`);
        await call('DELETE', `/api/v1/groups/${b.group.id}`);
      }
    });
    await step('Matières premières — ingrédient lié à une animation', async () => {
      const before = await call('GET', '/api/v1/ingredients');
      const st = await call('GET', '/api/v1/state');
      const anim = (st.modules || []).find((m) => m.type === 'animation');
      try {
        const row = { id: 'ingLTTEST', name: 'Beurre AOP LT', extRef: 'MP-42', moduleId: anim ? anim.id : '', active: true };
        const saved = await call('PUT', '/api/v1/ingredients', { ingredients: [...before.ingredients, row] });
        const back = (saved.ingredients || []).find((x) => x.id === row.id);
        if (!back || back.name !== row.name || back.extRef !== 'MP-42' || back.moduleId !== row.moduleId) {
          throw new Error('aller-retour incorrect : ' + JSON.stringify(back));
        }
        // Un ingrédient sans nom est refusé (ligne inutilisable).
        const noName = await call('PUT', '/api/v1/ingredients', { ingredients: [{ id: 'x', name: '  ' }] });
        if ((noName.ingredients || []).length) throw new Error('un ingrédient sans nom a été accepté');
        return `« ${row.name} » (réf. MP-42)${anim ? ` → animation « ${anim.name || anim.id} »` : ' · aucune animation en bibliothèque'}`;
      } finally {
        await call('PUT', '/api/v1/ingredients', { ingredients: before.ingredients });
      }
    });
    await step('Réécriture du catalogue — les réglages de la régie survivent', async () => {
      // Le rafraîchissement ERP réécrit le catalogue (DELETE + INSERT sur les
      // mêmes ids). Les tags de période, eux, appartiennent à la régie : ils ne
      // doivent pas partir avec.
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || []).find((x) => x.active !== false);
      if (!p) return 'aucun produit actif';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const lcBefore = await call('GET', '/api/v1/lib-categories');
      try {
        await call('PUT', '/api/v1/product-moments', { rows: [
          { productId: p.id, moment: 'matin', exception: false, kind: 'produit' },
          { productId: p.categoryId, moment: 'midi', exception: true, kind: 'categorie' },
        ] });
        // Réécriture intégrale du catalogue, ids inchangés.
        await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
        const after = await call('GET', '/api/v1/product-moments');
        const mine = (after.rows || []).filter((r) => r.productId === p.id || r.productId === p.categoryId);
        if (mine.length !== 2) throw new Error(`les tags ont été perdus à la réécriture : ${JSON.stringify(after.rows)}`);
        const lcAfter = await call('GET', '/api/v1/lib-categories');
        if (lcAfter.libCategories.length !== lcBefore.libCategories.length) throw new Error('les catégories de bibliothèque ont bougé');
        // Le visuel et l'état rupture restent ceux de la régie.
        const p2 = (await call('GET', '/api/v1/catalog')).products.find((x) => x.id === p.id);
        if (p2.img !== p.img || p2.src !== p.src) throw new Error(`visuel modifié : ${p2.src} ${p2.img}`);
        return `tags produit + catégorie conservés · visuel « ${p2.src} » intact · ${lcAfter.libCategories.length} catégorie(s) de bibliothèque`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      }
    });
    await step('Régie → Apparition — résumé lu par la carte produit ERP', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || []).find((x) => x.active !== false);
      if (!p) return 'aucun produit actif';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== moment);
      try {
        const a0 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        if (!a0.produit || a0.produit.id !== p.id) throw new Error('produit absent du résumé');
        if (!Array.isArray(a0.periodes) || a0.periodes.length !== 3) throw new Error('les 3 périodes devraient être décrites');
        if (a0.maintenant.visible !== true) throw new Error('sans règle, le produit devrait être visible maintenant');
        if (!Array.isArray(a0.secteurs)) throw new Error('secteurs absents');
        // Un tag posé en régie se lit tout de suite dans le résumé.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p.id, moment: other, exception: false, kind: 'produit' }] });
        const a1 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        if (a1.maintenant.visible !== false || a1.maintenant.raison !== 'hors période') throw new Error('le tag de période n\'est pas reflété : ' + JSON.stringify(a1.maintenant));
        const row = a1.periodes.find((m) => m.id === other);
        if (!row || row.produit !== 'visible' || !row.visible) throw new Error('la période taguée devrait être « visible » : ' + JSON.stringify(row));
        // Le tag de la CATÉGORIE se lit aussi, et prime.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p.categoryId, moment: other, exception: false, kind: 'categorie' }] });
        const a2 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        const r2 = a2.periodes.find((m) => m.id === moment);
        if (!r2 || r2.categorie !== 'aucune règle' || r2.visible) throw new Error('le tag de catégorie devrait masquer ce créneau : ' + JSON.stringify(r2));
        const bad = await fetch(BASE + '/api/v1/appearance?product=nexiste-pas', { headers: { authorization: `Bearer ${authToken}` } });
        if (bad.status !== 404) throw new Error(`produit inconnu → ${bad.status} (404 attendu)`);
        return `« ${p.name} » · ${a0.periodes.length} périodes · ${a0.secteurs.length} secteur(s) · ${a0.elements.length} élément(s) · tags produit + catégorie reflétés`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      }
    });
    await step('Périodes sur une PROMOTION et une CAMPAGNE', async () => {
      const st = await call('GET', '/api/v1/state');
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== moment);
      const pt = (await call('GET', '/api/v1/promo-types')).promoTypes[0];
      const cmps = (await call('GET', '/api/v1/campaigns')).campaigns;
      if (!pt || !cmps.length) return 'aucun sous-type de promotion ou campagne';
      const cmp = cmps[0];
      // Deux éléments de bibliothèque : une promo et une campagne, non tagués
      // eux-mêmes — c'est l'ENTITÉ pointée qui porte la période.
      const mods = [...st.modules,
        { id: 'mPromoLT', type: 'promotion', name: 'Promo LT', promoType: pt.id, orient: 'paysage', moments: [], items: [] },
        { id: 'mCampLT', type: 'campagne', name: 'Camp LT', campaignRef: cmp.id, orient: 'paysage', moments: [], items: [] }];
      const film = { id: 'pl-tagLT', name: 'Tags LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 12, orient: 'paysage',
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 },
          itemRatios: [{ id: 'mPromoLT', on: true, n: 2 }, { id: 'mCampLT', on: true, n: 3 }] } };
      const put = () => call('PUT', '/api/v1/draft', { modules: mods, playlists: [...st.playlists, film], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const namesOf = async () => {
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-tagLT')).json();
        return (f.modules || []).map((m) => m.name || '').join('|');
      };
      try {
        await put();
        const both = await namesOf();
        if (!both.includes('Promo LT') || !both.includes('Camp LT')) throw new Error('sans tag, les deux devraient passer : ' + both);
        // La promo n'est visible qu'à un AUTRE moment → elle disparaît.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: pt.id, moment: other, exception: false, kind: 'promotion' }] });
        const noPromo = await namesOf();
        if (noPromo.includes('Promo LT')) throw new Error(`la promo « ${pt.name} » passe hors de sa période`);
        if (!noPromo.includes('Camp LT')) throw new Error('la campagne ne devrait pas être affectée par le tag de la promo');
        // Idem pour la campagne, via une exception au moment courant.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: cmp.id, moment, exception: true, kind: 'campagne' }] });
        const noCamp = await namesOf();
        if (noCamp.includes('Camp LT')) throw new Error(`la campagne « ${cmp.name} » passe alors qu'elle est exclue à ${moment}`);
        if (!noCamp.includes('Promo LT')) throw new Error('la promo devrait être revenue (son tag a été remplacé)');
        return `promo « ${pt.name} » limitée à ${other} → absente à ${moment} · campagne « ${cmp.name} » exclue à ${moment} → absente`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Catégories de bibliothèque — éditables + table liée', async () => {
      const before = await call('GET', '/api/v1/lib-categories');
      if (!Array.isArray(before.libCategories) || !before.libCategories.length) throw new Error('aucune catégorie de bibliothèque');
      if (!Array.isArray(before.libSources) || !before.libSources.some((s) => s.id === 'produits')) throw new Error('tables liées non exposées');
      const seeded = before.libCategories.find((c) => c.id === 'produit');
      if (!seeded || seeded.src !== 'produits') throw new Error('la catégorie « produit » devrait être liée à la table produits');
      try {
        const extra = { id: 'lcLTTEST', name: 'Catégorie LT', color: '#123456', src: 'campagnes', active: true };
        const saved = await call('PUT', '/api/v1/lib-categories', { libCategories: [...before.libCategories, extra] });
        const back = (saved.libCategories || []).find((c) => c.id === extra.id);
        if (!back || back.name !== extra.name || back.color !== extra.color || back.src !== 'campagnes') {
          throw new Error('aller-retour de la catégorie incorrect : ' + JSON.stringify(back));
        }
        // Une table inconnue retombe sur « aucune » plutôt que d'être écrite telle quelle.
        const fake = await call('PUT', '/api/v1/lib-categories', { libCategories: [{ ...extra, src: 'table-qui-nexiste-pas' }] });
        const f = (fake.libCategories || []).find((c) => c.id === extra.id);
        if (!f || f.src !== '') throw new Error('table inconnue acceptée : ' + JSON.stringify(f));
        // Liste vide refusée : la bibliothèque garde toujours un classement.
        const empty = await call('PUT', '/api/v1/lib-categories', { libCategories: [] });
        if (!(empty.libCategories || []).length) throw new Error('une liste vide a effacé le classement');
        return `${before.libCategories.length} catégorie(s) · ${before.libSources.length} tables liables · aller-retour + garde-fous OK`;
      } finally {
        await call('PUT', '/api/v1/lib-categories', { libCategories: before.libCategories });
      }
    });
    await step('Secteur — filtre PÉRIODES / CATÉGORIES au choix', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!store || !c0) return 'aucun magasin ou catégorie';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      // Le catalogue de démo n'a qu'une catégorie : on en ajoute une seconde le
      // temps du test, sinon « filtrer les catégories » ne changerait rien.
      const cLT = { id: 'pc_cLT', name: 'Catégorie LT', img: '' };
      const pLT = { id: 'pr_cLT', name: 'Produit LT', price: '3,50', categoryId: cLT.id, img: 'assets/cookies.png', active: true };
      await call('PUT', '/api/v1/catalog', { categories: [...cat.categories, cLT], products: [...cat.products, pLT] });
      const g = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur filtre LT', screens: 1, size: 55, orient: 'paysage', cats: [c0.id] });
      const pidsOf = async () => {
        const f = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(g.group.id)}`)).json();
        return (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId)).filter(Boolean);
      };
      try {
        // Par défaut : filtre catégories oui, périodes non (comportement d'origine).
        if (g.group.filterCats !== true || g.group.filterMoments !== false) throw new Error('défauts du secteur inattendus : ' + JSON.stringify({ c: g.group.filterCats, m: g.group.filterMoments }));
        const catOf = new Map([...cat.products, pLT].map((p) => [p.id, p.categoryId]));
        const only = await pidsOf();
        if (!only.length || only.some((pid) => catOf.get(pid) !== c0.id)) throw new Error(`le filtre catégories ne tient pas (${only.length} produit(s))`);
        // Catégories non + périodes oui → sa propre boucle, tout le catalogue.
        // On repart d'une table de périodes vide pour isoler l'effet mesuré.
        await call('PUT', '/api/v1/product-moments', { rows: [] });
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterCats: false, filterMoments: true });
        const all = await pidsOf();
        // La boucle est bornée en nombre de slots : on compare les CATÉGORIES
        // atteintes, pas le nombre de passages.
        if (!all.some((pid) => catOf.get(pid) !== c0.id)) throw new Error('« catégories : non » devrait élargir hors de la catégorie choisie');
        // Périodes : un produit exclu au moment courant disparaît…
        const target = [...cat.products, pLT].find((p) => p.active !== false && !p.unavailable && all.includes(p.id));
        if (!target) throw new Error('aucun produit testable pour les périodes');
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: target.id, moment, exception: true }] });
        const timed = await pidsOf();
        if (timed.includes(target.id)) throw new Error(`« périodes : oui » ne filtre pas (${target.name} passe hors créneau)`);
        // …et revient dès que le secteur ne filtre plus les périodes.
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterMoments: false, filterCats: true });
        const back = await pidsOf();
        if (!back.includes(target.id)) throw new Error('« périodes : non » devrait laisser passer le produit');
        // Aucun filtre → le secteur suit le film du magasin (pas de boucle propre).
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterCats: false, filterMoments: false });
        const none = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(g.group.id)}`)).json();
        const shop = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
        const ids = (f) => (f.modules || []).map((m) => m.id).join('|');
        if (ids(none) !== ids(shop)) throw new Error('sans filtre, le secteur devrait diffuser le film du magasin');
        const nCats = new Set(all.map((pid) => catOf.get(pid))).size;
        return `catégories oui (« ${c0.name} » seule) → non (${nCats} catégories) · périodes oui/non (${target.name} masqué puis rendu) · sans filtre = film du magasin`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
        await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
        await call('DELETE', `/api/v1/groups/${g.group.id}`);
      }
    });
    await step('Promotion — sous-type dynamique + badge résolu dans le film', async () => {
      const before = await call('GET', '/api/v1/promo-types');
      const st = await call('GET', '/api/v1/state');
      // 1) Ajouter un sous-type de promotion (aller-retour PUT /promo-types)
      const extra = { id: 'ptLTTEST', name: 'Test LT', icon: '🧪', color: '#123456', descr: 'sous-type de test', active: true };
      const saved = await call('PUT', '/api/v1/promo-types', { promoTypes: [...before.promoTypes, extra] });
      try {
        const got = (saved.promoTypes || []).find((t) => t.id === 'ptLTTEST');
        if (!got || got.name !== 'Test LT' || got.color !== '#123456') throw new Error('sous-type de promotion non persisté');
        // 2) Élément « promotion » référençant ce sous-type
        const promoMod = { id: 'mPROMOLT', type: 'promotion', name: 'Happy hour -20%', sub: '16h → 18h', promoType: 'ptLTTEST', layout: 'band', dur: 7, items: [] };
        await call('PUT', '/api/v1/draft', {
          modules: [...st.modules, promoMod],
          playlists: [...st.playlists, { id: 'pl-promoLT', name: 'Film promo LT', items: ['mPROMOLT'] }],
          activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
        });
        // 3) Le film résout le badge (icône · couleur · libellé) sur le module
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-promoLT')).json();
        const m = (f.modules || []).find((x) => x.id === 'mPROMOLT');
        if (!m) throw new Error('élément promotion absent du film');
        if (m.promoType !== 'ptLTTEST') throw new Error('promoType non persisté sur le module');
        if (!m.promo || m.promo.name !== 'Test LT' || m.promo.icon !== '🧪' || m.promo.color !== '#123456') {
          throw new Error(`badge de promotion non résolu : ${JSON.stringify(m.promo)}`);
        }
        return `« ${m.name} » · badge ${m.promo.icon} ${m.promo.name} (${m.promo.color})`;
      } finally {
        // restauration : brouillon + sous-types d'origine
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        await call('PUT', '/api/v1/promo-types', { promoTypes: before.promoTypes });
      }
    });
    await step('Campagne — entité listée + contenu résolu dans le film', async () => {
      const before = await call('GET', '/api/v1/campaigns');
      const cat = await call('GET', '/api/v1/catalog');
      const prod = (cat.products || [])[0];
      const st = await call('GET', '/api/v1/state');
      // 1) Ajouter une campagne « produit » (aller-retour PUT /campaigns)
      const extra = { id: 'cmpLTTEST', name: 'Campagne LT', scope: 'produit', productRef: prod ? prod.id : '', theme: '', image: '', message: 'Offre du moment', dateFrom: '01/01', dateTo: '31/01', color: '#0A7E3D', active: true };
      const saved = await call('PUT', '/api/v1/campaigns', { campaigns: [...before.campaigns, extra] });
      try {
        const got = (saved.campaigns || []).find((c) => c.id === 'cmpLTTEST');
        if (!got || got.name !== 'Campagne LT' || got.color !== '#0A7E3D' || got.message !== 'Offre du moment') throw new Error('campagne non persistée');
        // 2) Élément « campagne » qui pointe vers cette campagne
        const campMod = { id: 'mCAMPLT', type: 'campagne', name: 'Campagne', campaignRef: 'cmpLTTEST', layout: 'cover', dur: 8, items: [] };
        await call('PUT', '/api/v1/draft', {
          modules: [...st.modules, campMod],
          playlists: [...st.playlists, { id: 'pl-campLT', name: 'Film campagne LT', items: ['mCAMPLT'] }],
          activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
        });
        // 3) Le film résout le contenu de la campagne sur le module (+ produit lié)
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-campLT')).json();
        const m = (f.modules || []).find((x) => x.id === 'mCAMPLT');
        if (!m) throw new Error('élément campagne absent du film');
        if (m.campaignRef !== 'cmpLTTEST') throw new Error('campaignRef non persisté sur le module');
        if (!m.campaign || m.campaign.name !== 'Campagne LT' || m.campaign.message !== 'Offre du moment') {
          throw new Error(`campagne non résolue : ${JSON.stringify(m.campaign)}`);
        }
        // portée produit → la photo/le prix viennent du produit lié (items[0])
        if (prod && (!m.items || !m.items[0] || m.items[0].productId !== prod.id)) throw new Error('produit lié de la campagne non résolu en item');
        return `« ${m.campaign.name} » (${m.campaign.scope}) · ${m.items && m.items[0] ? m.items[0].name : 'sans produit'}`;
      } finally {
        // restauration : brouillon + campagnes d'origine
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        await call('PUT', '/api/v1/campaigns', { campaigns: before.campaigns });
      }
    });
    await step('Gabarit HTML — code collé + variables résolues par magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const st = await call('GET', '/api/v1/state');
      const coord0 = { address: store.address || '' };
      // Document complet (doctype + head/style + body) avec variables et un
      // <script> qui doit être retiré à l'affichage.
      const code = `<!DOCTYPE html><html><head><style>.k{color:#8D1D2C}</style></head>`
        + `<body><div class="k">{{magasin}} — {{adresse}}</div><script>alert(1)</script></body></html>`;
      const htmlMod = { id: 'mHTMLLT', type: 'html', name: 'Gabarit LT', html: code, htmlW: 1080, htmlH: 1920, layout: 'fit', dur: 9, items: [] };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'HTMLADDR-LT' });
      await call('PUT', '/api/v1/draft', {
        modules: [...st.modules, htmlMod],
        playlists: [...st.playlists, { id: 'pl-htmlLT', name: 'Film gabarit LT', items: ['mHTMLLT'] }],
        activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
      });
      const f = await (await fetch(BASE + `/api/v1/film?film=pl-htmlLT&store=${encodeURIComponent(store.id)}`)).json();
      // restauration AVANT les assertions
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('POST', `/api/v1/stores/${store.id}`, coord0);
      const m = (f.modules || []).find((x) => x.id === 'mHTMLLT');
      if (!m) throw new Error('gabarit HTML absent du film');
      if (m.htmlW !== 1080 || m.htmlH !== 1920) throw new Error(`format source perdu : ${m.htmlW}×${m.htmlH}`);
      if (!m.html || !m.html.includes('.k{color:#8D1D2C}')) throw new Error('le code collé (style) n\'est pas conservé');
      if (m.html.includes('{{magasin}}')) throw new Error('{{magasin}} non résolu dans le HTML');
      if (!m.html.includes(store.store)) throw new Error('nom du magasin non injecté dans le HTML');
      if (!m.html.includes('HTMLADDR-LT')) throw new Error('{{adresse}} non résolue dans le HTML');
      return `${m.htmlW}×${m.htmlH} · « ${store.store} » + adresse injectés`;
    });
    await step('Règle photo/illustration — produit = photo, catégorie = illustration', async () => {
      const before = await call('GET', '/api/v1/catalog');
      if (!before.categories.length) return 'aucune catégorie au catalogue';
      const cats = JSON.parse(JSON.stringify(before.categories));
      cats[0].img = 'assets/sweet-tart-big.png';       // illustration de la catégorie
      await call('PUT', '/api/v1/catalog', { categories: cats, products: before.products });
      try {
        const mid = await call('GET', '/api/v1/catalog');
        const c0 = mid.categories.find((c) => c.id === cats[0].id);
        if (!c0 || c0.img !== 'assets/sweet-tart-big.png') throw new Error('illustration de catégorie non persistée');
        // un produit garde SA photo, distincte de l'illustration de sa catégorie
        const p0 = mid.products.find((p) => p.categoryId === c0.id);
        if (p0 && !p0.img) throw new Error('photo du produit perdue');
        return `catégorie « ${c0.name} » → illustration · produit → photo (${p0 ? p0.img : 'aucun produit'})`;
      } finally {
        await call('PUT', '/api/v1/catalog', { categories: before.categories, products: before.products });
      }
    });
    await step('Période sur une CATÉGORIE — retire tous ses produits hors créneau', async () => {
      const before = await call('GET', '/api/v1/product-moments');
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!c0) return 'aucune catégorie au catalogue';
      const now = before.current || 'matin';
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== now);
      try {
        // La catégorie n'est vendue QU'À un autre moment que maintenant.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: c0.id, moment: other, exception: false, kind: 'categorie' }] });
        const f = await (await fetch(BASE + '/api/v1/film?film=' + encodeURIComponent((await call('GET', '/api/v1/state')).activePlaylistId))).json();
        const pids = (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId)).filter(Boolean);
        const catOf = new Map(cat.products.map((p) => [p.id, p.categoryId]));
        if (pids.some((pid) => catOf.get(pid) === c0.id)) throw new Error(`des produits de « ${c0.name} » passent hors créneau de leur catégorie`);
        return `catégorie « ${c0.name} » vendue à ${other} → aucun de ses produits à ${now}`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: before.rows });
      }
    });
    await step('Parcours de la bibliothèque — case actif + ratio de passage', async () => {
      const st = await call('GET', '/api/v1/state');
      // Un élément de bibliothèque en paysage sert de cobaye.
      const mm = (st.modules || []).find((m) => m.orient !== 'portrait' && m.type !== 'html');
      if (!mm) return 'aucun élément de bibliothèque en paysage';
      const film = (id, itemRatios) => ({
        id, name: 'Parcours LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 12, orient: 'paysage',
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 }, itemRatios },
      });
      const put = (pls) => call('PUT', '/api/v1/draft', { modules: st.modules, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const slots = async (id) => {
        const f = await (await fetch(BASE + '/api/v1/film?film=' + id)).json();
        return (f.modules || []).filter((x) => String(x.id).startsWith('k-item-')).length;
      };
      try {
        // 1) coché → il passe. 2) décoché mais ratio gardé → il ne passe plus.
        await put([...st.playlists, film('pl-loopOnLT', [{ id: mm.id, on: true, n: 2 }])]);
        const on = await slots('pl-loopOnLT');
        await put([...st.playlists, film('pl-loopOffLT', [{ id: mm.id, on: false, n: 2 }])]);
        const off = await slots('pl-loopOffLT');
        // 3) compat : l'ancien format { id, n } vaut « actif ».
        await put([...st.playlists, film('pl-loopOldLT', [{ id: mm.id, n: 2 }])]);
        const old = await slots('pl-loopOldLT');
        if (!on) throw new Error('élément coché absent de la boucle');
        if (off) throw new Error(`élément décoché présent ${off} fois dans la boucle`);
        if (!old) throw new Error('ancien format { id, n } non reconnu comme actif');
        return `« ${mm.name || mm.id} » : coché ${on} passage(s), décoché 0, ancien format ${old}`;
      } finally {
        await put(st.playlists);
      }
    });
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
      // Coordonnées du magasin (alimentent les jetons {{adresse}}/{{horaires}}/{{tel}}).
      const coord0 = { address: store.address || '', hours: store.hours || '', phone: store.phone || '' };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'TESTADDR-live', hours: '7h-19h', phone: '010 00 00 00' });
      const fl2 = await call('GET', '/api/v1/fleet');
      const s2 = fl2.stores.find((s) => s.id === store.id);
      if (!s2 || s2.address !== 'TESTADDR-live' || s2.hours !== '7h-19h' || s2.phone !== '010 00 00 00') throw new Error('coordonnées du magasin non persistées');
      // restauration de la configuration d'origine (écrans + coordonnées)
      await call('POST', `/api/v1/stores/${store.id}`, { screens: before.screens, size: before.size, orient: before.orient, ...coord0 });
      return `${store.store} : ${out.format.label} = ${out.format.px} + coordonnées OK, restauré ${before.label}`;
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
        img: 'assets/cake.png', src: 'illus', active: true, unavailable: true, prices: { [store.id]: '7,77' },
        aliases: { nl: 'Levend testproduct' },
      };
      await call('PUT', '/api/v1/catalog', { categories: cats, products: [...before.products, testProd] });
      const mid = await call('GET', '/api/v1/catalog');
      const found = mid.products.find((p) => p.id === 'prLIVETEST');
      if (!found) throw new Error('produit test absent après enregistrement');
      if (found.prices[store.id] !== '7,77') throw new Error('prix par magasin perdu');
      if ((found.aliases || {}).nl !== 'Levend testproduct') throw new Error('alias de langue perdu (sig_aliases)');
      if (found.unavailable !== true) throw new Error('état « rupture » (unavailable) non persisté');
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
