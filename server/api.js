// API REST du CMS signage — /api/v1/*
import { existsSync, readdirSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDb, getSetting, setSetting, getIntSetting,
  loadModules, loadPlaylist, loadPlaylists, activePlaylistId, saveDraft, storeFormat, DB_PATH,
  loadElementTypes, loadCatalog, saveCatalog, applyStorePrices, applyStoreLang, applyStoreTokens, loadLangs,
  loadSeasons, saveSeasons, currentSeasons, currentMoment,
  loadMedia, addMediaRow, getMediaRow, delMediaRow,
  loadProductMoments, saveProductMoments, SALE_MOMENTS, currentSaleMoment,
  buildContinuous, continuousRevision, normContinuous,
  loadScreenGroups, screenGroupById, saveScreenGroup, deleteScreenGroup, setPlayerGroup,
  loadPlan, savePlan, planFilmAt, setActiveWeek, duplicateWeek,
  checkLogin, createSession, sessionUser, destroySession,
} from './db.js';
import { loginAllowed, loginFailed, loginSucceeded } from './auth.js';
import { publicPwaConfig, savePwaConfig, resetPwaConfig, testPwa, importPwa, pwaBaseName, importSeasons, inspectSeasons } from './pwadb.js';
import { scheduleMirror, syncMirror, mirrorStatus } from './mirror.js';
import { runConnectionTest, runDeployTests, tcpPing } from './livetest.js';

function sessionToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = /(?:^|;\s*)sig_session=([A-Za-z0-9]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

const ONLINE_WINDOW_S = 30; // heartbeat attendu toutes les ~5 s

// ---- vidéo « surprise » : dossier serveur de vidéos, piochées au hasard -----
const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURPRISE_DIR = join(API_ROOT, 'public', 'surprise');
const MEDIA_DIR = join(API_ROOT, 'public', 'media');
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function mediaList() {
  return loadMedia().map((m) => ({ ...m, url: 'media/' + encodeURIComponent(m.filename), present: existsSync(join(MEDIA_DIR, m.filename)) }));
}

function listSurprise() {
  try {
    if (!existsSync(SURPRISE_DIR)) return [];
    return readdirSync(SURPRISE_DIR)
      .filter((n) => VIDEO_EXT.has(extname(n).toLowerCase()))
      .sort()
      .map((n) => {
        let size = 0;
        try { size = statSync(join(SURPRISE_DIR, n)).size; } catch { /* ignore */ }
        return { name: n, url: 'surprise/' + encodeURIComponent(n), size };
      });
  } catch { return []; }
}

// Élément « média ciblé » : pioche au hasard un média de la médiathèque agence
// dont le moment (matin/midi/aprem) correspond à l'instant courant et dont la
// saison est active (ou vide). Le player affiche la vidéo/photo tirée au sort.
function resolveMediaElements(modules, date) {
  if (!Array.isArray(modules)) return;
  let all = null, moment = null, active = null;
  for (const m of modules) {
    if (!m || m.type !== 'media') continue;
    if (all === null) {
      all = loadMedia();
      moment = currentMoment(date);
      active = new Set(currentSeasons(date).map((s) => s.id));
    }
    const list = all.filter((mm) => (mm.moment === moment || mm.moment === 'all') && (!mm.seasonId || active.has(mm.seasonId)));
    m.mediaMoment = moment;
    m.mediaCount = list.length;
    m.mediaTotal = all.length;
    if (list.length) {
      const pick = list[Math.floor(Math.random() * list.length)];
      m.mediaKind = pick.kind;
      m.mediaUrl = 'media/' + encodeURIComponent(pick.filename);
      if (pick.kind === 'film') m.video = m.mediaUrl; // réutilise le rendu vidéo
    }
  }
}

// Attache la liste des vidéos du dossier aux éléments « surprise » et en pioche
// une au hasard (le player joue m.video ; la pioche change à chaque requête).
function resolveSurprise(modules) {
  if (!Array.isArray(modules)) return;
  let vids = null;
  for (const m of modules) {
    if (!m || !m.surprise) continue;
    if (!vids) vids = listSurprise();
    m.surpriseVideos = vids.map((v) => v.url);
    m.surpriseCount = vids.length;
    if (vids.length) m.video = vids[Math.floor(Math.random() * vids.length)].url;
  }
}

// Urls des vidéos surprise — alimente le mode continu (db.js ne fait pas d'I/O).
function surpriseUrls() { return listSurprise().map((v) => v.url); }

// Si le film servi est en mode « continu », remplace ses modules par une boucle
// composée en direct (catalogue + saisons + moments + tags). Les modules sont
// auto-suffisants : ils jouent tels quels sur l'écran comme dans la visionneuse.
// Renvoie true si une régénération a eu lieu.
function applyContinuous(snap, date) {
  if (!snap || !snap.playlistId) return false;
  const film = loadPlaylists().find((p) => p.id === snap.playlistId);
  if (!film || film.mode !== 'continu') return false;
  const gen = buildContinuous(film.continuous, date, { surprise: surpriseUrls() });
  snap.modules = gen.modules;
  snap.playlist = gen.playlist;
  snap.media = gen.media;
  snap.continuous = true;
  snap.revision = gen.revision;
  snap.continuousMeta = gen.meta;
  return true;
}
// Groupe d'écrans à filtre de catégories : remplace le contenu du snapshot par
// une boucle continue des catégories du groupe, TOUTE LA JOURNÉE (ni moment ni
// saison). Renvoie true si le contenu a été remplacé (groupe avec catégories) ;
// false si le groupe n'a pas de filtre (→ garder le film du magasin).
function applyGroupContent(snap, group, date) {
  let cats = [];
  try { cats = JSON.parse(group.cats || '[]'); } catch { cats = []; }
  if (!cats.length) return false;
  const cfg = normContinuous({ source: 'tout', perMoment: false, order: 'catalogue', catsInclude: cats,
    ratios: { liaison: 0, produitSeul: 1, media: 0, animation: 0, surprise: 0 }, maxItems: 40, fallback: 'tout' });
  const gen = buildContinuous(cfg, date, { surprise: surpriseUrls() });
  snap.modules = gen.modules; snap.playlist = gen.playlist; snap.media = gen.media;
  snap.continuous = true; snap.revision = gen.revision; snap.continuousMeta = gen.meta;
  snap.playlistName = group.name; snap.zoneCats = cats;
  return true;
}
// Finition d'un snapshot avant diffusion : prix + langue du magasin, puis
// pioche des vidéos surprise et des médias ciblés. UN SEUL endroit, appelé par
// la visionneuse ET les écrans, pour qu'ils ne divergent jamais (la boucle
// continue, elle, est régénérée juste avant par applyContinuous).
function finishSnapshot(snap, storeId, date = new Date()) {
  if (!snap || !Array.isArray(snap.modules)) return snap;
  applyStorePrices(snap.modules, storeId);
  applyStoreLang(snap.modules, storeId);
  applyStoreTokens(snap.modules, storeId, date);
  resolveSurprise(snap.modules);
  resolveMediaElements(snap.modules, date);
  return snap;
}
// Révision continue du film actuellement assigné à un player (ou null).
function continuousRevisionForVer(ver) {
  if (!ver) return null;
  const row = getDb().prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version = ?`).get(ver);
  const pid = row ? (JSON.parse(row.payload).playlistId || null) : null;
  if (!pid) return null;
  const film = loadPlaylists().find((p) => p.id === pid);
  return (film && film.mode === 'continu') ? continuousRevision(film.continuous, new Date()) : null;
}

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
    playlists: loadPlaylists(),
    activePlaylistId: activePlaylistId(),
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
  const byStore = new Map(stores.map((s) => [s.id, { id: s.id, store: s.name, group: s.grp, conn: s.conn, format: storeFormat(s), lang: s.lang || 'fr', address: s.address || '', hours: s.hours || '', phone: s.phone || '', groups: loadScreenGroups(s.id), active: s.active == null ? true : !!s.active, players: [] }]));
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
      token: p.token, groupId: p.group_id || '',
    });
  }
  // Les magasins sans écran restent visibles (on peut préparer combo, langue
  // et lien avant de brancher l'écran) — seul le bac interne « st-new » vide
  // est masqué.
  const out = [...byStore.values()].filter((s) => s.players.length > 0 || s.id !== 'st-new');
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
// Rapport public (lecture seule) : tout ce qui va être diffusé — bibliothèque
// de films, playlists (avec leurs éléments), planning et écrans — pour un lien
// partageable, sans connexion (comme /film).
export function reportJson() {
  const db = getDb();
  const stores = db.prepare('SELECT * FROM sig_stores ORDER BY id').all()
    .filter((s) => s.id !== 'st-new')
    .map((s) => ({
      id: s.id, name: s.name, group: s.grp,
      format: storeFormat(s), lang: s.lang || 'fr',
      active: s.active == null ? true : !!s.active,
    }));
  return {
    meta: {
      brand: "L'Atelier By",
      generatedAt: nowIso(),
      version: getIntSetting('version', 1),
      dataVer: getIntSetting('data_ver', 1),
    },
    secPerLine: parseFloat(getSetting('sec_per_line', '4')),
    loop: getSetting('loop', '1') === '1',
    ...(() => {
      const modules = loadModules();
      resolveSurprise(modules); resolveMediaElements(modules, new Date());
      const playlists = loadPlaylists();
      // Films continus : on injecte leur boucle générée (aperçu « maintenant »)
      // dans la liste globale, avec des ids préfixés pour éviter les collisions.
      const date = new Date();
      for (const pl of playlists) {
        if (pl.mode !== 'continu') continue;
        const gen = buildContinuous(pl.continuous, date, { surprise: surpriseUrls() });
        const mapped = gen.modules.map((mm) => ({ ...mm, id: `${pl.id}~${mm.id}` }));
        for (const mm of mapped) modules.push(mm);
        pl.items = mapped.map((mm) => mm.id);
        pl.continuousMeta = gen.meta;
      }
      return { modules, playlists };
    })(),
    activePlaylistId: activePlaylistId(),
    plan: loadPlan(),
    stores,
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

function cleanSchedule(s) {
  if (!s || typeof s !== 'object') return null;
  const days = Array.isArray(s.days) && s.days.length === 7 ? s.days.map(Boolean) : [true, true, true, true, true, true, true];
  const time = (v, fb) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : fb);
  return { days, from: time(s.from, '00:00'), to: time(s.to, '23:59') };
}

async function publish({ mode, targets, slot, when, activateAt, playlistId, schedule, baseUrl, publicDir }) {
  const db = getDb();
  const modules = loadModules();
  const playlists = loadPlaylists();
  const film = playlists.find((p) => p.id === playlistId)
    || playlists.find((p) => p.id === activePlaylistId())
    || playlists[0]
    || { id: 'pl1', name: 'Film principal', items: [], schedule: null, stores: [] };
  const playlist = film.items;

  // Cibles : explicites, sinon les magasins du film, sinon tout le réseau.
  const allStores = db.prepare('SELECT id FROM sig_stores').all().map((s) => s.id);
  const filmStores = Array.isArray(film.stores) ? film.stores : [];
  const wanted = (targets && targets.length) ? targets
    : (mode !== 'data' && filmStores.length ? filmStores : allStores);
  const targetIds = wanted.filter((t) => allStores.includes(t));
  const qMarks = targetIds.map(() => '?').join(',');
  const targetedPlayers = targetIds.length
    ? db.prepare(`SELECT * FROM sig_players WHERE store_id IN (${qMarks})`).all(...targetIds)
    : [];

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
      playlistId: film.id, playlistName: film.name,
      schedule: cleanSchedule(schedule || film.schedule),
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
    film: mode === 'data' ? null : { id: film.id, name: film.name },
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
      // Film continu : révision courante (change au moment/saison) → resync écran.
      revision: continuousRevisionForVer(playerRow(id).assigned_ver),
      override: getSetting('override', '0') === '1',
      serverTime: nowIso(),
    },
  };
}

function assignment(id, url) {
  const p = authPlayer(id, url.searchParams.get('token'));
  if (!p) return { status: 401, json: { error: 'unauthorized' } };
  const date = new Date();
  const snap = getDb().prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version = ?`).get(p.assigned_ver);
  const snapshot = snap ? JSON.parse(snap.payload) : currentDraftSnapshot();
  // Groupe d'écrans : un player rattaché à un groupe prend SON contenu et SON
  // format. Groupe avec catégories → boucle continue de ces catégories TOUTE LA
  // JOURNÉE (ni moment ni saison). Groupe sans catégorie → film du magasin.
  const group = p.group_id ? screenGroupById(p.group_id) : null;
  // Groupe avec catégories → sa boucle ; sinon (pas de groupe, ou groupe sans
  // filtre) → film du magasin (boucle continue régénérée en direct).
  if (!(group && applyGroupContent(snapshot, group, date))) applyContinuous(snapshot, date);
  if (group) { snapshot.groupId = group.id; snapshot.groupName = group.name; snapshot.format = storeFormat(group); }
  // Même finition que la visionneuse (prix/langue + jetons + surprise + média) :
  // les écrans ne divergent plus du rendu de la visionneuse.
  finishSnapshot(snapshot, p.store_id, date);
  return {
    status: 200,
    json: {
      playerId: p.id,
      assignedVer: p.assigned_ver,
      groupId: group ? group.id : null,
      activateAt: p.activate_at,
      dataVer: getIntSetting('data_ver', 1),
      revision: snapshot.revision || null,
      override: getSetting('override', '0') === '1',
      snapshot,
    },
  };
}

// Le « film » public : dernière playlist publiée (ou brouillon si rien n'a
// jamais été publié), avec le dernier snapshot de prix appliqué. Lecture seule,
// sans token — c'est le contenu affiché en vitrine.
// Avec ?store=<id> : la version actuellement assignée à CE magasin.
// Avec ?film=<id> : la dernière publication de CE film (lien par film) ;
// s'il n'a jamais été publié, sa composition enregistrée est servie en
// prévisualisation (draft: true).
function filmJson(storeId, filmId, groupId) {
  const db = getDb();
  let snap = null;
  let storeName = null;
  let storeFmt = null;
  // Aperçu d'un groupe d'écrans : base = film du magasin du groupe, puis on
  // remplace par la boucle catégories du groupe (voir plus bas). Le groupe prime.
  let group = null;
  if (groupId) {
    group = screenGroupById(groupId);
    if (!group) return { status: 404, json: { error: `groupe inconnu : ${groupId}` } };
    storeId = group.store_id;
    filmId = null;
  }
  if (filmId) {
    const pls = loadPlaylists();
    const film = pls.find((p) => p.id === filmId);
    // Une publication peut exister pour ce film même s'il a été renommé/supprimé
    // depuis (snapshot orphelin) : on la sert quand même. On ne renvoie 404 que
    // si NI film courant NI publication ne correspondent à cet id.
    const rows = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' ORDER BY version DESC LIMIT 200`).all();
    for (const r of rows) {
      const p = JSON.parse(r.payload);
      if ((p.playlistId || 'pl1') === filmId) { snap = p; break; }
    }
    if (!film && !snap) return { status: 404, json: { error: `film inconnu : ${filmId}` } };
    if (!snap) {
      snap = { ...currentDraftSnapshot(), playlistId: film.id, playlistName: film.name, playlist: film.items, draft: true };
    } else if (!snap.playlistName && film) {
      snap.playlistName = film.name;
    }
  } else if (storeId) {
    const store = db.prepare('SELECT * FROM sig_stores WHERE id = ?').get(storeId);
    if (!store) return { status: 404, json: { error: `magasin inconnu : ${storeId}` } };
    storeName = store.name;
    storeFmt = storeFormat(store);
    // Planning journalier : si le magasin a un plan, le(s) film(s) du moment
    // courant priment. Plusieurs films → joués l'un après l'autre (concaténés).
    const planned = planFilmAt(storeId, new Date());
    if (planned && planned.films.length) {
      const pls = loadPlaylists();
      const snapOf = (fid) => {
        const pf = pls.find((p) => p.id === fid);
        if (!pf) return null;
        const rows = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' ORDER BY version DESC LIMIT 200`).all();
        for (const r of rows) { const p = JSON.parse(r.payload); if ((p.playlistId || 'pl1') === pf.id) return p; }
        return { ...currentDraftSnapshot(), playlistId: pf.id, playlistName: pf.name, playlist: pf.items, draft: true };
      };
      const snaps = planned.films.map(snapOf).filter(Boolean);
      if (snaps.length === 1) {
        snap = snaps[0];
      } else if (snaps.length > 1) {
        // Concaténation : modules dédupliqués, playlist = enchaînement des films.
        const modules = [];
        const seen = new Set();
        for (const s of snaps) for (const m of s.modules || []) if (!seen.has(m.id)) { seen.add(m.id); modules.push(m); }
        snap = {
          ...snaps[0],
          playlistName: planned.films.map((fid) => (pls.find((p) => p.id === fid) || {}).name).filter(Boolean).join(' + '),
          modules,
          playlist: snaps.flatMap((s) => s.playlist || []),
        };
      }
      if (snap) snap.plan = { moment: planned.label, window: planned.window, films: snaps.length, week: planned.week, day: planned.day };
    }
    if (!snap) {
      const row = db.prepare('SELECT MAX(assigned_ver) AS v FROM sig_players WHERE store_id = ?').get(storeId);
      if (row && row.v) {
        const s = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' AND version <= ? ORDER BY version DESC LIMIT 1`).get(row.v);
        if (s) snap = JSON.parse(s.payload);
      }
    }
    // Aucune publication ne correspond à la version assignée à ce magasin
    // (état initial) : on montre le brouillon du film destiné à ce magasin
    // (premier film qui le cible ou qui vise tout le réseau), PAS la
    // publication d'un autre magasin.
    if (!snap) {
      const pls = loadPlaylists();
      const filmFor = pls.find((p) => !(p.stores || []).length || (p.stores || []).includes(storeId)) || pls[0];
      snap = {
        ...currentDraftSnapshot(),
        ...(filmFor ? { playlistId: filmFor.id, playlistName: filmFor.name, playlist: filmFor.items } : {}),
        draft: true,
      };
    }
  }
  if (!snap) {
    const snapRow = db.prepare(`SELECT payload FROM sig_snapshots WHERE kind = 'playlist' ORDER BY version DESC LIMIT 1`).get();
    snap = snapRow ? JSON.parse(snapRow.payload) : currentDraftSnapshot();
  }
  // Mode continu : régénère la boucle en direct (avant prix/langue/résolutions).
  applyContinuous(snap, new Date());
  // Aperçu d'un groupe d'écrans : sa boucle catégories (toute la journée) et son
  // format remplacent le film du magasin.
  if (group) {
    applyGroupContent(snap, group, new Date());
    storeFmt = storeFormat(group);
    snap.groupId = group.id; snap.groupName = group.name; snap.playlistName = group.name;
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
  snap.format = storeFmt;
  // Prix + langue du magasin, surprise, média ciblé — résolution partagée avec
  // les écrans (le lien ?store= montre SES prix, dans SA langue).
  finishSnapshot(snap, storeId, new Date());
  return { status: 200, json: snap };
}

// Si aucune publication n'existe encore pour la version assignée, on sert le brouillon courant.
function currentDraftSnapshot() {
  const pls = loadPlaylists();
  const film = pls.find((p) => p.id === activePlaylistId()) || pls[0] || { id: 'pl1', name: 'Film principal' };
  return {
    kind: 'playlist',
    version: getIntSetting('version', 1),
    generatedAt: nowIso(),
    playlistId: film.id, playlistName: film.name,
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
      const out = filmJson(url.searchParams.get('store') || null, url.searchParams.get('film') || null, url.searchParams.get('group') || null);
      return send(out.status, out.json);
    }

    // ---- rapport public (lecture seule) : bibliothèque, planning, écrans ----
    if (req.method === 'GET' && path === '/report') return send(200, reportJson());

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
    const role = user === 'agence' ? 'agence' : 'admin';

    if (req.method === 'GET' && path === '/me') return send(200, { ok: true, user, role });

    // ---- médiathèque agence (upload vidéos/photos taguées) -----------------
    // Accessible admin ET agence ; l'agence n'a accès QU'À ça (+ catalogue &
    // périodes en lecture, pour remplir les tags du formulaire).
    if (req.method === 'GET' && path === '/media') return send(200, { dir: 'public/media', media: mediaList() });
    if (req.method === 'POST' && path === '/media') {
      const body = await readBody();
      const kind = body.kind === 'photo' ? 'photo' : 'film';
      const rawName = String(body.name || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const mData = /^data:[\w/+.-]+;base64,(.+)$/s.exec(String(body.dataUrl || ''));
      if (!rawName || !mData) return send(400, { error: 'nom ou fichier manquant' });
      const ext = extname(rawName).toLowerCase();
      if (!(kind === 'photo' ? IMAGE_EXT.has(ext) : VIDEO_EXT.has(ext))) return send(400, { error: kind === 'photo' ? 'format image non supporté (.jpg, .png, .webp…)' : 'format vidéo non supporté (.mp4, .webm, .mov…)' });
      const buf = Buffer.from(mData[1], 'base64');
      if (buf.length > 18 * 1024 * 1024) return send(413, { error: 'fichier trop lourd pour l’upload (max 18 Mo) — dépose-le dans public/media/ sur le serveur' });
      const moment = ['matin', 'midi', 'aprem'].includes(body.moment) ? body.moment : 'all';
      // Convention agence : préfixe selon le moment (1_ matin · 2_ midi · 3_ après-midi).
      const filename = ({ matin: '1_', midi: '2_', aprem: '3_', all: '' })[moment] + rawName;
      try { mkdirSync(MEDIA_DIR, { recursive: true }); } catch { /* déjà là */ }
      writeFileSync(join(MEDIA_DIR, filename), buf);
      const media = addMediaRow({ id: 'md' + Date.now().toString(36), filename, kind, moment, productId: body.productId, seasonId: body.seasonId, size: buf.length });
      scheduleMirror();
      return send(200, { ok: true, media: media.map((x) => ({ ...x, url: 'media/' + encodeURIComponent(x.filename), present: existsSync(join(MEDIA_DIR, x.filename)) })) });
    }
    if (req.method === 'DELETE' && (mm = m(/^\/media\/(.+)$/))) {
      const row = getMediaRow(decodeURIComponent(mm[1]));
      if (row) {
        const f = join(MEDIA_DIR, row.filename);
        if (f.startsWith(MEDIA_DIR) && existsSync(f)) { try { unlinkSync(f); } catch { /* déjà supprimé */ } }
        delMediaRow(row.id);
      }
      scheduleMirror();
      return send(200, { ok: true, media: mediaList() });
    }

    // L'agence n'accède qu'à sa médiathèque (+ catalogue & périodes en lecture).
    if (role === 'agence') {
      const okAgency = req.method === 'GET' && (path === '/catalog' || path === '/seasons');
      if (!okAgency) return send(403, { error: 'Accès agence : réservé à la médiathèque vidéo' });
    }

    if (req.method === 'GET' && path === '/state') return send(200, stateJson());
    if (req.method === 'GET' && path === '/fleet') return send(200, fleetJson());

    // ---- types d'éléments & table produits (rien en dur : tout en base) ----
    if (req.method === 'GET' && path === '/element-types') return send(200, { types: loadElementTypes() });
    if (req.method === 'GET' && path === '/langs') return send(200, { langs: loadLangs() });

    // ---- vidéos « surprise » (dossier serveur, piochées au hasard) ---------
    if (req.method === 'GET' && path === '/surprise') {
      return send(200, { dir: 'public/surprise', videos: listSurprise() });
    }
    if (req.method === 'POST' && path === '/surprise') {
      const body = await readBody();
      const name = String(body.name || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const mData = /^data:[\w/+.-]+;base64,(.+)$/s.exec(String(body.dataUrl || ''));
      if (!name || !mData) return send(400, { error: 'nom ou vidéo manquant' });
      if (!VIDEO_EXT.has(extname(name).toLowerCase())) return send(400, { error: 'format vidéo non supporté (.mp4, .webm, .mov…)' });
      const buf = Buffer.from(mData[1], 'base64');
      if (buf.length > 18 * 1024 * 1024) return send(413, { error: 'vidéo trop lourde pour l’upload (max 18 Mo) — dépose-la directement dans public/surprise/ sur le serveur' });
      try { mkdirSync(SURPRISE_DIR, { recursive: true }); } catch { /* déjà là */ }
      writeFileSync(join(SURPRISE_DIR, name), buf);
      return send(200, { ok: true, videos: listSurprise() });
    }
    if (req.method === 'DELETE' && (mm = m(/^\/surprise\/(.+)$/))) {
      const name = basename(decodeURIComponent(mm[1]));
      const f = join(SURPRISE_DIR, name);
      if (f.startsWith(SURPRISE_DIR) && existsSync(f)) { try { unlinkSync(f); } catch { /* déjà supprimé */ } }
      return send(200, { ok: true, videos: listSurprise() });
    }

    // ---- miroir MySQL (tables sig_* consultables dans phpMyAdmin) -----------
    if (req.method === 'GET' && path === '/mirror') return send(200, mirrorStatus());
    if (req.method === 'POST' && path === '/mirror') {
      const out = await syncMirror();
      return send(200, out);
    }

    // ---- planning hebdo (magasins × semaine A–E × jour × moments) ----------
    if (req.method === 'GET' && path === '/plan') return send(200, loadPlan());
    if (req.method === 'POST' && path === '/plan') {
      const body = await readBody();
      if (!Array.isArray(body.stores) || !body.stores.length) return send(400, { error: 'stores requis' });
      const out = savePlan({ stores: body.stores, week: body.week, day: body.day, slots: body.slots || {}, windows: body.windows });
      scheduleMirror();
      return send(200, { ok: true, ...out, savedAt: nowIso() });
    }
    if (req.method === 'POST' && path === '/plan/active') {
      const body = await readBody();
      const out = setActiveWeek(body.week);
      scheduleMirror();
      return send(200, { ok: true, ...out, savedAt: nowIso() });
    }
    if (req.method === 'POST' && path === '/plan/duplicate') {
      const body = await readBody();
      if (!Array.isArray(body.stores) || !body.stores.length) return send(400, { error: 'stores requis' });
      const out = duplicateWeek({ stores: body.stores, from: body.from, to: body.to });
      scheduleMirror();
      return send(200, { ok: true, ...out, savedAt: nowIso() });
    }
    // ---- périodes de l'année (saisons) : manuel + import ws_season ---------
    if (req.method === 'GET' && path === '/seasons') {
      return send(200, { seasons: loadSeasons(), current: currentSeasons().map((s) => s.id) });
    }
    if (req.method === 'PUT' && path === '/seasons') {
      const body = await readBody();
      const out = saveSeasons(body.seasons || []);
      scheduleMirror();
      return send(200, { ok: true, seasons: out, current: currentSeasons().map((s) => s.id) });
    }
    if (req.method === 'POST' && path === '/seasons/import') {
      try {
        const body = await readBody();
        const det = await importSeasons(body.table);
        if (!det.seasons.length) {
          const insp = det.inspected || [];
          const cand = (det.candidates && det.candidates.length) ? ` — tables candidates dans « ${det.db} » : ${det.candidates.join(', ')}` : ` (base « ${det.db} »)`;
          const last = insp.length ? insp[insp.length - 1] : null;
          const colHint = last ? ` · colonnes de « ${last.table} » : ${(last.types || last.columns).join(', ')}` : '';
          return send(200, { ok: false, error: (det.table ? `table « ${det.table} » : colonnes de dates introuvables${colHint}` : `aucune table ws_season trouvée${cand}`), candidates: det.candidates || [], inspected: insp, db: det.db });
        }
        // On remplace les périodes importées (préfixe ws_) et on garde les manuelles.
        // Robustesse : si l'import ne fournit pas d'illustration pour une période,
        // on conserve celle déjà enregistrée (saisie en régie ou import précédent)
        // — un lien d'image ajouté à product_availability_period a la priorité.
        const existing = loadSeasons();
        const prevImg = new Map(existing.map((s) => [s.id, s.image || '']));
        const manual = existing.filter((s) => !String(s.id).startsWith('ws_'));
        const merged = det.seasons.map((s) => (s.image || !prevImg.get(s.id)) ? s : { ...s, image: prevImg.get(s.id) });
        const out = saveSeasons([...manual, ...merged]);
        scheduleMirror();
        return send(200, { ok: true, table: det.table, imported: det.seasons.length, colsUsed: det.colsUsed || null, seasons: out, current: currentSeasons().map((s) => s.id) });
      } catch (e) {
        return send(200, { ok: false, error: String(e.message || e) });
      }
    }
    // Diagnostic (lecture seule) : liste les colonnes réelles des tables de
    // périodes candidates et signale la colonne d'illustration détectée.
    if (req.method === 'POST' && path === '/seasons/inspect') {
      try {
        const body = await readBody();
        const det = await inspectSeasons(body.table);
        const insp = det.inspected || [];
        const withImg = insp.filter((t) => t.imageCol);
        return send(200, {
          ok: insp.length > 0,
          db: det.db,
          inspected: insp,
          imageFound: withImg.length > 0,
          imageCols: withImg.map((t) => ({ table: t.table, column: t.imageCol, sample: t.imageSample })),
          error: insp.length ? '' : `aucune table de périodes lisible (base « ${det.db || '?'} »)`,
        });
      } catch (e) {
        return send(200, { ok: false, error: String(e.message || e), inspected: [] });
      }
    }

    // ---- périodes de vente (produit × moment matin/midi/aprem + exception) --
    if (req.method === 'GET' && path === '/product-moments') {
      return send(200, { moments: SALE_MOMENTS, rows: loadProductMoments(), current: currentSaleMoment() });
    }
    if (req.method === 'PUT' && path === '/product-moments') {
      const body = await readBody();
      const out = saveProductMoments(body.rows || []);
      scheduleMirror();
      return send(200, { ok: true, rows: out, current: currentSaleMoment() });
    }

    if (req.method === 'GET' && path === '/catalog') return send(200, loadCatalog());
    if (req.method === 'PUT' && path === '/catalog') {
      const body = await readBody();
      if (!Array.isArray(body.categories) || !Array.isArray(body.products)) {
        return send(400, { error: 'categories et products requis' });
      }
      saveCatalog(body);
      scheduleMirror();
      return send(200, { ok: true, ...loadCatalog(), savedAt: nowIso() });
    }

    // ---- connexion directe à la base PWA (product / shop_product / …) ------
    if (req.method === 'GET' && path === '/pwa-config') return send(200, publicPwaConfig());
    if (req.method === 'POST' && path === '/pwa-config') {
      const body = await readBody();
      return send(200, savePwaConfig(body));
    }
    if (req.method === 'POST' && path === '/pwa-reset') return send(200, resetPwaConfig());
    if (req.method === 'POST' && path === '/pwa-test') {
      try { return send(200, await testPwa()); }
      catch (e) { return send(200, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && path === '/pwa-import') {
      try {
        // La base MySQL détectée à l'import devient la cible du miroir.
        if (getDb() && !getSetting('mirror_db', '')) { const b = await pwaBaseName(); if (b) setSetting('mirror_db', b); }
        const out = await importPwa();
        scheduleMirror();
        return send(200, out);
      } catch (e) { return send(200, { ok: false, error: String(e.message || e) }); }
    }

    if (req.method === 'PUT' && path === '/draft') {
      const body = await readBody();
      if (!Array.isArray(body.modules) || body.modules.length === 0) return send(400, { error: 'modules requis' });
      saveDraft(body);
      scheduleMirror();
      return send(200, { ok: true, savedAt: nowIso() });
    }

    if (req.method === 'POST' && path === '/settings') {
      const body = await readBody();
      if (body.srvUrl != null) setSetting('srv_url', String(body.srvUrl));
      if (body.srvIp != null) setSetting('srv_ip', String(body.srvIp));
      if (body.srvToken != null) setSetting('srv_token', String(body.srvToken));
      // Stockage / streaming HD (adresse + identifiants) — documenté, utilisable
      // pour héberger les vidéos HD hors du serveur local.
      if (body.hdUrl != null) setSetting('hd_url', String(body.hdUrl));
      if (body.hdUser != null) setSetting('hd_user', String(body.hdUser));
      if (body.hdPass != null && String(body.hdPass) !== '') setSetting('hd_pass', String(body.hdPass));
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && path === '/hd-storage') {
      return send(200, { hdUrl: getSetting('hd_url', ''), hdUser: getSetting('hd_user', ''), hasHdPass: !!getSetting('hd_pass', '') });
    }

    // Configuration d'un magasin : nom + combo d'écrans (ex. 3 × 55″ portrait).
    {
      const mSt = path.match(/^\/stores\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'POST' && mSt) {
        const db = getDb();
        const store = db.prepare('SELECT * FROM sig_stores WHERE id = ?').get(mSt[1]);
        if (!store) return send(404, { error: `magasin inconnu : ${mSt[1]}` });
        const body = await readBody();
        const name = body.name != null && String(body.name).trim() ? String(body.name).trim().slice(0, 120) : store.name;
        const screens = Math.min(6, Math.max(1, parseInt(body.screens, 10) || store.screens || 1));
        const size = Math.min(120, Math.max(20, parseInt(body.size, 10) || store.screen_size || 55));
        const orient = body.orient === 'portrait' ? 'portrait' : (body.orient === 'paysage' ? 'paysage' : store.screen_orient || 'paysage');
        const langIds = new Set(loadLangs().map((l) => l.id));
        const lang = body.lang != null && langIds.has(String(body.lang)) ? String(body.lang) : (store.lang || 'fr');
        const address = body.address != null ? String(body.address).slice(0, 200) : (store.address || '');
        const hours = body.hours != null ? String(body.hours).slice(0, 200) : (store.hours || '');
        const phone = body.phone != null ? String(body.phone).slice(0, 40) : (store.phone || '');
        db.prepare('UPDATE sig_stores SET name = ?, screens = ?, screen_size = ?, screen_orient = ?, lang = ?, address = ?, hours = ?, phone = ? WHERE id = ?')
          .run(name, screens, size, orient, lang, address, hours, phone, store.id);
        const updated = db.prepare('SELECT * FROM sig_stores WHERE id = ?').get(store.id);
        scheduleMirror();
        return send(200, { ok: true, id: store.id, name: updated.name, lang: updated.lang, address: updated.address, hours: updated.hours, phone: updated.phone, format: storeFormat(updated) });
      }
    }

    // Groupes d'écrans d'un magasin (zones à filtre de catégories).
    {
      const mGrpNew = path.match(/^\/stores\/([A-Za-z0-9_-]+)\/groups$/);
      if (req.method === 'POST' && mGrpNew) {
        const store = getDb().prepare('SELECT id FROM sig_stores WHERE id = ?').get(mGrpNew[1]);
        if (!store) return send(404, { error: `magasin inconnu : ${mGrpNew[1]}` });
        const body = await readBody();
        const out = saveScreenGroup(store.id, body);
        scheduleMirror();
        return send(200, { ok: true, group: out, groups: loadScreenGroups(store.id) });
      }
      const mGrpId = path.match(/^\/groups\/([A-Za-z0-9_-]+)$/);
      if (mGrpId) {
        const g = screenGroupById(mGrpId[1]);
        if (!g) return send(404, { error: `groupe inconnu : ${mGrpId[1]}` });
        if (req.method === 'POST') {
          const out = saveScreenGroup(g.store_id, { ...(await readBody()), id: g.id });
          scheduleMirror();
          return send(200, { ok: true, group: out, groups: loadScreenGroups(g.store_id) });
        }
        if (req.method === 'DELETE') {
          deleteScreenGroup(g.id);
          scheduleMirror();
          return send(200, { ok: true, groups: loadScreenGroups(g.store_id) });
        }
      }
      const mPg = path.match(/^\/players\/([\w-]+)\/group$/);
      if (req.method === 'POST' && mPg) {
        const ok = setPlayerGroup(mPg[1], (await readBody()).groupId || '');
        if (!ok) return send(400, { error: 'rattachement impossible (magasins différents)' });
        return send(200, { ok: true });
      }
    }

    if (req.method === 'POST' && path === '/publish') {
      const body = await readBody();
      const out = await publish({
        mode: body.mode === 'data' ? 'data' : 'full',
        targets: Array.isArray(body.targets) ? body.targets : [],
        slot: body.slot, when: body.when, activateAt: body.activateAt,
        playlistId: body.playlistId || null,
        schedule: body.schedule || null,
        baseUrl: `${ctx.selfBase(req)}/api/v1`, publicDir: ctx.publicDir,
      });
      scheduleMirror();
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
