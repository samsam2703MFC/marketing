// Player signage — lecture plein écran de la playlist publiée, cache local,
// heartbeats + bascule atomique (le nouveau snapshot ne remplace l'ancien que
// lorsque tous ses médias sont préchargés).
// URL : /player.html?id=p1&token=plyr_XXXX[&name=Vitrine][&screens=3]
import { html, h, render, Component } from './vendor/preact-htm.js';
import { W, H, FUI, RUBY, renderModule, moduleDur, activeItems, scheduledNow, clx , playable } from './renderer.js';

const qs = new URLSearchParams(location.search);
const PLAYER_ID = qs.get('id') || 'web-' + Math.random().toString(36).slice(2, 8);
const TOKEN = qs.get('token') || '';
const NAME = qs.get('name') || '';
const HB_EVERY = 5000;
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
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// Précharge tous les médias d'un snapshot ; onProgress(pct) à chaque image.
async function prefetchMedia(snapshot, onProgress) {
  const urls = (snapshot.media || []).filter((u) => typeof u === 'string' && !u.startsWith('data:'));
  let done = 0;
  if (!urls.length) { onProgress(100); return; }
  await Promise.all(urls.map((u) => new Promise((resolve) => {
    const img = new Image();
    const fin = () => { done++; onProgress(Math.round((done / urls.length) * 100)); resolve(); };
    img.onload = fin; img.onerror = fin;
    img.src = u;
  })));
}

class Player extends Component {
  state = {
    phase: 'boot',           // boot | playing | error
    error: '',
    snapshot: null,          // snapshot en cours de lecture (bascule atomique)
    playedVer: 0,
    dataVer: 0,
    syncing: false,
    cachePct: 100,
    override: false,
    t: 0,
    scale: 1,
    info: true,              // bandeau d'infos (s'efface après quelques secondes)
  };

  async componentDidMount() {
    if (!TOKEN) {
      this.setState({ phase: 'error', error: 'Token manquant — ajoute ?id=…&token=plyr_… à l\'URL' });
      return;
    }
    this._resize = () => this.setState({ winW: window.innerWidth, winH: window.innerHeight });
    this._resize();
    window.addEventListener('resize', this._resize);

    this._last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
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
    let disk = '—';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota) disk = `${((est.quota - (est.usage || 0)) / 1e9).toFixed(1)} Go libres`;
      }
    } catch { /* estimation indisponible */ }
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
      });
      this.setState({ override: !!hb.override });
      const activateOk = !hb.activateAt || Date.parse(hb.activateAt) <= Date.now();
      if ((first || hb.assignedVer !== this.state.playedVer) && activateOk && !this.state.syncing) {
        await this.syncTo(hb.assignedVer);
      }
      if (hb.dataVer !== this.state.dataVer && this.state.snapshot) {
        await this.syncPrices();
      }
      if (this.state.phase === 'boot') this.setState({ phase: 'playing' });
    } catch (e) {
      if (this.state.phase === 'boot') this.setState({ phase: 'error', error: String(e.message || e) });
    }
  }

  // Télécharge l'assignation, précharge les médias, puis bascule atomiquement.
  async syncTo(ver) {
    this.setState({ syncing: true, cachePct: 0 });
    try {
      const a = await api('GET', `/players/${encodeURIComponent(PLAYER_ID)}/assignment?token=${encodeURIComponent(TOKEN)}`);
      const snap = a.snapshot;
      await prefetchMedia(snap, (pct) => this.setState({ cachePct: pct }));
      this.setState({
        snapshot: snap,
        playedVer: a.assignedVer || snap.version || ver,
        dataVer: snap.dataVer || a.dataVer || 0,
        syncing: false,
        cachePct: 100,
        t: 0,
        override: !!a.override,
      });
    } catch (e) {
      this.setState({ syncing: false });
      if (!this.state.snapshot) this.setState({ phase: 'error', error: String(e.message || e) });
    }
  }

  // Sync incrémentale légère : applique le dataset de prix sans re-télécharger de média.
  async syncPrices() {
    try {
      const d = await api('GET', `/datasets/latest?token=${encodeURIComponent(TOKEN)}`);
      const snap = JSON.parse(JSON.stringify(this.state.snapshot));
      const byId = new Map((d.prices || []).map((p) => [p.moduleId, p.items]));
      for (const m of snap.modules) {
        const items = byId.get(m.id);
        if (!items) continue;
        m.items = (m.items || []).map((it, i) => (items[i]
          ? { ...it, name: items[i].name, price: items[i].price, active: items[i].active }
          : it));
      }
      this.setState({ snapshot: snap, dataVer: d.dataVer });
    } catch { /* on garde les prix du cache local */ }
  }

  render() {
    const st = this.state;
    if (st.phase === 'error') {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#B8B2A8;background:#0a0a0a;font-family:${FUI};padding:40px;text-align:center;">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.8;" />
        <div style="font-size:16px;color:#fff;">Player non connecté</div>
        <div style="font-size:13px;max-width:520px;">${st.error}</div>
      </div>`;
    }
    if (!st.snapshot) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;background:#0a0a0a;font-family:${FUI};">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.85;" />
        <div style="color:#B8B2A8;font-size:14px;">${st.syncing ? `Synchronisation… ${st.cachePct}%` : 'Connexion au CMS…'}</div>
        <div style="width:280px;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;">
          <div style="height:100%;background:${RUBY};width:${st.cachePct}%;transition:width .2s;"></div>
        </div>
      </div>`;
    }

    let content;
    if (st.override) {
      content = h('div', { style: { position: 'absolute', inset: 0, background: RUBY, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 120 } },
        h('img', { src: 'assets/logo-white.png', style: { height: 500, width: 'auto' } }),
        h('div', { style: { fontFamily: FUI, fontWeight: 600, fontSize: 180, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff' } }, '⚡ Diffusion flash'),
        h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: 80, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' } }, 'playlists suspendues par la régie'));
    } else {
      const { m, lt } = this.current();
      content = m
        ? renderModule(h, m, lt, { secPerLine: st.snapshot.secPerLine })
        : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 90, alignItems: 'center', justifyContent: 'center' } },
          h('img', { src: 'assets/logo.png', style: { height: 420 } }),
          h('div', { style: { fontFamily: FUI, fontSize: 90, color: '#8A847C', letterSpacing: '0.14em', textTransform: 'uppercase' } }, 'aucun module programmé sur ce créneau'));
    }

    // Boîte au ratio demandé (?w=&h=&fit=) ou plein cadre par défaut.
    const winW = st.winW || window.innerWidth;
    const winH = st.winH || window.innerHeight;
    let bw = winW, bh = winH, fit = FMT_FIT;
    if (FMT_W > 0 && FMT_H > 0) {
      const ratio = FMT_W / FMT_H;
      if (bw / bh > ratio) bw = Math.round(bh * ratio); else bh = Math.round(bw / ratio);
    } else {
      fit = 'contain';
    }
    const scale = fit === 'contain' ? Math.min(bw / W, bh / H) : Math.max(bw / W, bh / H);
    const stage = h('div', {
      style: { position: 'absolute', left: (bw - W * scale) / 2, top: (bh - H * scale) / 2, width: W, height: H, background: '#F5EFE4', transform: `scale(${scale})`, transformOrigin: 'top left' },
    }, content);

    return html`
      <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:${bw}px;height:${bh}px;overflow:hidden;background:#F5EFE4;">
        ${stage}
      </div>
      ${st.info && html`
        <div style="position:fixed;left:16px;bottom:16px;display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;background:rgba(10,10,10,0.75);color:#fff;font-family:${FUI};font-size:12.5px;backdrop-filter:blur(6px);">
          <span style="width:8px;height:8px;border-radius:50%;background:${st.syncing ? '#B8860B' : '#5BBE7A'};"></span>
          <span>${PLAYER_ID} · playlist v${st.playedVer} · prix d${st.dataVer}${st.syncing ? ` · sync ${st.cachePct}%` : ''}</span>
        </div>
      `}
    `;
  }
}

render(h(Player), document.getElementById('root'));
