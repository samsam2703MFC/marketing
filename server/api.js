// API REST du CMS signage — /api/v1/*
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDb, getSetting, setSetting, getIntSetting,
  loadModules, loadPlaylist, saveDraft, DB_PATH,
  checkLogin, createSession, sessionUser, destroySession,
} from './db.js';
import { loginAllowed, loginFailed, loginSucceeded } from './auth.js';
import { runConnectionTest, runDeployTests, tcpPing } from './livetest.js';

function sessionToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = /(?:^|;\s*)sig_session=([A-Za-z0-9]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

const ONLINE_WINDOW_S = 30; // heartbeat attendu toutes les ~5 s

const nowIso = () => new Date().toISOString();
const secsSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)) : null);

function playerRow(id) {
  return getDb().prepare('SELECT * FROM sig_players WHERE id = ?').get(id);
}
function authPlayer(id, token) {
  const p = playerRow(id);
  if (!p || !token || p.token !== token) return null;
  return p;
}

// ---------------------------------------------------------------------------
export function stateJson() {
  return {
    version: getIntSetting('version', 1),
    dataVer: getIntSetting('data_ver', 1),
    override: getSetting('override', '0') === '1',
    secPerLine: parseFloat(getSetting('sec_per_line', '4')),
    loop: getSetting('loop', '1') === '1',
    modules: loadModules(),
    playlist: loadPlaylist(),
    settings: {
      srvUrl: getSetting('srv_url', ''),
      srvIp: getSetting('srv_ip', ''),
      srvToken: getSetting('srv_token', ''),
    },
    server: { now: nowIso(), db: DB_PATH },
  };
}

export function fleetJson() {
  const db = getDb();
  const stores = db.prepare('SELECT * FROM sig_stores ORDER BY id').all();
  const players = db.prepare('SELECT * FROM sig_players ORDER BY store_id, id').all();
  const byStore = new Map(stores.map((s) => [s.id, { id: s.id, store: s.name, group: s.grp, conn: s.conn, players: [] }]));
  for (const p of players) {
    const seen = secsSince(p.last_seen);
    const online = seen != null && seen <= ONLINE_WINDOW_S;
    const state = online ? (p.state === 'probe' ? 'playing' : p.state) : 'offline';
    const st = byStore.get(p.store_id);
    if (!st) continue;
    st.players.push({
      id: p.id, name: p.name, hw: p.hw, kiosk: !!p.kiosk, orient: p.orient,
      state,
      playedVer: p.played_ver, assignedVer: p.assigned_ver, dataVer: p.data_ver,
      dataAge: secsSince(p.data_at) ?? 999999,
      syncAgo: seen ?? 999999,
      cache: p.cache_pct, media: p.media, disk: p.disk, temp: p.temp,
      token: p.token,
    });
  }
  const out = [...byStore.values()].filter((s) => s.players.length > 0);
  for (const s of out) {
    const anyOnline = s.players.some((p) => p.state !== 'offline');
    if (!anyOnline) s.conn = 'offline';
  }
  return {
    stores: out,
    version: getIntSetting('version', 1),
    dataVer: getIntSetting('data_ver', 1),
    override: getSetting('override', '0') === '1',
    now: nowIso(),
  };
}

// ---------------------------------------------------------------------------
function collectMedia(modules) {
  const media = new Set();
  for (const m of modules) {
    if (m.tag && m.tag.enabled && m.tag.img) media.add(m.tag.img);
    for (const it of m.items || []) if (it.img) media.add(it.img);
  }
  media.add('assets/logo.png');
  return [...media];
}

async function publish({ mode, targets, slot, when, activateAt, baseUrl, publicDir }) {
  const db = getDb();
  const allStores = db.prepare('SELECT id FROM sig_stores').all().map((s) => s.id);
  const targetIds = (targets && targets.length ? targets : allStores).filter((t) => allStores.includes(t));
  const qMarks = targetIds.map(() => '?').join(',');
  const targetedPlayers = targetIds.length
    ? db.prepare(`SELECT * FROM sig_players WHERE store_id IN (${qMarks})`).all(...targetIds)
    : [];

  const modules = loadModules();
  const playlist = loadPlaylist();
  let version;
  let payload;

  if (mode === 'data') {
    version = getIntSetting('data_ver', 1) + 1;
    payload = {
      kind: 'data', dataVer: version, generatedAt: nowIso(),
      prices: modules.map((m) => ({
        moduleId: m.id,
        items: (m.items || []).map((it) => ({ name: it.name, price: it.price, active: it.active })),
      })),
    };
    setSetting('data_ver', version);
  } else {
    version = getIntSetting('version', 1) + 1;
    payload = {
      kind: 'playlist', version, generatedAt: nowIso(),
      secPerLine: parseFloat(getSetting('sec_per_line', '4')),
      loop: getSetting('loop', '1') === '1',
      dataVer: getIntSetting('data_ver', 1),
      modules, playlist,
      media: collectMedia(modules),
    };
    setSetting('version', version);
  }

  db.prepare('INSERT INTO sig_snapshots(kind, version, payload) VALUES (?, ?, ?)')
    .run(mode === 'data' ? 'data' : 'playlist', version, JSON.stringify(payload));

  if (mode !== 'data') {
    const act = when === 'scheduled' && activateAt ? activateAt : null;
    const upd = db.prepare('UPDATE sig_players SET assigned_ver = ?, activate_at = ? WHERE store_id = ?');
    for (const st of targetIds) upd.run(version, act, st);
  }

  // Tests live post-déploiement — vraies requêtes HTTP contre le CMS qui vient de publier.
  const tests = await runDeployTests({
    baseUrl,
    mode: mode === 'data' ? 'data' : 'full',
    version,
    players: targetedPlayers.map((p) => ({ id: p.id, token: p.token })),
    mediaCheck: async () => {
      if (mode === 'data') { JSON.parse(JSON.stringify(payload)); return []; }
      return payload.media
        .filter((m) => typeof m === 'string' && !m.startsWith('data:'))
        .filter((m) => !existsSync(join(publicDir, m)));
    },
  });

  const pub = db.prepare(`INSERT INTO sig_publications(mode, version, targets, slot, activate_at, tests)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    mode === 'data' ? 'data' : 'full', version, JSON.stringify(targetIds),
    slot || 'Toute la journée', when === 'scheduled' ? (activateAt || null) : null, JSON.stringify(tests)
  );

  return {
    ok: tests.every((t) => t.ok),
    publicationId: Number(pub.lastInsertRowid),
    mode: mode === 'data' ? 'data' : 'full',
    version,
    targets: targetIds,
    playerCount: targetedPlayers.length,
    tests,
  };
}

// ---------------------------------------------------------------------------
function heartbeat(id, body, url) {
  const db = getDb();
  let p = playerRow(id);
  const token = body.token || url.searchParams.get('token') || '';

  if (!p) {
    // Auto-enregistrement d'un nouveau player (utile pour tester en live).
    if (!/^plyr_[A-Za-z0-9_-]{4,}$/.test(token)) return { status: 401, json: { error: 'unknown player / bad token' } };
    db.prepare(`INSERT OR IGNORE INTO sig_stores(id, name, grp, conn) VALUES ('st-new', 'Nouveaux écrans', 'Auto-enregistrés', 'fibre')`).run();
    db.prepare(`INSERT INTO sig_players(id, store_id, name, hw, kiosk, orient, token, state, played_ver, assigned_ver, data_ver, cache_pct, media, disk, temp)
      VALUES (?, 'st-new', ?, ?, 1, ?, ?, 'idle', 0, ?, 0, 0, '—', '—', '—')`).run(
      id, String(body.name || `Player ${id}`), String(body.hw || 'Player web'),
      String(body.orient || 'Paysage'), token, getIntSetting('version', 1)
    );
    p = playerRow(id);
  }
  if (p.token !== token) return { status: 401, json: { error: 'bad token' } };

  if (!body.probe) {
    const state = ['playing', 'syncing', 'error', 'idle'].includes(body.state) ? body.state : 'playing';
    const dataVer = Number.isFinite(+body.dataVer) ? +body.dataVer : p.data_ver;
    db.prepare(`UPDATE sig_players SET state = ?, cache_pct = ?, media = ?, disk = ?, temp = ?,
      played_ver = ?, data_ver = ?, last_seen = ?, data_at = CASE WHEN ? != data_ver THEN ? ELSE COALESCE(data_at, ?) END
      WHERE id = ?`).run(
      state,
      Math.max(0, Math.min(100, Math.round(+body.cachePct >= 0 ? +body.cachePct : p.cache_pct))),
      String(body.media || p.media), String(body.disk || p.disk), String(body.temp || p.temp),
      Number.isFinite(+body.playedVer) ? +body.playedVer : p.played_ver,
      dataVer, nowIso(), dataVer, nowIso(), nowIso(), id
    );
    db.prepare('INSERT INTO sig_heartbeats(player_id, state, cache_pct, media, disk, temp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, String(body.state || ''), Math.round(+body.cachePct || 0), String(body.media || ''), String(body.disk || ''), String(body.temp || ''));
  }

  return {
    status: 200,
    json: {
      ok: true,
      probe: !!body.probe,
      assignedVer: playerRow(id).assigned_ver,
      activateAt: playerRow(id).activate_at,
      dataVer: getIntSetting('data_ver', 1),
      override: getSetting('override', '0') === '1',
      serverTime: nowIso(),
    },
  };
}

function assignment(id, url) {
  const p = authPlayer(id, url.searchParams.get('token'));
  if (!p) return { status: 401, json: { error: 'unauthorized' } };
  const snap = getDb().prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version = ?`).get(p.assigned_ver);
  return {
    status: 200,
    json: {
      playerId: p.id,
      assignedVer: p.assigned_ver,
      activateAt: p.activate_at,
      dataVer: getIntSetting('data_ver', 1),
      override: getSetting('override', '0') === '1',
      snapshot: snap ? JSON.parse(snap.payload) : currentDraftSnapshot(),
    },
  };
}

// Le « film » public : dernière playlist publiée (ou brouillon si rien n'a
// jamais été publié), avec le dernier snapshot de prix appliqué. Lecture seule,
// sans token — c'est le contenu affiché en vitrine.
// Avec ?store=<id> : la version actuellement assignée à CE magasin (lien
// direct par magasin, partageable).
function filmJson(storeId) {
  const db = getDb();
  let snap = null;
  let storeName = null;
  if (storeId) {
    const store = db.prepare('SELECT * FROM sig_stores WHERE id = ?').get(storeId);
    if (!store) return { status: 404, json: { error: `magasin inconnu : ${storeId}` } };
    storeName = store.name;
    const row = db.prepare('SELECT MAX(assigned_ver) AS v FROM sig_players WHERE store_id = ?').get(storeId);
    if (row && row.v) {
      const s = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version <= ? ORDER BY version DESC LIMIT 1`).get(row.v);
      if (s) snap = JSON.parse(s.payload);
    }
  }
  if (!snap) {
    const snapRow = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' ORDER BY version DESC LIMIT 1`).get();
    snap = snapRow ? JSON.parse(snapRow.payload) : currentDraftSnapshot();
  }
  const dv = getIntSetting('data_ver', 1);
  const dataRow = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'data' AND version = ?`).get(dv);
  if (dataRow) {
    const prices = JSON.parse(dataRow.payload).prices || [];
    const byId = new Map(prices.map((p) => [p.moduleId, p.items]));
    for (const m of snap.modules || []) {
      const items = byId.get(m.id);
      if (!items) continue;
      m.items = (m.items || []).map((it, i) => (items[i]
        ? { ...it, name: items[i].name, price: items[i].price, active: items[i].active }
        : it));
    }
  }
  snap.dataVer = dv;
  snap.override = getSetting('override', '0') === '1';
  snap.storeId = storeId || null;
  snap.storeName = storeName;
  return { status: 200, json: snap };
}

// Si aucune publication n'existe encore pour la version assignée, on sert le brouillon courant.
function currentDraftSnapshot() {
  return {
    kind: 'playlist',
    version: getIntSetting('version', 1),
    generatedAt: nowIso(),
    secPerLine: parseFloat(getSetting('sec_per_line', '4')),
    loop: getSetting('loop', '1') === '1',
    dataVer: getIntSetting('data_ver', 1),
    modules: loadModules(),
    playlist: loadPlaylist(),
    media: collectMedia(loadModules()),
  };
}

function latestDataset(url) {
  const token = url.searchParams.get('token') || '';
  const known = getDb().prepare('SELECT 1 AS ok FROM sig_players WHERE token = ?').get(token);
  if (!known) return { status: 401, json: { error: 'unauthorized' } };
  const dv = getIntSetting('data_ver', 1);
  const snap = getDb().prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'data' AND version = ?`).get(dv);
  if (snap) return { status: 200, json: { dataVer: dv, ...JSON.parse(snap.payload) } };
  return {
    status: 200,
    json: {
      dataVer: dv, kind: 'data', generatedAt: nowIso(),
      prices: loadModules().map((m) => ({
        moduleId: m.id,
        items: (m.items || []).map((it) => ({ name: it.name, price: it.price, active: it.active })),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Routage
export async function handleApi(req, res, url, readBody, ctx, pathname) {
  const setCookies = [];
  const send = (status, json) => {
    const buf = Buffer.from(JSON.stringify(json));
    const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' };
    if (setCookies.length) headers['set-cookie'] = setCookies;
    res.writeHead(status, headers);
    res.end(buf);
  };
  const path = (pathname || url.pathname).replace(/^\/api\/v1/, '') || '/';
  const m = (re) => path.match(re);
  let mm;

  try {
    if (req.method === 'GET' && path === '/health') {
      let dbOk = true;
      try { getDb().prepare('SELECT 1').get(); } catch { dbOk = false; }
      return send(dbOk ? 200 : 500, {
        ok: dbOk, service: 'signage-cms', now: nowIso(),
        version: getIntSetting('version', 1), dataVer: getIntSetting('data_ver', 1),
        tablePrefix: 'sig_',
      });
    }

    // ---- session back office ------------------------------------------------
    if (req.method === 'POST' && path === '/login') {
      const ip = req.socket.remoteAddress || '?';
      if (!loginAllowed(ip)) return send(429, { error: 'Trop de tentatives — réessaie dans une minute' });
      const body = await readBody();
      if (!checkLogin(body.username, body.password)) {
        loginFailed(ip);
        return send(401, { error: 'Identifiants invalides' });
      }
      loginSucceeded(ip);
      const token = createSession(String(body.username));
      setCookies.push(`sig_session=${token}; Path=${ctx.cookiePath}; HttpOnly; SameSite=Lax; Max-Age=2592000`);
      return send(200, { ok: true, user: String(body.username), token });
    }
    if (req.method === 'POST' && path === '/logout') {
      destroySession(sessionToken(req));
      setCookies.push(`sig_session=; Path=${ctx.cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0`);
      return send(200, { ok: true });
    }

    // ---- film public (visionneuse plein écran, lecture seule) ---------------
    if (req.method === 'GET' && path === '/film') {
      const out = filmJson(url.searchParams.get('store') || null);
      return send(out.status, out.json);
    }

    // ---- endpoints players (auth par token de player) -----------------------
    if (req.method === 'GET' && (mm = m(/^\/players\/([\w-]+)\/assignment$/))) {
      const out = assignment(mm[1], url);
      return send(out.status, out.json);
    }
    if (req.method === 'POST' && (mm = m(/^\/players\/([\w-]+)\/heartbeat$/))) {
      const body = await readBody();
      const out = heartbeat(mm[1], body, url);
      return send(out.status, out.json);
    }
    if (req.method === 'GET' && path === '/datasets/latest') {
      const out = latestDataset(url);
      return send(out.status, out.json);
    }
    if (req.method === 'GET' && (mm = m(/^\/snapshots\/(\d+)$/))) {
      const token = url.searchParams.get('token') || '';
      const known = getDb().prepare('SELECT 1 AS ok FROM sig_players WHERE token = ?').get(token);
      if (!known) return send(401, { error: 'unauthorized' });
      const snap = getDb().prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version = ?`).get(+mm[1]);
      if (!snap) return send(404, { error: 'snapshot introuvable' });
      return send(200, JSON.parse(snap.payload));
    }

    // ---- tout le reste exige une session back office ------------------------
    const user = sessionUser(sessionToken(req));
    if (!user) return send(401, { error: 'Authentification requise' });

    if (req.method === 'GET' && path === '/me') return send(200, { ok: true, user });
    if (req.method === 'GET' && path === '/state') return send(200, stateJson());
    if (req.method === 'GET' && path === '/fleet') return send(200, fleetJson());

    if (req.method === 'PUT' && path === '/draft') {
      const body = await readBody();
      if (!Array.isArray(body.modules) || body.modules.length === 0) return send(400, { error: 'modules requis' });
      saveDraft(body);
      return send(200, { ok: true, savedAt: nowIso() });
    }

    if (req.method === 'POST' && path === '/settings') {
      const body = await readBody();
      if (body.srvUrl != null) setSetting('srv_url', String(body.srvUrl));
      if (body.srvIp != null) setSetting('srv_ip', String(body.srvIp));
      if (body.srvToken != null) setSetting('srv_token', String(body.srvToken));
      return send(200, { ok: true });
    }

    if (req.method === 'POST' && path === '/publish') {
      const body = await readBody();
      const out = await publish({
        mode: body.mode === 'data' ? 'data' : 'full',
        targets: Array.isArray(body.targets) ? body.targets : [],
        slot: body.slot, when: body.when, activateAt: body.activateAt,
        baseUrl: `${ctx.selfBase(req)}/api/v1`, publicDir: ctx.publicDir,
      });
      return send(200, out);
    }

    if (req.method === 'POST' && path === '/push-prices') {
      const out = await publish({ mode: 'data', targets: [], baseUrl: `${ctx.selfBase(req)}/api/v1`, publicDir: ctx.publicDir });
      return send(200, out);
    }

    if (req.method === 'POST' && path === '/override') {
      const body = await readBody();
      setSetting('override', body.on ? '1' : '0');
      return send(200, { ok: true, override: body.on ? true : false });
    }

    if (req.method === 'POST' && path === '/test') {
      const body = await readBody();
      const token = String(body.token || '');
      const p = getDb().prepare('SELECT id FROM sig_players WHERE token = ?').get(token);
      const rows = await runConnectionTest({
        baseUrl: body.url || `${ctx.selfBase(req)}/api/v1`,
        ip: String(body.ip || ''),
        playerId: p ? p.id : null,
        token,
      });
      return send(200, { ok: rows.every((r) => r.ok), rows });
    }

    if (req.method === 'GET' && path === '/publications') {
      const rows = getDb().prepare('SELECT * FROM sig_publications ORDER BY id DESC LIMIT 20').all()
        .map((r) => ({ ...r, targets: JSON.parse(r.targets), tests: JSON.parse(r.tests) }));
      return send(200, { publications: rows });
    }

    if (req.method === 'GET' && path === '/ping-host') {
      const host = url.searchParams.get('host') || '';
      if (!host) return send(400, { error: 'host requis' });
      const r = await tcpPing(host);
      return send(200, r);
    }

    return send(404, { error: `route inconnue : ${req.method} ${path}` });
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
}
