// Player signage — lecture plein écran du film publié, avec un cache local
// persistant : le dernier film reçu ET chacun de ses fichiers restent sur
// l'écran (IndexedDB). Au démarrage, l'écran rejoue ce cache sans attendre le
// réseau ; il ne bascule sur une nouvelle version qu'une fois TOUS ses
// fichiers réellement téléchargés (bascule atomique). Heartbeats → régie.
// URL : /player.html?id=p1&token=plyr_XXXX[&name=Vitrine][&w=3840&h=2160&fit=cover]
import { html, h, render, Component } from './vendor/preact-htm.js';
import { W, H, FUI, RUBY, renderModule, moduleDur, activeItems, scheduledNow, clx, playable } from './renderer.js';
import { snapshotAssets } from './assets.js';
import {
  offlineSupported, loadSnapshot, saveSnapshot, syncAssets, cacheStats, resolveSnapshot,
  releaseExcept, gcAssets, requestPersist, storageInfo,
} from './offline.js';
import { registerOfflineShell } from './sw-register.js';

const qs = new URLSearchParams(location.search);
const PLAYER_ID = qs.get('id') || 'web-' + Math.random().toString(36).slice(2, 8);
const TOKEN = qs.get('token') || '';
const NAME = qs.get('name') || '';
const HB_EVERY = 5000;
const CACHE_KEY = 'player:' + PLAYER_ID;
// Format d'écran optionnel : ?w=3840&h=2160&fit=cover|contain (55″ 16:9 = 3840×2160).
// Sans paramètres, le film s'adapte à la fenêtre (letterbox).
const FMT_W = parseInt(qs.get('w'), 10) || 0;
const FMT_H = parseInt(qs.get('h'), 10) || 0;
const FMT_FIT = qs.get('fit') === 'contain' ? 'contain' : 'cover';

// URLs relatives à la page → fonctionne aussi monté sous un sous-chemin.
const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();

async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

class Player extends Component {
  state = {
    phase: 'boot',           // boot | playing | error
    error: '',
    snapshot: null,          // snapshot joué (fichiers → copies locales)
    playedVer: 0,
    dataVer: 0,
    revision: null,          // film continu : révision de la boucle en cours
    syncing: false,
    cachePct: 100,
    override: false,
    fromCache: false,        // démarré sur le cache local (avant tout contact)
    offlineSince: 0,         // dernier contact réussi raté depuis… (ms), 0 = en ligne
    t: 0,
    info: true,              // bandeau d'infos (s'efface après quelques secondes)
  };
  raw = null;                // snapshot tel que reçu (URLs d'origine) — ce qu'on enregistre
  assetStats = { total: 0, cached: 0, missing: 0, external: 0, error: 0 };
  retryAt = 0;               // synchro en échec : prochaine tentative (anti-martèlement)
  retryN = 0;
  persisted = false;

  async componentDidMount() {
    if (!TOKEN) {
      this.setState({ phase: 'error', error: 'Token manquant — ajoute ?id=…&token=plyr_… à l\'URL · Token ontbreekt — voeg ?id=…&token=plyr_… toe aan de URL' });
      return;
    }
    this._resize = () => this.setState({ winW: window.innerWidth, winH: window.innerHeight });
    this._resize();
    window.addEventListener('resize', this._resize);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
    registerOfflineShell();
    requestPersist().then((p) => { this.persisted = p; });

    // 1) Le cache local d'abord : l'écran rejoue son dernier film sans réseau.
    await this.bootFromCache();
    // 2) Puis la régie.
    await this.heartbeat(true);
    this._hb = setInterval(() => this.heartbeat(false), HB_EVERY);
    this._infoT = setTimeout(() => this.setState({ info: false }), 6000);
    document.addEventListener('click', () => {
      this.setState({ info: true });
      clearTimeout(this._infoT);
      this._infoT = setTimeout(() => this.setState({ info: false }), 6000);
    });
  }
  componentWillUnmount() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._hb);
    window.removeEventListener('resize', this._resize);
  }

  async bootFromCache() {
    if (!offlineSupported) return;
    const rec = await loadSnapshot(CACHE_KEY);
    if (!rec || !rec.snap) return;
    this.raw = rec.snap;
    const st = await cacheStats(rec.snap);
    this.assetStats = { ...this.assetStats, total: st.total, cached: st.cached };
    const meta = rec.meta || {};
    this.setState({
      snapshot: await resolveSnapshot(rec.snap),
      playedVer: meta.playedVer || rec.snap.version || 0,
      dataVer: meta.dataVer || rec.snap.dataVer || 0,
      revision: meta.revision || rec.snap.revision || null,
      cachePct: st.total ? Math.round((st.cached / st.total) * 100) : 100,
      phase: 'playing', fromCache: true, t: 0,
    });
  }

  playlistMods() {
    const s = this.state.snapshot;
    if (!s) return [];
    if (s.schedule && !scheduledNow({ schedule: s.schedule }, new Date())) return [];
    const byId = new Map(s.modules.map((m) => [m.id, m]));
    const now = new Date();
    return s.playlist.map((id) => byId.get(id)).filter(Boolean).filter(playable).filter((m) => scheduledNow(m, now));
  }
  total() {
    const s = this.state.snapshot;
    const list = this.playlistMods();
    return Math.max(0.001, list.reduce((acc, m) => acc + moduleDur(m, s ? s.secPerLine : 4), 0));
  }
  current() {
    let t = this.state.t;
    const list = this.playlistMods();
    if (!list.length) return { m: null, lt: 0 };
    for (const m of list) {
      const d = moduleDur(m, this.state.snapshot.secPerLine);
      if (t < d || m === list[list.length - 1]) return { m, lt: clx(t, 0, d) };
      t -= d;
    }
    return { m: list[0], lt: 0 };
  }
  mediaLabel() {
    const { m, lt } = this.current();
    if (this.state.override) return '⚡ Diffusion flash';
    if (!m) return '—';
    if (m.type === 'liaison') return `Liaison · ${m.name}`;
    const act = activeItems(m);
    if (!act.length) return m.name;
    const idx = ((Math.floor(lt / this.state.snapshot.secPerLine) % act.length) + act.length) % act.length;
    return `${m.name} · ${act[idx].name}`;
  }

  tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.state.snapshot) {
      const total = this.total();
      let t = this.state.t + dt;
      const loop = this.state.snapshot.loop !== false;
      if (t >= total) t = loop ? t % total : total;
      this.setState({ t });
    }
    this._raf = requestAnimationFrame(this.tick);
  };

  async heartbeat(first) {
    const sto = await storageInfo();
    const disk = sto.quota ? `${((sto.quota - sto.usage) / 1e9).toFixed(1)} Go libres` : '—';
    try {
      const hb = await api('POST', `/players/${encodeURIComponent(PLAYER_ID)}/heartbeat`, {
        token: TOKEN,
        name: NAME || undefined,
        hw: 'Player web',
        state: this.state.syncing ? 'syncing' : 'playing',
        cachePct: this.state.cachePct,
        media: this.mediaLabel(),
        disk,
        temp: '—',
        playedVer: this.state.playedVer,
        dataVer: this.state.dataVer,
        // Ce que la supervision doit savoir pour ne plus mentir sur le cache.
        detail: {
          assets: this.assetStats,
          storage: { persisted: sto.persisted || this.persisted, usage: sto.usage, quota: sto.quota },
          offlineCache: offlineSupported,
          secure: !!window.isSecureContext,
          sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          fromCache: this.state.fromCache,
          offlineFor: this.state.offlineSince ? Math.round((Date.now() - this.state.offlineSince) / 1000) : 0,
        },
      });
      if (this.state.offlineSince) this.setState({ offlineSince: 0 });
      this.setState({ override: !!hb.override });
      const activateOk = !hb.activateAt || Date.parse(hb.activateAt) <= Date.now();
      const due = Date.now() >= this.retryAt;
      if ((first || hb.assignedVer !== this.state.playedVer) && activateOk && !this.state.syncing && due) {
        await this.syncTo(hb.assignedVer);
      } else if (hb.revision && hb.revision !== this.state.revision && !this.state.syncing && due) {
        // Film continu : la boucle a changé (moment/saison) → on régénère.
        await this.syncTo(this.state.playedVer || hb.assignedVer);
      } else if ((hb.storeStamp || '') !== ((this.raw && this.raw.storeStamp) || '') && this.raw && !this.state.syncing && due) {
        // Rupture déclarée (ou levée, ou expirée) par le magasin → resynchro.
        await this.syncTo(this.state.playedVer || hb.assignedVer);
      }
      if (hb.dataVer !== this.state.dataVer && this.raw && !this.state.syncing) {
        await this.syncPrices();
      }
      // Réseau revenu après un démarrage raté : on repart, sans recharger la page.
      if (this.state.phase !== 'playing' && this.state.snapshot) this.setState({ phase: 'playing', error: '' });
    } catch (e) {
      if (!this.state.offlineSince) this.setState({ offlineSince: Date.now() });
      // Sans cache ni réseau : écran d'attente explicite (il se rétablit seul).
      if (!this.state.snapshot) this.setState({ phase: 'error', error: String(e.message || e) });
    }
  }

  // Télécharge l'assignation et TOUS ses fichiers, puis bascule atomiquement.
  // Fichiers en échec réseau → on garde le film en cours et on retente plus tard.
  async syncTo(ver) {
    this.setState({ syncing: true, cachePct: 0 });
    try {
      const a = await api('GET', `/players/${encodeURIComponent(PLAYER_ID)}/assignment?token=${encodeURIComponent(TOKEN)}`);
      const snap = a.snapshot;
      const urls = snapshotAssets(snap);
      const res = await syncAssets(urls, { onProgress: ({ done: d, total: n }) => this.setState({ cachePct: n ? Math.round((d / n) * 100) : 100 }) });
      const stats = { total: res.total, cached: res.ok.length, missing: res.missing.length, external: res.external.length, error: res.error.length, quota: res.quota };
      if (res.error.length && this.state.snapshot) {
        // Le film en cours continue ; nouvelle tentative avec un délai croissant.
        this.retryN += 1;
        this.retryAt = Date.now() + Math.min(300000, 15000 * this.retryN);
        this.assetStats = stats;
        this.setState({ syncing: false, cachePct: stats.total ? Math.round((stats.cached / stats.total) * 100) : 100 });
        return;
      }
      this.retryN = 0; this.retryAt = 0;
      const meta = { playedVer: a.assignedVer || snap.version || ver, dataVer: snap.dataVer || a.dataVer || 0, revision: a.revision || snap.revision || null };
      this.raw = snap;
      await saveSnapshot(CACHE_KEY, snap, meta);
      const resolved = await resolveSnapshot(snap);
      this.assetStats = stats;
      this.setState({
        snapshot: resolved,
        ...meta,
        syncing: false,
        cachePct: stats.total ? Math.round((stats.cached / stats.total) * 100) : 100,
        t: 0,
        override: !!a.override,
        fromCache: false,
        phase: 'playing', error: '',
      });
      releaseExcept(snap);
      gcAssets();
    } catch (e) {
      this.retryN += 1;
      this.retryAt = Date.now() + Math.min(300000, 15000 * this.retryN);
      this.setState({ syncing: false, cachePct: this.assetStats.total ? Math.round((this.assetStats.cached / this.assetStats.total) * 100) : this.state.cachePct });
      if (!this.state.snapshot) this.setState({ phase: 'error', error: String(e.message || e) });
    }
  }

  // Sync incrémentale légère : applique le dataset de prix sans re-télécharger de média.
  async syncPrices() {
    try {
      const d = await api('GET', `/datasets/latest?token=${encodeURIComponent(TOKEN)}`);
      const snap = JSON.parse(JSON.stringify(this.raw));
      const byId = new Map((d.prices || []).map((p) => [p.moduleId, p.items]));
      for (const m of snap.modules) {
        const items = byId.get(m.id);
        if (!items) continue;
        m.items = (m.items || []).map((it, i) => (items[i]
          ? { ...it, name: items[i].name, price: items[i].price, active: items[i].active }
          : it));
      }
      this.raw = snap;
      await saveSnapshot(CACHE_KEY, snap, { playedVer: this.state.playedVer, dataVer: d.dataVer, revision: this.state.revision });
      this.setState({ snapshot: await resolveSnapshot(snap), dataVer: d.dataVer });
    } catch { /* on garde les prix du cache local */ }
  }

  render() {
    const st = this.state;
    if (st.phase === 'error' && !st.snapshot) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#B8B2A8;background:#0a0a0a;font-family:${FUI};padding:40px;text-align:center;">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.8;" />
        <div style="font-size:16px;color:#fff;">Player non connecté · Speler niet verbonden</div>
        <div style="font-size:13px;max-width:520px;">${st.error}</div>
        <div style="font-size:12px;opacity:0.7;">Nouvelle tentative automatique… · Automatisch opnieuw proberen…</div>
      </div>`;
    }
    if (!st.snapshot) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;background:#0a0a0a;font-family:${FUI};">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.85;" />
        <div style="color:#B8B2A8;font-size:14px;">${st.syncing ? `Synchronisation · Synchronisatie… ${st.cachePct}%` : 'Connexion · Verbinden…'}</div>
        <div style="width:280px;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;">
          <div style="height:100%;background:${RUBY};width:${st.cachePct}%;transition:width .2s;"></div>
        </div>
      </div>`;
    }

    let content;
    let portrait = false;
    if (st.override) {
      content = h('div', { style: { position: 'absolute', inset: 0, background: RUBY, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 120 } },
        h('img', { src: 'assets/logo-white.png', style: { height: 500, width: 'auto' } }),
        h('div', { style: { fontFamily: FUI, fontWeight: 600, fontSize: 180, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff' } }, '⚡ Diffusion flash'),
        h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: 80, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' } }, 'playlists suspendues par la régie'));
    } else {
      const { m, lt } = this.current();
      // Écran plus haut que large (sans « adapter ») : composition portrait dans la dalle du milieu.
      // Sans format dans l'adresse, c'est la fenêtre qui dit l'orientation.
      const ww = st.winW || window.innerWidth, wh = st.winH || window.innerHeight;
      portrait = FMT_W > 0 && FMT_H > 0 ? (FMT_W < FMT_H && FMT_FIT !== 'contain') : ww < wh;
      // Rien de programmé à cette heure : le logo seul, sans texte — les
      // clients le voient, quelle que soit la langue du magasin.
      content = m
        ? renderModule(h, m, lt, { secPerLine: st.snapshot.secPerLine, portrait })
        : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          h('img', { src: 'assets/logo.png', style: { height: 420 } }));
    }

    // Boîte au ratio demandé (?w=&h=&fit=) ou plein cadre par défaut.
    const winW = st.winW || window.innerWidth;
    const winH = st.winH || window.innerHeight;
    let bw = winW, bh = winH, fit = FMT_FIT;
    if (FMT_W > 0 && FMT_H > 0) {
      const ratio = FMT_W / FMT_H;
      if (bw / bh > ratio) bw = Math.round(bh * ratio); else bh = Math.round(bw / ratio);
    } else {
      // Écran portrait sans format : la dalle du milieu, en plein écran (composition portrait).
      fit = portrait ? 'cover' : 'contain';
    }
    const scale = fit === 'contain' ? Math.min(bw / W, bh / H) : Math.max(bw / W, bh / H);
    const stage = h('div', {
      style: { position: 'absolute', left: (bw - W * scale) / 2, top: (bh - H * scale) / 2, width: W, height: H, background: '#F5EFE4', transform: `scale(${scale})`, transformOrigin: 'top left' },
    }, content);

    const a = this.assetStats;
    const offline = !!st.offlineSince;
    const dot = offline ? '#C0392B' : (st.syncing ? '#B8860B' : '#5BBE7A');
    return html`
      <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:${bw}px;height:${bh}px;overflow:hidden;background:#F5EFE4;">
        ${stage}
      </div>
      ${st.info && html`
        <div style="position:fixed;left:16px;bottom:16px;display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;background:rgba(10,10,10,0.75);color:#fff;font-family:${FUI};font-size:12.5px;backdrop-filter:blur(6px);">
          <span style="width:8px;height:8px;border-radius:50%;background:${dot};"></span>
          <span>${PLAYER_ID} · v${st.playedVer} · d${st.dataVer} · cache ${a.cached}/${a.total}${a.missing ? ` · ${a.missing} absent(s)` : ''}${st.syncing ? ` · sync ${st.cachePct}%` : ''}${offline ? ' · hors ligne' : ''}${st.fromCache ? ' · depuis le cache' : ''}</span>
        </div>
      `}
    `;
  }
}

render(h(Player), document.getElementById('root'));
