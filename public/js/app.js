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
// Catégories de bibliothèque — chaque tag a sa couleur.
const LIB_TAGS = [
  { id: 'produit', label: 'Produit', color: '#8D1D2C' },
  { id: 'fetes', label: 'Fêtes', color: '#B8860B' },
  { id: 'promo', label: 'Promo', color: '#2E6E4E' },
  { id: 'liaison', label: 'Liaison', color: '#8A847C' },
];
const tagOf = (m) => LIB_TAGS.find((t) => t.id === (m.libTag || (m.type === 'liaison' ? 'liaison' : 'produit'))) || LIB_TAGS[0];

// Pastille (i) : bulle d'aide au survol (ou au clic sur écran tactile).
const infoTip = (text) => html`
  <span class="sig-info" onClick=${(e) => { e.stopPropagation(); e.currentTarget.classList.toggle('open'); }}>
    <button type="button" aria-label="Conseils">i</button>
    <span class="sig-tip">${text}</span>
  </span>`;
const PHOTO_TIP = 'Qualité top : photo carrée d’au moins 2000 × 2000 px, idéal 2500 × 2500 — elle est affichée en très grand sur les écrans. Produit centré, fond clair et uni (ou PNG détouré). Trop grande ? Elle est réduite automatiquement. En dessous de 1500 px, elle risque de paraître floue.';

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
    playlists: [], activePl: null, editingFilm: false, editFilmName: '', libFilter: 'all',
    editingStore: null, editStoreName: '',
    view: 'composer', composerTab: 'lib', publishing: false, deploying: false, version: 1, dataVer: 1, hbTick: 0, toast: '',
    pubTargets: {}, pubSlot: 'Toute la journée', pubWhen: 'now', activateAt: '', pubMode: 'full',
    pubDays: [true, true, true, true, true, true, true], pubDone: null, pubFilm: null,
    override: false,
    srvUrl: '', srvIp: '', srvToken: '',
    test: { state: 'idle', rows: [] },
    fleet: [],
    library: [],
    elementTypes: [], addPicker: false, openSec: 'items',
    catalog: { categories: [], products: [] },
    catDraft: null, catDirty: false, catSel: '', catSaving: false, langs: [], catLang: 'fr',
    pwaForm: null, pwaBusy: null, pwaResult: null,
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
      // Types d'éléments + table produits : tout vient de la base, rien en dur.
      const et = await api('GET', '/element-types').catch(() => ({ types: [] }));
      const cat = await api('GET', '/catalog').catch(() => ({ categories: [], products: [] }));
      const lg = await api('GET', '/langs').catch(() => ({ langs: [{ id: 'fr', label: 'Français' }] }));
      const pwa = await api('GET', '/pwa-config').catch(() => null);
      const playlists = ((Array.isArray(st.playlists) && st.playlists.length)
        ? st.playlists
        : [{ id: 'pl1', name: 'Film principal', items: st.playlist || [] }]).map((p) => this.normFilm(p));
      const activePl = playlists.some((p) => p.id === st.activePlaylistId)
        ? st.activePlaylistId
        : playlists[0].id;
      this.setState({
        loading: false, authRequired: false,
        library: st.modules,
        elementTypes: et.types || [],
        langs: lg.langs || [{ id: 'fr', label: 'Français' }],
        pwaForm: pwa ? {
          host: pwa.host, port: pwa.port, db: pwa.db, user: pwa.user,
          password: '', hasPassword: !!pwa.hasPassword,
          qCategories: pwa.qCategories, qProducts: pwa.qProducts,
          qShopPrices: pwa.qShopPrices, qAliases: pwa.qAliases,
          shopMap: pwa.shopMap || {},
        } : null,
        catalog: { categories: cat.categories || [], products: cat.products || [] },
        catDraft: null, catDirty: false,
        playlists,
        activePl,
        playlist: [...(playlists.find((p) => p.id === activePl).items)],
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

  // ------------------------------------------------------ films (playlists)
  // Un film porte sa composition, sa programmation (jours + fenêtre) et ses
  // magasins cibles (liste vide = tous les magasins).
  normFilm(p) {
    return {
      ...p,
      schedule: {
        days: (p.schedule && Array.isArray(p.schedule.days) && p.schedule.days.length === 7) ? p.schedule.days.map(Boolean) : [true, true, true, true, true, true, true],
        from: (p.schedule && p.schedule.from) || '00:00',
        to: (p.schedule && p.schedule.to) || '23:59',
      },
      stores: Array.isArray(p.stores) ? p.stores : [],
    };
  }
  activeFilm() {
    return this.state.playlists.find((p) => p.id === this.state.activePl) || this.state.playlists[0] || this.normFilm({ id: 'pl1', name: 'Film principal', items: [] });
  }
  updateFilm(patch) {
    const playlists = this.state.playlists.map((p) => (p.id === this.state.activePl ? { ...p, ...patch } : p));
    this.dirty({ playlists });
  }
  toggleFilmDay(d) {
    const f = this.activeFilm();
    const days = [...f.schedule.days];
    days[d] = !days[d];
    this.updateFilm({ schedule: { ...f.schedule, days } });
  }
  setFilmWindow(from, to) {
    const f = this.activeFilm();
    this.updateFilm({ schedule: { ...f.schedule, from, to } });
  }
  toggleFilmStore(id) {
    const f = this.activeFilm();
    const stores = f.stores.includes(id) ? f.stores.filter((x) => x !== id) : [...f.stores, id];
    this.updateFilm({ stores });
  }
  clearFilmStores() { this.updateFilm({ stores: [] }); }
  targetCountFor(filmId) {
    const f = this.state.playlists.find((p) => p.id === filmId);
    const ids = (f && f.stores && f.stores.length) ? f.stores : this.state.fleet.map((s) => s.id);
    return this.state.fleet.filter((s) => ids.includes(s.id)).reduce((n, s) => n + s.players.length, 0);
  }
  // Patch d'état synchronisant le film actif (source de vérité : playlists)
  // et son miroir plat `playlist` utilisé par le reste du composant.
  playlistPatch(items) {
    const playlists = this.state.playlists.map((p) => (p.id === this.state.activePl ? { ...p, items: [...items] } : p));
    return { playlists, playlist: [...items] };
  }
  selectFilm(id) {
    const p = this.state.playlists.find((x) => x.id === id);
    if (!p) return;
    this.setState({ activePl: id, playlist: [...p.items], t: 0, editingFilm: false });
  }
  newFilm() {
    const id = 'pl' + uid();
    const playlists = [...this.state.playlists, this.normFilm({ id, name: 'Nouveau film', items: [] })];
    this.dirty({ playlists, activePl: id, playlist: [], editingFilm: true, editFilmName: 'Nouveau film', t: 0 });
  }
  dupFilm() {
    const src = this.activeFilm();
    const id = 'pl' + uid();
    const copy = this.normFilm({ ...JSON.parse(JSON.stringify(src)), id, name: `${src.name} (copie)`, items: [...src.items] });
    const playlists = [...this.state.playlists, copy];
    this.dirty({ playlists, activePl: id, playlist: [...src.items], t: 0 });
  }
  renameFilm(name) {
    const n = String(name || '').trim() || this.activeFilm().name;
    const playlists = this.state.playlists.map((p) => (p.id === this.state.activePl ? { ...p, name: n } : p));
    this.dirty({ playlists, editingFilm: false });
  }
  delFilm() {
    if (this.state.playlists.length <= 1) { this.showToast('Il faut garder au moins un film'); return; }
    if (!window.confirm(`Supprimer le film « ${this.activeFilm().name} » ? (les modules de la bibliothèque sont conservés)`)) return;
    const playlists = this.state.playlists.filter((p) => p.id !== this.state.activePl);
    const next = playlists[0];
    this.dirty({ playlists, activePl: next.id, playlist: [...next.items], t: 0 });
  }

  // ------------------------------------------------------------- undo / redo
  snapshot() {
    return JSON.stringify({
      library: this.state.library, playlist: this.state.playlist,
      playlists: this.state.playlists, activePl: this.state.activePl,
      secPerLine: this.state.secPerLine, loop: this.state.loop, selId: this.state.selId,
    });
  }
  dirty(patch) {
    const snap = this.snapshot();
    this.setState((s) => ({ past: [...s.past, snap].slice(-60), future: [], dirty: true, saved: false, ...patch }));
  }
  _restorePatch(o) {
    const playlists = ((o.playlists && o.playlists.length) ? o.playlists : [{ id: 'pl1', name: 'Film principal', items: o.playlist || [] }]).map((p) => this.normFilm(p));
    const activePl = playlists.some((p) => p.id === o.activePl) ? o.activePl : playlists[0].id;
    return {
      library: o.library, playlists, activePl,
      playlist: [...(playlists.find((p) => p.id === activePl).items)],
      secPerLine: o.secPerLine, loop: o.loop, selId: o.selId, dirty: true, saved: false,
    };
  }
  undo() {
    this.setState((s) => {
      if (!s.past.length) return null;
      const past = [...s.past];
      const snap = past.pop();
      const cur = JSON.stringify({ library: s.library, playlist: s.playlist, playlists: s.playlists, activePl: s.activePl, secPerLine: s.secPerLine, loop: s.loop, selId: s.selId });
      return { past, future: [...s.future, cur].slice(-60), ...this._restorePatch(JSON.parse(snap)) };
    });
  }
  redo() {
    this.setState((s) => {
      if (!s.future.length) return null;
      const future = [...s.future];
      const snap = future.pop();
      const cur = JSON.stringify({ library: s.library, playlist: s.playlist, playlists: s.playlists, activePl: s.activePl, secPerLine: s.secPerLine, loop: s.loop, selId: s.selId });
      return { future, past: [...s.past, cur].slice(-60), ...this._restorePatch(JSON.parse(snap)) };
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
  selectMod(id) {
    const mm = this.state.library.find((x) => x.id === id);
    this.setState({ selId: id, t: 0, openSec: this.defaultSecFor(mm) });
  }
  // Volets repliables de l'éditeur : un seul ouvert, centré à l'écran.
  defaultSecFor(mm) {
    if (!mm) return null;
    if (mm.type === 'produit') return 'produit';
    if (mm.type === 'film') return 'video';
    if (mm.type === 'animation') return 'layout';
    if (mm.type === 'category') return 'items';
    return 'tag';
  }
  toggleSec(id, el) {
    const open = this.state.openSec === id ? null : id;
    this.setState({ openSec: open });
    // Auto-focus : le volet qui vient de s'ouvrir se centre dans l'écran.
    if (open && el) setTimeout(() => { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* navigateur ancien */ } }, 90);
  }
  // Un nouveau module rejoint directement la playlist (retirable avec ✕) :
  // sinon il n'apparaîtrait pas dans le film publié et c'est trop facile à rater.
  // « + Élément » : le type est choisi parmi ceux de la table sig_element_types.
  addElement(t) {
    const id = uid();
    const lib = this.cloneLib();
    const base = {
      id, type: t.id, name: '', sub: '', libTag: t.id === 'liaison' ? 'liaison' : 'produit',
      layout: (t.layouts && t.layouts[0] && t.layouts[0].id) || 'illo-right', motion: 'm1',
      tag: newTag(), schedule: newSched(), pos: newPos(), items: [],
      catRef: '', productRef: '', video: '', dur: 0,
    };
    if (t.id === 'category') { base.name = 'Nouvelle catégorie'; base.items = [{ name: 'Produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true }]; }
    else if (t.id === 'liaison') { base.name = 'Liaison'; base.sub = 'faites maison chaque matin'; }
    else if (t.id === 'produit') { base.name = 'À la une'; base.dur = 8; }
    else if (t.id === 'film') { base.name = 'Vidéo'; base.dur = 10; base.libTag = 'promo'; }
    else if (t.id === 'animation') { base.name = 'Nouveauté'; base.sub = 'cette semaine'; base.dur = 6; base.libTag = 'promo'; }
    else { base.name = t.label || 'Élément'; }
    lib.push(base);
    this.setLib(lib, { selId: id, addPicker: false, composerTab: 'lib', openSec: this.defaultSecFor(base), ...this.playlistPatch([...this.state.playlist, id]) });
  }
  elementTypeOf(m) {
    return (this.state.elementTypes || []).find((t) => t.id === (m && m.type)) || null;
  }
  modMeta(mm) {
    if (mm.type === 'liaison') return 'Liaison';
    if (mm.type === 'film') return mm.video ? `vidéo · ${mm.dur || 10} s` : 'vidéo à importer';
    if (mm.type === 'animation') return `animation · ${mm.dur || 6} s`;
    if (mm.type === 'produit') return mm.items && mm.items[0] ? `à la une : ${mm.items[0].name}` : 'produit à choisir';
    const n = this.activeItems(mm).length;
    return `${n} produits${mm.catRef ? ' · ⛓ table produits' : ''}`;
  }

  // ---- liens élément ↔ table produits -------------------------------------
  // Lier une « liste de prix » à une catégorie du catalogue : les lignes
  // viennent alors de la table produits (résolues aussi côté serveur).
  linkCat(catId) {
    const cat = this.state.catalog.categories.find((c) => c.id === catId);
    if (!cat) return;
    const items = this.state.catalog.products.filter((p) => p.categoryId === catId)
      .map((p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: p.active, productId: p.id }));
    const lib = this.cloneLib();
    const mm = lib.find((x) => x.id === this.state.selId);
    mm.catRef = catId; mm.productRef = '';
    if (!mm.name || mm.name === 'Nouvelle catégorie') mm.name = cat.name;
    mm.items = items;
    this.setLib(lib);
  }
  unlinkCat() {
    // Les lignes actuelles sont copiées dans l'élément (édition manuelle).
    const lib = this.cloneLib();
    const mm = lib.find((x) => x.id === this.state.selId);
    mm.catRef = '';
    mm.items = (mm.items || []).map((it) => ({ ...it, productId: undefined }));
    this.setLib(lib);
  }
  setProductRef(pid) {
    const p = this.state.catalog.products.find((x) => x.id === pid);
    const lib = this.cloneLib();
    const mm = lib.find((x) => x.id === this.state.selId);
    mm.productRef = pid || '';
    mm.items = p ? [{ name: p.name, price: p.price, img: p.img, src: p.src, active: true, productId: p.id }] : [];
    this.setLib(lib);
  }

  // ---- vidéo (type film) ---------------------------------------------------
  onVideo(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { this.showToast('Vidéo trop lourde (max 8 Mo) — compresse-la en 1080p/H.264'); return; }
    const r = new FileReader();
    r.onload = () => this.setSelField('video', r.result);
    r.readAsDataURL(f);
  }

  // ---- table produits (vue Produits) --------------------------------------
  openProducts() {
    const d = this.state.catDraft || JSON.parse(JSON.stringify(this.state.catalog));
    const sel = d.categories.some((c) => c.id === this.state.catSel)
      ? this.state.catSel
      : ((d.categories[0] || {}).id || '');
    this.setState({ view: 'products', catDraft: d, catSel: sel });
  }
  setCat(mut) {
    const d = JSON.parse(JSON.stringify(this.state.catDraft || this.state.catalog));
    mut(d);
    this.setState({ catDraft: d, catDirty: true });
  }
  addProdCat() {
    const id = 'pc' + uid();
    this.setCat((d) => d.categories.push({ id, name: 'Nouvelle catégorie', active: true }));
    this.setState({ catSel: id });
  }
  delProdCat(catId) {
    const d = this.state.catDraft || this.state.catalog;
    const cat = d.categories.find((c) => c.id === catId);
    if (!cat) return;
    const n = d.products.filter((p) => p.categoryId === catId).length;
    const used = this.state.library.filter((m) => m.catRef === catId).map((m) => m.name);
    const msg = `Supprimer la catégorie « ${cat.name} » et ses ${n} produit(s) ?`
      + (used.length ? `\n\n⚠ Élément(s) lié(s) qui deviendront vides : ${used.join(', ')}` : '');
    if (!window.confirm(msg)) return;
    this.setCat((dd) => {
      dd.categories = dd.categories.filter((c) => c.id !== catId);
      dd.products = dd.products.filter((p) => p.categoryId !== catId);
    });
    if (this.state.catSel === catId) {
      const rest = d.categories.filter((c) => c.id !== catId);
      this.setState({ catSel: (rest[0] || {}).id || '' });
    }
  }
  addProd() {
    const id = 'pr' + uid();
    const catId = this.state.catSel;
    if (!catId) { this.showToast('Crée d’abord une catégorie'); return; }
    this.setCat((d) => d.products.push({ id, categoryId: catId, name: 'Nouveau produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true, prices: {} }));
  }
  moveProd(pid, dir) {
    this.setCat((d) => {
      const prod = d.products.find((p) => p.id === pid);
      if (!prod) return;
      const idxs = d.products.map((p, i) => [p.categoryId, i]).filter(([c]) => c === prod.categoryId).map(([, i]) => i);
      const pos = idxs.findIndex((i) => d.products[i].id === pid);
      const j = pos + dir;
      if (j < 0 || j >= idxs.length) return;
      const a = idxs[pos], b = idxs[j];
      const tmp = d.products[a]; d.products[a] = d.products[b]; d.products[b] = tmp;
    });
  }
  delProd(pid) {
    const d = this.state.catDraft || this.state.catalog;
    const p = d.products.find((x) => x.id === pid);
    if (!p) return;
    if (!window.confirm(`Supprimer le produit « ${p.name} » de la table ?`)) return;
    this.setCat((dd) => { dd.products = dd.products.filter((x) => x.id !== pid); });
  }
  onProdPhoto(pid, e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    this.compressPhoto(f, (data) => this.setCat((d) => {
      const p = d.products.find((x) => x.id === pid);
      if (p) { p.img = data; p.src = 'photo'; }
    }));
  }
  async saveCatalog() {
    if (this.state.catSaving) return;
    const d = this.state.catDraft || this.state.catalog;
    this.setState({ catSaving: true });
    try {
      const out = await api('PUT', '/catalog', { categories: d.categories, products: d.products });
      this.setState({
        catalog: { categories: out.categories, products: out.products },
        catDraft: null, catDirty: false, catSaving: false,
      });
      // Les éléments liés au catalogue suivent : on recharge leurs lignes.
      await this.reloadLinkedModules();
      this.showToast('Table produits enregistrée ✓');
    } catch (e) {
      this.setState({ catSaving: false });
      this.showToast(e.status === 401 ? 'Session expirée — recharge la page (F5)' : `Erreur : ${e.message}`);
    }
  }
  async reloadLinkedModules() {
    // Après une modification du catalogue, les éléments liés (catRef/productRef)
    // sont resservis par le serveur avec leurs lignes à jour.
    try {
      const st = await api('GET', '/state');
      const fresh = new Map(st.modules.map((m) => [m.id, m]));
      const lib = this.state.library.map((m) => {
        if (!(m.catRef || m.productRef)) return m;
        const f = fresh.get(m.id);
        return f ? { ...m, items: f.items } : m;
      });
      this.setState({ library: lib });
    } catch { /* la prochaine sauvegarde resynchronisera */ }
  }

  // ---- connexion directe à la base PWA (product / shop_product / …) --------
  setPwa(k, v) { this.setState({ pwaForm: { ...(this.state.pwaForm || {}), [k]: v } }); }
  setPwaShop(storeId, v) {
    const f = this.state.pwaForm || {};
    const shopMap = { ...(f.shopMap || {}) };
    if (String(v).trim()) shopMap[storeId] = String(v).trim(); else delete shopMap[storeId];
    this.setState({ pwaForm: { ...f, shopMap } });
  }
  async pwaReset() {
    if (this.state.pwaBusy) return;
    try {
      const c = await api('POST', '/pwa-reset');
      this.setState({
        pwaResult: null,
        pwaForm: {
          host: c.host, port: c.port, db: c.db, user: c.user,
          password: '', hasPassword: !!c.hasPassword,
          qCategories: c.qCategories, qProducts: c.qProducts,
          qShopPrices: c.qShopPrices, qAliases: c.qAliases,
          shopMap: c.shopMap || {},
        },
      });
      this.showToast('Réglages avancés réinitialisés — tout-automatique ✓');
    } catch (e) {
      this.showToast(`Erreur : ${e.message}`);
    }
  }
  async pwaAction(kind) {
    const f = this.state.pwaForm;
    if (!f || this.state.pwaBusy) return;
    if (kind === 'import' && !window.confirm(
      'Rafraîchir depuis la base PWA remplace la table produits (catégories, produits, prix par boutique).\nLes éléments liés sont re-liés par nom de catégorie.\n\nContinuer ?')) return;
    this.setState({ pwaBusy: kind, pwaResult: null });
    try {
      await api('POST', '/pwa-config', {
        host: f.host, port: f.port, db: f.db, user: f.user,
        ...(f.password ? { password: f.password } : {}),
        qCategories: f.qCategories, qProducts: f.qProducts,
        qShopPrices: f.qShopPrices, qAliases: f.qAliases,
        shopMap: f.shopMap || {},
      });
      const out = await api('POST', kind === 'test' ? '/pwa-test' : '/pwa-import');
      this.setState({
        pwaBusy: null, pwaResult: out,
        pwaForm: { ...f, password: '', hasPassword: f.hasPassword || !!f.password },
      });
      if (kind === 'import' && out.ok) {
        const cat = await api('GET', '/catalog');
        this.setState({ catalog: { categories: cat.categories, products: cat.products }, catDraft: null, catDirty: false });
        await this.reloadLinkedModules();
        this.showToast(`Catalogue importé : ${out.categories} catégorie(s) · ${out.products} produit(s) ✓`);
      }
    } catch (e) {
      this.setState({ pwaBusy: null, pwaResult: { ok: false, error: String(e.message || e) } });
    }
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
    const mod = this.getMod(id);
    const usedIn = this.state.playlists.filter((p) => p.items.includes(id)).map((p) => p.name);
    const warn = usedIn.length ? `\nIl sera aussi retiré de : ${usedIn.join(', ')}.` : '';
    if (!window.confirm(`Supprimer « ${mod ? mod.name : id} » de la bibliothèque ?${warn}\nCette action est définitive (après Enregistrer).`)) return;
    const lib = this.state.library.filter((m) => m.id !== id);
    // Le module disparaît de TOUS les films.
    const playlists = this.state.playlists.map((p) => ({ ...p, items: p.items.filter((x) => x !== id) }));
    const active = playlists.find((p) => p.id === this.state.activePl) || playlists[0];
    const selId = lib.some((m) => m.id === this.state.selId) ? this.state.selId : lib[0].id;
    this.dirty({ library: lib, playlists, playlist: [...active.items], selId });
  }
  addToPlaylist(id) { this.dirty(this.playlistPatch([...this.state.playlist, id])); }
  removeFromPlaylist(i) { this.dirty(this.playlistPatch(this.state.playlist.filter((_, j) => j !== i))); }
  reorderPlaylist(from, to) {
    if (from === to) return;
    const playlist = [...this.state.playlist];
    const [x] = playlist.splice(from, 1);
    playlist.splice(to, 0, x);
    this.dirty(this.playlistPatch(playlist));
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
    const it = m.items[i];
    if (!window.confirm(`Supprimer le produit « ${it && it.name ? it.name : 'sans nom'} » ?`)) return;
    const lib = this.cloneLib();
    lib.find((x) => x.id === this.state.selId).items.splice(i, 1);
    this.setLib(lib);
  }
  addItem() { const lib = this.cloneLib(); lib.find((x) => x.id === this.state.selId).items.push({ name: 'Nouveau produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true }); this.setLib(lib); }
  dupItem(i) { const lib = this.cloneLib(); const mm = lib.find((x) => x.id === this.state.selId); mm.items.splice(i + 1, 0, { ...mm.items[i] }); this.setLib(lib); }
  // Compression côté navigateur : une photo de téléphone (5-8 Mo) ferait
  // échouer l'enregistrement — on la ramène à ≤2500 px en JPEG, la taille
  // maximale à laquelle elle est affichée sur le mur d'écrans (6480×3840).
  compressPhoto(f, cb) {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 2500;
        const sc = Math.min(1, MAX / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc));
        cv.height = Math.max(1, Math.round(img.height * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let data;
        try { data = cv.toDataURL('image/jpeg', 0.85); } catch { data = r.result; }
        cb(data);
      };
      img.onerror = () => this.showToast('Image illisible — essaie un JPG ou PNG');
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }
  onPhoto(i, e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    this.compressPhoto(f, (data) => {
      const lib = this.cloneLib();
      const mm = lib.find((x) => x.id === this.state.selId);
      mm.items[i] = { ...mm.items[i], img: data, src: 'photo' };
      this.setLib(lib);
    });
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
      playlists: this.state.playlists,
      activePlaylistId: this.state.activePl,
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
  setComposerTab(t) {
    this.setState({ composerTab: t, scope: t === 'timeline' ? 'playlist' : 'module', t: 0 });
  }
  // Insertion / déplacement sur la ligne du temps (drag & drop).
  insertAtTimeline(i, libId) {
    if (!this.getMod(libId)) return;
    const items = [...this.state.playlist];
    items.splice(Math.max(0, Math.min(i, items.length)), 0, libId);
    this.dirty(this.playlistPatch(items));
  }
  appendToTimeline(libId) { this.insertAtTimeline(this.state.playlist.length, libId); }
  moveToEndTimeline(from) {
    const items = [...this.state.playlist];
    const [x] = items.splice(from, 1);
    items.push(x);
    this.dirty(this.playlistPatch(items));
  }
  togglePubDay(d) {
    this.setState((s) => {
      const pubDays = [...s.pubDays];
      pubDays[d] = !pubDays[d];
      return { pubDays };
    });
  }
  openPublish() {
    const t = {};
    this.state.fleet.forEach((s) => { t[s.id] = true; });
    this.setState({ publishing: true, pubTargets: t, pubDone: null, pubFilm: this.state.activePl });
  }
  closePublish() {
    const wasDone = !!this.state.pubDone;
    this.setState({ publishing: false, pubDone: null, ...(wasDone ? { view: 'fleet' } : {}) });
    if (wasDone) this.refreshFleet();
  }
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

  pubSchedule() {
    const SLOTMAP = {
      'Matin': ['06:00', '11:00'], 'Midi': ['11:00', '14:00'],
      'Après-midi': ['15:00', '19:00'], 'Toute la journée': ['00:00', '23:59'],
    };
    const w = SLOTMAP[this.state.pubSlot] || SLOTMAP['Toute la journée'];
    return { days: this.state.pubDays.map(Boolean), from: w[0], to: w[1] };
  }
  deploy = async () => {
    const st = this.state;
    const count = st.pubMode === 'data'
      ? st.fleet.reduce((n, s) => n + s.players.length, 0)
      : this.targetCountFor(st.pubFilm || st.activePl);
    if (count === 0 || st.deploying) return;
    this.setState({ deploying: true });
    try {
      await api('PUT', '/draft', this.draftBody());
      const filmId = st.pubFilm || st.activePl;
      const filmObj = st.playlists.find((p) => p.id === filmId) || this.activeFilm();
      const out = await api('POST', '/publish', {
        mode: st.pubMode === 'data' ? 'data' : 'full',
        playlistId: filmId,
        targets: st.pubMode === 'data' ? [] : (filmObj.stores || []),
        when: st.pubWhen, activateAt: st.activateAt,
        schedule: filmObj.schedule,
      });
      const testMsg = this.applyTests(out);
      const sched = st.pubWhen === 'scheduled';
      if (out.mode === 'data') {
        this.setState({ dataVer: out.version, publishing: false, dirty: false, saved: true, view: 'fleet' });
        this.showToast(`Snapshot prix d${out.version} poussé sur ${out.playerCount} écran(s) · ${testMsg}`);
        this.refreshFleet();
      } else {
        // Le modal reste ouvert et affiche le lien de visionnage du film déployé.
        const okN = out.tests.filter((t) => t.ok).length;
        this.setState({
          version: out.version, dirty: false, saved: true,
          pubDone: {
            version: out.version,
            name: out.film ? out.film.name : this.activeFilm().name,
            playerCount: out.playerCount,
            testsOk: okN, testsTotal: out.tests.length,
            scheduled: sched,
            url: this.filmUrl({ film: filmId, w: 3840, h: 2160 }),
          },
        });
      }
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
      this.showToast(on ? '⚡ Diffusion flash active sur tout le réseau' : 'Reprise des playlists normales');
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

  filmUrl({ w, h: hh, fit, store, film } = {}) {
    const u = new URL('film', location.href);
    if (film) u.searchParams.set('film', film);
    else if (store) u.searchParams.set('store', store);
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
    // Lien direct par magasin : montre la version actuellement assignée à ce
    // magasin, à la taille de son combo d'écrans (réglé dans Réseau).
    return this.state.fleet.map((s) => ({
      label: s.store,
      sub: `${s.group} · ${s.players.length} écran(s)${s.format ? ` · ${s.format.label} = ${s.format.px}` : ''}`,
      url: this.filmUrl({ store: s.id }),
    }));
  }

  // Combo d'écrans du magasin (ex. 3 × 55″ portrait) — enregistré côté serveur,
  // le lien du magasin s'affiche alors automatiquement à cette taille.
  async saveStore(id, patch) {
    const cur = this.state.fleet.find((s) => s.id === id);
    const f = (cur && cur.format) || {};
    try {
      const out = await api('POST', `/stores/${id}`, {
        screens: patch.screens != null ? patch.screens : f.screens,
        size: patch.size != null ? patch.size : f.size,
        orient: patch.orient != null ? patch.orient : f.orient,
        ...(patch.lang != null ? { lang: patch.lang } : {}),
        ...(patch.name != null ? { name: patch.name } : {}),
      });
      await this.refreshFleet();
      this.showToast(`${out.name} : ${out.format.label} = ${out.format.px} · langue ${(out.lang || 'fr').toUpperCase()} ✓`);
    } catch (e) {
      this.showToast(e.status === 401
        ? 'Session expirée — recharge la page (F5) et reconnecte-toi'
        : `Erreur : ${e.message}`);
    }
  }
  renameStore(id) {
    const name = this.state.editStoreName.trim();
    this.setState({ editingStore: null });
    if (name) this.saveStore(id, { name });
  }
  perFilmLinks() {
    // Lien direct par film (format standard 55″) : dernière publication de ce
    // film, ou sa composition enregistrée s'il n'a jamais été publié.
    return this.state.playlists.map((p) => ({
      label: p.name,
      sub: `${p.items.length} module(s)${p.id === this.state.activePl ? ' · en cours d’édition' : ''}`,
      url: this.filmUrl({ w: 3840, h: 2160, film: p.id }),
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
    const isProduit = m.type === 'produit', isFilmEl = m.type === 'film', isAnim = m.type === 'animation';
    const selType = this.elementTypeOf(m);
    const total = this.total();
    const { m: playM, lt } = this.activeInScope();
    const iconBtn = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:7px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);cursor:pointer;font-size:14px;color:#232220;';
    const miniBtn = 'display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.10);cursor:pointer;font-size:12px;color:#232220;';
    const tagChipOf = (mm) => (mm.tag && mm.tag.enabled
      ? h('span', { style: { flex: '0 0 auto', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#fff', background: RUBY, borderRadius: 999, padding: '2px 7px' } }, 'Promo')
      : null);
    // Chip de catégorie de bibliothèque (Produit / Fêtes / Promo / Liaison), colorée.
    const catChipOf = (mm) => {
      const t = tagOf(mm);
      return h('span', { style: { flex: '0 0 auto', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.color, background: t.color + '1A', border: `1px solid ${t.color}55`, borderRadius: 999, padding: '2px 7px' } }, t.label);
    };

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
        name: mm.name, tagChip: tagChipOf(mm), catChip: catChipOf(mm),
        typeIcon: (this.elementTypeOf(mm) || {}).icon || (isLi ? '⧉' : '▤'),
        libMeta: `${this.modMeta(mm)}${cnt ? ' · dans playlist ×' + cnt : ' · ⚠ hors playlist (＋ pour diffuser)'}`,
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

    // Mises en page : celles du TYPE de l'élément (table sig_element_types).
    const layoutList = (selType && selType.layouts && selType.layouts.length) ? selType.layouts : LAYOUTS;
    const layoutOptions = layoutList.map((o) => ({
      icon: o.icon, label: o.label,
      pick: () => this.setSelField('layout', o.id),
      style: `text-align:left;padding:13px 13px;border-radius:12px;cursor:pointer;background:${m.layout === o.id ? 'rgba(141,29,44,0.08)' : '#FBF8F2'};border:1px solid ${m.layout === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:#232220;`,
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

    const items = (isCat && !m.catRef ? m.items : []).map((t, i) => ({
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

    // ---- ligne du temps (onglet Playlist) ----
    let cumT = 0;
    const timelineBlocks = st.playlist.map((id, i) => {
      const mm = this.getMod(id);
      if (!mm) return null;
      const dur = this.moduleDur(mm);
      const startT = cumT;
      cumT += dur;
      const isLi = mm.type === 'liaison';
      const playingHere = st.scope === 'playlist' && st.t >= startT && st.t < startT + dur;
      return {
        i, name: mm.name, order: i + 1,
        durLabel: `${(Math.round(dur * 10) / 10).toString().replace('.', ',')} s`,
        typeIcon: (this.elementTypeOf(mm) || {}).icon || (isLi ? '⧉' : '▤'),
        width: Math.max(104, Math.round(dur * 14)),
        blockStyle: `flex:0 0 auto;display:flex;flex-direction:column;justify-content:space-between;gap:4px;padding:9px 11px;border-radius:10px;cursor:grab;background:${playingHere ? '#8D1D2C' : '#fff'};color:${playingHere ? '#fff' : '#232220'};border:1px solid ${playingHere ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};box-shadow:0 2px 6px rgba(0,0,0,0.05);`,
        jump: () => this.setState({ scope: 'playlist', t: startT, playing: true }),
        remove: (e) => { e.stopPropagation(); this.removeFromPlaylist(i); },
        onDragStart: (e) => { e.dataTransfer.setData('text/plain', 'idx:' + i); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
        onDragOver: (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); },
        onDragLeave: (e) => e.currentTarget.classList.remove('drag-over'),
        onDrop: (e) => {
          e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over');
          const d = e.dataTransfer.getData('text/plain');
          if (d.startsWith('lib:')) this.insertAtTimeline(i, d.slice(4));
          else if (d.startsWith('idx:')) this.reorderPlaylist(parseInt(d.slice(4), 10), i);
        },
        onDragEnd: (e) => { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.pl-item,.tl-block').forEach((el) => el.classList.remove('drag-over')); },
      };
    }).filter(Boolean);
    const timelineTotal = fmtTime(cumT);
    const timelineEndDrop = {
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault();
        const d = e.dataTransfer.getData('text/plain');
        if (d.startsWith('lib:')) this.appendToTimeline(d.slice(4));
        else if (d.startsWith('idx:')) this.moveToEndTimeline(parseInt(d.slice(4), 10));
      },
    };
    // Rangée 1 : les catégories (tags colorés) — rangée 2 : les éléments de la
    // catégorie choisie, prêts à glisser sur la ligne du temps.
    const tagCount = {};
    st.library.forEach((mm) => { const t = tagOf(mm).id; tagCount[t] = (tagCount[t] || 0) + 1; });
    const libTagChips = [
      {
        id: 'all', label: 'Tous', count: st.library.length, color: '#232220',
        active: st.libFilter === 'all',
        pick: () => this.setState({ libFilter: 'all' }),
      },
      ...LIB_TAGS.map((t) => ({
        id: t.id, label: t.label, count: tagCount[t.id] || 0, color: t.color,
        active: st.libFilter === t.id,
        pick: () => this.setState({ libFilter: t.id }),
      })),
    ].map((c) => ({
      ...c,
      style: `display:inline-flex;align-items:center;gap:7px;padding:8px 14px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;transition:all 0.15s;${c.active ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}`,
      dotStyle: `width:8px;height:8px;border-radius:50%;background:${c.active ? '#fff' : c.color};`,
    }));
    const libCards = st.library.filter((mm) => st.libFilter === 'all' || tagOf(mm).id === st.libFilter).map((mm) => ({
      name: mm.name,
      typeIcon: (this.elementTypeOf(mm) || {}).icon || '▤',
      meta: this.modMeta(mm),
      tagLabel: tagOf(mm).label,
      tagColor: tagOf(mm).color,
      inFilm: (inPlaylistCount[mm.id] || 0) > 0,
      onDragStart: (e) => { e.dataTransfer.setData('text/plain', 'lib:' + mm.id); e.dataTransfer.effectAllowed = 'copy'; },
      add: () => this.appendToTimeline(mm.id),
      edit: () => { this.setComposerTab('lib'); this.selectMod(mm.id); },
    }));
    const libEmptyMsg = st.library.length && !libCards.length
      ? `Aucun élément dans la catégorie « ${(LIB_TAGS.find((t) => t.id === st.libFilter) || {}).label || st.libFilter} ».`
      : '';
    const pubDaysVals = DAYS.map((lab, d) => ({
      label: lab,
      toggle: () => this.togglePubDay(d),
      style: `width:52px;padding:9px 0;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${st.pubDays[d] ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
    }));

    // ---- programmation & magasins du film (onglet Playlist) ----
    const filmActive = this.activeFilm();
    const chipDay = (on) => `width:48px;padding:8px 0;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`;
    const chipWide = (on) => `padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`;
    const filmDaysVals = DAYS.map((lab, d) => ({
      label: lab,
      toggle: () => this.toggleFilmDay(d),
      style: chipDay(filmActive.schedule.days[d]),
    }));
    const filmSlotVals = SLOTS.map((s) => ({
      label: s.label,
      pick: () => this.setFilmWindow(s.from, s.to),
      style: chipWide(filmActive.schedule.from === s.from && filmActive.schedule.to === s.to),
    }));
    const filmStoreVals = st.fleet.map((s) => ({
      label: s.store,
      toggle: () => this.toggleFilmStore(s.id),
      style: chipWide(filmActive.stores.includes(s.id)),
    }));
    const filmAllStores = {
      on: filmActive.stores.length === 0,
      pick: () => this.clearFilmStores(),
      style: chipWide(filmActive.stores.length === 0),
    };
    const filmSchedSummary = `${this.schedSummary(filmActive.schedule)} · ${filmActive.stores.length ? `${filmActive.stores.length} magasin(s)` : 'tous les magasins'}`;

    let liveLine = '—';
    if (playM && playM.type === 'category') {
      const n = this.activeItems(playM).length;
      if (n) {
        const raw = lt / st.secPerLine;
        const idx = ((Math.floor(raw) % n) + n) % n;
        liveLine = `${idx + 1}/${n}`;
      }
    }

    // ---- vue réseau ----
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
      filmUrl: this.filmUrl({ store: s.id }),
      copyFilm: () => this.copyLink(this.filmUrl({ store: s.id })),
      renaming: st.editingStore === s.id,
      startRename: () => this.setState({ editingStore: s.id, editStoreName: s.store }),
      onRenameInput: (e) => this.setState({ editStoreName: e.target.value }),
      onRenameKey: (e) => { if (e.key === 'Enter') this.renameStore(s.id); if (e.key === 'Escape') this.setState({ editingStore: null }); },
      commitRename: () => this.renameStore(s.id),
      fmt: s.format || { screens: 1, size: 55, orient: 'paysage', label: '1 × 55″ paysage', px: '3840 × 2160 px', w: 3840, h: 2160 },
      lang: s.lang || 'fr',
      setLang: (e) => this.saveStore(s.id, { lang: e.target.value }),
      langOptions: (st.langs || []).map((l) => ({ id: l.id, label: l.label })),
      setScreens: (e) => this.saveStore(s.id, { screens: e.target.value }),
      setSize: (e) => this.saveStore(s.id, { size: e.target.value }),
      setOrient: (e) => this.saveStore(s.id, { orient: e.target.value }),
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

    // ---- vue table produits ----
    const cd = st.catDraft || st.catalog;
    const storeCols = st.fleet.map((s) => ({ id: s.id, label: s.store }));
    // Langue d'édition : « fr » = noms de base, autres langues = alias.
    const editLang = st.catLang || 'fr';
    const isBaseLang = editLang === 'fr';
    const langChips = (st.langs || []).map((l) => {
      const nStores = st.fleet.filter((f) => (f.lang || 'fr') === l.id).length;
      const on = editLang === l.id;
      return {
        id: l.id, label: l.label, nStores, on,
        pick: () => this.setState({ catLang: l.id }),
        style: `display:inline-flex;align-items:center;gap:7px;padding:7px 14px;font-size:12px;font-weight:700;text-transform:uppercase;border-radius:999px;cursor:pointer;${on ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#fff;color:#8D1D2C;border:1px solid rgba(141,29,44,0.3);'}`,
      };
    });
    const prodCats = cd.categories.map((c) => {
      const count = cd.products.filter((p) => p.categoryId === c.id).length;
      const on = st.catSel === c.id;
      const usedBy = st.library.filter((mm) => mm.catRef === c.id).length;
      return {
        id: c.id, count, usedBy, active: c.active !== false, on,
        name: isBaseLang ? c.name : ((c.aliases || {})[editLang] || ''),
        namePlaceholder: isBaseLang ? 'Nom de la catégorie' : `${c.name} (${editLang})`,
        cardStyle: `display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:11px;cursor:pointer;background:${on ? '#fff' : 'rgba(255,255,255,0.5)'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.08)'};opacity:${c.active !== false ? 1 : 0.55};`,
        pick: () => this.setState({ catSel: c.id }),
        onName: (e) => this.setCat((d) => {
          const x = d.categories.find((y) => y.id === c.id);
          if (!x) return;
          if (isBaseLang) x.name = e.target.value;
          else { x.aliases = x.aliases || {}; if (e.target.value.trim()) x.aliases[editLang] = e.target.value; else delete x.aliases[editLang]; }
        }),
        toggleActive: (e) => { e.stopPropagation(); this.setCat((d) => { const x = d.categories.find((y) => y.id === c.id); if (x) x.active = !(x.active !== false); }); },
        del: (e) => { e.stopPropagation(); this.delProdCat(c.id); },
      };
    });
    const prodSelCat = cd.categories.find((c) => c.id === st.catSel) || null;
    const prodRows = cd.products.filter((p) => p.categoryId === st.catSel).map((p) => ({
      id: p.id, price: p.price, img: p.img, active: p.active !== false,
      name: isBaseLang ? p.name : ((p.aliases || {})[editLang] || ''),
      namePlaceholder: isBaseLang ? 'Nom du produit' : `${p.name} (${editLang})`,
      isPhoto: p.src === 'photo',
      thumb: h('img', { src: p.img, alt: '', style: { width: 42, height: 42, objectFit: p.src === 'photo' ? 'cover' : 'contain', flex: '0 0 auto', background: '#FBF8F2', borderRadius: 8, padding: 2, boxSizing: 'border-box' } }),
      onName: (e) => this.setCat((d) => {
        const x = d.products.find((y) => y.id === p.id);
        if (!x) return;
        if (isBaseLang) x.name = e.target.value;
        else { x.aliases = x.aliases || {}; if (e.target.value.trim()) x.aliases[editLang] = e.target.value; else delete x.aliases[editLang]; }
      }),
      onPrice: (e) => this.setCat((d) => { const x = d.products.find((y) => y.id === p.id); if (x) x.price = e.target.value; }),
      onImg: (e) => this.setCat((d) => { const x = d.products.find((y) => y.id === p.id); if (x) { x.img = e.target.value; x.src = 'illus'; } }),
      onPhoto: (e) => this.onProdPhoto(p.id, e),
      toggleActive: () => this.setCat((d) => { const x = d.products.find((y) => y.id === p.id); if (x) x.active = !(x.active !== false); }),
      up: () => this.moveProd(p.id, -1),
      down: () => this.moveProd(p.id, 1),
      del: () => this.delProd(p.id),
      storePrices: storeCols.map((sc) => ({
        storeId: sc.id,
        value: (p.prices || {})[sc.id] || '',
        onInput: (e) => this.setCat((d) => {
          const x = d.products.find((y) => y.id === p.id);
          if (!x) return;
          x.prices = x.prices || {};
          const val = e.target.value;
          if (val.trim()) x.prices[sc.id] = val; else delete x.prices[sc.id];
        }),
      })),
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
    const pubF = st.playlists.find((p) => p.id === (st.pubFilm || st.activePl)) || this.activeFilm();
    const tgtCount = st.pubMode === 'data'
      ? st.fleet.reduce((n, s) => n + s.players.length, 0)
      : this.targetCountFor(pubF.id);
    const pubStoresLabel = (pubF.stores && pubF.stores.length)
      ? st.fleet.filter((s) => pubF.stores.includes(s.id)).map((s) => s.store).join(', ')
      : 'tous les magasins';
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
        arr.push(crumb('Réseau & supervision', () => this.setView('fleet'), false));
        arr.push(crumb(`${online + offline} écrans · ${st.fleet.length} magasins`, null, true));
      } else if (st.view === 'settings') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Paramètres', null, false));
        arr.push(crumb('Serveur & connexion', null, true));
      } else if (st.view === 'products') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Table produits', null, false));
        arr.push(crumb(`${(st.catDraft || st.catalog).categories.length} catégorie(s) · ${(st.catDraft || st.catalog).products.length} produit(s)${st.catDirty ? ' · non enregistrée' : ''}`, null, true));
      } else {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb(`Film : ${this.activeFilm().name}`, null, false));
        arr.push(crumb(`${m.name}${isLia ? ' (liaison)' : ''}`, null, true));
      }
      return arr;
    })();

    const subTab = 'padding:8px 18px;font-size:13px;font-weight:600;border:none;border-radius:999px;cursor:pointer;';
    const hdrRound = 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;flex:0 0 auto;';
    return {
      playlist, library, layoutOptions, motionGroups, items, days, posFields, timeSlots, crumbs,
      timelineBlocks, timelineTotal, timelineEndDrop, libCards, libTagChips, libEmptyMsg, pubDaysVals,
      prodCats, prodRows, storeCols, prodSelCat, langChips, isBaseLang,
      catDirty: st.catDirty, catSaving: st.catSaving,
      addProdCat: () => this.addProdCat(),
      addProd: () => this.addProd(),
      saveCat: () => this.saveCatalog(),
      filmDaysVals, filmSlotVals, filmStoreVals, filmAllStores, filmSchedSummary,
      isLibTab: st.composerTab !== 'timeline',
      isTimelineTab: st.composerTab === 'timeline',
      setTabLib: () => this.setComposerTab('lib'),
      setTabTimeline: () => this.setComposerTab('timeline'),
      tabLibStyle: subTab + (st.composerTab !== 'timeline' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabTimelineStyle: subTab + (st.composerTab === 'timeline' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      resetPos: () => this.resetPos(),
      undo: () => this.undo(), redo: () => this.redo(),
      undoStyle: `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-size:15px;background:transparent;border:1px solid ${st.past.length ? 'rgba(35,34,32,0.16)' : 'rgba(35,34,32,0.06)'};color:${st.past.length ? '#5B564E' : '#C9C3B8'};cursor:${st.past.length ? 'pointer' : 'not-allowed'};`,
      redoStyle: `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-size:15px;background:transparent;border:1px solid ${st.future.length ? 'rgba(35,34,32,0.16)' : 'rgba(35,34,32,0.06)'};color:${st.future.length ? '#5B564E' : '#C9C3B8'};cursor:${st.future.length ? 'pointer' : 'not-allowed'};`,
      isComposerView: st.view === 'composer', isFleetView: st.view === 'fleet', isSettingsView: st.view === 'settings',
      isProductsView: st.view === 'products',
      setViewComposer: () => this.setView('composer'),
      setViewFleet: () => this.setView('fleet'),
      setViewSettings: () => this.setView('settings'),
      setViewProducts: () => this.openProducts(),
      tabProductsStyle: stTab + (st.view === 'products' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabComposerStyle: stTab + (st.view === 'composer' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabFleetStyle: stTab + (st.view === 'fleet' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      settingsIconStyle: `display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;font-size:17px;cursor:pointer;flex:0 0 auto;${st.view === 'settings' ? 'background:#8D1D2C;color:#fff;border:none;' : 'background:#EFE9E0;color:#232220;border:1px solid rgba(35,34,32,0.10);'}`,
      playlistVersion: st.version,
      pushPrices: this.pushPrices,
      toggleOverride: this.toggleOverride,
      overrideLabel: st.override ? 'Reprendre les playlists' : 'Diffusion flash',
      overrideStyle: `padding:9px 18px;font-size:13px;font-weight:600;letter-spacing:0.01em;border-radius:999px;cursor:pointer;${st.override ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;box-shadow:0 2px 8px rgba(141,29,44,0.3);' : 'background:transparent;color:#5B564E;border:1px solid rgba(35,34,32,0.18);'}`,
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
        : `Film « ${pubF.name} » v${nextV} → ${pubStoresLabel} (${tgtCount} écran(s)) · diffusion ${this.schedSummary(pubF.schedule)} · activation ${whenLabel}. La programmation et les magasins se règlent sur le film (onglet 2 · Playlist). Bascule atomique + tests live au déploiement.`,
      deploy: this.deploy,
      deployLabel: st.deploying ? 'Déploiement + tests live…' : (tgtCount ? (st.pubMode === 'data' ? `Pousser les prix sur ${tgtCount} écran(s)` : `Déployer sur ${tgtCount} écran(s)`) : 'Choisir une cible'),
      deployStyle: `padding:11px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:${tgtCount && !st.deploying ? 'pointer' : 'not-allowed'};${tgtCount ? 'background:#8D1D2C;color:#fff;' : 'background:rgba(35,34,32,0.10);color:#8A847C;'}opacity:${st.deploying ? 0.7 : 1};`,
      hasToast: !!st.toast, toast: st.toast,
      playlistEmpty: st.playlist.length === 0,
      isCategory: isCat, isLiaison: isLia, isProduit, isFilmEl, isAnim,
      hasSub: isLia || isAnim || isProduit,
      hasDur: isProduit || isFilmEl || isAnim,
      selName: m.name,
      selTypeLabel: selType ? selType.label : (isLia ? 'Liaison' : 'Catégorie'),
      selTypeBadge: `display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;${isLia ? 'background:rgba(35,34,32,0.10);color:#8A847C;' : 'background:rgba(141,29,44,0.12);color:#8D1D2C;'}`,
      liaisonSub: m.sub || '',
      onSelName: (e) => this.setSelField('name', e.target.value),
      onLiaisonSub: (e) => this.setSelField('sub', e.target.value),
      durVal: m.dur || (isFilmEl ? 10 : isProduit ? 8 : 6),
      onDur: (e) => this.setSelField('dur', parseFloat(e.target.value) || 0),
      // -- catégorie ↔ table produits --
      isLinked: !!m.catRef,
      linkedCatName: (st.catalog.categories.find((c) => c.id === m.catRef) || {}).name || m.catRef,
      linkedRows: (m.items || []).map((it) => ({ name: it.name, price: it.price, active: it.active !== false })),
      catOptions: st.catalog.categories.map((c) => ({
        id: c.id,
        label: `${c.name} (${st.catalog.products.filter((p) => p.categoryId === c.id).length} produits)${c.active ? '' : ' · inactive'}`,
      })),
      curCatRef: m.catRef || '',
      onLinkCat: (e) => { if (e.target.value) this.linkCat(e.target.value); },
      doUnlinkCat: () => this.unlinkCat(),
      goProducts: () => this.openProducts(),
      // -- produit à la une --
      productOptions: st.catalog.products.map((p) => ({
        id: p.id,
        label: `${p.name} · ${p.price} €${p.active ? '' : ' · inactif'} — ${(st.catalog.categories.find((c) => c.id === p.categoryId) || {}).name || 'sans catégorie'}`,
      })),
      curProductRef: m.productRef || '',
      onProductRef: (e) => this.setProductRef(e.target.value),
      // -- film (vidéo) --
      hasVideo: !!m.video,
      videoPreview: m.video || '',
      onVideoFile: (e) => this.onVideo(e),
      clearVideo: () => this.setSelField('video', ''),
      // -- résumés des volets repliés --
      layoutSummary: ((layoutList.find((o) => o.id === m.layout) || {}).label) || m.layout || '',
      motionSummary: ({ m1: 'Doux', m2: 'Ample', m3: 'Pulsé', none: 'Aucun' })[m.motion || 'm1'] || '',
      posSummary: (() => {
        const p0 = m.pos || {};
        const changed = ['titleY', 'listX', 'listY', 'illoX', 'illoY'].some((k) => p0[k]) || (p0.illoScale && p0.illoScale !== 1);
        return changed ? 'ajustées' : 'par défaut';
      })(),
      itemsSummary: m.catRef
        ? `⛓ ${(st.catalog.categories.find((c) => c.id === m.catRef) || {}).name || m.catRef} · ${(m.items || []).length} ligne(s)`
        : `${(m.items || []).length} produit(s)`,
      tagSummary: (m.tag && m.tag.enabled) ? `activé · ${m.tag.label || 'macaron'}` : 'désactivé',
      videoSummary: m.video ? `importée · ${m.dur || 10} s` : 'aucune vidéo',
      produitSummary: (m.items && m.items[0] && m.items[0].name) || 'à choisir',
      // -- motion global (produit / animation) --
      motionSimple: MOTIONS.map((o) => ({
        label: o.label,
        pick: () => this.setSelField('motion', o.id),
        style: `text-align:left;padding:10px 13px;font-size:12.5px;font-weight:500;border-radius:9px;cursor:pointer;background:${(m.motion || 'm1') === o.id ? 'rgba(141,29,44,0.08)' : '#FBF8F2'};border:1px solid ${(m.motion || 'm1') === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:#232220;`,
      })),
      libTagPicker: LIB_TAGS.map((t) => {
        const on = tagOf(m).id === t.id;
        return {
          label: t.label,
          pick: () => this.setSelField('libTag', t.id),
          style: `display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12px;font-weight:600;border-radius:999px;cursor:pointer;${on ? `background:${t.color};color:#fff;border:1px solid ${t.color};` : `background:#fff;color:${t.color};border:1px solid ${t.color}55;`}`,
          dotStyle: `width:7px;height:7px;border-radius:50%;background:${on ? '#fff' : t.color};`,
        };
      }),
      openAddPicker: () => this.setState({ addPicker: true }),
      closeAddPicker: () => this.setState({ addPicker: false }),
      addPickerOpen: st.addPicker,
      typeCards: (st.elementTypes || []).map((t) => ({
        icon: t.icon, label: t.label, descr: t.descr,
        pick: () => this.addElement(t),
      })),
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
      nowPlaying: st.scope === 'playlist' ? (playM ? `▶ ${playM.name}` : 'Film vide') : `Aperçu de l'élément`,
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
      // Bouton d'état (modale de publication) : cuivre quand modifs en attente.
      saveLabel: st.dirty ? 'Enregistrer' : 'Enregistré',
      saveStyle: `padding:9px 20px;font-size:13px;font-weight:600;letter-spacing:0.01em;border-radius:999px;cursor:${st.dirty ? 'pointer' : 'default'};${st.dirty ? 'background:#6E4A2B;color:#fff;border:1px solid #6E4A2B;box-shadow:0 2px 8px rgba(110,74,43,0.25);' : 'background:transparent;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
      // Bandeau : icônes rondes + vignettes, palette gris/rubis/abricot/cuivre.
      saveIconStyle: `${hdrRound}${st.dirty ? 'background:#6E4A2B;color:#fff;border:1px solid #6E4A2B;box-shadow:0 2px 10px rgba(110,74,43,0.35);' : 'background:transparent;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
      saveTip: st.dirty ? 'Enregistrer — modifications en attente' : 'Tout est enregistré',
      pricesIconStyle: `${hdrRound}background:rgba(201,123,74,0.14);color:#A25C2E;border:1px solid rgba(201,123,74,0.5);`,
      overrideIconStyle: `${hdrRound}${st.override ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;box-shadow:0 2px 10px rgba(141,29,44,0.35);' : 'background:transparent;color:#5B564E;border:1px solid rgba(35,34,32,0.18);'}`,
      overrideTip: st.override ? 'Diffusion flash ACTIVE — cliquer pour reprendre les playlists' : 'Diffusion flash (suspend les playlists)',
      publishIconStyle: `width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;flex:0 0 auto;background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;box-shadow:0 3px 12px rgba(141,29,44,0.4);`,
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
          <div style="text-align:center;font-size:12px;color:#8A847C;margin-bottom:6px;">Connexion requise pour piloter le réseau</div>
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

    // Volets repliables de l'éditeur : en-tête cliquable, résumé quand fermé,
    // un seul volet ouvert à la fois, centré à l'écran à l'ouverture.
    const secOpen = (id) => st.openSec === id;
    const secCard = 'background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;overflow:hidden;';
    const secBody = 'padding:2px 24px 22px;';
    const secHead = (id, title, summary) => html`
      <button onClick=${(e) => this.toggleSec(id, e.currentTarget.parentElement)} style="width:100%;box-sizing:border-box;display:flex;align-items:center;gap:11px;padding:17px 24px;background:transparent;border:none;cursor:pointer;text-align:left;">
        <span style="flex:0 0 auto;display:inline-block;font-size:10px;color:#8D1D2C;transform:rotate(${secOpen(id) ? '90deg' : '0deg'});transition:transform .15s;">▶</span>
        <span style="flex:0 0 auto;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">${title}</span>
        ${!secOpen(id) && summary ? html`<span style="flex:1 1 auto;min-width:0;text-align:right;font-size:12px;color:#8A847C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${summary}</span>` : null}
      </button>`;

    // Aperçu + transport — l'onglet 1 montre l'élément en construction,
    // l'onglet 2 montre le film complet.
    const previewBlock = html`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;">
        <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">${v.isTimelineTab ? `Aperçu du film « ${this.activeFilm().name} » · 6480 × 3840` : `Aperçu de l'élément · 6480 × 3840`}</h2>
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
      </div>`;

    // Réglages de diffusion du film — uniquement dans l'onglet Playlist.
    const diffusionBlock = html`
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;">
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
          <span>Film <strong style="color:#232220;">${v.moduleCount} modules</strong></span>
          <span style="color:rgba(35,34,32,0.18);">·</span>
          <span>Durée totale <strong style="color:#232220;">${v.playlistTotal}</strong></span>
        </div>
      </div>`;

    // Sélecteur de film en badges — utilisé dans l'onglet Playlist.
    const filmBadge = (p, active, pick) => html`
      <button onClick=${pick} title=${`${p.name} · ${p.items.length} module(s)`}
        style="padding:7px 14px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;white-space:nowrap;${active ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#232220;border:1px solid rgba(35,34,32,0.16);'}">
        ${p.name} <span style="opacity:0.65;font-weight:500;">(${p.items.length})</span>
      </button>`;
    const filmSelector = html`
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        ${st.editingFilm
          ? html`<input value=${st.editFilmName}
              ref=${(el) => { if (el && document.activeElement !== el && !el._focused) { el._focused = true; el.focus(); el.select(); } }}
              onInput=${(e) => this.setState({ editFilmName: e.target.value })}
              onKeyDown=${(e) => { if (e.key === 'Enter') this.renameFilm(st.editFilmName); if (e.key === 'Escape') this.setState({ editingFilm: false }); }}
              onBlur=${() => this.renameFilm(st.editFilmName)}
              style="flex:0 1 auto;min-width:180px;padding:7px 9px;font-size:13px;font-weight:600;border:1px solid #8D1D2C;border-radius:8px;background:#fff;" />`
          : st.playlists.map((p) => filmBadge(p, p.id === st.activePl, () => this.selectFilm(p.id)))}
        <button onClick=${() => this.setState({ editingFilm: true, editFilmName: this.activeFilm().name })} title="Renommer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;flex:0 0 auto;">✎</button>
        <button onClick=${() => this.newFilm()} title="Nouveau film (vide)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:#8D1D2C;color:#fff;border:none;cursor:pointer;font-size:14px;font-weight:700;flex:0 0 auto;">＋</button>
        <button onClick=${() => this.dupFilm()} title="Dupliquer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;flex:0 0 auto;">⎘</button>
        <button onClick=${() => this.delFilm()} title="Supprimer le film (les modules restent en bibliothèque)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;color:#8D1D2C;flex:0 0 auto;">🗑</button>
      </div>`;

    return html`
<div style="height:100vh;background:#E7E1D8;color:#232220;display:flex;flex-direction:column;overflow:hidden;">

  <header style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px 24px;padding:14px 30px;background:#FFFFFF;border-bottom:1px solid rgba(35,34,32,0.10);z-index:5;">
    <div style="display:flex;align-items:center;gap:16px;min-width:0;flex:1 1 auto;">
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;flex:0 0 auto;">
        <img src="assets/logo.png" alt="L'Atelier By" style="height:32px;width:auto;" />
        <span style="font-weight:500;font-size:12.5px;letter-spacing:0.02em;white-space:nowrap;">Régie d'affichage</span>
        <span style="font-size:9.5px;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;white-space:nowrap;">Signage hybride · cache local</span>
      </div>
      <div style="display:inline-flex;background:#EFE9E0;border-radius:999px;padding:3px;flex:0 0 auto;margin-left:10px;">
        <button onClick=${v.setViewComposer} style=${v.tabComposerStyle}>Compositeur</button>
        <button onClick=${v.setViewProducts} style=${v.tabProductsStyle}>Produits</button>
        <button onClick=${v.setViewFleet} style=${v.tabFleetStyle}>Réseau & supervision</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:9px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;">
      <button class="hdr-btn" onClick=${v.undo} style=${v.undoStyle}>↶<span class="hdr-tip">Annuler (⌘Z)</span></button>
      <button class="hdr-btn" onClick=${v.redo} style=${v.redoStyle}>↷<span class="hdr-tip">Rétablir (⌘⇧Z)</span></button>
      <span style="width:1px;height:26px;background:rgba(35,34,32,0.10);flex:0 0 auto;margin:0 3px;"></span>
      <button class="hdr-btn" onClick=${v.save} style=${v.saveIconStyle}>✓<span class="hdr-tip">${v.saveTip}</span></button>
      <button class="hdr-btn" onClick=${v.pushPrices} style=${v.pricesIconStyle}>€<span class="hdr-tip">Pousser les prix — sync légère, sans re-télécharger les médias</span></button>
      <button class="hdr-btn" onClick=${v.toggleOverride} style=${v.overrideIconStyle}>⚡<span class="hdr-tip">${v.overrideTip}</span></button>
      <button class="hdr-btn" onClick=${v.openPublish} style=${v.publishIconStyle}>↗<span class="hdr-tip hdr-tip-right">Publier sur le réseau — déploie le film choisi</span></button>
      <span style="width:1px;height:26px;background:rgba(35,34,32,0.10);flex:0 0 auto;margin:0 3px;"></span>
      <button class="hdr-btn" onClick=${v.setViewSettings} style=${v.settingsIconStyle}>⚙<span class="hdr-tip hdr-tip-right">Paramètres — serveur, import PWA & liens</span></button>
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
      ${st.pwaForm && html`
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:26px 28px;margin-top:20px;">
        <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Catalogue PWA — même serveur</h2>
        <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.5;">La régie tourne sur le serveur des bases de données : le bouton détecte tout seul la base qui contient <strong>product_category</strong>, <strong>product</strong> et <strong>shop_product</strong> (connexion locale), lit les colonnes, et rafraîchit la table produits — catégories, produits, prix par boutique mappés sur les magasins dans l'ordre.</p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <button onClick=${() => this.pwaAction('import')} disabled=${!!st.pwaBusy} style="display:inline-flex;align-items:center;gap:9px;padding:12px 24px;font-size:14px;font-weight:600;border-radius:999px;cursor:${st.pwaBusy ? 'progress' : 'pointer'};background:#6E4A2B;color:#fff;border:1px solid #6E4A2B;box-shadow:0 2px 10px rgba(110,74,43,0.3);">
            <span style="font-size:16px;display:inline-block;${st.pwaBusy === 'import' ? 'animation:none;' : ''}">⟳</span>
            ${st.pwaBusy === 'import' ? 'Rafraîchissement…' : 'Rafraîchir depuis la base'}
          </button>
          <button onClick=${() => this.pwaAction('test')} disabled=${!!st.pwaBusy} style="padding:11px 18px;font-size:13px;font-weight:600;border-radius:999px;cursor:${st.pwaBusy ? 'progress' : 'pointer'};background:transparent;color:#5B564E;border:1px solid rgba(35,34,32,0.18);">${st.pwaBusy === 'test' ? 'Détection…' : 'Tester (sans importer)'}</button>
        </div>
        ${st.pwaResult && html`
          <div style="margin-bottom:12px;font-size:12.5px;font-weight:600;line-height:1.6;color:${st.pwaResult.ok ? '#2E7D32' : '#8D1D2C'};">
            ${st.pwaResult.ok
              ? (st.pwaResult.counts
                ? `✓ Base « ${st.pwaResult.db} » détectée — ${Object.entries(st.pwaResult.counts).map(([k, n]) => `${n} ${k}`).join(' · ')}`
                : `✓ Base « ${st.pwaResult.db} » — importé : ${st.pwaResult.categories} catégorie(s) · ${st.pwaResult.products} produit(s) · ${st.pwaResult.storePrices} prix/boutique (${st.pwaResult.shopMap}) · ${st.pwaResult.relinked} élément(s) re-lié(s)`)
              : `✗ ${st.pwaResult.error}`}
            ${st.pwaResult.note ? html`<span style="display:block;font-weight:400;color:#8a6508;">⚠ ${st.pwaResult.note}</span>` : ''}
          </div>
        `}
        <details>
        <summary style="font-size:12px;font-weight:600;color:#8A847C;cursor:pointer;">Réglages avancés — uniquement si la détection automatique échoue</summary>
        <div style="margin:10px 0 0;">
          <button onClick=${() => this.pwaReset()} style="padding:8px 14px;font-size:12px;font-weight:600;border-radius:999px;cursor:pointer;background:transparent;color:#8D1D2C;border:1px solid rgba(141,29,44,0.3);">Réinitialiser les réglages avancés (retour au tout-automatique)</button>
        </div>
        <div style="display:grid;grid-template-columns:1.2fr 90px 1fr 1fr 1fr;gap:9px;margin:12px 0 10px;">
          <input value=${st.pwaForm.host} onInput=${(e) => this.setPwa('host', e.target.value)} placeholder="Hôte (127.0.0.1)" style="padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;min-width:0;" />
          <input value=${st.pwaForm.port} onInput=${(e) => this.setPwa('port', e.target.value)} placeholder="3306" inputmode="numeric" style="padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;min-width:0;" />
          <input value=${st.pwaForm.db} onInput=${(e) => this.setPwa('db', e.target.value)} placeholder="Base (ex. pwa)" style="padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;min-width:0;" />
          <input value=${st.pwaForm.user} onInput=${(e) => this.setPwa('user', e.target.value)} placeholder="Utilisateur" style="padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;min-width:0;" />
          <input type="password" value=${st.pwaForm.password} onInput=${(e) => this.setPwa('password', e.target.value)} placeholder=${st.pwaForm.hasPassword ? '••••• (inchangé)' : 'Mot de passe'} style="padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;min-width:0;" />
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">ID boutique PWA par magasin</span>
          ${st.fleet.map((sf) => html`
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#5B564E;background:#FBF8F2;border:1px solid rgba(35,34,32,0.12);border-radius:999px;padding:5px 6px 5px 12px;">
              ${sf.store}
              <input value=${(st.pwaForm.shopMap || {})[sf.id] || ''} onInput=${(e) => this.setPwaShop(sf.id, e.target.value)} placeholder="id" style="width:52px;padding:5px 8px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#fff;text-align:center;" />
            </label>
          `)}
        </div>
        <div style="margin-bottom:4px;">
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
            <label style="font-size:11.5px;color:#8A847C;">Catégories → <code>id, nom</code></label>
            <textarea value=${st.pwaForm.qCategories} onInput=${(e) => this.setPwa('qCategories', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:#8A847C;">Produits → <code>id, id_catégorie, nom, prix, actif</code></label>
            <textarea value=${st.pwaForm.qProducts} onInput=${(e) => this.setPwa('qProducts', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:#8A847C;">Prix par boutique (shop_product) → <code>id_produit, id_boutique, prix</code></label>
            <textarea value=${st.pwaForm.qShopPrices} onInput=${(e) => this.setPwa('qShopPrices', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:#8A847C;">Alias / langues (optionnel) → <code>id_produit, langue, nom</code></label>
            <textarea value=${st.pwaForm.qAliases} onInput=${(e) => this.setPwa('qAliases', e.target.value)} rows="1" placeholder="SELECT product_id, lang, name FROM product_lang" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;resize:vertical;"></textarea>
          </div>
        </div>
        </details>
      </div>
      `}

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
        ${this.perFilmLinks().length > 0 && html`
          <h3 style="margin:20px 0 4px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Par film · dernière publication du film (55″ standard)</h3>
          <p style="margin:0 0 12px;font-size:11.5px;color:#8A847C;line-height:1.5;">Un lien par film de la régie. Un film jamais publié s'affiche en prévisualisation (badge « brouillon ») — pense à Enregistrer puis Publier.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${this.perFilmLinks().map((l) => html`
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

  ${v.isProductsView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:26px 32px 48px;">
    <div style="max-width:1500px;margin:0 auto;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Table produits</h2>
          <p style="margin:0;font-size:12.5px;color:#8A847C;">La source unique des listes de prix : catégories → produits, actif/inactif, prix par défaut et prix par magasin. Les éléments liés (⛓) suivent automatiquement.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">Langue d'édition</span>
          ${v.langChips.map((l) => html`
            <button onClick=${l.pick} title=${l.label + (l.nStores ? ` · ${l.nStores} magasin(s)` : '')} style=${l.style}>${l.id}${l.nStores ? html`<span style="font-weight:400;opacity:0.75;">${l.nStores}</span>` : ''}</button>
          `)}
        </div>
        <button onClick=${v.saveCat} disabled=${!v.catDirty || v.catSaving} style="padding:11px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:${v.catDirty && !v.catSaving ? 'pointer' : 'not-allowed'};background:${v.catDirty ? '#8D1D2C' : 'rgba(35,34,32,0.10)'};color:${v.catDirty ? '#fff' : '#8A847C'};">${v.catSaving ? 'Enregistrement…' : (v.catDirty ? 'Enregistrer la table' : '✓ Enregistrée')}</button>
      </div>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start;">
        <div style="background:#F3EEE6;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px;">
            <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Catégories</h3>
            <button onClick=${v.addProdCat} style="padding:6px 12px;font-size:12px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:999px;cursor:pointer;">＋</button>
          </div>
          ${v.prodCats.map((c) => html`
            <div onClick=${c.pick} style=${c.cardStyle}>
              <input value=${c.name} onInput=${c.onName} onClick=${(e) => e.stopPropagation()} placeholder=${c.namePlaceholder} style="flex:1 1 auto;min-width:0;padding:7px 9px;font-size:13.5px;font-weight:600;border:1px solid ${c.on ? 'rgba(141,29,44,0.3)' : 'transparent'};border-radius:7px;background:${c.on ? '#FBF8F2' : 'transparent'};${v.isBaseLang ? '' : 'border-color:rgba(184,134,11,0.5);'}" />
              <span style="flex:0 0 auto;font-size:11px;color:#8A847C;">${c.count}${c.usedBy ? ' · ⛓' + c.usedBy : ''}</span>
              <button onClick=${c.toggleActive} title="Active / inactive" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;flex:0 0 auto;border:1px solid rgba(35,34,32,0.12);cursor:pointer;background:${c.active ? 'rgba(46,110,78,0.12)' : 'rgba(35,34,32,0.06)'};color:${c.active ? '#2E6E4E' : '#8A847C'};font-size:12px;">${c.active ? '✓' : '⃠'}</button>
              <button onClick=${c.del} title="Supprimer la catégorie" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;flex:0 0 auto;border:1px solid rgba(35,34,32,0.12);cursor:pointer;background:rgba(255,255,255,0.7);color:#8D1D2C;font-size:12px;">🗑</button>
            </div>
          `)}
          ${!v.prodCats.length && html`<div style="font-size:12px;color:#8A847C;padding:8px;">Aucune catégorie — clique ＋ pour commencer.</div>`}
        </div>

        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">${v.prodSelCat ? `Produits · ${v.prodSelCat.name}` : 'Produits'}</h3>
            <button onClick=${v.addProd} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;cursor:pointer;">+ Ajouter un produit</button>
          </div>
          <div style="overflow-x:auto;">
            <div style="display:grid;grid-template-columns:52px minmax(190px,1.4fr) 150px 110px ${v.storeCols.map(() => '110px').join(' ')} 90px 130px;gap:8px;align-items:center;min-width:${700 + v.storeCols.length * 118}px;">
              <span></span>
              <span style="font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;">Produit</span>
              <span style="font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;">Visuel</span>
              <span style="font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;text-align:right;">Prix défaut</span>
              ${v.storeCols.map((sc) => html`<span title=${sc.label} style="font-size:10.5px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#8A847C;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sc.label}</span>`)}
              <span style="font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;text-align:center;">Actif</span>
              <span></span>
              ${v.prodRows.map((p) => html`
                <div style="display:flex;align-items:center;">${p.thumb}</div>
                <input value=${p.name} onInput=${p.onName} placeholder=${p.namePlaceholder} style="padding:9px 11px;font-size:13.5px;font-weight:500;border:1px solid ${v.isBaseLang ? 'rgba(35,34,32,0.14)' : 'rgba(184,134,11,0.55)'};border-radius:8px;background:${p.active ? '#FBF8F2' : 'rgba(35,34,32,0.04)'};opacity:${p.active ? 1 : 0.6};min-width:0;" />
                <div style="display:flex;align-items:center;gap:5px;min-width:0;">
                  <select value=${p.isPhoto ? '' : p.img} onChange=${p.onImg} style="flex:1 1 auto;min-width:0;padding:8px 6px;font-size:11.5px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                    ${p.isPhoto && html`<option value="">📷 photo</option>`}
                    <option value="assets/cookies.png">Cookie</option>
                    <option value="assets/cake-slice.png">Part gâteau</option>
                    <option value="assets/cake.png">Gâteau</option>
                    <option value="assets/cherry.png">Cerise</option>
                    <option value="assets/apple.png">Pomme</option>
                    <option value="assets/rhubarb.png">Rhubarbe</option>
                    <option value="assets/sweet-tart-small.png">Tarte S</option>
                    <option value="assets/sweet-tart-big.png">Tarte L</option>
                  </select>
                  <label title="Importer une photo" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;flex:0 0 auto;border:1px dashed rgba(35,34,32,0.3);background:#FBF8F2;cursor:pointer;font-size:13px;">⬆<input type="file" accept="image/*" onChange=${p.onPhoto} style="display:none;" /></label>
                </div>
                <input value=${p.price} onInput=${p.onPrice} inputmode="decimal" style="padding:9px 10px;font-size:13.5px;font-weight:600;text-align:right;color:#8D1D2C;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;min-width:0;" />
                ${p.storePrices.map((sp) => html`
                  <input value=${sp.value} onInput=${sp.onInput} placeholder="défaut" inputmode="decimal" style="padding:9px 10px;font-size:13px;text-align:right;color:${sp.value ? '#8D1D2C' : '#B8B2A8'};font-weight:${sp.value ? 600 : 400};border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:${sp.value ? 'rgba(141,29,44,0.05)' : '#FBF8F2'};min-width:0;" />
                `)}
                <div style="display:flex;justify-content:center;">
                  <button onClick=${p.toggleActive} title="Actif / inactif (masqué à l'écran)" style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid rgba(35,34,32,0.12);cursor:pointer;background:${p.active ? 'rgba(46,110,78,0.12)' : 'rgba(141,29,44,0.08)'};color:${p.active ? '#2E6E4E' : '#8D1D2C'};font-size:13px;">${p.active ? '✓' : '⃠'}</button>
                </div>
                <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">
                  <button onClick=${p.up} title="Monter" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;border:1px solid rgba(35,34,32,0.12);background:#FBF8F2;cursor:pointer;font-size:12px;">↑</button>
                  <button onClick=${p.down} title="Descendre" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;border:1px solid rgba(35,34,32,0.12);background:#FBF8F2;cursor:pointer;font-size:12px;">↓</button>
                  <button onClick=${p.del} title="Supprimer" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;border:1px solid rgba(35,34,32,0.12);background:#FBF8F2;cursor:pointer;font-size:12px;color:#8D1D2C;">✕</button>
                </div>
              `)}
            </div>
          </div>
          ${!v.prodRows.length && html`<div style="font-size:12.5px;color:#8A847C;padding:14px 4px 4px;">Aucun produit dans cette catégorie — « + Ajouter un produit ».</div>`}
          <p style="margin:14px 0 0;font-size:11.5px;color:#8A847C;">Prix par magasin : laisse vide pour utiliser le prix par défaut. Langues : FR = noms de base ; dans une autre langue, le champ nom édite la traduction (vide = nom de base). Chaque magasin affiche automatiquement ses prix ET sa langue (réglée dans Réseau).</p>
        </div>
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
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:16px 22px;border-bottom:1px solid rgba(35,34,32,0.08);background:#FBF8F2;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              ${s.renaming ? html`
                <input value=${this.state.editStoreName} onInput=${s.onRenameInput} onKeyDown=${s.onRenameKey}
                  ref=${(el) => { if (el && document.activeElement !== el && !el._focused) { el._focused = true; el.focus(); el.select(); } }}
                  style="padding:7px 11px;font-size:15px;font-weight:600;border:1px solid #8D1D2C;border-radius:8px;background:#fff;min-width:260px;" />
                <button onClick=${s.commitRename} style="padding:7px 13px;font-size:12px;font-weight:600;border-radius:8px;border:none;background:#8D1D2C;color:#fff;cursor:pointer;">OK</button>
              ` : html`
                <span style="font-size:16px;font-weight:600;">${s.store}</span>
                <button onClick=${s.startRename} title="Renommer le magasin / l'écran" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.8);border:1px solid rgba(35,34,32,0.14);cursor:pointer;font-size:12px;color:#8A847C;">✎</button>
              `}
              <span style="font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;background:rgba(35,34,32,0.07);border-radius:999px;padding:3px 10px;">${s.group}</span>
              <button onClick=${s.copyFilm} title="Copier le lien direct du film de ce magasin (à la taille de son combo d'écrans)" style="padding:5px 11px;font-size:11.5px;font-weight:600;border-radius:999px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Lien film</button>
              <a href=${s.filmUrl} target="_blank" title="Ouvrir le film de ce magasin" style="font-size:11.5px;font-weight:600;color:#8D1D2C;">↗</a>
            </div>
            <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">Combo écrans</span>
              <select value=${s.fmt.screens} onChange=${s.setScreens} title="Nombre d'écrans côte à côte" style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#fff;cursor:pointer;">
                ${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
              <span style="font-size:12px;color:#8A847C;">×</span>
              <select value=${s.fmt.size} onChange=${s.setSize} title="Diagonale d'une dalle" style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#fff;cursor:pointer;">
                ${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}
              </select>
              <select value=${s.fmt.orient} onChange=${s.setOrient} title="Orientation des dalles" style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#fff;cursor:pointer;">
                <option value="paysage">paysage</option>
                <option value="portrait">portrait</option>
              </select>
              <select value=${s.lang} onChange=${s.setLang} title="Langue d'affichage du magasin (noms de produits via la table produits)" style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#fff;cursor:pointer;text-transform:uppercase;">
                ${s.langOptions.map((l) => html`<option value=${l.id}>${l.id}</option>`)}
              </select>
              <span style="font-size:12.5px;font-weight:700;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:5px 12px;">= ${s.fmt.px}</span>
              <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:${s.connColor};"><span style="width:8px;height:8px;border-radius:50%;background:${s.connColor};"></span>${s.connLabel}</div>
            </div>
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
  <div style="flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:10px 30px;background:#EDE7DE;border-bottom:1px solid rgba(35,34,32,0.08);flex-wrap:wrap;">
    <div style="display:inline-flex;background:#E0D9CE;border-radius:999px;padding:3px;">
      <button onClick=${v.setTabLib} style=${v.tabLibStyle}>1 · Bibliothèque — construire</button>
      <button onClick=${v.setTabTimeline} style=${v.tabTimelineStyle}>2 · Playlist — ligne du temps</button>
    </div>
    <span style="font-size:12px;color:#8A847C;">${v.isTimelineTab ? 'Glisse les éléments de la bibliothèque sur la ligne du temps, puis Enregistrer et Publier sur le réseau.' : 'Construis ici les éléments (catégories, liaisons) qui composeront tes films.'}</span>
  </div>
  `}

  ${v.isComposerView && v.isLibTab && html`
  <div style="flex:1 1 auto;display:grid;grid-template-columns:300px minmax(440px,1fr) minmax(560px,0.95fr);min-height:0;">

    <aside style="background:#F3EEE6;border-right:1px solid rgba(35,34,32,0.10);display:flex;flex-direction:column;min-height:0;overflow:auto;">
      <div style="flex:0 0 auto;padding:18px 18px 10px;">
        <h2 style="margin:0 0 3px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Bibliothèque</h2>
        <p style="margin:0;font-size:11.5px;color:#8A847C;line-height:1.4;">Tous les éléments · clique pour éditer · ＋ ajoute au film affiché dans l'onglet Playlist</p>
      </div>
      <div style="flex:1 1 auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:7px;">
        ${v.library.map((ml) => html`
          <div onClick=${ml.select} style=${ml.cardStyle}>
            <span style=${ml.badgeStyle}>${ml.typeIcon}</span>
            <div style="flex:1 1 auto;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ml.name}</span>
                ${ml.catChip}
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
      <div style="flex:0 0 auto;padding:12px;border-top:1px solid rgba(35,34,32,0.10);display:flex;gap:8px;">
        <button onClick=${v.openAddPicker} style="flex:1 1 auto;padding:11px;font-size:13.5px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:10px;cursor:pointer;">＋ Élément</button>
        <button onClick=${v.paste} style=${v.pasteStyle}>Coller</button>
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
          <div style="margin-top:14px;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:7px;">Catégorie de bibliothèque</label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${v.libTagPicker.map((t) => html`
                <button onClick=${t.pick} style=${t.style}><span style=${t.dotStyle}></span>${t.label}</button>
              `)}
            </div>
          </div>
          ${v.hasSub && html`
            <div style="margin-top:14px;">
              <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:7px;">Sous-titre (accroche)</label>
              <input value=${v.liaisonSub} onInput=${v.onLiaisonSub} placeholder="ex. faites maison chaque matin" style="width:100%;box-sizing:border-box;padding:11px 13px;font-size:15px;border:1px solid rgba(35,34,32,0.16);border-radius:10px;background:#FBF8F2;" />
            </div>
          `}
          ${v.hasDur && html`
            <div style="margin-top:14px;display:flex;align-items:center;gap:10px;">
              <label style="font-size:12.5px;font-weight:500;color:#8A847C;">Durée à l'écran</label>
              <input type="number" min="2" max="120" step="1" value=${v.durVal} onInput=${v.onDur} style="width:90px;padding:9px 11px;font-size:14px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;text-align:right;" />
              <span style="font-size:12.5px;color:#8A847C;">secondes</span>
            </div>
          `}
        </div>

        <div style=${secCard}>
          ${secHead('tag', 'Tag campagne', v.tagSummary)}
          ${secOpen('tag') && html`<div style=${secBody}>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <p style="margin:0;font-size:12px;color:#8A847C;line-height:1.5;">Affiche un macaron (illustration + texte) sur l'écran, pour une campagne commerciale.</p>
            <button onClick=${v.toggleTag} style=${v.tagTrackStyle}><span style=${v.tagKnobStyle}></span></button>
          </div>
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
          </div>`}
        </div>

        ${v.layoutOptions.length > 1 && html`
          <div style=${secCard}>
            ${secHead('layout', 'Mise en page', v.layoutSummary)}
            ${secOpen('layout') && html`<div style=${secBody}>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
              ${v.layoutOptions.map((opt) => html`
                <button onClick=${opt.pick} style=${opt.style}>
                  <span style="display:block;font-size:20px;line-height:1;margin-bottom:7px;">${opt.icon}</span>
                  <span style="font-size:12px;font-weight:500;line-height:1.3;">${opt.label}</span>
                </button>
              `)}
            </div>
            </div>`}
          </div>
        `}

        ${v.isProduit && html`
          <div style=${secCard}>
            ${secHead('produit', 'Produit à la une', v.produitSummary)}
            ${secOpen('produit') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
              <p style="margin:0;font-size:12px;color:#8A847C;line-height:1.5;">Le produit vient de la table produits — nom et prix (par magasin) suivent automatiquement.</p>
              <button onClick=${v.goProducts} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:600;color:#8D1D2C;background:rgba(141,29,44,0.06);border:1px solid rgba(141,29,44,0.25);border-radius:999px;cursor:pointer;">▦ Ouvrir la table produits</button>
            </div>
            <select value=${v.curProductRef} onChange=${v.onProductRef} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid rgba(35,34,32,0.16);border-radius:10px;background:#FBF8F2;cursor:pointer;">
              <option value="">— Choisir un produit —</option>
              ${v.productOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
            </select>
            </div>`}
          </div>
        `}

        ${v.isFilmEl && html`
          <div style=${secCard}>
            ${secHead('video', 'Vidéo', v.videoSummary)}
            ${secOpen('video') && html`<div style=${secBody}>
            <p style="margin:0 0 12px;font-size:12px;color:#8A847C;line-height:1.5;">mp4 ou webm, <strong>8 Mo max</strong> (compresse en 1080p/H.264). Lue en boucle, sans le son, pendant la durée choisie.</p>
            ${v.hasVideo && html`
              <video src=${v.videoPreview} muted autoplay loop playsinline style="width:100%;border-radius:12px;background:#000;margin-bottom:10px;"></video>
            `}
            <div style="display:flex;gap:10px;">
              <label style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;font-size:13px;font-weight:600;color:#8D1D2C;border:1px dashed rgba(141,29,44,0.4);border-radius:10px;background:rgba(141,29,44,0.04);cursor:pointer;">
                <span style="font-size:16px;">⬆</span><span>${v.hasVideo ? 'Remplacer la vidéo' : 'Importer une vidéo'}</span>
                <input type="file" accept="video/mp4,video/webm,video/*" onChange=${v.onVideoFile} style="display:none;" />
              </label>
              ${v.hasVideo && html`<button onClick=${v.clearVideo} style="padding:11px 16px;font-size:13px;font-weight:600;color:#8D1D2C;background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:10px;cursor:pointer;">Retirer</button>`}
            </div>
            </div>`}
          </div>
        `}

        ${(v.isProduit || v.isAnim) && html`
          <div style=${secCard}>
            ${secHead('motion', 'Mouvement', v.motionSummary)}
            ${secOpen('motion') && html`<div style=${secBody}>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
              ${v.motionSimple.map((o) => html`<button onClick=${o.pick} style=${o.style}>${o.label}</button>`)}
            </div>
            </div>`}
          </div>
        `}

        ${v.isCategory && html`
          <div style=${secCard}>
            ${secHead('motion', 'Mouvement dynamique', v.motionSummary)}
            ${secOpen('motion') && html`<div style=${secBody}>
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
            </div>`}
          </div>
        `}

        ${(v.isCategory || v.isProduit) && html`
          <div style=${secCard}>
            ${secHead('pos', 'Positions (avancé)', v.posSummary)}
            ${secOpen('pos') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <p style="margin:0;font-size:12px;color:#8A847C;line-height:1.5;">Ajuste finement titre, liste et illustration par-dessus la mise en page.</p>
              <button onClick=${v.resetPos} style="flex:0 0 auto;padding:7px 12px;font-size:12px;font-weight:500;color:#8A847C;background:#FBF8F2;border:1px solid rgba(35,34,32,0.14);border-radius:8px;cursor:pointer;">Réinitialiser</button>
            </div>
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
            </div>`}
          </div>
        `}

        ${v.isCategory && v.isLinked && html`
          <div style=${secCard}>
            ${secHead('items', 'Liste de prix — table produits', v.itemsSummary)}
            ${secOpen('items') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#2E6E4E;background:rgba(46,110,78,0.1);border:1px solid rgba(46,110,78,0.35);border-radius:999px;padding:3px 10px;">⛓ ${v.linkedCatName}</span>
            </div>
            <p style="margin:0 0 12px;font-size:12px;color:#8A847C;line-height:1.5;">Les lignes viennent de la table produits : noms, prix (et prix par magasin), actifs/inactifs suivent automatiquement. Modifie-les dans la table.</p>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
              ${v.linkedRows.map((r) => html`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:9px;background:${r.active ? '#FBF8F2' : 'rgba(35,34,32,0.04)'};opacity:${r.active ? 1 : 0.55};">
                  <span style="font-size:13.5px;font-weight:500;">${r.name}${r.active ? '' : ' · masqué'}</span>
                  <span style="font-size:13.5px;font-weight:600;color:#8D1D2C;">${r.price} €</span>
                </div>
              `)}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button onClick=${v.goProducts} style="flex:1 1 auto;padding:11px 14px;font-size:13px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:10px;cursor:pointer;">▦ Ouvrir la table produits</button>
              <select value=${v.curCatRef} onChange=${v.onLinkCat} style="flex:1 1 auto;padding:10px 12px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:10px;background:#FBF8F2;cursor:pointer;">
                ${v.catOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
              </select>
              <button onClick=${v.doUnlinkCat} title="Copier les lignes dans l'élément et reprendre la main" style="padding:11px 14px;font-size:13px;font-weight:600;color:#8D1D2C;background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:10px;cursor:pointer;">Délier</button>
            </div>
            </div>`}
          </div>
        `}

        ${v.isCategory && !v.isLinked && html`
          <div style=${secCard}>
            ${secHead('items', 'Produits & tarifs', v.itemsSummary)}
            ${secOpen('items') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:8px;">
                <select value="" onChange=${v.onLinkCat} title="Les lignes viendront de la table produits" style="padding:8px 10px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#FBF8F2;cursor:pointer;max-width:230px;">
                  <option value="">⛓ Lier à la table produits…</option>
                  ${v.catOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                </select>
                <button onClick=${v.addItem} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;cursor:pointer;">+ Ajouter</button>
              </div>
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
                    ${infoTip(PHOTO_TIP)}
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
            </div>`}
          </div>
        `}

      </div>
    </section>

    <section style="overflow:auto;padding:24px 26px 40px;background:#EDE7DE;">
      ${previewBlock}
    </section>

  </div>
  `}

  ${v.isComposerView && v.isTimelineTab && html`
  <div style="flex:1 1 auto;overflow:auto;padding:20px 30px 44px;background:#EDE7DE;">
    <div style="max-width:1500px;margin:0 auto;display:flex;flex-direction:column;gap:16px;">

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Film</h2>
        ${filmSelector}
        <span style="font-size:12px;color:#8A847C;">durée totale <strong style="color:#232220;">${v.timelineTotal}</strong> · ${v.moduleCount} module(s)</span>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Bibliothèque — choisis une catégorie, puis glisse un élément sur la ligne du temps (ou clique ＋)</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${v.libTagChips.map((t) => html`
            <button onClick=${t.pick} style=${t.style}><span style=${t.dotStyle}></span>${t.label}<span style="font-weight:400;opacity:0.75;">${t.count}</span></button>
          `)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${v.libCards.map((c) => html`
            <div draggable="true" onDragStart=${c.onDragStart} style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:#FBF8F2;border:1px solid ${c.tagColor}44;border-left:4px solid ${c.tagColor};cursor:grab;">
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;flex:0 0 auto;font-size:11px;background:${c.tagColor}1F;color:${c.tagColor};">${c.typeIcon}</span>
              <div style="min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:12.5px;font-weight:600;white-space:nowrap;">${c.name}</span>
                  <span style="font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${c.tagColor};">${c.tagLabel}</span>
                </div>
                <div style="font-size:10px;color:#8A847C;">${c.meta}${c.inFilm ? '' : ' · hors film'}</div>
              </div>
              <button onClick=${c.add} title="Ajouter à la fin du film" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#8D1D2C;color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:700;flex:0 0 auto;">＋</button>
              <button onClick=${c.edit} title="Éditer dans la bibliothèque" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,0.8);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:11px;flex:0 0 auto;">✎</button>
            </div>
          `)}
          ${v.libEmptyMsg && html`<div style="font-size:12px;color:#8A847C;padding:8px 4px;">${v.libEmptyMsg}</div>`}
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Ligne du temps · « ${this.activeFilm().name} »</h3>
        <div onDragOver=${v.timelineEndDrop.onDragOver} onDrop=${v.timelineEndDrop.onDrop} style="display:flex;align-items:stretch;gap:7px;overflow-x:auto;padding:12px;background:#EFE9E0;border-radius:12px;min-height:96px;">
          ${v.timelineBlocks.map((b) => html`
            <div class="tl-block pl-item" draggable="true" onClick=${b.jump} onDragStart=${b.onDragStart} onDragOver=${b.onDragOver} onDragLeave=${b.onDragLeave} onDrop=${b.onDrop} onDragEnd=${b.onDragEnd} style="${b.blockStyle}width:${b.width}px;" title="Clique pour caler l'aperçu sur ce bloc">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <span style="font-size:10px;font-weight:700;opacity:0.7;">${b.order}</span>
                <button onClick=${b.remove} title="Retirer du film (reste en bibliothèque)" style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:rgba(0,0,0,0.08);border:none;cursor:pointer;font-size:10px;color:inherit;">✕</button>
              </div>
              <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.typeIcon} ${b.name}</div>
              <div style="font-size:10px;opacity:0.7;font-variant-numeric:tabular-nums;">${b.durLabel}</div>
            </div>
          `)}
          ${v.playlistEmpty && html`
            <div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-size:12.5px;color:#B8B2A8;border:1px dashed rgba(35,34,32,0.2);border-radius:10px;padding:18px;">Glisse ici les éléments de la bibliothèque pour composer le film</div>
          `}
          <div style="flex:1 1 64px;min-width:64px;border:1px dashed rgba(35,34,32,0.18);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#B8B2A8;font-size:18px;" title="Dépose ici pour ajouter à la fin">＋</div>
        </div>
        <p style="margin:10px 0 0;font-size:11.5px;color:#8A847C;">Clique un bloc pour caler l'aperçu dessus · glisse pour réordonner · ✕ retire (l'élément reste en bibliothèque) · la largeur d'un bloc reflète sa durée.</p>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Programmation & magasins du film</h3>
          <span style="font-size:12px;color:#8A847C;">${v.filmSchedSummary}</span>
        </div>
        <div style="display:flex;gap:28px;flex-wrap:wrap;">
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:7px;">Jours de diffusion</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmDaysVals.map((d) => html`<button onClick=${d.toggle} style=${d.style}>${d.label}</button>`)}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:7px;">Fenêtre horaire</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmSlotVals.map((s) => html`<button onClick=${s.pick} style=${s.style}>${s.label}</button>`)}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:7px;">Magasins</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <button onClick=${v.filmAllStores.pick} style=${v.filmAllStores.style}>Tous</button>
              ${v.filmStoreVals.map((s) => html`<button onClick=${s.toggle} style=${s.style}>${s.label}</button>`)}
            </div>
          </div>
        </div>
        <p style="margin:12px 0 0;font-size:11.5px;color:#8A847C;">Hors créneau, les écrans affichent l'attente (le lien de partage montre toujours le film). « Tous » = le film part sur tout le réseau à la publication.</p>
      </div>

      <div style="display:grid;grid-template-columns:minmax(520px,1fr) 340px;gap:16px;align-items:start;">
        <div>${previewBlock}</div>
        <div style="display:flex;flex-direction:column;gap:16px;">
        ${diffusionBlock}
        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;">
          <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">3 · Enregistrer & déployer</h3>
          <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.55;">Enregistre le film, puis publie-le : tu choisiras les <strong>jours</strong>, la <strong>fenêtre horaire</strong> et les <strong>magasins</strong>. Le lien de visionnage s'affiche juste après le déploiement.</p>
          <button onClick=${v.save} style="width:100%;margin-bottom:8px;${v.saveStyle}">${v.saveLabel}</button>
          <button onClick=${v.openPublish} style="width:100%;padding:11px;font-size:13.5px;font-weight:600;border-radius:999px;border:none;cursor:pointer;background:#232220;color:#fff;">Publier sur le réseau ↗</button>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(35,34,32,0.08);font-size:11.5px;color:#8A847C;line-height:1.5;">Lien direct de ce film (55″) :<br/>
            <button onClick=${() => this.copyLink(this.filmUrl({ film: st.activePl, w: 3840, h: 2160 }))} style="margin-top:6px;padding:8px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Copier le lien</button>
            <a href=${this.filmUrl({ film: st.activePl, w: 3840, h: 2160 })} target="_blank" style="margin-left:6px;font-size:12px;font-weight:600;">↗ Ouvrir</a>
          </div>
        </div>
        </div>
      </div>

    </div>
  </div>
  `}

  ${v.addPickerOpen && html`
    <div onClick=${v.closeAddPicker} style="position:fixed;inset:0;background:rgba(20,15,12,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:50;">
      <div onClick=${(e) => e.stopPropagation()} style="width:620px;max-width:94vw;max-height:88vh;overflow:auto;background:#FBF8F2;border-radius:20px;padding:26px 28px;box-shadow:0 30px 80px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="margin:0;font-size:19px;font-weight:600;">Nouvel élément</h2>
          <button onClick=${v.closeAddPicker} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:#EFE9E0;border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:14px;">✕</button>
        </div>
        <p style="margin:0 0 16px;font-size:12.5px;color:#8A847C;">Choisis le type — chaque type a ses propres mises en page.</p>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
          ${v.typeCards.map((t) => html`
            <button onClick=${t.pick} style="text-align:left;display:flex;gap:13px;align-items:flex-start;padding:15px 16px;border-radius:13px;cursor:pointer;background:#fff;border:1px solid rgba(35,34,32,0.12);">
              <span style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;flex:0 0 auto;font-size:18px;background:rgba(141,29,44,0.1);color:#8D1D2C;">${t.icon}</span>
              <span style="min-width:0;">
                <span style="display:block;font-size:14px;font-weight:600;margin-bottom:3px;">${t.label}</span>
                <span style="display:block;font-size:11.5px;color:#8A847C;line-height:1.45;">${t.descr}</span>
              </span>
            </button>
          `)}
        </div>
      </div>
    </div>
  `}

  ${v.publishing && html`
    <div onClick=${v.closePublish} style="position:fixed;inset:0;background:rgba(35,34,32,0.55);z-index:20;display:flex;align-items:center;justify-content:center;padding:30px;">
      <div onClick=${v.stop} style="background:#F5EFE4;border-radius:20px;width:640px;max-width:100%;max-height:90vh;overflow:auto;box-shadow:0 40px 100px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 26px;border-bottom:1px solid rgba(35,34,32,0.10);">
          <div>
            <h2 style="margin:0;font-size:19px;font-weight:600;">Publier sur le réseau</h2>
            <p style="margin:4px 0 0;font-size:12.5px;color:#8A847C;">Déploiement atomique · le player bascule quand tous les médias sont en cache</p>
          </div>
          <button onClick=${v.closePublish} style="width:34px;height:34px;border-radius:50%;border:none;background:rgba(35,34,32,0.08);cursor:pointer;font-size:15px;">✕</button>
        </div>
        ${st.pubDone && html`
        <div style="padding:26px;display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <span style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:rgba(46,125,50,0.14);color:#2E7D32;font-size:22px;flex:0 0 auto;">✓</span>
            <div>
              <div style="font-size:16px;font-weight:600;">Film « ${st.pubDone.name} » ${st.pubDone.scheduled ? 'planifié' : 'déployé'} · v${st.pubDone.version}</div>
              <div style="font-size:12.5px;color:#8A847C;">${st.pubDone.playerCount} écran(s) ciblés · tests live ${st.pubDone.testsOk}/${st.pubDone.testsTotal} OK</div>
            </div>
          </div>
          <div style="background:#FBF8F2;border:1px solid rgba(35,34,32,0.10);border-radius:12px;padding:14px 16px;">
            <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8A847C;margin-bottom:8px;">Ton lien pour voir le film (public · 55″)</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <input readonly value=${st.pubDone.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:8px;background:#fff;" />
              <button onClick=${() => this.copyLink(st.pubDone.url)} style="flex:0 0 auto;padding:9px 14px;font-size:12.5px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">Copier</button>
              <a href=${st.pubDone.url} target="_blank" style="flex:0 0 auto;padding:9px 12px;font-size:12.5px;font-weight:600;border-radius:8px;border:1px solid rgba(35,34,32,0.14);background:#fff;color:#232220;">↗ Ouvrir</a>
            </div>
            <p style="margin:10px 0 0;font-size:11.5px;color:#8A847C;line-height:1.5;">Les liens par magasin sont dans ⚙ Paramètres → Liens de diffusion. Les écrans basculent automatiquement dès leur cache prêt.</p>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button onClick=${v.closePublish} style="padding:11px 22px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:pointer;background:#232220;color:#fff;">Voir le réseau →</button>
          </div>
        </div>
        `}
        ${!st.pubDone && html`
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
          ${st.pubMode !== 'data' && html`
          <div>
            <h3 style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Film à publier</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${st.playlists.map((p) => html`
                <button onClick=${() => this.setState({ pubFilm: p.id })} title=${`${p.name} · ${p.items.length} module(s)`}
                  style="padding:8px 15px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;white-space:nowrap;${p.id === (st.pubFilm || st.activePl) ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#232220;border:1px solid rgba(35,34,32,0.16);'}">
                  ${p.name} <span style="opacity:0.65;font-weight:500;">(${p.items.length})</span>
                </button>
              `)}
            </div>
          </div>
          `}
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
        `}
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
