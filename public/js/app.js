// Back office « Régie d'affichage » — port fidèle de la maquette Back Office.dc.html,
// câblé sur l'API du CMS (tables SQLite préfixées sig_).
import { html, h, render, Component } from './vendor/preact-htm.js';
import {
  RUBY, INK, FUI, W, H, LIAISON_DUR, LAYOUTS, MOTIONS,
  clx, fmtTime, newTag, newSched, newPos,
  activeItems as rActiveItems, moduleDur as rModuleDur, renderModule, playable,
} from './renderer.js';
// Config du mode « continu » : source unique partagée avec le serveur.
import { continuousDefaults, normContinuous } from './continuous.js';
// Générateur de QR code autonome (pour brancher un écran en scannant).
import { qrSvg } from './vendor/qr.js';
const qrDataUri = (url) => { try { return 'data:image/svg+xml;utf8,' + encodeURIComponent(qrSvg(String(url), { scale: 5, margin: 3 })); } catch { return ''; } };
// Une valeur d'illustration est affichable telle quelle si c'est une URL, une
// donnée inline, un chemin absolu, ou un fichier à extension image. Sinon (id
// numérique, nom brut…), on n'affiche pas la balise <img> (on montre la valeur).
const imgRenderable = (v) => {
  const s = String(v || '').trim();
  if (!s) return false;
  return /^(https?:\/\/|data:image\/|\/\/|\/)/i.test(s) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i.test(s);
};

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

// Catégories de films — chaque catégorie a sa couleur (bibliothèque de films).
const FILM_CATS = [
  { id: 'standard', label: 'Standard', color: '#8D1D2C' },
  { id: 'saison', label: 'Saison', color: '#C97B4A' },
  { id: 'promo', label: 'Promo', color: '#2E6E4E' },
  { id: 'evenement', label: 'Événement', color: '#6E4A2B' },
  { id: 'archive', label: 'Archive', color: '#8A847C' },
];
const filmCatOf = (p) => FILM_CATS.find((c) => c.id === (p && p.cat)) || FILM_CATS[0];

// Pastille (i) : bulle d'aide au survol (ou au clic sur écran tactile).
const infoTip = (text) => html`
  <span class="sig-info" onClick=${(e) => { e.stopPropagation(); e.currentTarget.classList.toggle('open'); }}>
    <button type="button" aria-label="Conseils">i</button>
    <span class="sig-tip">${text}</span>
  </span>`;
const PHOTO_TIP = 'Qualité top : photo carrée d’au moins 2000 × 2000 px, idéal 2500 × 2500 — elle est affichée en très grand sur les écrans. Produit centré, fond clair et uni (ou PNG détouré). Trop grande ? Elle est réduite automatiquement. En dessous de 1500 px, elle risque de paraître floue.';

// Nombre maximum de films par moment de la journée (planning).
const MAX_PLAN_FILMS = 5;

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
    filmFilter: 'all', filmTagInput: '',
    editingStore: null, editStoreName: '',
    view: 'home', composerTab: 'lib', publishing: false, deploying: false, version: 1, dataVer: 1, hbTick: 0, toast: '',
    pubTargets: {}, pubSlot: 'Toute la journée', pubWhen: 'now', activateAt: '', pubMode: 'full',
    pubDays: [true, true, true, true, true, true, true], pubDone: null, pubFilm: null,
    override: false,
    srvUrl: '', srvIp: '', srvToken: '',
    hdUrl: '', hdUser: '', hdPass: '', hasHdPass: false, hdSaving: false,
    test: { state: 'idle', rows: [] },
    fleet: [],
    library: [],
    elementTypes: [], addPicker: false, openSec: 'items',
    catalog: { categories: [], products: [] },
    catDraft: null, catDirty: false, catSel: '', catSaving: false, langs: [], catLang: 'fr',
    pwaForm: null, pwaBusy: null, pwaResult: null,
    planWindows: [], planByStore: {}, planStores: [], planSlots: { matin: [], midi: [], aprem: [] },
    planBusy: false, planResult: null,
    planWeek: 'A', planDay: 0, planActiveWeek: 'A', planSaving: false, planSavedAt: 0,
    surpriseVideos: [], surpriseBusy: false,
    seasons: [], seasonsCurrent: [], seasonsDirty: false, seasonsBusy: false,
    wsTable: '', wsCandidates: [], wsInspected: [], wsDiag: null, mediaLib: [],
    prodMoments: [], prodMomentsCurrent: '', prodMomentsDirty: false, prodMomentsBusy: false,
    pmCollapsed: {},
    contPreview: null, contPreviewBusy: false,
    onbOpen: false, onbStore: '', onbTest: {},
    onbDone: (() => { try { return JSON.parse(localStorage.getItem('sigOnbDone') || '[]'); } catch { return []; } })(),
  };

  // ---------------------------------------------------------------- lifecycle
  async componentDidMount() {
    this._last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
    this._hb = setInterval(() => {
      // Pendant un glisser-déposer (planning), on suspend tout re-rendu : re-rendre
      // l'arbre pendant un drag natif HTML5 peut annuler le drag dans certains
      // navigateurs (la carte en cours de déplacement est re-patchée).
      if (this._dnd || this._editingField()) return;
      this.setState((s) => ({
        hbTick: s.hbTick + 1,
        fleet: s.fleet.map((st) => ({
          ...st,
          players: st.players.map((p) => ({ ...p, dataAge: p.dataAge + 1, syncAgo: p.syncAgo + 1 })),
        })),
      }));
    }, 1000);
    // Rafraîchissement des écrans, SAUF pendant une saisie : rafraîchir re-rend
    // la vue et réinitialiserait un champ contrôlé en cours d'édition (nom de
    // zone, coordonnées du magasin…). On saute le tick tant qu'un champ a le focus.
    this._poll = setInterval(() => {
      if (this._dnd || this._editingField()) return;
      this.refreshFleet();
    }, 5000);
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
    // Filet de sécurité : on force l'enregistrement si l'onglet passe en
    // arrière-plan ou se ferme avec des modifs non sauvées.
    this._flush = () => { if (this.state.dirty && !this.state.authRequired) this.save({ auto: true }); };
    this._vis = () => { if (document.visibilityState === 'hidden') this._flush(); };
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('pagehide', this._flush);
    await this.loadState();
    this.refreshFleet();
  }

  componentWillUnmount() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._hb);
    clearInterval(this._poll);
    clearTimeout(this._autoSaveT);
    document.removeEventListener('visibilitychange', this._vis);
    window.removeEventListener('pagehide', this._flush);
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
      const plan = await api('GET', '/plan').catch(() => ({ windows: [], byStore: {} }));
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
        planWindows: plan.windows || [],
        planByStore: plan.byStore || {},
        planActiveWeek: plan.activeWeek || 'A',
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
      this.loadSurprise(); // liste des vidéos « surprise » (dossier serveur)
      this.loadSeasons();  // périodes de l'année
      this.loadHdStorage(); // réglages stockage/streaming HD
      this.loadMediaLib(); // médiathèque agence (vue admin)
      this.loadProdMoments(); // périodes de vente + moment courant (Accueil)
      this.refreshFleet();  // écrans (Accueil : « prêt à diffuser »)
      if (this.activeFilm().mode === 'continu') this.loadContPreview(); // aperçu réel de la boucle
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
  // Un élément lié au catalogue (⛓) tire ses lignes EN DIRECT de la table
  // produits — noms, prix (y compris par magasin côté serveur) et actif/inactif
  // suivent instantanément, sans dépendre de l'instantané pris au moment du lien.
  resolveMod(m) {
    // Élément « surprise » : on annote le nombre de vidéos du dossier pour l'aperçu.
    if (m && m.surprise && !m.catRef && !m.productRef) {
      return { ...m, surpriseCount: (this.state.surpriseVideos || []).length };
    }
    if (!m || (!m.catRef && !m.productRef)) return m;
    const prods = this.state.catalog.products || [];
    const toItem = (p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: p.active !== false, productId: p.id });
    let items;
    if (m.catRef) items = prods.filter((p) => p.categoryId === m.catRef).map(toItem);
    else { const p = prods.find((x) => x.id === m.productRef); items = p ? [toItem(p)] : []; }
    return { ...m, items };
  }
  activeItems(m) { return rActiveItems(this.resolveMod(m)); }
  moduleDur(m) { return rModuleDur(this.resolveMod(m), this.state.secPerLine); }
  playlistMods() {
    // Film continu : la boucle est composée par le SERVEUR (buildContinuous).
    // L'aperçu affiche cette boucle réelle (récupérée via /film?film=…), pas
    // les modules manuels (vides pour un film continu).
    if (this.activeFilm().mode === 'continu') {
      const cp = this.state.contPreview;
      return (cp && cp.filmId === this.state.activePl ? cp.modules : []).filter((m) => playable(m));
    }
    return this.state.playlist.map((id) => this.getMod(id)).filter(Boolean).filter((m) => playable(this.resolveMod(m)));
  }
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

  // Vrai si l'utilisateur saisit dans un champ : on suspend alors les re-rendus
  // périodiques (aperçu, compteurs, rafraîchissement réseau) qui, sur un champ
  // contrôlé, écraseraient le texte en cours de frappe (nom de zone, coordonnées…).
  _editingField() {
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  }
  tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.state.playing && !this.state.loading && !this._dnd) {
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
      cat: p.cat || 'standard',
      tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [],
      schedule: {
        days: (p.schedule && Array.isArray(p.schedule.days) && p.schedule.days.length === 7) ? p.schedule.days.map(Boolean) : [true, true, true, true, true, true, true],
        from: (p.schedule && p.schedule.from) || '00:00',
        to: (p.schedule && p.schedule.to) || '23:59',
      },
      planDays: (Array.isArray(p.planDays) && p.planDays.length === 7) ? p.planDays.map(Boolean) : [true, true, true, true, true, true, true],
      stores: Array.isArray(p.stores) ? p.stores : [],
      mode: p.mode === 'continu' ? 'continu' : 'playlist',
      continuous: normContinuous(p.continuous),
    };
  }
  setFilmMode(mode) { this.updateFilm({ mode: mode === 'continu' ? 'continu' : 'playlist' }); if (mode === 'continu') setTimeout(() => this.loadContPreview(), 50); }
  // Aperçu fidèle d'un film continu : on récupère du SERVEUR la boucle réellement
  // composée (buildContinuous), reflétant les réglages ENREGISTRÉS. À rafraîchir
  // après un enregistrement (auto-save) ou à la demande.
  async loadContPreview() {
    const f = this.activeFilm();
    if (!f || f.mode !== 'continu') { if (this.state.contPreview) this.setState({ contPreview: null }); return; }
    const id = f.id;
    this.setState({ contPreviewBusy: true });
    try {
      const url = new URL('api/v1/film', location.href);
      url.searchParams.set('film', id);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const snap = await r.json();
      const byId = new Map((snap.modules || []).map((m) => [m.id, m]));
      const modules = (snap.playlist || []).map((mid) => byId.get(mid)).filter(Boolean);
      this.setState({ contPreview: { filmId: id, modules, meta: snap.continuousMeta || null }, contPreviewBusy: false, t: 0 });
    } catch { this.setState({ contPreviewBusy: false }); }
  }
  updateContinuous(patch) {
    const f = this.activeFilm();
    this.updateFilm({ continuous: normContinuous({ ...(f.continuous || {}), ...patch }) });
  }
  updateContRatio(key, val) {
    const f = this.activeFilm();
    const n = Math.max(0, Math.min(99, parseInt(val, 10) || 0));
    this.updateContinuous({ ratios: { ...(f.continuous || {}).ratios, [key]: n } });
  }
  setFilmCat(cat) { this.updateFilm({ cat }); }
  addFilmTag(t) {
    const tag = String(t || '').trim().replace(/,/g, '');
    if (!tag) return;
    const f = this.activeFilm();
    if ((f.tags || []).includes(tag)) return;
    this.updateFilm({ tags: [...(f.tags || []), tag] });
  }
  removeFilmTag(t) {
    const f = this.activeFilm();
    this.updateFilm({ tags: (f.tags || []).filter((x) => x !== t) });
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
    this.setState({ activePl: id, playlist: [...p.items], t: 0, editingFilm: false, contPreview: null });
    if (p.mode === 'continu') setTimeout(() => this.loadContPreview(), 50);
  }
  // Nouveau film : en mode CONTINU par défaut (le chemin simple — la boucle se
  // compose toute seule). Bascule en « Playlist » possible d'un clic si besoin.
  newFilm() {
    const id = 'pl' + uid();
    const playlists = [...this.state.playlists, this.normFilm({ id, name: 'Nouveau film', items: [], mode: 'continu' })];
    this.dirty({ playlists, activePl: id, playlist: [], editingFilm: true, editFilmName: 'Nouveau film', t: 0, filmFilter: 'all', composerTab: 'timeline', scope: 'playlist' });
  }
  dupFilm() {
    const src = this.activeFilm();
    const id = 'pl' + uid();
    const copy = this.normFilm({ ...JSON.parse(JSON.stringify(src)), id, name: `${src.name} (copie)`, items: [...src.items] });
    const playlists = [...this.state.playlists, copy];
    this.dirty({ playlists, activePl: id, playlist: [...src.items], t: 0 });
  }
  // Film d'exemple prêt à l'emploi : une boucle continue avec des réglages types,
  // à dupliquer et adapter. Sert de point de départ documenté.
  newExampleFilm() {
    const id = 'pl' + uid();
    const example = this.normFilm({
      id, name: 'Boucle continue (exemple)', items: [], cat: 'standard', mode: 'continu',
      continuous: {
        source: 'saison', perMoment: true, order: 'catalogue',
        prodDur: 6, clipDur: 12, maxItems: 12,
        ratios: { liaison: 5, produitSeul: 6, media: 3, animation: 4, surprise: 8 },
        refresh: 'moment', fallback: 'tout', exceptionFilms: [],
      },
    });
    const playlists = [...this.state.playlists, example];
    this.dirty({ playlists, activePl: id, playlist: [], t: 0, composerTab: 'timeline', scope: 'playlist', filmFilter: 'all' });
    this.showToast('Film d’exemple « Boucle continue » créé — adapte-le puis publie 🎬');
  }
  // Jours de planning d'un film DONNÉ (utilisé dans l'onglet Planning).
  toggleAnyFilmPlanDay(filmId, d) {
    const playlists = this.state.playlists.map((p) => {
      if (p.id !== filmId) return p;
      const days = [...(p.planDays || [true, true, true, true, true, true, true])];
      days[d] = !days[d];
      return { ...p, planDays: days };
    });
    this.dirty({ playlists });
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
    this.scheduleAutoSave();
  }
  // Auto-enregistrement : le brouillon (éléments + films) est sauvé tout seul
  // ~1,2 s après la dernière modification — plus besoin de penser à cliquer ✓.
  scheduleAutoSave() {
    clearTimeout(this._autoSaveT);
    this._autoSaveT = setTimeout(() => {
      if (this.state.dirty && !this.state.authRequired && !this.state.loading) this.save({ auto: true });
    }, 1200);
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
    if (mm.type === 'media') return 'media';
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
    else if (t.id === 'media') { base.name = 'Média ciblé'; base.dur = 12; base.libTag = 'promo'; base.layout = 'cover'; }
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
    if (mm.type === 'media') return 'média ciblé · moment + saison';
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

  // ---- vidéo « surprise » : pioche au hasard dans un dossier serveur --------
  toggleSurprise() {
    const on = !this.sel().surprise;
    this.setSelField('surprise', on);
    if (on) { this.setSelField('video', ''); this.loadSurprise(); }
  }
  async loadSurprise() {
    try { const r = await api('GET', '/surprise'); this.setState({ surpriseVideos: r.videos || [] }); }
    catch { /* dossier indisponible : liste vide */ }
  }
  async uploadSurprise(files) {
    const list = [...(files || [])];
    if (!list.length || this.state.surpriseBusy) return;
    this.setState({ surpriseBusy: true });
    try {
      for (const f of list) {
        if (f.size > 18 * 1024 * 1024) { this.showToast(`${f.name} : trop lourd (max 18 Mo par l'upload) — dépose-le dans public/surprise/ sur le serveur`); continue; }
        const dataUrl = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); });
        const out = await api('POST', '/surprise', { name: f.name, dataUrl });
        this.setState({ surpriseVideos: out.videos || [] });
      }
      this.showToast('Vidéo(s) surprise ajoutée(s) ✓');
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
    finally { this.setState({ surpriseBusy: false }); }
  }
  async deleteSurprise(name) {
    if (!window.confirm(`Supprimer « ${name} » du dossier surprise ?`)) return;
    try { const out = await api('DELETE', '/surprise/' + encodeURIComponent(name)); this.setState({ surpriseVideos: out.videos || [] }); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- périodes de l'année (saisons) --------------------------------------
  async loadSeasons() {
    try { const r = await api('GET', '/seasons'); this.setState({ seasons: r.seasons || [], seasonsCurrent: r.current || [], seasonsDirty: false }); }
    catch { /* indisponible : liste vide */ }
  }
  setSeasons(mut) {
    const arr = JSON.parse(JSON.stringify(this.state.seasons));
    mut(arr);
    this.setState({ seasons: arr, seasonsDirty: true });
  }
  addSeason() {
    this.setSeasons((a) => a.push({ id: 'se' + uid(), name: 'Nouvelle période', from: '', to: '', products: [], color: '#C97B4A', image: '', active: true }));
  }
  updateSeason(id, patch) { this.setSeasons((a) => { const s = a.find((x) => x.id === id); if (s) Object.assign(s, patch); }); }
  delSeason(id) { this.setSeasons((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) a.splice(i, 1); }); }
  toggleSeasonProduct(id, pid) {
    this.setSeasons((a) => { const s = a.find((x) => x.id === id); if (!s) return; const ps = s.products || []; s.products = ps.includes(pid) ? ps.filter((x) => x !== pid) : [...ps, pid]; });
  }
  async saveSeasons() {
    if (this.state.seasonsBusy) return;
    this.setState({ seasonsBusy: true });
    try {
      const r = await api('PUT', '/seasons', { seasons: this.state.seasons });
      this.setState({ seasons: r.seasons || [], seasonsCurrent: r.current || [], seasonsDirty: false, seasonsBusy: false });
      this.showToast('Périodes enregistrées ✓');
    } catch (e) { this.setState({ seasonsBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  async importSeasons() {
    if (this.state.seasonsBusy) return;
    if (this.state.seasonsDirty && !window.confirm('Des modifications non enregistrées seront perdues. Importer depuis ws_season ?')) return;
    this.setState({ seasonsBusy: true, wsCandidates: [], wsInspected: [] });
    try {
      const r = await api('POST', '/seasons/import', this.state.wsTable ? { table: this.state.wsTable } : {});
      this.setState({ seasonsBusy: false });
      if (r.ok) {
        this.setState({ seasons: r.seasons || [], seasonsCurrent: r.current || [], seasonsDirty: false, wsCandidates: [], wsInspected: [] });
        const withImg = (r.seasons || []).filter((s) => s.image).length;
        const cu = r.colsUsed ? ` · du=${r.colsUsed.from}, au=${r.colsUsed.to}${r.colsUsed.name ? `, nom=${r.colsUsed.name}` : ''}${r.colsUsed.prod ? `, produit=${r.colsUsed.prod}` : ''}${r.colsUsed.img ? `, image=${r.colsUsed.img}` : ''}` : '';
        const imgTxt = withImg ? ` · ${withImg} illustration(s)` : '';
        this.showToast(`Importé depuis « ${r.table} » : ${r.imported} période(s)${imgTxt}${cu} ✓`);
      } else { this.setState({ wsCandidates: r.candidates || [], wsInspected: r.inspected || [] }); this.showToast(`Import : ${r.error}`); }
    } catch (e) { this.setState({ seasonsBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  // Diagnostic (lecture seule) : liste les colonnes réelles de ws_season et
  // indique si une colonne d'illustration a été détectée (+ un exemple de valeur).
  async diagSeasons() {
    if (this.state.seasonsBusy) return;
    this.setState({ seasonsBusy: true, wsDiag: null });
    try {
      const r = await api('POST', '/seasons/inspect', this.state.wsTable ? { table: this.state.wsTable } : {});
      this.setState({ seasonsBusy: false, wsDiag: r });
      if (r.imageFound) this.showToast(`Colonne image détectée : ${r.imageCols.map((c) => `${c.column} (${c.table})`).join(', ')} ✓`);
      else this.showToast(r.ok ? 'Aucune colonne d\'illustration détectée dans ws_season' : `Diagnostic : ${r.error}`);
    } catch (e) { this.setState({ seasonsBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  openSeasons() { this.setState({ view: 'seasons' }); if (!this.state.seasons.length) this.loadSeasons(); this.loadMediaLib(); this.loadProdMoments(); }

  // ---- périodes de vente : produit × moment (matin/midi/aprem + exception) --
  async loadProdMoments() {
    try { const r = await api('GET', '/product-moments'); this.setState({ prodMoments: r.rows || [], prodMomentsCurrent: r.current || '', prodMomentsDirty: false }); }
    catch { /* indisponible : ignore */ }
  }
  // Bascule l'appartenance d'un produit à un moment (clic = inclus → exclu → rien).
  cycleProdMoment(productId, moment) {
    const rows = (this.state.prodMoments || []).slice();
    const i = rows.findIndex((r) => r.productId === productId && r.moment === moment);
    if (i < 0) rows.push({ productId, moment, exception: false });          // rien → inclus
    else if (!rows[i].exception) rows[i] = { ...rows[i], exception: true }; // inclus → exclu (exception)
    else rows.splice(i, 1);                                                 // exclu → rien
    this.setState({ prodMoments: rows, prodMomentsDirty: true });
  }
  prodMomentState(productId, moment) {
    const r = (this.state.prodMoments || []).find((x) => x.productId === productId && x.moment === moment);
    return r ? (r.exception ? 'excl' : 'incl') : 'none';
  }
  // ---- Accueil « prêt à diffuser » ---------------------------------------
  openHome() { this.setState({ view: 'home' }); this.loadProdMoments(); this.refreshFleet(); }
  startFirstFilm() { this.newExampleFilm(); this.setState({ view: 'composer' }); }
  // État de préparation : ce qui est prêt / ce qu'il reste à faire.
  homeReadiness() {
    const st = this.state;
    const products = st.catalog.products || [];
    const catalogOk = products.length > 0;
    const filmsReady = (st.playlists || []).filter((p) => p.mode === 'continu' || (p.items || []).length > 0);
    const players = (st.fleet || []).flatMap((s) => s.players || []);
    const onlineN = players.filter((p) => p.state && p.state !== 'offline').length;
    const dataBits = [];
    if ((st.seasons || []).length) dataBits.push('saisons');
    if ((st.prodMoments || []).length) dataBits.push('périodes de vente');
    if ((st.mediaLib || []).length) dataBits.push('médias');
    const steps = [
      { key: 'catalog', ok: catalogOk, label: 'Catalogue importé', hint: catalogOk ? `${products.length} produit(s) · ${(st.catalog.categories || []).length} catégorie(s)` : 'aucun produit — connecte ta base', cta: { label: catalogOk ? 'Voir les produits' : 'Importer le catalogue', go: () => (catalogOk ? this.openProducts() : this.setView('settings')) } },
      { key: 'film', ok: filmsReady.length > 0, label: 'Au moins un film prêt', hint: filmsReady.length ? `${filmsReady.length} film(s)` : 'aucun film avec du contenu', cta: { label: filmsReady.length ? 'Ouvrir le compositeur' : '✨ Créer mon premier film', go: () => (filmsReady.length ? this.setView('composer') : this.startFirstFilm()) } },
      { key: 'screen', ok: players.length > 0, label: 'Écran connecté', hint: players.length ? `${onlineN}/${players.length} en ligne` : 'aucun écran branché', cta: { label: 'Brancher un écran', go: () => this.openOnboarding() } },
      { key: 'data', ok: dataBits.length > 0, soft: true, label: 'Données du mode continu', hint: dataBits.length ? dataBits.join(' · ') : 'saisons · périodes de vente · médias (optionnel mais recommandé)', cta: { label: 'Remplir les périodes', go: () => this.openSeasons() } },
    ];
    return { steps, count: steps.filter((s) => s.ok).length, total: steps.length, moment: st.prodMomentsCurrent, week: st.planActiveWeek, online: onlineN, screens: players.length, film: this.activeFilm() };
  }
  // Pli/dépli des catégories dans la table produit × moment.
  togglePmCat(catId) { const c = { ...this.state.pmCollapsed }; c[catId] = !c[catId]; this.setState({ pmCollapsed: c }); }
  setAllPmCollapsed(collapsed) {
    const c = {};
    if (collapsed) for (const p of (this.state.catalog.products || [])) c[p.categoryId || '_none'] = true;
    this.setState({ pmCollapsed: c });
  }
  async saveProdMoments() {
    if (this.state.prodMomentsBusy) return;
    this.setState({ prodMomentsBusy: true });
    try {
      const r = await api('PUT', '/product-moments', { rows: this.state.prodMoments });
      this.setState({ prodMoments: r.rows || [], prodMomentsCurrent: r.current || '', prodMomentsDirty: false, prodMomentsBusy: false });
      this.showToast('Périodes de vente enregistrées ✓');
    } catch (e) { this.setState({ prodMomentsBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- médiathèque agence (vue admin dans la régie) -----------------------
  async loadMediaLib() {
    try { const r = await api('GET', '/media'); this.setState({ mediaLib: r.media || [] }); }
    catch { /* réservé admin : ignore si indisponible */ }
  }
  async delMediaLib(id, name) {
    if (!window.confirm(`Supprimer « ${name} » du serveur ?`)) return;
    try { const r = await api('DELETE', '/media/' + encodeURIComponent(id)); this.setState({ mediaLib: r.media || [] }); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- stockage / streaming HD (réglages) ---------------------------------
  async loadHdStorage() {
    try { const r = await api('GET', '/hd-storage'); this.setState({ hdUrl: r.hdUrl || '', hdUser: r.hdUser || '', hasHdPass: !!r.hasHdPass }); }
    catch { /* indisponible */ }
  }
  async saveHdStorage() {
    if (this.state.hdSaving) return;
    this.setState({ hdSaving: true });
    try {
      await api('POST', '/settings', { hdUrl: this.state.hdUrl, hdUser: this.state.hdUser, ...(this.state.hdPass ? { hdPass: this.state.hdPass } : {}) });
      this.setState({ hdSaving: false, hasHdPass: this.state.hasHdPass || !!this.state.hdPass, hdPass: '' });
      this.showToast('Stockage HD enregistré ✓');
    } catch (e) { this.setState({ hdSaving: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- table produits (vue Produits) --------------------------------------
  openProducts() {
    const d = this.state.catDraft || JSON.parse(JSON.stringify(this.state.catalog));
    // Sélectionne de préférence une catégorie active avec des produits actifs.
    const hasActive = (cid) => d.products.some((p) => p.categoryId === cid && p.active !== false);
    const visible = d.categories.filter((c) => c.active !== false && hasActive(c.id));
    const sel = d.categories.some((c) => c.id === this.state.catSel)
      ? this.state.catSel
      : ((visible[0] || d.categories[0] || {}).id || '');
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
  save = async (opts = {}) => {
    if (this._saving) { this._saveAgain = true; return; }
    this._saving = true;
    clearTimeout(this._autoSaveT);
    try {
      await api('PUT', '/draft', this.draftBody());
      this.setState({ dirty: false, saved: true });
      if (!opts.auto) this.showToast('Enregistré ✓');
      // L'aperçu d'un film continu reflète les réglages ENREGISTRÉS : on le
      // rafraîchit dès que l'enregistrement est passé côté serveur.
      if (this.activeFilm().mode === 'continu') this.loadContPreview();
    } catch (e) {
      this.showToast(e.status === 401
        ? 'Session expirée — recharge la page (F5) et reconnecte-toi, puis réessaie'
        : `Échec de l'enregistrement : ${e.message}`);
    } finally {
      this._saving = false;
      // Une modif est survenue pendant l'enregistrement : on repart.
      if (this._saveAgain) { this._saveAgain = false; this.scheduleAutoSave(); }
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

  filmUrl({ w, h: hh, fit, store, film, group } = {}) {
    const u = new URL('film', location.href);
    if (group) u.searchParams.set('group', group);
    else if (film) u.searchParams.set('film', film);
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
        ...(patch.address != null ? { address: patch.address } : {}),
        ...(patch.hours != null ? { hours: patch.hours } : {}),
        ...(patch.phone != null ? { phone: patch.phone } : {}),
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

  // ---- groupes d'écrans (zones à filtre de catégories) --------------------
  async addGroup(storeId) {
    try { await api('POST', `/stores/${storeId}/groups`, { name: 'Nouvelle zone', screens: 1, size: 55, orient: 'portrait', cats: [] }); await this.refreshFleet(); this.showToast('Zone d\'écrans ajoutée ✓'); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async saveGroup(id, patch) {
    try { await api('POST', `/groups/${id}`, patch); await this.refreshFleet(); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async delGroup(id) {
    if (!window.confirm('Supprimer cette zone ? Les écrans rattachés repassent au film du magasin.')) return;
    try { await api('DELETE', `/groups/${id}`); await this.refreshFleet(); this.showToast('Zone supprimée ✓'); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async setPlayerGroup(playerId, groupId) {
    try { await api('POST', `/players/${playerId}/group`, { groupId }); await this.refreshFleet(); this.showToast(groupId ? 'Écran rattaché à la zone ✓' : 'Écran remis au film du magasin ✓'); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- planning hebdo (magasins × semaine A–E × jour × moments) -----------
  // Contenu d'une cellule (magasin × semaine × jour) → { matin, midi, aprem }.
  planCell(store, week, day) {
    const c = (((this.state.planByStore || {})[store] || {})[week] || {})[day] || {};
    return { matin: [...(c.matin || [])], midi: [...(c.midi || [])], aprem: [...(c.aprem || [])] };
  }
  // Recharge le tampon d'édition depuis le 1er magasin sélectionné.
  syncPlanSlots() {
    const s = this.state.planStores[0];
    const slots = s ? this.planCell(s, this.state.planWeek, this.state.planDay) : { matin: [], midi: [], aprem: [] };
    this.setState({ planSlots: slots });
  }
  togglePlanStore(id) {
    const cur = this.state.planStores;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.setState({ planStores: next, planResult: null }, () => this.syncPlanSlots());
  }
  setPlanWeek(w) { this.setState({ planWeek: w, planResult: null }, () => this.syncPlanSlots()); }
  setPlanDay(d) { this.setState({ planDay: d, planResult: null }, () => this.syncPlanSlots()); }
  addPlanFilm(moment, filmId) {
    const cur = this.state.planSlots[moment] || [];
    if (cur.includes(filmId)) return; // pas de doublon dans un même moment
    if (cur.length >= MAX_PLAN_FILMS) { this.showToast(`${MAX_PLAN_FILMS} films maximum par moment`); return; }
    if (!this.state.planStores.length) { this.showToast('Sélectionne d’abord un magasin'); return; }
    this.setState({ planSlots: { ...this.state.planSlots, [moment]: [...cur, filmId] } }, () => this.scheduleSavePlan());
  }
  removePlanFilm(moment, idx) {
    const cur = this.state.planSlots[moment] || [];
    this.setState({ planSlots: { ...this.state.planSlots, [moment]: cur.filter((_, i) => i !== idx) } }, () => this.scheduleSavePlan());
  }
  setPlanWindow(id, field, value) {
    this.setState({ planWindows: this.state.planWindows.map((w) => (w.id === id ? { ...w, [field]: value } : w)) }, () => this.scheduleSavePlan());
  }
  // Enregistrement automatique du jour édité (débattu), pour tous les magasins choisis.
  scheduleSavePlan() {
    clearTimeout(this._planT);
    this._planT = setTimeout(() => this.savePlanNow(), 600);
  }
  async savePlanNow() {
    const st = this.state;
    if (!st.planStores.length) return;
    this.setState({ planSaving: true });
    try {
      const out = await api('POST', '/plan', { stores: st.planStores, week: st.planWeek, day: st.planDay, slots: st.planSlots, windows: st.planWindows });
      this.setState({ planByStore: out.byStore || {}, planActiveWeek: out.activeWeek || st.planActiveWeek, planSaving: false, planSavedAt: Date.now() });
    } catch (e) {
      this.setState({ planSaving: false });
      this.showToast(e.status === 401 ? 'Session expirée — recharge la page (F5)' : `Erreur : ${e.message}`);
    }
  }
  async activatePlanWeek() {
    try {
      const out = await api('POST', '/plan/active', { week: this.state.planWeek });
      this.setState({ planActiveWeek: out.activeWeek, planByStore: out.byStore || this.state.planByStore });
      this.showToast(`Semaine ${this.state.planWeek} activée — c'est elle qui est diffusée ✓`);
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async duplicatePlanWeek(to) {
    const st = this.state;
    if (!st.planStores.length) { this.showToast('Sélectionne au moins un magasin'); return; }
    if (!to || to === st.planWeek) return;
    if (!window.confirm(`Copier la semaine ${st.planWeek} vers la semaine ${to} ?\nLe contenu de la semaine ${to} (magasins sélectionnés) sera remplacé.`)) return;
    try {
      const out = await api('POST', '/plan/duplicate', { stores: st.planStores, from: st.planWeek, to });
      this.setState({ planByStore: out.byStore || {} }, () => this.syncPlanSlots());
      this.showToast(`Semaine ${st.planWeek} copiée vers ${to} ✓`);
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- rapport de diffusion (lien public, partageable) --------------------
  openReport() {
    const link = new URL('report', location.href).toString();
    try { window.open(link, '_blank', 'noopener'); } catch { /* popup bloqué */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(
        () => this.showToast('Rapport ouvert — lien copié ✓'),
        () => this.showToast('Rapport ouvert dans un nouvel onglet'),
      );
    } else {
      this.showToast('Rapport ouvert dans un nouvel onglet');
    }
  }

  // ---- guide de mise en route (onboarding par magasin) --------------------
  openOnboarding() {
    const active = this.state.fleet.filter((s) => s.active !== false);
    const first = this.state.onbStore && active.some((s) => s.id === this.state.onbStore)
      ? this.state.onbStore : ((active[0] || {}).id || '');
    this.setState({ onbOpen: true, onbStore: first });
  }
  onbMarkDone(id, done) {
    const set = new Set(this.state.onbDone);
    if (done) set.add(id); else set.delete(id);
    const arr = [...set];
    try { localStorage.setItem('sigOnbDone', JSON.stringify(arr)); } catch { /* stockage indispo */ }
    this.setState({ onbDone: arr });
  }
  async onbTestStore(id) {
    this.setState({ onbTest: { ...this.state.onbTest, [id]: { state: 'testing' } } });
    try {
      const j = await api('GET', `/film?store=${encodeURIComponent(id)}`);
      const res = {
        state: 'ok',
        name: j.playlistName || 'Film',
        px: j.format ? j.format.px : '—',
        modules: Array.isArray(j.modules) ? j.modules.length : 0,
        plan: j.plan ? `${j.plan.moment}${j.plan.films > 1 ? ` · ${j.plan.films} films` : ''}` : '',
        draft: !!j.draft,
      };
      this.setState({ onbTest: { ...this.state.onbTest, [id]: res } });
    } catch (e) {
      this.setState({ onbTest: { ...this.state.onbTest, [id]: { state: 'err', error: String(e.message || e) } } });
    }
  }
  // Débit conseillé selon la résolution (surtout pour les films avec vidéo).
  bandwidthNote(fmt) {
    const w = (fmt && fmt.w) || 3840;
    const is4k = w >= 3840;
    return {
      is4k,
      reco: is4k
        ? 'niveau 4K : ~15–25 Mbps en H.265/HEVC, ~25–50 Mbps en H.264 en lecture vidéo continue'
        : 'niveau 1080p : ~5–10 Mbps en lecture vidéo continue',
    };
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
      ? renderModule(h, this.resolveMod(m), lt, opts)
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
    const isMedia = m.type === 'media';
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
      const skip = !playable(this.resolveMod(mm));
      const dur = skip ? 0 : this.moduleDur(mm);
      const startT = cumT;
      cumT += dur;
      const isLi = mm.type === 'liaison';
      const playingHere = !skip && st.scope === 'playlist' && st.t >= startT && st.t < startT + dur;
      return {
        i, name: mm.name, order: i + 1,
        durLabel: skip ? '⚠ vide — sauté' : `${(Math.round(dur * 10) / 10).toString().replace('.', ',')} s`,
        typeIcon: (this.elementTypeOf(mm) || {}).icon || (isLi ? '⧉' : '▤'),
        width: skip ? 104 : Math.max(104, Math.round(dur * 14)),
        blockStyle: `flex:0 0 auto;display:flex;flex-direction:column;justify-content:space-between;gap:4px;padding:9px 11px;border-radius:10px;cursor:grab;opacity:${skip ? 0.55 : 1};background:${playingHere ? '#8D1D2C' : '#fff'};color:${playingHere ? '#fff' : '#232220'};border:1px ${skip ? 'dashed rgba(141,29,44,0.5)' : `solid ${playingHere ? '#8D1D2C' : 'rgba(35,34,32,0.12)'}`};box-shadow:0 2px 6px rgba(0,0,0,0.05);`,
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

    // Catégorie + tags du film actif (rangement dans la bibliothèque de films).
    const filmCatVals = FILM_CATS.map((c) => {
      const on = filmCatOf(filmActive).id === c.id;
      return {
        label: c.label,
        pick: () => this.setFilmCat(c.id),
        style: `display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12px;font-weight:600;border-radius:999px;cursor:pointer;${on ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}`,
        dotStyle: `width:7px;height:7px;border-radius:50%;background:${on ? '#fff' : c.color};`,
      };
    });
    const filmTagVals = (filmActive.tags || []).map((t) => ({
      label: t,
      remove: () => this.removeFilmTag(t),
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
    const grpCats = (st.catalog.categories || []).map((c) => ({ id: c.id, name: c.name }));
    const grpCatName = new Map(grpCats.map((c) => [c.id, c.name]));
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
      address: s.address || '', hours: s.hours || '', phone: s.phone || '',
      setAddress: (e) => this.saveStore(s.id, { address: e.target.value }),
      setHours: (e) => this.saveStore(s.id, { hours: e.target.value }),
      setPhone: (e) => this.saveStore(s.id, { phone: e.target.value }),
      groups: (s.groups || []).map((g) => ({
        id: g.id, name: g.name, fmt: g.format || { screens: 1, size: 55, orient: 'portrait', label: '1 × 55″ portrait', px: '2160 × 3840 px' },
        catChips: (g.cats || []).map((cid) => ({ id: cid, name: grpCatName.get(cid) || cid, remove: () => this.saveGroup(g.id, { cats: (g.cats || []).filter((x) => x !== cid) }) })),
        addableCats: grpCats.filter((c) => !(g.cats || []).includes(c.id)),
        onName: (e) => this.saveGroup(g.id, { name: e.target.value }),
        onScreens: (e) => this.saveGroup(g.id, { screens: e.target.value }),
        onSize: (e) => this.saveGroup(g.id, { size: e.target.value }),
        onOrient: (e) => this.saveGroup(g.id, { orient: e.target.value }),
        onAddCat: (e) => { const cid = e.target.value; e.target.value = ''; if (cid) this.saveGroup(g.id, { cats: [...(g.cats || []), cid] }); },
        previewUrl: this.filmUrl({ group: g.id }),
        copyPreview: () => this.copyLink(this.filmUrl({ group: g.id })),
        del: () => this.delGroup(g.id),
      })),
      addGroup: () => this.addGroup(s.id),
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
          groupId: p.groupId || '',
          setGroup: (e) => this.setPlayerGroup(p.id, e.target.value),
          groupOptions: (s.groups || []).map((g) => ({ id: g.id, name: g.name })),
        };
      }),
    }));

    // ---- vue table produits ----
    const cd = st.catDraft || st.catalog;
    // Colonnes de prix : seulement les magasins actifs (une boutique PWA
    // inactive, ex. active=0, ne s'affiche pas).
    const storeCols = st.fleet.filter((s) => s.active !== false).map((s) => ({ id: s.id, label: s.store }));
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
    // On ne liste que les catégories AVEC au moins un produit actif — plus la
    // catégorie sélectionnée (pour pouvoir la remplir juste après l'avoir créée).
    const catHasActive = (cid) => cd.products.some((p) => p.categoryId === cid && p.active !== false);
    const prodCats = cd.categories.filter((c) => c.active !== false && (catHasActive(c.id) || c.id === st.catSel)).map((c) => {
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
      id: p.id, price: p.price, img: p.img, active: p.active !== false, unavailable: !!p.unavailable,
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
      toggleUnavailable: () => this.setCat((d) => { const x = d.products.find((y) => y.id === p.id); if (x) x.unavailable = !x.unavailable; }),
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

    // ---- vue planning (magasins × films × moments) ----
    const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const PWEEKS = ['A', 'B', 'C', 'D', 'E'];
    const cellFilled = (cell) => ['matin', 'midi', 'aprem'].reduce((n, mm) => n + ((cell && cell[mm] || []).length), 0);
    const planStoreChips = st.fleet.filter((s) => s.active !== false).map((s) => {
      const on = st.planStores.includes(s.id);
      const wk = ((st.planByStore[s.id] || {})[st.planWeek]) || {};
      const nDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => cellFilled(wk[d])).length;
      return {
        label: s.store, sub: nDays ? `sem. ${st.planWeek} : ${nDays}/7 jour(s)` : `sem. ${st.planWeek} : vide`,
        toggle: () => this.togglePlanStore(s.id),
        style: `display:flex;flex-direction:column;gap:2px;align-items:flex-start;padding:11px 15px;border-radius:12px;cursor:pointer;text-align:left;background:${on ? 'rgba(141,29,44,0.06)' : '#FBF8F2'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
        badge: on ? '✓' : '',
      };
    });
    // Onglets semaine A–E (celle diffusée porte un point vert).
    const planWeekTabs = PWEEKS.map((wk) => ({
      label: wk, active: wk === st.planWeek, playing: wk === st.planActiveWeek,
      pick: () => this.setPlanWeek(wk),
    }));
    // Onglets jours (avec compteur de films pour le 1er magasin sélectionné).
    const s0 = st.planStores[0];
    const planDayTabs = DAY_SHORT.map((lbl, d) => {
      const cell = s0 ? (((st.planByStore[s0] || {})[st.planWeek] || {})[d] || {}) : {};
      return { label: lbl, long: DAY_LONG[d], active: d === st.planDay, count: cellFilled(cell), pick: () => this.setPlanDay(d) };
    });
    const filmById = (id) => st.playlists.find((p) => p.id === id);
    // Matrice « jours de planning » : quels films proposés quel jour (déplacée
    // du formulaire du film vers l'onglet Planning, là où elle sert).
    const planDayMatrix = st.playlists.map((p) => ({
      id: p.id, name: p.name, mode: p.mode,
      days: DAY_SHORT.map((lbl, d) => ({
        label: lbl, on: (p.planDays || [true, true, true, true, true, true, true])[d] !== false,
        toggle: () => this.toggleAnyFilmPlanDay(p.id, d),
      })),
    }));
    const planCols = (st.planWindows.length ? st.planWindows : [
      { id: 'matin', label: 'Matin', from: '06:00', to: '11:00' },
      { id: 'midi', label: 'Midi', from: '11:00', to: '15:00' },
      { id: 'aprem', label: 'Après-midi', from: '15:00', to: '20:00' },
    ]).map((w) => {
      const ids = st.planSlots[w.id] || [];
      const films = ids.map((fid) => {
        const f = filmById(fid);
        const c = f ? filmCatOf(f) : null;
        return f ? { name: f.name, count: f.items.length, color: c.color } : { name: '(film supprimé)', count: 0, color: '#8A847C' };
      });
      const full = ids.length >= MAX_PLAN_FILMS;
      const addFilms = st.playlists.filter((pl) => !ids.includes(pl.id) && (pl.planDays || [1, 1, 1, 1, 1, 1, 1])[st.planDay] !== false).map((pl) => ({ id: pl.id, name: pl.name }));
      return {
        id: w.id, label: w.label, from: w.from, to: w.to,
        count: ids.length, max: MAX_PLAN_FILMS, full,
        addFilms,
        onAdd: (e) => { const v = e.target.value; e.target.value = ''; if (v) this.addPlanFilm(w.id, v); },
        onFrom: (e) => this.setPlanWindow(w.id, 'from', e.target.value),
        onTo: (e) => this.setPlanWindow(w.id, 'to', e.target.value),
        films: films.map((f, i) => ({ ...f, order: i + 1, remove: () => this.removePlanFilm(w.id, i) })),
        onDragOver: (e) => { if (full) return; e.preventDefault(); e.currentTarget.classList.add('drag-over'); },
        onDragLeave: (e) => e.currentTarget.classList.remove('drag-over'),
        onDrop: (e) => {
          e.preventDefault(); e.currentTarget.classList.remove('drag-over');
          this._dnd = false; // filet : on relâche le gel même si dragend manque
          const d = e.dataTransfer.getData('text/plain');
          if (d.startsWith('film:')) this.addPlanFilm(w.id, d.slice(5));
        },
      };
    });
    // Bibliothèque de films filtrée sur les « jours de planning » du jour choisi.
    const planFilmCards = st.playlists.filter((p) => (p.planDays || [1, 1, 1, 1, 1, 1, 1])[st.planDay] !== false).map((p) => {
      const c = filmCatOf(p);
      const pd = p.planDays || [true, true, true, true, true, true, true];
      const specific = !pd.every(Boolean);
      return {
        name: p.name, count: p.items.length, color: c.color, catLabel: c.label,
        tags: (p.tags || []).slice(0, 3),
        dayBadge: specific ? DAY_SHORT.filter((_, i) => pd[i]).join('·') : '',
        onDragStart: (e) => { this._dnd = true; e.dataTransfer.setData('text/plain', 'film:' + p.id); e.dataTransfer.effectAllowed = 'copy'; },
        onDragEnd: () => { this._dnd = false; },
      };
    });
    const planDupTargets = PWEEKS.filter((w) => w !== st.planWeek);
    const planStoreLinks = st.planStores.map((id) => ({ store: (st.fleet.find((f) => f.id === id) || {}).store || id, url: this.filmUrl({ store: id }) }));

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
      } else if (st.view === 'seasons') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Périodes de l\'année', null, false));
        arr.push(crumb(`${(st.seasons || []).length} période(s)${st.seasonsDirty ? ' · non enregistrées' : ''}`, null, true));
      } else if (st.view === 'planning') {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb('Planning hebdo', null, false));
        arr.push(crumb(`Semaine ${st.planWeek} · ${st.planStores.length} magasin(s)`, null, true));
      } else {
        arr.push(crumb('Compositeur', () => this.setView('composer'), false));
        arr.push(crumb(`Film : ${this.activeFilm().name}`, null, false));
        arr.push(crumb(`${m.name}${isLia ? ' (liaison)' : ''}`, null, true));
      }
      return arr;
    })();

    // ---- périodes de l'année (saisons) ----
    const seasonCurSet = new Set(st.seasonsCurrent || []);
    const seasonProdOpts = (st.catalog.products || []).map((p) => ({ id: p.id, name: p.name }));
    const prodName = (pid) => (seasonProdOpts.find((p) => p.id === pid) || {}).name || pid;
    const seasonRows = (st.seasons || []).map((s) => ({
      id: s.id, name: s.name, from: s.from, to: s.to, color: s.color,
      image: s.image || '', imageOk: imgRenderable(s.image),
      current: seasonCurSet.has(s.id),
      products: (s.products || []).map((pid) => ({ id: pid, name: prodName(pid), remove: () => this.toggleSeasonProduct(s.id, pid) })),
      addable: seasonProdOpts.filter((p) => !(s.products || []).includes(p.id)),
      onName: (e) => this.updateSeason(s.id, { name: e.target.value }),
      onFrom: (e) => this.updateSeason(s.id, { from: e.target.value }),
      onTo: (e) => this.updateSeason(s.id, { to: e.target.value }),
      onImage: (e) => this.updateSeason(s.id, { image: e.target.value }),
      onAddProduct: (e) => { const pid = e.target.value; e.target.value = ''; if (pid) this.toggleSeasonProduct(s.id, pid); },
      del: () => this.delSeason(s.id),
    }));
    // Périodes de vente : produit × moment (matin/midi/aprem + exception),
    // regroupé par catégorie (repliable).
    const saleMoments = [{ id: 'matin', label: 'Matin' }, { id: 'midi', label: 'Midi' }, { id: 'aprem', label: 'Après-midi' }];
    const pmProdRow = (p) => ({
      id: p.id, name: p.name, active: p.active !== false,
      cells: saleMoments.map((mo) => ({ moment: mo.id, state: this.prodMomentState(p.id, mo.id), toggle: () => this.cycleProdMoment(p.id, mo.id) })),
    });
    const pmByCat = new Map();
    for (const p of (st.catalog.products || [])) {
      const gk = p.categoryId || '_none';
      if (!pmByCat.has(gk)) pmByCat.set(gk, []);
      pmByCat.get(gk).push(pmProdRow(p));
    }
    const pmCatName = new Map((st.catalog.categories || []).map((c) => [c.id, c.name]));
    const pmCatOf = (gk, products) => ({
      id: gk, name: gk === '_none' ? 'Sans catégorie' : (pmCatName.get(gk) || gk),
      count: products.length, collapsed: !!st.pmCollapsed[gk],
      toggle: () => this.togglePmCat(gk), products,
    });
    const prodMomentCats = [];
    const pmSeen = new Set();
    for (const c of (st.catalog.categories || [])) {
      const products = pmByCat.get(c.id);
      if (products && products.length) { prodMomentCats.push(pmCatOf(c.id, products)); pmSeen.add(c.id); }
    }
    for (const [gk, products] of pmByCat) if (!pmSeen.has(gk)) prodMomentCats.push(pmCatOf(gk, products));
    const pmAllCollapsed = prodMomentCats.length > 0 && prodMomentCats.every((c) => c.collapsed);

    // ---- médiathèque agence (vue admin) ----
    const MOMENT_LBL = { matin: 'Matin', midi: 'Midi', aprem: 'Après-midi', all: 'Toute la journée' };
    const mediaByMoment = { matin: 0, midi: 0, aprem: 0, all: 0 };
    for (const mm of (st.mediaLib || [])) mediaByMoment[mm.moment] = (mediaByMoment[mm.moment] || 0) + 1;
    const mediaOverview = {
      total: (st.mediaLib || []).length,
      photos: (st.mediaLib || []).filter((mm) => mm.kind === 'photo').length,
      videos: (st.mediaLib || []).filter((mm) => mm.kind === 'film').length,
      present: (st.mediaLib || []).filter((mm) => mm.present).length,
      byMoment: mediaByMoment,
      rows: (st.mediaLib || []).map((mm) => ({
        id: mm.id, filename: mm.filename, kind: mm.kind, present: mm.present, size: mm.size,
        moment: MOMENT_LBL[mm.moment] || mm.moment,
        product: (seasonProdOpts.find((p) => p.id === mm.productId) || {}).name || '',
        season: ((st.seasons || []).find((s) => s.id === mm.seasonId) || {}).name || '',
        del: () => this.delMediaLib(mm.id, mm.filename),
      })),
    };

    const subTab = 'padding:8px 18px;font-size:13px;font-weight:600;border:none;border-radius:999px;cursor:pointer;';
    const hdrRound = 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;flex:0 0 auto;';
    return {
      playlist, library, layoutOptions, motionGroups, items, days, posFields, timeSlots, crumbs,
      timelineBlocks, timelineTotal, timelineEndDrop, libCards, libTagChips, libEmptyMsg, pubDaysVals,
      prodCats, prodRows, storeCols, prodSelCat, langChips, isBaseLang,
      seasonRows, seasonsDirty: st.seasonsDirty, seasonsBusy: st.seasonsBusy, seasonsCount: (st.seasons || []).length,
      seasonsCurrentCount: (st.seasonsCurrent || []).length,
      addSeason: () => this.addSeason(), saveSeasons: () => this.saveSeasons(), importSeasons: () => this.importSeasons(),
      diagSeasons: () => this.diagSeasons(), wsDiag: st.wsDiag,
      wsTable: st.wsTable, onWsTable: (e) => this.setState({ wsTable: e.target.value }),
      wsCandidates: st.wsCandidates || [], useWsCandidate: (t) => this.setState({ wsTable: t }),
      wsInspected: st.wsInspected || [],
      saleMoments, prodMomentCats, prodMomentsCurrent: st.prodMomentsCurrent,
      prodMomentsDirty: st.prodMomentsDirty, prodMomentsBusy: st.prodMomentsBusy,
      saveProdMoments: () => this.saveProdMoments(),
      pmAllCollapsed, collapseAllPm: () => this.setAllPmCollapsed(true), expandAllPm: () => this.setAllPmCollapsed(false),
      mediaOverview, refreshMediaLib: () => this.loadMediaLib(),
      contPreviewBusy: st.contPreviewBusy,
      contPreviewMeta: (st.contPreview && st.contPreview.filmId === st.activePl) ? st.contPreview.meta : null,
      agencyUrl: new URL('agence', location.href).toString(),
      planStoreChips, planCols, planFilmCards, planWeekTabs, planDayTabs, planDupTargets, planStoreLinks, planDayMatrix,
      planWeek: st.planWeek, planDay: st.planDay, planDayName: DAY_LONG[st.planDay],
      planActiveWeek: st.planActiveWeek, planWeekActive: st.planWeek === st.planActiveWeek,
      planSaving: st.planSaving, planHasStores: st.planStores.length > 0,
      activatePlanWeek: () => this.activatePlanWeek(),
      duplicatePlanWeek: (to) => this.duplicatePlanWeek(to),
      copyLink: (u) => this.copyLink(u),
      catDirty: st.catDirty, catSaving: st.catSaving,
      addProdCat: () => this.addProdCat(),
      addProd: () => this.addProd(),
      saveCat: () => this.saveCatalog(),
      filmDaysVals, filmSlotVals, filmStoreVals, filmAllStores, filmSchedSummary,
      filmCatVals, filmTagVals, filmTagInput: st.filmTagInput,
      onFilmTagInput: (e) => this.setState({ filmTagInput: e.target.value }),
      onFilmTagKey: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); this.addFilmTag(st.filmTagInput); this.setState({ filmTagInput: '' }); } },
      addFilmTagNow: () => { this.addFilmTag(st.filmTagInput); this.setState({ filmTagInput: '' }); },
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
      isProductsView: st.view === 'products', isPlanningView: st.view === 'planning',
      isSeasonsView: st.view === 'seasons', isHomeView: st.view === 'home',
      setViewHome: () => this.openHome(),
      tabHomeStyle: stTab + (st.view === 'home' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      setViewComposer: () => this.setView('composer'),
      setViewFleet: () => this.setView('fleet'),
      setViewSettings: () => this.setView('settings'),
      setViewProducts: () => this.openProducts(),
      setViewPlanning: () => this.setView('planning'),
      setViewSeasons: () => this.openSeasons(),
      tabProductsStyle: stTab + (st.view === 'products' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabPlanningStyle: stTab + (st.view === 'planning' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
      tabSeasonsStyle: stTab + (st.view === 'seasons' ? 'background:#fff;color:#232220;box-shadow:0 1px 2px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'),
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
      isCategory: isCat, isLiaison: isLia, isProduit, isFilmEl, isAnim, isMedia,
      mediaAgencyUrl: new URL('agence', location.href).toString(),
      // filtre filigrane / logo (surtout sur les photos)
      hasWatermark: isCat || isProduit || isMedia || isAnim,
      watermark: m.watermark || 'none',
      watermarkSummary: ({ none: 'aucun', filigrane: 'filigrane', logo: 'logo', nouveau: '« Nouveau »' })[m.watermark || 'none'],
      watermarkOpts: [
        { id: 'none', label: 'Aucun' }, { id: 'filigrane', label: 'Filigrane logo' },
        { id: 'logo', label: 'Logo (coin)' }, { id: 'nouveau', label: 'Ruban « Nouveau »' },
      ].map((o) => ({ ...o, active: (m.watermark || 'none') === o.id, pick: () => this.setSelField('watermark', o.id) })),
      hasSub: isLia || isAnim || isProduit,
      hasDur: isProduit || isFilmEl || isAnim || isMedia,
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
      // Lignes affichées : résolues EN DIRECT depuis la table produits.
      linkedRows: this.resolveMod(m).items.map((it) => ({ name: it.name, price: it.price, active: it.active !== false })),
      // Seules les catégories actives AVEC au moins un produit actif sont proposées
      // (la catégorie actuellement liée reste listée pour ne pas casser l'affichage).
      catOptions: (() => {
        const nAct = (cid) => st.catalog.products.filter((p) => p.categoryId === cid && p.active !== false).length;
        const ok = st.catalog.categories.filter((c) => c.active !== false && nAct(c.id) > 0);
        const cur = m.catRef && !ok.some((c) => c.id === m.catRef)
          ? st.catalog.categories.filter((c) => c.id === m.catRef) : [];
        return [...ok, ...cur].map((c) => ({
          id: c.id,
          label: `${c.name} (${nAct(c.id)} produit(s) actif(s))${c.active === false ? ' · inactive' : ''}${nAct(c.id) === 0 ? ' · vide' : ''}`,
        }));
      })(),
      curCatRef: m.catRef || '',
      onLinkCat: (e) => { if (e.target.value) this.linkCat(e.target.value); },
      doUnlinkCat: () => this.unlinkCat(),
      goProducts: () => this.openProducts(),
      // -- produit à la une --
      productOptions: st.catalog.products
        .filter((p) => p.active !== false || p.id === m.productRef)
        .map((p) => ({
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
      // -- film en mode « surprise » (dossier serveur, piochée au hasard) --
      isSurprise: !!m.surprise,
      toggleSurprise: () => this.toggleSurprise(),
      surpriseList: st.surpriseVideos || [],
      surpriseBusy: st.surpriseBusy,
      onSurpriseFiles: (e) => { this.uploadSurprise(e.target.files); e.target.value = ''; },
      refreshSurprise: () => this.loadSurprise(),
      delSurprise: (name) => this.deleteSurprise(name),
      // -- résumés des volets repliés --
      layoutSummary: ((layoutList.find((o) => o.id === m.layout) || {}).label) || m.layout || '',
      motionSummary: ({ m1: 'Doux', m2: 'Ample', m3: 'Pulsé', none: 'Aucun' })[m.motion || 'm1'] || '',
      posSummary: (() => {
        const p0 = m.pos || {};
        const changed = ['titleY', 'listX', 'listY', 'illoX', 'illoY'].some((k) => p0[k]) || (p0.illoScale && p0.illoScale !== 1);
        return changed ? 'ajustées' : 'par défaut';
      })(),
      itemsSummary: m.catRef
        ? `⛓ ${(st.catalog.categories.find((c) => c.id === m.catRef) || {}).name || m.catRef} · ${(this.resolveMod(m).items || []).length} ligne(s)`
        : `${(m.items || []).length} produit(s)`,
      tagSummary: (m.tag && m.tag.enabled) ? `activé · ${m.tag.label || 'macaron'}` : 'désactivé',
      videoSummary: m.surprise ? `surprise · ${(st.surpriseVideos || []).length} vidéo(s)` : (m.video ? `importée · ${m.dur || 10} s` : 'aucune vidéo'),
      produitSummary: ((this.resolveMod(m).items || [])[0] || {}).name || 'à choisir',
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
      hdUrl: st.hdUrl, hdUser: st.hdUser, hdPass: st.hdPass, hasHdPass: st.hasHdPass, hdSaving: st.hdSaving,
      onHdUrl: (e) => this.setState({ hdUrl: e.target.value }),
      onHdUser: (e) => this.setState({ hdUser: e.target.value }),
      onHdPass: (e) => this.setState({ hdPass: e.target.value }),
      saveHd: () => this.saveHdStorage(),
      agencyUrl: new URL('agence', location.href).toString(),
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
      saved: st.saved, dirty: st.dirty,
      saveLabel: st.dirty ? 'Enregistrer' : 'Enregistré',
      saveStyle: `padding:9px 20px;font-size:13px;font-weight:600;letter-spacing:0.01em;border-radius:999px;cursor:${st.dirty ? 'pointer' : 'default'};${st.dirty ? 'background:#6E4A2B;color:#fff;border:1px solid #6E4A2B;box-shadow:0 2px 8px rgba(110,74,43,0.25);' : 'background:transparent;color:#8A847C;border:1px solid rgba(35,34,32,0.14);'}`,
      // Bandeau : icônes rondes + vignettes, palette gris/rubis/abricot/cuivre.
      saveIconStyle: `${hdrRound}${st.dirty ? 'background:#6E4A2B;color:#fff;border:1px solid #6E4A2B;box-shadow:0 2px 10px rgba(110,74,43,0.35);' : 'background:transparent;color:#2E7D32;border:1px solid rgba(46,125,50,0.35);'}`,
      saveTip: st.dirty ? 'Enregistrement automatique en cours… (clique pour forcer)' : 'Tout est enregistré automatiquement',
      pricesIconStyle: `${hdrRound}background:rgba(201,123,74,0.14);color:#A25C2E;border:1px solid rgba(201,123,74,0.5);`,
      overrideIconStyle: `${hdrRound}${st.override ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;box-shadow:0 2px 10px rgba(141,29,44,0.35);' : 'background:transparent;color:#5B564E;border:1px solid rgba(35,34,32,0.18);'}`,
      overrideTip: st.override ? 'Diffusion flash ACTIVE — cliquer pour reprendre les playlists' : 'Diffusion flash (suspend les playlists)',
      publishIconStyle: `width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;flex:0 0 auto;background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;box-shadow:0 3px 12px rgba(141,29,44,0.4);`,
      onbIconStyle: `${hdrRound}background:rgba(46,110,78,0.12);color:#2E6E4E;border:1px solid rgba(46,110,78,0.4);`,
      reportIconStyle: `${hdrRound}background:rgba(110,74,43,0.12);color:#6E4A2B;border:1px solid rgba(110,74,43,0.4);`,
      openReport: () => this.openReport(),
      // ---- guide de mise en route ----
      openOnboarding: () => this.openOnboarding(),
      onbOpen: st.onbOpen,
      closeOnb: () => this.setState({ onbOpen: false }),
      onbStores: st.fleet.filter((s) => s.active !== false).map((s) => ({
        id: s.id, name: s.store,
        on: st.onbStore === s.id,
        done: st.onbDone.includes(s.id),
        pick: () => this.setState({ onbStore: s.id }),
      })),
      onbSel: (() => {
        const s = st.fleet.find((x) => x.id === st.onbStore);
        if (!s) return null;
        const fmt = s.format || { screens: 1, size: 55, orient: 'paysage', label: '1 × 55″ paysage', px: '3840 × 2160 px', w: 3840, h: 2160 };
        const bw = this.bandwidthNote(fmt);
        const test = st.onbTest[s.id] || null;
        return {
          id: s.id, name: s.store, lang: s.lang || 'fr',
          fmt, bwReco: bw.reco, is4k: bw.is4k,
          setScreens: (e) => this.saveStore(s.id, { screens: e.target.value }),
          setSize: (e) => this.saveStore(s.id, { size: e.target.value }),
          setOrient: (e) => this.saveStore(s.id, { orient: e.target.value }),
          setLang: (e) => this.saveStore(s.id, { lang: e.target.value }),
          langOptions: (st.langs || []).map((l) => ({ id: l.id, label: l.label })),
          runTest: () => this.onbTestStore(s.id),
          test,
          link: this.filmUrl({ store: s.id }),
          copyLink: () => this.copyLink(this.filmUrl({ store: s.id })),
          done: st.onbDone.includes(s.id),
          toggleDone: () => this.onbMarkDone(s.id, !st.onbDone.includes(s.id)),
        };
      })(),
      onbCount: st.fleet.filter((s) => s.active !== false).length,
      onbDoneCount: st.fleet.filter((s) => s.active !== false && st.onbDone.includes(s.id)).length,
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
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">${v.isTimelineTab ? `Aperçu du film « ${this.activeFilm().name} » · 6480 × 3840` : `Aperçu de l'élément · 6480 × 3840`}</h2>
        ${v.isTimelineTab && this.activeFilm().mode === 'continu' ? html`
          <span style="display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:11px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border-radius:999px;padding:3px 10px;">🔄 boucle générée${v.contPreviewMeta ? ` · ${v.contPreviewMeta.slots} slot(s)` : ''}</span>
            ${infoTip('Aperçu FIDÈLE : c’est la boucle réellement composée par le serveur (produits de saison, moment, ratios…), telle qu’elle passera à l’écran. Elle reflète les réglages ENREGISTRÉS — après une modif, elle se rafraîchit à l’enregistrement (auto ~1 s) ou via ⟳.')}
            <button onClick=${() => this.loadContPreview()} disabled=${v.contPreviewBusy} title="Recomposer l’aperçu maintenant" style="padding:5px 11px;font-size:11.5px;font-weight:600;color:#6E4A2B;background:#fff;border:1px solid rgba(110,74,43,0.35);border-radius:999px;cursor:${v.contPreviewBusy ? 'wait' : 'pointer'};">⟳ Actualiser</button>
          </span>
        ` : ''}
      </div>
      ${v.isTimelineTab && this.activeFilm().mode === 'continu' && v.contPreviewMeta && v.contPreviewMeta.products === 0 ? html`
        <div style="margin:-4px 0 12px;padding:11px 14px;border-radius:10px;background:rgba(201,123,74,0.1);border:1px solid rgba(201,123,74,0.35);font-size:12.5px;color:#8A5A2B;line-height:1.5;">
          ⚠ <strong>Aucun produit éligible</strong> au moment courant${v.contPreviewMeta.moment ? ` (${{ matin: 'matin', midi: 'midi', aprem: 'après-midi' }[v.contPreviewMeta.moment] || v.contPreviewMeta.moment})` : ''} — la boucle serait quasi vide à l'écran. Vérifie la <strong>source</strong> et les <strong>périodes de vente / saisons</strong> (onglet Périodes), ou mets « Si rien en saison » sur <strong>Tout le catalogue</strong>.
        </div>
      ` : ''}
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

    // Bibliothèque de films — badge coloré par catégorie, avec ses tags.
    const filmBadge = (p, active, pick) => {
      const c = filmCatOf(p);
      const tags = (p.tags || []).slice(0, 3);
      return html`
        <button onClick=${pick} title=${`${p.name} · ${c.label} · ${p.items.length} module(s)${(p.tags || []).length ? ' · #' + p.tags.join(' #') : ''}`}
          style="display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;white-space:nowrap;${active ? `background:${c.color};color:#fff;border:1px solid ${c.color};box-shadow:0 2px 8px ${c.color}44;` : `background:#fff;color:#232220;border:1px solid ${c.color}55;border-left:4px solid ${c.color};`}">
          <span>${p.name}</span>
          <span style="opacity:0.7;font-weight:500;">${p.items.length}</span>
          ${tags.map((t) => html`<span style="font-size:9.5px;font-weight:600;padding:1px 6px;border-radius:999px;background:${active ? 'rgba(255,255,255,0.22)' : c.color + '18'};color:${active ? '#fff' : c.color};">#${t}</span>`)}
        </button>`;
    };
    const filmCounts = {};
    st.playlists.forEach((p) => { const c = filmCatOf(p).id; filmCounts[c] = (filmCounts[c] || 0) + 1; });
    const filmCatChips = [
      { id: 'all', label: 'Tous', color: '#232220', count: st.playlists.length },
      ...FILM_CATS.filter((c) => filmCounts[c.id]).map((c) => ({ ...c, count: filmCounts[c.id] })),
    ].map((c) => {
      const on = st.filmFilter === c.id;
      return html`
        <button onClick=${() => this.setState({ filmFilter: c.id })}
          style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:11.5px;font-weight:700;border-radius:999px;cursor:pointer;${on ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}">
          <span style="width:7px;height:7px;border-radius:50%;background:${on ? '#fff' : c.color};"></span>${c.label}<span style="font-weight:400;opacity:0.75;">${c.count}</span>
        </button>`;
    });
    const shownFilms = st.playlists.filter((p) => st.filmFilter === 'all' || filmCatOf(p).id === st.filmFilter);
    const filmSelector = html`
      <div style="display:flex;flex-direction:column;gap:9px;width:100%;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;margin-right:2px;">Catégories</span>
          ${filmCatChips}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${st.editingFilm
            ? html`<input value=${st.editFilmName}
                ref=${(el) => { if (el && document.activeElement !== el && !el._focused) { el._focused = true; el.focus(); el.select(); } }}
                onInput=${(e) => this.setState({ editFilmName: e.target.value })}
                onKeyDown=${(e) => { if (e.key === 'Enter') this.renameFilm(st.editFilmName); if (e.key === 'Escape') this.setState({ editingFilm: false }); }}
                onBlur=${() => this.renameFilm(st.editFilmName)}
                style="flex:0 1 auto;min-width:180px;padding:7px 9px;font-size:13px;font-weight:600;border:1px solid #8D1D2C;border-radius:8px;background:#fff;" />`
            : shownFilms.map((p) => filmBadge(p, p.id === st.activePl, () => this.selectFilm(p.id)))}
          ${!st.editingFilm && !shownFilms.length ? html`<span style="font-size:12px;color:#8A847C;">Aucun film dans cette catégorie.</span>` : ''}
          <button onClick=${() => this.setState({ editingFilm: true, editFilmName: this.activeFilm().name })} title="Renommer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;flex:0 0 auto;">✎</button>
          <button onClick=${() => this.newFilm()} title="Nouveau film (vide)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:#8D1D2C;color:#fff;border:none;cursor:pointer;font-size:14px;font-weight:700;flex:0 0 auto;">＋</button>
          <button onClick=${() => this.newExampleFilm()} title="Créer un film d'exemple : une boucle continue préréglée, à dupliquer et adapter" style="display:flex;align-items:center;gap:5px;padding:0 11px;height:26px;border-radius:7px;background:rgba(110,74,43,0.1);color:#6E4A2B;border:1px solid rgba(110,74,43,0.3);cursor:pointer;font-size:12px;font-weight:600;flex:0 0 auto;">✨ Exemple continu</button>
          <button onClick=${() => this.dupFilm()} title="Dupliquer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;flex:0 0 auto;">⎘</button>
          <button onClick=${() => this.delFilm()} title="Supprimer le film (les modules restent en bibliothèque)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.7);border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:12px;color:#8D1D2C;flex:0 0 auto;">🗑</button>
        </div>
      </div>`;

    // ---- Mode du film : Playlist (manuel) ou Continu (boucle auto) ----------
    const filmMode = this.activeFilm().mode === 'continu' ? 'continu' : 'playlist';
    const cont = normContinuous(this.activeFilm().continuous);
    const modeBtn = (id, label, sub) => html`
      <button onClick=${() => this.setFilmMode(id)} style="flex:1 1 0;text-align:left;padding:11px 15px;border-radius:12px;cursor:pointer;border:1px solid ${filmMode === id ? '#8D1D2C' : 'rgba(35,34,32,0.14)'};background:${filmMode === id ? '#8D1D2C' : '#FBF8F2'};color:${filmMode === id ? '#fff' : '#232220'};">
        <div style="font-size:13.5px;font-weight:700;">${label}</div>
        <div style="font-size:11px;opacity:0.82;margin-top:2px;">${sub}</div>
      </button>`;
    const filmModeToggle = html`
      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed rgba(35,34,32,0.12);">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">Mode du film</span>
          ${infoTip('« Playlist » : tu montes la séquence à la main sur la ligne du temps (contrôle total). « Continu » : tu ne montes rien — tu poses des règles (source, moments, ratios…) et la boucle se compose toute seule et s’adapte au fil de la journée, sans republier.')}
        </div>
        <div style="display:flex;gap:10px;">
          ${modeBtn('playlist', '▤ Playlist', 'Séquence montée à la main')}
          ${modeBtn('continu', '🔄 Continu', 'Boucle composée en direct · saisons · moments · tags')}
        </div>
      </div>`;
    // Panneau de réglages du mode continu.
    const cField = (label, node, tip) => html`<label style="display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;"><span style="display:inline-flex;align-items:center;gap:5px;">${label}${tip ? infoTip(tip) : ''}</span>${node}</label>`;
    const cNum = (key, val, min, max) => html`<input type="number" min=${min} max=${max} value=${val} onInput=${(e) => this.updateContinuous({ [key]: e.target.value })} style="width:92px;padding:8px 10px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;" />`;
    const cChoice = (key, opts) => html`<div style="display:flex;gap:6px;flex-wrap:wrap;">${opts.map(([id, lab]) => html`<button onClick=${() => this.updateContinuous({ [key]: id })} style="padding:7px 13px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;border:1px solid ${cont[key] === id ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${cont[key] === id ? '#8D1D2C' : '#fff'};color:${cont[key] === id ? '#fff' : '#232220'};">${lab}</button>`)}</div>`;
    const cToggle = (key, yes, no) => html`<div style="display:flex;gap:6px;">${[[true, yes], [false, no]].map(([b, lab]) => html`<button onClick=${() => this.updateContinuous({ [key]: b })} style="padding:7px 13px;font-size:12.5px;font-weight:600;border-radius:999px;cursor:pointer;border:1px solid ${!!cont[key] === b ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${!!cont[key] === b ? '#8D1D2C' : '#fff'};color:${!!cont[key] === b ? '#fff' : '#232220'};">${lab}</button>`)}</div>`;
    const cRatio = (key, label) => html`<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;"><span style="width:150px;color:#232220;font-weight:600;">${label}</span><span style="color:#8A847C;">1 :</span><input type="number" min="0" max="99" value=${cont.ratios[key]} onInput=${(e) => this.updateContRatio(key, e.target.value)} style="width:66px;padding:7px 9px;font-size:13px;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;" /></label>`;
    const catChips = (st.catalog.categories || []).map((c) => {
      const on = cont.categories.includes(c.id);
      return html`<button onClick=${() => { const set = new Set(cont.categories); on ? set.delete(c.id) : set.add(c.id); this.updateContinuous({ categories: [...set] }); }} style="padding:6px 12px;font-size:12px;font-weight:600;border-radius:999px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#232220'};">${c.name}</button>`;
    });
    // Playlists d'exception : tags multi-sélection (films « playlist » uniquement).
    const excFilms = st.playlists.filter((p) => p.mode !== 'continu' && p.id !== this.activeFilm().id);
    const excChips = excFilms.map((p) => {
      const on = cont.exceptionFilms.includes(p.id);
      return html`<button onClick=${() => { const set = new Set(cont.exceptionFilms); on ? set.delete(p.id) : set.add(p.id); this.updateContinuous({ exceptionFilms: [...set] }); }} style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;font-weight:600;border-radius:999px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#232220'};">${on ? '✓ ' : '+ '}${p.name}</button>`;
    });
    const contPanel = html`
      <div style="background:#FFFFFF;border:1px solid rgba(141,29,44,0.22);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">🔄 Boucle continue — la régie compose « ${this.activeFilm().name} » en direct</h3>
          <a href=${new URL('film?film=' + this.activeFilm().id, location.href).toString()} target="_blank" style="font-size:12.5px;font-weight:600;color:#6E4A2B;">▶ Aperçu en direct ↗</a>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px;">
          <div style="display:flex;gap:26px;flex-wrap:wrap;">
            ${cField('Source des fiches', cChoice('source', [['saison', 'Produits de saison'], ['categories', 'Tout sauf catégories'], ['tout', 'Tout le catalogue']]), 'D’où viennent les fiches produit. « Produits de saison » = seulement ceux liés à une période active (onglet Périodes). « Tout sauf catégories » = tout le catalogue sauf les catégories cochées ci-dessous. « Tout le catalogue » = tous les produits actifs.')}
            ${cField('Adapter au moment', cToggle('perMoment', 'Oui (matin/midi/aprem)', 'Non'), 'Si activé, la boucle ne montre que les produits vendus au moment courant (table « Périodes de vente » dans l’onglet Périodes) : viennoiseries le matin, sandwichs le midi, etc.')}
            ${cField('Ordre', cChoice('order', [['catalogue', 'Catalogue'], ['aleatoire', 'Aléatoire']]), 'Ordre de passage. « Catalogue » = l’ordre du catalogue. « Aléatoire » = mélangé (stable pendant une fenêtre, re-mélangé au changement de moment/saison).')}
          </div>
          ${cont.source === 'categories' ? html`<div><div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:8px;">Catégories exclues (exceptions) — tout le reste passe</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${catChips}</div></div>` : ''}
          <div style="display:flex;gap:20px;flex-wrap:wrap;">
            ${cField('Durée fiche (s)', cNum('prodDur', cont.prodDur, 2, 60), 'Combien de secondes une fiche produit reste à l’écran.')}
            ${cField('Durée vidéo (s)', cNum('clipDur', cont.clipDur, 2, 120), 'Durée d’un clip vidéo/photo ciblé (et de la vidéo surprise).')}
            ${cField('Max fiches / boucle', cNum('maxItems', cont.maxItems, 4, 40), 'Nombre maximum de fiches produit dans une boucle (borne de sécurité pour éviter une boucle trop longue).')}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:9px;">
              <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">Ratios par type d'élément · 1 : N (0 = jamais)</span>
              ${infoTip('Dose le mélange de la boucle. « 1 : N » = un élément de ce type tous les N slots. Ex. Liaison 1:5 = un logo de transition toutes les 5 fiches ; Produit seul 1:6 = une fiche plein écran toutes les 6. 0 = ce type n’apparaît jamais.')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;max-width:360px;">
              ${cRatio('liaison', 'Liaison (logo)')}
              ${cRatio('produitSeul', 'Produit seul')}
              ${cRatio('media', 'Vidéo/photo ciblée')}
              ${cRatio('animation', 'Animation promo')}
              ${cRatio('surprise', 'Vidéo surprise')}
            </div>
          </div>
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start;">
            ${cField('Rafraîchissement', cChoice('refresh', [['moment', 'Au moment/saison'], ['minutes', 'Toutes les N min']]), 'Quand la boucle est recomposée. « Au moment/saison » = à chaque changement de créneau (matin→midi) ou de période. « Toutes les N min » = aussi rafraîchie périodiquement.')}
            ${cont.refresh === 'minutes' ? cField('N minutes', cNum('refreshMin', cont.refreshMin, 1, 240), 'Intervalle de recomposition de la boucle, en minutes.') : ''}
            ${cField('Si rien en saison', cChoice('fallback', [['tout', 'Tout le catalogue'], ['aucun', 'Rien (attente)']]), 'Repli quand aucun produit n’est éligible (hors saison / rien au bon moment) : jouer tout le catalogue, ou afficher l’écran d’attente.')}
          </div>
          <div>
            ${cField('Playlists d\'exception (jouées EN PLUS à chaque boucle · plusieurs possibles)', html`<div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${excFilms.length ? excChips : html`<span style="font-size:12px;color:#8A847C;">Aucun autre film « playlist » à ajouter.</span>`}
            </div>`, 'Ces films « playlist » (montés à la main) sont ajoutés à la fin de CHAQUE boucle, en plus du contenu auto. Pratique pour épingler une promo ou un message qui doit toujours passer. Clique un tag pour l’ajouter/retirer.')}
          </div>
        </div>
      </div>`;

    const home = this.homeReadiness();
    const MOMENT_FULL = { matin: 'Matin', midi: 'Midi', aprem: 'Après-midi' };
    return html`
<div style="height:100vh;background:#E7E1D8;color:#232220;display:flex;flex-direction:column;overflow:hidden;">

  <header style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px 24px;padding:14px 30px;background:#FFFFFF;border-bottom:1px solid rgba(35,34,32,0.10);z-index:5;">
    <div style="display:flex;align-items:center;gap:16px;min-width:0;flex:1 1 auto;">
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;flex:0 0 auto;">
        <img src="assets/logo.png" alt="L'Atelier By" style="height:32px;width:auto;" />
        <span style="font-weight:500;font-size:12.5px;letter-spacing:0.02em;white-space:nowrap;">Régie d'affichage</span>
      </div>
      <div style="display:inline-flex;background:#EFE9E0;border-radius:999px;padding:3px;flex:0 0 auto;margin-left:10px;">
        <button onClick=${v.setViewHome} style=${v.tabHomeStyle}>Accueil</button>
        <button onClick=${v.setViewComposer} style=${v.tabComposerStyle}>Compositeur</button>
        <button onClick=${v.setViewProducts} style=${v.tabProductsStyle}>Produits</button>
        <button onClick=${v.setViewSeasons} style=${v.tabSeasonsStyle}>Périodes</button>
        <button onClick=${v.setViewPlanning} style=${v.tabPlanningStyle}>Planning</button>
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
      <button class="hdr-btn" onClick=${v.openReport} style=${v.reportIconStyle}>📄<span class="hdr-tip hdr-tip-right">Rapport de diffusion — lien partageable (bibliothèque, planning, écrans)</span></button>
      <button class="hdr-btn" onClick=${v.openOnboarding} style=${v.onbIconStyle}>🎓<span class="hdr-tip hdr-tip-right">Mise en route — configurer chaque magasin</span></button>
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

      <!-- Stockage / streaming HD -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:26px 28px;margin-top:20px;">
        <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Stockage / streaming HD</h2>
        <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.5;">Adresse et identifiants d'un stockage HD externe (pour héberger les grosses vidéos hors du serveur local). Optionnel : par défaut les vidéos vivent dans le dossier <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">public/media/</code> du serveur.</p>
        <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">Adresse du stockage HD</label>
        <input value=${v.hdUrl} onInput=${v.onHdUrl} placeholder="https://hd-storage.exemple.com/ ou ftp://…" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;margin-bottom:14px;" />
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="flex:1 1 200px;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">Identifiant</label>
            <input value=${v.hdUser} onInput=${v.onHdUser} placeholder="utilisateur" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          </div>
          <div style="flex:1 1 200px;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:#8A847C;margin-bottom:6px;">Mot de passe / clé</label>
            <input type="password" value=${v.hdPass} onInput=${v.onHdPass} placeholder=${v.hasHdPass ? '•••••••• (enregistré)' : 'mot de passe'} style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
          </div>
        </div>
        <button onClick=${v.saveHd} disabled=${v.hdSaving} style="padding:11px 22px;font-size:13.5px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:999px;cursor:${v.hdSaving ? 'wait' : 'pointer'};">${v.hdSaving ? 'Enregistrement…' : 'Enregistrer le stockage HD'}</button>
      </div>

      <!-- Espace Vidéo — Agence -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:26px 28px;margin-top:20px;">
        <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8D1D2C;">Espace Vidéo — Agence</h2>
        <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.5;">Un accès séparé (mot de passe dédié — variable <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">SIG_AGENCY_PASSWORD</code>, défaut « agence ») où les agences uploadent des vidéos/photos taguées (moment · produit · saison) et vérifient leur présence sur le serveur. Elles n'accèdent qu'à cette page. Partage-leur ce lien :</p>
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);">
          <input readonly value=${v.agencyUrl} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:7px;background:#fff;" />
          <button onClick=${() => v.copyLink(v.agencyUrl)} style="flex:0 0 auto;padding:8px 14px;font-size:12.5px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Copier</button>
          <a href=${v.agencyUrl} target="_blank" style="flex:0 0 auto;font-size:12.5px;font-weight:600;color:#8D1D2C;">↗ Ouvrir</a>
        </div>
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
                : `✓ Base « ${st.pwaResult.db} » — importé : ${st.pwaResult.categories} catégorie(s) · ${st.pwaResult.products} produit(s) · ${st.pwaResult.storePrices} prix/boutique (${st.pwaResult.shopMap}) · ${st.pwaResult.relinked} élément(s) re-lié(s)${st.pwaResult.dupes ? ` · ${st.pwaResult.dupes} ligne(s) en double ignorée(s)` : ''}${st.pwaResult.createdStores ? ` · magasin(s) créé(s) : ${st.pwaResult.createdStores.join(', ')}` : ''}${st.pwaResult.inactiveShops ? ` · ${st.pwaResult.inactiveShops} boutique(s) inactive(s) ignorée(s)` : ''}${st.pwaResult.langSet ? ` · langue préférée appliquée à ${st.pwaResult.langSet} magasin(s) (${st.pwaResult.langSource})` : (st.pwaResult.langSource ? ` · langue : ${st.pwaResult.langSource}` : '')}`)
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
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
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
              ${v.storeCols.map((sc) => html`<span title=${sc.label} style="font-size:8.5px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:#8A847C;text-align:right;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">${sc.label}</span>`)}
              <span style="font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;text-align:center;" title="✓ Actif = présent au catalogue · ⦸ Rupture = temporairement indisponible, masqué des boucles continues">État</span>
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
                <div style="display:flex;justify-content:center;gap:5px;">
                  <button onClick=${p.toggleActive} title="Actif / inactif (masqué partout à l'écran)" style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid rgba(35,34,32,0.12);cursor:pointer;background:${p.active ? 'rgba(46,110,78,0.12)' : 'rgba(141,29,44,0.08)'};color:${p.active ? '#2E6E4E' : '#8D1D2C'};font-size:13px;">${p.active ? '✓' : '⃠'}</button>
                  <button onClick=${p.toggleUnavailable} title="En rupture / indisponible — masqué des boucles continues (mode Continu) et signalé. Réactive quand le produit revient." style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;cursor:pointer;border:1px solid ${p.unavailable ? 'rgba(141,29,44,0.4)' : 'rgba(35,34,32,0.12)'};background:${p.unavailable ? 'rgba(141,29,44,0.14)' : '#FBF8F2'};color:${p.unavailable ? '#8D1D2C' : '#C9C3B8'};font-size:14px;">⦸</button>
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
          <p style="margin:14px 0 0;font-size:11.5px;color:#8A847C;">Prix par magasin : laisse vide pour utiliser le prix par défaut. Langues : FR = noms de base ; dans une autre langue, le champ nom édite la traduction (vide = nom de base). Chaque magasin affiche automatiquement ses prix ET sa langue (réglée dans Réseau). État : ✓ actif · <strong style="color:#8D1D2C;">⦸ rupture</strong> = temporairement indisponible, retiré des boucles en mode Continu (le reste du catalogue continue).</p>
        </div>
      </div>
    </div>
  </div>
  `}

  ${v.isSeasonsView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:26px 32px 48px;">
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Périodes de l'année</h2>
          <p style="margin:0;font-size:12.5px;color:#8A847C;max-width:760px;">Définis les saisons et fêtes (du → au) et les produits liés. Sert à cibler automatiquement les vidéos et animations de saison. Récurrent chaque année (jour/mois). Importable depuis la table <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">ws_season</code> de la même base MySQL que les produits (nom, dates, produits liés et illustration si la table en expose une). « 🔍 Diagnostic » liste les colonnes réelles sans rien modifier.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input value=${v.wsTable} onInput=${v.onWsTable} placeholder="table (déf. ws_season)" spellcheck="false" title="Nom de la table MySQL des périodes, si différent de ws_season" style="width:170px;padding:9px 11px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#FBF8F2;" />
          <button onClick=${v.diagSeasons} disabled=${v.seasonsBusy} title="Lecture seule : liste les colonnes réelles de ws_season et détecte une éventuelle colonne d'illustration" style="padding:9px 14px;font-size:12.5px;font-weight:600;color:#4A4640;background:#fff;border:1px solid rgba(35,34,32,0.2);border-radius:999px;cursor:${v.seasonsBusy ? 'wait' : 'pointer'};">🔍 Diagnostic</button>
          <button onClick=${v.importSeasons} disabled=${v.seasonsBusy} style="padding:9px 15px;font-size:12.5px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.35);border-radius:999px;cursor:${v.seasonsBusy ? 'wait' : 'pointer'};">⟳ Importer</button>
          <button onClick=${v.saveSeasons} disabled=${!v.seasonsDirty || v.seasonsBusy} style="padding:9px 18px;font-size:13px;font-weight:600;border-radius:999px;border:1px solid #8D1D2C;cursor:${v.seasonsDirty && !v.seasonsBusy ? 'pointer' : 'not-allowed'};background:${v.seasonsDirty ? '#8D1D2C' : 'rgba(35,34,32,0.10)'};color:${v.seasonsDirty ? '#fff' : '#8A847C'};">${v.seasonsBusy ? 'Enregistrement…' : (v.seasonsDirty ? 'Enregistrer' : '✓ Enregistré')}</button>
        </div>
      </div>
      ${v.wsCandidates.length ? html`
        <div style="background:rgba(201,123,74,0.08);border:1px solid rgba(201,123,74,0.3);border-radius:12px;padding:12px 16px;font-size:12.5px;color:#6E4A2B;">
          Aucune table de périodes exploitée. Tables candidates — clique l'une d'elles (elle remplit le champ) puis « Importer » :
          <span style="display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:6px;">
            ${v.wsCandidates.map((t) => html`<button onClick=${() => v.useWsCandidate(t)} style="font-family:ui-monospace,monospace;font-size:12px;font-weight:600;color:#6E4A2B;background:#fff;border:1px solid rgba(110,74,43,0.35);border-radius:999px;padding:3px 10px;cursor:pointer;">${t}</button>`)}
          </span>
        </div>
      ` : ''}
      ${v.wsInspected.length ? html`
        <div style="background:#FBF8F2;border:1px solid rgba(35,34,32,0.12);border-radius:12px;padding:12px 16px;font-size:12px;color:#4A4640;line-height:1.6;">
          <strong>Colonnes vues</strong> (il faut 2 colonnes de dates du → au + un nom) :
          ${v.wsInspected.map((ins) => html`
            <div style="margin-top:6px;"><code style="font-weight:700;color:#6E4A2B;">${ins.table}</code> → <span style="font-family:ui-monospace,monospace;">${(ins.types || ins.columns).join(', ')}</span></div>
            ${ins.sample && ins.sample.length ? html`<div style="margin-top:2px;color:#8A847C;font-family:ui-monospace,monospace;font-size:11px;">ex. : ${ins.sample.join(' | ')}</div>` : ''}
          `)}
          <div style="margin-top:6px;color:#8A847C;">Si les dates sont dans ces colonnes mais non détectées, dis-moi lesquelles (du/au) et je les câble.</div>
        </div>
      ` : ''}
      ${v.wsDiag ? html`
        <div style="background:${v.wsDiag.imageFound ? 'rgba(46,110,78,0.06)' : '#FBF8F2'};border:1px solid ${v.wsDiag.imageFound ? 'rgba(46,110,78,0.3)' : 'rgba(35,34,32,0.12)'};border-radius:12px;padding:12px 16px;font-size:12px;color:#4A4640;line-height:1.6;">
          <div style="font-weight:700;color:${v.wsDiag.imageFound ? '#2E6E4E' : '#8D1D2C'};">
            ${v.wsDiag.imageFound
              ? html`🖼 Colonne d'illustration détectée : ${v.wsDiag.imageCols.map((c) => html`<code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">${c.column}</code> dans <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">${c.table}</code>${c.sample ? html` · ex. « ${c.sample} »` : ''} `)}`
              : (v.wsDiag.ok ? html`🔍 Aucune colonne d'illustration détectée dans les tables de périodes vues.` : html`⚠ ${v.wsDiag.error || 'Base non lisible'}`)}
          </div>
          ${(v.wsDiag.inspected || []).map((ins) => html`
            <div style="margin-top:8px;"><code style="font-weight:700;color:#6E4A2B;">${ins.table}</code> → <span style="font-family:ui-monospace,monospace;">${(ins.types || ins.columns).join(', ')}</span></div>
            ${ins.sample && ins.sample.length ? html`<div style="margin-top:2px;color:#8A847C;font-family:ui-monospace,monospace;font-size:11px;">ex. : ${ins.sample.join(' | ')}</div>` : ''}
          `)}
          <div style="margin-top:8px;color:#8A847C;">${v.wsDiag.imageFound ? html`L'import récupère automatiquement cette colonne. Clique « ⟳ Importer » pour (re)charger les périodes avec leur illustration.` : html`Diagnostic lecture seule — rien n'a été modifié. Si une colonne image existe sous un autre nom, dis-le-moi et je l'ajoute au détecteur.`}</div>
        </div>
      ` : ''}

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">${v.seasonsCount} période(s) · ${v.seasonsCurrentCount} active(s) aujourd'hui</h3>
          <button onClick=${v.addSeason} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;cursor:pointer;">+ Ajouter une période</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${v.seasonRows.map((s) => html`
            <div style="border:1px solid rgba(35,34,32,0.1);border-radius:12px;padding:13px 15px;background:${s.current ? 'rgba(46,110,78,0.05)' : '#FBF8F2'};">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${s.imageOk
                  ? html`<img src=${s.image} alt="" loading="lazy" title="Illustration de la période" style="width:28px;height:28px;border-radius:7px;object-fit:cover;flex:0 0 auto;border:1px solid rgba(35,34,32,0.15);background:${s.color};" />`
                  : html`<span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex:0 0 auto;"></span>`}
                <input value=${s.name} onInput=${s.onName} placeholder="Nom (ex. Galette des rois)" style="flex:1 1 200px;min-width:0;padding:9px 11px;font-size:14px;font-weight:600;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#fff;" />
                <span style="display:flex;align-items:center;gap:5px;">
                  <input value=${s.from} onInput=${s.onFrom} placeholder="du (JJ/MM)" style="width:110px;padding:9px 10px;font-size:12.5px;text-align:center;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#fff;" />
                  <span style="color:#8A847C;">→</span>
                  <input value=${s.to} onInput=${s.onTo} placeholder="au (JJ/MM)" style="width:110px;padding:9px 10px;font-size:12.5px;text-align:center;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#fff;" />
                </span>
                ${s.current ? html`<span style="font-size:10.5px;font-weight:700;color:#2E6E4E;background:rgba(46,110,78,0.12);border:1px solid rgba(46,110,78,0.35);border-radius:999px;padding:3px 9px;">● active aujourd'hui</span>` : ''}
                <button onClick=${s.del} title="Supprimer" style="flex:0 0 auto;width:30px;height:30px;border-radius:8px;border:1px solid rgba(35,34,32,0.12);background:#fff;cursor:pointer;font-size:13px;color:#8D1D2C;">✕</button>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-left:20px;">
                ${s.imageOk
                  ? html`<img src=${s.image} alt="Aperçu de l'illustration" loading="lazy" style="width:48px;height:48px;border-radius:9px;object-fit:cover;flex:0 0 auto;border:1px solid rgba(35,34,32,0.15);background:#fff;" />`
                  : html`<span title=${s.image ? 'Valeur non affichable ici' : 'Aucune illustration'} style="width:48px;height:48px;border-radius:9px;flex:0 0 auto;border:1px dashed rgba(35,34,32,0.22);background:#F5EFE4;display:flex;align-items:center;justify-content:center;font-size:18px;color:#C9C3B8;">🖼</span>`}
                <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 240px;min-width:0;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;">Illustration</span>
                  <input value=${s.image} onInput=${s.onImage} placeholder="URL/lien direct de l'image (auto-rempli si la table importée a une colonne image)" spellcheck="false" title="Lien direct de l'illustration de la période. Rempli automatiquement à l'import si la table (ex. product_availability_period) expose une colonne image ; sinon colle une URL ici." style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#fff;" />
                </div>
                ${s.image && !s.imageOk ? html`<span title="Valeur non affichable directement (id ou nom de fichier sans chemin) — indique-moi le format et je résous l'URL." style="font-size:11px;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;padding:2px 9px;flex:0 0 auto;">⚠ non affichable</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-left:20px;">
                <span style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;">Produits liés :</span>
                ${s.products.map((p) => html`<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;padding:3px 5px 3px 10px;">${p.name}<button onClick=${p.remove} style="width:16px;height:16px;border-radius:50%;border:none;background:rgba(141,29,44,0.15);color:#8D1D2C;cursor:pointer;font-size:10px;line-height:1;">✕</button></span>`)}
                ${s.addable.length ? html`
                  <select onChange=${s.onAddProduct} style="padding:6px 9px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#fff;cursor:pointer;">
                    <option value="">+ produit…</option>
                    ${s.addable.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                  </select>
                ` : ''}
              </div>
            </div>
          `)}
          ${!v.seasonRows.length && html`<p style="margin:0;font-size:12.5px;color:#8A847C;padding:8px 0;">Aucune période. « + Ajouter une période » ou « ⟳ Importer depuis ws_season ».</p>`}
        </div>
        <p style="margin:14px 0 0;font-size:11.5px;color:#8A847C;">Dates : <strong>JJ/MM</strong> (ex. 21/06) ou AAAA-MM-JJ ; l'année est ignorée (la période revient chaque année). Une période à cheval sur le nouvel an (ex. 15/12 → 06/01) est gérée.</p>
      </div>

      <!-- Périodes de vente : produit × moment (matin / midi / après-midi) -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Périodes de vente — produit × moment de la journée</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button onClick=${v.pmAllCollapsed ? v.expandAllPm : v.collapseAllPm} style="padding:7px 13px;font-size:12px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.3);border-radius:999px;cursor:pointer;">${v.pmAllCollapsed ? '▷ Tout déplier' : '▽ Tout plier'}</button>
            <button onClick=${v.saveProdMoments} disabled=${!v.prodMomentsDirty || v.prodMomentsBusy} style="padding:8px 16px;font-size:12.5px;font-weight:600;border-radius:999px;border:1px solid #8D1D2C;cursor:${v.prodMomentsDirty && !v.prodMomentsBusy ? 'pointer' : 'not-allowed'};background:${v.prodMomentsDirty ? '#8D1D2C' : 'rgba(35,34,32,0.10)'};color:${v.prodMomentsDirty ? '#fff' : '#8A847C'};">${v.prodMomentsBusy ? 'Enregistrement…' : (v.prodMomentsDirty ? 'Enregistrer' : '✓ Enregistré')}</button>
          </div>
        </div>
        <p style="margin:0 0 12px;font-size:12px;color:#8A847C;max-width:820px;">Clique une case pour cycler : <strong style="color:#2E6E4E;">vendu</strong> → <strong style="color:#8D1D2C;">exception (exclu)</strong> → vide. Un produit sans aucune case cochée est vendu à tous les moments. En mode continu, la boucle ne montre que les produits vendus au moment courant${v.prodMomentsCurrent ? html` (actuellement : <strong>${v.prodMomentsCurrent}</strong>)` : ''}. Les produits sont regroupés par catégorie (clique une catégorie pour la plier/déplier).</p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse;width:100%;min-width:420px;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:8px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;border-bottom:1px solid rgba(35,34,32,0.12);">Produit</th>
              ${v.saleMoments.map((mo) => html`<th style="padding:8px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${v.prodMomentsCurrent === mo.id ? '#8D1D2C' : '#8A847C'};border-bottom:1px solid rgba(35,34,32,0.12);text-align:center;width:120px;">${mo.label}</th>`)}
            </tr></thead>
            <tbody>
              ${v.prodMomentCats.map((cat) => html`
                <tr>
                  <td colspan="4" style="padding:0;">
                    <button onClick=${cat.toggle} style="width:100%;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:9px 10px;background:#F5EFE4;border:none;border-top:1px solid rgba(35,34,32,0.08);border-bottom:1px solid rgba(35,34,32,0.08);cursor:pointer;text-align:left;">
                      <span style="flex:0 0 auto;font-size:10px;color:#8D1D2C;display:inline-block;transform:rotate(${cat.collapsed ? '0' : '90'}deg);">▶</span>
                      <span style="flex:1 1 auto;font-size:12.5px;font-weight:700;color:#6E4A2B;">${cat.name}</span>
                      <span style="flex:0 0 auto;font-size:11px;color:#8A847C;">${cat.count} produit(s)</span>
                    </button>
                  </td>
                </tr>
                ${cat.collapsed ? '' : cat.products.map((p) => html`
                  <tr>
                    <td style="padding:7px 10px 7px 26px;border-bottom:1px solid rgba(35,34,32,0.06);white-space:nowrap;${p.active ? '' : 'color:#B8B2A8;'}">${p.name}${p.active ? '' : ' · inactif'}</td>
                    ${p.cells.map((c) => html`<td style="padding:5px 10px;border-bottom:1px solid rgba(35,34,32,0.06);text-align:center;">
                      <button onClick=${c.toggle} title="Cliquer pour changer" style="width:34px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;border:1px solid ${c.state === 'incl' ? 'rgba(46,110,78,0.4)' : (c.state === 'excl' ? 'rgba(141,29,44,0.4)' : 'rgba(35,34,32,0.14)')};background:${c.state === 'incl' ? 'rgba(46,110,78,0.14)' : (c.state === 'excl' ? 'rgba(141,29,44,0.12)' : '#FBF8F2')};color:${c.state === 'incl' ? '#2E6E4E' : (c.state === 'excl' ? '#8D1D2C' : '#C9C3B8')};">${c.state === 'incl' ? '✓' : (c.state === 'excl' ? '✕' : '·')}</button>
                    </td>`)}
                  </tr>
                `)}
              `)}
              ${!v.prodMomentCats.length ? html`<tr><td colspan="4" style="padding:12px 10px;color:#8A847C;font-size:12.5px;">Aucun produit dans le catalogue. Importe le catalogue dans l'onglet Produits.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Médiathèque agence : vue admin (nombre + tags + présence) -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Médiathèque agence — ${v.mediaOverview.total ? `${v.mediaOverview.total} média(s) sur le serveur` : 'vide'}</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button onClick=${v.refreshMediaLib} style="padding:7px 13px;font-size:12px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.3);border-radius:999px;cursor:pointer;">⟳ Rafraîchir</button>
            <a href=${v.agencyUrl} target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:8px 15px;font-size:12.5px;font-weight:600;color:#fff;background:#6E4A2B;border-radius:999px;">🎬 Ouvrir l'espace Agence ↗</a>
            <button onClick=${() => v.copyLink(v.agencyUrl)} title="Copier le lien agence" style="padding:8px 13px;font-size:12px;font-weight:600;border-radius:999px;border:1px solid rgba(110,74,43,0.35);background:#fff;color:#6E4A2B;cursor:pointer;">⎘ Lien</button>
          </div>
        </div>
        ${v.mediaOverview.total ? html`
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
            <span style="font-size:12px;color:#4A4640;background:#F5EFE4;border-radius:999px;padding:4px 12px;">🎬 ${v.mediaOverview.videos} vidéo(s)</span>
            <span style="font-size:12px;color:#4A4640;background:#F5EFE4;border-radius:999px;padding:4px 12px;">🖼 ${v.mediaOverview.photos} photo(s)</span>
            <span style="font-size:12px;color:#4A4640;background:#F5EFE4;border-radius:999px;padding:4px 12px;">Matin ${v.mediaOverview.byMoment.matin} · Midi ${v.mediaOverview.byMoment.midi} · Après-midi ${v.mediaOverview.byMoment.aprem} · Journée ${v.mediaOverview.byMoment.all}</span>
            <span style="font-size:12px;color:${v.mediaOverview.present === v.mediaOverview.total ? '#2E6E4E' : '#8D1D2C'};background:#F5EFE4;border-radius:999px;padding:4px 12px;">${v.mediaOverview.present}/${v.mediaOverview.total} présent(s) sur le disque</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${v.mediaOverview.rows.map((mm) => html`
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:9px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);flex-wrap:wrap;">
                <span style="font-size:15px;flex:0 0 auto;">${mm.kind === 'photo' ? '🖼' : '🎬'}</span>
                <span style="flex:1 1 200px;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${mm.filename}</span>
                <span style="font-size:10.5px;font-weight:700;color:#6E4A2B;background:rgba(110,74,43,0.1);border-radius:999px;padding:2px 9px;">${mm.moment}</span>
                ${mm.product ? html`<span style="font-size:11px;color:#4A4640;">🏷 ${mm.product}</span>` : ''}
                ${mm.season ? html`<span style="font-size:11px;color:#6E4A2B;">📅 ${mm.season}</span>` : ''}
                <span style="font-size:11px;color:#8A847C;">${Math.round((mm.size || 0) / 1024 / 1024 * 10) / 10} Mo</span>
                <span style="font-size:11px;font-weight:700;color:${mm.present ? '#2E6E4E' : '#8D1D2C'};">${mm.present ? '✓' : '⚠ absent'}</span>
                <button onClick=${mm.del} title="Supprimer du serveur" style="flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:#8D1D2C;">✕</button>
              </div>
            `)}
          </div>
        ` : html`<p style="margin:0;font-size:12.5px;color:#8A847C;">Aucun média sur le serveur pour l'instant. Les agences en ajoutent via l'espace Agence (ou dépose-les dans <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">public/media/</code> par SFTP).</p>`}
      </div>
    </div>
  </div>
  `}

  ${v.isPlanningView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:26px 32px 48px;">
    <div style="max-width:1500px;margin:0 auto;display:flex;flex-direction:column;gap:16px;">
      <div>
        <h2 style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8D1D2C;">Planning hebdomadaire</h2>
        <p style="margin:0;font-size:12.5px;color:#8A847C;">5 modèles de semaine réutilisables (A–E). Choisis les magasins, remplis chaque jour (matin / midi / après-midi), puis <strong>active</strong> la semaine à diffuser. Duplique une semaine pour la retoucher. Tout s'enregistre automatiquement ; les écrans basculent selon le jour et l'heure.</p>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">1 · Magasins</h3>
        ${v.planStoreChips.length ? html`
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
            ${v.planStoreChips.map((s) => html`
              <button onClick=${s.toggle} style=${s.style}>
                <span style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;">${s.badge ? html`<span style="color:#8D1D2C;">✓</span>` : ''}${s.label}</span>
                <span style="font-size:11px;color:#8A847C;">${s.sub}</span>
              </button>
            `)}
          </div>
        ` : html`<p style="margin:0;font-size:12.5px;color:#8A847C;">Aucun magasin — importe ton catalogue (⚙ Paramètres → Rafraîchir) ou branche un écran.</p>`}
      </div>

      <!-- 2 · Semaine (modèle A–E) + activation + duplication -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">2 · Semaine (modèle)</h3>
          <span style="font-size:12px;color:#8A847C;">Diffusée actuellement : <strong style="color:#2E6E4E;">Semaine ${v.planActiveWeek}</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${v.planWeekTabs.map((t) => html`
            <button onClick=${t.pick} title=${t.playing ? 'Semaine actuellement diffusée' : ''} style="display:flex;align-items:center;gap:6px;padding:9px 18px;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;${t.active ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#232220;border:1px solid rgba(35,34,32,0.14);'}">
              Sem. ${t.label}${t.playing ? html`<span style="width:7px;height:7px;border-radius:50%;background:${t.active ? '#fff' : '#2E6E4E'};"></span>` : ''}
            </button>
          `)}
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button onClick=${v.activatePlanWeek} disabled=${v.planWeekActive} style="padding:9px 18px;font-size:13px;font-weight:600;border-radius:999px;cursor:${v.planWeekActive ? 'default' : 'pointer'};${v.planWeekActive ? 'background:rgba(46,110,78,0.12);color:#2E6E4E;border:1px solid rgba(46,110,78,0.4);' : 'background:#2E6E4E;color:#fff;border:1px solid #2E6E4E;'}">${v.planWeekActive ? `✓ Semaine ${v.planWeek} diffusée` : `▶ Diffuser la semaine ${v.planWeek}`}</button>
          <span style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:#8A847C;">
            Dupliquer la semaine ${v.planWeek} vers
            <select onChange=${(e) => { const t = e.target.value; e.target.value = ''; if (t) v.duplicatePlanWeek(t); }} style="padding:8px 10px;font-size:12.5px;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;cursor:pointer;">
              <option value="">semaine…</option>
              ${v.planDupTargets.map((w) => html`<option value=${w}>Semaine ${w}</option>`)}
            </select>
          </span>
        </div>
      </div>

      ${!v.planHasStores ? html`
        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:22px 20px;text-align:center;">
          <p style="margin:0;font-size:13px;color:#8A847C;">Sélectionne au moins un magasin ci-dessus pour remplir son planning de la semaine ${v.planWeek}.</p>
        </div>
      ` : html`

      <!-- 3 · Jour de la semaine -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">3 · Jour de la semaine</h3>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">
          ${v.planDayTabs.map((d) => html`
            <button onClick=${d.pick} style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 16px;border-radius:10px;cursor:pointer;min-width:64px;${d.active ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#232220;border:1px solid rgba(35,34,32,0.14);'}">
              <span style="font-size:13px;font-weight:700;">${d.label}</span>
              <span style="font-size:10px;${d.active ? 'color:rgba(255,255,255,0.85);' : 'color:#8A847C;'}">${d.count ? `${d.count} film(s)` : '—'}</span>
            </button>
          `)}
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Films — ${v.planDayName} (glisse-les sur un moment)</h3>
        ${v.planFilmCards.length ? html`
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${v.planFilmCards.map((f) => html`
              <div draggable="true" onDragStart=${f.onDragStart} onDragEnd=${f.onDragEnd} style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:#FBF8F2;border:1px solid ${f.color}55;border-left:4px solid ${f.color};cursor:grab;">
                <span style="font-size:13px;font-weight:600;">${f.name}</span>
                <span style="font-size:10px;font-weight:600;color:${f.color};">${f.catLabel}</span>
                ${f.dayBadge ? html`<span title="Jours de planning de ce film" style="font-size:9px;font-weight:700;color:#6E4A2B;background:rgba(110,74,43,0.1);border-radius:999px;padding:1px 6px;">${f.dayBadge}</span>` : ''}
                <span style="font-size:10px;color:#8A847C;">${f.count} mod.</span>
                ${f.tags.map((t) => html`<span style="font-size:9px;font-weight:600;color:${f.color};">#${t}</span>`)}
              </div>
            `)}
          </div>
        ` : html`<p style="margin:0;font-size:12.5px;color:#8A847C;">Aucun film disponible pour ${v.planDayName}. Un film n'apparaît que si son « jour de planning » inclut ce jour (réglable dans les propriétés du film, onglet Playlist).</p>`}
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Semaine ${v.planWeek} · ${v.planDayName} — moments</h3>
          <span style="font-size:11.5px;color:${v.planSaving ? '#8A847C' : '#2E6E4E'};">${v.planSaving ? 'Enregistrement…' : '✓ Enregistré automatiquement'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">
          ${v.planCols.map((col) => html`
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="display:flex;align-items:center;gap:7px;">
                  <span style="font-size:13px;font-weight:700;color:#232220;">${col.label}</span>
                  <span title="Films dans ce moment (5 max)" style="font-size:10.5px;font-weight:700;color:${col.full ? '#8D1D2C' : '#8A847C'};background:${col.full ? 'rgba(141,29,44,0.1)' : 'rgba(35,34,32,0.06)'};border-radius:999px;padding:2px 8px;">${col.count}/${col.max}</span>
                </span>
                <span style="display:flex;align-items:center;gap:4px;">
                  <input value=${col.from} onInput=${col.onFrom} style="width:62px;padding:5px 7px;font-size:12px;text-align:center;border:1px solid rgba(35,34,32,0.16);border-radius:7px;background:#FBF8F2;" />
                  <span style="color:#8A847C;font-size:12px;">→</span>
                  <input value=${col.to} onInput=${col.onTo} style="width:62px;padding:5px 7px;font-size:12px;text-align:center;border:1px solid rgba(35,34,32,0.16);border-radius:7px;background:#FBF8F2;" />
                </span>
              </div>
              <div class="pl-item" onDragOver=${col.onDragOver} onDragLeave=${col.onDragLeave} onDrop=${col.onDrop}
                style="min-height:96px;border-radius:12px;border:2px dashed ${col.films.length ? 'rgba(35,34,32,0.14)' : 'rgba(35,34,32,0.2)'};background:${col.films.length ? '#fff' : '#FBF8F2'};display:flex;flex-direction:column;gap:7px;padding:12px;">
                ${col.films.map((f) => html`
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;background:${f.color}10;border-left:4px solid ${f.color};">
                    <span style="font-size:10px;font-weight:700;color:${f.color};opacity:0.75;">${f.order}</span>
                    <div style="flex:1 1 auto;min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:${f.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</div>
                      <div style="font-size:10px;color:#8A847C;">${f.count} module(s)</div>
                    </div>
                    <button onClick=${f.remove} title="Retirer" style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:#8D1D2C;">✕</button>
                  </div>
                `)}
                ${col.films.length
                  ? (col.full
                    ? html`<div style="font-size:10.5px;color:#8D1D2C;text-align:center;padding:3px;">${col.max} films max atteint — retires-en un pour changer</div>`
                    : html`<div style="font-size:10.5px;color:#B8B2A8;text-align:center;padding:3px;">＋ glisse un autre film (joué à la suite)</div>`)
                  : html`<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-size:12px;color:#B8B2A8;">Glisse un film ici — ou utilise « ＋ ajouter » ci-dessous (5 max)</div>`}
              </div>
              ${!col.full && col.addFilms.length ? html`
                <select onChange=${col.onAdd} title="Ajouter un film sans glisser" style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:12.5px;border:1px solid rgba(141,29,44,0.25);border-radius:9px;background:#FBF8F2;color:#8D1D2C;cursor:pointer;">
                  <option value="">＋ ajouter un film…</option>
                  ${col.addFilms.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                </select>
              ` : ''}
            </div>
          `)}
        </div>
        <p style="margin:12px 0 0;font-size:11.5px;color:#8A847C;">Glisse les films sur un moment, ou ajoute-les avec le menu « ＋ ajouter » (jusqu'à 5 par moment, enchaînés en boucle). Les fenêtres horaires sont communes à tous les magasins et à toutes les semaines.</p>
      </div>

      <!-- Liens des écrans (semaine active diffusée en direct) -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <h3 style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Liens des écrans</h3>
        <p style="margin:0 0 12px;font-size:11.5px;color:#8A847C;">Un lien par magasin, à mettre sur l'écran. Il diffuse en direct la <strong>semaine active (${v.planActiveWeek})</strong>, le bon film selon le jour et l'heure.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${v.planStoreLinks.map((l) => html`
            <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);">
              <span style="flex:0 0 150px;font-size:13px;font-weight:600;">${l.store}</span>
              <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:7px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:7px;background:#fff;" />
              <button onClick=${() => v.copyLink(l.url)} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Copier</button>
              <a href=${l.url} target="_blank" style="flex:0 0 auto;font-size:12px;font-weight:600;color:#8D1D2C;">↗</a>
            </div>
          `)}
        </div>
      </div>
      `}

      <!-- Jours de planning des films (déplacé depuis le formulaire du film) · toujours visible -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Jours de planning des films</h3>
          ${infoTip('Quels films sont PROPOSÉS quel jour quand tu remplis le planning ci-dessus (ex. « Crêpes » = mercredi). Purement un filtre d’organisation : ça ne change pas quand un film est diffusé (ça, c’est « Jours de diffusion », réglé sur le film). Un film coché sur tous les jours est proposé tous les jours.')}
        </div>
        <p style="margin:0 0 12px;font-size:12px;color:#8A847C;">Coche les jours où chaque film doit apparaître dans le sélecteur du planning. Décoche pour le masquer ce jour-là.</p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse;width:100%;min-width:460px;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:7px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8A847C;border-bottom:1px solid rgba(35,34,32,0.12);">Film</th>
              ${v.planDayTabs.map((d) => html`<th style="padding:7px 8px;font-size:11px;text-transform:uppercase;color:#8A847C;border-bottom:1px solid rgba(35,34,32,0.12);text-align:center;width:52px;">${d.label}</th>`)}
            </tr></thead>
            <tbody>
              ${v.planDayMatrix.map((p) => html`
                <tr>
                  <td style="padding:6px 10px;border-bottom:1px solid rgba(35,34,32,0.06);white-space:nowrap;">${p.name}${p.mode === 'continu' ? html` <span style="font-size:9.5px;font-weight:700;color:#6E4A2B;background:rgba(110,74,43,0.1);border-radius:999px;padding:1px 6px;">🔄 continu</span>` : ''}</td>
                  ${p.days.map((d) => html`<td style="padding:4px 8px;border-bottom:1px solid rgba(35,34,32,0.06);text-align:center;">
                    <button onClick=${d.toggle} title=${d.on ? 'Proposé ce jour — cliquer pour masquer' : 'Masqué ce jour — cliquer pour proposer'} style="width:30px;height:28px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid ${d.on ? 'rgba(46,110,78,0.4)' : 'rgba(35,34,32,0.14)'};background:${d.on ? 'rgba(46,110,78,0.14)' : '#FBF8F2'};color:${d.on ? '#2E6E4E' : '#C9C3B8'};">${d.on ? '✓' : '·'}</button>
                  </td>`)}
                </tr>
              `)}
            </tbody>
          </table>
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
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid rgba(35,34,32,0.06);background:#fff;">
            <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;">Coordonnées</span>
            ${infoTip('Alimentent les champs dynamiques des gabarits, résolus PAR MAGASIN à la diffusion : {{adresse}}, {{horaires}}, {{tel}} et {{magasin}} (le nom). Un seul gabarit affiche ainsi les bonnes infos selon le point de vente. Enregistré en quittant le champ.')}
            <input key=${'ad-' + s.id} defaultValue=${s.address} onChange=${s.setAddress} placeholder="Adresse — {{adresse}}" title="Adresse du magasin — jeton {{adresse}}" style="flex:2 1 220px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
            <input key=${'hr-' + s.id} defaultValue=${s.hours} onChange=${s.setHours} placeholder="Horaires — {{horaires}}" title="Horaires d'ouverture — jeton {{horaires}}" style="flex:1 1 160px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
            <input key=${'ph-' + s.id} defaultValue=${s.phone} onChange=${s.setPhone} placeholder="Téléphone — {{tel}}" title="Téléphone — jeton {{tel}}" style="flex:1 1 140px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid rgba(35,34,32,0.14);border-radius:8px;background:#FBF8F2;" />
          </div>
          <div style="padding:12px 22px;border-bottom:1px solid rgba(35,34,32,0.06);background:#FBF8F2;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;${s.groups.length ? 'margin-bottom:10px;' : ''}">
              <div style="display:flex;align-items:center;gap:7px;">
                <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;">Groupes d'écrans</span>
                ${infoTip('Grands magasins : plusieurs écrans/zones, chacun avec SON combo d’écrans et SON filtre de catégories. Une zone diffuse en boucle SES catégories TOUTE LA JOURNÉE (sans moment ni saison). Rattache un écran à une zone dans sa ligne (menu « Film du magasin / zone ») ; un écran sans zone suit le film du magasin. Aucune catégorie cochée = la zone suit le film du magasin (utile pour un simple sous-écran à part).')}
              </div>
              <button onClick=${s.addGroup} style="padding:6px 12px;font-size:12px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.3);border-radius:999px;cursor:pointer;">+ Ajouter une zone</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${s.groups.map((g) => html`
                <div key=${g.id} style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid rgba(35,34,32,0.1);border-radius:10px;padding:8px 11px;">
                  <input key=${'gn-' + g.id} defaultValue=${g.name} onChange=${g.onName} placeholder="Nom de la zone" style="flex:1 1 140px;min-width:0;padding:6px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.14);border-radius:7px;background:#FBF8F2;" />
                  <span style="display:flex;align-items:center;gap:4px;">
                    <select value=${g.fmt.screens} onChange=${g.onScreens} title="Nombre d'écrans de la zone" style="padding:6px 7px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:7px;background:#fff;cursor:pointer;">${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}</select>
                    <span style="font-size:11px;color:#8A847C;">×</span>
                    <select value=${g.fmt.size} onChange=${g.onSize} title="Diagonale d'une dalle" style="padding:6px 7px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:7px;background:#fff;cursor:pointer;">${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}</select>
                    <select value=${g.fmt.orient} onChange=${g.onOrient} title="Orientation" style="padding:6px 7px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:7px;background:#fff;cursor:pointer;"><option value="portrait">portrait</option><option value="paysage">paysage</option></select>
                    <span style="font-size:11px;font-weight:700;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:3px 8px;">${g.fmt.px}</span>
                  </span>
                  <span style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1 1 200px;">
                    <span style="font-size:10.5px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#8A847C;">Catégories :</span>
                    ${g.catChips.map((c) => html`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.28);border-radius:999px;padding:2px 5px 2px 9px;">${c.name}<button onClick=${c.remove} style="width:15px;height:15px;border-radius:50%;border:none;background:rgba(110,74,43,0.18);color:#6E4A2B;cursor:pointer;font-size:9px;line-height:1;">✕</button></span>`)}
                    ${g.catChips.length ? '' : html`<span style="font-size:11px;color:#B8860B;">aucune = suit le film du magasin</span>`}
                    ${g.addableCats.length ? html`<select onChange=${g.onAddCat} style="padding:4px 7px;font-size:11.5px;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#fff;cursor:pointer;"><option value="">+ catégorie…</option>${g.addableCats.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>` : ''}
                  </span>
                  <a href=${g.previewUrl} target="_blank" title="Aperçu de la zone (boucle catégories)" style="font-size:11.5px;font-weight:600;color:#8D1D2C;flex:0 0 auto;">↗ Aperçu</a>
                  <button onClick=${g.del} title="Supprimer la zone" style="flex:0 0 auto;width:28px;height:28px;border-radius:7px;border:1px solid rgba(35,34,32,0.12);background:#fff;cursor:pointer;font-size:12px;color:#8D1D2C;">✕</button>
                </div>
              `)}
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
                    ${p.groupOptions.length ? html`<select value=${p.groupId} onChange=${p.setGroup} title="Zone d'écrans de ce magasin, ou film du magasin" style="margin-top:5px;max-width:190px;padding:4px 7px;font-size:11px;font-weight:600;border:1px solid ${p.groupId ? 'rgba(110,74,43,0.4)' : 'rgba(35,34,32,0.16)'};border-radius:7px;background:${p.groupId ? 'rgba(110,74,43,0.08)' : '#FBF8F2'};color:${p.groupId ? '#6E4A2B' : '#4A4640'};cursor:pointer;">
                      <option value="">🏬 Film du magasin</option>
                      ${p.groupOptions.map((g) => html`<option value=${g.id}>▦ ${g.name}</option>`)}
                    </select>` : ''}
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

  ${v.isHomeView && html`
  <div style="flex:1 1 auto;overflow:auto;padding:26px 32px 48px;">
    <div style="max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:18px;">
      <div>
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:600;color:#232220;">Bienvenue dans la régie 👋</h1>
        <p style="margin:0;font-size:13.5px;color:#8A847C;">Voici où tu en es et ce qu'il te reste pour diffuser. ${home.count === home.total ? 'Tout est prêt 🎉' : `${home.count}/${home.total} étapes prêtes.`}</p>
      </div>

      <!-- Ce qui passe maintenant -->
      <div style="background:linear-gradient(135deg,#2A2622,#3A332C);border-radius:18px;padding:20px 24px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-bottom:6px;">Ce qui passe maintenant</div>
          <div style="font-size:18px;font-weight:600;">${home.film ? home.film.name : 'Aucun film'} ${home.film && home.film.mode === 'continu' ? html`<span style="font-size:11px;font-weight:600;color:#F0D9B5;background:rgba(240,217,181,0.15);border-radius:999px;padding:2px 9px;margin-left:4px;">🔄 continu</span>` : ''}</div>
          <div style="font-size:12.5px;color:rgba(255,255,255,0.6);margin-top:4px;">Moment : <strong style="color:#fff;">${MOMENT_FULL[home.moment] || '—'}</strong> · Semaine active : <strong style="color:#fff;">${home.week}</strong> · Écrans : <strong style="color:#fff;">${home.online}/${home.screens}</strong> en ligne</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href=${new URL('film', location.href).toString()} target="_blank" style="padding:10px 16px;font-size:13px;font-weight:600;color:#232220;background:#fff;border-radius:999px;">▶ Voir la diffusion ↗</a>
        </div>
      </div>

      <!-- Prêt à diffuser ? -->
      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;">
        <h3 style="margin:0 0 14px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Prêt à diffuser ?</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${home.steps.map((s) => html`
            <div style="display:flex;align-items:center;gap:14px;padding:13px 15px;border-radius:12px;background:${s.ok ? 'rgba(46,110,78,0.06)' : (s.soft ? '#FBF8F2' : 'rgba(201,123,74,0.07)')};border:1px solid ${s.ok ? 'rgba(46,110,78,0.25)' : (s.soft ? 'rgba(35,34,32,0.1)' : 'rgba(201,123,74,0.3)')};">
              <span style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;font-size:15px;font-weight:700;background:${s.ok ? 'rgba(46,110,78,0.15)' : 'rgba(35,34,32,0.06)'};color:${s.ok ? '#2E6E4E' : '#B8B2A8'};">${s.ok ? '✓' : (s.soft ? '○' : '!')}</span>
              <div style="flex:1 1 auto;min-width:0;">
                <div style="font-size:14px;font-weight:600;color:#232220;">${s.label}${s.soft && !s.ok ? html` <span style="font-size:11px;font-weight:500;color:#8A847C;">· optionnel</span>` : ''}</div>
                <div style="font-size:12px;color:#8A847C;">${s.hint}</div>
              </div>
              ${!s.ok && s.cta ? html`<button onClick=${s.cta.go} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:600;color:#fff;background:#8D1D2C;border:none;border-radius:999px;cursor:pointer;">${s.cta.label}</button>`
                : (s.cta ? html`<button onClick=${s.cta.go} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.08);border:1px solid rgba(110,74,43,0.25);border-radius:999px;cursor:pointer;">${s.cta.label}</button>` : '')}
            </div>
          `)}
        </div>
      </div>

      <!-- Actions rapides -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        <button onClick=${() => this.startFirstFilm()} style="text-align:left;padding:18px 20px;border-radius:16px;background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);cursor:pointer;">
          <div style="font-size:22px;margin-bottom:6px;">✨</div>
          <div style="font-size:14px;font-weight:700;color:#232220;">Créer un film continu</div>
          <div style="font-size:12px;color:#8A847C;margin-top:3px;">Une boucle prête, à adapter en quelques clics.</div>
        </button>
        <button onClick=${() => this.openOnboarding()} style="text-align:left;padding:18px 20px;border-radius:16px;background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);cursor:pointer;">
          <div style="font-size:22px;margin-bottom:6px;">📺</div>
          <div style="font-size:14px;font-weight:700;color:#232220;">Brancher un écran</div>
          <div style="font-size:12px;color:#8A847C;margin-top:3px;">Configure et connecte tes magasins pas à pas.</div>
        </button>
        <button onClick=${() => this.openSeasons()} style="text-align:left;padding:18px 20px;border-radius:16px;background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);cursor:pointer;">
          <div style="font-size:22px;margin-bottom:6px;">🗓️</div>
          <div style="font-size:14px;font-weight:700;color:#232220;">Périodes & données</div>
          <div style="font-size:12px;color:#8A847C;margin-top:3px;">Saisons, produit × moment, médias agence.</div>
        </button>
      </div>
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
          <div style="margin-top:8px;display:flex;align-items:center;gap:7px;font-size:11.5px;color:#8A847C;flex-wrap:wrap;">
            ${infoTip('Champs dynamiques : dans le titre ou le sous-titre, écris un jeton entre doubles accolades — il est remplacé PAR MAGASIN à la diffusion (un seul gabarit, les bonnes valeurs partout). Jetons : {{magasin}} (nom), {{adresse}}, {{horaires}}, {{tel}} (coordonnées saisies dans l’onglet Réseau) · {{date}} (date du jour) · {{saison}} (période active) · {{moment}} (matin/midi/après-midi). Ex. « Bienvenue à {{magasin}} ». Dans l’aperçu générique le jeton reste visible ; via le lien d’un magasin il est résolu.')}
            <span>Jetons dynamiques :</span>
            ${['{{magasin}}', '{{adresse}}', '{{date}}', '{{saison}}'].map((t) => html`<code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">${t}</code>`)}
            <span>…</span>
          </div>
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

        ${v.hasWatermark && html`
          <div style=${secCard}>
            ${secHead('watermark', 'Filigrane / filtre photo', v.watermarkSummary)}
            ${secOpen('watermark') && html`<div style=${secBody}>
            <p style="margin:0 0 12px;font-size:12px;color:#8A847C;line-height:1.5;">Superpose un filigrane à l'élément — surtout utile sur les photos : logo en filigrane, logo dans un coin, ou ruban « Nouveau ».</p>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
              ${v.watermarkOpts.map((o) => html`
                <button onClick=${o.pick} style="padding:11px 12px;font-size:13px;font-weight:600;border-radius:9px;cursor:pointer;${o.active ? 'background:#8D1D2C;color:#fff;border:1px solid #8D1D2C;' : 'background:#FBF8F2;color:#232220;border:1px solid rgba(35,34,32,0.14);'}">${o.label}</button>
              `)}
            </div>
            </div>`}
          </div>
        `}

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

        ${v.isMedia && html`
          <div style=${secCard}>
            ${secHead('media', 'Média ciblé — agence', 'moment + saison')}
            ${secOpen('media') && html`<div style=${secBody}>
            <div style="display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center;padding:6px 4px;">
              <div style="width:64px;height:64px;border-radius:16px;background:#1B1B1B;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;">🎯</div>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#4A4640;max-width:420px;">Cet élément diffuse <strong>automatiquement</strong> une vidéo ou photo de la <strong>médiathèque agence</strong>, <strong>tirée au sort</strong> parmi celles taguées pour le <strong>moment courant</strong> (matin/midi/soir, selon les fenêtres du planning) et une <strong>saison active</strong>. La pioche change à chaque diffusion — parfait pour surprendre le client tout en restant de saison.</p>
              <a href=${v.mediaAgencyUrl} target="_blank" style="font-size:13px;font-weight:600;color:#8D1D2C;">↗ Ouvrir l'espace Vidéo — Agence (upload et tags)</a>
              <p style="margin:0;font-size:11.5px;color:#8A847C;">Règle la <strong>durée</strong> à l'écran ci-dessus, et la <strong>mise en page</strong> (plein écran ou adapté). S'il n'y a aucun média éligible à l'instant, un écran repère « Média ciblé » s'affiche.</p>
            </div>
            </div>`}
          </div>
        `}

        ${v.isFilmEl && html`
          <div style=${secCard}>
            ${secHead('video', 'Vidéo', v.videoSummary)}
            ${secOpen('video') && html`<div style=${secBody}>
            <!-- bascule : vidéo unique / vidéo surprise (dossier serveur) -->
            <div style="display:inline-flex;background:#EFE9E0;border-radius:9px;padding:3px;margin-bottom:14px;">
              <button onClick=${() => { if (v.isSurprise) v.toggleSurprise(); }} style="padding:7px 14px;font-size:12.5px;font-weight:600;border:none;border-radius:7px;cursor:pointer;${!v.isSurprise ? 'background:#fff;color:#232220;box-shadow:0 1px 3px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}">Vidéo unique</button>
              <button onClick=${() => { if (!v.isSurprise) v.toggleSurprise(); }} style="padding:7px 14px;font-size:12.5px;font-weight:600;border:none;border-radius:7px;cursor:pointer;${v.isSurprise ? 'background:#fff;color:#6E4A2B;box-shadow:0 1px 3px rgba(0,0,0,0.08);' : 'background:transparent;color:#8A847C;'}">🎲 Vidéo surprise</button>
            </div>

            ${!v.isSurprise && html`
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
            `}

            ${v.isSurprise && html`
              <p style="margin:0 0 12px;font-size:12px;color:#8A847C;line-height:1.5;">Le player pioche <strong>une vidéo au hasard</strong> dans le dossier serveur <code style="background:#EFE9E0;padding:1px 5px;border-radius:4px;">public/surprise/</code> à chaque diffusion — pour surprendre le client. Ajoute des vidéos ici (≤ 18 Mo) ou dépose-les directement dans le dossier par SFTP (gros fichiers).</p>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
                <span style="font-size:12.5px;font-weight:600;color:#6E4A2B;">🎲 ${v.surpriseList.length} vidéo(s) dans le dossier</span>
                <button onClick=${v.refreshSurprise} style="padding:6px 12px;font-size:12px;font-weight:600;color:#6E4A2B;background:rgba(110,74,43,0.1);border:1px solid rgba(110,74,43,0.3);border-radius:999px;cursor:pointer;">⟳ Rafraîchir</button>
              </div>
              ${v.surpriseList.length ? html`
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                  ${v.surpriseList.map((vid) => html`
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 11px;border-radius:9px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.1);">
                      <span style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎬 ${vid.name}</span>
                      <span style="display:flex;align-items:center;gap:9px;flex:0 0 auto;">
                        <span style="font-size:11px;color:#8A847C;">${Math.round((vid.size || 0) / 1024 / 1024 * 10) / 10} Mo</span>
                        <button onClick=${() => v.delSurprise(vid.name)} title="Supprimer du dossier" style="width:22px;height:22px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:#8D1D2C;">✕</button>
                      </span>
                    </div>
                  `)}
                </div>
              ` : html`<p style="margin:0 0 12px;font-size:12px;color:#B8B2A8;">Dossier vide — ajoute au moins une vidéo.</p>`}
              <label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;font-size:13px;font-weight:600;color:#6E4A2B;border:1px dashed rgba(110,74,43,0.45);border-radius:10px;background:rgba(110,74,43,0.05);cursor:${v.surpriseBusy ? 'wait' : 'pointer'};">
                <span style="font-size:16px;">⬆</span><span>${v.surpriseBusy ? 'Envoi…' : 'Ajouter des vidéos au dossier'}</span>
                <input type="file" accept="video/mp4,video/webm,video/*" multiple onChange=${v.onSurpriseFiles} style="display:none;" />
              </label>
            `}
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

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Bibliothèque de films — choisis une catégorie, puis un film à éditer</h3>
          <span style="font-size:12px;color:#8A847C;">film courant : <strong style="color:#232220;">${this.activeFilm().name}</strong> · ${v.timelineTotal} · ${v.moduleCount} module(s)</span>
        </div>
        ${filmSelector}
        ${filmModeToggle}
      </div>

      ${filmMode === 'continu' ? contPanel : html`
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
      </div>`}

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Rangement du film — catégorie & tags</h3>
        <div style="display:flex;gap:28px;flex-wrap:wrap;">
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:7px;">Catégorie</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmCatVals.map((c) => html`<button onClick=${c.pick} style=${c.style}><span style=${c.dotStyle}></span>${c.label}</button>`)}
            </div>
          </div>
          <div style="flex:1 1 260px;min-width:240px;">
            <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;margin-bottom:7px;">Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              ${v.filmTagVals.map((t) => html`
                <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 6px 5px 11px;font-size:12px;font-weight:600;border-radius:999px;background:#EFE9E0;border:1px solid rgba(35,34,32,0.12);">#${t.label}
                  <button onClick=${t.remove} title="Retirer le tag" style="display:flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:10px;color:#8D1D2C;">✕</button>
                </span>`)}
              <input value=${v.filmTagInput} onInput=${v.onFilmTagInput} onKeyDown=${v.onFilmTagKey} placeholder="+ tag (Entrée)" style="flex:0 1 140px;min-width:110px;padding:6px 10px;font-size:12px;border:1px solid rgba(35,34,32,0.16);border-radius:999px;background:#FBF8F2;" />
            </div>
          </div>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">Programmation & magasins du film</h3>
            ${infoTip('Priorité : si un magasin a un PLANNING (onglet Planning) qui couvre l’heure courante, c’est le planning qui décide quel film passe sur cet écran. Sinon, ces réglages-ci s’appliquent (jours + fenêtre horaire + magasins ciblés à la publication). En clair : le planning gagne quand il existe, le film sert de réglage par défaut.')}
          </span>
          <span style="font-size:12px;color:#8A847C;">${v.filmSchedSummary}</span>
        </div>
        <div style="display:flex;gap:28px;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
              <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8A847C;">Jours de diffusion</span>
              ${infoTip('Quand le film PASSE réellement à l’écran. Hors de ces jours, l’écran affiche l’attente. À ne pas confondre avec les « Jours de planning » (dans l’onglet Planning), qui ne servent qu’à filtrer les films proposés lors du remplissage du planning hebdo.')}
            </div>
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

      ${previewBlock}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-items:start;">
        ${diffusionBlock}
        <div style="background:#FFFFFF;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;">
          <h3 style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">3 · Diffuser</h3>
          <p style="margin:0 0 14px;font-size:12px;color:#8A847C;line-height:1.55;">Un seul geste : <strong>Diffuser</strong>. La <strong>programmation</strong> et les <strong>magasins</strong> se règlent ci-dessus, sur le film ; le lien de visionnage s'affiche juste après.</p>
          <button onClick=${v.openPublish} style="width:100%;box-sizing:border-box;padding:14px 18px;font-size:15px;font-weight:700;border-radius:999px;border:none;cursor:pointer;background:#8D1D2C;color:#fff;">🚀 Diffuser sur le réseau ↗</button>
          <div style="margin-top:9px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:#8A847C;">
            <span>${v.saved ? '✓ Enregistré automatiquement' : (v.dirty ? '✎ Modifications en cours…' : 'Enregistré automatiquement')}</span>
            <button onClick=${v.save} style="padding:4px 10px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid rgba(35,34,32,0.16);background:#fff;color:#5B564E;cursor:pointer;">Enregistrer maintenant</button>
          </div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(35,34,32,0.08);font-size:11.5px;color:#8A847C;line-height:1.5;">Lien direct de ce film (55″) :
            <button onClick=${() => this.copyLink(this.filmUrl({ film: st.activePl, w: 3840, h: 2160 }))} style="margin-left:6px;padding:8px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Copier le lien</button>
            <a href=${this.filmUrl({ film: st.activePl, w: 3840, h: 2160 })} target="_blank" style="margin-left:6px;font-size:12px;font-weight:600;">↗ Ouvrir</a>
          </div>
        </div>
      </div>

    </div>
  </div>
  `}

  ${v.onbOpen && html`
    <div onClick=${v.closeOnb} style="position:fixed;inset:0;background:rgba(20,15,12,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:50;">
      <div onClick=${(e) => e.stopPropagation()} style="width:900px;max-width:95vw;max-height:90vh;overflow:auto;background:#FBF8F2;border-radius:20px;padding:24px 26px;box-shadow:0 30px 80px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <h2 style="margin:0;font-size:19px;font-weight:600;">🎓 Mise en route</h2>
          <button onClick=${v.closeOnb} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:#EFE9E0;border:1px solid rgba(35,34,32,0.12);cursor:pointer;font-size:14px;">✕</button>
        </div>
        <p style="margin:0 0 16px;font-size:12.5px;color:#8A847C;">Configure chaque magasin pas à pas : écran, langue, test, lien. ${v.onbDoneCount}/${v.onbCount} magasin(s) prêt(s).</p>
        ${v.onbStores.length ? html`
        <div style="display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start;">
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${v.onbStores.map((s) => html`
              <button onClick=${s.pick} style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 13px;border-radius:11px;cursor:pointer;text-align:left;background:${s.on ? '#fff' : 'rgba(255,255,255,0.5)'};border:1px solid ${s.on ? '#8D1D2C' : 'rgba(35,34,32,0.1)'};">
                <span style="font-size:13.5px;font-weight:600;">${s.name}</span>
                <span style="font-size:14px;color:${s.done ? '#2E7D32' : '#C9C3B8'};">${s.done ? '✓' : '○'}</span>
              </button>
            `)}
          </div>
          ${v.onbSel && html`
          <div style="display:flex;flex-direction:column;gap:14px;">

            <div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">1 · Écran — ${v.onbSel.name}</h3>
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8A847C;">Combo</span>
                <select value=${v.onbSel.fmt.screens} onChange=${v.onbSel.setScreens} style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                  ${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}
                </select>
                <span style="font-size:12px;color:#8A847C;">×</span>
                <select value=${v.onbSel.fmt.size} onChange=${v.onbSel.setSize} style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                  ${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}
                </select>
                <select value=${v.onbSel.fmt.orient} onChange=${v.onbSel.setOrient} style="padding:7px 9px;font-size:12.5px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:8px;background:#FBF8F2;cursor:pointer;">
                  <option value="paysage">paysage</option>
                  <option value="portrait">portrait</option>
                </select>
                <span style="font-size:12.5px;font-weight:700;color:#8D1D2C;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:5px 12px;">= ${v.onbSel.fmt.px}</span>
              </div>
              <div style="margin-top:11px;padding:11px 13px;border-radius:10px;background:${v.onbSel.is4k ? 'rgba(184,134,11,0.08)' : 'rgba(46,110,78,0.07)'};border:1px solid ${v.onbSel.is4k ? 'rgba(184,134,11,0.3)' : 'rgba(46,110,78,0.25)'};">
                <div style="font-size:12px;font-weight:600;color:${v.onbSel.is4k ? '#8a6508' : '#2E6E4E'};margin-bottom:4px;">📶 Débit conseillé — ${v.onbSel.bwReco}</div>
                <div style="font-size:11.5px;color:#8A847C;line-height:1.5;">Repère : 4K H.264 ≈ 25–50 Mbps · 4K H.265/HEVC ≈ 15–25 Mbps · 1080p ≈ 5–10 Mbps. Ça compte surtout pour les <strong>films avec vidéo</strong> (élément Film) en lecture continue ; les menus (images) sont mis en cache sur l'écran et ne consomment qu'au premier chargement.</div>
              </div>
            </div>

            <div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">2 · Langue d'affichage</h3>
              <select value=${v.onbSel.lang} onChange=${v.onbSel.setLang} style="padding:8px 12px;font-size:13px;font-weight:600;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;cursor:pointer;text-transform:uppercase;">
                ${v.onbSel.langOptions.map((l) => html`<option value=${l.id}>${l.id} — ${l.label}</option>`)}
              </select>
              <span style="font-size:11.5px;color:#8A847C;margin-left:10px;">Les noms de produits s'affichent dans cette langue (alias de la table produits).</span>
            </div>

            <div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:16px 18px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
                <h3 style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">3 · Test de l'écran</h3>
                <button onClick=${v.onbSel.runTest} style="padding:8px 15px;font-size:12.5px;font-weight:600;border-radius:999px;border:1px solid #2E6E4E;background:rgba(46,110,78,0.08);color:#2E6E4E;cursor:pointer;">${v.onbSel.test && v.onbSel.test.state === 'testing' ? 'Test…' : '▶ Tester'}</button>
              </div>
              ${v.onbSel.test && v.onbSel.test.state === 'ok' && html`
                <div style="font-size:12.5px;color:#2E7D32;line-height:1.6;">✓ Lien OK — sert « <strong>${v.onbSel.test.name}</strong> »${v.onbSel.test.plan ? ` (planning : ${v.onbSel.test.plan})` : ''} · ${v.onbSel.test.modules} élément(s) · rendu ${v.onbSel.test.px}${v.onbSel.test.draft ? ' · brouillon (pas encore publié)' : ''}</div>
              `}
              ${v.onbSel.test && v.onbSel.test.state === 'err' && html`<div style="font-size:12.5px;color:#8D1D2C;">✗ ${v.onbSel.test.error}</div>`}
              ${!v.onbSel.test && html`<div style="font-size:12px;color:#8A847C;">Clique « Tester » pour vérifier que le lien du magasin répond et voir ce qu'il diffuse.</div>`}
            </div>

            <div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">4 · Lien à mettre sur l'écran</h3>
              <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
                <div style="flex:0 0 auto;text-align:center;">
                  <img src=${qrDataUri(v.onbSel.link)} alt="QR du lien écran" style="width:140px;height:140px;display:block;border:1px solid rgba(35,34,32,0.1);border-radius:10px;background:#fff;" />
                  <div style="font-size:10.5px;color:#8A847C;margin-top:5px;">📱 Scanne pour ouvrir sur l'écran</div>
                </div>
                <div style="flex:1 1 260px;min-width:220px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input readonly value=${v.onbSel.link} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 11px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:8px;background:#FBF8F2;" />
                    <button onClick=${v.onbSel.copyLink} style="flex:0 0 auto;padding:8px 14px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:#8D1D2C;cursor:pointer;">⎘ Copier</button>
                    <a href=${v.onbSel.link} target="_blank" style="flex:0 0 auto;font-size:12px;font-weight:600;color:#8D1D2C;">↗</a>
                  </div>
                  <p style="margin:8px 0 0;font-size:11.5px;color:#8A847C;">Ouvre ce lien en plein écran sur l'écran du magasin (mode kiosque), ou scanne le QR depuis la box/TV. Il bascule tout seul selon l'heure si tu as fait un Planning.</p>
                </div>
              </div>
            </div>

            <button onClick=${v.onbSel.toggleDone} style="align-self:flex-start;padding:10px 20px;font-size:13px;font-weight:600;border-radius:999px;cursor:pointer;${v.onbSel.done ? 'background:rgba(46,125,50,0.12);color:#2E7D32;border:1px solid rgba(46,125,50,0.4);' : 'background:#232220;color:#fff;border:none;'}">${v.onbSel.done ? '✓ Magasin configuré — annuler' : 'Marquer ce magasin comme configuré'}</button>

          </div>
          `}
        </div>
        ` : html`<p style="margin:0;font-size:13px;color:#8A847C;">Aucun magasin actif. Fais ⚙ Paramètres → ⟳ Rafraîchir pour importer tes magasins, ou branche un écran.</p>`}
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
