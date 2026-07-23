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
    child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), SIG_DB: join(dir, 'test.db') },
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
    if (!Array.isArray(state.modules) || !state.modules.length) throw new Error('aucun module');
    if (!Array.isArray(state.playlist)) throw new Error('playlist absente');
    return `${state.modules.length} modules · playlist ×${state.playlist.length}`;
  });
  await step('GET /api/v1/fleet — flotte & magasins', async () => {
    const f = await call('GET', '/api/v1/fleet');
    if (!Array.isArray(f.stores)) throw new Error('stores absent');
    const n = f.stores.reduce((s, x) => s + x.players.length, 0);
    return `${f.stores.length} magasins · ${n} écrans`;
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
    if (!Array.isArray(f.modules) || !f.modules.length) throw new Error('film vide');
    if (!Array.isArray(f.playlist)) throw new Error('playlist absente');
    return `v${f.version} · d${f.dataVer} · ${f.playlist.length} module(s) au programme`;
  });
  await step('POST /api/v1/test — test de connexion live (auto-ciblé)', async () => {
    const anyToken = await firstToken();
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
    await step('PUT /api/v1/draft — aller-retour du brouillon', async () => {
      await call('PUT', '/api/v1/draft', {
        modules: state.modules, playlist: state.playlist,
        secPerLine: state.secPerLine, loop: state.loop,
      });
      const after = await call('GET', '/api/v1/state');
      if (after.modules.length !== state.modules.length) throw new Error('perte de modules après enregistrement');
      const namesBefore = JSON.stringify(state.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      const namesAfter = JSON.stringify(after.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      if (namesBefore !== namesAfter) throw new Error('brouillon modifié par l\'aller-retour');
    });
    let pub = null;
    await step('POST /api/v1/publish — playlist complète + tests auto', async () => {
      pub = await call('POST', '/api/v1/publish', { mode: 'full', targets: [], slot: 'Toute la journée', when: 'now' });
      const ok = pub.tests.filter((t) => t.ok).length;
      if (!pub.ok) throw new Error(`tests post-déploiement : ${ok}/${pub.tests.length} OK`);
      return `v${pub.version} · tests ${ok}/${pub.tests.length} OK`;
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
      if (!me) throw new Error('player absent de la flotte');
      if (me.playedVer !== pub.version) throw new Error(`flotte : v${me.playedVer} ≠ v${pub.version}`);
      return `flotte à jour : ${me.state} · v${me.playedVer}`;
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
  if (!p) throw new Error('aucun player en base');
  return p.token;
}

main().catch((e) => {
  console.error('\x1b[31mÉchec du runner :\x1b[0m', e.message || e);
  if (child) child.kill();
  process.exit(1);
});
