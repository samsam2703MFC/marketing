// Visionneuse publique du film — lecture plein écran de la dernière playlist
// publiée (prix à jour), sans connexion ni token. URL : /film
//
// Choix du format d'écran (pixels + ratio) : presets 55″ 16:9 (standard),
// portrait 9:16, Full HD, mur 3 dalles natif, ou dimensions personnalisées.
// Paramètres d'URL : ?w=3840&h=2160&fit=cover|contain (mémorisés), donc une
// TV/box peut être pointée directement sur son format.
import { html, h, render, Component } from './vendor/preact-htm.js';
import { W, H, FUI, RUBY, renderModule, moduleDur, scheduledNow, playable, clx } from './renderer.js';
import { snapshotAssets } from './assets.js';
import { offlineSupported, loadSnapshot, saveSnapshot, syncAssets, cacheStats, resolveSnapshot, releaseExcept, gcAssets, requestPersist } from './offline.js';
import { registerOfflineShell } from './sw-register.js';

const REFRESH_MS = 30000;
const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
// Lien par magasin : /film?store=st1 → version actuellement assignée à ce magasin.
// Lien par film : /film?film=pl1 → dernière publication de ce film.
// Lien par groupe d'écrans : /film?group=g1 → boucle catégories de cette zone.
const STORE = new URLSearchParams(location.search).get('store') || '';
const FILM = new URLSearchParams(location.search).get('film') || '';
const GROUP = new URLSearchParams(location.search).get('group') || '';
// Cache local (IndexedDB) propre à CE lien : un écran branché sur ?store=…
// rejoue son dernier film sans réseau, fichiers compris.
const CACHE_KEY = 'film:' + (GROUP ? `group=${GROUP}` : FILM ? `film=${FILM}` : STORE ? `store=${STORE}` : 'all');
const filmApi = () => {
  const q = new URLSearchParams();
  if (GROUP) q.set('group', GROUP);          // le groupe prime (comme côté serveur)
  else if (FILM) q.set('film', FILM);
  else if (STORE) q.set('store', STORE);
  const s = q.toString();
  return apiUrl(`/film${s ? `?${s}` : ''}`);
};

const PRESETS = [
  { id: 'tv55', label: '55″ TV · 16:9', w: 3840, h: 2160 },
  { id: 'tv55p', label: '55″ portrait · 9:16', w: 2160, h: 3840 },
  { id: 'fhd', label: 'Full HD · 16:9', w: 1920, h: 1080 },
  { id: 'wall', label: 'Mur 3 dalles · natif', w: 6480, h: 3840 },
];

// Format explicite dans l'URL (?w=&h=) : prioritaire sur tout le reste.
const URL_FMT = (() => {
  const qs = new URLSearchParams(location.search);
  return parseInt(qs.get('w'), 10) > 0 && parseInt(qs.get('h'), 10) > 0;
})();

function initialFormat() {
  const qs = new URLSearchParams(location.search);
  const w = parseInt(qs.get('w'), 10);
  const hh = parseInt(qs.get('h'), 10);
  const fit = qs.get('fit') === 'contain' ? 'contain' : (qs.get('fit') === 'cover' ? 'cover' : null);
  if (w > 0 && hh > 0) return { w, h: hh, fit: fit || 'cover' };
  try {
    const saved = JSON.parse(localStorage.getItem('sigFilmFormat') || 'null');
    if (saved && saved.w > 0 && saved.h > 0) return saved;
  } catch { /* format mémorisé illisible */ }
  return { w: 3840, h: 2160, fit: 'cover' }; // standard : 55″ 16:9
}

class Film extends Component {
  state = {
    snap: null, error: '', t: 0,
    cache: { total: 0, cached: 0, missing: 0 }, offline: false, fromCache: false, syncing: false,
    winW: window.innerWidth, winH: window.innerHeight,
    fmt: initialFormat(),
    badge: true, panel: false,
    customW: '', customH: '',
  };

  async componentDidMount() {
    this._resize = () => this.setState({ winW: window.innerWidth, winH: window.innerHeight });
    window.addEventListener('resize', this._resize);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
    registerOfflineShell();
    requestPersist();
    await this.bootFromCache();
    await this.load(true);
    this._poll = setInterval(() => this.load(false), REFRESH_MS);
    this._armBadge();
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.film-ui')) return;
      this.setState({ badge: true });
      this._armBadge();
    });
  }
  componentWillUnmount() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._poll);
    window.removeEventListener('resize', this._resize);
  }
  _armBadge() {
    clearTimeout(this._badgeT);
    this._badgeT = setTimeout(() => this.setState({ badge: false, panel: false }), 8000);
  }

  setFormat(fmt) {
    this._userPicked = true;
    const next = { w: fmt.w, h: fmt.h, fit: fmt.fit || this.state.fmt.fit };
    this.setState({ fmt: next, customW: '', customH: '' });
    try { localStorage.setItem('sigFilmFormat', JSON.stringify(next)); } catch { /* stockage indisponible */ }
    const qs = new URLSearchParams(location.search);
    qs.set('w', next.w); qs.set('h', next.h); qs.set('fit', next.fit);
    history.replaceState(null, '', `${location.pathname}?${qs}`);
    this._armBadge();
  }

  // Le dernier film enregistré sur cet écran, rejoué avant tout contact réseau.
  async bootFromCache() {
    if (!offlineSupported) return;
    const rec = await loadSnapshot(CACHE_KEY);
    if (!rec || !rec.snap) return;
    this.raw = rec.snap;
    const st = await cacheStats(rec.snap);
    this.setState({ snap: await resolveSnapshot(rec.snap), fromCache: true, cache: { ...st, missing: 0 }, t: 0 });
  }

  async load(first) {
    try {
      const res = await fetch(filmApi(), { cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const snap = await res.json();
      if (this.state.offline) this.setState({ offline: false });
      // Le combo d'écrans du magasin (réglé dans la régie, ex. 3 × 55″
      // portrait = 6480 × 3840) donne la taille par défaut du lien ?store= —
      // sauf format explicite dans l'URL ou choix manuel dans le panneau.
      if (snap.format && !URL_FMT && !this._userPicked) {
        const f = this.state.fmt;
        if (f.w !== snap.format.w || f.h !== snap.format.h) {
          this.setState({ fmt: { w: snap.format.w, h: snap.format.h, fit: f.fit || 'cover' } });
        }
      }
      const cur = this.raw;
      const newVersion = !cur || cur.version !== snap.version;
      // Film continu : la boucle est régénérée en direct ; on l'applique quand la
      // révision change (changement de moment/saison), en repartant du début.
      const newRevision = snap.continuous && (!cur || cur.revision !== snap.revision);
      const changed = newVersion || newRevision || cur.dataVer !== snap.dataVer || cur.override !== snap.override
        || (cur.storeStamp || '') !== (snap.storeStamp || ''); // ruptures du magasin
      if (changed || first || this.state.fromCache) await this.apply(snap, newVersion || newRevision);
    } catch (e) {
      this.setState({ offline: true });
      if (first && !this.state.snap) this.setState({ error: String(e.message || e) });
      // sinon : on continue sur le film en cache, comme un vrai écran
    }
  }

  // Bascule atomique : le nouveau film ne remplace l'ancien qu'une fois TOUS
  // ses fichiers téléchargés ; s'il en manque pour cause de réseau, l'ancien
  // continue et on retente au prochain passage.
  async apply(snap, restart) {
    if (this.state.syncing) return;
    this.setState({ syncing: true });
    try {
      const res = await syncAssets(snapshotAssets(snap));
      const cache = { total: res.total, cached: res.ok.length, missing: res.missing.length + res.external.length };
      if (res.error.length && this.state.snap) { this.setState({ syncing: false, cache }); return; }
      this.raw = snap;
      await saveSnapshot(CACHE_KEY, snap);
      const resolved = await resolveSnapshot(snap);
      this.setState({ snap: resolved, error: '', cache, fromCache: false, syncing: false, ...(restart ? { t: 0 } : {}) });
      releaseExcept(snap);
      gcAssets();
    } catch {
      this.setState({ syncing: false });
    }
  }

  // Le lien de partage (?film= ou lien général) montre TOUJOURS le film :
  // la programmation (jours/heures) ne s'applique qu'aux liens d'écran
  // (?store=) et aux players — sinon un lien partagé le soir semble « vide ».
  isScreenMode() { return !!STORE && !FILM; }
  schedLabel(s) {
    const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const all = s.days.every(Boolean);
    const d = all ? 'tous les jours' : DAYS.filter((_, i) => s.days[i]).join(' ');
    const hh = (s.from === '00:00' && (s.to === '23:59' || s.to === '24:00')) ? '24h/24' : `${s.from}–${s.to}`;
    return `${d} · ${hh}`;
  }
  filmOnAir() {
    const s = this.state.snap;
    if (!s || !s.schedule) return true;
    return scheduledNow({ schedule: s.schedule }, new Date());
  }
  // Ce qu'un écran diffuserait maintenant (programmation film + éléments).
  onAirMods() {
    const s = this.state.snap;
    if (!s || !this.filmOnAir()) return [];
    const byId = new Map(s.modules.map((m) => [m.id, m]));
    const now = new Date();
    return s.playlist.map((id) => byId.get(id)).filter(Boolean).filter(playable).filter((m) => scheduledNow(m, now));
  }
  playlistMods() {
    const s = this.state.snap;
    if (!s) return [];
    if (this.isScreenMode()) return this.onAirMods();
    // mode partage : tout le film, sans filtre horaire
    const byId = new Map(s.modules.map((m) => [m.id, m]));
    return s.playlist.map((id) => byId.get(id)).filter(Boolean).filter(playable);
  }
  offAirNote() {
    if (this.isScreenMode() || !this.state.snap) return '';
    if (!this.filmOnAir()) return ` · ⏾ hors créneau (${this.schedLabel(this.state.snap.schedule)}) — les écrans affichent l'attente`;
    if (this.onAirMods().length === 0 && this.playlistMods().length > 0) return ' · ⏾ éléments hors créneau à cette heure — les écrans affichent l\'attente';
    return '';
  }
  total() {
    const s = this.state.snap;
    const list = this.playlistMods();
    return Math.max(0.001, list.reduce((acc, m) => acc + moduleDur(m, s ? s.secPerLine : 4), 0));
  }
  current() {
    let t = this.state.t;
    const list = this.playlistMods();
    if (!list.length) return { m: null, lt: 0 };
    for (const m of list) {
      const d = moduleDur(m, this.state.snap.secPerLine);
      if (t < d || m === list[list.length - 1]) return { m, lt: clx(t, 0, d) };
      t -= d;
    }
    return { m: list[0], lt: 0 };
  }

  tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.state.snap) {
      const total = this.total();
      let t = this.state.t + dt;
      const loop = this.state.snap.loop !== false;
      if (t >= total) t = loop ? t % total : total;
      this.setState({ t });
    }
    this._raf = requestAnimationFrame(this.tick);
  };

  // Boîte d'affichage au ratio du format choisi, ajustée à la fenêtre.
  box() {
    const { fmt, winW, winH } = this.state;
    const ratio = fmt.w / fmt.h;
    let bw = winW, bh = winH;
    if (bw / bh > ratio) bw = Math.round(bh * ratio);
    else bh = Math.round(bw / ratio);
    const scale = fmt.fit === 'contain' ? Math.min(bw / W, bh / H) : Math.max(bw / W, bh / H);
    return { bw, bh, scale, left: (bw - W * scale) / 2, top: (bh - H * scale) / 2 };
  }

  render() {
    const st = this.state;
    if (st.error && !st.snap) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#B8B2A8;background:#0a0a0a;font-family:${FUI};padding:40px;text-align:center;">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.8;" />
        <div style="font-size:16px;color:#fff;">Film indisponible · Film niet beschikbaar</div>
        <div style="font-size:13px;max-width:520px;">${st.error}</div>
      </div>`;
    }
    if (!st.snap) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;background:#0a0a0a;font-family:${FUI};">
        <img src="assets/logo-white.png" style="height:60px;opacity:0.85;" />
        <div style="color:#B8B2A8;font-size:14px;">Chargement du film… · Film laden…</div>
      </div>`;
    }

    let content;
    if (st.snap.override) {
      content = h('div', { style: { position: 'absolute', inset: 0, background: RUBY, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 120 } },
        h('img', { src: 'assets/logo-white.png', style: { height: 500, width: 'auto' } }),
        h('div', { style: { fontFamily: FUI, fontWeight: 600, fontSize: 180, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff' } }, '⚡ Diffusion flash'),
        h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: 80, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' } }, 'playlists suspendues par la régie'));
    } else {
      const { m, lt } = this.current();
      const idleMsg = this.state.snap.schedule && !this.filmOnAir()
        ? `hors créneau de diffusion — ${this.schedLabel(this.state.snap.schedule)}`
        : (this.playlistMods().length === 0 && (this.state.snap.playlist || []).length > 0
          ? 'éléments hors créneau à cette heure'
          : 'film vide — ajoute des éléments dans la régie');
      // Sur un écran de magasin (?store=), les clients voient l'attente : le
      // logo seul, sans texte, quelle que soit la langue du magasin. Le lien
      // de partage garde l'explication, pour la régie.
      content = m
        ? renderModule(h, m, lt, { secPerLine: st.snap.secPerLine })
        : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 90, alignItems: 'center', justifyContent: 'center' } },
          h('img', { src: 'assets/logo.png', style: { height: 420 } }),
          this.isScreenMode() ? null : h('div', { style: { fontFamily: FUI, fontSize: 90, color: '#8A847C', letterSpacing: '0.14em', textTransform: 'uppercase', textAlign: 'center', padding: '0 200px' } }, idleMsg));
    }

    const b = this.box();
    const stage = h('div', {
      style: { position: 'absolute', left: b.left, top: b.top, width: W, height: H, background: '#F5EFE4', transform: `scale(${b.scale})`, transformOrigin: 'top left' },
    }, content);

    const isPreset = (p) => st.fmt.w === p.w && st.fmt.h === p.h;
    const chip = (on) => `padding:8px 12px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid ${on ? '#8D1D2C' : 'rgba(255,255,255,0.22)'};background:${on ? '#8D1D2C' : 'rgba(255,255,255,0.08)'};color:#fff;cursor:pointer;text-align:left;`;

    return html`
      <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:${b.bw}px;height:${b.bh}px;overflow:hidden;background:#F5EFE4;box-shadow:0 0 0 1px rgba(255,255,255,0.08);">
        ${stage}
      </div>
      ${st.badge && html`
        <div class="film-ui" onClick=${(e) => e.stopPropagation()} style="position:fixed;left:16px;bottom:16px;display:flex;flex-direction:column;gap:10px;font-family:${FUI};z-index:10;">
          ${st.panel && html`
            <div style="background:rgba(10,10,10,0.88);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;width:280px;color:#fff;">
              <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.55);">Format d'écran (px · ratio)</div>
              ${st.snap.format && html`
                <button onClick=${() => this.setFormat({ w: st.snap.format.w, h: st.snap.format.h })} style=${chip(st.fmt.w === st.snap.format.w && st.fmt.h === st.snap.format.h)}>
                  Combo du magasin · ${st.snap.format.label} <span style="opacity:0.65;font-weight:400;">· ${st.snap.format.w}×${st.snap.format.h}</span>
                </button>
              `}
              ${PRESETS.map((p) => html`
                <button onClick=${() => this.setFormat(p)} style=${chip(isPreset(p))}>
                  ${p.label} <span style="opacity:0.65;font-weight:400;">· ${p.w}×${p.h}</span>
                </button>
              `)}
              <div style="display:flex;gap:6px;align-items:center;">
                <input value=${st.customW} onInput=${(e) => this.setState({ customW: e.target.value })} placeholder="Largeur px" inputmode="numeric" style="flex:1;min-width:0;padding:8px 10px;font-size:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.08);color:#fff;" />
                <span style="color:rgba(255,255,255,0.5);">×</span>
                <input value=${st.customH} onInput=${(e) => this.setState({ customH: e.target.value })} placeholder="Hauteur px" inputmode="numeric" style="flex:1;min-width:0;padding:8px 10px;font-size:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.08);color:#fff;" />
                <button onClick=${() => { const w = parseInt(st.customW, 10), hh = parseInt(st.customH, 10); if (w > 0 && hh > 0) this.setFormat({ w, h: hh }); }} style="padding:8px 12px;font-size:12px;font-weight:700;border-radius:8px;border:none;background:#8D1D2C;color:#fff;cursor:pointer;">OK</button>
              </div>
              <div style="display:flex;gap:6px;">
                <button onClick=${() => this.setFormat({ ...st.fmt, fit: 'cover' })} style=${chip(st.fmt.fit === 'cover') + 'flex:1;text-align:center;'}>Remplir</button>
                <button onClick=${() => this.setFormat({ ...st.fmt, fit: 'contain' })} style=${chip(st.fmt.fit === 'contain') + 'flex:1;text-align:center;'}>Adapter</button>
              </div>
            </div>
          `}
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;background:rgba(10,10,10,0.75);color:#fff;font-size:12.5px;backdrop-filter:blur(6px);">
              <span style="width:8px;height:8px;border-radius:50%;background:${st.offline ? '#C0392B' : (st.syncing ? '#B8860B' : '#5BBE7A')};"></span>
              <span>${st.offline ? 'hors ligne · ' : ''}${st.fromCache ? 'depuis le cache · ' : ''}cache ${st.cache.cached}/${st.cache.total}${st.cache.missing ? ` (${st.cache.missing} absent·s)` : ''} · ${st.snap.playlistName || 'Film'}${st.snap.storeName ? ` · ${st.snap.storeName}` : ''}${st.snap.draft ? ' · brouillon (pas encore publié)' : ''} · v${st.snap.version} · prix d${st.snap.dataVer} · ${st.fmt.w}×${st.fmt.h}${st.snap.format && st.fmt.w === st.snap.format.w && st.fmt.h === st.snap.format.h ? ` (${st.snap.format.label})` : ''}${this.offAirNote()}</span>
            </div>
            <button onClick=${() => { this.setState({ panel: !st.panel }); this._armBadge(); }} title="Choisir le format d'écran" style="padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.22);background:rgba(10,10,10,0.75);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;backdrop-filter:blur(6px);">⛶ Format</button>
          </div>
        </div>
      `}
    `;
  }
}

render(h(Film), document.getElementById('root'));
