// Back office « Régie d'affichage » — port fidèle de la maquette Back Office.dc.html,
// câblé sur l'API du CMS (tables SQLite préfixées sig_).
import { html, h, render, Component } from './vendor/preact-htm.js';
import {
  RUBY, INK, FUI, W, H, LIAISON_DUR, LAYOUTS, MOTIONS,
  clx, fmtTime, newTag, newSched, newPos,
  activeItems as rActiveItems, moduleDur as rModuleDur, renderModule,
} from './renderer.js';

const PREVIEW_W = 560;
const SCALE = PREVIEW_W / W;
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const SLOTS = [
  { label: 'Matin', from: '06:00', to: '11:00' },
  { label: 'Midi', from: '11:00', to: '14:00' },
  { label: 'Après-midi', from: '15:00', to: '19:00' },
  { label: 'Toute la journée', from: '00:00', to: '23:59' },
];
const POSF = [
  { k: 'titleY', label: 'Titre · vertical', min: -400, max: 400, step: 10, unit: 'px' },
  { k: 'listX', label: 'Liste · horizontal', min: -800, max: 800, step: 10, unit: 'px' },
  { k: 'listY', label: 'Liste · vertical', min: -400, max: 600, step: 10, unit: 'px' },
  { k: 'illoX', label: 'Illustration · horizontal', min: -1600, max: 1600, step: 20, unit: 'px' },
  { k: 'illoY', label: 'Illustration · vertical', min: -800, max: 800, step: 20, unit: 'px' },
  { k: 'illoScale', label: 'Illustration · taille', min: 0.5, max: 1.8, step: 0.05, unit: '×' },
];

let UIDC = 0;
const uid = () => 'm' + Date.now().toString(36) + (UIDC++).toString(36);

// URLs relatives à la page → fonctionne aussi monté sous un sous-chemin
// (ex. http://185.180.206.46/pwa_consultant/signage/).
const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();

async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

class App extends Component {
  state = {
    loading: true, loadError: '',
    authRequired: false, loginUser: 'admin', loginPass: '', loginError: '', loggingIn: false,
    secPerLine: 4, loop: true, playing: true, t: 0,
    dirty: false, saved: true, scope: 'module', clipboard: null, past: [], future: [],
    selId: null, playlist: [],
    view: 'composer', publishing: false, deploying: false, version: 1, dataVer: 1, hbTick: 0, toast: '',
    pubTargets: {}, pubSlot: 'Toute la journée', pubWhen: 'now', activateAt: '', pubMode: 'full',
    override: false,
    srvUrl: '', srvIp: '', srvToken: '',
    test: { state: 'idle', rows: [] },
    fleet: [],
    library: [],
  };

  // ---------------------------------------------------------------- lifecycle
  async componentDidMount() {
    this._last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
    this._hb = setInterval(() => {
      this.setState((s) => ({
        hbTick: s.hbTick + 1,
        fleet: s.fleet.map((st) => ({
          ...st,
          players: st.players.map((p) => ({ ...p, dataAge: p.dataAge + 1, syncAgo: p.syncAgo + 1 })),
        })),
      }));
    }, 1000);
    this._poll = setInterval(() => this.refreshFleet(), 5000);
    this._key = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      } else if (e.key === ' ' && !typing) {
        e.preventDefault();
        this.setState((s) => ({ playing: !s.playing }));
      }
    };
    window.addEventListener('keydown', this._key);
    await this.loadState();
    this.refreshFleet();
  }

  componentWillUnmount() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._hb);
    clearInterval(this._poll);
    window.removeEventListener('keydown', this._key);
    window.removeEventListener('mousemove', this._onDragMove);
    window.removeEventListener('mouseup', this._onDragUp);
  }

  async loadState() {
    try {
      const st = await api('GET', '/state');
      this.setState({
        loading: false, authRequired: false,
        library: st.modules,
        playlist: st.playlist,
        secPerLine: st.secPerLine,
        loop: st.loop,
        version: st.version,
        dataVer: st.dataVer,
        override: st.override,
        srvUrl: st.settings.srvUrl || new URL('api/v1', location.href).toString(),
        srvIp: st.settings.srvIp || location.hostname,
        srvToken: st.settings.srvToken || '',
        selId: st.modules.length ? st.modules[0].id : null,
        dirty: false, saved: true,
      });
    } catch (e) {
      if (e.status === 401) this.setState({ loading: false, authRequired: true });
      else this.setState({ loading: false, loadError: String(e.message || e) });
    }
  }

  async refreshFleet() {
    if (this.state.authRequired) return;
    try {
      const f = await api('GET', '/fleet');
      this.setState({ fleet: f.stores, version: f.version, dataVer: f.dataVer, override: f.override });
    } catch { /* serveur momentanément indisponible : on garde l'état local */ }
  }

  doLogin = async (e) => {
    e.preventDefault();
    if (this.state.loggingIn) return;
    this.setState({ loggingIn: true, loginError: '' });
    try {
      await api('POST', '/login', { username: this.state.loginUser, password: this.state.loginPass });
      this.setState({ loading: true, authRequired: false, loginPass: '' });
      await this.loadState();
      this.refreshFleet();
    } catch (err) {
      this.setState({ loginError: String(err.message || err) });
    } finally {
      this.setState({ loggingIn: false });
    }
  };

  logout = async () => {
    try { await api('POST', '/logout'); } catch { /* la session locale est de toute façon abandonnée */ }
    this.setState({ authRequired: true, loginPass: '' });
  };

  // ------------------------------------------------------------ drag position
  startDrag(kind, e) {
    e.preventDefault(); e.stopPropagation();
    const pos = { ...(this.sel().pos || newPos()) };
    this._drag2 = { kind, x: e.clientX, y: e.clientY, pos, snap: this.snapshot() };
    window.addEventListener('mousemove', this._onDragMove);
    window.addEventListener('mouseup', this._onDragUp);
  }
  _onDragMove = (e) => {
    const d = this._drag2; if (!d) return;
    const dx = (e.clientX - d.x) / SCALE, dy = (e.clientY - d.y) / SCALE;
    const obj = d.kind === 'illo'
      ? { illoX: Math.round(d.pos.illoX + dx), illoY: Math.round(d.pos.illoY + dy) }
      : { listX: Math.round(d.pos.listX + dx), listY: Math.round(d.pos.listY + dy) };
    const lib = this.cloneLib();
    const m = lib.find((x) => x.id === this.state.selId);
    m.pos = { ...(m.pos || newPos()), ...obj };
    this.setState({ library: lib });
  };
  _onDragUp = () => {
    const d = this._drag2;
    window.removeEventListener('mousemove', this._onDragMove);
    window.removeEventListener('mouseup', this._onDragUp);
    if (d) {
      this.setState((s) => ({ past: [...s.past, d.snap].slice(-60), future: [], dirty: true, saved: false }));
      this._drag2 = null;
    }
  };

  // ------------------------------------------------------------------ helpers
  getMod(id) { return this.state.library.find((m) => m.id === id); }
  sel() { return this.getMod(this.state.selId) || this.state.library[0]; }
  activeItems(m) { return rActiveItems(m); }
  moduleDur(m) { return rModuleDur(m, this.state.secPerLine); }
  playlistMods() { return this.state.playlist.map((id) => this.getMod(id)).filter(Boolean); }
  scopeMods() { return this.state.scope === 'playlist' ? this.playlistMods() : [this.sel()].filter(Boolean); }
  total() {
    const l = this.scopeMods();
    return Math.max(0.001, l.reduce((s, m) => s + this.moduleDur(m), 0));
  }
  activeInScope() {
    let t = this.state.t;
    const list = this.scopeMods();
    if (!list.length) return { m: null, lt: 0 };
    for (const m of list) {
      const d = this.moduleDur(m);
      if (t < d || m === list[list.length - 1]) return { m, lt: clx(t, 0, d) };
      t -= d;
    }
    return { m: list[0], lt: 0 };
  }

  tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.state.playing && !this.state.loading) {
      const total = this.total();
      let t = this.state.t + dt;
      if (t >= total) {
        if (this.state.loop) t = t % total;
        else { t = total; this.setState({ playing: false }); }
      }
      this.setState({ t });
    }
    this._raf = requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------- undo / redo
  snapshot() {
    return JSON.stringify({
      library: this.state.library, playlist: this.state.playlist,
      secPerLine: this.state.secPerLine, loop: this.state.loop, selId: this.state.selId,
    });
  }
  dirty(patch) {
    const snap = this.snapshot();
    this.setState((s) => ({ past: [...s.past, snap].slice(-60), future: [], dirty: true, saved: false, ...patch }));
  }
  undo() {
    this.setState((s) => {
      if (!s.past.length) return null;
      const past = [...s.past];
      const snap = past.pop();
      const cur = JSON.stringify({ library: s.library, playlist: s.playlist, secPerLine: s.secPerLine, loop: s.loop, selId: s.selId });
      const o = JSON.parse(snap);
      return { past, future: [...s.future, cur].slice(-60), library: o.library, playlist: o.playlist, secPerLine: o.secPerLine, loop: o.loop, selId: o.selId, dirty: true, saved: false };
    });
  }
  redo() {
    this.setState((s) => {
      if (!s.future.length) return null;
      const future = [...s.future];
      const snap = future.pop();
      const cur = JSON.stringify({ library: s.library, playlist: s.playlist, secPerLine: s.secPerLine, loop: s.loop, selId: s.selId });
      const o = JSON.parse(snap);
      return { future, past: [...s.past, cur].slice(-60), library: o.library, playlist: o.playlist, secPerLine: o.secPerLine, loop: o.loop, selId: o.selId, dirty: true, saved: false };
    });
  }
  cloneLib() {
    return this.state.library.map((m) => ({
      ...m,
      tag: { ...m.tag },
      schedule: { ...m.schedule, days: [...m.schedule.days] },
      pos: { ...(m.pos || newPos()) },
      items: m.items ? m.items.map((i) => ({ ...i })) : m.items,
    }));
  }
  setLib(lib, extra) { this.dirty({ library: lib, ...(extra || {}) }); }

  // ------------------------------------------------------- modules & playlist
  selectMod(id) { this.setState({ selId: id, t: 0 }); }
  // Un nouveau module rejoint directement la playlist (retirable avec ✕) :
  // sinon il n'apparaîtrait pas dans le film publié et c'est trop facile à rater.
  addCategory() {
    const id = uid();
    const lib = this.cloneLib();
    lib.push({ id, type: 'category', name: 'Nouvelle catégorie', layout: 'illo-right', motion: 'm1', tag: newTag(), schedule: newSched(), pos: newPos(), items: [{ name: 'Produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true }] });
    this.setLib(lib, { selId: id, playlist: [...this.state.playlist, id] });
  }
  addLiaison() {
    const id = uid();
    const lib = this.cloneLib();
    lib.push({ id, type: 'liaison', name: 'Liaison', sub: 'faites maison chaque matin', tag: newTag(), schedule: newSched(), pos: newPos(), items: [] });
    this.setLib(lib, { selId: id, playlist: [...this.state.playlist, id] });
  }
  copyMod(id) { this.setState({ clipboard: JSON.parse(JSON.stringify(this.getMod(id))) }); }
  dupMod(id) {
    const lib = this.cloneLib();
    const i = lib.findIndex((m) => m.id === id);
    const c = JSON.parse(JSON.stringify(lib[i]));
    c.id = uid(); c.name = c.name + ' (copie)';
    lib.splice(i + 1, 0, c);
    this.setLib(lib, { selId: c.id });
  }
  paste() {
    if (!this.state.clipboard) return;
    const c = JSON.parse(JSON.stringify(this.state.clipboard));
    c.id = uid();
    const lib = this.cloneLib();
    lib.push(c);
    this.setLib(lib, { selId: c.id });
  }
  delMod(id) {
    if (this.state.library.length <= 1) return;
    const lib = this.state.library.filter((m) => m.id !== id);
    const playlist = this.state.playlist.filter((x) => x !== id);
    const selId = lib.some((m) => m.id === this.state.selId) ? this.state.selId : lib[0].id;
    this.dirty({ library: lib, playlist, selId });
  }
  addToPlaylist(id) { this.dirty({ playlist: [...this.state.playlist, id] }); }
  removeFromPlaylist(i) { this.dirty({ playlist: this.state.playlist.filter((_, j) => j !== i) }); }
  reorderPlaylist(from, to) {
    if (from === to) return;
    const playlist = [...this.state.playlist];
    const [x] = playlist.splice(from, 1);
    playlist.splice(to, 0, x);
    this.dirty({ playlist });
  }

  setSelField(f, v) { const lib = this.cloneLib(); lib.find((x) => x.id === this.state.selId)[f] = v; this.setLib(lib); }
  setTag(f, v) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.tag = { ...m.tag, [f]: v }; this.setLib(lib); }
  setSched(f, v) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.schedule = { ...m.schedule, [f]: v }; this.setLib(lib); }
  setSchedBoth(from, to) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.schedule = { ...m.schedule, from, to }; this.setLib(lib); }
  toggleDay(d) {
    const lib = this.cloneLib();
    const m = lib.find((x) => x.id === this.state.selId);
    const days = [...m.schedule.days]; days[d] = !days[d];
    m.schedule = { ...m.schedule, days };
    this.setLib(lib);
  }
  setPos(f, v) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.pos = { ...(m.pos || newPos()), [f]: v }; this.setLib(lib); }
  resetPos() { const lib = this.cloneLib(); lib.find((x) => x.id === this.state.selId).pos = newPos(); this.setLib(lib); }

  updItem(i, f, v) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.items[i] = { ...m.items[i], [f]: v }; this.setLib(lib); }
  moveItem(i, d) {
    const m = this.sel(); const j = i + d;
    if (j < 0 || j >= m.items.length) return;
    const lib = this.cloneLib();
    const mm = lib.find((x) => x.id === this.state.selId);
    [mm.items[i], mm.items[j]] = [mm.items[j], mm.items[i]];
    this.setLib(lib);
  }
  delItem(i) {
    const m = this.sel();
    if (m.items.length <= 1) return;
    const lib = this.cloneLib();
    lib.find((x) => x.id === this.state.selId).items.splice(i, 1);
    this.setLib(lib);
  }
  addItem() { const lib = this.cloneLib(); lib.find((x) => x.id === this.state.selId).items.push({ name: 'Nouveau produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true }); this.setLib(lib); }
  dupItem(i) { const lib = this.cloneLib(); const mm = lib.find((x) => x.id === this.state.selId); mm.items.splice(i + 1, 0, { ...mm.items[i] }); this.setLib(lib); }
  onPhoto(i, e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      // Compression côté navigateur : une photo de téléphone (5-8 Mo) ferait
      // échouer l'enregistrement — on la ramène à ≤1600 px en JPEG.
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        const sc = Math.min(1, MAX / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc));
        cv.height = Math.max(1, Math.round(img.height * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let data;
        try { data = cv.toDataURL('image/jpeg', 0.85); } catch { data = r.result; }
        const lib = this.cloneLib();
        const mm = lib.find((x) => x.id === this.state.selId);
        mm.items[i] = { ...mm.items[i], img: data, src: 'photo' };
        this.setLib(lib);
      };
      img.onerror = () => this.showToast('Image illisible — essaie un JPG ou PNG');
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }

  scrub = (e) => {
    if (!this._track) return;
    const r = this._track.getBoundingClientRect();
    this.setState({ t: clx((e.clientX - r.left) / r.width, 0, 1) * this.total() });
  };
  trackRef = (el) => { this._track = el; };

  // ------------------------------------------------------------- API actions
  draftBody() {
    return {
      modules: this.state.library,
      playlist: this.state.playlist,
      secPerLine: this.state.secPerLine,
      loop: this.state.loop,
    };
  }
  save = async () => {
    try {
      await api('PUT', '/draft', this.draftBody());
      this.setState({ dirty: false, saved: true });
    } catch (e) {
      this.showToast(e.status === 401
        ? 'Session expirée — recharge la page (F5) et reconnecte-toi, puis réessaie'
        : `Échec de l'enregistrement : ${e.message}`);
    }
  };

  setView(v) { this.setState({ view: v }); if (v === 'fleet') this.refreshFleet(); }
  openPublish() {
    const t = {};
    this.state.fleet.forEach((s) => { t[s.id] = true; });
    this.setState({ publishing: true, pubTargets: t });
  }
  closePublish() { this.setState({ publishing: false }); }
  toggleTarget(id) { this.setState((s) => ({ pubTargets: { ...s.pubTargets, [id]: !s.pubTargets[id] } })); }
  targetCount() {
    return this.state.fleet.filter((s) => this.state.pubTargets[s.id]).reduce((n, s) => n + s.players.length, 0);
  }
  showToast(msg) {
    this.setState({ toast: msg });
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.setState({ toast: '' }), 5200);
  }

  applyTests(out) {
    const okN = out.tests.filter((t) => t.ok).length;
    this.setState({
      test: {
        state: out.tests.length === 0 ? 'idle' : (okN === out.tests.length ? 'ok' : 'fail'),
        rows: out.tests.map((t) => ({ label: t.label, ok: t.ok, ms: t.ms, status: t.status, detail: t.detail })),
      },
    });
    return `tests live ${okN}/${out.tests.length} OK`;
  }

  deploy = async () => {
    const st = this.state;
    if (this.targetCount() === 0 || st.deploying) return;
    this.setState({ deploying: true });
    try {
      await api('PUT', '/draft', this.draftBody());
      const targets = st.fleet.filter((s) => st.pubTargets[s.id]).map((s) => s.id);
      const out = await api('POST', '/publish', {
        mode: st.pubMode === 'data' ? 'data' : 'full',
        targets, slot: st.pubSlot, when: st.pubWhen, activateAt: st.activateAt,
      });
      const testMsg = this.applyTests(out);
      const sched = st.pubWhen === 'scheduled';
      this.setState({
        version: out.mode === 'full' ? out.version : st.version,
        dataVer: out.mode === 'data' ? out.version : st.dataVer,
        publishing: false, dirty: false, saved: true, view: 'fleet',
      });
      this.showToast(out.mode === 'data'
        ? `Snapshot prix d${out.version} poussé sur ${out.playerCount} écran(s) · ${testMsg}`
        : (sched
          ? `Playlist v${out.version} planifiée · ${testMsg}`
          : `Déploiement v${out.version} lancé sur ${out.playerCount} écran(s) · ${testMsg}`));
      this.refreshFleet();
    } catch (e) {
      this.showToast(e.status === 401
        ? 'Session expirée — recharge la page (F5) et reconnecte-toi, puis réessaie'
        : `Échec de la publication : ${e.message}`);
    } finally {
      this.setState({ deploying: false });
    }
  };

  pushPrices = async () => {
    try {
      await api('PUT', '/draft', this.draftBody());
      const out = await api('POST', '/push-prices');
      const testMsg = this.applyTests(out);
      this.setState({ dataVer: out.version, dirty: false, saved: true, view: 'fleet' });
      this.showToast(`Snapshot prix d${out.version} poussé · sync incrémentale légère · ${testMsg}`);
      this.refreshFleet();
    } catch (e) {
      this.showToast(`Échec du push prix : ${e.message}`);
    }
  };

  toggleOverride = async () => {
    const on = !this.state.override;
    try {
      await api('POST', '/override', { on });
      this.setState({ override: on, view: 'fleet' });
      this.showToast(on ? '⚡ Diffusion flash active sur toute la flotte' : 'Reprise des playlists normales');
      this.refreshFleet();
    } catch (e) {
      this.showToast(`Échec : ${e.message}`);
    }
  };

  saveSrv = () => {
    clearTimeout(this._srvT);
    this._srvT = setTimeout(() => {
      api('POST', '/settings', { srvUrl: this.state.srvUrl, srvIp: this.state.srvIp, srvToken: this.state.srvToken }).catch(() => {});
    }, 600);
  };

  // Copie compatible HTTP (navigator.clipboard exige un contexte sécurisé).
  copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  copyLink = async (url) => {
    try {
      await this.copyText(url);
      this.showToast('Lien copié ✓');
    } catch {
      this.showToast('Copie impossible — sélectionne le lien à la main');
    }
  };

  filmUrl({ w, h: hh, fit, store } = {}) {
    const u = new URL('film', location.href);
    if (store) u.searchParams.set('store', store);
    if (w) {
      u.searchParams.set('w', w);
      u.searchParams.set('h', hh);
      u.searchParams.set('fit', fit || 'cover');
    }
    return u.toString();
  }
  filmLinks() {
    return [
      { label: '55″ TV · 16:9 (standard)', sub: '3840 × 2160 · remplir', url: this.filmUrl({ w: 3840, h: 2160 }) },
      { label: '55″ portrait · 9:16', sub: '2160 × 3840 · dalle centrale du mur', url: this.filmUrl({ w: 2160, h: 3840 }) },
      { label: 'Full HD · 16:9', sub: '1920 × 1080 · remplir', url: this.filmUrl({ w: 1920, h: 1080 }) },
      { label: 'Mur 3 dalles · natif', sub: '6480 × 3840', url: this.filmUrl({ w: 6480, h: 3840 }) },
      { label: 'Auto (fenêtre)', sub: 's’adapte au navigateur · letterbox', url: this.filmUrl() },
    ];
  }
  storeFilmLinks() {
    // Lien direct par magasin (format standard 55″) : montre la version
    // actuellement assignée à ce magasin.
    return this.state.fleet.map((s) => ({
      label: s.store,
      sub: `${s.group} · ${s.players.length} écran(s)`,
      url: this.filmUrl({ w: 3840, h: 2160, store: s.id }),
    }));
  }

  testConn = async () => {
    const st = this.state;
    if (st.test.state === 'testing') return;
    this.setState({ test: { state: 'testing', rows: [] } });
    try {
      await api('POST', '/settings', { srvUrl: st.srvUrl, srvIp: st.srvIp, srvToken: st.srvToken });
      const out = await api('POST', '/test', {
        url: st.srvUrl || `${location.origin}/api/v1`,
        ip: st.srvIp, token: st.srvToken,
      });
      this.setState({ test: { state: out.ok ? 'ok' : 'fail', rows: out.rows } });
      this.showToast(out.ok
        ? `Connexion OK · player joignable (${(st.srvUrl || location.origin).replace(/\/$/, '')})`
        : 'Échec — URL ou token invalide / hôte injoignable');
    } catch (e) {
      this.setState({ test: { state: 'fail', rows: [{ label: 'POST /api/v1/test', ok: false, ms: 0 }] } });
      this.showToast(`Échec du test : ${e.message}`);
    }
  };

  schedSummary(s) {
    const all = s.days.every(Boolean);
    const none = s.days.every((x) => !x);
    const d = all ? 'Tous les jours'
      : none ? 'Aucun jour'
      : (s.days[0] && s.days[1] && s.days[2] && s.days[3] && s.days[4] && !s.days[5] && !s.days[6]) ? 'Lun–Ven'
      : (!s.days[0] && !s.days[1] && !s.days[2] && !s.days[3] && !s.days[4] && s.days[5] && s.days[6]) ? 'Week-end'
      : DAYS.filter((_, i) => s.days[i]).join(' ');
    const hh = (s.from === '00:00' && (s.to === '23:59' || s.to === '24:00')) ? '24h/24' : `${s.from}–${s.to}`;
    return `${d} · ${hh}`;
  }

  renderPreview() {
    const { m, lt } = this.activeInScope();
    const st = this.state;
    const interactive = st.view === 'composer' && st.scope === 'module' && m && m.type === 'category';
    const opts = {
      secPerLine: st.secPerLine,
      interactive,
      onIlloDown: (e) => this.startDrag('illo', e),
      onListDown: (e) => this.startDrag('list', e),
    };
    const inner = m
      ? renderModule(h, m, lt, opts)
      : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FUI, fontSize: 120, color: '#B8B2A8' } }, 'Playlist vide');
    const stage = h('div', { style: { position: 'absolute', left: 0, top: 0, width: W, height: H, background: '#F5EFE4', transform: `scale(${SCALE})`, transformOrigin: 'top left' } }, inner);
    return h('div', { style: { position: 'relative', width: PREVIEW_W, height: Math.round(H * SCALE), margin: '0 auto' } }, stage);
  }

  // -------------------------------------------------------------------- vals
  vals() {
    const st = this.state;
    const m = this.sel() || { type: 'category', name: '', tag: newTag(), schedule: newSched(), pos: newPos(), items: [] };
    const isCat = m.type === 'category', isLia = m.type === 'liaison';
    const total = this.total();
    const { m: playM, lt } = this.activeInScope();
    const iconBtn = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:7px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);cursor:pointer;font-size:14px;color:#232220;';
    const miniBtn = 'display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.10);cursor:pointer;font-size:12px;color:#232220;';
    const tagChipOf = (mm) => (mm.tag && mm.tag.enabled
      ? h('span', { style: { flex: '0 0 auto', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#fff', background: RUBY, borderRadius: 999, padding: '2px 7px' } }, 'Promo')
      : null);

    const playlist = st.playlist.map((id, i) => {
      const mm = this.getMod(id);
      if (!mm) return {};
      const isLi = mm.type === 'liaison', selc = mm.id === st.selId;
      return {
        id, name: mm.name, order: i + 1, tagChip: tagChipOf(mm),
        meta: `${isLi ? 'Liaison' : this.activeItems(mm).length + ' produits'} · ${this.schedSummary(mm.schedule)}`,
        cardStyle: `display:flex;align-items:center;gap:9px;padding:10px 10px;border-radius:11px;cursor:pointer;background:${selc ? '#fff' : 'rgba(255,255,255,0.55)'};border:1px solid ${selc ? '#8D1D2C' : 'rgba(35,34,32,0.08)'};`,
        badgeStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;flex:0 0 auto;font-size:12px;font-weight:600;${isLi ? 'background:rgba(35,34,32,0.10);color:#8A847C;' : 'background:rgba(141,29,44,0.12);color:#8D1D2C;'}`,
        miniBtnDel: miniBtn + 'color:#8D1D2C;',
        select: () => this.selectMod(id),
        remove: (e) => { e.stopPropagation(); this.removeFromPlaylist(i); },
        onDragStart: (e) => { this._dragIdx = i; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
        onDragOver: (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); },
        onDrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); this.reorderPlaylist(this._dragIdx, i); },
        onDragEnd: (e) => { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.pl-item').forEach((el) => el.classList.remove('drag-over')); },
      };
    });

    const inPlaylistCount = {};
    st.playlist.forEach((id) => { inPlaylistCount[id] = (inPlaylistCount[id] || 0) + 1; });
    const library = st.library.map((mm) => {
      const isLi = mm.type === 'liaison', selc = mm.id === st.selId;
      const cnt = inPlaylistCount[mm.id] || 0;
      return {
        name: mm.name, tagChip: tagChipOf(mm), typeIcon: isLi ? '⧉' : '▤',
        libMeta: `${isLi ? 'Liaison' : this.activeItems(mm).length + ' produits'}${cnt ? ' · dans playlist ×' + cnt : ' · ⚠ hors playlist (＋ pour diffuser)'}`,
        cardStyle: `display:flex;align-items:center;gap:9px;padding:10px 10px;border-radius:11px;cursor:pointer;background:${selc ? '#fff' : 'rgba(255,255,255,0.4)'};border:1px solid ${selc ? '#8D1D2C' : 'rgba(35,34,32,0.08)'};`,
        badgeStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;flex:0 0 auto;font-size:12px;${isLi ? 'background:rgba(35,34,32,0.10);color:#8A847C;' : 'background:rgba(141,29,44,0.12);color:#8D1D2C;'}`,
        addBtn: miniBtn + 'background:#8D1D2C;color:#fff;border:none;font-weight:700;',
        miniBtn, miniBtnDel: miniBtn + 'color:#8D1D2C;',
        select: () => this.selectMod(mm.id),
        addToPlaylist: (e) => { e.stopPropagation(); this.addToPlaylist(mm.id); },
        copy: (e) => { e.stopPropagation(); this.copyMod(mm.id); },
        dup: (e) => { e.stopPropagation(); this.dupMod(mm.id); },
        del: (e) => { e.stopPropagation(); this.delMod(mm.id); },
      };
    });

    const layoutOptions = LAYOUTS.map((o) => ({
      icon: o.icon, label: o.label,
      pick: () => this.setSelField('layout', o.id),
      style: `text-align:left;padding:13px 13px;border-radius:12px;cursor:pointer;background:${isCat && m.layout === o.id ? 'rgba(141,29,44,0.08)' : '#FBF8F2'};border:1px solid ${isCat && m.layout === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:#232220;`,
    }));
    const MSHORT = { m1: 'Doux', m2: 'Ample', m3: 'Pulsé', none: 'Aucun' };
    const mGroups = [
      { key: 'motionTitle', label: 'Titre' },
      { key: 'motionList', label: 'Liste & prix' },
      { key: 'motionIllo', label: 'Illustration' },
    ];
    const motionGroups = mGroups.map((g) => {
      const cur = m[g.key] || m.motion || 'm1';
      return {
        label: g.label,
        options: MOTIONS.map((o) => ({
          label: MSHORT[o.id],
          pick: () => this.setSelField(g.key, o.id),
          style: `text-align:center;padding:9px 6px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;background:${isCat && cur === o.id ? 'rgba(141,29,44,0.08)' : '#FBF8F2'};border:1px solid ${isCat && cur === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:#232220;`,
        })),
      };
    });

    const items = (isCat ? m.items : []).map((t, i) => ({
      name: t.name, price: t.price, img: t.img, active: t.active,
      isIllus: t.src !== 'photo', isPhoto: t.src === 'photo',
      photoLabel: t.src === 'photo' ? 'Photo importée · changer' : 'Importer une photo',
      thumb: h('img', { src: t.img, alt: '', style: { width: 46, height: 46, objectFit: 'contain', flex: '0 0 auto', background: '#FBF8F2', borderRadius: 8, padding: 3, boxSizing: 'border-box', border: t.src === 'photo' ? '1px solid rgba(35,34,32,0.14)' : 'none' } }),
      wrapStyle: `display:flex;flex-direction:column;gap:9px;padding:11px 12px;border-radius:12px;border:1px solid rgba(35,34,32,0.08);background:${t.active ? '#FBF8F2' : 'rgba(35,34,32,0.035)'};opacity:${t.active ? 1 : 0.6};`,
      iconBtn,
      delBtn: iconBtn + 'color:#8D1D2C;',
      eyeStyle: iconBtn + (t.active ? '' : 'background:rgba(141,29,44,0.10);color:#8D1D2C;'),
      eyeIcon: t.active ? '👁' : '⃠',
      illusTabStyle: `padding:6px 11px;font-size:12px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${t.src !== 'photo' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      photoTabStyle: `padding:6px 11px;font-size:12px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${t.src === 'photo' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      onName: (e) => this.updItem(i, 'name', e.target.value),
      onPrice: (e) => this.updItem(i, 'price', e.target.value),
      onImg: (e) => this.updItem(i, 'img', e.target.value),
      setIllus: () => this.updItem(i, 'src', 'illus'),
      setPhoto: () => this.updItem(i, 'src', 'photo'),
      onPhoto: (e) => this.onPhoto(i, e),
      toggleActive: () => this.updItem(i, 'active', !t.active),
      moveUp: () => this.moveItem(i, -1),
      moveDown: () => this.moveItem(i, 1),
      dup: () => this.dupItem(i),
      del: () => this.delItem(i),
    }));

    const pos = m.pos || newPos();
    const posFields = POSF.map((f) => {
      const v = pos[f.k] != null ? pos[f.k] : (f.k === 'illoScale' ? 1 : 0);
      return {
        label: f.label, min: f.min, max: f.max, step: f.step, value: v,
        display: f.unit === '×' ? `${v.toFixed(2)}×` : `${v > 0 ? '+' : ''}${Math.round(v)} px`,
        onInput: (e) => this.setPos(f.k, parseFloat(e.target.value)),
      };
    });
    const timeSlots = SLOTS.map((s) => {
      const on = m.schedule.from === s.from && m.schedule.to === s.to;
      return {
        label: s.label,
        pick: () => this.setSchedBoth(s.from, s.to),
        style: `padding:9px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
      };
    });
    const days = DAYS.map((lab, d) => ({
      label: lab,
      toggle: () => this.toggleDay(d),
      style: `width:52px;padding:9px 0;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${m.schedule.days[d] ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
    }));

    let liveLine = '—';
    if (playM && playM.type === 'category') {
      const n = this.activeItems(playM).length;
      if (n) {
        const raw = lt / st.secPerLine;
        const idx = ((Math.floor(raw) % n) + n) % n;
        liveLine = `${idx + 1}/${n}`;
      }
    }

    // ---- vue flotte ----
    const stTab = 'padding:8px 16px;font-size:13px;font-weight:500;border:none;border-radius:999px;cursor:pointer;';
    const fmtAgo = (s) => (s >= 999999 ? 'jamais vu' : s < 60 ? `il y a ${s}s` : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : `il y a ${Math.floor(s / 3600)} h`);
    const STCOL = { playing: '#2E7D32', syncing: '#B8860B', error: '#8D1D2C', offline: '#8A847C', idle: '#8A847C' };
    const STLAB = { playing: 'En lecture', syncing: 'Sync…', error: 'Erreur', offline: 'Hors ligne', idle: 'En pause' };
    let online = 0, offline = 0, errors = 0, plCount = 0, stale = 0, oldest = 0;
    st.fleet.forEach((s) => s.players.forEach((p) => {
      plCount++;
      if (p.state === 'offline') offline++; else online++;
      if (p.state === 'error') errors++;
      if (p.dataAge > 3600) stale++;
      if (p.dataAge > oldest) oldest = p.dataAge;
    }));
    const ageShort = (s) => (s >= 999999 ? '∞' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`);
    const kpis = [
      { label: 'Écrans en ligne', value: `${online}`, sub: `/ ${plCount}`, color: '#2E7D32' },
      { label: 'Hors ligne', value: `${offline}`, sub: offline ? 'lit le cache' : '—', color: offline ? '#8D1D2C' : '#232220' },
      { label: 'Prix le + ancien', value: ageShort(oldest), sub: stale ? `${stale} écran(s) périmés` : 'à jour', color: stale ? '#8D1D2C' : '#232220' },
      { label: 'Playlist · données', value: `v${st.version}`, sub: `prix d${st.dataVer}`, color: '#232220' },
    ];
    const fleet = st.fleet.map((s) => ({
      store: s.store, group: s.group,
      filmUrl: this.filmUrl({ w: 3840, h: 2160, store: s.id }),
      copyFilm: () => this.copyLink(this.filmUrl({ w: 3840, h: 2160, store: s.id })),
      connColor: s.conn === 'offline' ? '#8D1D2C' : s.conn === '4G' ? '#B8860B' : '#2E7D32',
      connLabel: s.conn === 'offline' ? 'Magasin injoignable' : s.conn === '4G' ? 'Connectivité 4G' : 'Fibre',
      players: s.players.map((p) => {
        const late = p.assignedVer > p.playedVer;
        const dstale = p.dataAge > 3600;
        const ov = st.override && p.state !== 'offline';
        return {
          name: p.name, hw: p.hw, orient: p.orient,
          playerUrl: `player.html?id=${encodeURIComponent(p.id)}&token=${encodeURIComponent(p.token)}`,
          kioskLabel: p.kiosk ? 'KIOSK' : '⚠ non verrouillé',
          kioskStyle: `flex:0 0 auto;font-size:9px;font-weight:700;letter-spacing:0.06em;border-radius:999px;padding:2px 7px;${p.kiosk ? 'background:rgba(46,125,50,0.14);color:#2E7D32;' : 'background:rgba(141,29,44,0.12);color:#8D1D2C;'}`,
          statusDotStyle: `width:12px;height:12px;border-radius:50%;flex:0 0 auto;background:${ov ? '#8D1D2C' : STCOL[p.state]};box-shadow:0 0 0 4px ${ov ? '#8D1D2C' : STCOL[p.state]}22;`,
          statusPillStyle: `display:inline-flex;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;color:${ov ? '#fff' : STCOL[p.state]};background:${ov ? '#8D1D2C' : STCOL[p.state] + '18'};`,
          statusLabel: ov ? '⚡ Override' : STLAB[p.state],
          playedVer: p.playedVer,
          verStyle: `font-weight:600;color:${late ? '#B8860B' : '#232220'};`,
          verNote: late ? `assignée v${p.assignedVer} · en retard` : 'à jour',
          dataVer: p.dataVer,
          dataStyle: `font-weight:600;color:${dstale ? '#8D1D2C' : '#232220'};`,
          dataAge: p.state === 'offline' ? `${ageShort(p.dataAge)} (cache)` : `il y a ${ageShort(p.dataAge)}`,
          dataAgeColor: dstale ? '#8D1D2C' : '#8A847C',
          cachePct: `${p.cache}%`,
          cacheColor: p.cache >= 100 ? '#2E7D32' : p.cache >= 50 ? '#B8860B' : '#8D1D2C',
          media: p.media,
          sync: p.state === 'offline' ? `hors ligne ${fmtAgo(p.syncAgo)}` : fmtAgo(p.syncAgo),
          health: p.state === 'offline' ? `heartbeats en file · ${p.disk}` : `${p.disk} · ${p.temp}`,
        };
      }),
    }));

    const targets = st.fleet.map((s) => {
      const on = !!st.pubTargets[s.id];
      return {
        label: s.store, sub: `${s.group} · ${s.players.length} écran(s)`,
        toggle: () => this.toggleTarget(s.id),
        style: `display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-radius:12px;cursor:pointer;text-align:left;background:${on ? 'rgba(141,29,44,0.06)' : '#FBF8F2'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
        checkStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;flex:0 0 auto;font-size:13px;${on ? 'background:#8D1D2C;color:#fff;' : 'background:#fff;border:1px solid rgba(35,34,32,0.20);color:transparent;'}`,
        check: on ? '✓' : '',
      };
    });
    const PSLOTS = ['Matin', 'Midi', 'Après-midi', 'Toute la journée'];
    const pubSlots = PSLOTS.map((l) => ({
      label: l,
      pick: () => this.setState({ pubSlot: l }),
      style: `padding:9px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${st.pubSlot === l ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
    }));
    const tgtCount = this.targetCount();
    const nextV = st.version + 1;
    const whenLabel = st.pubWhen === 'scheduled'
      ? (st.activateAt ? `planifiée le ${st.activateAt.replace('T', ' à ')}` : 'planifiée (choisir une date)')
      : 'immédiate (dès cache prêt)';

    const crumbs = (() => {
      const arr = [];
      const crumb = (label, go, cur) => ({
        label,
        go: go || (() => {}),
        sepStyle: `font-size:13px;color:#C9C3B8;margin:0 4px;${arr.length === 0 ? 'display:none;' : ''}`,
        style: `background:none;border:none;padding:2px 4px;font-size:12.5px;cursor:${go ? 'pointer' : 'default'};${cur ? 'color:#232220;font-weight:600;' : 'color:#8A847C;'}`,
      });
      if (st.view === 'fleet') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Flotte & supervision', () => this.setView('fleet'), false));
        arr.push(crumb(`${online + offline} écrans · ${st.fleet.length} magasins`, null, true));
      } else if (st.view === 'settings') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Paramètres', null, false));
        arr.push(crumb('Serveur & connexion', null, true));
      } else {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Playlist', null, false));
        arr.push(crumb(`${m.name}${isLia ? ' (liaison)' : ''}`, null, true));
      }
      return arr;
    })();

    return {
      playlist, library, layoutOptions, motionGroups, items, days, posFields, timeSlots, crumbs,
      resetPos: () => this.resetPos(),
      undo: () => this.undo(), redo: () => this.redo(),
      undoStyle: `display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;font-size:16px;${st.past.length ? 'background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);color:#232220;cursor:pointer;' : 'background:rgba(35,34,32,0.03);border:1px solid rgba(35,34,32,0.06);color:#C9C3B8;cursor:not-allowed;'}`,
      redoStyle: `display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;font-size:16px;${st.future.length ? 'background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);color:#232220;cursor:pointer;' : 'background:rgba(35,34,32,0.03);border:1px solid rgba(35,34,32,0.06);color:#C9C3B8;cursor:not-allowed;'}`,
      isComposerView: st.view === 'composer', isFleetView: st.view === 'fleet', isSettingsView: st.view === 'settings',
      setViewComposer: () => this.setView('composer'),
      setViewFleet: () => this.setView('fleet'),
      setViewSettings: () => this.setView('settings'),
      tabComposerStyle: stTab + (st.view === 'composer' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabFleetStyle: stTab + (st.view === 'fleet' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      settingsIconStyle: `display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;font-size:17px;cursor:pointer;flex:0 0 auto;${st.view === 'settings' ? 'background:#8D1D2C;color:#fff;border:none;' : 'background:#EFE9E0;color:#232220;border:1px solid rgba(35,34,32,0.10);'}`,
      playlistVersion: st.version,
      pushPrices: this.pushPrices,
      toggleOverride: this.toggleOverride,
      overrideLabel: st.override ? '⏹ Reprendre' : '⚡ Diffusion flash',
      overrideStyle: `padding:10px 16px;font-size:13.5px;font-weight:600;border-radius:999px;cursor:pointer;${st.override ? 'background:#8D1D2C;color:#fff;border:none;' : 'background:rgba(35,34,32,0.06);color:#232220;border:1px solid rgba(35,34,32,0.14);'}`,
      kpis, fleet,
      hasAlerts: offline > 0 || errors > 0 || stale > 0 || st.override,
      alertText: `${st.override ? '⚡ Diffusion flash active — playlists normales suspendues. ' : ''}${offline > 0 ? offline + ' écran(s) hors ligne — lecture + prix poursuivis depuis le cache local. ' : ''}${stale > 0 ? stale + ' snapshot(s) prix périmé(s) (>1 h) à resynchroniser. ' : ''}${errors > 0 ? errors + ' écran(s) en erreur (stockage/temp) à intervenir.' : ''}`,
      publishing: st.publishing,
      stop: (e) => e.stopPropagation(),
      openPublish: () => this.openPublish(),
      closePublish: () => this.closePublish(),
      targets, pubSlots,
      setModeFull: () => this.setState({ pubMode: 'full' }),
      setModeData: () => this.setState({ pubMode: 'data' }),
      modeFullStyle: `text-align:left;padding:14px;border-radius:12px;cursor:pointer;background:${st.pubMode === 'full' ? 'rgba(141,29,44,0.06)' : '#FBF8F2'};border:1px solid ${st.pubMode === 'full' ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
      modeDataStyle: `text-align:left;padding:14px;border-radius:12px;cursor:pointer;background:${st.pubMode === 'data' ? 'rgba(141,29,44,0.06)' : '#FBF8F2'};border:1px solid ${st.pubMode === 'data' ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
      whenScheduled: st.pubWhen === 'scheduled',
      setWhenNow: () => this.setState({ pubWhen: 'now' }),
      setWhenScheduled: () => this.setState({ pubWhen: 'scheduled' }),
      whenNowStyle: `padding:7px 15px;font-size:12.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${st.pubWhen === 'now' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      whenSchedStyle: `padding:7px 15px;font-size:12.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${st.pubWhen === 'scheduled' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      activateAt: st.activateAt,
      onActivateAt: (e) => this.setState({ activateAt: e.target.value }),
      publishSummary: st.pubMode === 'data'
        ? `Snapshot prix d${st.dataVer + 1} → ${tgtCount} écran(s). Sync incrémentale légère : seules les données de prix changent, les médias et vidéos en cache ne sont pas re-téléchargés. Les écrans hors ligne l'appliqueront au retour du réseau. Des tests live vérifient le déploiement juste après la publication.`
        : `Playlist v${nextV} → ${tgtCount} écran(s) · ${st.pubSlot} · activation ${whenLabel}. Bascule atomique : chaque player continue sa version actuelle jusqu'à ce que tous ses médias + templates + snapshots soient en cache et vérifiés. Des tests live vérifient le déploiement juste après la publication.`,
      deploy: this.deploy,
      deployLabel: st.deploying ? 'Déploiement + tests live…' : (tgtCount ? (st.pubMode === 'data' ? `Pousser les prix sur ${tgtCount} écran(s)` : `Déployer sur ${tgtCount} écran(s)`) : 'Choisir une cible'),
      deployStyle: `padding:11px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:${tgtCount && !st.deploying ? 'pointer' : 'not-allowed'};${tgtCount ? 'background:#8D1D2C;color:#fff;' : 'background:rgba(35,34,32,0.10);color:#8A847C;'}opacity:${st.deploying ? 0.7 : 1};`,
      hasToast: !!st.toast, toast: st.toast,
      playlistEmpty: st.playlist.length === 0,
      isCategory: isCat, isLiaison: isLia,
      selName: m.name,
      selTypeLabel: isLia ? 'Liaison' : 'Catégorie',
      selTypeBadge: `display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;${isLia ? 'background:rgba(35,34,32,0.10);color:#8A847C;' : 'background:rgba(141,29,44,0.12);color:#8D1D2C;'}`,
      liaisonSub: m.sub || '',
      onSelName: (e) => this.setSelField('name', e.target.value),
      onLiaisonSub: (e) => this.setSelField('sub', e.target.value),
      addCategory: () => this.addCategory(),
      addLiaison: () => this.addLiaison(),
      addItem: () => this.addItem(),
      paste: () => this.paste(),
      pasteStyle: `flex:1 1 auto;padding:10px;font-size:12.5px;font-weight:500;border-radius:10px;cursor:${st.clipboard ? 'pointer' : 'not-allowed'};${st.clipboard ? 'color:#232220;background:#EFE9E0;border:1px solid rgba(35,34,32,0.14);' : 'color:#B8B2A8;background:rgba(35,34,32,0.04);border:1px solid rgba(35,34,32,0.08);'}`,
      tagEnabled: !!(m.tag && m.tag.enabled),
      tagLabel: m.tag ? m.tag.label : '',
      tagImg: m.tag ? m.tag.img : '',
      toggleTag: () => this.setTag('enabled', !(m.tag && m.tag.enabled)),
      onTagLabel: (e) => this.setTag('label', e.target.value),
      onTagImg: (e) => this.setTag('img', e.target.value),
      tagTrackStyle: `position:relative;width:50px;height:28px;border-radius:999px;border:none;cursor:pointer;flex:0 0 auto;background:${m.tag && m.tag.enabled ? '#8D1D2C' : 'rgba(35,34,32,0.18)'};`,
      tagKnobStyle: `position:absolute;top:3px;left:${m.tag && m.tag.enabled ? '25px' : '3px'};width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,0.25);`,
      scheduleSummary: this.schedSummary(m.schedule),
      fromTime: m.schedule.from, toTime: m.schedule.to,
      onFrom: (e) => this.setSched('from', e.target.value),
      onTo: (e) => this.setSched('to', e.target.value),
      setAllHours: () => this.setSchedBoth('00:00', '23:59'),
      preview: this.renderPreview(),
      dragHint: st.view === 'composer' && st.scope === 'module' && isCat,
      nowPlaying: st.scope === 'playlist' ? (playM ? `▶ ${playM.name}` : 'Playlist vide') : 'Aperçu du module',
      liveLine,
      togglePlay: () => this.setState({ playing: !st.playing }),
      restart: () => this.setState({ t: 0, playing: true }),
      playIcon: st.playing ? '❚❚' : '▶',
      scrub: this.scrub, trackRef: this.trackRef,
      progressPct: `${clx(st.t / total, 0, 1) * 100}%`,
      timeLabel: `${fmtTime(st.t)} / ${fmtTime(total)}`,
      setScopeModule: () => this.setState({ scope: 'module', t: 0 }),
      setScopePlaylist: () => this.setState({ scope: 'playlist', t: 0 }),
      scopeModuleStyle: `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-radius:999px;cursor:pointer;${st.scope === 'module' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      scopePlaylistStyle: `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-radius:999px;cursor:pointer;${st.scope === 'playlist' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}`,
      secPerLine: st.secPerLine,
      secLabel: `${st.secPerLine.toFixed(st.secPerLine % 1 ? 1 : 0)} s`,
      onSec: (e) => this.dirty({ secPerLine: parseFloat(e.target.value) }),
      toggleLoop: () => this.dirty({ loop: !st.loop }),
      loopTrackStyle: `position:relative;width:50px;height:28px;border-radius:999px;border:none;cursor:pointer;flex:0 0 auto;background:${st.loop ? '#8D1D2C' : 'rgba(35,34,32,0.18)'};`,
      loopKnobStyle: `position:absolute;top:3px;left:${st.loop ? '25px' : '3px'};width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,0.25);`,
      moduleCount: st.playlist.length,
      playlistTotal: fmtTime(this.playlistMods().reduce((s, mm) => s + this.moduleDur(mm), 0)),
      srvUrl: st.srvUrl, srvIp: st.srvIp, srvToken: st.srvToken,
      onSrvUrl: (e) => { this.setState({ srvUrl: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      onSrvIp: (e) => { this.setState({ srvIp: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      onSrvToken: (e) => { this.setState({ srvToken: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      srvPing: st.test.state === 'ok' ? '● Connecté' : st.test.state === 'fail' ? '● Échec' : st.test.state === 'testing' ? '○ Test…' : '○ Non testé',
      srvPingStyle: `font-size:12px;font-weight:600;color:${st.test.state === 'ok' ? '#2E7D32' : st.test.state === 'fail' ? '#8D1D2C' : '#8A847C'};`,
      testConn: this.testConn,
      testBtnLabel: st.test.state === 'testing' ? 'Test en cours…' : 'Tester la connexion (live)',
      testBtnStyle: `width:100%;padding:11px;font-size:13.5px;font-weight:600;border-radius:10px;cursor:${st.test.state === 'testing' ? 'progress' : 'pointer'};border:none;background:#232220;color:#fff;opacity:${st.test.state === 'testing' ? 0.7 : 1};`,
      hasTestRows: st.test.rows.length > 0,
      testRows: st.test.rows.map((r) => ({
        label: r.label,
        result: r.ok ? `${r.ms} ms · ${r.status || 'OK'}` : (r.detail || 'échec'),
        color: r.ok ? '#2E7D32' : '#8D1D2C',
        dotStyle: `width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:${r.ok ? '#2E7D32' : '#8D1D2C'};`,
      })),
      save: this.save,
      saveLabel: st.saved ? '✓ Enregistré' : (st.dirty ? 'Enregistrer' : 'Enregistré'),
      saveStyle: `padding:10px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:pointer;${st.dirty ? 'background:#8D1D2C;color:#fff;' : 'background:rgba(35,34,32,0.08);color:#8A847C;'}`,
      statusText: st.dirty ? 'Modifs non enregistrées' : 'Enregistré',
      statusBg: st.dirty ? 'rgba(180,120,20,0.12)' : 'rgba(46,125,50,0.12)',
      statusDot: st.dirty ? '#B8860B' : '#2E7D32',
      statusRing: st.dirty ? 'rgba(184,134,11,0.18)' : 'rgba(46,125,50,0.18)',
      statusFg: st.dirty ? '#8a6508' : '#2E7D32',
    };
  }

  // ------------------------------------------------------------------ render
  render() {
    const st = this.state;
    if (st.loading) {
      return html`<div style="height:100vh;display:flex;align-items:center;justify-content:center;color:#8A847C;font-size:15px;">Chargement de la régie…</div>`;
    }
    if (st.authRequired) {
      return html`<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#E7E1D8;padding:24px;">
        <form onSubmit=${this.doLogin} style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:20px;padding:36px 38px;width:360px;max-width:100%;box-shadow:0 30px 80px rgba(0,0,0,0.10);display:flex;flex-direction:column;gap:13px;">
          <img src="assets/logo.png" alt="L'Atelier By" style="height:44px;width:auto;align-self:center;margin-bottom:4px;" />
          <div style="text-align:center;font-weight:600;font-size:16px;">Régie d'affichage</div>
          <div style="text-align:center;font-size:12px;color:#8A847C;margin-bottom:6px;">Connexion requise pour piloter la flotte</div>
          <label style="font-size:12.5px;font-weight:500;color:#8A847C;">Utilisateur</label>
          <input value=${st.loginUser} onInput=${(e) => this.setState({ loginUser: e.target.value })} autocomplete="username" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          <label style="font-size:12.5px;font-weight:500;color:#8A847C;">Mot de passe</label>
          <input type="password" value=${st.loginPass} onInput=${(e) => this.setState({ loginPass: e.target.value })} autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          ${st.loginError && html`<div style="font-size:12.5px;color:#8D1D2C;">${st.loginError}</div>`}
          <button type="submit" style="margin-top:6px;padding:12px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:pointer;background:#232220;color:#fff;opacity:${st.loggingIn ? 0.7 : 1};">${st.loggingIn ? 'Connexion…' : 'Se connecter'}</button>
          <a href="film" target="_blank" style="margin-top:10px;text-align:center;font-size:13px;font-weight:500;color:#8D1D2C;padding:10px;border:1px solid rgba(141,29,44,0.25);border-radius:999px;background:rgba(141,29,44,0.06);">▶ Visualiser le film (sans connexion)</a>
        </form>
      </div>`;
    }
    if (st.loadError) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:#8D1D2C;font-size:15px;">
        <div>Impossible de joindre le CMS : ${st.loadError}</div>
        <button onClick=${() => { this.setState({ loading: true, loadError: '' }); this.loadState(); }} style="padding:10px 22px;border-radius:999px;border:none;background:#232220;color:#fff;cursor:pointer;">Réessayer</button>
      </div>`;
    }
    const v = this.vals();

    return html`
<div style="height:100vh;background:#E7E1D8;color:#232220;display:flex;flex-direction:column;overflow:hidden;">

  <header style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px 24px;padding:14px 30px;background:#FFFFFF;border-bottom:1px solid rgba(35,34,32,0.10);z-index:5;">
    <div style="display:flex;align-items:center;gap:16px;min-width:0;flex:1 1 auto;">
      <img src="assets/logo.png" alt="L'Atelier By" style="height:38px;width:auto;flex:0 0 auto;" />
      <span style="width:1px;height:30px;background:rgba(35,34,32,0.14);flex:0 0 auto;"></span>
      <div style="display:flex;flex-direction:column;min-width:0;overflow:hidden;">
        <span style="font-weight:500;font-size:15px;letter-spacing:0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Régie d'affichage</span>
        <span style="font-size:11.5px;letter-spacing:0.12em;text-transform:uppercase;color:#8A847C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Signage hybride · cache local</span>
      </div>
      <div style="display:inline-flex;background:#EFE9E0;border-radius:999px;padding:3px;flex:0 0 auto;margin-left:6px;">
        <button onClick=${v.setViewComposer} style=${v.tabComposerStyle}>Compositeur</button>
        <button onClick=${v.setViewFleet} style=${v.tabFleetStyle}>Flotte & supervision</button>
      </div>
      <button onClick=${v.setViewSettings} title="Paramètres · serveur & connexion" style=${v.settingsIconStyle}>⚙</button>
    </div>
    <div style="display:flex;align-items:center;gap:12px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;">
      <div style="display:flex;align-items:center;gap:4px;">
        <button onClick=${v.undo} title="Annuler (⌘Z)" style=${v.undoStyle}>↶</button>
        <button onClick=${v.redo} title="Rétablir (⌘⇧Z)" style=${v.redoStyle}>↷</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:rgba(35,34,32,0.05);">
        <span style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">Version</span>
        <span style="font-size:13px;font-weight:600;color:#232220;">v${v.playlistVersion}</span>
      </div>
      <div style="display:flex;align-items:center;gap:9px;padding:7px 15px;border-radius:999px;background:${v.statusBg};">
        <span style="width:9px;height:9px;border-radius:50%;background:${v.statusDot};box-shadow:0 0 0 4px ${v.statusRing};"></span>
        <span style="font-size:12.5px;font-weight:500;letter-spacing:0.03em;color:${v.statusFg};">${v.statusText}</span>
      </div>
      <button onClick=${v.save} style=${v.saveStyle}>${v.saveLabel}</button>
      <button onClick=${v.pushPrices} title="Sync incrémentale légère — ne re-télécharge aucun média" style="padding:10px 16px;font-size:13.5px;font-weight:600;border-radius:999px;border:1px solid rgba(141,29,44,0.28);cursor:pointer;background:rgba(141,29,44,0.08);color:#8D1D2C;">⚡ Pousser les prix</button>
      <button onClick=${v.toggleOverride} style=${v.overrideStyle}>${v.overrideLabel}</button>
      <button onClick=${v.openPublish} style="padding:10px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:pointer;background:#232220;color:#fff;">Publier sur la flotte ↗</button>
    </div>
  </header>

  <nav style="flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:9px 30px;background:#F3EEE6;border-bottom:1px solid rgba(35,34,32,0.08);">
    ${v.crumbs.map((c) => html`
      <span style=${c.sepStyle}>›</span>
      <button onClick=${c.go} style=${c.style}>${c.label}</button>
    `)}
    <a href="film" target="_blank" title="Ouvrir la visionneuse publique du film (dernière playlist publiée)" style="margin-left:auto;font-size:12.5px;font-weight:600;color:#8D1D2C;padding:4px 12px;border:1px solid rgba(141,29,44,0.25);border-radius:999px;background:rgba(141,29,44,0.06);">▶ Voir le film</a>
  </nav>

  ${v.isSettingsView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:34px 32px 48px;">
    <div style="max-width:640px;margin:0 auto;">
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:600;">Paramètres</h1>
      <p style="margin:0 0 26px;font-size:13.5px;color:#8A847C;">Point d'accès au CMS et test de connexion live d'un player. Les tests s'exécutent aussi automatiquement à chaque déploiement.</p>
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:26px 28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Serveur & connexion</h2>
          <span style=${v.srvPingStyle}>${v.srvPing}</span>
        </div>
        <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">URL du CMS (API base)</label>
        <input value=${v.srvUrl} onInput=${v.onSrvUrl} placeholder="https://cms.erp.local/api/v1" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;margin-bottom:16px;" />
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <div style="flex:1 1 auto;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">IP / hôte player</label>
            <input value=${v.srvIp} onInput=${v.onSrvIp} placeholder="192.168.1.42" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          </div>
          <div style="flex:1 1 auto;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">Token player</label>
            <input value=${v.srvToken} onInput=${v.onSrvToken} placeholder="plyr_…" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          </div>
        </div>
        <button onClick=${v.testConn} style=${v.testBtnStyle}>${v.testBtnLabel}</button>
        ${v.hasTestRows && html`
          <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
            ${v.testRows.map((r) => html`
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:9px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;"><span style=${r.dotStyle}></span><span style="font-size:13px;font-family:ui-monospace,monospace;color:#232220;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.label}</span></div>
                <span style="flex:0 0 auto;font-size:13px;font-weight:600;color:${r.color};">${r.result}</span>
              </div>
            `)}
          </div>
        `}
      </div>
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:26px 28px;margin-top:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Liens de diffusion — film</h2>
          <a href="film" target="_blank" style="font-size:12.5px;font-weight:600;color:#8D1D2C;">▶ Ouvrir le film</a>
        </div>
        <p style="margin:0 0 16px;font-size:12px;color:#8A847C;line-height:1.5;">Le format d'écran (pixels + ratio) est inscrit dans l'URL : copie le lien du format voulu et pointe la TV / box / navigateur directement dessus. La lecture ne demande aucune connexion.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${this.filmLinks().map((l) => html`
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);">
              <div style="flex:0 0 190px;min-width:0;">
                <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.label}</div>
                <div style="font-size:10.5px;color:#8A847C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.sub}</div>
              </div>
              <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:7px;background:#fff;color:#232220;" />
              <button onClick=${() => this.copyLink(l.url)} title="Copier le lien" style="flex:0 0 auto;padding:8px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">Copier</button>
              <a href=${l.url} target="_blank" title="Ouvrir dans un onglet" style="flex:0 0 auto;padding:8px 11px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(35,34,32,0.14);background:#fff;color:#232220;">↗</a>
            </div>
          `)}
        </div>
        ${this.storeFilmLinks().length > 0 && html`
          <h3 style="margin:20px 0 4px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Par magasin · version assignée au magasin (55″ standard)</h3>
          <p style="margin:0 0 12px;font-size:11.5px;color:#8A847C;line-height:1.5;">Chaque lien montre le film que CE magasin doit jouer — pratique à envoyer au responsable du point de vente.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${this.storeFilmLinks().map((l) => html`
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);">
                <div style="flex:0 0 190px;min-width:0;">
                  <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.label}</div>
                  <div style="font-size:10.5px;color:#8A847C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.sub}</div>
                </div>
                <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:7px;background:#fff;color:#232220;" />
                <button onClick=${() => this.copyLink(l.url)} title="Copier le lien" style="flex:0 0 auto;padding:8px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">Copier</button>
                <a href=${l.url} target="_blank" title="Ouvrir dans un onglet" style="flex:0 0 auto;padding:8px 11px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(35,34,32,0.14);background:#fff;color:#232220;">↗</a>
              </div>
            `)}
          </div>
        `}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button onClick=${this.logout} style="padding:10px 18px;font-size:13px;font-weight:500;border-radius:999px;border:1px solid rgba(35,34,32,0.16);background:#fff;color:#8A847C;cursor:pointer;">Se déconnecter</button>
      </div>
    </div>
  </div>
  `}

  ${v.isFleetView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:26px 32px 48px;">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;max-width:1400px;margin:0 auto 22px;">
      ${v.kpis.map((k) => html`
        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:20px 22px;">
          <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:8px;">${k.label}</div>
          <div style="display:flex;align-items:baseline;gap:10px;"><span style="font-size:40px;font-weight:600;color:${k.color};line-height:1;">${k.value}</span><span style="font-size:13px;color:#8A847C;">${k.sub}</span></div>
        </div>
      `)}
    </div>

    ${v.hasAlerts && html`
      <div style="max-width:1400px;margin:0 auto 22px;display:flex;align-items:center;gap:12px;padding:14px 20px;border-radius:12px;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);">
        <span style="font-size:18px;">⚠</span>
        <span style="font-size:14px;color:#8D1D2C;font-weight:500;">${v.alertText}</span>
      </div>
    `}

    <div style="max-width:1400px;margin:0 auto;display:flex;flex-direction:column;gap:18px;">
      ${v.fleet.map((s) => html`
        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid rgba(35,34,32,0.08);background:#FBF8F2;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:16px;font-weight:600;">${s.store}</span>
              <span style="font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;background:rgba(35,34,32,0.07);border-radius:999px;padding:3px 10px;">${s.group}</span>
              <button onClick=${s.copyFilm} title="Copier le lien direct du film de ce magasin (55″ standard)" style="padding:5px 11px;font-size:11.5px;font-weight:600;border-radius:999px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Lien film</button>
              <a href=${s.filmUrl} target="_blank" title="Ouvrir le film de ce magasin" style="font-size:11.5px;font-weight:600;color:#8D1D2C;">↗</a>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:${s.connColor};"><span style="width:8px;height:8px;border-radius:50%;background:${s.connColor};"></span>${s.connLabel}</div>
          </div>
          <div style="display:flex;flex-direction:column;">
            ${s.players.map((p) => html`
              <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1.2fr 1fr;gap:16px;align-items:center;padding:15px 22px;border-top:1px solid rgba(35,34,32,0.05);">
                <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                  <span style=${p.statusDotStyle}></span>
                  <div style="min-width:0;">
                    <div style="display:flex;align-items:center;gap:7px;"><a href=${p.playerUrl} target="_blank" title="Ouvrir ce player dans un onglet (test live)" style="font-size:14px;font-weight:600;color:#232220;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name} <span style="color:#B8B2A8;font-weight:400;">↗</span></a><span style=${p.kioskStyle}>${p.kioskLabel}</span></div>
                    <div style="font-size:11.5px;color:#8A847C;">${p.hw} · ${p.orient}</div>
                  </div>
                </div>
                <div><span style=${p.statusPillStyle}>${p.statusLabel}</span></div>
                <div style="font-size:12.5px;"><span style="color:#8A847C;">Playlist </span><span style=${p.verStyle}>v${p.playedVer}</span><div style="font-size:11px;color:#8A847C;">${p.verNote}</div><div style="font-size:11px;margin-top:2px;"><span style="color:#8A847C;">Prix </span><span style=${p.dataStyle}>d${p.dataVer}</span><span style="color:${p.dataAgeColor};"> · ${p.dataAge}</span></div></div>
                <div style="font-size:12px;color:#8A847C;min-width:0;">
                  <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
                    <div style="flex:1 1 auto;height:6px;border-radius:3px;background:rgba(35,34,32,0.10);overflow:hidden;"><div style="height:100%;border-radius:3px;background:${p.cacheColor};width:${p.cachePct};"></div></div>
                    <span style="flex:0 0 auto;font-variant-numeric:tabular-nums;">${p.cachePct}</span>
                  </div>
                  <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">▶ ${p.media}</div>
                </div>
                <div style="font-size:12px;color:#8A847C;text-align:right;"><div style="font-weight:500;color:#232220;">${p.sync}</div><div>${p.health}</div></div>
              </div>
            `)}
          </div>
        </div>
      `)}
    </div>
  </div>
  `}

  ${v.isComposerView && html`
  <div style="flex:1 1 auto;display:grid;grid-template-columns:300px minmax(440px,1fr) minmax(560px,0.95fr);min-height:0;">

    <aside style="background:#F3EEE6;border-right:1px solid rgba(35,34,32,0.10);display:flex;flex-direction:column;min-height:0;overflow:auto;">
      <div style="flex:0 0 auto;padding:18px 18px 10px;">
        <h2 style="margin:0 0 3px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Playlist diffusée</h2>
        <p style="margin:0;font-size:11.5px;color:#8A847C;line-height:1.4;">Glisse pour l'ordre · ✕ retire (sans supprimer)</p>
      </div>
      <div style="flex:0 0 auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:7px;">
        ${v.playlist.map((mp) => html`
          <div class="pl-item" draggable="true" onDragStart=${mp.onDragStart} onDragOver=${mp.onDragOver} onDrop=${mp.onDrop} onDragEnd=${mp.onDragEnd} onClick=${mp.select} style=${mp.cardStyle}>
            <span style="cursor:grab;color:#B8B2A8;font-size:14px;line-height:1;flex:0 0 auto;">⠿</span>
            <span style=${mp.badgeStyle}>${mp.order}</span>
            <div style="flex:1 1 auto;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${mp.name}</span>
                ${mp.tagChip}
              </div>
              <div style="font-size:11px;color:#8A847C;letter-spacing:0.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${mp.meta}</div>
            </div>
            <button onClick=${mp.remove} title="Retirer de la playlist" style=${mp.miniBtnDel}>✕</button>
          </div>
        `)}
        ${v.playlistEmpty && html`
          <div style="padding:16px;text-align:center;font-size:12px;color:#B8B2A8;border:1px dashed rgba(35,34,32,0.18);border-radius:10px;">Ajoute des modules depuis la bibliothèque ↓</div>
        `}
      </div>

      <div style="flex:0 0 auto;padding:14px 18px 10px;border-top:1px solid rgba(35,34,32,0.10);">
        <h2 style="margin:0 0 3px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Bibliothèque</h2>
        <p style="margin:0;font-size:11.5px;color:#8A847C;line-height:1.4;">Tous les modules · ＋ ajoute à la playlist</p>
      </div>
      <div style="flex:1 1 auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:7px;">
        ${v.library.map((ml) => html`
          <div onClick=${ml.select} style=${ml.cardStyle}>
            <span style=${ml.badgeStyle}>${ml.typeIcon}</span>
            <div style="flex:1 1 auto;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ml.name}</span>
                ${ml.tagChip}
              </div>
              <div style="font-size:11px;color:#8A847C;">${ml.libMeta}</div>
            </div>
            <div style="display:flex;align-items:center;gap:3px;flex:0 0 auto;">
              <button onClick=${ml.addToPlaylist} title="Ajouter à la playlist" style=${ml.addBtn}>＋</button>
              <button onClick=${ml.copy} title="Copier" style=${ml.miniBtn}>⧉</button>
              <button onClick=${ml.dup} title="Dupliquer" style=${ml.miniBtn}>⎘</button>
              <button onClick=${ml.del} title="Supprimer de la bibliothèque" style=${ml.miniBtnDel}>🗑</button>
            </div>
          </div>
        `)}
      </div>
      <div style="flex:0 0 auto;padding:12px;border-top:1px solid rgba(35,34,32,0.10);display:flex;flex-direction:column;gap:8px;">
        <button onClick=${v.addCategory} style="width:100%;padding:11px;font-size:13.5px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:10px;cursor:pointer;">+ Catégorie</button>
        <div style="display:flex;gap:8px;">
          <button onClick=${v.addLiaison} style="flex:1 1 auto;padding:10px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.20);border-radius:10px;cursor:pointer;">+ Liaison</button>
          <button onClick=${v.paste} style=${v.pasteStyle}>Coller</button>
        </div>
      </div>
    </aside>

    <section style="overflow:auto;padding:24px 26px 40px;border-right:1px solid rgba(35,34,32,0.10);">
      <div style="display:flex;flex-direction:column;gap:20px;max-width:600px;">

        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span style=${v.selTypeBadge}>${v.selTypeLabel}</span>
            <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">Module sélectionné</h2>
          </div>
          <input value=${v.selName} onInput=${v.onSelName} placeholder="Nom du module" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:19px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:10px;background:#FBF8F2;" />
          ${v.isLiaison && html`
            <div style="margin-top:14px;">
              <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:7px;">Sous-titre (accroche)</label>
              <input value=${v.liaisonSub} onInput=${v.onLiaisonSub} placeholder="ex. faites maison chaque matin" style="width:100%;box-sizing:border-box;padding:11px 13px;font-size:15px;border:1px solid rgba(35,34,32,0.16);border-radius:10px;background:#FBF8F2;" />
            </div>
          `}
        </div>

        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Tag campagne</h2>
            <button onClick=${v.toggleTag} style=${v.tagTrackStyle}><span style=${v.tagKnobStyle}></span></button>
          </div>
          <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.5;">Affiche un macaron (illustration + texte) sur l'écran, pour une campagne commerciale.</p>
          ${v.tagEnabled && html`
            <div style="display:flex;gap:10px;align-items:center;">
              <select value=${v.tagImg} onChange=${v.onTagImg} style="flex:0 0 150px;padding:10px;font-size:13px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                <option value="">Aucune icône</option>
                <option value="assets/cherry.png">Cerise</option>
                <option value="assets/apple.png">Pomme</option>
                <option value="assets/rhubarb.png">Rhubarbe</option>
                <option value="assets/cake-slice.png">Part de gâteau</option>
                <option value="assets/cookies.png">Cookie</option>
              </select>
              <input value=${v.tagLabel} onInput=${v.onTagLabel} placeholder="ex. Nouveauté · -20%" style="flex:1 1 auto;min-width:0;padding:10px 12px;font-size:15px;font-weight:600;color:#8D1D2C;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
            </div>
          `}
        </div>

        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Programmation</h2>
            <span style="font-size:12px;color:#8A847C;">${v.scheduleSummary}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px;">
            ${v.days.map((d) => html`<button onClick=${d.toggle} style=${d.style}>${d.label}</button>`)}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px;">
            ${v.timeSlots.map((ts) => html`<button onClick=${ts.pick} style=${ts.style}>${ts.label}</button>`)}
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:13px;color:#8A847C;">De</span>
              <input type="time" value=${v.fromTime} onInput=${v.onFrom} style="padding:9px 11px;font-size:14px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:13px;color:#8A847C;">à</span>
              <input type="time" value=${v.toTime} onInput=${v.onTo} style="padding:9px 11px;font-size:14px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
            </div>
            <button onClick=${v.setAllHours} style="margin-left:auto;padding:9px 13px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.20);border-radius:8px;cursor:pointer;">Toute la journée</button>
          </div>
        </div>

        ${v.isCategory && html`
          <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
            <h2 style="margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Mise en page</h2>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
              ${v.layoutOptions.map((opt) => html`
                <button onClick=${opt.pick} style=${opt.style}>
                  <span style="display:block;font-size:20px;line-height:1;margin-bottom:7px;">${opt.icon}</span>
                  <span style="font-size:12px;font-weight:500;line-height:1.3;">${opt.label}</span>
                </button>
              `)}
            </div>
          </div>

          <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
            <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Mouvement dynamique</h2>
            <p style="margin:0 0 16px;font-size:12px;color:#8A847C;line-height:1.5;">Réglable indépendamment par élément.</p>
            <div style="display:flex;flex-direction:column;gap:14px;">
              ${v.motionGroups.map((g) => html`
                <div>
                  <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">${g.label}</label>
                  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;">
                    ${g.options.map((o) => html`<button onClick=${o.pick} style=${o.style}>${o.label}</button>`)}
                  </div>
                </div>
              `)}
            </div>
          </div>

          <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Positions (avancé)</h2>
              <button onClick=${v.resetPos} style="padding:7px 12px;font-size:12px;font-weight:500;color:#8A847C;background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);border-radius:8px;cursor:pointer;">Réinitialiser</button>
            </div>
            <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.5;">Ajuste finement le titre, la liste et l'illustration par-dessus la mise en page.</p>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${v.posFields.map((pf) => html`
                <div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label style="font-size:12.5px;font-weight:500;color:#8A847C;">${pf.label}</label>
                    <span style="font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;">${pf.display}</span>
                  </div>
                  <input type="range" min=${pf.min} max=${pf.max} step=${pf.step} value=${pf.value} onInput=${pf.onInput} style="width:100%;accent-color:#8D1D2C;" />
                </div>
              `)}
            </div>
          </div>

          <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Produits & tarifs</h2>
              <button onClick=${v.addItem} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;cursor:pointer;">+ Ajouter</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${v.items.map((it) => html`
                <div style=${it.wrapStyle}>
                  <div style="display:flex;align-items:center;gap:11px;">
                    ${it.thumb}
                    <input value=${it.name} onInput=${it.onName} placeholder="Nom du produit" style="flex:1 1 auto;min-width:0;padding:10px 12px;font-size:15px;font-weight:500;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
                    <div style="position:relative;flex:0 0 104px;">
                      <input value=${it.price} onInput=${it.onPrice} placeholder="0,00" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:10px 24px 10px 12px;font-size:15px;font-weight:600;text-align:right;color:#8D1D2C;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
                      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:13px;color:#8A847C;pointer-events:none;">€</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;flex:0 0 auto;">
                      <button onClick=${it.moveUp} title="Monter" style=${it.iconBtn}>↑</button>
                      <button onClick=${it.moveDown} title="Descendre" style=${it.iconBtn}>↓</button>
                      <button onClick=${it.dup} title="Dupliquer la ligne" style=${it.iconBtn}>⎘</button>
                      <button onClick=${it.toggleActive} title="Afficher / masquer" style=${it.eyeStyle}>${it.eyeIcon}</button>
                      <button onClick=${it.del} title="Supprimer" style=${it.delBtn}>✕</button>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;padding-left:57px;">
                    <div style="display:inline-flex;background:#EFE9E0;border-radius:8px;padding:3px;">
                      <button onClick=${it.setIllus} style=${it.illusTabStyle}>Illustration</button>
                      <button onClick=${it.setPhoto} style=${it.photoTabStyle}>Photo</button>
                    </div>
                    ${it.isIllus && html`
                      <select value=${it.img} onChange=${it.onImg} style="flex:1 1 auto;padding:9px 10px;font-size:13px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                        <option value="assets/cookies.png">Brookie / cookie</option>
                        <option value="assets/cake-slice.png">Part de gâteau</option>
                        <option value="assets/cake.png">Gâteau</option>
                        <option value="assets/cherry.png">Cerise</option>
                        <option value="assets/apple.png">Pomme</option>
                        <option value="assets/rhubarb.png">Rhubarbe</option>
                        <option value="assets/sweet-tart-small.png">Tarte (petite)</option>
                        <option value="assets/sweet-tart-big.png">Tarte (grande)</option>
                      </select>
                    `}
                    ${it.isPhoto && html`
                      <label style="flex:1 1 auto;display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:12.5px;color:#8A847C;border:1px dashed rgba(35,34,32,0.28);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                        <span style="font-size:15px;">⬆</span><span>${it.photoLabel}</span>
                        <input type="file" accept="image/*" onChange=${it.onPhoto} style="display:none;" />
                      </label>
                    `}
                  </div>
                </div>
              `)}
            </div>
          </div>
        `}

      </div>
    </section>

    <section style="overflow:auto;padding:24px 26px 40px;background:#EDE7DE;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;">
        <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">Aperçu · 6480 × 3840</h2>
        <div style="display:inline-flex;background:#E0D9CE;border-radius:999px;padding:3px;">
          <button onClick=${v.setScopeModule} style=${v.scopeModuleStyle}>Ce module</button>
          <button onClick=${v.setScopePlaylist} style=${v.scopePlaylistStyle}>Playlist</button>
        </div>
      </div>
      ${v.dragHint && html`
        <p style="margin:-4px 0 12px;font-size:11.5px;color:#8A847C;">✥ Glisse l'illustration ou le bandeau sur l'aperçu pour les positionner.</p>
      `}
      <div style="background:#232220;border-radius:16px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.16);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:0.06em;">${v.nowPlaying}</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.55);">Ligne <strong style="color:#fff;">${v.liveLine}</strong></span>
        </div>
        <div style="background:#0a0a0a;border-radius:10px;overflow:hidden;">${v.preview}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:18px;">
          <button onClick=${v.togglePlay} style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:#8D1D2C;color:#fff;border:none;cursor:pointer;font-size:16px;flex:0 0 auto;">${v.playIcon}</button>
          <button onClick=${v.restart} title="Recommencer" style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.10);color:#fff;border:none;cursor:pointer;font-size:14px;flex:0 0 auto;">↺</button>
          <div onClick=${v.scrub} ref=${v.trackRef} style="flex:1 1 auto;height:8px;border-radius:4px;background:rgba(255,255,255,0.14);position:relative;cursor:pointer;">
            <div style="position:absolute;left:0;top:0;height:100%;border-radius:4px;background:#8D1D2C;width:${v.progressPct};"></div>
            <div style="position:absolute;top:50%;transform:translate(-50%,-50%);left:${v.progressPct};width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
          </div>
          <span style="font-variant-numeric:tabular-nums;font-size:12.5px;color:rgba(255,255,255,0.7);flex:0 0 auto;min-width:84px;text-align:right;">${v.timeLabel}</span>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;margin-top:18px;">
        <h2 style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Diffusion</h2>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label style="font-size:13px;font-weight:500;color:#8A847C;">Durée par ligne</label>
          <span style="font-size:14px;font-weight:600;">${v.secLabel}</span>
        </div>
        <input type="range" min="1" max="8" step="0.5" value=${v.secPerLine} onInput=${v.onSec} style="width:100%;accent-color:#8D1D2C;margin-bottom:18px;" />
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:14px;font-weight:500;">Boucle continue</span>
          <button onClick=${v.toggleLoop} style=${v.loopTrackStyle}><span style=${v.loopKnobStyle}></span></button>
        </div>
        <div style="display:flex;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(35,34,32,0.08);font-size:12.5px;color:#8A847C;">
          <span>Playlist <strong style="color:#232220;">${v.moduleCount} modules</strong></span>
          <span style="color:rgba(35,34,32,0.18);">·</span>
          <span>Durée totale <strong style="color:#232220;">${v.playlistTotal}</strong></span>
        </div>
      </div>

    </section>

  </div>
  `}

  ${v.publishing && html`
    <div onClick=${v.closePublish} style="position:fixed;inset:0;background:rgba(35,34,32,0.55);z-index:20;display:flex;align-items:center;justify-content:center;padding:30px;">
      <div onClick=${v.stop} style="background:#F5EFE4;border-radius:20px;width:640px;max-width:100%;max-height:90vh;overflow:auto;box-shadow:0 40px 100px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 26px;border-bottom:1px solid rgba(35,34,32,0.10);">
          <div>
            <h2 style="margin:0;font-size:19px;font-weight:600;">Publier sur la flotte</h2>
            <p style="margin:4px 0 0;font-size:12.5px;color:#8A847C;">Déploiement atomique · le player bascule quand tous les médias sont en cache</p>
          </div>
          <button onClick=${v.closePublish} style="width:34px;height:34px;border-radius:50%;border:none;background:rgba(35,34,32,0.08);cursor:pointer;font-size:15px;">✕</button>
        </div>
        <div style="padding:24px 26px;display:flex;flex-direction:column;gap:22px;">
          <div>
            <h3 style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Type de synchronisation</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <button onClick=${v.setModeFull} style=${v.modeFullStyle}>
                <span style="display:block;font-size:14px;font-weight:600;margin-bottom:3px;">Playlist complète</span>
                <span style="font-size:11.5px;color:#8A847C;line-height:1.35;">Médias + templates + snapshots · bascule atomique</span>
              </button>
              <button onClick=${v.setModeData} style=${v.modeDataStyle}>
                <span style="display:block;font-size:14px;font-weight:600;margin-bottom:3px;">Données prix seules</span>
                <span style="font-size:11.5px;color:#8A847C;line-height:1.35;">Sync incrémentale légère · aucune vidéo re-téléchargée</span>
              </button>
            </div>
          </div>
          <div>
            <h3 style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Cibles</h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${v.targets.map((t) => html`
                <button onClick=${t.toggle} style=${t.style}>
                  <span style="display:flex;flex-direction:column;align-items:flex-start;"><span style="font-size:14px;font-weight:600;">${t.label}</span><span style="font-size:11.5px;color:#8A847C;">${t.sub}</span></span>
                  <span style=${t.checkStyle}>${t.check}</span>
                </button>
              `)}
            </div>
          </div>
          <div>
            <h3 style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Fenêtre horaire (day-parting)</h3>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${v.pubSlots.map((s) => html`<button onClick=${s.pick} style=${s.style}>${s.label}</button>`)}
            </div>
          </div>
          <div>
            <h3 style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Activation</h3>
            <div style="display:inline-flex;background:#EFE9E0;border-radius:8px;padding:3px;margin-bottom:12px;">
              <button onClick=${v.setWhenNow} style=${v.whenNowStyle}>Maintenant</button>
              <button onClick=${v.setWhenScheduled} style=${v.whenSchedStyle}>Planifiée</button>
            </div>
            ${v.whenScheduled && html`
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:13px;color:#8A847C;">activate_at</span>
                <input type="datetime-local" value=${v.activateAt} onInput=${v.onActivateAt} style="padding:9px 11px;font-size:14px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
              </div>
            `}
          </div>
          <div style="background:#FBF8F2;border:1px solid rgba(35,34,32,0.10);border-radius:12px;padding:16px 18px;font-size:13px;color:#232220;line-height:1.6;">
            ${v.publishSummary}
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;padding:18px 26px;border-top:1px solid rgba(35,34,32,0.10);">
          <button onClick=${v.closePublish} style="padding:11px 20px;font-size:14px;font-weight:500;border-radius:999px;border:1px solid rgba(35,34,32,0.16);background:#fff;cursor:pointer;">Annuler</button>
          <button onClick=${v.deploy} style=${v.deployStyle}>${v.deployLabel}</button>
        </div>
      </div>
    </div>
  `}

  ${v.hasToast && html`
    <div style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:12px;padding:14px 24px;border-radius:999px;background:#232220;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,0.3);font-size:14px;font-weight:500;max-width:calc(100vw - 60px);">
      <span style="width:9px;height:9px;border-radius:50%;background:#5BBE7A;flex:0 0 auto;"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.toast}</span>
    </div>
  `}
</div>`;
  }
}

render(h(App), document.getElementById('root'));
