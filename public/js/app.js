// Back office « Régie d'affichage » — port fidèle de la maquette Back Office.dc.html,
// câblé sur l'API du CMS (tables SQLite préfixées sig_).
import { html, h, render, Component } from './vendor/preact-htm.js';
import {
  RUBY, INK, FUI, W, H, LIAISON_DUR, LAYOUTS, MOTIONS,
  clx, fmtTime, newTag, newSched, newPos,
  activeItems as rActiveItems, moduleDur as rModuleDur, renderModule, playable, animAssetKind,
  BRAND_COLORS, brandColorName, tfbPromoLabel,
} from './renderer.js';
// Config du mode « continu » : source unique partagée avec le serveur.
import { continuousDefaults, normContinuous } from './continuous.js';
// Internationalisation de l'interface (FR / EN / IT), choix par navigateur.
import { UI_LANGS, UI_LANG_IDS, tr } from './i18n.js';
import { openCampaignWizard, renderCampaignWizard } from './campaign-wizard.js';
// Gabarits HTML : formats source (16:9, 9:16, A1…), variables et exemple.
import { HTML_PRESETS, HTML_TOKENS, HTML_VAR_SOURCES, HTML_BRAND_VARS, HTML_ASSETS, htmlVarNames, wrapHtmlVarPos, applyHtmlVarPositions } from './html-templates.js';
// Générateur de QR code autonome (pour brancher un écran en scannant).
import { qrSvg } from './vendor/qr.js';
const qrDataUri = (url) => { try { return 'data:image/svg+xml;utf8,' + encodeURIComponent(qrSvg(String(url), { scale: 5, margin: 3 })); } catch { return ''; } };
// Langue de l'interface : lue depuis localStorage (repli sur le français).
const readUiLang = () => {
  try { const v = localStorage.getItem('sig_ui_lang'); if (v && UI_LANG_IDS.includes(v)) return v; } catch { /* pas de localStorage */ }
  return 'fr';
};
// Coquille du module Marketing : la régie y est le « Marketing en magasin ».
// Affichée dans le cadre du module (/marketing → Marketing en magasin), elle
// n'a pas de menu latéral à elle — celui du module est déjà à gauche — et ses
// écrans passent en onglets sous la barre supérieure. `?embed=1` force ce
// mode, comme pour les écrans du module Social.
const EMBEDDED = (() => {
  try { return new URLSearchParams(location.search).get('embed') === '1' || window.self !== window.top; } catch { return true; }
})();
// Icônes linéaires 24 px, même famille que le menu du module Marketing.
const ICON = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  play: 'M6 4l14 8-14 8z',
  home: 'M3 10.5L12 3l9 7.5V21h-6v-6H9v6H3z',
  composer: 'M4 3h16v18H4zM8 3v18M16 3v18M4 8h4M4 13h4M4 18h4M16 8h4M16 13h4M16 18h4',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  screens: 'M3 4h18v12H3zM8 20h8M12 16v4',
  products: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  seasons: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  translations: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9M12 3C9.5 5.5 8.5 8.5 8.5 12s1 6.5 3.5 9',
  promotions: 'M19 5L5 19M7 7a1.5 1.5 0 1 0 .01 0M17 17a1.5 1.5 0 1 0 .01 0',
  campaigns: 'M3 11l14-7v16L3 13zM7 14v5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  onboarding: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5v7l5.5-3.5z',
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h1',
  check: 'M20 6L9 17l-5-5',
  euro: 'M17 6.5A7 7 0 1 0 17 17.5M4 10h10M4 14h10',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  store: 'M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6M3 9h18',
  ticket: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 6v12',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  image: 'M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  ok: 'M20 6L9 17l-5-5',
};
const metaIcon = (d) => html`<span style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:var(--muted);">${icon(d, 13)}</span>`;
// Familles TFBuddy habillées par un style de badge (miroir de TFB_FAMILIES,
// serveur) : une remise programmée sur créneaux est la famille « happy hour ».
const TFB_FAMILIES = ['bundle', 'buy_x_get_y', 'quantity', 'happy_hour', 'scheduled_discount', 'voucher'];
// Badge d'une promotion tel qu'à l'écran (icône · libellé, couleur du style).
const badgePill = (b) => html`<span data-badge style="display:inline-flex;align-items:center;gap:6px;padding:4px 11px 4px 9px;border-radius:999px;font-size:11px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#fff;background:${b.color};flex:0 0 auto;white-space:nowrap;"><span style="font-size:13px;line-height:1;">${b.icon}</span>${b.name}</span>`;
const icon = (d, size = 16) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} /></svg>`;
// Écrans de la régie, regroupés comme le menu du module Marketing.
// `view` : un écran ; `act` : une action (mise en route, rapport).
const SHELL_GROUPS = [
  { label: 'shell.grpBroadcast', items: [
    { view: 'home', label: 'nav.home', icon: ICON.home },
    { view: 'campaignVideo', label: 'nav.campaignVideo', icon: ICON.play },
    { view: 'composer', label: 'nav.composer', icon: ICON.composer },
    { view: 'planning', label: 'nav.planning', icon: ICON.calendar },
    { view: 'fleet', label: 'nav.fleet', icon: ICON.screens },
  ] },
  { label: 'shell.grpContent', items: [
    { view: 'products', label: 'nav.products', icon: ICON.products },
    { view: 'seasons', label: 'nav.seasons', icon: ICON.seasons },
    { view: 'translations', label: 'nav.translations', icon: ICON.translations },
    { view: 'media', label: 'nav.media', icon: ICON.image },
  ] },
  { label: 'shell.grpCampaigns', items: [
    { view: 'promotions', label: 'nav.promotions', icon: ICON.promotions },
    { view: 'campaigns', label: 'nav.campaigns', icon: ICON.campaigns },
  ] },
  { label: 'shell.grpSettings', items: [
    { view: 'settings', label: 'settings.title', icon: ICON.settings },
    { act: 'onboarding', label: 'shell.onboarding', icon: ICON.onboarding },
    { act: 'report', label: 'shell.report', icon: ICON.report },
  ] },
];
const SHELL_VIEWS = SHELL_GROUPS.flatMap((g) => g.items.filter((it) => it.view));

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
// Colonnes du compositeur (bibliothèque · éditeur · aperçu), à côté du menu
// latéral du module : l'aperçu y prend la largeur de sa colonne, 560 px au plus.
const COMPOSER_COLS = { lib: 280, editorMin: 320, previewMin: 420, previewFr: 1.1 };
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const SLOTS = [
  { label: 'Matin', from: '06:00', to: '11:00' },
  { label: 'Midi', from: '11:00', to: '14:00' },
  { label: 'Après-midi', from: '15:00', to: '19:00' },
  { label: 'Toute la journée', from: '00:00', to: '23:59' },
];
// Catégories de bibliothèque — chaque tag a sa couleur.
// Les catégories de la bibliothèque vivent en base (table sig_lib_categories,
// éditable dans les Paramètres) : voir App.libCatList() / App.libCatOf().

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

// Tag de période d'une entité (promotion, campagne) : trois cases matin / midi
// / après-midi qui cyclent visible → exclu → vide. Même vocabulaire et mêmes
// règles que la table « Périodes de vente » des produits et des catégories.
const MOMENT_TAG_TIP = 'Périodes de la journée où cette fiche peut passer sur les écrans. Clique pour cycler : visible → exclue → vide. Aucune case = elle passe à tous les moments. Enregistré tout de suite.';
const momentTagCells = (cells) => html`
  <span style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;">
    <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Périodes</span>
    ${infoTip(MOMENT_TAG_TIP)}
    ${cells.map((c) => html`
      <button key=${c.moment} onClick=${c.toggle} title=${c.state === 'incl' ? 'Visible à ce moment' : (c.state === 'excl' ? 'Exclue à ce moment' : 'Aucune règle')} style="padding:4px 10px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;${c.state === 'incl' ? 'border:1px solid var(--green);background:rgba(63,122,82,0.12);color:var(--green);' : (c.state === 'excl' ? 'border:1px solid var(--accent);background:rgba(141,29,44,0.10);color:var(--accent);text-decoration:line-through;' : 'border:1px solid var(--line);background:#fff;color:var(--muted);')}">${c.label}</button>
    `)}
  </span>`;

// Nombre maximum de films par moment de la journée (planning).
const MAX_PLAN_FILMS = 5;

// Ratio de passage proposé quand on active un élément dans la boucle.
const LOOP_RATIO_DEF = 6;

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

// Envoi d'un fichier tel quel (sans base64), avec sa progression (0 → 1).
function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', apiUrl(path));
    x.withCredentials = true;
    x.setRequestHeader('content-type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText || '{}'); } catch { /* corps non JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(j);
      else { const e = new Error(j.error || `HTTP ${x.status}`); e.status = x.status; reject(e); }
    };
    x.onerror = () => reject(new Error('envoi interrompu (réseau)'));
    x.send(file);
  });
}

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
    uiLang: readUiLang(),
    authRequired: false, loginUser: 'admin', loginPass: '', loginError: '', loggingIn: false,
    secPerLine: 4, loop: true, playing: true, t: 0,
    dirty: false, saved: true, scope: 'module', clipboard: null, past: [], future: [],
    selId: null, playlist: [],
    playlists: [], activePl: null, editingFilm: false, editFilmName: '', libFilter: 'all',
    libOrient: 'paysage',
    filmFilter: 'all', filmTagInput: '',
    editingStore: null, editStoreName: '',
    view: 'home', composerTab: 'lib', publishing: false, deploying: false, version: 1, dataVer: 1, hbTick: 0, toast: '',
    pubTargets: {}, pubSlot: 'Toute la journée', pubWhen: 'now', activateAt: '', pubMode: 'full',
    pubDays: [true, true, true, true, true, true, true], pubDone: null, pubFilm: null,
    // Assistant vidéo de campagne (public/js/campaign-wizard.js) : son état.
    cw: null,
    override: false,
    srvUrl: '', srvIp: '', srvToken: '',
    // Stockage de la médiathèque (OVHcloud Object Storage, ou ce serveur).
    mediaStore: null, mediaStoreBusy: false, mediaMaxMb: 4096,
    test: { state: 'idle', rows: [] },
    fleet: [],
    library: [],
    elementTypes: [], addPicker: false, openSec: ['items'],
    animBusy: false,   // upload d'un fichier d'animation en cours
    htmlVarSel: '', filmMomentSel: '',
    promoTypes: [], promoDraft: null, promoDirty: false, promoBusy: false, promoSavedAt: 0,
    // Style des badges : famille TFBuddy → sous-type qui l'habille ('' = maison).
    tfbBadges: {}, badgeBusy: false,
    // Source du catalogue : dernier import (API TFBuddy, ou base PWA en secours).
    catImport: null, catImportBusy: false,
    // Catégories de la bibliothèque : éditables dans les Paramètres (nom,
    // couleur, table de la régie qui les alimente).
    libCats: [], libSources: [], libCatDraft: null, libCatDirty: false, libCatBusy: false,
    // « Régie → Apparition… » : le résumé que l'ERP lit sur la fiche produit.
    appearance: null, appearanceBusy: false,
    // Matières premières : ingrédient ↔ animation de la bibliothèque.
    ingredients: [], ingDraft: null, ingDirty: false, ingBusy: false, ingDiag: null,
    // Suites montées à la main (intro, outro, présentation de gamme…).
    sequences: [], seqDraft: null, seqDirty: false, seqBusy: false, seqSel: null,
    campaigns: [], campaignDraft: null, campaignDirty: false, campaignBusy: false, campaignSavedAt: 0,
    catalog: { categories: [], products: [] },
    catDraft: null, catDirty: false, catSel: '', catSaving: false, langs: [], catLang: 'fr',
    pwaForm: null, pwaBusy: null, pwaResult: null,
    planWindows: [], planByStore: {}, planStores: [], planSlots: { matin: [], midi: [], aprem: [] },
    planBusy: false, planResult: null,
    planWeek: 'A', planDay: 0, planActiveWeek: 'A', planSaving: false, planSavedAt: 0,
    surpriseVideos: [], surpriseBusy: false,
    seasons: [], seasonsCurrent: [], seasonsDirty: false, seasonsBusy: false,
    wsTable: '', wsCandidates: [], wsInspected: [], wsDiag: null, mediaLib: [],
    mediaFilter: { kind: 'all', moment: 'all', product: '', season: '', q: '' }, mediaEdit: null,
    mediaUp: { open: false, moment: 'all', productId: '', seasonId: '', busy: false, pct: 0 },
    prodMoments: [], prodMomentsCurrent: '', prodMomentsDirty: false, prodMomentsBusy: false,
    pmCollapsed: {},
    contPreview: null, contPreviewBusy: false,
    onbOpen: false, onbStore: '', onbTest: {},
    onbDone: (() => { try { return JSON.parse(localStorage.getItem('sigOnbDone') || '[]'); } catch { return []; } })(),
  };

  // ---------------------------------------------------------------- lifecycle
  async componentDidMount() {
    window.addEventListener('resize', this._onResize);
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
    window.removeEventListener('resize', this._onResize);
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
      // Sous-types de promotion (happy hour, flash, bundle…) : dynamiques, en base.
      const pt = await api('GET', '/promo-types').catch(() => ({ promoTypes: [] }));
      // Campagnes marketing : liste d'entités à déposer comme item.
      const cmp = await api('GET', '/campaigns').catch(() => ({ campaigns: [] }));
      // Bundles TFBuddy : lus sur l'API TFBuddy par le serveur (synchro 30 min).
      const bdl = await api('GET', '/bundles').catch(() => ({ bundles: [], sync: {}, tfbuddy: {} }));
      // Catégories de la bibliothèque : le classement des éléments, en base.
      const lc = await api('GET', '/lib-categories').catch(() => ({ libCategories: [], libSources: [] }));
      // Matières premières : ingrédient ↔ animation.
      const ing = await api('GET', '/ingredients').catch(() => ({ ingredients: [] }));
      // Suites montées à la main (intro, outro, présentation de gamme…).
      const sq = await api('GET', '/sequences').catch(() => ({ sequences: [] }));
      const pwa = await api('GET', '/pwa-config').catch(() => null);
      const plan = await api('GET', '/plan').catch(() => ({ windows: [], byStore: {} }));
      const cim = await api('GET', '/catalog-import').catch(() => null);
      const playlists = ((Array.isArray(st.playlists) && st.playlists.length)
        ? st.playlists
        : [{ id: 'pl1', name: 'Film principal', items: st.playlist || [] }]).map((p) => this.normFilm(p));
      const activePl = playlists.some((p) => p.id === st.activePlaylistId)
        ? st.activePlaylistId
        : playlists[0].id;
      this.setState({
        loading: false, authRequired: false,
        library: st.modules,
        agencyEnabled: !!st.agencyEnabled,
        https: st.https || null,
        elementTypes: et.types || [],
        langs: lg.langs || [{ id: 'fr', label: 'Français' }],
        promoTypes: pt.promoTypes || [],
        campaigns: cmp.campaigns || [],
        bundles: bdl.bundles || [], bundleSync: bdl.sync || {}, tfbuddy: bdl.tfbuddy || {}, bundleStores: bdl.stores || [],
        tfbPromos: bdl.promos || [], tfbBadges: bdl.badges || {},
        catImport: cim,
        libCats: lc.libCategories || [], libSources: lc.libSources || [],
        ingredients: ing.ingredients || [],
        sequences: sq.sequences || [],
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
      this.loadMediaStore(); // stockage de la médiathèque (OVH ou ce serveur)
      this.loadMediaLib(); // médiathèque agence (vue admin)
      this.loadProdMoments(); // périodes de vente + moment courant (Accueil)
      this.refreshFleet();  // écrans (Accueil : « prêt à diffuser »)
      if (this.activeFilm().mode === 'continu') this.loadContPreview(); // aperçu réel de la boucle
    } catch (e) {
      if (e.status === 401) {
        // Dans le cadre du module Marketing, sa session suffit : pas de mot de
        // passe (une seule tentative par chargement ; sinon, connexion classique).
        if (EMBEDDED && !this._ssoTried) {
          this._ssoTried = true;
          const ok = await api('POST', '/sso/marketing').then(() => true, () => false);
          if (ok) return this.loadState();
        }
        this.setState({ loading: false, authRequired: true });
      } else if (e.status === 403) {
        // Session d'un compte magasin ou agence : chacun dans SON espace.
        const me = await api('GET', '/me').catch(() => null);
        if (me && me.role === 'magasin') { location.href = 'magasin'; return; }
        if (me && me.role === 'agence') { location.href = 'agence'; return; }
        this.setState({ loading: false, loadError: String(e.message || e) });
      } else this.setState({ loading: false, loadError: String(e.message || e) });
    }
  }

  async refreshFleet() {
    if (this.state.authRequired) return;
    try {
      const f = await api('GET', '/fleet');
      this.setState({ fleet: f.stores, version: f.version, dataVer: f.dataVer, override: f.override });
    } catch { /* serveur momentanément indisponible : on garde l'état local */ }
  }

  // Compte d'un magasin : création, nouveau mot de passe (montré une seule
  // fois), suppression. Le serveur génère le mot de passe.
  async storeAccount(storeId, action) {
    try {
      if (action === 'delete') {
        if (!window.confirm('Supprimer le compte de ce magasin ? Ses sessions ouvertes sont coupées.')) return;
        await api('DELETE', `/stores/${encodeURIComponent(storeId)}/account`);
        this.setState({ storeCred: null });
        this.showToast('Compte magasin supprimé ✓');
      } else {
        if (action === 'reset' && !window.confirm('Générer un nouveau mot de passe ? L\'ancien ne fonctionnera plus et les sessions ouvertes du magasin seront coupées.')) return;
        const out = await api('POST', `/stores/${encodeURIComponent(storeId)}/account`, {});
        this.setState({ storeCred: { storeId, username: out.username, password: out.password, url: new URL('magasin', location.href).toString() } });
      }
      this.refreshFleet();
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  doLogin = async (e) => {
    e.preventDefault();
    if (this.state.loggingIn) return;
    this.setState({ loggingIn: true, loginError: '' });
    try {
      const who = await api('POST', '/login', { username: this.state.loginUser, password: this.state.loginPass });
      if (who.role === 'magasin') { location.href = 'magasin'; return; }
      if (who.role === 'agence') { location.href = 'agence'; return; }
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

  // L'aperçu suit la largeur de sa colonne : on re-rend au redimensionnement.
  _onResize = () => {
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => { this._resizeRaf = 0; this.forceUpdate(); });
  };

  // Largeur de l'aperçu : 560 px dans l'onglet Playlist (pleine largeur) ;
  // dans l'onglet Bibliothèque, celle de la troisième colonne, moins ses
  // marges (section 2 × 26 px, cadre sombre 2 × 20 px).
  previewWidth() {
    if (this.state.composerTab !== 'lib') return PREVIEW_W;
    const content = window.innerWidth - (EMBEDDED ? 0 : 246);
    const free = content - COMPOSER_COLS.lib;
    const col = Math.max(COMPOSER_COLS.previewMin, free * COMPOSER_COLS.previewFr / (1 + COMPOSER_COLS.previewFr));
    return Math.max(300, Math.min(PREVIEW_W, Math.floor(col - 92)));
  }

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
    const sc = this._scale || SCALE;
    const dx = (e.clientX - d.x) / sc, dy = (e.clientY - d.y) / sc;
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
  // Badge de promotion résolu pour l'aperçu (icône · couleur · libellé du
  // sous-type), depuis la liste dynamique sig_promo_types.
  // Famille TFBuddy d'une promotion — miroir de tfbFamilyOf (serveur) : une
  // remise programmée sur créneaux (jours et heures) est la famille « happy hour ».
  tfbFamilyOf(p) {
    if (!p) return '';
    if (p.kind === 'scheduled_discount') return (p.schedule || []).length ? 'happy_hour' : 'scheduled_discount';
    return p.kind || '';
  }
  // Badge d'une famille : le sous-type choisi dans Promotions → Style des
  // badges ; null = badge maison (ou sous-type supprimé depuis).
  familyBadge(family) {
    const id = (this.state.tfbBadges || {})[family];
    const t = id ? (this.state.promoTypes || []).find((x) => x.id === id) : null;
    return t ? { type: t.id, name: t.name, icon: t.icon, color: t.color } : null;
  }
  // Badge montré en régie pour une famille : le style choisi, sinon le repli
  // — puce maison « 🎁 Bundle » rubis, ou le sous-type propre à chaque élément.
  familyBadgeShown(family) {
    return this.familyBadge(family) || (family === 'bundle'
      ? { icon: '🎁', name: this.t('tfb.kind.bundle'), color: '#8D1D2C', house: true }
      : { icon: '🏷️', name: this.t('badges.ownShort'), color: '#7a736a', house: true });
  }
  async setFamilyBadge(family, id) {
    if (this.state.badgeBusy) return;
    this.setState({ badgeBusy: true });
    try {
      const r = await api('PUT', '/tfb-badges', { badges: { [family]: id } });
      this.setState({ badgeBusy: false, tfbBadges: r.badges || {} });
      this.showToast(this.t('badges.saved'));
    } catch (e) { this.setState({ badgeBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  promoBadge(m) {
    if (!m || m.type !== 'promotion') return undefined;
    // Reliée à TFBuddy : le style choisi pour sa famille (comme à l'écran).
    if (m.tfbRef) {
      const p = (this.state.tfbPromos || []).find((x) => x.id === m.tfbRef);
      const fb = p && this.familyBadge(this.tfbFamilyOf(p));
      if (fb) return fb;
    }
    const t = (this.state.promoTypes || []).find((x) => x.id === m.promoType);
    return t
      ? { type: t.id, name: t.name, icon: t.icon, color: t.color }
      : { type: m.promoType || '', name: 'Offre', icon: '🏷️', color: '#C0392B' };
  }
  // Bundle TFBuddy résolu pour l'aperçu : ses produits viennent du catalogue
  // (prix de base — chaque magasin aura les siens à la diffusion).
  bundleInfo(m) {
    if (!m || m.type !== 'bundle') return null;
    const b = (this.state.bundles || []).find((x) => x.id === m.bundleRef);
    if (!b) return null;
    const prods = this.state.catalog.products || [];
    const items = (b.items || []).map((it) => {
      const p = it.productId ? prods.find((x) => x.id === it.productId) : null;
      return p
        ? { name: p.name, price: p.price, img: p.img, src: p.src, active: true, productId: p.id, qty: it.qty }
        : { name: it.name || `Produit ${it.extProductId}`, price: '', img: '', src: 'illus', active: true, qty: it.qty };
    });
    return { bundle: { id: b.id, name: b.name, descr: b.descr, price: b.price, img: b.img, slots: b.schedule, lang: 'fr' }, items, raw: b };
  }
  // Les créneaux d'un bundle, en mots : les jours qui se suivent avec les mêmes
  // heures sont groupés (« lun → ven · 06:00–11:00 ; sam, dim · 08:00–12:00 »).
  bundleWhen(schedule) {
    const D = this.t('bundles.days').split(',');
    const byDay = {};
    for (const x of schedule || []) {
      if (!(x.dow >= 1 && x.dow <= 7)) continue;
      (byDay[x.dow] = byDay[x.dow] || []).push(`${x.from}–${x.to}`);
    }
    const key = (d) => (byDay[d] || []).sort().join(' + ');
    const runs = [];
    for (let d = 1; d <= 7; d++) {
      const k = key(d);
      if (!k) continue;
      const last = runs[runs.length - 1];
      if (last && last.b === d - 1 && last.k === k) last.b = d; else runs.push({ a: d, b: d, k });
    }
    if (!runs.length) return this.t('bundles.always');
    return runs.map((r) => {
      const days = r.a === 1 && r.b === 7 ? this.t('bundles.everyDay')
        : r.b - r.a >= 2 ? `${D[r.a - 1]} → ${D[r.b - 1]}` : (r.b > r.a ? `${D[r.a - 1]}, ${D[r.b - 1]}` : D[r.a - 1]);
      return `${days} · ${r.k.replace(/00:00–23:59/g, this.t('bundles.allDay'))}`;
    }).join(' ; ');
  }
  bundleVals(m, isBundle) {
    const st = this.state;
    const eur = (n) => Number(n).toFixed(2).replace('.', ',');
    const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
    const qty = (q) => (Number(q) && Number(q) !== 1 ? `${String(q).replace('.', ',')}× ` : '');
    const prods = st.catalog.products || [];
    const storeName = (id) => (((st.bundleStores || []).find((x) => x.id === id) || (st.fleet || []).find((x) => x.id === id)) || {}).name || id;
    const describe = (b) => {
      const comp = (b.items || []).map((it) => {
        const p = it.productId ? prods.find((x) => x.id === it.productId) : null;
        return { label: `${qty(it.qty)}${p ? p.name : (it.name || `Produit ${it.extProductId}`)}`, missing: !p, price: p ? num(p.price) : null, q: Number(it.qty) || 1 };
      });
      const worth = comp.length && comp.every((c) => c.price != null) ? comp.reduce((t, c) => t + c.price * c.q, 0) : null;
      const unmapped = (b.shopIds || []).length - (b.storeIds || []).length;
      return {
        price: b.price != null ? `${eur(b.price)} €` : '—',
        worth: worth != null && b.price != null && worth - b.price >= 0.05 ? `${eur(worth)} €` : '',
        comp, when: this.bundleWhen(b.schedule),
        shops: b.scope === 'all' ? this.t('bundles.allShops')
          : `${(b.storeIds || []).map(storeName).join(', ') || '—'}${unmapped > 0 ? ` · ${this.t('bundles.shopsUnmapped', { n: unmapped })}` : ''}`,
        dates: b.dateFrom || b.dateTo ? `${b.dateFrom || '…'} → ${b.dateTo || '…'}` : '',
      };
    };
    const sync = st.bundleSync || {};
    const tfb = st.tfbuddy || {};
    const agoMin = sync.at ? Math.max(0, Math.round((Date.now() - Date.parse(sync.at)) / 60000)) : null;
    const ago = agoMin == null ? '' : agoMin < 1 ? this.t('bundles.justNow') : agoMin < 120 ? this.t('bundles.minAgo', { n: agoMin }) : this.t('bundles.hAgo', { n: Math.round(agoMin / 60) });
    const picked = isBundle ? (st.bundles || []).find((b) => b.id === m.bundleRef) : null;
    return {
      bundleOptions: (st.bundles || []).map((b) => ({
        id: b.id,
        label: `${b.status === 'ACTIVE' ? '🎁' : '⏸'} ${b.name}${b.price != null ? ` — ${eur(b.price)} €` : ''}${b.status !== 'ACTIVE' ? ` (${b.status.toLowerCase()})` : ''}`,
      })),
      curBundleRef: (m && m.bundleRef) || '',
      hasBundles: (st.bundles || []).length > 0,
      bundleSummary: isBundle ? ((picked && picked.name) || this.t('bundles.toPick')) : '',
      bundlePicked: picked ? { name: picked.name, status: picked.status, active: picked.status === 'ACTIVE', ...describe(picked) } : null,
      // Un seul passage sur la bibliothèque (deux setSelField d'affilée liraient
      // un état périmé) ; le nom suit le bundle tant qu'il n'a pas été personnalisé.
      onBundleRef: (e) => {
        const id = e.target.value;
        const b = (st.bundles || []).find((x) => x.id === id);
        const lib = this.cloneLib();
        const mm = lib.find((x) => x.id === st.selId);
        if (!mm) return;
        mm.bundleRef = id;
        if (b && (!mm.name || mm.name === 'Bundle' || (st.bundles || []).some((x) => x.name === mm.name))) mm.name = b.name;
        this.setLib(lib);
      },
      goBundles: () => this.openPromotions(),
      // -- page Promotions : la liste synchronisée --
      bundleRows: (st.bundles || []).map((b) => ({
        id: b.id, name: b.name, descr: b.descr, status: b.status, active: b.status === 'ACTIVE',
        voucher: b.activation === 'VOUCHER_ONLY', img: b.img || '',
        used: (st.library || []).filter((x) => x.type === 'bundle' && x.bundleRef === b.id).length,
        ...describe(b),
        badge: this.familyBadgeShown('bundle'),
        onImg: (e) => { const v = e.target.value.trim(); if (v !== (b.img || '')) this.setBundleImg(b.id, v); },
        create: () => this.addBundleElement(b.id),
      })),
      bundleBusy: !!st.bundleBusy,
      syncBundles: () => this.syncBundlesNow(),
      bundleState: !tfb.configured ? 'off' : (sync.ok === false ? 'error' : (sync.ok ? 'ok' : 'never')),
      bundleStatusText: !tfb.configured ? this.t('bundles.notConfigured')
        : sync.ok === false ? `${sync.error || 'erreur'}${sync.lastOk ? ` · ${this.t('bundles.lastOk', { at: new Date(sync.lastOk).toLocaleString('fr-BE') })}` : ''}`
        : sync.ok ? this.t('bundles.syncedAgo', { ago, n: sync.count || 0, a: sync.active || 0, account: tfb.role || sync.account || '?' })
        : this.t('bundles.never'),
      bundleWarnings: [
        ...((sync.unmappedShops || []).length ? [this.t('bundles.warnShops', { ids: sync.unmappedShops.join(', ') })] : []),
        ...((sync.unknownProducts || []).length ? [this.t('bundles.warnProducts', { ids: sync.unknownProducts.slice(0, 12).join(', ') + (sync.unknownProducts.length > 12 ? '…' : '') })] : []),
        ...(sync.shopsError ? [sync.shopsError] : []),
      ],
    };
  }
  async syncBundlesNow() {
    if (this.state.bundleBusy) return;
    this.setState({ bundleBusy: true });
    try {
      const r = await api('POST', '/bundles/sync');
      this.setState({ bundleBusy: false, bundles: r.bundles || [], tfbPromos: r.promos || [], tfbBadges: r.badges || this.state.tfbBadges || {}, bundleSync: r.sync || {}, tfbuddy: r.tfbuddy || {}, bundleStores: r.stores || this.state.bundleStores || [] });
      this.showToast(r.ok ? this.t('tfb.synced', { n: (r.bundles || []).length + (r.promos || []).length }) : `TFBuddy : ${(r.sync && r.sync.error) || 'erreur'}`);
    } catch (e) { this.setState({ bundleBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  async setBundleImg(id, img) {
    try {
      const r = await api('PATCH', `/bundles/${encodeURIComponent(id)}`, { img });
      this.setState({ bundles: r.bundles || [] });
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  // « Créer l'élément » depuis la liste : un élément « bundle » déjà relié.
  addBundleElement(bundleId) {
    const t = (this.state.elementTypes || []).find((x) => x.id === 'bundle');
    if (!t) { this.showToast(this.t('bundles.noType')); return; }
    this.setView('composer');
    this.addElement(t, { bundleRef: bundleId });
  }
  // ---- Traductions des écrans (néerlandais des magasins flamands…) --------
  // Claude propose, la régie valide : seule une traduction validée passe à
  // l'écran (le serveur l'applique aux magasins de cette langue).
  openTranslations() { this.setView('translations'); this.loadTranslations(); }
  async loadTranslations(lang) {
    const l = lang || (this.state.tr && this.state.tr.lang) || 'nl';
    try { this.applyTr(await api('GET', `/translations?lang=${encodeURIComponent(l)}`)); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  applyTr(r, { keepEdits = true } = {}) {
    const prev = this.state.tr;
    const sameLang = prev && prev.lang === r.lang;
    this.setState({ tr: r, trEdits: keepEdits && sameLang ? (this.state.trEdits || {}) : {} });
    // Fin d'une proposition suivie depuis cet écran.
    if (sameLang && prev.job && prev.job.running && r.job && !r.job.running) {
      this.showToast(r.job.errors.length && !r.job.proposed ? `Claude : ${r.job.errors[0]}` : this.t('tr.done', { n: r.job.proposed }));
    }
    clearTimeout(this._trPoll);
    if (r.job && r.job.running && this.state.view === 'translations') this._trPoll = setTimeout(() => this.loadTranslations(r.lang), 1500);
  }
  async proposeTranslations() {
    const tr = this.state.tr;
    if (!tr || this.state.trBusy) return;
    this.setState({ trBusy: true });
    try {
      const r = await api('POST', '/translations/propose', { lang: tr.lang });
      this.setState({ trBusy: false });
      this.applyTr(r);
      this.showToast(this.t('tr.started', { n: (r.job && r.job.total) || 0 }));
    } catch (e) { this.setState({ trBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  // Valider des propositions (toutes si keys est absent), retouches comprises.
  async validateTr(keys) {
    const tr = this.state.tr;
    if (!tr || this.state.trBusy) return;
    const edits = { ...(this.state.trEdits || {}) };
    const sent = {};
    for (const s of tr.items) {
      if (s.translation && s.translation.status === 'propose' && (!keys || keys.includes(s.key)) && Object.prototype.hasOwnProperty.call(edits, s.key)) {
        sent[s.key] = edits[s.key];
        delete edits[s.key];
      }
    }
    this.setState({ trBusy: true });
    try {
      const r = await api('POST', '/translations/validate', { lang: tr.lang, ...(keys ? { keys } : {}), edits: sent });
      this.setState({ trBusy: false, trEdits: edits });
      this.applyTr(r);
      this.showToast(this.t('tr.validated', { n: r.validated || 0 }));
    } catch (e) { this.setState({ trBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  async rejectTr(key) {
    const tr = this.state.tr;
    if (!tr) return;
    try {
      const r = await api('POST', '/translations/reject', { lang: tr.lang, keys: [key] });
      const edits = { ...(this.state.trEdits || {}) };
      delete edits[key];
      this.setState({ trEdits: edits });
      this.applyTr(r);
      this.showToast(this.t('tr.rejected'));
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  // Saisie directe (texte à traduire, ou traduction validée corrigée) : validée d'office.
  async saveTrText(key, text) {
    const tr = this.state.tr;
    if (!tr) return;
    const cur = tr.items.find((s) => s.key === key);
    if (!cur || String(text).trim() === ((cur.translation && cur.translation.text) || '')) return;
    try {
      const r = await api('PUT', '/translations', { lang: tr.lang, key, text });
      const edits = { ...(this.state.trEdits || {}) };
      delete edits[key];
      this.setState({ trEdits: edits });
      this.applyTr(r);
      this.showToast(this.t(String(text).trim() ? 'tr.saved' : 'tr.cleared'));
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  trVals() {
    const st = this.state;
    const tr = st.tr || { lang: 'nl', items: [], counts: {}, claude: {}, job: null, stores: [], langs: [] };
    const edits = st.trEdits || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(edits, k);
    const stateOf = (s) => (s.fromErp ? 'erp' : !s.translation ? 'missing' : s.translation.status === 'valide' ? 'validated' : 'proposed');
    const filter = st.trFilter || 'todo';
    const q = (st.trSearch || '').trim().toLowerCase();
    const shown = (s) => {
      const k = stateOf(s);
      if (filter === 'todo' && k !== 'missing' && k !== 'proposed') return false;
      if (filter !== 'todo' && filter !== 'all' && k !== filter) return false;
      return !q || `${s.source} ${(s.translation && s.translation.text) || ''} ${s.erpText || ''} ${s.where} ${s.context}`.toLowerCase().includes(q);
    };
    // Nom de la langue dans la langue de l'interface (« néerlandais », « Dutch »…).
    const langName = (id) => {
      try { return new Intl.DisplayNames([st.uiLang || 'fr'], { type: 'language' }).of(id) || id; }
      catch { return ((tr.langs || []).find((l) => l.id === id) || {}).label || id; }
    };
    const langLabel = langName(tr.lang);
    const row = (s) => {
      const k = stateOf(s);
      const origin = s.translation ? s.translation.origin : '';
      return {
        key: s.key, source: s.source, label: s.kindLabel, where: s.where || s.context || '', state: k,
        // Le français a changé : l'ancienne traduction, pour repartir d'elle.
        before: s.previous ? this.t('tr.before', { src: s.previous.source, tr: s.previous.text }) : '',
        value: has(s.key) ? edits[s.key] : (k === 'erp' ? s.erpText : ((s.translation && s.translation.text) || '')),
        edited: has(s.key),
        badge: k === 'erp' ? this.t('tr.sErp') : k === 'missing' ? (s.stale ? this.t('tr.sStale') : this.t('tr.sMissing'))
          : k === 'proposed' ? this.t('tr.sProposed') : (origin === 'regie' ? this.t('tr.sManual') : this.t('tr.sValidated')),
        onInput: (e) => this.setState({ trEdits: { ...(this.state.trEdits || {}), [s.key]: e.target.value } }),
        // Texte à traduire ou traduction validée : enregistrée en quittant le champ.
        // Une proposition retouchée attend « Valider ».
        onChange: k === 'missing' || k === 'validated' ? (e) => this.saveTrText(s.key, e.target.value) : null,
        validate: () => this.validateTr([s.key]),
        reject: () => this.rejectTr(s.key),
      };
    };
    const GROUPS = [['category', 'tr.gCategories'], ['product', 'tr.gProducts'], ['module', 'tr.gElements'], ['item', 'tr.gItems'],
      ['campaign', 'tr.gCampaigns'], ['promo_type', 'tr.gPromos'], ['bundle', 'tr.gBundles']];
    const visible = (tr.items || []).filter(shown);
    const c = tr.counts || {};
    const job = tr.job;
    const secs = job && job.endedAt ? Math.max(1, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000)) : 0;
    const fmt = (n) => Number(n || 0).toLocaleString('fr-BE');
    return {
      trLang: tr.lang, trLangLabel: langLabel,
      trLangs: (tr.langs || []).map((l) => ({ id: l.id, label: langName(l.id) })),
      onTrLang: (e) => { this.setState({ trEdits: {} }); this.loadTranslations(e.target.value); },
      trGroups: GROUPS.map(([kind, label]) => {
        const rows = visible.filter((s) => s.kind === kind).map(row);
        return { kind, label: this.t(label), n: rows.length, rows };
      }).filter((g) => g.rows.length),
      trFilters: [['todo', 'tr.fTodo', (c.missing || 0) + (c.proposed || 0)], ['proposed', 'tr.fProposed', c.proposed], ['validated', 'tr.fValidated', c.validated],
        ['erp', 'tr.fErp', c.erp], ['all', 'tr.fAll', c.total]].map(([id, label, n]) => ({
        id, label: this.t(label, { n: n || 0 }), active: filter === id, pick: () => this.setState({ trFilter: id }),
      })),
      trSearch: st.trSearch || '',
      onTrSearch: (e) => this.setState({ trSearch: e.target.value }),
      trMissing: c.missing || 0, trProposed: c.proposed || 0,
      trConfigured: !!(tr.claude && tr.claude.configured),
      trModel: (tr.claude && tr.claude.model) || '',
      trRunning: !!(job && job.running),
      trBusy: !!st.trBusy,
      trProgress: job && job.running ? this.t('tr.proposing', { d: job.done, n: job.total }) : '',
      trJobText: job && !job.running ? this.t('tr.jobDone', { n: job.proposed, s: secs, i: fmt(job.usage && job.usage.input_tokens), o: fmt(job.usage && job.usage.output_tokens) }) : '',
      trJobErrors: job && job.errors && job.errors.length ? this.t('tr.jobErrors', { n: job.errors.length, err: job.errors[0] }) : '',
      trStoresText: (tr.stores || []).length ? this.t('tr.stores', { lang: langLabel, list: tr.stores.map((x) => x.name).join(', ') }) : this.t('tr.noStores', { lang: langLabel }),
      trHasStores: (tr.stores || []).length > 0,
      trPlaceholder: this.t('tr.placeholder', { lang: langLabel }),
      trEmpty: filter === 'todo' && !q ? this.t('tr.emptyTodo') : this.t('tr.empty'),
      trLoaded: !!st.tr,
      proposeTr: () => this.proposeTranslations(),
      validateAllTr: () => this.validateTr(null),
    };
  }
  // ---- Promotions TFBuddy (« X achetés = Y offert », quantité, remise
  // programmée, bon d'achat) : un élément « promotion » peut en suivre une.
  tfbPromoTypeFor(p) {
    const want = (this.state.tfbBadges || {})[this.tfbFamilyOf(p)]
      || (p.kind === 'scheduled_discount' ? ((p.schedule || []).length ? 'happy-hour' : 'scheduled')
        : p.kind === 'voucher' ? 'voucher' : 'bxgy');
    const types = this.state.promoTypes || [];
    return (types.find((t) => t.id === want) || types.find((t) => t.active !== false) || {}).id || '';
  }
  tfbPromoProducts(p) {
    const prods = this.state.catalog.products || [];
    let ids = (p.products || []).map((x) => x.productId).filter((id) => id && prods.some((q) => q.id === id));
    if (!ids.length) {
      const cats = new Set((p.categories || []).map((c) => c.categoryId).filter(Boolean));
      ids = prods.filter((q) => q.active !== false && cats.has(q.categoryId)).map((q) => q.id);
    }
    return ids;
  }
  // Promotion TFBuddy résolue pour l'aperçu (prix de base, langue française).
  tfbPromoInfo(m) {
    if (!m || m.type !== 'promotion' || !m.tfbRef) return null;
    const p = (this.state.tfbPromos || []).find((x) => x.id === m.tfbRef);
    if (!p) return null;
    const prods = this.state.catalog.products || [];
    const ids = this.tfbPromoProducts(p);
    const heroId = m.productRef && prods.some((q) => q.id === m.productRef) ? m.productRef : ids[0];
    const hp = heroId ? prods.find((q) => q.id === heroId) : null;
    return {
      tfb: { id: p.id, kind: p.kind, name: p.name, descr: p.descr, mech: p.mech, slots: p.schedule, img: p.img, lang: 'fr' },
      items: hp ? [{ name: hp.name, price: hp.price, img: hp.img, src: hp.src, active: true, productId: hp.id }] : [],
    };
  }
  tfbPromoVals(m, isPromo) {
    const st = this.state;
    const prods = st.catalog.products || [];
    const cats = st.catalog.categories || [];
    const sync = st.bundleSync || {};
    const kinds = sync.kinds || {};
    const storeName = (id) => (((st.bundleStores || []).find((x) => x.id === id) || (st.fleet || []).find((x) => x.id === id)) || {}).name || id;
    const ICON = { bundle: '🎁', buy_x_get_y: '➕', quantity: '🔢', scheduled_discount: '📅', voucher: '🎟️' };
    const describe = (p) => {
      const targets = [
        ...(p.products || []).map((x) => {
          const q = x.productId ? prods.find((y) => y.id === x.productId) : null;
          return { label: q ? q.name : this.t('tfb.productN', { n: x.extProductId }), missing: !q };
        }),
        ...(p.categories || []).map((c) => {
          const q = c.categoryId ? cats.find((y) => y.id === c.categoryId) : null;
          return { label: `🗂 ${q ? q.name : this.t('tfb.categoryN', { n: c.extCategoryId })}`, missing: !q };
        }),
      ];
      const unmapped = (p.shopIds || []).length - (p.storeIds || []).length;
      const mech = p.mech || {};
      return {
        icon: ICON[p.kind] || '🏷️', kindLabel: this.t(`tfb.kind.${p.kind}`),
        label: tfbPromoLabel({ kind: p.kind, mech }, 'fr') || '—',
        targets,
        when: (p.schedule || []).length ? this.bundleWhen(p.schedule) : this.t('tfb.always'),
        shops: p.scope === 'all' ? this.t('bundles.allShops')
          : `${(p.storeIds || []).map(storeName).join(', ') || '—'}${unmapped > 0 ? ` · ${this.t('bundles.shopsUnmapped', { n: unmapped })}` : ''}`,
        dates: p.dateFrom || p.dateTo ? `${p.dateFrom || '…'} → ${p.dateTo || '…'}` : '',
        voucher: p.kind === 'voucher'
          ? `${mech.codeType === 'UNIQUE' ? this.t('tfb.codesUnique') : this.t('tfb.codeShared', { code: mech.code || '—' })}${mech.promotionName || mech.promotionId ? ` · ${this.t('tfb.linkedPromo', { name: mech.promotionName || `#${mech.promotionId}` })}` : ''}`
          : '',
      };
    };
    const filter = st.tfbFilter || 'all';
    const all = st.tfbPromos || [];
    const picked = isPromo && m.tfbRef ? all.find((x) => x.id === m.tfbRef) : null;
    const count = (k) => (k === 'bundle' ? (st.bundles || []).length : all.filter((x) => x.kind === k).length);
    return {
      tfbFilters: [['all', (st.bundles || []).length + all.length], ...['bundle', 'buy_x_get_y', 'quantity', 'scheduled_discount', 'voucher'].map((k) => [k, count(k)])]
        .map(([id, n]) => ({ id, label: `${id === 'all' ? this.t('tfb.all') : `${ICON[id]} ${this.t(`tfb.kind.${id}`)}`} · ${n}`, active: filter === id, pick: () => this.setState({ tfbFilter: id }) })),
      tfbShowBundles: filter === 'all' || filter === 'bundle',
      tfbTotal: (st.bundles || []).length + all.length,
      tfbPromoRows: all.filter((p) => filter === 'all' || p.kind === filter).map((p) => ({
        id: p.id, kind: p.kind, name: p.name, descr: p.descr, status: p.status, active: p.status === 'ACTIVE',
        voucherOnly: p.activation === 'VOUCHER_ONLY', img: p.img || '',
        used: (st.library || []).filter((x) => x.type === 'promotion' && x.tfbRef === p.id).length,
        ...describe(p),
        badge: this.familyBadgeShown(this.tfbFamilyOf(p)),
        onImg: (e) => { const v = e.target.value.trim(); if (v !== (p.img || '')) this.setTfbPromoImg(p.id, v); },
        create: () => this.addTfbPromoElement(p.id),
      })),
      // État de chaque famille (les bundles ont leur ligne à part).
      tfbKindLines: ['buy_x_get_y', 'quantity', 'scheduled_discount', 'voucher'].filter((k) => kinds[k]).map((k) => {
        const r = kinds[k];
        return {
          ok: r.ok !== false,
          text: r.ok === false ? `${ICON[k]} ${this.t(`tfb.kind.${k}`)} : ${r.error || 'erreur'}`
            : `${ICON[k]} ${this.t(`tfb.kind.${k}`)} : ${this.t('tfb.kindCount', { n: r.count || 0, a: r.active || 0 })}`
              + `${(r.unknownProducts || []).length ? ` · ${this.t('bundles.warnProducts', { ids: r.unknownProducts.slice(0, 8).join(', ') })}` : ''}`
              + `${(r.unmappedShops || []).length ? ` · ${this.t('bundles.warnShops', { ids: r.unmappedShops.join(', ') })}` : ''}`,
        };
      }),
      // -- éditeur d'un élément « promotion » --
      tfbOptions: all.map((p) => ({
        id: p.id,
        label: `${ICON[p.kind]} ${p.name} — ${tfbPromoLabel({ kind: p.kind, mech: p.mech || {} }, 'fr') || this.t(`tfb.kind.${p.kind}`)}${p.status !== 'ACTIVE' ? ` (${p.status.toLowerCase()})` : ''}`,
      })),
      hasTfbPromos: all.length > 0,
      curTfbRef: (m && m.tfbRef) || '',
      tfbPicked: picked ? { name: picked.name, status: picked.status, active: picked.status === 'ACTIVE', ...describe(picked) } : null,
      onTfbRef: (e) => {
        const id = e.target.value;
        const p = all.find((x) => x.id === id);
        const lib = this.cloneLib();
        const mm = lib.find((x) => x.id === st.selId);
        if (!mm) return;
        mm.tfbRef = id;
        if (p) {
          // Le nom suit la promotion tant qu'il n'a pas été personnalisé.
          if (!mm.name || mm.name === 'Promotion' || all.some((x) => x.name === mm.name)) mm.name = p.name;
          const t = this.tfbPromoTypeFor(p);
          if (t) mm.promoType = t;
          const ids = this.tfbPromoProducts(p);
          if (!mm.productRef || !ids.includes(mm.productRef)) mm.productRef = ids[0] || mm.productRef || '';
        }
        this.setLib(lib);
      },
    };
  }
  async setTfbPromoImg(id, img) {
    try {
      const r = await api('PATCH', `/tfb-promos/${encodeURIComponent(id)}`, { img });
      this.setState({ tfbPromos: r.promos || [] });
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  // « Créer l'élément » depuis la liste : un élément « promotion » relié.
  addTfbPromoElement(promoId) {
    const t = (this.state.elementTypes || []).find((x) => x.id === 'promotion');
    if (!t) { this.showToast(this.t('tfb.noType')); return; }
    this.setView('composer');
    this.addElement(t, { tfbRef: promoId });
  }
  // Campagne résolue pour l'aperçu, depuis la liste sig_campaigns.
  campaignInfo(m) {
    if (!m || m.type !== 'campagne') return undefined;
    const c = (this.state.campaigns || []).find((x) => x.id === m.campaignRef);
    return c || { id: m.campaignRef || '', name: 'Campagne', scope: 'produit', productRef: '', theme: '', image: '', message: '', dateFrom: '', dateTo: '', color: '#8D1D2C', active: true };
  }
  // Aperçu d'un gabarit HTML : applique les liaisons de variables avec les
  // données déjà chargées en régie, pour voir le rendu réel sans attendre la
  // diffusion. Miroir de applyHtmlVars (serveur) ; les champs propres à un
  // magasin, inconnus ici, s'affichent en repère ‹…› plutôt qu'inventés.
  resolveHtmlPreview(code, binds) {
    // L'aperçu tourne à 60 im/s : sans mémo, on referait à chaque image de la
    // regex sur des kilo-octets de code (substitution + placement). On ne
    // recalcule que si le code, les liaisons ou les données référencées bougent.
    const key = code.length + '|' + code.slice(0, 64) + '|' + JSON.stringify(binds) + '|' + this._previewStamp();
    if (this._htmlPrevKey === key) return this._htmlPrevOut;
    const out = this._resolveHtmlPreviewNow(code, binds);
    this._htmlPrevKey = key; this._htmlPrevOut = out;
    return out;
  }
  // Empreinte des données qui alimentent les variables : si elles changent,
  // l'aperçu doit être recalculé.
  _previewStamp() {
    const st = this.state;
    return [
      (st.catalog.products || []).length, (st.catalog.categories || []).length,
      (st.promoTypes || []).length, (st.campaigns || []).length,
      (st.seasonsCurrent || []).join(','), st.prodMomentsCurrent || '', st.dataVer || 0,
    ].join('.');
  }
  _resolveHtmlPreviewNow(code, binds) {
    const st = this.state;
    const map = new Map();
    for (const k of Object.keys(binds || {})) map.set(String(k).trim().toLowerCase(), binds[k]);
    const prods = st.catalog.products || [];
    const fieldLabel = (srcId, fieldId) => {
      const src = HTML_VAR_SOURCES.find((x) => x.id === srcId);
      const f = src && src.fields.find((x) => x.id === fieldId);
      return f ? f.label : (src ? src.label : '');
    };
    const resolve = (b) => {
      if (!b || !b.src) return null;
      const val = String(b.value || ''), field = String(b.field || '');
      if (b.src === 'literal' || b.src === 'image') return val;
      if (b.src === 'produit') {
        const p = prods.find((x) => x.id === val);
        if (!p) return '';
        if (field === 'prix') return p.price || '';
        if (field === 'image') return p.img || '';
        if (field === 'categorie') return ((st.catalog.categories || []).find((c) => c.id === p.categoryId) || {}).name || '';
        return p.name || '';
      }
      if (b.src === 'categorie') {
        const c = (st.catalog.categories || []).find((x) => x.id === val);
        if (!c) return '';
        return field === 'illustration' ? (c.img || '') : (c.name || '');
      }
      if (b.src === 'promotion') {
        const t = (st.promoTypes || []).find((x) => x.id === val);
        if (!t) return '';
        if (field === 'icone') return t.icon || '';
        if (field === 'couleur') return t.color || '';
        if (field === 'description') return t.descr || '';
        return t.name || '';
      }
      if (b.src === 'campagne') {
        const c = (st.campaigns || []).find((x) => x.id === val);
        if (!c) return '';
        if (field === 'message') return c.message || '';
        if (field === 'theme') return c.theme || '';
        if (field === 'image') return c.image || '';
        if (field === 'couleur') return c.color || '';
        if (field === 'du') return c.dateFrom || '';
        if (field === 'au') return c.dateTo || '';
        return c.name || '';
      }
      if (b.src === 'magasin') {
        // Ce que la régie connaît déjà sans magasin choisi.
        if (field === 'date') { try { return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { return ''; } }
        if (field === 'saison') return (st.seasons || []).filter((x) => (st.seasonsCurrent || []).includes(x.id)).map((x) => x.name).join(', ');
        if (field === 'moment') return st.prodMomentsCurrent || '';
        return '\u2039' + fieldLabel('magasin', field || 'nom') + '\u203a';   // dépend du magasin
      }
      return null;
    };
    // Variables situées dans une balise : la translation va sur la balise.
    code = applyHtmlVarPositions(code, binds);
    return String(code).replace(/\{\{([^{}]+)\}\}/g, (m0, raw, offset, full) => {
      const k = String(raw).trim().toLowerCase();
      const b = map.get(k);
      let out = resolve(b);
      if (out == null && Object.prototype.hasOwnProperty.call(HTML_BRAND_VARS, k)) out = HTML_BRAND_VARS[k];
      if (out == null) return m0;   // non liée : reste visible (résolue à la diffusion)
      return wrapHtmlVarPos(out, b, full, offset);
    });
  }
  resolveMod(m) {
    // Gabarit HTML : l'aperçu montre les variables déjà liées.
    if (m && m.type === 'html' && typeof m.html === 'string' && m.html.indexOf('{{') !== -1) {
      return { ...m, html: this.resolveHtmlPreview(m.html, m.htmlVars || {}) };
    }
    // Élément « promotion » : annote le badge du sous-type pour l'aperçu.
    const promo = this.promoBadge(m);
    // Élément « bundle » : le bundle TFBuddy et ses produits.
    if (m && m.type === 'bundle') {
      const bi = this.bundleInfo(m);
      const fb = this.familyBadge('bundle');
      return bi ? { ...m, bundle: bi.bundle, items: bi.items, ...(fb ? { promo: fb } : {}) } : { ...m, items: [] };
    }
    // Élément « promotion » relié à TFBuddy : sa mécanique, son produit.
    if (m && m.type === 'promotion' && m.tfbRef) {
      const ti = this.tfbPromoInfo(m);
      if (ti) return { ...m, promo, tfb: ti.tfb, items: ti.items };
    }
    // Élément « campagne » : contenu porté par la campagne (produit lié éventuel).
    const campaign = this.campaignInfo(m);
    if (campaign) {
      const prods = this.state.catalog.products || [];
      const toItem = (p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: p.active !== false, productId: p.id });
      const p = campaign.productRef ? prods.find((x) => x.id === campaign.productRef) : null;
      return { ...m, campaign, items: p ? [toItem(p)] : [] };
    }
    // Élément « surprise » : on annote le nombre de vidéos du dossier pour l'aperçu.
    if (m && m.surprise && !m.catRef && !m.productRef) {
      return { ...m, promo, surpriseCount: (this.state.surpriseVideos || []).length };
    }
    if (!m || (!m.catRef && !m.productRef)) return promo ? { ...m, promo } : m;
    const prods = this.state.catalog.products || [];
    const toItem = (p) => ({ name: p.name, price: p.price, img: p.img, src: p.src, active: p.active !== false, productId: p.id });
    let items;
    if (m.catRef) {
      items = prods.filter((p) => p.categoryId === m.catRef).map(toItem);
      const cat = (this.state.catalog.categories || []).find((c) => c.id === m.catRef);
      if (cat && cat.img) return { ...m, items, promo, catImg: cat.img };
    }
    else { const p = prods.find((x) => x.id === m.productRef); items = p ? [toItem(p)] : []; }
    return { ...m, items, promo };
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
    if (this.state.playing && this.state.view === 'composer' && !this.state.loading && !this._dnd && !this.state.wizard) {
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
      // La régie ne fait plus que du continu — sauf un film « fixe » monté par
      // l'assistant vidéo de campagne (séquence choisie à l'assistant).
      mode: p.origin === 'assistant' && p.mode === 'playlist' ? 'playlist' : 'continu',
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
  // --- Parcours de la bibliothèque pour la boucle -------------------------
  // Créer une boucle, c'est passer en revue TOUS les éléments de la
  // bibliothèque au format visé : chacun a sa case actif/inactif et son ratio
  // de passage. La ligne décochée garde son ratio en mémoire.
  contLoopItems() {
    const want = (this.activeFilm().continuous || {}).orient === 'portrait' ? 'portrait' : 'paysage';
    return (this.state.library || []).filter((mm) => this.orientOf(mm) === want);
  }
  setLoopItem(id, patch) {
    const cur = (this.activeFilm().continuous || {}).itemRatios || [];
    const found = cur.find((r) => r.id === id) || { id, on: false, n: 0 };
    const next = cur.filter((r) => r.id !== id).concat([{ ...found, ...patch }]);
    this.updateContinuous({ itemRatios: next });
  }
  setAllLoopItems(on) {
    const cur = (this.activeFilm().continuous || {}).itemRatios || [];
    const rows = this.contLoopItems();
    // On ne touche qu'aux éléments visibles (le format courant) : les réglages
    // de l'autre orientation restent intacts.
    const ids = new Set(rows.map((mm) => mm.id));
    const kept = cur.filter((r) => !ids.has(r.id));
    const next = on
      ? kept.concat(rows.map((mm) => {
        const f = cur.find((r) => r.id === mm.id);
        return { id: mm.id, on: true, n: (f && f.n) || LOOP_RATIO_DEF };
      }))
      : kept.concat(cur.filter((r) => ids.has(r.id)).map((r) => ({ ...r, on: false })));
    this.updateContinuous({ itemRatios: next });
  }
  contLoopRows() {
    const cur = (this.activeFilm().continuous || {}).itemRatios || [];
    const MO = { matin: 'matin', midi: 'midi', aprem: 'après-midi' };
    return this.contLoopItems().map((mm) => {
      const f = cur.find((r) => r.id === mm.id);
      const on = !!(f && f.on);
      const mos = Array.isArray(mm.moments) ? mm.moments : [];
      return {
        id: mm.id, name: mm.name || 'Élément', on,
        icon: (this.elementTypeOf(mm) || {}).icon || '▤',
        typeName: (this.elementTypeOf(mm) || {}).name || mm.type,
        moments: mos.length ? mos.map((x) => MO[x] || x).join(' · ') : 'tous moments',
        n: (f && f.n) || 0,
        // Cocher une ligne sans ratio lui donne un ratio de départ : une case
        // cochée qui ne passe jamais serait un piège.
        toggle: () => this.setLoopItem(mm.id, { on: !on, n: (f && f.n) || LOOP_RATIO_DEF }),
        // « Édition dans la bibliothèque » : on saute à l'élément là où il se
        // règle vraiment, sans quitter le fil du parcours.
        edit: () => { this.setComposerTab('lib'); this.selectMod(mm.id); },
        onN: (e) => {
          const n = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
          this.setLoopItem(mm.id, { n, on: n > 0 ? true : false });
        },
      };
    });
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
    this.showToast('Film d’exemple « Boucle continue » créé — adapte-le puis publie.');
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
    this.setState({ selId: id, t: 0, openSec: [this.defaultSecFor(mm)] });
  }
  // Volets repliables de l'éditeur : plusieurs peuvent rester ouverts. Celui-ci
  // est simplement le premier ouvert à la sélection d'un élément.
  defaultSecFor(mm) {
    if (!mm) return null;
    if (mm.type === 'produit') return 'produit';
    if (mm.type === 'film') return 'video';
    if (mm.type === 'media') return 'media';
    if (mm.type === 'animation') return 'anim';
    if (mm.type === 'category') return 'items';
    if (mm.type === 'bundle') return 'bundle';
    if (mm.type === 'promotion') return 'promo';
    return 'tag';
  }
  // Les volets de l'éditeur s'ouvrent/ferment indépendamment : on peut garder
  // le code ET les variables sous les yeux, au lieu d'un seul volet à la fois.
  toggleSec(id, el) {
    const cur = Array.isArray(this.state.openSec) ? this.state.openSec : (this.state.openSec ? [this.state.openSec] : []);
    const wasOpen = cur.includes(id);
    this.setState({ openSec: wasOpen ? cur.filter((x) => x !== id) : [...cur, id] });
    // Le volet qui vient de s'ouvrir se centre — mais sans arracher la vue si
    // d'autres volets sont déjà ouverts (on reste là où on travaille).
    if (!wasOpen && el && !cur.length) {
      setTimeout(() => { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* navigateur ancien */ } }, 90);
    }
  }
  // Un nouveau module rejoint directement la playlist (retirable avec ✕) :
  // sinon il n'apparaîtrait pas dans le film publié et c'est trop facile à rater.
  // « + Élément » : le type est choisi parmi ceux de la table sig_element_types.
  addElement(t, extra = {}) {
    const id = uid();
    const lib = this.cloneLib();
    const base = {
      id, type: t.id, name: '', sub: '', libTag: t.id === 'liaison' ? 'liaison' : 'produit',
      layout: (t.layouts && t.layouts[0] && t.layouts[0].id) || 'illo-right', motion: 'm1',
      tag: newTag(), schedule: newSched(), pos: newPos(), items: [],
      catRef: '', productRef: '', video: '', dur: 0, orient: 'paysage',
    };
    if (t.id === 'category') { base.name = 'Nouvelle catégorie'; base.items = [{ name: 'Produit', price: '0,00', img: 'assets/cake.png', src: 'illus', active: true }]; }
    else if (t.id === 'liaison') { base.name = 'Liaison'; base.sub = 'faites maison chaque matin'; }
    else if (t.id === 'produit') { base.name = 'À la une'; base.dur = 8; }
    else if (t.id === 'film') { base.name = 'Vidéo'; base.dur = 10; base.libTag = 'promo'; }
    else if (t.id === 'media') { base.name = 'Média ciblé'; base.dur = 12; base.libTag = 'promo'; base.layout = 'cover'; }
    else if (t.id === 'animation') { base.name = 'Nouveauté'; base.sub = 'cette semaine'; base.dur = 6; base.libTag = 'promo'; }
    else if (t.id === 'bundle') {
      const b = (this.state.bundles || []).find((x) => x.id === extra.bundleRef)
        || (this.state.bundles || []).find((x) => x.status === 'ACTIVE');
      base.name = b ? b.name : 'Bundle'; base.libTag = 'promo'; base.layout = 'composition'; base.dur = 9;
      base.bundleRef = b ? b.id : '';
    }
    else if (t.id === 'promotion' && extra.tfbRef) {
      const p = (this.state.tfbPromos || []).find((x) => x.id === extra.tfbRef);
      const ids = p ? this.tfbPromoProducts(p) : [];
      base.name = p ? p.name : 'Promotion'; base.libTag = 'promo'; base.dur = 7;
      base.tfbRef = p ? p.id : '';
      base.promoType = p ? this.tfbPromoTypeFor(p) : '';
      base.productRef = ids[0] || '';
      base.layout = ids.length || (p && p.img) ? 'hero-right' : 'band';
    }
    else { base.name = t.label || 'Élément'; }
    lib.push(base);
    this.setLib(lib, { selId: id, addPicker: false, composerTab: 'lib', openSec: [this.defaultSecFor(base)], ...this.playlistPatch([...this.state.playlist, id]) });
  }
  elementTypeOf(m) {
    return (this.state.elementTypes || []).find((t) => t.id === (m && m.type)) || null;
  }
  // Orientation effective d'un élément : 16:9 paysage ou 9:16 portrait — un
  // écran est l'un ou l'autre, il n'y a pas d'entre-deux.
  orientOf(mm) {
    if (!mm) return 'paysage';
    if (mm.orient === 'portrait') return 'portrait';
    if (mm.orient === 'paysage') return 'paysage';
    // Repli : un gabarit HTML suit la forme de sa maquette, sinon paysage.
    if (mm.type === 'html' && (mm.htmlH || 0) > (mm.htmlW || 0)) return 'portrait';
    return 'paysage';
  }
  // Un élément n'est proposable que pour SON format d'écran.
  fitsOrient(mm, want) { return this.orientOf(mm) === want; }
  modMeta(mm) {
    if (mm.type === 'liaison') return 'Liaison';
    if (mm.type === 'media') return 'média ciblé · moment + saison';
    if (mm.type === 'film') return mm.video ? `vidéo · ${mm.dur || 10} s` : 'vidéo à importer';
    if (mm.type === 'animation') return `animation · ${mm.dur || 6} s`;
    if (mm.type === 'produit') return mm.items && mm.items[0] ? `à la une : ${mm.items[0].name}` : 'produit à choisir';
    if (mm.type === 'html') return String(mm.html || '').trim() ? `gabarit HTML · ${mm.htmlW || 1920}×${mm.htmlH || 1080}` : 'gabarit HTML · code à coller';
    if (mm.type === 'promotion' && mm.tfbRef) {
      const p = (this.state.tfbPromos || []).find((x) => x.id === mm.tfbRef);
      return p ? `promotion TFBuddy · ${p.name}${p.status !== 'ACTIVE' ? ` · ${p.status.toLowerCase()}` : ''}` : 'promotion TFBuddy introuvable';
    }
    if (mm.type === 'promotion') return `promotion${mm.promo && mm.promo.name ? ' · ' + mm.promo.name : ''}`;
    if (mm.type === 'campagne') return `campagne${mm.campaign && mm.campaign.name ? ' · ' + mm.campaign.name : ''}`;
    if (mm.type === 'bundle') {
      const b = (this.state.bundles || []).find((x) => x.id === mm.bundleRef);
      return b ? `bundle TFBuddy · ${b.name}${b.status !== 'ACTIVE' ? ` · ${b.status.toLowerCase()}` : ''}` : 'bundle à choisir';
    }
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
  // ---- fichiers d'animation (fond ou animation autonome) -------------------
  // Un seul chemin d'upload pour les deux usages ; `field` dit lequel du champ
  // « fond » ou « fichier » reçoit l'URL.
  async uploadAnimAsset(field, file) {
    if (!file || this.state.animBusy) return;
    if (file.size > 18 * 1024 * 1024) { this.showToast(`${file.name} : trop lourd (max 18 Mo) — dépose-le dans public/anim/ sur le serveur`); return; }
    this.setState({ animBusy: true });
    try {
      const dataUrl = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(file); });
      const out = await api('POST', '/anim-assets', { name: file.name, dataUrl });
      this.setSelField(field, out.url);
      this.showToast(`« ${out.name} » importé ✓`);
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
    finally { this.setState({ animBusy: false }); }
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

  // ---- promotions : sous-types dynamiques (happy hour, flash, bundle…) ------
  async loadPromoTypes() {
    try { const r = await api('GET', '/promo-types'); this.setState({ promoTypes: r.promoTypes || [] }); }
    catch { /* indisponible : garde l'état courant */ }
  }
  openPromotions() {
    const draft = JSON.parse(JSON.stringify(this.state.promoTypes || []));
    this.setState({ view: 'promotions', promoDraft: draft, promoDirty: false });
    this.loadProdMoments(); // les promotions se taguent aussi par période
  }
  setPromoDraft(mut) {
    const arr = JSON.parse(JSON.stringify(this.state.promoDraft || this.state.promoTypes || []));
    mut(arr);
    this.setState({ promoDraft: arr, promoDirty: true });
  }
  addPromoType() {
    this.setPromoDraft((a) => a.push({ id: 'pt' + uid(), name: this.t('promo.newName'), icon: '🏷️', color: '#C0392B', descr: '', active: true }));
  }
  updatePromoType(id, patch) { this.setPromoDraft((a) => { const t = a.find((x) => x.id === id); if (t) Object.assign(t, patch); }); }
  delPromoType(id) { this.setPromoDraft((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) a.splice(i, 1); }); }
  movePromoType(id, dir) {
    this.setPromoDraft((a) => {
      const i = a.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const [row] = a.splice(i, 1); a.splice(j, 0, row);
    });
  }
  async savePromoTypesDraft() {
    if (this.state.promoBusy) return;
    const list = this.state.promoDraft || [];
    if (list.some((t) => !String(t.name || '').trim())) { this.showToast('Chaque promotion a besoin d\'un nom'); return; }
    this.setState({ promoBusy: true });
    try {
      const r = await api('PUT', '/promo-types', { promoTypes: list });
      this.setState({ promoBusy: false, promoTypes: r.promoTypes || [], promoDraft: JSON.parse(JSON.stringify(r.promoTypes || [])), promoDirty: false, promoSavedAt: Date.now() });
      this.showToast('Promotions enregistrées ✓');
    } catch (e) { this.setState({ promoBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- suites : de petits montages à la main dans un film automatique ------
  // Une suite est une liste ORDONNÉE d'éléments (intro, outro, présentation
  // d'une gamme…) qui vient se poser dans la boucle, à la place qu'on lui donne.
  seqList() { return this.state.seqDraft || this.state.sequences || []; }
  seqCurrent() {
    const l = this.seqList();
    return l.find((s) => s.id === this.state.seqSel) || l[0] || null;
  }
  setSeqDraft(mut) {
    const arr = JSON.parse(JSON.stringify(this.seqList()));
    mut(arr);
    this.setState({ seqDraft: arr, seqDirty: true });
  }
  addSequence() {
    const id = 'sq' + uid();
    // Une suite neuve suit le format d'écran de la boucle en cours d'édition :
    // c'est celui qu'on a sous les yeux.
    const orient = (this.activeFilm().continuous || {}).orient === 'portrait' ? 'portrait' : 'paysage';
    this.setSeqDraft((a) => a.push({ id, name: 'Nouvelle suite', placement: 'debut', ratio: 8, orient, active: true, items: [] }));
    // Et elle est d'emblée retenue par le film courant : sinon on la monte
    // sans rien voir passer à l'écran.
    const cur = (this.activeFilm().continuous || {}).sequences || [];
    this.updateContinuous({ sequences: [...cur, id] });
    this.setState({ seqSel: id });
  }
  updateSequence(id, patch) { this.setSeqDraft((a) => { const s = a.find((x) => x.id === id); if (s) Object.assign(s, patch); }); }
  delSequence(id) {
    this.setSeqDraft((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) a.splice(i, 1); });
    const cur = (this.activeFilm().continuous || {}).sequences || [];
    if (cur.includes(id)) this.updateContinuous({ sequences: cur.filter((x) => x !== id) });
    if (this.state.seqSel === id) this.setState({ seqSel: null });
  }
  moveSequence(id, dir) {
    this.setSeqDraft((a) => {
      const i = a.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const [row] = a.splice(i, 1); a.splice(j, 0, row);
    });
  }
  // --- contenu d'une suite : ajouter / déplacer / retirer un élément ---
  seqAddItem(id, moduleId) {
    if (!moduleId) return;
    this.setSeqDraft((a) => { const s = a.find((x) => x.id === id); if (s) s.items = [...(s.items || []), moduleId]; });
  }
  seqMoveItem(id, i, dir) {
    this.setSeqDraft((a) => {
      const s = a.find((x) => x.id === id); if (!s) return;
      const j = i + dir;
      if (j < 0 || j >= s.items.length) return;
      const it = [...s.items]; const [row] = it.splice(i, 1); it.splice(j, 0, row); s.items = it;
    });
  }
  seqDelItem(id, i) {
    this.setSeqDraft((a) => { const s = a.find((x) => x.id === id); if (s) s.items = s.items.filter((_, k) => k !== i); });
  }
  async loadSequencesList() {
    try { const r = await api('GET', '/sequences'); this.setState({ sequences: r.sequences || [], seqDraft: null, seqDirty: false }); }
    catch { /* indisponible : garde l'état courant */ }
  }
  async saveSequences() {
    if (this.state.seqBusy) return;
    const list = this.seqList();
    if (list.some((s) => !String(s.name || '').trim())) { this.showToast('Chaque suite a besoin d\'un nom'); return; }
    this.setState({ seqBusy: true });
    try {
      const r = await api('PUT', '/sequences', { sequences: list });
      this.setState({ seqBusy: false, sequences: r.sequences || [], seqDraft: null, seqDirty: false });
      this.showToast('Suites enregistrées ✓');
      this.loadContPreview();   // la boucle affichée reflète tout de suite la suite
    } catch (e) { this.setState({ seqBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- matières premières : ingrédient ↔ animation --------------------------
  // Le lien se règle ICI ; le module produit du franchiseur ne fait que le lire.
  ingList() { return this.state.ingDraft || this.state.ingredients || []; }
  setIngDraft(mut) {
    const arr = JSON.parse(JSON.stringify(this.ingList()));
    mut(arr);
    this.setState({ ingDraft: arr, ingDirty: true });
  }
  addIngredient() { this.setIngDraft((a) => a.push({ id: 'ing' + uid(), name: 'Nouvel ingrédient', extRef: '', moduleId: '', active: true })); }
  updateIngredient(id, patch) { this.setIngDraft((a) => { const x = a.find((y) => y.id === id); if (x) Object.assign(x, patch); }); }
  delIngredient(id) { this.setIngDraft((a) => { const i = a.findIndex((y) => y.id === id); if (i >= 0) a.splice(i, 1); }); }
  moveIngredient(id, dir) {
    this.setIngDraft((a) => {
      const i = a.findIndex((y) => y.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const [row] = a.splice(i, 1); a.splice(j, 0, row);
    });
  }
  async saveIngredients() {
    if (this.state.ingBusy) return;
    const list = this.ingList();
    if (list.some((x) => !String(x.name || '').trim())) { this.showToast('Chaque ingrédient a besoin d\'un nom'); return; }
    this.setState({ ingBusy: true });
    try {
      const r = await api('PUT', '/ingredients', { ingredients: list });
      this.setState({ ingBusy: false, ingredients: r.ingredients || [], ingDraft: null, ingDirty: false });
      this.showToast('Matières premières enregistrées ✓');
    } catch (e) { this.setState({ ingBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  async inspectIngredients() {
    this.setState({ ingDiag: { busy: true } });
    try { this.setState({ ingDiag: await api('POST', '/ingredients/inspect', {}) }); }
    catch (e) { this.setState({ ingDiag: { ok: false, error: e.message } }); }
  }

  // ---- « Régie → Apparition… » ---------------------------------------------
  // Exactement ce que l'ERP lit et affiche sur la fiche produit : la régie est
  // la seule à régler les tags, on montre ici le résultat tel qu'il sera vu.
  async openAppearance(productId) {
    if (this.state.appearance && this.state.appearance.produit.id === productId) { this.setState({ appearance: null }); return; }
    this.setState({ appearanceBusy: true });
    try { this.setState({ appearance: await api('GET', `/appearance?product=${encodeURIComponent(productId)}`), appearanceBusy: false }); }
    catch (e) { this.setState({ appearanceBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- catégories de la bibliothèque : le classement des éléments -----------
  // Elles vivent en base (rien en dur) et disent à quelle TABLE de la régie
  // elles sont liées : c'est la donnée qui alimente leurs éléments.
  libCatList() {
    const l = this.state.libCatDraft || this.state.libCats || [];
    return l.length ? l : [{ id: 'produit', name: 'Produit', color: '#8D1D2C', src: 'produits', active: true }];
  }
  libCatOf(m) {
    const l = this.libCatList();
    const want = (m && m.libTag) || (m && m.type === 'liaison' ? 'liaison' : 'produit');
    return l.find((c) => c.id === want) || l[0];
  }
  setLibCatDraft(mut) {
    const arr = JSON.parse(JSON.stringify(this.state.libCatDraft || this.state.libCats || []));
    mut(arr);
    this.setState({ libCatDraft: arr, libCatDirty: true });
  }
  addLibCat() {
    this.setLibCatDraft((a) => a.push({ id: 'lc' + uid(), name: 'Nouvelle catégorie', color: '#6E4A2B', src: '', active: true }));
  }
  updateLibCat(id, patch) { this.setLibCatDraft((a) => { const c = a.find((x) => x.id === id); if (c) Object.assign(c, patch); }); }
  delLibCat(id) { this.setLibCatDraft((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) a.splice(i, 1); }); }
  moveLibCat(id, dir) {
    this.setLibCatDraft((a) => {
      const i = a.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const [row] = a.splice(i, 1); a.splice(j, 0, row);
    });
  }
  async saveLibCats() {
    if (this.state.libCatBusy) return;
    const list = this.state.libCatDraft || [];
    if (!list.length) { this.showToast('Garde au moins une catégorie de bibliothèque'); return; }
    if (list.some((c) => !String(c.name || '').trim())) { this.showToast('Chaque catégorie a besoin d\'un nom'); return; }
    this.setState({ libCatBusy: true });
    try {
      const r = await api('PUT', '/lib-categories', { libCategories: list });
      this.setState({ libCatBusy: false, libCats: r.libCategories || [], libCatDraft: null, libCatDirty: false });
      this.showToast('Catégories de bibliothèque enregistrées ✓');
    } catch (e) { this.setState({ libCatBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- campagnes marketing : liste d'entités à déposer comme item -----------
  async loadCampaignsList() {
    try { const r = await api('GET', '/campaigns'); this.setState({ campaigns: r.campaigns || [] }); }
    catch { /* indisponible : garde l'état courant */ }
  }
  openCampaigns() {
    const draft = JSON.parse(JSON.stringify(this.state.campaigns || []));
    this.setState({ view: 'campaigns', campaignDraft: draft, campaignDirty: false });
    this.loadProdMoments(); // les campagnes se taguent aussi par période
  }
  setCampaignDraft(mut) {
    const arr = JSON.parse(JSON.stringify(this.state.campaignDraft || this.state.campaigns || []));
    mut(arr);
    this.setState({ campaignDraft: arr, campaignDirty: true });
  }
  addCampaign() {
    this.setCampaignDraft((a) => a.push({ id: 'cmp' + uid(), name: this.t('campaign.newName'), scope: 'produit', productRef: '', theme: '', image: '', message: '', dateFrom: '', dateTo: '', color: '#8D1D2C', active: true }));
  }
  updateCampaign(id, patch) { this.setCampaignDraft((a) => { const c = a.find((x) => x.id === id); if (c) Object.assign(c, patch); }); }
  delCampaign(id) { this.setCampaignDraft((a) => { const i = a.findIndex((x) => x.id === id); if (i >= 0) a.splice(i, 1); }); }
  moveCampaign(id, dir) {
    this.setCampaignDraft((a) => {
      const i = a.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const [row] = a.splice(i, 1); a.splice(j, 0, row);
    });
  }
  async saveCampaignsDraft() {
    if (this.state.campaignBusy) return;
    const list = this.state.campaignDraft || [];
    if (list.some((c) => !String(c.name || '').trim())) { this.showToast('Chaque campagne a besoin d\'un nom'); return; }
    this.setState({ campaignBusy: true });
    try {
      const r = await api('PUT', '/campaigns', { campaigns: list });
      this.setState({ campaignBusy: false, campaigns: r.campaigns || [], campaignDraft: JSON.parse(JSON.stringify(r.campaigns || [])), campaignDirty: false, campaignSavedAt: Date.now() });
      this.showToast('Campagnes enregistrées ✓');
    } catch (e) { this.setState({ campaignBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }

  // ---- périodes de vente : produit × moment (matin/midi/aprem + exception) --
  async loadProdMoments() {
    try { const r = await api('GET', '/product-moments'); this.setState({ prodMoments: r.rows || [], prodMomentsCurrent: r.current || '', prodMomentsDirty: false }); }
    catch { /* indisponible : ignore */ }
  }
  // Bascule l'appartenance d'un produit à un moment (clic = inclus → exclu → rien).
  // Renvoie les lignes obtenues : setState est différé, l'appelant qui veut les
  // envoyer au serveur doit partir de cette valeur, pas de this.state.
  cycleProdMoment(productId, moment, kind = 'produit') {
    const rows = (this.state.prodMoments || []).slice();
    const i = rows.findIndex((r) => r.productId === productId && r.moment === moment && (r.kind || 'produit') === kind);
    if (i < 0) rows.push({ productId, moment, exception: false, kind });     // rien → inclus
    else if (!rows[i].exception) rows[i] = { ...rows[i], exception: true }; // inclus → exclu (exception)
    else rows.splice(i, 1);                                                 // exclu → rien
    this.setState({ prodMoments: rows, prodMomentsDirty: true });
    return rows;
  }
  // Vendu à ce moment ? Sans aucune règle, un produit est vendu tout le temps ;
  // sinon il faut une règle « vendu » à ce moment (et pas une exception).
  prodSoldAt(productId, moment) {
    const rows = (this.state.prodMoments || []).filter((r) => r.productId === productId && (r.kind || 'produit') === 'produit');
    if (!rows.length) return true;
    const here = rows.find((r) => r.moment === moment);
    if (here) return !here.exception;
    return !rows.some((r) => !r.exception);   // règles ailleurs seulement → exclu ici
  }
  prodMomentState(productId, moment, kind = 'produit') {
    const r = (this.state.prodMoments || []).find((x) => x.productId === productId && x.moment === moment && (x.kind || 'produit') === kind);
    return r ? (r.exception ? 'excl' : 'incl') : 'none';
  }
  // Promotions et campagnes se taguent depuis LEUR onglet, qui a déjà son
  // propre bouton d'enregistrement : on écrit la période dans la foulée pour
  // ne pas laisser deux « à enregistrer » concurrents dans le même écran.
  async cycleEntityMoment(kind, id, moment) {
    const rows = this.cycleProdMoment(id, moment, kind);
    try {
      const r = await api('PUT', '/product-moments', { rows });
      this.setState({ prodMoments: r.rows || rows, prodMomentsDirty: false });
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  // Cellules matin/midi/après-midi pour une entité taguable (promo, campagne).
  entityMomentCells(kind, id) {
    return [{ id: 'matin', label: 'Matin' }, { id: 'midi', label: 'Midi' }, { id: 'aprem', label: 'Après-midi' }].map((mo) => ({
      moment: mo.id, label: mo.label,
      state: this.prodMomentState(id, mo.id, kind),
      toggle: () => this.cycleEntityMoment(kind, id, mo.id),
    }));
  }
  // ---- Accueil « prêt à diffuser » ---------------------------------------
  openHome() { this.setState({ view: 'home' }); this.loadProdMoments(); this.refreshFleet(); }
  startFirstFilm() { this.newExampleFilm(); this.setState({ view: 'composer' }); }

  // ---- assistant vidéo de campagne ---------------------------------------
  // Il remplace l'assistant de diffusion : campagne du Marketing → produits →
  // quand → où → tags → film → diffusion (public/js/campaign-wizard.js).
  openWizard() { openCampaignWizard(this); }
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
    const T = (k, vars) => this.t(k, vars);
    const steps = [
      { key: 'catalog', ok: catalogOk, label: T('home.stepCatalog'), hint: catalogOk ? `${products.length} produit(s) · ${(st.catalog.categories || []).length} catégorie(s)` : 'aucun produit — connecte ta base', cta: { label: catalogOk ? 'Voir les produits' : 'Importer le catalogue', go: () => (catalogOk ? this.openProducts() : this.setView('settings')) } },
      { key: 'film', ok: filmsReady.length > 0, label: T('home.stepFilm'), hint: filmsReady.length ? `${filmsReady.length} film(s)` : 'aucun film avec du contenu', cta: { label: filmsReady.length ? 'Ouvrir le compositeur' : 'Créer mon premier film', go: () => (filmsReady.length ? this.setView('composer') : this.startFirstFilm()) } },
      { key: 'screen', ok: players.length > 0, label: T('home.stepScreen'), hint: players.length ? `${onlineN}/${players.length} en ligne` : 'aucun écran branché', cta: { label: 'Brancher un écran', go: () => this.openOnboarding() } },
      { key: 'data', ok: dataBits.length > 0, soft: true, label: T('home.stepData'), hint: dataBits.length ? dataBits.join(' · ') : 'saisons · périodes de vente · médias (optionnel mais recommandé)', cta: { label: 'Remplir les périodes', go: () => this.openSeasons() } },
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
    try { const r = await api('GET', '/media'); this.setState({ mediaLib: r.media || [], ...(r.maxMb ? { mediaMaxMb: r.maxMb } : {}) }); }
    catch { /* réservé admin : ignore si indisponible */ }
  }
  async delMediaLib(id, name) {
    if (!window.confirm(`Supprimer « ${name} » du serveur ?`)) return;
    try { const r = await api('DELETE', '/media/' + encodeURIComponent(id)); this.setState({ mediaLib: r.media || [] }); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }

  async patchMedia(id, patch) {
    try { const r = await api('PATCH', '/media/' + encodeURIComponent(id), patch); this.setState({ mediaLib: r.media || [] }); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  setMediaFilter(patch) { this.setState({ mediaFilter: { ...this.state.mediaFilter, ...patch } }); }
  setMediaUp(patch) { this.setState({ mediaUp: { ...this.state.mediaUp, ...patch } }); }
  // Dépôt depuis la Médiathèque : même route que l'espace agence (18 Mo au plus).
  async uploadMedia(file) {
    if (!file) return;
    const maxMb = this.state.mediaMaxMb || 4096;
    if (file.size > maxMb * 1048576) { this.showToast(this.t('media.tooBig', { mb: maxMb })); return; }
    const kind = (file.type || '').startsWith('image/') ? 'photo' : 'film';
    const up = this.state.mediaUp;
    this.setMediaUp({ busy: true, pct: 0 });
    try {
      const q = new URLSearchParams({ name: file.name, kind, moment: up.moment, productId: up.productId || '', seasonId: up.seasonId || '' });
      const r = await uploadFile(`/media/upload?${q}`, file, (p) => this.setMediaUp({ pct: Math.round(p * 100) }));
      this.setState({ mediaLib: r.media || [], mediaUp: { ...this.state.mediaUp, busy: false, open: false, pct: 0 } });
      this.showToast(this.t(r.storage === 's3' ? 'media.addedOvh' : 'media.added', { name: r.filename || file.name }));
      this.loadMediaStore();
    } catch (e) {
      this.setMediaUp({ busy: false, pct: 0 });
      this.showToast(`Erreur : ${e.message}`);
    }
  }

  // ---- stockage de la médiathèque (OVHcloud Object Storage) ----------------
  // Réglé par secrets (jamais en base) ; la régie montre l'état, vérifie le
  // bucket et y envoie les médias encore rangés sur ce serveur.
  async loadMediaStore() {
    try {
      const r = await api('GET', '/media-storage');
      this.setState({ mediaStore: r, mediaMaxMb: r.maxMb || this.state.mediaMaxMb });
      clearTimeout(this._mediaStorePoll);
      if (r.job && r.job.running) this._mediaStorePoll = setTimeout(() => this.loadMediaStore(), 1500);
      else if (this._mediaMigrating) {
        this._mediaMigrating = false;
        this.loadMediaLib();
        this.showToast(this.t('store.migrated', { n: r.job ? r.job.moved : 0, e: r.job ? r.job.errors.length : 0 }));
      }
    } catch { /* compte agence, ou indisponible */ }
  }
  async checkMediaStore() {
    if (this.state.mediaStoreBusy) return;
    this.setState({ mediaStoreBusy: true });
    try {
      const r = await api('POST', '/media-storage/check');
      this.setState({ mediaStoreBusy: false, mediaStore: r });
      this.showToast(r.check && r.check.ok ? this.t('store.checkOk') : `${this.t('store.checkKo')} : ${(r.check && r.check.error) || '?'}`);
    } catch (e) { this.setState({ mediaStoreBusy: false }); this.showToast(`Erreur : ${e.message}`); }
  }
  async migrateMediaStore() {
    const s = this.state.mediaStore;
    if (!s || !s.counts || !s.counts.localOnDisk) return;
    if (!window.confirm(this.t('store.migrateConfirm', { n: s.counts.localOnDisk }))) return;
    try {
      const r = await api('POST', '/media-storage/migrate');
      this._mediaMigrating = true;
      this.setState({ mediaStore: r });
      this._mediaStorePoll = setTimeout(() => this.loadMediaStore(), 1000);
    } catch (e) { this.showToast(`Erreur : ${e.message}`); }
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
  // Catalogue depuis l'API TFBuddy (la base PWA prend le relais si elle ne
  // répond pas) : visuels, ruptures et noms traduits de la régie sont gardés.
  async importCatalogNow() {
    if (this.state.catImportBusy) return;
    if (this.state.catDirty) { this.showToast(this.t('catimp.saveFirst')); return; }
    if (!window.confirm(this.t('catimp.confirm'))) return;
    this.setState({ catImportBusy: true });
    try {
      const r = await api('POST', '/catalog-import', { source: 'auto' });
      const st = await api('GET', '/catalog-import').catch(() => null);
      this.setState({ catImportBusy: false, catImport: st || this.state.catImport });
      if (!r.ok) { this.showToast(this.t('catimp.failToast', { err: r.error || '?' })); return; }
      const cat = await api('GET', '/catalog');
      this.setState({ catalog: { categories: cat.categories, products: cat.products }, catDraft: null, catDirty: false });
      await this.reloadLinkedModules();
      this.showToast(r.source === 'tfbuddy' ? this.t('catimp.doneApi', { p: r.products }) : this.t('catimp.donePwa'));
    } catch (e) { this.setState({ catImportBusy: false }); this.showToast(`Erreur : ${e.message}`); }
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
  // ---- gabarit HTML : format source, variables, exemple -------------------
  // Applique un format source (16:9, 9:16, A1…) à la maquette collée.
  setHtmlPreset(p) {
    const lib = this.cloneLib();
    const m = lib.find((x) => x.id === this.state.selId);
    if (!m) return;
    m.htmlW = p.w; m.htmlH = p.h;
    // Le format choisi fixe aussi l'orientation de l'item (filtre au montage).
    m.orient = p.h > p.w ? 'portrait' : 'paysage';
    this.setLib(lib);
  }
  // Insère une variable {{…}} à la position du curseur dans l'éditeur de code.
  insertHtmlToken(tok) {
    const cur = this.sel();
    if (!cur) return;
    const ta = document.getElementById('sig-html-editor');
    if (!ta) { this.setSelField('html', String(cur.html || '') + tok); return; }
    const v = ta.value;
    const a = ta.selectionStart == null ? v.length : ta.selectionStart;
    const b = ta.selectionEnd == null ? a : ta.selectionEnd;
    const next = v.slice(0, a) + tok + v.slice(b);
    ta.value = next;
    const pos = a + tok.length;
    try { ta.setSelectionRange(pos, pos); ta.focus(); } catch { /* champ détaché */ }
    this.setSelField('html', next);
  }
  // Décale une variable à l'écran (x/y en px de la maquette).
  moveHtmlVar(name, dx, dy) {
    const lib = this.cloneLib();
    const m = lib.find((x) => x.id === this.state.selId);
    if (!m) return;
    const vars = { ...(m.htmlVars || {}) };
    const cur = vars[name] || {};
    vars[name] = { ...cur, x: Math.round((cur.x || 0) + dx), y: Math.round((cur.y || 0) + dy) };
    m.htmlVars = vars;
    this.setLib(lib);
  }
  setHtmlVarPos(name, x, y) {
    const lib = this.cloneLib();
    const m = lib.find((x2) => x2.id === this.state.selId);
    if (!m) return;
    const vars = { ...(m.htmlVars || {}) };
    vars[name] = { ...(vars[name] || {}), x: Math.round(x), y: Math.round(y) };
    m.htmlVars = vars;
    this.setLib(lib);
  }
  // Lie (ou délie) une variable du gabarit à une source de données.
  setHtmlVar(name, patch) {
    const lib = this.cloneLib();
    const m = lib.find((x) => x.id === this.state.selId);
    if (!m) return;
    const vars = { ...(m.htmlVars || {}) };
    if (patch === null) delete vars[name];
    else vars[name] = { ...(vars[name] || {}), ...patch };
    m.htmlVars = vars;
    this.setLib(lib);
  }
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
  setPos(f, v) { this.setPosMany({ [f]: v }); }
  // Plusieurs champs d'un coup : setState étant différé, trois setPos enchaînés
  // repartiraient chacun de l'état d'AVANT et s'écraseraient l'un l'autre.
  setPosMany(patch) { const lib = this.cloneLib(); const m = lib.find((x) => x.id === this.state.selId); m.pos = { ...(m.pos || newPos()), ...patch }; this.setLib(lib); }
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
  // Ouvre un écran du menu avec son chargement (produits, périodes, campagnes…).
  goView(v) {
    if (v === 'home') this.openHome();
    else if (v === 'campaignVideo') this.openWizard();
    else if (v === 'products') this.openProducts();
    else if (v === 'promotions') this.openPromotions();
    else if (v === 'campaigns') this.openCampaigns();
    else if (v === 'seasons') this.openSeasons();
    else if (v === 'translations') this.openTranslations();
    else if (v === 'media') { this.setView('media'); this.loadMediaLib(); if (!this.state.seasons.length) this.loadSeasons(); }
    else this.setView(v);
  }
  // Traduction d'une clé pour la langue d'interface courante (+ interpolation).
  t(key, vars) { return tr(this.state.uiLang, key, vars); }
  // Change la langue de l'interface et la mémorise pour ce navigateur.
  setUiLang(lang) {
    if (!UI_LANG_IDS.includes(lang) || lang === this.state.uiLang) return;
    try { localStorage.setItem('sig_ui_lang', lang); } catch { /* pas de localStorage */ }
    try { document.documentElement.setAttribute('lang', lang); } catch { /* hors DOM */ }
    this.setState({ uiLang: lang });
  }
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
      { label: 'Affiche A1 · portrait', sub: '594 × 841 mm (2970 × 4205) · mise en page portrait', url: this.filmUrl({ w: 2970, h: 4205 }) },
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

  // ---- secteurs d'écrans (zones : position + nombre d'écrans propres) ------
  async addGroup(storeId) {
    try { await api('POST', `/stores/${storeId}/groups`, { name: this.t('sector.newName'), screens: 1, size: 55, orient: 'portrait', cats: [] }); await this.refreshFleet(); this.showToast(this.t('sector.added')); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async saveGroup(id, patch) {
    try { await api('POST', `/groups/${id}`, patch); await this.refreshFleet(); }
    catch (e) { this.showToast(`Erreur : ${e.message}`); }
  }
  async delGroup(id) {
    if (!window.confirm(this.t('sector.delConfirm'))) return;
    try { await api('DELETE', `/groups/${id}`); await this.refreshFleet(); this.showToast(this.t('sector.deleted')); }
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
    const pw = this.previewWidth();
    const scale = pw / W;
    this._scale = scale;
    const stage = h('div', { style: { position: 'absolute', left: 0, top: 0, width: W, height: H, background: '#F5EFE4', transform: `scale(${scale})`, transformOrigin: 'top left' } }, inner);
    return h('div', { style: { position: 'relative', width: pw, height: Math.round(H * scale), margin: '0 auto' } }, stage);
  }

  // -------------------------------------------------------------------- vals
  vals() {
    const st = this.state;
    const m = this.sel() || { type: 'category', name: '', tag: newTag(), schedule: newSched(), pos: newPos(), items: [] };
    const isCat = m.type === 'category', isLia = m.type === 'liaison';
    const isProduit = m.type === 'produit', isFilmEl = m.type === 'film', isAnim = m.type === 'animation';
    const isMedia = m.type === 'media';
    const isPromo = m.type === 'promotion';
    const isCampaign = m.type === 'campagne';
    const isBundle = m.type === 'bundle';
    const isHtml = m.type === 'html';
    const selType = this.elementTypeOf(m);
    const total = this.total();
    const { m: playM, lt } = this.activeInScope();
    const iconBtn = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--paper);border:1px solid var(--line);cursor:pointer;font-size:14px;color:var(--ink);';
    const miniBtn = 'display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.7);border:1px solid var(--line);cursor:pointer;font-size:12px;color:var(--ink);';
    const tagChipOf = (mm) => (mm.tag && mm.tag.enabled
      ? h('span', { style: { flex: '0 0 auto', fontSize: 11, fontWeight: 500, color: '#fff', background: RUBY, borderRadius: 999, padding: '2px 8px' } }, 'Promo')
      : null);
    // Chip de catégorie de bibliothèque (Produit / Fêtes / Promo / Liaison), colorée.
    const catChipOf = (mm) => {
      const t = this.libCatOf(mm);
      return h('span', { style: { flex: '0 0 auto', fontSize: 11, fontWeight: 500, color: t.color, background: t.color + '1A', borderRadius: 999, padding: '2px 8px' } }, t.name);
    };

    const playlist = st.playlist.map((id, i) => {
      const mm = this.getMod(id);
      if (!mm) return {};
      const isLi = mm.type === 'liaison', selc = mm.id === st.selId;
      return {
        id, name: mm.name, order: i + 1, tagChip: tagChipOf(mm),
        meta: `${isLi ? 'Liaison' : this.activeItems(mm).length + ' produits'} · ${this.schedSummary(mm.schedule)}`,
        cardStyle: `display:flex;align-items:flex-start;gap:9px;padding:10px 10px;border-radius:10px;cursor:pointer;background:#fff;border:1px solid ${selc ? 'var(--accent)' : 'var(--line)'};${selc ? 'box-shadow:inset 0 0 0 1px var(--accent);' : ''}`,
        badgeStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;flex:0 0 auto;font-size:12px;font-weight:500;${isLi ? 'background:rgba(35,34,32,0.10);color:var(--muted);' : 'background:rgba(141,29,44,0.12);color:var(--accent);'}`,
        miniBtnDel: miniBtn + 'color:var(--accent);',
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
    // La liste de la bibliothèque suit le filtre de format choisi au montage.
    const library = st.library.filter((mm) => this.fitsOrient(mm, st.libOrient)).map((mm) => {
      const isLi = mm.type === 'liaison', selc = mm.id === st.selId;
      const cnt = inPlaylistCount[mm.id] || 0;
      return {
        name: mm.name, tagChip: tagChipOf(mm), catChip: catChipOf(mm),
        typeIcon: (this.elementTypeOf(mm) || {}).icon || (isLi ? '⧉' : '▤'),
        libMeta: `${this.modMeta(mm)}${cnt ? ' · dans playlist ×' + cnt : ' · ⚠ hors playlist (＋ pour diffuser)'}`,
        cardStyle: `display:flex;align-items:flex-start;gap:9px;padding:10px 10px;border-radius:10px;cursor:pointer;background:#fff;border:1px solid ${selc ? 'var(--accent)' : 'var(--line)'};${selc ? 'box-shadow:inset 0 0 0 1px var(--accent);' : ''}`,
        badgeStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;flex:0 0 auto;font-size:12px;${isLi ? 'background:rgba(35,34,32,0.10);color:var(--muted);' : 'background:rgba(141,29,44,0.12);color:var(--accent);'}`,
        addBtn: miniBtn + 'background:var(--accent);color:#fff;border:none;font-weight:500;',
        miniBtn, miniBtnDel: miniBtn + 'color:var(--accent);',
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
      style: `text-align:left;padding:13px 13px;border-radius:12px;cursor:pointer;background:${m.layout === o.id ? 'rgba(141,29,44,0.08)' : '#fff'};border:1px solid ${m.layout === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:var(--ink);`,
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
          style: `text-align:center;padding:9px 6px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;background:${isCat && cur === o.id ? 'rgba(141,29,44,0.08)' : '#fff'};border:1px solid ${isCat && cur === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:var(--ink);`,
        })),
      };
    });

    const items = (isCat && !m.catRef ? m.items : []).map((t, i) => ({
      name: t.name, price: t.price, img: t.img, active: t.active,
      isIllus: t.src !== 'photo', isPhoto: t.src === 'photo',
      photoLabel: t.src === 'photo' ? 'Photo importée · changer' : 'Importer une photo',
      thumb: h('img', { src: t.img, alt: '', style: { width: 46, height: 46, objectFit: 'contain', flex: '0 0 auto', background: '#fff', borderRadius: 8, padding: 3, boxSizing: 'border-box', border: t.src === 'photo' ? '1px solid var(--line)' : 'none' } }),
      wrapStyle: `display:flex;flex-direction:column;gap:9px;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:${t.active ? '#fff' : 'rgba(35,34,32,0.035)'};opacity:${t.active ? 1 : 0.6};`,
      iconBtn,
      delBtn: iconBtn + 'color:var(--accent);',
      eyeStyle: iconBtn + (t.active ? '' : 'background:rgba(141,29,44,0.10);color:var(--accent);'),
      eyeIcon: t.active ? '👁' : '⃠',
      illusTabStyle: `padding:6px 11px;font-size:12px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${t.src !== 'photo' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
      photoTabStyle: `padding:6px 11px;font-size:12px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${t.src === 'photo' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
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
        style: `padding:9px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`,
      };
    });
    const days = DAYS.map((lab, d) => ({
      label: lab,
      toggle: () => this.toggleDay(d),
      style: `width:52px;padding:9px 0;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${m.schedule.days[d] ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`,
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
        blockStyle: `flex:0 0 auto;display:flex;flex-direction:column;justify-content:space-between;gap:4px;padding:9px 11px;border-radius:10px;cursor:grab;opacity:${skip ? 0.55 : 1};background:${playingHere ? '#8D1D2C' : '#fff'};color:${playingHere ? '#fff' : '#232220'};border:1px ${skip ? 'dashed rgba(141,29,44,0.5)' : `solid ${playingHere ? '#8D1D2C' : 'rgba(35,34,32,0.12)'}`};`,
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
    // L'orientation est le filtre PRINCIPAL : les compteurs de catégorie ne
    // comptent que les items du format d'écran choisi.
    const libByOrient = st.library.filter((mm) => this.fitsOrient(mm, st.libOrient));
    const tagCount = {};
    libByOrient.forEach((mm) => { const t = this.libCatOf(mm).id; tagCount[t] = (tagCount[t] || 0) + 1; });
    const libTagChips = [
      {
        id: 'all', label: 'Tous', count: libByOrient.length, color: '#232220',
        active: st.libFilter === 'all',
        pick: () => this.setState({ libFilter: 'all' }),
      },
      // Les catégories désactivées ne servent plus au classement, mais restent
      // proposées tant qu'elles portent encore des éléments.
      ...this.libCatList().filter((t) => t.active !== false || tagCount[t.id]).map((t) => ({
        id: t.id, label: t.name, count: tagCount[t.id] || 0, color: t.color,
        active: st.libFilter === t.id,
        pick: () => this.setState({ libFilter: t.id }),
      })),
    ].map((c) => ({
      ...c,
      style: `display:inline-flex;align-items:center;gap:7px;padding:8px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;transition:all 0.15s;${c.active ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}`,
      dotStyle: `width:8px;height:8px;border-radius:50%;background:${c.active ? '#fff' : c.color};`,
    }));
    // Filtre de format : ne proposer au montage que les items compatibles avec
    // l'orientation visée (les items « tous formats » restent toujours offerts).
    const ORIENTS = [
      { id: 'paysage', label: '16:9 paysage', icon: '▭' },
      { id: 'portrait', label: '9:16 portrait', icon: '▯' },
    ];
    const libOrientChips = ORIENTS.map((o) => ({
      id: o.id, label: o.label, icon: o.icon,
      count: st.library.filter((mm) => this.fitsOrient(mm, o.id)).length,
      active: st.libOrient === o.id,
      pick: () => this.setState({ libOrient: o.id }),
      style: `display:inline-flex;align-items:center;gap:6px;padding:7px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${st.libOrient === o.id ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:#fff;color:var(--muted-2);border:1px solid var(--line);'}`,
    }));
    const libCards = st.library.filter((mm) => (st.libFilter === 'all' || this.libCatOf(mm).id === st.libFilter) && this.fitsOrient(mm, st.libOrient)).map((mm) => ({
      name: mm.name,
      typeIcon: (this.elementTypeOf(mm) || {}).icon || '▤',
      meta: this.modMeta(mm),
      tagLabel: this.libCatOf(mm).name,
      tagColor: this.libCatOf(mm).color,
      inFilm: (inPlaylistCount[mm.id] || 0) > 0,
      onDragStart: (e) => { e.dataTransfer.setData('text/plain', 'lib:' + mm.id); e.dataTransfer.effectAllowed = 'copy'; },
      add: () => this.appendToTimeline(mm.id),
      edit: () => { this.setComposerTab('lib'); this.selectMod(mm.id); },
    }));
    const libEmptyMsg = st.library.length && !libCards.length
      ? `Aucun élément dans la catégorie « ${(this.libCatList().find((t) => t.id === st.libFilter) || {}).name || st.libFilter} ».`
      : '';
    const pubDaysVals = DAYS.map((lab, d) => ({
      label: lab,
      toggle: () => this.togglePubDay(d),
      style: `width:52px;padding:9px 0;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${st.pubDays[d] ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`,
    }));

    // ---- programmation & magasins du film (onglet Playlist) ----
    const filmActive = this.activeFilm();
    const chipDay = (on) => `width:48px;padding:8px 0;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`;
    const chipWide = (on) => `padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`;
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
        style: `display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}`,
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
    const stTab = 'padding:8px 16px;font-size:13px;font-weight:500;border:none;border-radius:8px;cursor:pointer;';
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
      { label: 'Écrans en ligne', value: `${online}`, sub: `sur ${plCount}`, tone: plCount && online === plCount ? 'good' : '' },
      { label: 'Hors ligne', value: `${offline}`, sub: offline ? 'lit le cache' : '—', tone: offline ? 'bad' : '' },
      { label: 'Prix le + ancien', value: ageShort(oldest), sub: stale ? `${stale} écran(s) périmés` : 'à jour', tone: stale ? 'bad' : 'good' },
      { label: 'Playlist · données', value: `v${st.version}`, sub: `prix d${st.dataVer}`, tone: '' },
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
        // Position des écrans du secteur : choix direct portrait / paysage.
        setOrient: (orient) => { if (orient !== (g.format || {}).orient) this.saveGroup(g.id, { orient }); },
        onAddCat: (e) => { const cid = e.target.value; e.target.value = ''; if (cid) this.saveGroup(g.id, { cats: [...(g.cats || []), cid] }); },
        // Le secteur dit lui-même ce qu'il filtre : les périodes, les catégories.
        filterMoments: !!g.filterMoments, filterCats: g.filterCats !== false,
        toggleMoments: () => this.saveGroup(g.id, { filterMoments: !g.filterMoments }),
        toggleCats: () => this.saveGroup(g.id, { filterCats: g.filterCats === false }),
        // Ni période ni catégorie → rien à filtrer, l'écran suit le magasin.
        noFilter: !g.filterMoments && (g.filterCats === false || !(g.cats || []).length),
        previewUrl: this.filmUrl({ group: g.id }),
        copyPreview: () => this.copyLink(this.filmUrl({ group: g.id })),
        del: () => this.delGroup(g.id),
      })),
      addGroup: () => this.addGroup(s.id),
      // Compte magasin + ruptures que le magasin a déclarées pour SES écrans.
      account: s.account || null,
      unavailableNames: (s.unavailable || []).map((u) => (((st.catalog && st.catalog.products) || []).find((p) => p.id === u.productId) || {}).name || u.productId),
      createAccount: () => this.storeAccount(s.id, 'create'),
      resetAccount: () => this.storeAccount(s.id, 'reset'),
      deleteAccount: () => this.storeAccount(s.id, 'delete'),
      cred: st.storeCred && st.storeCred.storeId === s.id ? st.storeCred : null,
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
          kioskStyle: `flex:0 0 auto;font-size:9px;font-weight:500;letter-spacing:0.06em;border-radius:999px;padding:2px 7px;${p.kiosk ? 'background:rgba(63,122,82,0.14);color:var(--green);' : 'background:rgba(141,29,44,0.12);color:var(--accent);'}`,
          statusDotStyle: `width:12px;height:12px;border-radius:50%;flex:0 0 auto;background:${ov ? '#8D1D2C' : STCOL[p.state]};box-shadow:0 0 0 4px ${ov ? '#8D1D2C' : STCOL[p.state]}22;`,
          statusPillStyle: `display:inline-flex;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:500;color:${ov ? '#fff' : STCOL[p.state]};background:${ov ? '#8D1D2C' : STCOL[p.state] + '18'};`,
          statusLabel: ov ? '⚡ Override' : STLAB[p.state],
          playedVer: p.playedVer,
          verStyle: `font-weight:500;color:${late ? '#B8860B' : '#232220'};`,
          verNote: late ? `assignée v${p.assignedVer} · en retard` : 'à jour',
          dataVer: p.dataVer,
          dataStyle: `font-weight:500;color:${dstale ? '#8D1D2C' : '#232220'};`,
          dataAge: p.state === 'offline' ? `${ageShort(p.dataAge)} (cache)` : `il y a ${ageShort(p.dataAge)}`,
          dataAgeColor: dstale ? '#8D1D2C' : '#8A847C',
          cachePct: `${p.cache}%`,
          cacheColor: p.cache >= 100 ? '#2E7D32' : p.cache >= 50 ? '#B8860B' : '#8D1D2C',
          // Ce que l'écran a VRAIMENT sur son disque (fichiers téléchargés, pas
          // seulement « préchargés »), et s'il saurait redémarrer sans réseau.
          ...(() => {
            const d = p.detail;
            if (!d) return { cacheNote: 'détail indisponible — player d\'avant le cache hors ligne', cacheNoteColor: '#8A847C' };
            const a = d.assets || {};
            const parts = [`${a.cached || 0}/${a.total || 0} fichiers sur l'écran`];
            if (a.missing) parts.push(`${a.missing} absent(s) du serveur`);
            if (a.external) parts.push(`${a.external} externe(s) non gardé(s)`);
            if (a.error) parts.push(`${a.error} en échec réseau`);
            if (a.quota) parts.push('disque plein');
            parts.push(d.storage && d.storage.persisted ? 'stockage protégé' : 'stockage non protégé');
            parts.push(d.sw ? 'redémarre hors ligne ✓' : (d.secure ? 'mise en cache de la page…' : 'http : ne redémarre pas hors ligne'));
            if (d.fromCache) parts.push('joue depuis son cache');
            const bad = a.missing || a.error || a.quota;
            return { cacheNote: parts.join(' · '), cacheNoteColor: bad ? '#8D1D2C' : '#8A847C' };
          })(),
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
        style: `display:inline-flex;align-items:center;gap:7px;padding:7px 14px;font-size:12px;font-weight:500;text-transform:uppercase;border-radius:8px;cursor:pointer;${on ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:#fff;color:var(--accent);border:1px solid rgba(141,29,44,0.3);'}`,
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
        cardStyle: `display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:10px;cursor:pointer;background:${on ? '#fff' : 'rgba(255,255,255,0.5)'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.08)'};opacity:${c.active !== false ? 1 : 0.55};`,
        pick: () => this.setState({ catSel: c.id }),
        onName: (e) => this.setCat((d) => {
          const x = d.categories.find((y) => y.id === c.id);
          if (!x) return;
          if (isBaseLang) x.name = e.target.value;
          else { x.aliases = x.aliases || {}; if (e.target.value.trim()) x.aliases[editLang] = e.target.value; else delete x.aliases[editLang]; }
        }),
        // Règle : une CATÉGORIE porte une illustration (le produit, lui, une photo).
        img: c.img || '',
        imgOk: imgRenderable(c.img || ''),
        onImg: (e) => this.setCat((d) => { const x = d.categories.find((y) => y.id === c.id); if (x) x.img = e.target.value; }),
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
      thumb: h('img', { src: p.img, alt: '', style: { width: 42, height: 42, objectFit: p.src === 'photo' ? 'cover' : 'contain', flex: '0 0 auto', background: '#fff', borderRadius: 8, padding: 2, boxSizing: 'border-box' } }),
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
      // Ouvre le résumé « Régie → Apparition… » de ce produit (celui que l'ERP lit).
      showAppearance: () => this.openAppearance(p.id),
      appearanceOpen: !!(st.appearance && st.appearance.produit.id === p.id),
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
        style: `display:flex;flex-direction:column;gap:2px;align-items:flex-start;padding:11px 15px;border-radius:12px;cursor:pointer;text-align:left;background:${on ? 'rgba(141,29,44,0.06)' : '#fff'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
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
        style: `display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-radius:12px;cursor:pointer;text-align:left;background:${on ? 'rgba(141,29,44,0.06)' : '#fff'};border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
        checkStyle: `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;flex:0 0 auto;font-size:13px;${on ? 'background:var(--accent);color:#fff;' : 'background:#fff;border:1px solid rgba(35,34,32,0.20);color:transparent;'}`,
        check: on ? '✓' : '',
      };
    });
    const PSLOTS = ['Matin', 'Midi', 'Après-midi', 'Toute la journée'];
    const pubSlots = PSLOTS.map((l) => ({
      label: l,
      pick: () => this.setState({ pubSlot: l }),
      style: `padding:9px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${st.pubSlot === l ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--muted);border:1px solid var(--line);'}`,
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
        label, cur: !!cur, link: !!go,
        go: go || (() => {}),
        sepStyle: `font-size:13px;color:var(--faint);margin:0 4px;${arr.length === 0 ? 'display:none;' : ''}`,
        style: `background:none;border:none;padding:2px 4px;font-size:12.5px;cursor:${go ? 'pointer' : 'default'};${cur ? 'color:var(--ink);font-weight:500;' : 'color:var(--muted);'}`,
      });
      const T = (k, vars) => this.t(k, vars);
      const unsaved = (dirty) => (dirty ? ' · ' + T('common.unsaved') : '');
      // L'accueil n'a pas de fil : le titre suffit.
      if (st.view === 'home') return arr;
      if (st.view === 'media') {
        arr.push(crumb(T('nav.media'), null, false));
        arr.push(crumb(T('media.count', { n: (st.mediaLib || []).length }), null, true));
        return arr;
      }
      if (st.view === 'fleet') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('nav.fleet'), () => this.setView('fleet'), false));
        arr.push(crumb(T('crumb.screensStores', { s: online + offline, m: st.fleet.length }), null, true));
      } else if (st.view === 'settings') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('settings.title'), null, false));
        arr.push(crumb(T('settings.serverConn'), null, true));
      } else if (st.view === 'products') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('products.tableCrumb'), null, false));
        arr.push(crumb(T('crumb.catsProducts', { c: (st.catDraft || st.catalog).categories.length, p: (st.catDraft || st.catalog).products.length }) + unsaved(st.catDirty), null, true));
      } else if (st.view === 'seasons') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('seasons.title'), null, false));
        arr.push(crumb(T('crumb.periods', { n: (st.seasons || []).length }) + unsaved(st.seasonsDirty), null, true));
      } else if (st.view === 'promotions') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('nav.promotions'), null, false));
        arr.push(crumb(T('crumb.tfbPromos', { n: (st.bundles || []).length + (st.tfbPromos || []).length }) + unsaved(st.promoDirty), null, true));
      } else if (st.view === 'campaigns') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('nav.campaigns'), null, false));
        arr.push(crumb(T('crumb.campaigns', { n: (st.campaignDraft || st.campaigns || []).length }) + unsaved(st.campaignDirty), null, true));
      } else if (st.view === 'translations') {
        const c = (st.tr && st.tr.counts) || {};
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('nav.translations'), null, false));
        arr.push(crumb(T('crumb.translations', { n: c.total || 0, p: c.proposed || 0 }), null, true));
      } else if (st.view === 'planning') {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('planning.weekCrumb'), null, false));
        arr.push(crumb(T('crumb.weekStores', { w: st.planWeek, m: st.planStores.length }), null, true));
      } else {
        arr.push(crumb(T('nav.composer'), () => this.setView('composer'), false));
        arr.push(crumb(T('crumb.film', { name: this.activeFilm().name }), null, false));
        arr.push(crumb(`${m.name}${isLia ? T('crumb.liaison') : ''}`, null, true));
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
      // La catégorie porte elle aussi ses périodes de vente : hors créneau,
      // elle retire TOUS ses produits (le tag produit affine à l'intérieur).
      taggable: gk !== '_none',
      cells: saleMoments.map((mo) => ({
        moment: mo.id,
        state: this.prodMomentState(gk, mo.id, 'categorie'),
        toggle: () => this.cycleProdMoment(gk, mo.id, 'categorie'),
      })),
    });
    const prodMomentCats = [];
    const pmSeen = new Set();
    for (const c of (st.catalog.categories || [])) {
      const products = pmByCat.get(c.id);
      if (products && products.length) { prodMomentCats.push(pmCatOf(c.id, products)); pmSeen.add(c.id); }
    }
    for (const [gk, products] of pmByCat) if (!pmSeen.has(gk)) prodMomentCats.push(pmCatOf(gk, products));
    const pmAllCollapsed = prodMomentCats.length > 0 && prodMomentCats.every((c) => c.collapsed);
    // Parcours de la bibliothèque pour la boucle (calculé une fois par rendu).
    const contLoopRows = this.contLoopRows();

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

    // ---- médiathèque (écran du menu) ----
    const mf = st.mediaFilter;
    const mQ = (mf.q || '').trim().toLowerCase();
    const MOMENT_TAG = { matin: this.t('moment.matin'), midi: this.t('moment.midi'), aprem: this.t('moment.aprem'), all: this.t('media.allDay') };
    const mediaView = {
      total: (st.mediaLib || []).length,
      filter: mf,
      kinds: [['all', this.t('media.all')], ['film', this.t('media.videos')], ['photo', this.t('media.photos')]]
        .map(([id, label]) => ({ id, label, on: mf.kind === id, pick: () => this.setMediaFilter({ kind: id }) })),
      moments: [['all', this.t('media.anyMoment')], ['matin', MOMENT_TAG.matin], ['midi', MOMENT_TAG.midi], ['aprem', MOMENT_TAG.aprem]]
        .map(([id, label]) => ({ id, label, on: mf.moment === id, pick: () => this.setMediaFilter({ moment: id }) })),
      momentOpts: ['all', 'matin', 'midi', 'aprem'].map((id) => ({ id, label: MOMENT_TAG[id] })),
      products: seasonProdOpts,
      seasons: (st.seasons || []).map((x) => ({ id: x.id, name: x.name })),
      onProduct: (e) => this.setMediaFilter({ product: e.target.value }),
      onSeason: (e) => this.setMediaFilter({ season: e.target.value }),
      onSearch: (e) => this.setMediaFilter({ q: e.target.value }),
      up: st.mediaUp,
      toggleUp: () => this.setMediaUp({ open: !st.mediaUp.open }),
      upMoment: (e) => this.setMediaUp({ moment: e.target.value }),
      upProduct: (e) => this.setMediaUp({ productId: e.target.value }),
      upSeason: (e) => this.setMediaUp({ seasonId: e.target.value }),
      upFile: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; this.uploadMedia(f); },
      refresh: () => this.loadMediaLib(),
      cards: (st.mediaLib || []).filter((mm) => (mf.kind === 'all' || mm.kind === mf.kind)
        && (mf.moment === 'all' || mm.moment === mf.moment)
        && (!mf.product || mm.productId === mf.product)
        && (!mf.season || mm.seasonId === mf.season)
        && (!mQ || String(mm.filename).toLowerCase().includes(mQ)))
        .map((mm) => ({
          id: mm.id, filename: mm.filename, kind: mm.kind, url: mm.url, present: mm.present,
          meta: `${Math.round((mm.size || 0) / 1024 / 1024 * 10) / 10} Mo${mm.createdAt ? ' · ' + String(mm.createdAt).slice(0, 10).split('-').reverse().join('/') : ''}`,
          moment: mm.moment, momentLabel: MOMENT_TAG[mm.moment] || mm.moment,
          productId: mm.productId, productName: (seasonProdOpts.find((x) => x.id === mm.productId) || {}).name || '',
          seasonId: mm.seasonId, seasonName: ((st.seasons || []).find((x) => x.id === mm.seasonId) || {}).name || '',
          editing: st.mediaEdit === mm.id,
          toggleEdit: () => this.setState({ mediaEdit: st.mediaEdit === mm.id ? null : mm.id }),
          setMoment: (e) => this.patchMedia(mm.id, { moment: e.target.value }),
          setProduct: (e) => this.patchMedia(mm.id, { productId: e.target.value }),
          setSeason: (e) => this.patchMedia(mm.id, { seasonId: e.target.value }),
          del: () => this.delMediaLib(mm.id, mm.filename),
        })),
    };

    const subTab = 'padding:8px 18px;font-size:13px;font-weight:500;border:none;border-radius:8px;cursor:pointer;';
    const hdrRound = 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;flex:0 0 auto;';
    return {
      // Traduction de l'interface + sélecteur de langue (FR / EN / IT).
      t: (k, vars) => this.t(k, vars),
      uiLang: st.uiLang,
      uiLangs: UI_LANGS.map((l) => ({ ...l, active: l.id === st.uiLang, pick: () => this.setUiLang(l.id) })),
      playlist, library, layoutOptions, motionGroups, items, days, posFields, timeSlots, crumbs,
      timelineBlocks, timelineTotal, timelineEndDrop, libCards, libTagChips, libEmptyMsg, pubDaysVals,
      libOrientChips, libOrient: st.libOrient,
      // Orientation de l'élément courant (filtre de disponibilité au montage).
      orientOpts: [
        { id: 'paysage', label: '16:9 paysage', hint: 'écrans paysage' },
        { id: 'portrait', label: '9:16 portrait', hint: 'écrans portrait' },
      ].map((o) => ({ ...o, active: this.orientOf(m) === o.id, pick: () => this.setSelField('orient', o.id) })),
      orientSummary: this.orientOf(m) === 'portrait' ? '9:16 portrait' : '16:9 paysage',
      // Moments où l'item peut passer (aucun coché = tous les moments).
      momentOpts: saleMoments.map((mo) => {
        const cur = Array.isArray(m.moments) ? m.moments : [];
        return {
          id: mo.id, label: mo.label, active: cur.includes(mo.id),
          toggle: () => this.setSelField('moments', cur.includes(mo.id) ? cur.filter((x) => x !== mo.id) : [...cur, mo.id]),
        };
      }),
      momentSummary: (Array.isArray(m.moments) && m.moments.length)
        ? m.moments.map((x) => ({ matin: 'matin', midi: 'midi', aprem: 'après-midi' })[x] || x).join(' · ')
        : 'tous les moments',
      orientEffective: this.orientOf(m),
      prodCats, prodRows, storeCols, prodSelCat, langChips, isBaseLang,
      catImp: (() => {
        const ci = st.catImport || {};
        const s0 = ci.status || {};
        const configured = !!(ci.tfbuddy && ci.tfbuddy.configured);
        const ago = (at) => {
          const m = at ? Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)) : null;
          return m == null ? '' : m < 1 ? this.t('bundles.justNow') : m < 120 ? this.t('bundles.minAgo', { n: m }) : this.t('bundles.hAgo', { n: Math.round(m / 60) });
        };
        const src = (x) => (x === 'pwa' ? this.t('catimp.pwa') : this.t('catimp.api'));
        let tone = 'off';
        let head = '';
        let text = '';
        const notes = [];
        if (s0.at && s0.ok) {
          tone = s0.source === 'tfbuddy' ? 'ok' : 'warn';
          head = src(s0.source);
          text = s0.source === 'tfbuddy'
            ? this.t('catimp.okApi', { ago: ago(s0.at), p: s0.products || 0, s: s0.sold || 0, n: s0.storePrices || 0, m: s0.stores || 0 })
            : this.t('catimp.okPwa', { ago: ago(s0.at), p: s0.products || 0, n: s0.storePrices || 0 });
          if (s0.apiError) notes.push(this.t('catimp.apiFallback', { err: s0.apiError }));
        } else if (s0.at) {
          tone = 'bad';
          head = src(s0.source);
          text = this.t('catimp.failed', { err: s0.error || '?' });
          if (s0.apiError && s0.source === 'pwa') notes.push(this.t('catimp.apiFallback', { err: s0.apiError }));
          if (s0.lastOk) notes.push(this.t('catimp.lastOk', { ago: ago(s0.lastOk), src: src(s0.lastOkSource) }));
        } else {
          head = configured ? this.t('catimp.api') : this.t('catimp.pwa');
          text = configured ? this.t('catimp.never') : this.t('catimp.off');
        }
        if ((s0.unmappedShops || []).length) notes.push(this.t('catimp.unmapped', { ids: s0.unmappedShops.join(', ') }));
        if (s0.noPrice) notes.push(this.t('catimp.noPrice', { n: s0.noPrice }));
        if (s0.retired) notes.push(this.t('catimp.retired', { n: s0.retired }));
        if ((s0.warnings || []).length) notes.push(this.t('catimp.warnings', { list: s0.warnings.slice(0, 4).join(' · ') }));
        return { tone, head, text, notes, configured, busy: !!st.catImportBusy, run: () => this.importCatalogNow() };
      })(),
      appearance: st.appearance, appearanceBusy: st.appearanceBusy,
      seasonRows, seasonsDirty: st.seasonsDirty, seasonsBusy: st.seasonsBusy, seasonsCount: (st.seasons || []).length,
      seasonsCurrentCount: (st.seasonsCurrent || []).length,
      addSeason: () => this.addSeason(), saveSeasons: () => this.saveSeasons(), importSeasons: () => this.importSeasons(),
      diagSeasons: () => this.diagSeasons(), wsDiag: st.wsDiag,
      wsTable: st.wsTable, onWsTable: (e) => this.setState({ wsTable: e.target.value }),
      wsCandidates: st.wsCandidates || [], useWsCandidate: (t) => this.setState({ wsTable: t }),
      wsInspected: st.wsInspected || [],
      // -- promotions (sous-types dynamiques) --
      promoDirty: st.promoDirty, promoBusy: st.promoBusy,
      promoCount: (st.promoDraft || st.promoTypes || []).length,
      // -- style des badges : une ligne par famille TFBuddy --
      badgeFamilies: TFB_FAMILIES.map((f) => {
        const cur = (st.tfbBadges || {})[f] || '';
        return {
          id: f, label: this.t(`badges.fam.${f}`), cur,
          count: f === 'bundle' ? (st.bundles || []).length : (st.tfbPromos || []).filter((x) => this.tfbFamilyOf(x) === f).length,
          houseLabel: f === 'bundle' ? this.t('badges.house') : this.t('badges.own'),
          missing: !!cur && !this.familyBadge(f),
          preview: this.familyBadgeShown(f),
          onPick: (e) => this.setFamilyBadge(f, e.target.value),
        };
      }),
      badgeStyleOptions: (st.promoTypes || []).map((t) => ({ id: t.id, label: `${t.icon || ''} ${t.name}${t.active === false ? ` (${this.t('styles.inactive')})` : ''}` })),
      badgeBusy: !!st.badgeBusy,
      addPromoType: () => this.addPromoType(), savePromoTypes: () => this.savePromoTypesDraft(),
      promoRows: (st.promoDraft || st.promoTypes || []).map((t, i, arr) => {
        // Familles TFBuddy que ce style habille (Style des badges).
        const fams = TFB_FAMILIES.filter((f) => (st.tfbBadges || {})[f] === t.id);
        // Éléments qui portent ce badge à l'écran : promotions (badge de leur
        // famille quand elles sont reliées) et bundles si ce style les habille.
        const used = (st.library || []).filter((m) => (m.type === 'promotion' && (this.promoBadge(m) || {}).type === t.id)
          || (m.type === 'bundle' && fams.includes('bundle'))).length;
        return {
          id: t.id, name: t.name, icon: t.icon || '🏷️', color: t.color || '#C0392B',
          descr: t.descr || '', active: t.active !== false, used,
          dresses: fams.map((f) => this.t(`badges.fam.${f}`)),
          // La promotion porte elle-même son tag de période (matin/midi/aprem).
          moCells: this.entityMomentCells('promotion', t.id),
          isFirst: i === 0, isLast: i === arr.length - 1,
          onName: (e) => this.updatePromoType(t.id, { name: e.target.value }),
          onIcon: (e) => this.updatePromoType(t.id, { icon: e.target.value }),
          onColor: (e) => this.updatePromoType(t.id, { color: e.target.value }),
          onDescr: (e) => this.updatePromoType(t.id, { descr: e.target.value }),
          toggleActive: () => this.updatePromoType(t.id, { active: t.active === false }),
          up: () => this.movePromoType(t.id, -1),
          down: () => this.movePromoType(t.id, 1),
          del: () => {
            const warn = [used ? this.t('styles.delUsed', { n: used, name: t.name }) : '', fams.length ? this.t('styles.delDresses', { list: fams.map((f) => this.t(`badges.fam.${f}`)).join(', ') }) : ''].filter(Boolean);
            if (!warn.length || window.confirm(`${warn.join('\n')}\n${this.t('styles.delConfirm')}`)) this.delPromoType(t.id);
          },
        };
      }),
      // -- suites : mini montage à la main dans un film automatique --
      seqDirty: st.seqDirty, seqBusy: st.seqBusy,
      addSequence: () => this.addSequence(), saveSequences: () => this.saveSequences(),
      seqRows: this.seqList().map((s, i, arr) => {
        const used = (this.activeFilm().continuous || {}).sequences || [];
        return {
          id: s.id, name: s.name, count: (s.items || []).length,
          placement: s.placement || 'debut', ratio: s.ratio || 8,
          orient: s.orient === 'portrait' ? 'portrait' : 'paysage',
          active: s.active !== false, inFilm: used.includes(s.id),
          selected: (this.seqCurrent() || {}).id === s.id,
          isFirst: i === 0, isLast: i === arr.length - 1,
          pick: () => this.setState({ seqSel: s.id }),
          toggleInFilm: () => this.updateContinuous({ sequences: used.includes(s.id) ? used.filter((x) => x !== s.id) : [...used, s.id] }),
          up: () => this.moveSequence(s.id, -1),
          down: () => this.moveSequence(s.id, 1),
        };
      }),
      seqCur: (() => {
        const s = this.seqCurrent();
        if (!s) return null;
        const byId = new Map((st.library || []).map((mm) => [mm.id, mm]));
        return {
          id: s.id, name: s.name, placement: s.placement || 'debut', ratio: s.ratio || 8,
          orient: s.orient === 'portrait' ? 'portrait' : 'paysage',
          active: s.active !== false,
          onName: (e) => this.updateSequence(s.id, { name: e.target.value }),
          setPlacement: (p) => this.updateSequence(s.id, { placement: p }),
          onRatio: (e) => this.updateSequence(s.id, { ratio: Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)) }),
          setOrient: (o) => this.updateSequence(s.id, { orient: o }),
          toggleActive: () => this.updateSequence(s.id, { active: s.active === false }),
          del: () => { if ((s.items || []).length === 0 || window.confirm(`Supprimer la suite « ${s.name} » et ses ${s.items.length} élément(s) ?`)) this.delSequence(s.id); },
          // Les éléments de la suite, dans l'ordre de passage.
          items: (s.items || []).map((mid, i, arr) => {
            const mm = byId.get(mid);
            return {
              key: mid + '-' + i, i, n: i + 1,
              name: mm ? (mm.name || 'Élément') : 'élément supprimé',
              missing: !mm,
              icon: mm ? ((this.elementTypeOf(mm) || {}).icon || '▤') : '⚠',
              meta: mm ? this.modMeta(mm) : 'retiré de la bibliothèque',
              // Un élément d'un autre format ne passera pas : autant le dire ici.
              wrongOrient: !!mm && this.orientOf(mm) !== (s.orient === 'portrait' ? 'portrait' : 'paysage'),
              isFirst: i === 0, isLast: i === arr.length - 1,
              up: () => this.seqMoveItem(s.id, i, -1),
              down: () => this.seqMoveItem(s.id, i, 1),
              del: () => this.seqDelItem(s.id, i),
              edit: () => { if (mm) { this.setComposerTab('lib'); this.selectMod(mm.id); } },
            };
          }),
          // Éléments ajoutables : ceux au format de la suite.
          addable: (st.library || [])
            .filter((mm) => this.orientOf(mm) === (s.orient === 'portrait' ? 'portrait' : 'paysage'))
            .map((mm) => ({ id: mm.id, label: `${(this.elementTypeOf(mm) || {}).icon || '▤'} ${mm.name || 'Élément'}` })),
          onAdd: (e) => { const v = e.target.value; e.target.value = ''; this.seqAddItem(s.id, v); },
        };
      })(),
      // -- matières premières : ingrédient ↔ animation --
      ingDirty: st.ingDirty, ingBusy: st.ingBusy, ingDiag: st.ingDiag,
      addIngredient: () => this.addIngredient(), saveIngredients: () => this.saveIngredients(),
      inspectIngredients: () => this.inspectIngredients(),
      // Animations de la bibliothèque : les seules cibles d'un ingrédient.
      ingAnimOptions: (st.library || []).filter((mm) => mm.type === 'animation')
        .map((mm) => ({ id: mm.id, label: mm.name || 'Animation' })),
      ingRows: this.ingList().map((x, i, arr) => ({
        id: x.id, name: x.name, extRef: x.extRef || '', moduleId: x.moduleId || '',
        active: x.active !== false, isFirst: i === 0, isLast: i === arr.length - 1,
        // Une animation supprimée de la bibliothèque laisse un lien orphelin :
        // on le dit plutôt que de faire semblant.
        orphan: !!x.moduleId && !(st.library || []).some((mm) => mm.id === x.moduleId),
        onName: (e) => this.updateIngredient(x.id, { name: e.target.value }),
        onRef: (e) => this.updateIngredient(x.id, { extRef: e.target.value }),
        onAnim: (e) => this.updateIngredient(x.id, { moduleId: e.target.value }),
        toggleActive: () => this.updateIngredient(x.id, { active: x.active === false }),
        up: () => this.moveIngredient(x.id, -1),
        down: () => this.moveIngredient(x.id, 1),
        del: () => this.delIngredient(x.id),
      })),
      // -- catégories de la bibliothèque (classement des éléments) --
      libCatDirty: st.libCatDirty, libCatBusy: st.libCatBusy,
      addLibCat: () => this.addLibCat(), saveLibCats: () => this.saveLibCats(),
      libSourceOptions: (st.libSources || []).length ? st.libSources : [{ id: '', name: 'Aucune table (libre)' }],
      libCatRows: this.libCatList().map((c, i, arr) => {
        const used = (st.library || []).filter((mm) => this.libCatOf(mm).id === c.id).length;
        return {
          id: c.id, name: c.name, color: c.color || '#8D1D2C', src: c.src || '',
          active: c.active !== false, used, isFirst: i === 0, isLast: i === arr.length - 1,
          onName: (e) => this.updateLibCat(c.id, { name: e.target.value }),
          onColor: (e) => this.updateLibCat(c.id, { color: e.target.value }),
          onSrc: (e) => this.updateLibCat(c.id, { src: e.target.value }),
          toggleActive: () => this.updateLibCat(c.id, { active: c.active === false }),
          up: () => this.moveLibCat(c.id, -1),
          down: () => this.moveLibCat(c.id, 1),
          del: () => { if (used === 0 || window.confirm(`${used} élément(s) sont classés dans « ${c.name} ». Supprimer quand même cette catégorie ?`)) this.delLibCat(c.id); },
        };
      }),
      // -- campagnes marketing (liste d'entités) --
      campaignDirty: st.campaignDirty, campaignBusy: st.campaignBusy,
      campaignCount: (st.campaignDraft || st.campaigns || []).length,
      addCampaign: () => this.addCampaign(), saveCampaigns: () => this.saveCampaignsDraft(),
      campaignProductOptions: (st.catalog.products || []).map((p) => ({ id: p.id, label: `${p.name} · ${p.price} €${p.active === false ? ' · inactif' : ''}` })),
      campaignRows: (st.campaignDraft || st.campaigns || []).map((c, i, arr) => {
        // Nombre d'éléments « campagne » de la bibliothèque qui utilisent cette campagne.
        const used = (st.library || []).filter((m) => m.type === 'campagne' && m.campaignRef === c.id).length;
        return {
          id: c.id, name: c.name, scope: c.scope || 'produit', productRef: c.productRef || '',
          theme: c.theme || '', image: c.image || '', message: c.message || '',
          dateFrom: c.dateFrom || '', dateTo: c.dateTo || '', color: c.color || '#8D1D2C',
          active: c.active !== false, used, isFirst: i === 0, isLast: i === arr.length - 1,
          isGamme: (c.scope || 'produit') === 'gamme',
          // La campagne porte elle-même son tag de période (matin/midi/aprem).
          moCells: this.entityMomentCells('campagne', c.id),
          imageOk: imgRenderable(c.image || ''),
          onName: (e) => this.updateCampaign(c.id, { name: e.target.value }),
          onScope: (e) => this.updateCampaign(c.id, { scope: e.target.value }),
          onProductRef: (e) => this.updateCampaign(c.id, { productRef: e.target.value }),
          onTheme: (e) => this.updateCampaign(c.id, { theme: e.target.value }),
          onImage: (e) => this.updateCampaign(c.id, { image: e.target.value }),
          onMessage: (e) => this.updateCampaign(c.id, { message: e.target.value }),
          onFrom: (e) => this.updateCampaign(c.id, { dateFrom: e.target.value }),
          onTo: (e) => this.updateCampaign(c.id, { dateTo: e.target.value }),
          onColor: (e) => this.updateCampaign(c.id, { color: e.target.value }),
          toggleActive: () => this.updateCampaign(c.id, { active: c.active === false }),
          up: () => this.moveCampaign(c.id, -1),
          down: () => this.moveCampaign(c.id, 1),
          del: () => { if (used === 0 || window.confirm(`${used} élément(s) utilisent « ${c.name} ». Supprimer quand même cette campagne ?`)) this.delCampaign(c.id); },
        };
      }),
      saleMoments, prodMomentCats, prodMomentsCurrent: st.prodMomentsCurrent,
      prodMomentsDirty: st.prodMomentsDirty, prodMomentsBusy: st.prodMomentsBusy,
      saveProdMoments: () => this.saveProdMoments(),
      pmAllCollapsed, collapseAllPm: () => this.setAllPmCollapsed(true), expandAllPm: () => this.setAllPmCollapsed(false),
      mediaOverview, refreshMediaLib: () => this.loadMediaLib(),
      isMediaView: st.view === 'media', mediaView, openMediaView: () => this.goView('media'),
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
      // Ces listes ne dépendent pas du temps : on évite de les rebâtir 60 fois
      // par seconde pendant la lecture de l'aperçu.
      // Parcours de la bibliothèque : TOUS les éléments au format visé, chacun
      // avec sa case actif/inactif et son ratio de passage.
      contItemRatios: contLoopRows,
      contLoopOn: contLoopRows.filter((r) => r.on).length,
      contLoopAll: () => this.setAllLoopItems(true),
      contLoopNone: () => this.setAllLoopItems(false),
      // Contenu du film vu à un moment donné (matin / midi / après-midi) : on
      // n'affiche que ce qui serait réellement éligible à ce créneau.
      filmMomentTabs: (() => {
        const cur = st.filmMomentSel || st.prodMomentsCurrent || 'matin';
        return saleMoments.map((mo) => ({
          id: mo.id, label: mo.label, isNow: st.prodMomentsCurrent === mo.id,
          active: cur === mo.id,
          pick: () => this.setState({ filmMomentSel: mo.id }),
        }));
      })(),
      filmMomentRows: (() => {
        const mo = st.filmMomentSel || st.prodMomentsCurrent || 'matin';
        // Le film filtre sur DEUX axes : le moment ET le format d'écran.
        return this.playlistMods().filter((mm) => this.fitsOrient(mm, st.libOrient)).map((mm) => {
          const rm = this.resolveMod(mm);
          const items = (rm.items || []).filter((it) => it.active !== false);
          const kept = items.filter((it) => !it.productId || this.prodSoldAt(it.productId, mo));
          const hidden = items.length - kept.length;
          return {
            id: mm.id,
            name: mm.name || 'Élément',
            icon: (this.elementTypeOf(mm) || {}).icon || '▤',
            empty: items.length > 0 && kept.length === 0,
            detail: items.length
              ? `${kept.length}/${items.length} produit(s)${hidden ? ` · ${hidden} hors créneau` : ''}`
              : this.modMeta(mm),
            names: kept.slice(0, 6).map((it) => it.name).join(' · '),
          };
        });
      })(),
      filmCatVals, filmTagVals, filmTagInput: st.filmTagInput,
      onFilmTagInput: (e) => this.setState({ filmTagInput: e.target.value }),
      onFilmTagKey: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); this.addFilmTag(st.filmTagInput); this.setState({ filmTagInput: '' }); } },
      addFilmTagNow: () => { this.addFilmTag(st.filmTagInput); this.setState({ filmTagInput: '' }); },
      isLibTab: st.composerTab !== 'timeline',
      isTimelineTab: st.composerTab === 'timeline',
      setTabLib: () => this.setComposerTab('lib'),
      setTabTimeline: () => this.setComposerTab('timeline'),
      tabLibStyle: subTab + (st.composerTab !== 'timeline' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      tabTimelineStyle: subTab + (st.composerTab === 'timeline' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      resetPos: () => this.resetPos(),
      undo: () => this.undo(), redo: () => this.redo(),
      canUndo: st.past.length > 0, canRedo: st.future.length > 0,
      dirty: !!st.dirty, override: !!st.override,
      // Coquille : menu latéral (hors cadre), onglets (dans le cadre du module
      // Marketing), titre de la barre supérieure.
      shellGroups: SHELL_GROUPS.map((g) => ({
        label: this.t(g.label),
        items: g.items.map((it) => ({
          key: it.view || it.act, view: it.view, icon: it.icon, label: this.t(it.label),
          active: !!it.view && st.view === it.view,
          go: it.view ? () => this.goView(it.view) : (it.act === 'onboarding' ? () => this.openOnboarding() : () => this.openReport()),
        })),
      })),
      shellTabs: SHELL_VIEWS.map((it) => ({ key: it.view, view: it.view, label: this.t(it.label), active: st.view === it.view, go: () => this.goView(it.view) })),
      shellTitle: st.view === 'campaignVideo' ? this.t(st.cw && st.cw.filmId ? 'cw.titleEdit' : 'cw.title')
        : this.t((SHELL_VIEWS.find((it) => it.view === st.view) || { label: 'nav.composer' }).label),
      // Fil sous le titre, sans le répéter : compositeur → film › élément ;
      // ailleurs → l'état de l'écran (compte, « non enregistré »).
      trail: st.view === 'campaignVideo' ? [] : (st.view === 'composer' ? crumbs.slice(1) : crumbs.slice(-1).filter((c) => crumbs.length > 1)),
      undoStyle: `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-size:15px;background:transparent;border:1px solid ${st.past.length ? 'rgba(35,34,32,0.16)' : 'rgba(35,34,32,0.06)'};color:${st.past.length ? '#5B564E' : '#C9C3B8'};cursor:${st.past.length ? 'pointer' : 'not-allowed'};`,
      redoStyle: `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-size:15px;background:transparent;border:1px solid ${st.future.length ? 'rgba(35,34,32,0.16)' : 'rgba(35,34,32,0.06)'};color:${st.future.length ? '#5B564E' : '#C9C3B8'};cursor:${st.future.length ? 'pointer' : 'not-allowed'};`,
      isComposerView: st.view === 'composer', isFleetView: st.view === 'fleet', isSettingsView: st.view === 'settings',
      isProductsView: st.view === 'products', isPlanningView: st.view === 'planning',
      isSeasonsView: st.view === 'seasons', isHomeView: st.view === 'home',
      isPromotionsView: st.view === 'promotions',
      setViewPromotions: () => this.openPromotions(),
      tabPromotionsStyle: stTab + (st.view === 'promotions' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      isCampaignsView: st.view === 'campaigns',
      setViewCampaigns: () => this.openCampaigns(),
      isTranslationsView: st.view === 'translations',
      setViewTranslations: () => this.openTranslations(),
      tabTranslationsStyle: stTab + (st.view === 'translations' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      ...(st.view === 'translations' ? this.trVals() : {}),
      tabCampaignsStyle: stTab + (st.view === 'campaigns' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      setViewHome: () => this.openHome(),
      tabHomeStyle: stTab + (st.view === 'home' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      setViewComposer: () => this.setView('composer'),
      setViewFleet: () => this.setView('fleet'),
      setViewSettings: () => this.setView('settings'),
      setViewProducts: () => this.openProducts(),
      setViewPlanning: () => this.setView('planning'),
      setViewSeasons: () => this.openSeasons(),
      tabProductsStyle: stTab + (st.view === 'products' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      tabPlanningStyle: stTab + (st.view === 'planning' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      tabSeasonsStyle: stTab + (st.view === 'seasons' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      tabComposerStyle: stTab + (st.view === 'composer' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      tabFleetStyle: stTab + (st.view === 'fleet' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'),
      settingsIconStyle: `display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;font-size:17px;cursor:pointer;flex:0 0 auto;${st.view === 'settings' ? 'background:var(--accent);color:#fff;border:none;' : 'background:var(--chip);color:var(--ink);border:1px solid var(--line);'}`,
      playlistVersion: st.version,
      pushPrices: this.pushPrices,
      toggleOverride: this.toggleOverride,
      overrideLabel: st.override ? this.t('override.resume') : this.t('override.flash'),
      overrideStyle: `padding:9px 18px;font-size:13px;font-weight:500;letter-spacing:0.01em;border-radius:8px;cursor:pointer;${st.override ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:transparent;color:var(--muted-2);border:1px solid var(--line);'}`,
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
      modeFullStyle: `text-align:left;padding:14px;border-radius:12px;cursor:pointer;background:${st.pubMode === 'full' ? 'rgba(141,29,44,0.06)' : '#fff'};border:1px solid ${st.pubMode === 'full' ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
      modeDataStyle: `text-align:left;padding:14px;border-radius:12px;cursor:pointer;background:${st.pubMode === 'data' ? 'rgba(141,29,44,0.06)' : '#fff'};border:1px solid ${st.pubMode === 'data' ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};`,
      whenScheduled: st.pubWhen === 'scheduled',
      setWhenNow: () => this.setState({ pubWhen: 'now' }),
      setWhenScheduled: () => this.setState({ pubWhen: 'scheduled' }),
      whenNowStyle: `padding:7px 15px;font-size:12.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${st.pubWhen === 'now' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
      whenSchedStyle: `padding:7px 15px;font-size:12.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${st.pubWhen === 'scheduled' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
      activateAt: st.activateAt,
      onActivateAt: (e) => this.setState({ activateAt: e.target.value }),
      publishSummary: st.pubMode === 'data'
        ? `Snapshot prix d${st.dataVer + 1} → ${tgtCount} écran(s). Sync incrémentale légère : seules les données de prix changent, les médias et vidéos en cache ne sont pas re-téléchargés. Les écrans hors ligne l'appliqueront au retour du réseau. Des tests live vérifient le déploiement juste après la publication.`
        : `Film « ${pubF.name} » v${nextV} → ${pubStoresLabel} (${tgtCount} écran(s)) · diffusion ${this.schedSummary(pubF.schedule)} · activation ${whenLabel}. La programmation et les magasins se règlent sur le film (onglet 2 · Playlist). Bascule atomique + tests live au déploiement.`,
      deploy: this.deploy,
      deployLabel: st.deploying ? 'Déploiement + tests live…' : (tgtCount ? (st.pubMode === 'data' ? `Pousser les prix sur ${tgtCount} écran(s)` : `Déployer sur ${tgtCount} écran(s)`) : 'Choisir une cible'),
      deployStyle: `padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:none;cursor:${tgtCount && !st.deploying ? 'pointer' : 'not-allowed'};${tgtCount ? 'background:var(--accent);color:#fff;' : 'background:rgba(35,34,32,0.10);color:var(--muted);'}opacity:${st.deploying ? 0.7 : 1};`,
      hasToast: !!st.toast, toast: st.toast,
      playlistEmpty: st.playlist.length === 0,
      isCategory: isCat, isLiaison: isLia, isProduit, isFilmEl, isAnim, isMedia, isPromo, isCampaign, isBundle, isHtml,
      selId: m.id,
      // -- gabarit HTML : code collé, format source, variables, exemple --
      htmlCode: m.html || '',
      htmlW: m.htmlW || 1920,
      htmlH: m.htmlH || 1080,
      // Ratio lisible : forme entière quand elle est simple (16:9, 4:3…),
      // sinon forme décimale (une A1 ne se simplifie pas → 1:1,42).
      htmlRatio: (() => {
        const w = m.htmlW || 1920, hh = m.htmlH || 1080;
        const g = (a, b) => (b ? g(b, a % b) : a);
        const d = g(w, hh) || 1;
        const rw = Math.round(w / d), rh = Math.round(hh / d);
        if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
        return w >= hh
          ? `${(w / hh).toFixed(2).replace('.', ',')}:1`
          : `1:${(hh / w).toFixed(2).replace('.', ',')}`;
      })(),
      htmlSummary: (m.html || '').trim()
        ? `${Math.round((m.html || '').length / 1024 * 10) / 10} Ko · ${m.htmlW || 1920}×${m.htmlH || 1080}`
        : 'aucun code',
      onHtmlCode: (e) => this.setSelField('html', e.target.value),
      onHtmlW: (e) => this.setSelField('htmlW', Math.max(64, Math.min(20000, parseInt(e.target.value, 10) || 1920))),
      onHtmlH: (e) => this.setSelField('htmlH', Math.max(64, Math.min(20000, parseInt(e.target.value, 10) || 1080))),
      htmlPresets: HTML_PRESETS.map((p) => ({
        ...p,
        active: (m.htmlW || 1920) === p.w && (m.htmlH || 1080) === p.h,
        pick: () => this.setHtmlPreset(p),
      })),
      htmlTokens: HTML_TOKENS.map((t) => ({ ...t, insert: () => this.insertHtmlToken(t.token) })),
      // Variables détectées DANS le code collé, remontées pour être liées aux
      // données (produit, promotion, campagne, magasin) ou à une valeur libre.
      htmlVarRows: htmlVarNames(m.html || '').map((name) => {
        const bind = ((m.htmlVars || {})[name]) || {};
        const src = bind.src || '';
        const srcDef = HTML_VAR_SOURCES.find((x) => x.id === src) || null;
        const opts = src === 'produit' ? (st.catalog.products || []).map((p) => ({ id: p.id, label: p.name }))
          : src === 'promotion' ? (st.promoTypes || []).map((t) => ({ id: t.id, label: `${t.icon || ''} ${t.name}` }))
          : src === 'campagne' ? (st.campaigns || []).map((c) => ({ id: c.id, label: c.name }))
          : src === 'categorie' ? (st.catalog.categories || []).map((c) => ({ id: c.id, label: c.name }))
          : src === 'image' ? HTML_ASSETS.map((a) => ({ id: a.id, label: a.label }))
          : [];
        // Constante de marque (ex. {{ logo }}) : résolue d'office, aucune
        // liaison à faire — sauf si la régie en choisit une explicitement.
        const brand = Object.prototype.hasOwnProperty.call(HTML_BRAND_VARS, name.toLowerCase())
          ? HTML_BRAND_VARS[name.toLowerCase()] : '';
        return {
          name, src, field: bind.field || '', value: bind.value || '',
          bound: !!src, brand, isBrandAuto: !src && !!brand,
          x: bind.x || 0, y: bind.y || 0,
          moved: !!(bind.x || bind.y),
          selected: st.htmlVarSel === name,
          select: () => this.setState({ htmlVarSel: st.htmlVarSel === name ? '' : name }),
          nudge: (dx, dy) => this.moveHtmlVar(name, dx, dy),
          onX: (e) => this.setHtmlVarPos(name, parseInt(e.target.value, 10) || 0, bind.y || 0),
          onY: (e) => this.setHtmlVarPos(name, bind.x || 0, parseInt(e.target.value, 10) || 0),
          resetPos: () => this.setHtmlVarPos(name, 0, 0),
          sources: HTML_VAR_SOURCES.map((x) => ({ id: x.id, label: x.label })),
          fields: srcDef ? srcDef.fields : [],
          needsPick: ['produit', 'categorie', 'promotion', 'campagne', 'image'].includes(src),
          pickOptions: opts,
          isLiteral: src === 'literal',
          // Choisir une source pré-remplit son premier champ : le menu affiche
          // « Nom », la donnée dit « nom » — pas d'écart entre les deux.
          onSrc: (e) => {
            const sd = HTML_VAR_SOURCES.find((x) => x.id === e.target.value);
            this.setHtmlVar(name, { src: e.target.value, field: (sd && sd.fields[0]) ? sd.fields[0].id : '', value: '' });
          },
          onField: (e) => this.setHtmlVar(name, { field: e.target.value }),
          onValue: (e) => this.setHtmlVar(name, { value: e.target.value }),
          clear: () => this.setHtmlVar(name, null),
        };
      }),
      htmlVarsSummary: (() => {
        const names = htmlVarNames(m.html || '');
        if (!names.length) return 'aucune variable';
        const ok = names.filter((n) => ((m.htmlVars || {})[n] || {}).src
          || Object.prototype.hasOwnProperty.call(HTML_BRAND_VARS, n.toLowerCase())).length;
        return `${ok}/${names.length} résolue(s)`;
      })(),
      mediaAgencyUrl: new URL('agence', location.href).toString(),
      // -- bundle TFBuddy : on choisit un bundle dans la liste synchronisée --
      ...this.bundleVals(m, isBundle),
      // -- promotions TFBuddy (éditeur « promotion » + page Campagnes) --
      ...this.tfbPromoVals(m, isPromo),
      // -- campagne marketing : on choisit une campagne dans la liste --
      campaignInfo: isCampaign ? this.campaignInfo(m) : null,
      campaignOptions: (st.campaigns || []).filter((c) => c.active !== false || c.id === m.campaignRef).map((c) => ({
        id: c.id, label: `${c.scope === 'gamme' ? '🗂' : '📣'} ${c.name}${c.scope === 'gamme' && c.theme ? ` — ${c.theme}` : ''}`,
        active: (m.campaignRef || '') === c.id,
        pick: () => this.setSelField('campaignRef', c.id),
      })),
      curCampaignRef: m.campaignRef || '',
      hasCampaigns: (st.campaigns || []).some((c) => c.active !== false),
      goCampaigns: () => this.openCampaigns(),
      campaignSummary: isCampaign ? ((this.campaignInfo(m).name) || 'à choisir') : '',
      // -- promotion : sous-type dynamique + produit lié (mises en page hero) --
      promoName: isPromo ? this.promoBadge(m).name : '',
      promoIcon: isPromo ? this.promoBadge(m).icon : '🏷️',
      promoColor: isPromo ? this.promoBadge(m).color : '#C0392B',
      promoTypeOptions: (st.promoTypes || []).filter((t) => t.active !== false || t.id === m.promoType).map((t) => ({
        id: t.id, label: `${t.icon || '🏷️'} ${t.name}`,
        active: (m.promoType || '') === t.id,
        pick: () => this.setSelField('promoType', t.id),
      })),
      curPromoType: m.promoType || '',
      // Reliée à TFBuddy et famille habillée : le badge suit la famille.
      promoFamily: (() => {
        if (!isPromo || !m.tfbRef) return null;
        const p = (st.tfbPromos || []).find((x) => x.id === m.tfbRef);
        const f = p ? this.tfbFamilyOf(p) : '';
        const b = f ? this.familyBadge(f) : null;
        return b ? { label: this.t(`badges.fam.${f}`), badge: b } : null;
      })(),
      hasPromoTypes: (st.promoTypes || []).some((t) => t.active !== false),
      promoUsesProduct: isPromo && (m.layout === 'hero-right' || m.layout === 'hero-left'),
      goPromoTypes: () => this.openPromotions(),
      promoSummary: isPromo ? (this.promoBadge(m).name + (m.name ? ` · ${m.name}` : '')) : '',
      // filtre filigrane / logo (surtout sur les photos)
      hasWatermark: isCat || isProduit || isMedia || isAnim,
      watermark: m.watermark || 'none',
      watermarkSummary: ({ none: 'aucun', filigrane: 'filigrane', logo: 'logo', nouveau: '« Nouveau »' })[m.watermark || 'none'],
      watermarkOpts: [
        { id: 'none', label: 'Aucun' }, { id: 'filigrane', label: 'Filigrane logo' },
        { id: 'logo', label: 'Logo (coin)' }, { id: 'nouveau', label: 'Ruban « Nouveau »' },
      ].map((o) => ({ ...o, active: (m.watermark || 'none') === o.id, pick: () => this.setSelField('watermark', o.id) })),
      hasSub: isLia || isAnim || isProduit || isPromo,
      hasDur: isProduit || isFilmEl || isAnim || isMedia || isPromo || isCampaign || isHtml,
      selName: m.name,
      selTypeLabel: selType ? selType.label : (isLia ? 'Liaison' : 'Catégorie'),
      selTypeBadge: `display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;font-size:11.5px;font-weight:500;white-space:nowrap;${isLia ? 'background:rgba(35,34,32,0.10);color:var(--muted);' : 'background:rgba(141,29,44,0.12);color:var(--accent);'}`,
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
      // Cadrage de la vidéo : remplir / adapter, puis position et zoom — pour
      // choisir ce qu'on garde quand la vidéo n'a pas le format de l'écran.
      vidFit: m.layout === 'contain' ? 'contain' : 'cover',
      setVidFit: (fit) => this.setSelField('layout', fit),
      vidX: pos.vidX || 0, vidY: pos.vidY || 0,
      vidZoom: pos.vidZoom == null ? 1 : pos.vidZoom,
      // Un pas franc : 120 px sur un écran virtuel de 6480 × 3840.
      nudgeVid: (dx, dy) => this.setPosMany({
        vidX: clx((pos.vidX || 0) + dx * 120, -3000, 3000),
        vidY: clx((pos.vidY || 0) + dy * 120, -2000, 2000),
      }),
      zoomVid: (d) => this.setPos('vidZoom', Math.round(clx((pos.vidZoom == null ? 1 : pos.vidZoom) + d * 0.1, 0.5, 4) * 100) / 100),
      onVidZoom: (e) => this.setPos('vidZoom', parseFloat(e.target.value)),
      resetVid: () => this.setPosMany({ vidX: 0, vidY: 0, vidZoom: 1 }),
      // Couleur de fond : ce qu'on voit autour de la vidéo quand elle ne
      // remplit pas l'écran. Liste de la palette de marque + teinte libre.
      bgColor: m.bgColor || '',
      bgSwatch: m.bgColor || '#000000',
      bgName: m.bgColor ? (brandColorName(m.bgColor) || 'teinte libre') : 'Noir (défaut)',
      bgOptions: [{ id: '', name: 'Noir (défaut)', hex: '#000000' }, ...BRAND_COLORS.filter((c) => c.id !== 'noir')],
      bgIsCustom: !!m.bgColor && !brandColorName(m.bgColor),
      onBgPick: (e) => this.setSelField('bgColor', e.target.value),
      onBgCustom: (e) => this.setSelField('bgColor', e.target.value),
      vidMoved: !!(pos.vidX || pos.vidY || (pos.vidZoom != null && pos.vidZoom !== 1)),
      // -- film en mode « surprise » (dossier serveur, piochée au hasard) --
      isSurprise: !!m.surprise,
      toggleSurprise: () => this.toggleSurprise(),
      surpriseList: st.surpriseVideos || [],
      surpriseBusy: st.surpriseBusy,
      onSurpriseFiles: (e) => { this.uploadSurprise(e.target.files); e.target.value = ''; },
      refreshSurprise: () => this.loadSurprise(),
      delSurprise: (name) => this.deleteSurprise(name),
      // -- animation : texte animé (avec fond) ou fichier autonome --
      animMode: m.animMode === 'fichier' ? 'fichier' : 'texte',
      setAnimMode: (mode) => this.setSelField('animMode', mode),
      animBg: m.animBg || '', animFile: m.animFile || '',
      animBgKind: animAssetKind(m.animBg || ''), animFileKind: animAssetKind(m.animFile || ''),
      animDim: m.animDim == null ? 45 : m.animDim,
      animFit: m.animFit === 'contain' ? 'contain' : 'cover',
      animBusy: st.animBusy,
      onAnimBgUrl: (e) => this.setSelField('animBg', e.target.value),
      onAnimFileUrl: (e) => this.setSelField('animFile', e.target.value),
      onAnimBgPick: (e) => { this.uploadAnimAsset('animBg', e.target.files[0]); e.target.value = ''; },
      onAnimFilePick: (e) => { this.uploadAnimAsset('animFile', e.target.files[0]); e.target.value = ''; },
      clearAnimBg: () => this.setSelField('animBg', ''),
      clearAnimFile: () => this.setSelField('animFile', ''),
      onAnimDim: (e) => this.setSelField('animDim', Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0))),
      setAnimFit: (fit) => this.setSelField('animFit', fit),
      animSummary: m.animMode === 'fichier'
        ? (m.animFile ? `fichier · ${({ video: 'vidéo', lottie: 'Lottie', image: 'image' })[animAssetKind(m.animFile)] || ''}` : 'fichier — aucun')
        : (m.animBg ? 'texte animé · avec fond' : 'texte animé'),
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
        style: `text-align:left;padding:10px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;background:${(m.motion || 'm1') === o.id ? 'rgba(141,29,44,0.08)' : '#fff'};border:1px solid ${(m.motion || 'm1') === o.id ? '#8D1D2C' : 'rgba(35,34,32,0.12)'};color:var(--ink);`,
      })),
      libTagPicker: this.libCatList().filter((t) => t.active !== false || this.libCatOf(m).id === t.id).map((t) => {
        const on = this.libCatOf(m).id === t.id;
        return {
          label: t.name,
          pick: () => this.setSelField('libTag', t.id),
          style: `display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${on ? `background:${t.color};color:#fff;border:1px solid ${t.color};` : `background:#fff;color:${t.color};border:1px solid ${t.color}55;`}`,
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
      pasteStyle: `flex:1 1 auto;padding:10px;font-size:12.5px;font-weight:500;border-radius:10px;cursor:${st.clipboard ? 'pointer' : 'not-allowed'};${st.clipboard ? 'color:var(--ink);background:var(--chip);border:1px solid var(--line);' : 'color:var(--faint);background:rgba(35,34,32,0.04);border:1px solid var(--line);'}`,
      tagEnabled: !!(m.tag && m.tag.enabled),
      tagLabel: m.tag ? m.tag.label : '',
      tagImg: m.tag ? m.tag.img : '',
      toggleTag: () => this.setTag('enabled', !(m.tag && m.tag.enabled)),
      onTagLabel: (e) => this.setTag('label', e.target.value),
      onTagImg: (e) => this.setTag('img', e.target.value),
      tagTrackStyle: `position:relative;width:50px;height:28px;border-radius:8px;border:none;cursor:pointer;flex:0 0 auto;background:${m.tag && m.tag.enabled ? '#8D1D2C' : 'rgba(35,34,32,0.18)'};`,
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
      scopeModuleStyle: `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${st.scope === 'module' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
      scopePlaylistStyle: `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${st.scope === 'playlist' ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}`,
      secPerLine: st.secPerLine,
      secLabel: `${st.secPerLine.toFixed(st.secPerLine % 1 ? 1 : 0)} s`,
      onSec: (e) => this.dirty({ secPerLine: parseFloat(e.target.value) }),
      toggleLoop: () => this.dirty({ loop: !st.loop }),
      loopTrackStyle: `position:relative;width:50px;height:28px;border-radius:8px;border:none;cursor:pointer;flex:0 0 auto;background:${st.loop ? '#8D1D2C' : 'rgba(35,34,32,0.18)'};`,
      loopKnobStyle: `position:absolute;top:3px;left:${st.loop ? '25px' : '3px'};width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,0.25);`,
      moduleCount: st.playlist.length,
      playlistTotal: fmtTime(this.playlistMods().reduce((s, mm) => s + this.moduleDur(mm), 0)),
      srvUrl: st.srvUrl, srvIp: st.srvIp, srvToken: st.srvToken,
      store: (() => {
        const s = st.mediaStore || {};
        const s3 = s.s3 || {};
        const c = s.counts || {};
        const j = s.job || null;
        const fmtGo = (b) => `${(Math.round((b || 0) / 1e8) / 10).toLocaleString('fr-BE')} Go`;
        return {
          known: !!st.mediaStore,
          ovh: s.mode === 's3',
          where: s.mode === 's3' ? this.t('store.ovhWhere', { bucket: s3.bucket || '?', host: s3.host || '?', region: s3.region || '?' }) : this.t('store.localWhere'),
          check: s.check ? (s.check.ok ? this.t('store.checkOkAt', { n: s.check.objects || 0 }) : `${this.t('store.checkKo')} : ${s.check.error}`) : '',
          checkOk: !!(s.check && s.check.ok),
          counts: this.t('store.counts', { s3: c.s3 || 0, local: c.local || 0 }),
          canMigrate: s.mode === 's3' && (c.localOnDisk || 0) > 0 && !(j && j.running),
          migrateLabel: this.t('store.migrate', { n: c.localOnDisk || 0 }),
          job: j ? (j.running ? this.t('store.jobRunning', { d: j.done, n: j.total }) : this.t('store.jobDone', { m: j.moved, n: j.total, g: fmtGo(j.bytes) })) : '',
          jobErrors: j ? j.errors.slice(0, 5) : [],
          busy: !!st.mediaStoreBusy,
          maxMb: s.maxMb || st.mediaMaxMb || 4096,
          check_: () => this.checkMediaStore(),
          migrate: () => this.migrateMediaStore(),
        };
      })(),
      agencyUrl: new URL('agence', location.href).toString(),
      onSrvUrl: (e) => { this.setState({ srvUrl: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      onSrvIp: (e) => { this.setState({ srvIp: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      onSrvToken: (e) => { this.setState({ srvToken: e.target.value, test: { state: 'idle', rows: [] } }); this.saveSrv(); },
      srvPing: st.test.state === 'ok' ? '● Connecté' : st.test.state === 'fail' ? '● Échec' : st.test.state === 'testing' ? '○ Test…' : '○ Non testé',
      srvPingStyle: `font-size:12px;font-weight:500;color:${st.test.state === 'ok' ? '#2E7D32' : st.test.state === 'fail' ? '#8D1D2C' : '#8A847C'};`,
      testConn: this.testConn,
      testBtnLabel: st.test.state === 'testing' ? 'Test en cours…' : 'Tester la connexion (live)',
      testBtnStyle: `width:100%;padding:11px;font-size:13.5px;font-weight:500;border-radius:10px;cursor:${st.test.state === 'testing' ? 'progress' : 'pointer'};border:none;background:var(--accent);color:#fff;opacity:${st.test.state === 'testing' ? 0.7 : 1};`,
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
      saveStyle: `padding:9px 20px;font-size:13px;font-weight:500;letter-spacing:0.01em;border-radius:8px;cursor:${st.dirty ? 'pointer' : 'default'};${st.dirty ? 'background:var(--muted-2);color:#fff;border:1px solid var(--muted-2);' : 'background:transparent;color:var(--muted);border:1px solid var(--line);'}`,
      // Bandeau : icônes rondes + vignettes, palette gris/rubis/abricot/cuivre.
      saveIconStyle: `${hdrRound}${st.dirty ? 'background:var(--muted-2);color:#fff;border:1px solid var(--muted-2);' : 'background:transparent;color:var(--green);border:1px solid rgba(63,122,82,0.35);'}`,
      saveTip: st.dirty ? 'Enregistrement automatique en cours… (clique pour forcer)' : 'Tout est enregistré automatiquement',
      pricesIconStyle: `${hdrRound}background:rgba(201,123,74,0.14);color:var(--warn);border:1px solid rgba(201,123,74,0.5);`,
      overrideIconStyle: `${hdrRound}${st.override ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:transparent;color:var(--muted-2);border:1px solid var(--line);'}`,
      overrideTip: st.override ? this.t('override.tipOn') : this.t('override.tipOff'),
      publishIconStyle: `width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;flex:0 0 auto;background:var(--accent);color:#fff;border:1px solid var(--accent);`,
      onbIconStyle: `${hdrRound}background:rgba(63,122,82,0.12);color:var(--green);border:1px solid rgba(63,122,82,0.4);`,
      reportIconStyle: `${hdrRound}background:var(--chip);color:var(--muted-2);border:1px solid var(--line);`,
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
      return html`<div style="height:100vh;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:15px;">${this.t('app.loading')}</div>`;
    }
    if (st.authRequired) {
      return html`<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:var(--paper);padding:24px;">
        <form onSubmit=${this.doLogin} style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:36px 38px;width:360px;max-width:100%;display:flex;flex-direction:column;gap:13px;">
          ${EMBEDDED ? '' : html`
            <img src="assets/logo.png" alt="L'Atelier By" style="height:44px;width:auto;align-self:center;margin-bottom:4px;" />
            <div style="text-align:center;font-weight:500;font-size:16px;">${this.t('login.title')}</div>`}
          <div style=${EMBEDDED ? 'text-align:center;font-weight:500;font-size:16px;margin-bottom:6px;' : 'text-align:center;font-size:12px;color:var(--muted);margin-bottom:6px;'}>${this.t('login.subtitle')}</div>
          <div style="display:flex;justify-content:center;margin-bottom:4px;">
            <div class="role-switch">
              ${UI_LANGS.map((l) => html`<button type="button" title=${l.label} onClick=${() => this.setUiLang(l.id)} class=${l.id === st.uiLang ? 'is-on' : ''}>${l.short}</button>`)}
            </div>
          </div>
          <label style="font-size:12.5px;font-weight:500;color:var(--muted);">${this.t('login.user')}</label>
          <input value=${st.loginUser} onInput=${(e) => this.setState({ loginUser: e.target.value })} autocomplete="username" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          <label style="font-size:12.5px;font-weight:500;color:var(--muted);">${this.t('login.password')}</label>
          <input type="password" value=${st.loginPass} onInput=${(e) => this.setState({ loginPass: e.target.value })} autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          ${st.loginError && html`<div style="font-size:12.5px;color:var(--accent);">${st.loginError}</div>`}
          <button type="submit" style="margin-top:6px;padding:12px;font-size:14px;font-weight:500;border-radius:8px;border:none;cursor:pointer;background:var(--accent);color:#fff;opacity:${st.loggingIn ? 0.7 : 1};">${st.loggingIn ? this.t('login.signingIn') : this.t('login.signIn')}</button>
          <a class="btn" href="film" target="_blank" style="margin-top:10px;">${this.t('login.viewFilm')}</a>
        </form>
      </div>`;
    }
    if (st.loadError) {
      return html`<div style="height:100vh;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--accent);font-size:15px;">
        <div>${this.t('app.cmsUnreachable', { err: st.loadError })}</div>
        <button onClick=${() => { this.setState({ loading: true, loadError: '' }); this.loadState(); }} style="padding:10px 22px;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;">${this.t('app.retry')}</button>
      </div>`;
    }
    const v = this.vals();

    // Volets repliables de l'éditeur : en-tête cliquable, résumé quand fermé,
    // un seul volet ouvert à la fois, centré à l'écran à l'ouverture.
    const secOpen = (id) => (Array.isArray(st.openSec) ? st.openSec.includes(id) : st.openSec === id);
    const secCard = 'background:#FFFFFF;border:1px solid var(--line);border-radius:12px;overflow:hidden;';
    const secBody = 'padding:2px 24px 22px;';
    const secHead = (id, title, summary) => html`
      <button onClick=${(e) => this.toggleSec(id, e.currentTarget.parentElement)} style="width:100%;box-sizing:border-box;display:flex;align-items:center;gap:11px;padding:17px 24px;background:transparent;border:none;cursor:pointer;text-align:left;">
        <span style="flex:0 0 auto;display:inline-block;font-size:9px;color:var(--muted);transform:rotate(${secOpen(id) ? '90deg' : '0deg'});transition:transform .15s;">▶</span>
        <span style="flex:0 0 auto;white-space:nowrap;font-size:13px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${title}</span>
        ${!secOpen(id) && summary ? html`<span style="flex:1 1 auto;min-width:0;text-align:right;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${summary}</span>` : null}
      </button>`;

    // Aperçu + transport — l'onglet 1 montre l'élément en construction,
    // l'onglet 2 montre le film complet.
    const previewBlock = html`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${v.isTimelineTab ? `Aperçu du film « ${this.activeFilm().name} » · 6480 × 3840` : `Aperçu de l'élément · 6480 × 3840`}</h2>
        ${v.isTimelineTab && this.activeFilm().mode === 'continu' ? html`
          <span style="display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:11px;font-weight:500;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:3px 10px;">boucle générée${v.contPreviewMeta ? ` · ${v.contPreviewMeta.slots} slot(s)` : ''}</span>
            ${infoTip('Aperçu FIDÈLE : c’est la boucle réellement composée par le serveur (produits de saison, moment, ratios…), telle qu’elle passera à l’écran. Elle reflète les réglages ENREGISTRÉS — après une modif, elle se rafraîchit à l’enregistrement (auto ~1 s) ou via ⟳.')}
            <button onClick=${() => this.loadContPreview()} disabled=${v.contPreviewBusy} title="Recomposer l’aperçu maintenant" style="padding:5px 11px;font-size:11.5px;font-weight:500;color:var(--muted-2);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:${v.contPreviewBusy ? 'wait' : 'pointer'};">⟳ Actualiser</button>
          </span>
        ` : ''}
      </div>
      ${v.isTimelineTab && this.activeFilm().mode === 'continu' && v.contPreviewMeta && v.contPreviewMeta.products === 0 ? html`
        <div style="margin:-4px 0 12px;padding:11px 14px;border-radius:10px;background:rgba(201,123,74,0.1);border:1px solid rgba(201,123,74,0.35);font-size:12.5px;color:var(--warn);line-height:1.5;">
          ⚠ <strong>Aucun produit éligible</strong> au moment courant${v.contPreviewMeta.moment ? ` (${{ matin: 'matin', midi: 'midi', aprem: 'après-midi' }[v.contPreviewMeta.moment] || v.contPreviewMeta.moment})` : ''} — la boucle serait quasi vide à l'écran. Vérifie la <strong>source</strong> et les <strong>périodes de vente / saisons</strong> (onglet Périodes), ou mets « Si rien en saison » sur <strong>Tout le catalogue</strong>.
        </div>
      ` : ''}
      ${v.dragHint && html`
        <p style="margin:-4px 0 12px;font-size:11.5px;color:var(--muted);">✥ Glisse l'illustration ou le bandeau sur l'aperçu pour les positionner.</p>
      `}
      <div style="background:var(--ink);border-radius:12px;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:0.06em;">${v.nowPlaying}</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.55);">Ligne <strong style="color:#fff;">${v.liveLine}</strong></span>
        </div>
        <div style="background:#0a0a0a;border-radius:10px;overflow:hidden;">${v.preview}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:18px;">
          <button onClick=${v.togglePlay} style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:16px;flex:0 0 auto;">${v.playIcon}</button>
          <button onClick=${v.restart} title="Recommencer" style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.10);color:#fff;border:none;cursor:pointer;font-size:14px;flex:0 0 auto;">↺</button>
          <div onClick=${v.scrub} ref=${v.trackRef} style="flex:1 1 auto;height:8px;border-radius:4px;background:rgba(255,255,255,0.14);position:relative;cursor:pointer;">
            <div style="position:absolute;left:0;top:0;height:100%;border-radius:4px;background:var(--accent);width:${v.progressPct};"></div>
            <div style="position:absolute;top:50%;transform:translate(-50%,-50%);left:${v.progressPct};width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
          </div>
          <span style="font-variant-numeric:tabular-nums;font-size:12.5px;color:rgba(255,255,255,0.7);flex:0 0 auto;min-width:84px;text-align:right;">${v.timeLabel}</span>
        </div>
      </div>`;

    // Réglages de diffusion du film — uniquement dans l'onglet Playlist.
    const diffusionBlock = html`
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:20px 22px;">
        <h2 style="margin:0 0 16px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Diffusion</h2>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label style="font-size:13px;font-weight:500;color:var(--muted);">Durée par ligne</label>
          <span style="font-size:14px;font-weight:500;">${v.secLabel}</span>
        </div>
        <input type="range" min="1" max="8" step="0.5" value=${v.secPerLine} onInput=${v.onSec} style="width:100%;accent-color:var(--accent);margin-bottom:18px;" />
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:14px;font-weight:500;">Boucle continue</span>
          <button onClick=${v.toggleLoop} style=${v.loopTrackStyle}><span style=${v.loopKnobStyle}></span></button>
        </div>
        <div style="display:flex;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);">
          <span>Film <strong style="color:var(--ink);">${v.moduleCount} modules</strong></span>
          <span style="color:rgba(35,34,32,0.18);">·</span>
          <span>Durée totale <strong style="color:var(--ink);">${v.playlistTotal}</strong></span>
        </div>
      </div>`;

    // Bibliothèque de films — badge coloré par catégorie, avec ses tags.
    const filmBadge = (p, active, pick) => {
      const c = filmCatOf(p);
      const tags = (p.tags || []).slice(0, 3);
      return html`
        <button onClick=${pick} title=${`${p.name} · ${c.label} · ${p.items.length} module(s)${(p.tags || []).length ? ' · #' + p.tags.join(' #') : ''}`}
          style="display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;white-space:nowrap;${active ? `background:${c.color};color:#fff;border:1px solid ${c.color};box-shadow:0 2px 8px ${c.color}44;` : `background:#fff;color:var(--ink);border:1px solid ${c.color}55;border-left:4px solid ${c.color};`}">
          <span>${p.name}</span>
          <span style="opacity:0.7;font-weight:500;">${p.items.length}</span>
          ${tags.map((t) => html`<span style="font-size:9.5px;font-weight:500;padding:1px 6px;border-radius:999px;background:${active ? 'rgba(255,255,255,0.22)' : c.color + '18'};color:${active ? '#fff' : c.color};">#${t}</span>`)}
        </button>`;
    };
    const filmCounts = {};
    st.playlists.forEach((p) => { const c = filmCatOf(p).id; filmCounts[c] = (filmCounts[c] || 0) + 1; });
    const filmCatChips = [
      { id: 'all', label: 'Tous', color: '#8D1D2C', count: st.playlists.length },
      ...FILM_CATS.filter((c) => filmCounts[c.id]).map((c) => ({ ...c, count: filmCounts[c.id] })),
    ].map((c) => {
      const on = st.filmFilter === c.id;
      return html`
        <button onClick=${() => this.setState({ filmFilter: c.id })}
          style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;${on ? `background:${c.color};color:#fff;border:1px solid ${c.color};` : `background:#fff;color:${c.color};border:1px solid ${c.color}55;`}">
          <span style="width:7px;height:7px;border-radius:50%;background:${on ? '#fff' : c.color};"></span>${c.label}<span style="font-weight:400;opacity:0.75;">${c.count}</span>
        </button>`;
    });
    const shownFilms = st.playlists.filter((p) => st.filmFilter === 'all' || filmCatOf(p).id === st.filmFilter);
    const filmSelector = html`
      <div style="display:flex;flex-direction:column;gap:9px;width:100%;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-right:2px;">Catégories</span>
          ${filmCatChips}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${st.editingFilm
            ? html`<input value=${st.editFilmName}
                ref=${(el) => { if (el && document.activeElement !== el && !el._focused) { el._focused = true; el.focus(); el.select(); } }}
                onInput=${(e) => this.setState({ editFilmName: e.target.value })}
                onKeyDown=${(e) => { if (e.key === 'Enter') this.renameFilm(st.editFilmName); if (e.key === 'Escape') this.setState({ editingFilm: false }); }}
                onBlur=${() => this.renameFilm(st.editFilmName)}
                style="flex:0 1 auto;min-width:180px;padding:7px 9px;font-size:13px;font-weight:500;border:1px solid var(--accent);border-radius:8px;background:#fff;" />`
            : shownFilms.map((p) => filmBadge(p, p.id === st.activePl, () => this.selectFilm(p.id)))}
          ${!st.editingFilm && !shownFilms.length ? html`<span style="font-size:12px;color:var(--muted);">Aucun film dans cette catégorie.</span>` : ''}
          <button onClick=${() => this.setState({ editingFilm: true, editFilmName: this.activeFilm().name })} title="Renommer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.7);border:1px solid var(--line);cursor:pointer;font-size:12px;flex:0 0 auto;">✎</button>
          <button onClick=${() => this.newFilm()} title="Nouveau film (vide)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:14px;font-weight:500;flex:0 0 auto;">＋</button>
          <button onClick=${() => this.newExampleFilm()} title="Créer un film d'exemple : une boucle continue préréglée, à dupliquer et adapter" style="display:flex;align-items:center;gap:5px;padding:0 11px;height:26px;border-radius:8px;background:var(--chip);color:var(--muted-2);border:1px solid var(--line);cursor:pointer;font-size:12px;font-weight:500;flex:0 0 auto;">Exemple continu</button>
          <button onClick=${() => this.dupFilm()} title="Dupliquer le film" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.7);border:1px solid var(--line);cursor:pointer;font-size:12px;flex:0 0 auto;">⎘</button>
          <button onClick=${() => this.delFilm()} title="Supprimer le film (les modules restent en bibliothèque)" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.7);border:1px solid var(--line);cursor:pointer;font-size:12px;color:var(--accent);flex:0 0 auto;">${icon(ICON.trash, 14)}</button>
        </div>
      </div>`;

    // ---- Mode du film : Playlist (manuel) ou Continu (boucle auto) ----------
    const filmMode = this.activeFilm().mode === 'continu' ? 'continu' : 'playlist';
    const cont = normContinuous(this.activeFilm().continuous);
    // Le film est toujours en mode continu : on ne monte plus de séquence à la
    // main, on pose des règles et la boucle se compose en direct.
    const filmModeToggle = html`
      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);">
        <div style="display:flex;align-items:center;gap:6px;">
          ${infoTip('Le film ne monte rien à la main : tu poses des règles (sources, moments, formats, ratios…) et la boucle se compose toute seule, en s’adaptant au fil de la journée, sans republier.')}
          <span style="font-size:12px;font-weight:500;color:var(--muted-2);">Boucle continue</span>
          <span style="font-size:11.5px;color:var(--muted);">composée en direct · saisons · moments · formats</span>
        </div>
      </div>`;
    // Panneau de réglages du mode continu.
    const cField = (label, node, tip) => html`<label style="display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);"><span style="display:inline-flex;align-items:center;gap:5px;">${label}${tip ? infoTip(tip) : ''}</span>${node}</label>`;
    const cNum = (key, val, min, max) => html`<input type="number" min=${min} max=${max} value=${val} onInput=${(e) => this.updateContinuous({ [key]: e.target.value })} style="width:92px;padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;" />`;
    const cChoice = (key, opts) => html`<div style="display:flex;gap:6px;flex-wrap:wrap;">${opts.map(([id, lab]) => html`<button onClick=${() => this.updateContinuous({ [key]: id })} style="padding:7px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${cont[key] === id ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${cont[key] === id ? '#8D1D2C' : '#fff'};color:${cont[key] === id ? '#fff' : '#232220'};">${lab}</button>`)}</div>`;
    // Source oui/non : quand elle est active, son ratio « 1 : N » s'affiche.
    const cUse = (key, label, help, ratioKey) => {
      const on = !!(cont.use || {})[key];
      return html`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button onClick=${() => this.updateContinuous({ use: { ...(cont.use || {}), [key]: !on } })} title=${help} style="min-width:150px;text-align:left;padding:7px 12px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#232220'};">${on ? '✓ ' : ''}${label}</button>
        ${on && ratioKey ? html`<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">1 :
          <input type="number" min="0" max="99" value=${(cont.ratios || {})[ratioKey] || 0} onInput=${(e) => this.updateContinuous({ ratios: { ...(cont.ratios || {}), [ratioKey]: e.target.value } })} style="width:64px;padding:6px 8px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
        </span>` : ''}
      </div>`;
    };
    const cToggle = (key, yes, no) => html`<div style="display:flex;gap:6px;">${[[true, yes], [false, no]].map(([b, lab]) => html`<button onClick=${() => this.updateContinuous({ [key]: b })} style="padding:7px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${!!cont[key] === b ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${!!cont[key] === b ? '#8D1D2C' : '#fff'};color:${!!cont[key] === b ? '#fff' : '#232220'};">${lab}</button>`)}</div>`;
    const cRatio = (key, label) => html`<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;"><span style="width:150px;color:var(--ink);font-weight:500;">${label}</span><span style="color:var(--muted);">1 :</span><input type="number" min="0" max="99" value=${cont.ratios[key]} onInput=${(e) => this.updateContRatio(key, e.target.value)} style="width:66px;padding:7px 9px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;" /></label>`;
    const catChips = (st.catalog.categories || []).map((c) => {
      const on = cont.categories.includes(c.id);
      return html`<button onClick=${() => { const set = new Set(cont.categories); on ? set.delete(c.id) : set.add(c.id); this.updateContinuous({ categories: [...set] }); }} style="padding:6px 12px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#232220'};">${c.name}</button>`;
    });
    // Playlists d'exception : tags multi-sélection (films « playlist » uniquement).
    const excFilms = st.playlists.filter((p) => p.mode !== 'continu' && p.id !== this.activeFilm().id);
    const excChips = excFilms.map((p) => {
      const on = cont.exceptionFilms.includes(p.id);
      return html`<button onClick=${() => { const set = new Set(cont.exceptionFilms); on ? set.delete(p.id) : set.add(p.id); this.updateContinuous({ exceptionFilms: [...set] }); }} style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#232220'};">${on ? '✓ ' : '+ '}${p.name}</button>`;
    });
    const contPanel = html`
      <div style="background:#FFFFFF;border:1px solid rgba(141,29,44,0.22);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Boucle continue — la régie compose « ${this.activeFilm().name} » en direct</h3>
          <a href=${new URL('film?film=' + this.activeFilm().id, location.href).toString()} target="_blank" style="font-size:12.5px;font-weight:500;color:var(--muted-2);">▶ Aperçu en direct ↗</a>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px;">
          <div style="display:flex;gap:26px;flex-wrap:wrap;">
            ${cField('Orientation de l\'écran', html`<div style="display:flex;gap:7px;">
              ${[['paysage', '▭ 16:9 paysage'], ['portrait', '▯ 9:16 portrait']].map(([id, lab]) => html`
                <button onClick=${() => { this.updateContinuous({ orient: id }); this.setState({ libOrient: id }); }} style="padding:7px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${cont.orient === id ? 'var(--accent)' : 'var(--line)'};background:${cont.orient === id ? 'var(--accent)' : '#fff'};color:${cont.orient === id ? '#fff' : 'var(--ink)'};">${lab}</button>
              `)}
            </div>`, 'Format des écrans visés par cette boucle. C’est le PREMIER filtre : seuls les éléments de bibliothèque à ce format sont proposés (items précis, promotions, campagnes) et diffusés.')}
            ${cField('Sources — oui / non', html`<div style="display:flex;flex-direction:column;gap:7px;">
              ${cUse('saison', 'Produits de saison', 'Ne garder que les produits liés à une période active (onglet Périodes).')}
              ${cUse('promotion', 'Promotions', 'Injecter les éléments « promotion » de la bibliothèque.', 'promotion')}
              ${cUse('campagne', 'Campagnes commerciales', 'Injecter les éléments « campagne » de la bibliothèque.', 'campagne')}
            </div>`, 'Chaque source s’active ou non. Quand elle est active, son ratio « 1 : N » apparaît à côté — c’est sa part dans la boucle. Les éléments injectés sont ceux de la bibliothèque au bon FORMAT d’écran et au bon MOMENT.')}
            ${cField('Adapter au moment', cToggle('perMoment', 'Oui (matin/midi/aprem)', 'Non'), 'Si activé, la boucle ne montre que les produits vendus au moment courant (table « Périodes de vente » dans l’onglet Périodes) : viennoiseries le matin, sandwichs le midi, etc.')}
            ${cField('Ordre', cChoice('order', [['catalogue', 'Catalogue'], ['aleatoire', 'Aléatoire']]), 'Ordre de passage. « Catalogue » = l’ordre du catalogue. « Aléatoire » = mélangé (stable pendant une fenêtre, re-mélangé au changement de moment/saison).')}
          </div>
          ${cont.source === 'categories' ? html`<div><div style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Catégories exclues (exceptions) — tout le reste passe</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${catChips}</div></div>` : ''}

          <!-- Suites : mini éditeur de montage (intro · outro · gamme…) -->
          <div style="border-top:1px dashed var(--line);padding-top:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
              <div style="display:flex;align-items:center;gap:7px;">
                <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Suites — montage à la main</span>
                ${infoTip('Une suite est une petite séquence que tu montes toi-même : intro, outro, présentation d’une gamme… Tu choisis son ordre, sa place dans la boucle (ouverture, clôture, ou toutes les N positions) et son format d’écran. Le reste du film continue à se composer tout seul autour.')}
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                ${v.seqDirty ? html`<span style="font-size:11.5px;font-weight:500;color:var(--warn);">non enregistré</span>` : ''}
                <button onClick=${v.addSequence} style="padding:6px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Suite</button>
                <button onClick=${v.saveSequences} disabled=${v.seqBusy || !v.seqDirty} style="padding:6px 14px;font-size:12px;font-weight:500;color:#fff;background:${v.seqDirty ? '#8D1D2C' : 'rgba(141,29,44,0.35)'};border:none;border-radius:8px;cursor:${v.seqBusy ? 'wait' : (v.seqDirty ? 'pointer' : 'default')};">${v.seqBusy ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </div>
            ${v.seqRows.length ? html`
              <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
                <!-- colonne gauche : les suites -->
                <div style="flex:0 0 250px;display:flex;flex-direction:column;gap:5px;">
                  ${v.seqRows.map((s) => html`
                    <div key=${s.id} style="display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:10px;cursor:pointer;border:1px solid ${s.selected ? 'rgba(141,29,44,0.45)' : 'rgba(35,34,32,0.10)'};background:${s.selected ? 'rgba(141,29,44,0.06)' : '#fff'};" onClick=${s.pick}>
                      <button onClick=${(e) => { e.stopPropagation(); s.toggleInFilm(); }} title=${s.inFilm ? 'Utilisée dans ce film — cliquer pour retirer' : 'Non utilisée dans ce film'} style="flex:0 0 auto;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;border-radius:5px;cursor:pointer;border:1px solid ${s.inFilm ? '#8D1D2C' : 'rgba(35,34,32,0.28)'};background:${s.inFilm ? '#8D1D2C' : '#fff'};color:#fff;">${s.inFilm ? '✓' : ''}</button>
                      <span style="flex:1 1 auto;min-width:0;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${s.active ? '#232220' : '#8A847C'};">${s.name}</span>
                      <span style="flex:0 0 auto;font-size:10.5px;color:var(--muted);">${({ debut: '⤒ début', fin: '⤓ fin', boucle: '↻ 1:' + s.ratio })[s.placement]} · ${s.count}</span>
                    </div>
                  `)}
                </div>
                <!-- colonne droite : la suite sélectionnée -->
                ${v.seqCur && html`
                  <div style="flex:1 1 380px;min-width:0;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 14px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                      <input key=${'sqn-' + v.seqCur.id} defaultValue=${v.seqCur.name} onChange=${v.seqCur.onName} placeholder="Nom de la suite (ex. Intro)" style="flex:1 1 160px;min-width:0;padding:7px 10px;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                      <span style="display:inline-flex;background:var(--chip);border-radius:8px;padding:2px;">
                        ${[['paysage', '▭ 16:9'], ['portrait', '▯ 9:16']].map(([id, lab]) => html`
                          <button onClick=${() => v.seqCur.setOrient(id)} style="padding:5px 10px;font-size:11.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${v.seqCur.orient === id ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}">${lab}</button>
                        `)}
                      </span>
                      <button onClick=${v.seqCur.toggleActive} title=${v.seqCur.active ? 'Active' : 'Inactive'} style="padding:5px 11px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${v.seqCur.active ? '#2E6E4E' : 'rgba(35,34,32,0.18)'};background:${v.seqCur.active ? 'rgba(63,122,82,0.10)' : '#fff'};color:${v.seqCur.active ? '#2E6E4E' : '#8A847C'};">${v.seqCur.active ? '✓ Active' : 'Inactive'}</button>
                      <button onClick=${v.seqCur.del} title="Supprimer la suite" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--accent);cursor:pointer;">✕</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:12px;">
                      <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Place dans la boucle</span>
                      ${[['debut', '⤒ Ouverture'], ['fin', '⤓ Clôture'], ['boucle', '↻ Toutes les N']].map(([id, lab]) => html`
                        <button onClick=${() => v.seqCur.setPlacement(id)} style="padding:5px 11px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${v.seqCur.placement === id ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${v.seqCur.placement === id ? '#8D1D2C' : '#fff'};color:${v.seqCur.placement === id ? '#fff' : '#232220'};">${lab}</button>
                      `)}
                      ${v.seqCur.placement === 'boucle' ? html`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted);">1 :
                        <input type="number" min="1" max="99" value=${v.seqCur.ratio} onInput=${v.seqCur.onRatio} style="width:60px;padding:5px 8px;font-size:12px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
                      </span>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow:auto;padding-right:4px;">
                      ${v.seqCur.items.length ? v.seqCur.items.map((it) => html`
                        <div key=${it.key} style="display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;background:#fff;border:1px solid ${it.missing || it.wrongOrient ? 'rgba(184,134,11,0.5)' : 'rgba(35,34,32,0.10)'};">
                          <span style="flex:0 0 auto;width:20px;font-size:11px;font-weight:500;color:var(--muted);text-align:right;">${it.n}</span>
                          <span style="flex:0 0 auto;font-size:13px;">${it.icon}</span>
                          <span style="flex:1 1 auto;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.name}<span style="color:var(--muted);"> · ${it.meta}</span>${it.wrongOrient ? html`<span style="color:var(--warn);"> · autre format, ne passera pas</span>` : ''}</span>
                          <span style="flex:0 0 auto;display:inline-flex;gap:3px;">
                            <button onClick=${it.up} disabled=${it.isFirst} title="Monter" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--paper);cursor:${it.isFirst ? 'default' : 'pointer'};opacity:${it.isFirst ? 0.35 : 1};font-size:11px;">↑</button>
                            <button onClick=${it.down} disabled=${it.isLast} title="Descendre" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--paper);cursor:${it.isLast ? 'default' : 'pointer'};opacity:${it.isLast ? 0.35 : 1};font-size:11px;">↓</button>
                            ${it.missing ? '' : html`<button onClick=${it.edit} title="Éditer dans la bibliothèque" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--paper);color:var(--muted-2);cursor:pointer;font-size:11px;">✎</button>`}
                            <button onClick=${it.del} title="Retirer de la suite" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--paper);color:var(--accent);cursor:pointer;font-size:11px;">✕</button>
                          </span>
                        </div>
                      `) : html`<span style="font-size:12px;color:var(--muted);padding:4px 0;">Suite vide — ajoute un élément ci-dessous.</span>`}
                    </div>
                    ${v.seqCur.addable.length ? html`
                      <select onChange=${v.seqCur.onAdd} style="margin-top:10px;width:100%;box-sizing:border-box;padding:8px 10px;font-size:12.5px;border:1px dashed rgba(141,29,44,0.4);border-radius:8px;background:rgba(141,29,44,0.04);color:var(--accent);font-weight:500;cursor:pointer;">
                        <option value="">＋ Ajouter un élément à la suite…</option>
                        ${v.seqCur.addable.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                      </select>
                    ` : html`<p style="margin:10px 0 0;font-size:12px;color:var(--warn);">Aucun élément de bibliothèque au format ${v.seqCur.orient === 'portrait' ? '9:16' : '16:9'}.</p>`}
                  </div>
                `}
              </div>
            ` : html`<p style="margin:0;font-size:12.5px;color:var(--muted);">Aucune suite. « + Suite » pour monter une intro, un outro ou une présentation de gamme.</p>`}
          </div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;">
            ${cField('Durée fiche (s)', cNum('prodDur', cont.prodDur, 2, 60), 'Combien de secondes une fiche produit reste à l’écran.')}
            ${cField('Durée vidéo (s)', cNum('clipDur', cont.clipDur, 2, 120), 'Durée d’un clip vidéo/photo ciblé (et de la vidéo surprise).')}
            ${cField('Max fiches / boucle', cNum('maxItems', cont.maxItems, 4, 40), 'Nombre maximum de fiches produit dans une boucle (borne de sécurité pour éviter une boucle trop longue).')}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:9px;">
              <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Ratios par type d'élément · 1 : N (0 = jamais)</span>
              ${infoTip('Dose le mélange de la boucle. « 1 : N » = un élément de ce type tous les N slots. Ex. Liaison 1:5 = un logo de transition toutes les 5 fiches ; Produit seul 1:6 = une fiche plein écran toutes les 6. 0 = ce type n’apparaît jamais.')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;max-width:360px;">
              ${cRatio('liaison', 'Liaison (logo)')}
              ${cRatio('produitSeul', 'Produit seul')}
              ${cRatio('media', 'Vidéo/photo ciblée')}
              ${cRatio('animation', 'Animation promo')}
              ${cRatio('surprise', 'Vidéo surprise')}
            </div>
            <!-- Parcours de la bibliothèque : actif/inactif + ratio de passage -->
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 8px;">
              <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Parcours de la bibliothèque · ${cont.orient === 'portrait' ? '9:16 portrait' : '16:9 paysage'}</span>
              ${infoTip('Créer une boucle, c’est passer en revue TOUS les éléments de la bibliothèque : coche ceux qui doivent passer et donne à chacun son ratio « 1 : N » (un passage tous les N slots). Seuls les éléments au format d’écran de cette boucle sont listés, et un élément tagué par moment ne passera qu’à ces moments-là. Décocher garde le ratio en mémoire.')}
              <span style="font-size:11.5px;font-weight:500;color:${v.contLoopOn ? 'var(--muted-2)' : '#8A847C'};">${v.contLoopOn} / ${v.contItemRatios.length} actif(s)</span>
              ${v.contItemRatios.length ? html`<span style="display:inline-flex;gap:5px;">
                <button onClick=${v.contLoopAll} style="padding:4px 10px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink);">Tout activer</button>
                <button onClick=${v.contLoopNone} style="padding:4px 10px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink);">Tout désactiver</button>
              </span>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;max-width:470px;max-height:290px;overflow:auto;padding-right:4px;">
              ${v.contItemRatios.length ? v.contItemRatios.map((it) => html`
                <div key=${it.id} style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;border:1px solid ${it.on ? 'rgba(141,29,44,0.28)' : 'rgba(35,34,32,0.10)'};background:${it.on ? 'rgba(141,29,44,0.05)' : '#fff'};">
                  <button onClick=${it.toggle} title=${it.on ? 'Actif dans la boucle — cliquer pour retirer' : 'Inactif — cliquer pour ajouter à la boucle'} style="flex:0 0 auto;width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;border-radius:5px;cursor:pointer;border:1px solid ${it.on ? '#8D1D2C' : 'rgba(35,34,32,0.28)'};background:${it.on ? '#8D1D2C' : '#fff'};color:#fff;">${it.on ? '✓' : ''}</button>
                  <span style="flex:0 0 auto;font-size:13px;">${it.icon}</span>
                  <span style="flex:1 1 auto;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${it.on ? '#232220' : '#8A847C'};">${it.name}<span style="color:var(--muted);"> · ${it.moments}</span></span>
                  <span style="flex:0 0 auto;font-size:12px;color:var(--muted);">1 :</span>
                  <input type="number" min="0" max="99" value=${it.n} onInput=${it.onN} title="Un passage tous les N slots de la boucle" style="width:62px;padding:5px 8px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
                  <button onClick=${it.edit} title="Éditer cet élément dans la bibliothèque" style="flex:0 0 auto;padding:4px 7px;font-size:12px;border-radius:8px;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--muted-2);">✎</button>
                </div>
              `) : html`<span style="font-size:12px;color:var(--muted);">Aucun élément de bibliothèque à ce format.</span>`}
            </div>
          </div>
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start;">
            ${cField('Rafraîchissement', cChoice('refresh', [['moment', 'Au moment/saison'], ['minutes', 'Toutes les N min']]), 'Quand la boucle est recomposée. « Au moment/saison » = à chaque changement de créneau (matin→midi) ou de période. « Toutes les N min » = aussi rafraîchie périodiquement.')}
            ${cont.refresh === 'minutes' ? cField('N minutes', cNum('refreshMin', cont.refreshMin, 1, 240), 'Intervalle de recomposition de la boucle, en minutes.') : ''}
            ${cField('Si rien en saison', cChoice('fallback', [['tout', 'Tout le catalogue'], ['aucun', 'Rien (attente)']]), 'Repli quand aucun produit n’est éligible (hors saison / rien au bon moment) : jouer tout le catalogue, ou afficher l’écran d’attente.')}
          </div>
          ${excFilms.length ? html`<div>
            ${cField('Playlists d\'exception (jouées EN PLUS à chaque boucle · plusieurs possibles)', html`<div style="display:flex;gap:6px;flex-wrap:wrap;">${excChips}</div>`,
              'Anciens films « playlist » montés à la main, ajoutés à la fin de CHAQUE boucle. Les nouveaux montages se font désormais dans les Suites ci-dessous.')}
          </div>` : ''}

        </div>
      </div>`;

    const home = this.homeReadiness();
    const MOMENT_FULL = { matin: this.t('moment.matin'), midi: this.t('moment.midi'), aprem: this.t('moment.aprem') };
    return html`
<div class="workspace">

  ${!EMBEDDED && html`
  <nav class="sidebar" aria-label=${v.t('shell.menu')}>
    <div class="sidebar__head">
      <img src="assets/logo.png" alt="L'Atelier By" class="sidebar__logo" />
      <div class="sidebar__kicker">${v.t('shell.kicker')}</div>
    </div>
    <div class="sidebar__back">
      <a href="../marketing/">${icon(ICON.back)}${v.t('shell.back')}</a>
    </div>
    <div class="sidebar__groups">
      ${v.shellGroups.map((g, gi) => html`
        <div class="sidebar__group" key=${g.label}>
          <div class="sidebar__group-label">${g.label}</div>
          ${g.items.map((it) => html`
            <button key=${it.key} class=${'sidebar__item' + (it.active ? ' is-active' : '')} aria-current=${it.active ? 'page' : undefined} data-view=${it.view || undefined} data-nav-translations=${it.view === 'translations' ? '' : undefined} onClick=${it.go}>${icon(it.icon)}${it.label}</button>
          `)}
        </div>
      `)}
    </div>
  </nav>`}

  <div class="workspace__main">
  <header class="topbar">
    <div class="topbar__title">
      <p class="topbar__kicker">${v.t('shell.kicker')}</p>
      <h1>${v.shellTitle}</h1>
      ${v.trail.length > 0 && html`<div class="topbar__trail">
        ${v.trail.map((c, i) => html`${i > 0 && html`<span class="sep">›</span>`}${c.cur ? html`<span class="is-current">${c.label}</span>` : (c.link ? html`<button onClick=${c.go}>${c.label}</button>` : html`<span>${c.label}</span>`)}`)}
      </div>`}
    </div>
    <div class="topbar__actions">
      <button class="btn btn--icon hdr-btn" onClick=${v.undo} disabled=${!v.canUndo} aria-label=${v.t('hdr.undo')}>${icon(ICON.undo)}<span class="hdr-tip">${v.t('hdr.undo')}</span></button>
      <button class="btn btn--icon hdr-btn" onClick=${v.redo} disabled=${!v.canRedo} aria-label=${v.t('hdr.redo')}>${icon(ICON.redo)}<span class="hdr-tip">${v.t('hdr.redo')}</span></button>
      <span class="topbar__sep"></span>
      <button class=${'btn btn--icon hdr-btn ' + (v.dirty ? 'is-dirty' : 'is-ok')} onClick=${v.save} aria-label=${v.saveTip}>${icon(ICON.check)}<span class="hdr-tip">${v.saveTip}</span></button>
      <button class="btn btn--icon hdr-btn" onClick=${v.pushPrices} aria-label=${v.t('hdr.pushPrices')}>${icon(ICON.euro)}<span class="hdr-tip">${v.t('hdr.pushPrices')}</span></button>
      <button class=${'btn btn--icon hdr-btn' + (v.override ? ' is-on' : '')} onClick=${v.toggleOverride} aria-pressed=${v.override ? 'true' : 'false'} aria-label=${v.overrideTip}>${icon(ICON.bolt)}<span class="hdr-tip">${v.overrideTip}</span></button>
      ${EMBEDDED && html`
        <button class="btn btn--icon hdr-btn" onClick=${v.openReport} aria-label=${v.t('hdr.report')}>${icon(ICON.report)}<span class="hdr-tip hdr-tip-right">${v.t('hdr.report')}</span></button>
        <button class="btn btn--icon hdr-btn" onClick=${v.openOnboarding} aria-label=${v.t('hdr.onboarding')}>${icon(ICON.onboarding)}<span class="hdr-tip hdr-tip-right">${v.t('hdr.onboarding')}</span></button>`}
      <span class="topbar__sep"></span>
      <a class="btn" href="film" target="_blank" title="Ouvrir la visionneuse publique du film (dernière playlist publiée)">${v.t('shell.seeFilm')} ${icon(ICON.external, 14)}</a>
      ${EMBEDDED && html`<button class="btn hdr-btn" onClick=${() => this.openWizard()}>${icon(ICON.play, 14)}${v.t('shell.broadcast')}<span class="hdr-tip hdr-tip-right">${v.t('hdr.broadcastTip')}</span></button>`}
      <button class=${'btn hdr-btn' + (st.view === 'campaignVideo' ? '' : ' btn--primary')} onClick=${v.openPublish}>${icon(ICON.send, 14)}${v.t('shell.publish')}<span class="hdr-tip hdr-tip-right">${v.t('hdr.publish')}</span></button>
      <div class="role-switch" title=${v.t('nav.uiLang')}>
        ${v.uiLangs.map((l) => html`<button key=${l.id} onClick=${l.pick} title=${l.label} class=${l.active ? 'is-on' : ''}>${l.short}</button>`)}
      </div>
    </div>
  </header>

  ${EMBEDDED && html`
  <nav class="page-tabs page-tabs--bar" aria-label=${v.t('shell.tabs')}>
    ${v.shellTabs.map((it) => html`<button key=${it.key} class=${'page-tabs__tab' + (it.active ? ' is-on' : '')} data-view=${it.view} data-nav-translations=${it.view === 'translations' ? '' : undefined} onClick=${it.go}>${it.label}</button>`)}
  </nav>`}

  ${v.isSettingsView && html`
  <div class="app__body">
    <div style="max-width:640px;">
      <p style="margin:0 0 18px;font-size:13px;color:var(--muted-2);line-height:1.5;">${v.t('settings.subtitle')}</p>
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <h2 style="margin:0;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${v.t('settings.serverConn')}</h2>
          <span style=${v.srvPingStyle}>${v.srvPing}</span>
        </div>
        <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:6px;">URL du CMS (API base)</label>
        <input value=${v.srvUrl} onInput=${v.onSrvUrl} placeholder="https://cms.erp.local/api/v1" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;margin-bottom:16px;" />
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <div style="flex:1 1 auto;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:6px;">IP / hôte player</label>
            <input value=${v.srvIp} onInput=${v.onSrvIp} placeholder="192.168.1.42" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          </div>
          <div style="flex:1 1 auto;min-width:0;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:6px;">Token player</label>
            <input value=${v.srvToken} onInput=${v.onSrvToken} placeholder="plyr_…" spellcheck="false" style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          </div>
        </div>
        <button onClick=${v.testConn} style=${v.testBtnStyle}>${v.testBtnLabel}</button>
        ${v.hasTestRows && html`
          <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
            ${v.testRows.map((r) => html`
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:8px;background:#fff;border:1px solid var(--line);">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;"><span style=${r.dotStyle}></span><span style="font-size:13px;font-family:ui-monospace,monospace;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.label}</span></div>
                <span style="flex:0 0 auto;font-size:13px;font-weight:500;color:${r.color};">${r.result}</span>
              </div>
            `)}
          </div>
        `}
      </div>

      <!-- Stockage de la médiathèque : OVHcloud Object Storage (réglé par secrets) -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;" data-media-store=${v.store.ovh ? 's3' : 'local'}>
        <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${v.t('store.title')}</h2>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">${v.t('store.intro')}</p>
        ${v.store.known ? html`
          <p style="margin:0 0 6px;font-size:13px;font-weight:500;color:${v.store.ovh ? 'var(--green)' : 'var(--muted-2)'};">${v.store.ovh ? '● ' : '○ '}${v.store.where}</p>
          ${v.store.check && html`<p style="margin:0 0 6px;font-size:12px;color:${v.store.checkOk ? 'var(--muted-2)' : 'var(--accent)'};">${v.store.check}</p>`}
          <p style="margin:0 0 12px;font-size:12px;color:var(--muted);">${v.store.counts} · ${v.t('store.max', { mb: v.store.maxMb })}</p>
          ${!v.store.ovh && html`<p style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--paper);border:1px solid var(--line);font-size:12px;color:var(--muted-2);line-height:1.6;">${v.t('store.howTo')}</p>`}
          ${v.store.job && html`<p style="margin:0 0 8px;font-size:12px;color:var(--ink);">${v.store.job}</p>`}
          ${v.store.jobErrors.map((e) => html`<p style="margin:0 0 4px;font-size:11.5px;color:var(--accent);">${e}</p>`)}
          ${v.store.ovh && html`<div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" onClick=${v.store.check_} disabled=${v.store.busy}>${v.store.busy ? v.t('store.checking') : v.t('store.check')}</button>
            ${v.store.canMigrate && html`<button class="btn btn--primary" onClick=${v.store.migrate} data-media-migrate>${v.store.migrateLabel}</button>`}
          </div>`}
        ` : html`<p style="margin:0;font-size:12px;color:var(--muted);">…</p>`}
      </div>

      <!-- Matières premières : ingrédient ↔ animation de la bibliothèque -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Matières premières — ingrédient ↔ animation</h2>
          <div style="display:flex;align-items:center;gap:8px;">
            ${v.ingDirty ? html`<span style="font-size:11.5px;font-weight:500;color:var(--warn);">modifications non enregistrées</span>` : ''}
            <button onClick=${v.addIngredient} style="padding:6px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Ingrédient</button>
          </div>
        </div>
        <p style="margin:0 0 14px;font-size:12px;color:var(--muted);line-height:1.5;">Lie une matière première à <strong>une animation</strong> de la bibliothèque : c'est ce lien que le module produit du franchiseur (Produit → Ingrédient) vient lire. Le réglage se fait <strong>ici</strong> — la régie est la seule source. La référence ERP est optionnelle : elle rapproche les deux mondes sans dépendre du nom.</p>
        ${v.ingAnimOptions.length ? '' : html`<p style="margin:0 0 12px;font-size:12px;color:var(--warn);">Aucune animation dans la bibliothèque — crée un élément « animation » dans le Compositeur pour pouvoir en lier une.</p>`}
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${v.ingRows.map((x) => html`
            <div key=${x.id} style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 11px;border-radius:10px;border:1px solid ${x.active ? 'rgba(35,34,32,0.10)' : 'rgba(35,34,32,0.06)'};background:${x.active ? '#fff' : 'rgba(35,34,32,0.03)'};">
              <input key=${'ign-' + x.id} defaultValue=${x.name} onChange=${x.onName} placeholder="Nom de l'ingrédient (ex. Beurre AOP)" style="flex:1 1 180px;min-width:0;padding:7px 10px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              <input key=${'igr-' + x.id} defaultValue=${x.extRef} onChange=${x.onRef} placeholder="réf. ERP (optionnel)" spellcheck="false" style="flex:0 1 140px;min-width:0;padding:7px 10px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              <label style="display:inline-flex;align-items:center;gap:6px;flex:1 1 220px;min-width:0;">
                <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap;">Animation</span>
                <select value=${x.moduleId} onChange=${x.onAnim} style="flex:1 1 auto;min-width:0;padding:6px 8px;font-size:12px;border:1px solid ${x.orphan ? 'rgba(184,134,11,0.6)' : 'rgba(35,34,32,0.16)'};border-radius:8px;background:#fff;cursor:pointer;">
                  <option value="">— aucune —</option>
                  ${v.ingAnimOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                </select>
              </label>
              ${x.orphan ? html`<span style="font-size:11px;color:var(--warn);">animation supprimée</span>` : ''}
              <button onClick=${x.toggleActive} title=${x.active ? 'Rendre inactif' : 'Réactiver'} style="flex:0 0 auto;padding:5px 11px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${x.active ? '#2E6E4E' : 'rgba(35,34,32,0.18)'};background:${x.active ? 'rgba(63,122,82,0.10)' : '#fff'};color:${x.active ? '#2E6E4E' : '#8A847C'};">${x.active ? '✓ Actif' : 'Inactif'}</button>
              <span style="flex:0 0 auto;display:inline-flex;gap:3px;">
                <button onClick=${x.up} disabled=${x.isFirst} title="Monter" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${x.isFirst ? 'default' : 'pointer'};opacity:${x.isFirst ? 0.35 : 1};">↑</button>
                <button onClick=${x.down} disabled=${x.isLast} title="Descendre" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${x.isLast ? 'default' : 'pointer'};opacity:${x.isLast ? 0.35 : 1};">↓</button>
                <button onClick=${x.del} title="Supprimer" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--accent);cursor:pointer;">✕</button>
              </span>
            </div>
          `)}
          ${!v.ingRows.length && html`<p style="margin:0;font-size:12.5px;color:var(--muted);">Aucune matière première. « + Ingrédient » pour en déclarer une.</p>`}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;">
          <button onClick=${v.saveIngredients} disabled=${v.ingBusy || !v.ingDirty} style="padding:11px 22px;font-size:13.5px;font-weight:500;color:#fff;background:${v.ingDirty ? '#8D1D2C' : 'rgba(141,29,44,0.35)'};border:none;border-radius:8px;cursor:${v.ingBusy ? 'wait' : (v.ingDirty ? 'pointer' : 'default')};">${v.ingBusy ? 'Enregistrement…' : 'Enregistrer les matières premières'}</button>
          <button onClick=${v.inspectIngredients} title="Cherche la table des ingrédients dans la base de l'ERP (lecture seule, rien n'est importé)" style="padding:9px 16px;font-size:12.5px;font-weight:500;color:var(--muted-2);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">Diagnostic ERP</button>
        </div>
        ${v.ingDiag && html`
          <div style="margin-top:12px;padding:11px 13px;border-radius:10px;background:var(--paper);border:1px solid var(--line);font-size:12px;color:var(--muted-2);">
            ${v.ingDiag.busy ? 'Recherche…'
              : (v.ingDiag.error ? html`<span style="color:var(--accent);">Diagnostic impossible — la base de l'ERP n'est pas joignable : ${v.ingDiag.error}</span>`
                : (v.ingDiag.ok
                  ? html`<div>Base <strong>${v.ingDiag.db}</strong> — table(s) trouvée(s) :
                      ${v.ingDiag.inspected.map((t) => html`<div style="margin-top:6px;"><strong>${t.table}</strong> <span style="color:var(--muted);font-family:ui-monospace,monospace;">${t.columns.join(', ')}</span></div>`)}
                    </div>`
                  : 'Aucune table d\'ingrédients reconnue dans la base de l\'ERP. Les matières premières se saisissent alors directement ci-dessus.'))}
          </div>
        `}
      </div>

      <!-- Catégories de la bibliothèque : classement des éléments + table liée -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Catégories de la bibliothèque</h2>
          <div style="display:flex;align-items:center;gap:8px;">
            ${v.libCatDirty ? html`<span style="font-size:11.5px;font-weight:500;color:var(--warn);">modifications non enregistrées</span>` : ''}
            <button onClick=${v.addLibCat} style="padding:6px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Catégorie</button>
          </div>
        </div>
        <p style="margin:0 0 14px;font-size:12px;color:var(--muted);line-height:1.5;">Le classement des éléments de la bibliothèque. Chaque catégorie dit à quelle <strong>table de la régie</strong> elle est liée : c'est la donnée qui alimente ses éléments. Une catégorie inactive n'est plus proposée au classement, mais les éléments qui la portent restent visibles.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${v.libCatRows.map((c) => html`
            <div key=${c.id} style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 11px;border-radius:10px;border:1px solid ${c.active ? 'rgba(35,34,32,0.10)' : 'rgba(35,34,32,0.06)'};background:${c.active ? '#fff' : 'rgba(35,34,32,0.03)'};">
              <input key=${'lcc-' + c.id} type="color" defaultValue=${c.color} onChange=${c.onColor} title="Couleur de la catégorie" style="flex:0 0 auto;width:30px;height:30px;padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;" />
              <input key=${'lcn-' + c.id} defaultValue=${c.name} onChange=${c.onName} placeholder="Nom de la catégorie" style="flex:1 1 150px;min-width:0;padding:7px 10px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              <label style="display:inline-flex;align-items:center;gap:6px;flex:1 1 210px;min-width:0;">
                <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap;">Table liée</span>
                <select value=${c.src} onChange=${c.onSrc} title="Table de la régie qui alimente cette catégorie" style="flex:1 1 auto;min-width:0;padding:6px 8px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                  ${v.libSourceOptions.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                </select>
              </label>
              <span style="flex:0 0 auto;font-size:11.5px;color:var(--muted);">${c.used} élément(s)</span>
              <button onClick=${c.toggleActive} title=${c.active ? 'Rendre inactive' : 'Réactiver'} style="flex:0 0 auto;padding:5px 11px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${c.active ? '#2E6E4E' : 'rgba(35,34,32,0.18)'};background:${c.active ? 'rgba(63,122,82,0.10)' : '#fff'};color:${c.active ? '#2E6E4E' : '#8A847C'};">${c.active ? '✓ Active' : 'Inactive'}</button>
              <span style="flex:0 0 auto;display:inline-flex;gap:3px;">
                <button onClick=${c.up} disabled=${c.isFirst} title="Monter" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${c.isFirst ? 'default' : 'pointer'};opacity:${c.isFirst ? 0.35 : 1};">↑</button>
                <button onClick=${c.down} disabled=${c.isLast} title="Descendre" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${c.isLast ? 'default' : 'pointer'};opacity:${c.isLast ? 0.35 : 1};">↓</button>
                <button onClick=${c.del} title="Supprimer" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--accent);cursor:pointer;">✕</button>
              </span>
            </div>
          `)}
        </div>
        <button onClick=${v.saveLibCats} disabled=${v.libCatBusy || !v.libCatDirty} style="margin-top:16px;padding:11px 22px;font-size:13.5px;font-weight:500;color:#fff;background:${v.libCatDirty ? '#8D1D2C' : 'rgba(141,29,44,0.35)'};border:none;border-radius:8px;cursor:${v.libCatBusy ? 'wait' : (v.libCatDirty ? 'pointer' : 'default')};">${v.libCatBusy ? 'Enregistrement…' : 'Enregistrer les catégories'}</button>
      </div>

      <!-- Connexion sécurisée (https) -->
      ${(() => {
        const hs = st.https;
        const onHttp = location.protocol === 'http:';
        const until = hs && hs.validTo ? new Date(hs.validTo).toLocaleString('fr-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
        const late = hs && hs.daysLeft != null && hs.daysLeft < 2;
        return html`<div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Connexion sécurisée (https)</h2>
          ${hs && hs.ok ? html`
            <p style="margin:0 0 10px;font-size:12px;color:var(--green);font-weight:500;">● https actif — <a href=${hs.base} style="color:var(--green);">${hs.base}</a></p>
            <p style="margin:0 0 10px;font-size:12px;color:${late ? '#8D1D2C' : '#8A847C'};line-height:1.5;">Certificat ${hs.issuer || 'Let\'s Encrypt'} valable jusqu'au ${until}${late ? ' — renouvellement en retard : à vérifier sur le serveur (la livraison dit, à l\'étape HTTPS, qui le renouvelle et si son défi passe)' : ' · renouvelé automatiquement (certificats de 6 jours)'}.</p>
            <p style="margin:0 0 ${onHttp ? 12 : 0}px;font-size:12px;color:var(--muted);line-height:1.5;">Un écran ne <strong>redémarre sans réseau</strong> que s'il est ouvert en https : la page et son code restent alors sur l'écran. Ouvre la régie à cette adresse et ses liens (player, magasin, film) seront tous en https.</p>
            ${onHttp ? html`<a href=${hs.base} style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;font-size:12.5px;font-weight:500;color:#fff;background:var(--green);border-radius:999px;">Ouvrir la régie en https ↗</a>` : ''}
          ` : html`<p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">Pas de https constaté sur ce serveur. La livraison s'appuie sur celui du serveur s'il en a un, et pose sinon un certificat Let's Encrypt pour l'adresse IP (renouvelé automatiquement). En http, les écrans tiennent une coupure réseau page ouverte, mais ne redémarrent pas sans réseau — le navigateur réserve le service worker au https.</p>`}
        </div>`;
      })()}

      <!-- Espace Vidéo — Agence -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
        <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Espace Vidéo — Agence</h2>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">Un accès séparé où les agences uploadent des vidéos/photos taguées (moment · produit · saison) et vérifient leur présence sur le serveur. Elles n'accèdent qu'à cette page, avec l'identifiant <strong>agence</strong> et un mot de passe dédié.</p>
        ${st.agencyEnabled
          ? html`<p style="margin:0 0 14px;font-size:12px;color:var(--green);font-weight:500;">● Accès ouvert — partage-leur ce lien :</p>`
          : html`<p style="margin:0 0 14px;padding:10px 12px;border-radius:8px;background:rgba(184,134,11,0.10);border:1px solid rgba(184,134,11,0.35);font-size:12px;color:var(--muted-2);line-height:1.5;"><strong>Accès fermé.</strong> Aucun mot de passe agence n'est défini sur ce serveur, et le mot de passe par défaut est refusé en production. Pour l'ouvrir : ajouter le secret <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">SIG_AGENCY_PASSWORD</code> au dépôt GitHub (Settings → Secrets and variables → Actions), puis relancer le déploiement.</p>`}
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
          <input readonly value=${v.agencyUrl} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          <button onClick=${() => v.copyLink(v.agencyUrl)} style="flex:0 0 auto;padding:8px 14px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">⎘ Copier</button>
          <a href=${v.agencyUrl} target="_blank" style="flex:0 0 auto;font-size:12.5px;font-weight:500;color:var(--accent);">↗ Ouvrir</a>
        </div>
      </div>

      ${st.pwaForm && html`
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
        <h2 style="margin:0 0 4px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Catalogue PWA — en secours</h2>
        <p style="margin:0 0 8px;font-size:12px;color:var(--muted-2);line-height:1.5;">La source principale du catalogue est l'<strong>API TFBuddy</strong> (Produits → « Importer depuis TFBuddy », et chaque jour). Cette base prend le relais quand l'API ne répond pas, ou à la demande ci-dessous.</p>
        <p style="margin:0 0 14px;font-size:12px;color:var(--muted);line-height:1.5;">La régie tourne sur le serveur des bases de données : le bouton détecte tout seul la base qui contient <strong>product_category</strong>, <strong>product</strong> et <strong>shop_product</strong> (connexion locale), lit les colonnes, et rafraîchit la table produits — catégories, produits, prix par boutique mappés sur les magasins dans l'ordre.</p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <button onClick=${() => this.pwaAction('import')} disabled=${!!st.pwaBusy} style="display:inline-flex;align-items:center;gap:9px;padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;cursor:${st.pwaBusy ? 'progress' : 'pointer'};background:var(--muted-2);color:#fff;border:1px solid var(--muted-2);">
            <span style="font-size:16px;display:inline-block;${st.pwaBusy === 'import' ? 'animation:none;' : ''}">⟳</span>
            ${st.pwaBusy === 'import' ? 'Rafraîchissement…' : 'Rafraîchir depuis la base'}
          </button>
          <button onClick=${() => this.pwaAction('test')} disabled=${!!st.pwaBusy} style="padding:11px 18px;font-size:13px;font-weight:500;border-radius:8px;cursor:${st.pwaBusy ? 'progress' : 'pointer'};background:transparent;color:var(--muted-2);border:1px solid var(--line);">${st.pwaBusy === 'test' ? 'Détection…' : 'Tester (sans importer)'}</button>
        </div>
        ${st.pwaResult && html`
          <div style="margin-bottom:12px;font-size:12.5px;font-weight:500;line-height:1.6;color:${st.pwaResult.ok ? '#2E7D32' : '#8D1D2C'};">
            ${st.pwaResult.ok
              ? (st.pwaResult.counts
                ? `✓ Base « ${st.pwaResult.db} » détectée — ${Object.entries(st.pwaResult.counts).map(([k, n]) => `${n} ${k}`).join(' · ')}`
                : `✓ Base « ${st.pwaResult.db} » — importé : ${st.pwaResult.categories} catégorie(s) · ${st.pwaResult.products} produit(s) · ${st.pwaResult.storePrices} prix/boutique (${st.pwaResult.shopMap}) · ${st.pwaResult.relinked} élément(s) re-lié(s)${st.pwaResult.dupes ? ` · ${st.pwaResult.dupes} ligne(s) en double ignorée(s)` : ''}${st.pwaResult.visuelsConserves ? ` · ${st.pwaResult.visuelsConserves} visuel(s) de la régie conservé(s)` : ''}${st.pwaResult.createdStores ? ` · magasin(s) créé(s) : ${st.pwaResult.createdStores.join(', ')}` : ''}${st.pwaResult.inactiveShops ? ` · ${st.pwaResult.inactiveShops} boutique(s) inactive(s) ignorée(s)` : ''}${st.pwaResult.langSet ? ` · langue préférée appliquée à ${st.pwaResult.langSet} magasin(s) (${st.pwaResult.langSource})` : (st.pwaResult.langSource ? ` · langue : ${st.pwaResult.langSource}` : '')}`)
              : `✗ ${st.pwaResult.error}`}
            ${st.pwaResult.note ? html`<span style="display:block;font-weight:400;color:#8a6508;">⚠ ${st.pwaResult.note}</span>` : ''}
          </div>
        `}
        <details>
        <summary style="font-size:12px;font-weight:500;color:var(--muted);cursor:pointer;">Réglages avancés — uniquement si la détection automatique échoue</summary>
        <div style="margin:10px 0 0;">
          <button onClick=${() => this.pwaReset()} style="padding:8px 14px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;background:transparent;color:var(--accent);border:1px solid rgba(141,29,44,0.3);">Réinitialiser les réglages avancés (retour au tout-automatique)</button>
        </div>
        <div style="display:grid;grid-template-columns:1.2fr 90px 1fr 1fr 1fr;gap:9px;margin:12px 0 10px;">
          <input value=${st.pwaForm.host} onInput=${(e) => this.setPwa('host', e.target.value)} placeholder="Hôte (127.0.0.1)" style="padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
          <input value=${st.pwaForm.port} onInput=${(e) => this.setPwa('port', e.target.value)} placeholder="3306" inputmode="numeric" style="padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
          <input value=${st.pwaForm.db} onInput=${(e) => this.setPwa('db', e.target.value)} placeholder="Base (ex. pwa)" style="padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
          <input value=${st.pwaForm.user} onInput=${(e) => this.setPwa('user', e.target.value)} placeholder="Utilisateur" style="padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
          <input type="password" value=${st.pwaForm.password} onInput=${(e) => this.setPwa('password', e.target.value)} placeholder=${st.pwaForm.hasPassword ? '••••• (inchangé)' : 'Mot de passe'} style="padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">ID boutique PWA par magasin</span>
          ${st.fleet.map((sf) => html`
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-2);background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:5px 6px 5px 12px;">
              ${sf.store}
              <input value=${(st.pwaForm.shopMap || {})[sf.id] || ''} onInput=${(e) => this.setPwaShop(sf.id, e.target.value)} placeholder="id" style="width:52px;padding:5px 8px;font-size:12px;border:1px solid var(--line);border-radius:999px;background:#fff;text-align:center;" />
            </label>
          `)}
        </div>
        <div style="margin-bottom:4px;">
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
            <label style="font-size:11.5px;color:var(--muted);">Catégories → <code>id, nom</code></label>
            <textarea value=${st.pwaForm.qCategories} onInput=${(e) => this.setPwa('qCategories', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:var(--muted);">Produits → <code>id, id_catégorie, nom, prix, actif</code></label>
            <textarea value=${st.pwaForm.qProducts} onInput=${(e) => this.setPwa('qProducts', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:var(--muted);">Prix par boutique (shop_product) → <code>id_produit, id_boutique, prix</code></label>
            <textarea value=${st.pwaForm.qShopPrices} onInput=${(e) => this.setPwa('qShopPrices', e.target.value)} rows="1" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;resize:vertical;"></textarea>
            <label style="font-size:11.5px;color:var(--muted);">Alias / langues (optionnel) → <code>id_produit, langue, nom</code></label>
            <textarea value=${st.pwaForm.qAliases} onInput=${(e) => this.setPwa('qAliases', e.target.value)} rows="1" placeholder="SELECT product_id, lang, name FROM product_lang" style="padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;resize:vertical;"></textarea>
          </div>
        </div>
        </details>
      </div>
      `}

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:26px 28px;margin-top:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="margin:0;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Liens de diffusion — film</h2>
          <a href="film" target="_blank" style="font-size:12.5px;font-weight:500;color:var(--accent);">▶ Ouvrir le film</a>
        </div>
        <p style="margin:0 0 16px;font-size:12px;color:var(--muted);line-height:1.5;">Le format d'écran (pixels + ratio) est inscrit dans l'URL : copie le lien du format voulu et pointe la TV / box / navigateur directement dessus. La lecture ne demande aucune connexion.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${this.filmLinks().map((l) => html`
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
              <div style="flex:0 0 190px;min-width:0;">
                <div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.label}</div>
                <div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.sub}</div>
              </div>
              <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);" />
              <button onClick=${() => this.copyLink(l.url)} title="Copier le lien" style="flex:0 0 auto;padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">Copier</button>
              <a href=${l.url} target="_blank" title="Ouvrir dans un onglet" style="flex:0 0 auto;padding:8px 11px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);">↗</a>
            </div>
          `)}
        </div>
        ${this.perFilmLinks().length > 0 && html`
          <h3 style="margin:20px 0 4px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Par film · dernière publication du film (55″ standard)</h3>
          <p style="margin:0 0 12px;font-size:11.5px;color:var(--muted);line-height:1.5;">Un lien par film de la régie. Un film jamais publié s'affiche en prévisualisation (badge « brouillon ») — pense à Enregistrer puis Publier.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${this.perFilmLinks().map((l) => html`
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
                <div style="flex:0 0 190px;min-width:0;">
                  <div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.label}</div>
                  <div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.sub}</div>
                </div>
                <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);" />
                <button onClick=${() => this.copyLink(l.url)} title="Copier le lien" style="flex:0 0 auto;padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">Copier</button>
                <a href=${l.url} target="_blank" title="Ouvrir dans un onglet" style="flex:0 0 auto;padding:8px 11px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);">↗</a>
              </div>
            `)}
          </div>
        `}
        ${this.storeFilmLinks().length > 0 && html`
          <h3 style="margin:20px 0 4px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Par magasin · version assignée au magasin (55″ standard)</h3>
          <p style="margin:0 0 12px;font-size:11.5px;color:var(--muted);line-height:1.5;">Chaque lien montre le film que CE magasin doit jouer — pratique à envoyer au responsable du point de vente.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${this.storeFilmLinks().map((l) => html`
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
                <div style="flex:0 0 190px;min-width:0;">
                  <div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.label}</div>
                  <div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.sub}</div>
                </div>
                <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);" />
                <button onClick=${() => this.copyLink(l.url)} title="Copier le lien" style="flex:0 0 auto;padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">Copier</button>
                <a href=${l.url} target="_blank" title="Ouvrir dans un onglet" style="flex:0 0 auto;padding:8px 11px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);">↗</a>
              </div>
            `)}
          </div>
        `}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button onClick=${this.logout} style="padding:10px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--muted);cursor:pointer;">Se déconnecter</button>
      </div>
    </div>
  </div>
  `}

  ${v.isProductsView && html`
  <div class="app__body">
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;">${v.t('products.subtitle')}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Langue d'édition</span>
          ${v.langChips.map((l) => html`
            <button onClick=${l.pick} title=${l.label + (l.nStores ? ` · ${l.nStores} magasin(s)` : '')} style=${l.style}>${l.id}${l.nStores ? html`<span style="font-weight:400;opacity:0.75;">${l.nStores}</span>` : ''}</button>
          `)}
        </div>
        <button onClick=${v.saveCat} disabled=${!v.catDirty || v.catSaving} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid ${v.catDirty ? 'var(--accent)' : 'var(--line)'};cursor:${v.catDirty && !v.catSaving ? 'pointer' : 'not-allowed'};background:${v.catDirty ? 'var(--accent)' : '#fff'};color:${v.catDirty ? '#fff' : 'var(--muted)'};">${v.catSaving ? 'Enregistrement…' : (v.catDirty ? 'Enregistrer la table' : '✓ Enregistrée')}</button>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 14px;border-radius:12px;background:#fff;border:1px solid var(--line);" data-catalog-source=${v.catImp.tone}>
        <span style="width:8px;height:8px;border-radius:999px;flex:0 0 auto;background:${v.catImp.tone === 'ok' ? 'var(--green)' : v.catImp.tone === 'bad' ? 'var(--accent)' : v.catImp.tone === 'warn' ? 'var(--warn)' : 'var(--faint)'};"></span>
        <div style="flex:1 1 360px;min-width:0;font-size:12.5px;line-height:1.5;color:var(--muted-2);">
          <strong style="font-weight:500;color:var(--ink);">${v.t('catimp.title')} · ${v.catImp.head}</strong> — ${v.catImp.text}
          ${v.catImp.notes.map((n) => html`<div style="font-size:11.5px;color:var(--muted);">${n}</div>`)}
          ${v.catImp.configured && html`<div style="font-size:11.5px;color:var(--muted);">${v.t('catimp.auto')}</div>`}
        </div>
        <button onClick=${v.catImp.run} disabled=${v.catImp.busy || !v.catImp.configured} title=${v.catImp.configured ? '' : v.t('catimp.off')} style="flex:0 0 auto;padding:8px 14px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:${v.catImp.configured ? 'var(--ink)' : 'var(--faint)'};cursor:${v.catImp.busy ? 'progress' : (v.catImp.configured ? 'pointer' : 'not-allowed')};" data-catalog-import>${v.catImp.busy ? v.t('catimp.running') : v.t('catimp.run')}</button>
      </div>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start;">
        <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px;">
            <h3 style="margin:0;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Catégories</h3>
            <button onClick=${v.addProdCat} style="padding:6px 12px;font-size:12px;font-weight:500;color:#fff;background:var(--accent);border:none;border-radius:8px;cursor:pointer;">＋</button>
          </div>
          ${v.prodCats.map((c) => html`
            <div onClick=${c.pick} style=${c.cardStyle}>
              <input value=${c.name} onInput=${c.onName} onClick=${(e) => e.stopPropagation()} placeholder=${c.namePlaceholder} style="flex:1 1 auto;min-width:0;padding:7px 9px;font-size:13.5px;font-weight:500;border:1px solid ${c.on ? 'rgba(141,29,44,0.3)' : 'transparent'};border-radius:8px;background:${c.on ? '#fff' : 'transparent'};${v.isBaseLang ? '' : 'border-color:rgba(184,134,11,0.5);'}" />
              <span style="flex:0 0 auto;font-size:11px;color:var(--muted);">${c.count}${c.usedBy ? ' · ⛓' + c.usedBy : ''}</span>
              <button onClick=${c.toggleActive} title="Active / inactive" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;flex:0 0 auto;border:1px solid var(--line);cursor:pointer;background:${c.active ? 'rgba(63,122,82,0.12)' : 'rgba(35,34,32,0.06)'};color:${c.active ? '#2E6E4E' : '#8A847C'};font-size:12px;">${c.active ? '✓' : '⃠'}</button>
              <button onClick=${c.del} title="Supprimer la catégorie" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;flex:0 0 auto;border:1px solid var(--line);cursor:pointer;background:rgba(255,255,255,0.7);color:var(--accent);font-size:12px;">${icon(ICON.trash, 14)}</button>
            </div>
            ${c.on && v.isBaseLang && html`
              <div onClick=${(e) => e.stopPropagation()} style="display:flex;align-items:center;gap:8px;margin:-4px 0 4px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.55);border:1px solid var(--line);">
                ${c.imgOk
                  ? html`<img src=${c.img} alt="" loading="lazy" style="width:30px;height:30px;border-radius:8px;object-fit:contain;flex:0 0 auto;border:1px solid var(--line);background:#fff;" />`
                  : html`<span title="Aucune illustration" style="width:30px;height:30px;border-radius:8px;flex:0 0 auto;border:1px dashed rgba(35,34,32,0.22);background:var(--chip);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--faint);">${icon(ICON.image, 16)}</span>`}
                <div style="flex:1 1 auto;min-width:0;">
                  <div style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Illustration de la catégorie</div>
                  <input value=${c.img} onInput=${c.onImg} placeholder="assets/… ou URL" spellcheck="false" title="Une catégorie porte une illustration ; un produit porte une photo." style="width:100%;box-sizing:border-box;padding:6px 9px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </div>
              </div>
            `}
          `)}
          ${!v.prodCats.length && html`<div style="font-size:12px;color:var(--muted);padding:8px;">Aucune catégorie — clique ＋ pour commencer.</div>`}
        </div>

        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;min-width:0;overflow-x:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.prodSelCat ? `Produits · ${v.prodSelCat.name}` : 'Produits'}</h3>
            <button onClick=${v.addProd} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Ajouter un produit</button>
          </div>
          <div style="overflow-x:auto;">
            <div style="display:grid;grid-template-columns:52px minmax(190px,1.4fr) 150px 110px ${v.storeCols.map(() => '110px').join(' ')} 90px 130px;gap:8px;align-items:center;min-width:${700 + v.storeCols.length * 118}px;">
              <span></span>
              <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Produit</span>
              <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Visuel</span>
              <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);text-align:right;">Prix défaut</span>
              ${v.storeCols.map((sc) => html`<span title=${sc.label} style="font-size:8.5px;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:var(--muted);text-align:right;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">${sc.label}</span>`)}
              <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);text-align:center;" title="✓ Actif = présent au catalogue · ⦸ Rupture = temporairement indisponible, masqué des boucles continues">État</span>
              <span></span>
              ${v.prodRows.map((p) => html`
                <div style="display:flex;align-items:center;">${p.thumb}</div>
                <input value=${p.name} onInput=${p.onName} placeholder=${p.namePlaceholder} style="padding:9px 11px;font-size:13.5px;font-weight:500;border:1px solid ${v.isBaseLang ? 'rgba(35,34,32,0.14)' : 'rgba(184,134,11,0.55)'};border-radius:8px;background:${p.active ? '#fff' : 'rgba(35,34,32,0.04)'};opacity:${p.active ? 1 : 0.6};min-width:0;" />
                <div style="display:flex;align-items:center;gap:5px;min-width:0;">
                  <select value=${p.isPhoto ? '' : p.img} onChange=${p.onImg} style="flex:1 1 auto;min-width:0;padding:8px 6px;font-size:11.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
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
                  <label title="Importer une photo" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;flex:0 0 auto;border:1px dashed rgba(35,34,32,0.3);background:var(--paper);cursor:pointer;font-size:13px;">${icon(ICON.upload, 14)}<input type="file" accept="image/*" onChange=${p.onPhoto} style="display:none;" /></label>
                </div>
                <input value=${p.price} onInput=${p.onPrice} inputmode="decimal" style="padding:9px 10px;font-size:13.5px;font-weight:500;text-align:right;color:var(--accent);border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0;" />
                ${p.storePrices.map((sp) => html`
                  <input value=${sp.value} onInput=${sp.onInput} placeholder="défaut" inputmode="decimal" style="padding:9px 10px;font-size:13px;text-align:right;color:${sp.value ? '#8D1D2C' : '#B8B2A8'};font-weight:${sp.value ? 600 : 400};border:1px solid var(--line);border-radius:8px;background:${sp.value ? 'rgba(141,29,44,0.05)' : '#fff'};min-width:0;" />
                `)}
                <div style="display:flex;justify-content:center;gap:5px;">
                  <button onClick=${p.toggleActive} title="Actif / inactif (masqué partout à l'écran)" style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);cursor:pointer;background:${p.active ? 'rgba(63,122,82,0.12)' : 'rgba(141,29,44,0.08)'};color:${p.active ? '#2E6E4E' : '#8D1D2C'};font-size:13px;">${p.active ? '✓' : '⃠'}</button>
                  <button onClick=${p.toggleUnavailable} title="En rupture / indisponible — masqué des boucles continues (mode Continu) et signalé. Réactive quand le produit revient." style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;cursor:pointer;border:1px solid ${p.unavailable ? 'rgba(141,29,44,0.4)' : 'rgba(35,34,32,0.12)'};background:${p.unavailable ? 'rgba(141,29,44,0.14)' : '#fff'};color:${p.unavailable ? '#8D1D2C' : '#C9C3B8'};font-size:14px;">⦸</button>
                </div>
                <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">
                  <button onClick=${p.showAppearance} title="Régie → Apparition… — où et quand ce produit passe à l'écran (c'est ce que lit la fiche produit de l'ERP)" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:12px;border:1px solid ${p.appearanceOpen ? 'rgba(141,29,44,0.4)' : 'rgba(35,34,32,0.12)'};background:${p.appearanceOpen ? 'rgba(141,29,44,0.10)' : '#fff'};color:${p.appearanceOpen ? '#8D1D2C' : 'var(--muted-2)'};">👁</button>
                  <button onClick=${p.up} title="Monter" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">↑</button>
                  <button onClick=${p.down} title="Descendre" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">↓</button>
                  <button onClick=${p.del} title="Supprimer" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;color:var(--accent);">✕</button>
                </div>
              `)}
            </div>
          </div>
          ${!v.prodRows.length && html`<div style="font-size:12.5px;color:var(--muted);padding:14px 4px 4px;">Aucun produit dans cette catégorie — « + Ajouter un produit ».</div>`}
          <!-- Régie → Apparition… : le résumé lu par la fiche produit de l'ERP -->
          ${v.appearance && html`
            <div style="margin-top:16px;border:1px solid rgba(141,29,44,0.22);border-radius:12px;padding:16px 18px;background:#FFFFFF;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:7px;">
                  <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Régie → Apparition… · ${v.appearance.produit.nom}</h3>
                  ${infoTip('Tout ce que la régie sait du passage de ce produit à l’écran. Les tags se règlent ICI (Périodes, secteurs, campagnes) ; la fiche produit de l’ERP lit ce même résumé, en lecture seule.')}
                </div>
                <span style="font-size:12px;font-weight:500;color:${v.appearance.maintenant.visible ? '#2E6E4E' : '#8D1D2C'};">${v.appearance.maintenant.visible ? '● À l\'écran maintenant' : '○ Pas à l\'écran'} · ${v.appearance.maintenant.label}${v.appearance.maintenant.raison ? ` — ${v.appearance.maintenant.raison}` : ''}</span>
              </div>
              <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:12.5px;">
                <div style="flex:1 1 260px;min-width:0;">
                  <div style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Périodes de la journée</div>
                  ${v.appearance.periodes.map((m) => html`
                    <div key=${m.id} style="display:flex;align-items:center;gap:8px;padding:3px 0;">
                      <span style="width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:${m.visible ? '#2E6E4E' : '#8D1D2C'};"></span>
                      <span style="width:82px;flex:0 0 auto;font-weight:500;">${m.label}</span>
                      <span style="color:var(--muted);">produit : ${m.produit} · catégorie : ${m.categorie}</span>
                    </div>
                  `)}
                </div>
                <div style="flex:1 1 240px;min-width:0;">
                  <div style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Secteurs d'écrans</div>
                  ${v.appearance.secteurs.length ? v.appearance.secteurs.map((s) => html`
                    <div key=${s.sectorId} style="padding:3px 0;color:${s.montre ? '#232220' : '#8A847C'};">
                      ${s.montre ? '✓' : '○'} ${s.store} · ${s.sector}
                      <span style="color:var(--muted);">${s.filtrePeriodes ? ' · filtre les périodes' : ''}${s.filtreCategories ? ' · filtre les catégories' : ''}</span>
                    </div>
                  `) : html`<span style="color:var(--muted);">Aucun secteur — les écrans suivent le film du magasin.</span>`}
                </div>
                <div style="flex:1 1 220px;min-width:0;">
                  <div style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Saisons · campagnes · éléments</div>
                  <div style="padding:3px 0;">${v.appearance.saisons.length ? v.appearance.saisons.map((s) => s.nom).join(' · ') : html`<span style="color:var(--muted);">aucune période active</span>`}</div>
                  <div style="padding:3px 0;">${v.appearance.campagnes.length ? v.appearance.campagnes.map((c) => `${c.nom}${c.dansSaPeriode ? '' : ' (hors créneau)'}`).join(' · ') : html`<span style="color:var(--muted);">aucune campagne</span>`}</div>
                  <div style="padding:3px 0;">${v.appearance.elements.length ? `${v.appearance.elements.length} élément(s) de bibliothèque` : html`<span style="color:var(--muted);">aucun élément ne le montre</span>`}</div>
                </div>
              </div>
            </div>
          `}
          <p style="margin:14px 0 0;font-size:11.5px;color:var(--muted);">Prix par magasin : laisse vide pour utiliser le prix par défaut. Langues : FR = noms de base ; dans une autre langue, le champ nom édite la traduction (vide = nom de base). Chaque magasin affiche automatiquement ses prix ET sa langue (réglée dans Réseau). État : ✓ actif · <strong style="color:var(--accent);">⦸ rupture</strong> = temporairement indisponible, retiré des boucles en mode Continu (le reste du catalogue continue).</p>
        </div>
      </div>
    </div>
  </div>
  `}

  ${v.isSeasonsView && html`
  <div class="app__body">
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;max-width:760px;">${v.t('seasons.subtitle')} <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">ws_season</code></p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input value=${v.wsTable} onInput=${v.onWsTable} placeholder="table (déf. ws_season)" spellcheck="false" title="Nom de la table MySQL des périodes, si différent de ws_season" style="width:170px;padding:9px 11px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:999px;background:#fff;" />
          <button onClick=${v.diagSeasons} disabled=${v.seasonsBusy} title="Lecture seule : liste les colonnes réelles de ws_season et détecte une éventuelle colonne d'illustration" style="padding:9px 14px;font-size:12.5px;font-weight:500;color:var(--muted-2);background:#fff;border:1px solid rgba(35,34,32,0.2);border-radius:8px;cursor:${v.seasonsBusy ? 'wait' : 'pointer'};">${v.t('seasons.diagnostic')}</button>
          <button onClick=${v.importSeasons} disabled=${v.seasonsBusy} style="padding:9px 15px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:${v.seasonsBusy ? 'wait' : 'pointer'};">${v.t('seasons.import')}</button>
          <button onClick=${v.saveSeasons} disabled=${!v.seasonsDirty || v.seasonsBusy} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid ${v.seasonsDirty ? 'var(--accent)' : 'var(--line)'};cursor:${v.seasonsDirty && !v.seasonsBusy ? 'pointer' : 'not-allowed'};background:${v.seasonsDirty ? 'var(--accent)' : '#fff'};color:${v.seasonsDirty ? '#fff' : 'var(--muted)'};">${v.seasonsBusy ? v.t('common.saving') : (v.seasonsDirty ? v.t('common.save') : v.t('common.saved'))}</button>
        </div>
      </div>
      ${v.wsCandidates.length ? html`
        <div style="background:rgba(201,123,74,0.08);border:1px solid rgba(201,123,74,0.3);border-radius:12px;padding:12px 16px;font-size:12.5px;color:var(--muted-2);">
          Aucune table de périodes exploitée. Tables candidates — clique l'une d'elles (elle remplit le champ) puis « Importer » :
          <span style="display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:6px;">
            ${v.wsCandidates.map((t) => html`<button onClick=${() => v.useWsCandidate(t)} style="font-family:ui-monospace,monospace;font-size:12px;font-weight:500;color:var(--muted-2);background:#fff;border:1px solid var(--line);border-radius:8px;padding:3px 10px;cursor:pointer;">${t}</button>`)}
          </span>
        </div>
      ` : ''}
      ${v.wsInspected.length ? html`
        <div style="background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:12px;color:var(--muted-2);line-height:1.6;">
          <strong>Colonnes vues</strong> (il faut 2 colonnes de dates du → au + un nom) :
          ${v.wsInspected.map((ins) => html`
            <div style="margin-top:6px;"><code style="font-weight:500;color:var(--muted-2);">${ins.table}</code> → <span style="font-family:ui-monospace,monospace;">${(ins.types || ins.columns).join(', ')}</span></div>
            ${ins.sample && ins.sample.length ? html`<div style="margin-top:2px;color:var(--muted);font-family:ui-monospace,monospace;font-size:11px;">ex. : ${ins.sample.join(' | ')}</div>` : ''}
          `)}
          <div style="margin-top:6px;color:var(--muted);">Si les dates sont dans ces colonnes mais non détectées, dis-moi lesquelles (du/au) et je les câble.</div>
        </div>
      ` : ''}
      ${v.wsDiag ? html`
        <div style="background:${v.wsDiag.imageFound ? 'rgba(63,122,82,0.06)' : '#fff'};border:1px solid ${v.wsDiag.imageFound ? 'rgba(63,122,82,0.3)' : 'rgba(35,34,32,0.12)'};border-radius:12px;padding:12px 16px;font-size:12px;color:var(--muted-2);line-height:1.6;">
          <div style="font-weight:500;color:${v.wsDiag.imageFound ? '#2E6E4E' : '#8D1D2C'};">
            ${v.wsDiag.imageFound
              ? html`🖼 Colonne d'illustration détectée : ${v.wsDiag.imageCols.map((c) => html`<code style="background:var(--chip);padding:1px 5px;border-radius:4px;">${c.column}</code> dans <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">${c.table}</code>${c.sample ? html` · ex. « ${c.sample} »` : ''} `)}`
              : (v.wsDiag.ok ? html`🔍 Aucune colonne d'illustration détectée dans les tables de périodes vues.` : html`⚠ ${v.wsDiag.error || 'Base non lisible'}`)}
          </div>
          ${(v.wsDiag.inspected || []).map((ins) => html`
            <div style="margin-top:8px;"><code style="font-weight:500;color:var(--muted-2);">${ins.table}</code> → <span style="font-family:ui-monospace,monospace;">${(ins.types || ins.columns).join(', ')}</span></div>
            ${ins.sample && ins.sample.length ? html`<div style="margin-top:2px;color:var(--muted);font-family:ui-monospace,monospace;font-size:11px;">ex. : ${ins.sample.join(' | ')}</div>` : ''}
          `)}
          <div style="margin-top:8px;color:var(--muted);">${v.wsDiag.imageFound ? html`L'import récupère automatiquement cette colonne. Clique « ⟳ Importer » pour (re)charger les périodes avec leur illustration.` : html`Diagnostic lecture seule — rien n'a été modifié. Si une colonne image existe sous un autre nom, dis-le-moi et je l'ajoute au détecteur.`}</div>
        </div>
      ` : ''}

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.seasonsCount} période(s) · ${v.seasonsCurrentCount} active(s) aujourd'hui</h3>
          <button onClick=${v.addSeason} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Ajouter une période</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${v.seasonRows.map((s) => html`
            <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:${s.current ? 'rgba(63,122,82,0.05)' : '#fff'};">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${s.imageOk
                  ? html`<img src=${s.image} alt="" loading="lazy" title="Illustration de la période" style="width:28px;height:28px;border-radius:8px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line);background:${s.color};" />`
                  : html`<span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex:0 0 auto;"></span>`}
                <input value=${s.name} onInput=${s.onName} placeholder="Nom (ex. Galette des rois)" style="flex:1 1 200px;min-width:0;padding:9px 11px;font-size:14px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <span style="display:flex;align-items:center;gap:5px;">
                  <input value=${s.from} onInput=${s.onFrom} placeholder="du (JJ/MM)" style="width:110px;padding:9px 10px;font-size:12.5px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                  <span style="color:var(--muted);">→</span>
                  <input value=${s.to} onInput=${s.onTo} placeholder="au (JJ/MM)" style="width:110px;padding:9px 10px;font-size:12.5px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </span>
                ${s.current ? html`<span style="font-size:10.5px;font-weight:500;color:var(--green);background:rgba(63,122,82,0.12);border:1px solid rgba(63,122,82,0.35);border-radius:999px;padding:3px 9px;">● active aujourd'hui</span>` : ''}
                <button onClick=${s.del} title="Supprimer" style="flex:0 0 auto;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px;color:var(--accent);">✕</button>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-left:20px;">
                ${s.imageOk
                  ? html`<img src=${s.image} alt="Aperçu de l'illustration" loading="lazy" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line);background:#fff;" />`
                  : html`<span title=${s.image ? 'Valeur non affichable ici' : 'Aucune illustration'} style="width:48px;height:48px;border-radius:8px;flex:0 0 auto;border:1px dashed rgba(35,34,32,0.22);background:var(--chip);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--faint);">${icon(ICON.image, 16)}</span>`}
                <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 240px;min-width:0;">
                  <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Illustration</span>
                  <input value=${s.image} onInput=${s.onImage} placeholder="URL/lien direct de l'image (auto-rempli si la table importée a une colonne image)" spellcheck="false" title="Lien direct de l'illustration de la période. Rempli automatiquement à l'import si la table (ex. product_availability_period) expose une colonne image ; sinon colle une URL ici." style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </div>
                ${s.image && !s.imageOk ? html`<span title="Valeur non affichable directement (id ou nom de fichier sans chemin) — indique-moi le format et je résous l'URL." style="font-size:11px;color:var(--accent);background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;padding:2px 9px;flex:0 0 auto;">⚠ non affichable</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-left:20px;">
                <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Produits liés :</span>
                ${s.products.map((p) => html`<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--accent);background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);border-radius:999px;padding:3px 5px 3px 10px;">${p.name}<button onClick=${p.remove} style="width:16px;height:16px;border-radius:50%;border:none;background:rgba(141,29,44,0.15);color:var(--accent);cursor:pointer;font-size:10px;line-height:1;">✕</button></span>`)}
                ${s.addable.length ? html`
                  <select onChange=${s.onAddProduct} style="padding:6px 9px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                    <option value="">+ produit…</option>
                    ${s.addable.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                  </select>
                ` : ''}
              </div>
            </div>
          `)}
          ${!v.seasonRows.length && html`<p style="margin:0;font-size:12.5px;color:var(--muted);padding:8px 0;">Aucune période. « + Ajouter une période » ou « ⟳ Importer depuis ws_season ».</p>`}
        </div>
        <p style="margin:14px 0 0;font-size:11.5px;color:var(--muted);">Dates : <strong>JJ/MM</strong> (ex. 21/06) ou AAAA-MM-JJ ; l'année est ignorée (la période revient chaque année). Une période à cheval sur le nouvel an (ex. 15/12 → 06/01) est gérée.</p>
      </div>

      <!-- Périodes de vente : produit × moment (matin / midi / après-midi) -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Périodes de vente — produit × moment de la journée</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button onClick=${v.pmAllCollapsed ? v.expandAllPm : v.collapseAllPm} style="padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.pmAllCollapsed ? '▷ Tout déplier' : '▽ Tout plier'}</button>
            <button onClick=${v.saveProdMoments} disabled=${!v.prodMomentsDirty || v.prodMomentsBusy} style="padding:8px 16px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid ${v.prodMomentsDirty ? 'var(--accent)' : 'var(--line)'};cursor:${v.prodMomentsDirty && !v.prodMomentsBusy ? 'pointer' : 'not-allowed'};background:${v.prodMomentsDirty ? 'var(--accent)' : '#fff'};color:${v.prodMomentsDirty ? '#fff' : 'var(--muted)'};">${v.prodMomentsBusy ? 'Enregistrement…' : (v.prodMomentsDirty ? 'Enregistrer' : '✓ Enregistré')}</button>
          </div>
        </div>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted);max-width:820px;">Clique une case pour cycler : <strong style="color:var(--green);">vendu</strong> → <strong style="color:var(--accent);">exception (exclu)</strong> → vide. Un produit sans aucune case cochée est vendu à tous les moments. En mode continu, la boucle ne montre que les produits vendus au moment courant${v.prodMomentsCurrent ? html` (actuellement : <strong>${v.prodMomentsCurrent}</strong>)` : ''}. La ligne d'une <strong>catégorie</strong> se tague aussi : hors créneau, elle retire <strong>tous</strong> ses produits, et les tags produits affinent à l'intérieur. Clique une catégorie pour la plier/déplier.</p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse;width:100%;min-width:420px;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:8px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);">Produit</th>
              ${v.saleMoments.map((mo) => html`<th style="padding:8px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${v.prodMomentsCurrent === mo.id ? '#8D1D2C' : '#8A847C'};border-bottom:1px solid var(--line);text-align:center;width:120px;">${mo.label}</th>`)}
            </tr></thead>
            <tbody>
              ${v.prodMomentCats.map((cat) => html`
                <tr>
                  <td style="padding:0;">
                    <button onClick=${cat.toggle} style="width:100%;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:9px 10px;background:var(--chip);border:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line);cursor:pointer;text-align:left;">
                      <span style="flex:0 0 auto;font-size:10px;color:var(--accent);display:inline-block;transform:rotate(${cat.collapsed ? '0' : '90'}deg);">▶</span>
                      <span style="flex:1 1 auto;font-size:12.5px;font-weight:500;color:var(--muted-2);">${cat.name}</span>
                      <span style="flex:0 0 auto;font-size:11px;color:var(--muted);">${cat.count} produit(s)</span>
                    </button>
                  </td>
                  ${cat.cells.map((c) => html`<td style="padding:5px 10px;text-align:center;background:var(--chip);border-top:1px solid var(--line);border-bottom:1px solid var(--line);">
                    ${cat.taggable ? html`<button onClick=${c.toggle} title="Période de vente de la CATÉGORIE — hors créneau, elle retire tous ses produits" style="width:34px;height:26px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;border:1px solid ${c.state === 'incl' ? 'rgba(63,122,82,0.45)' : (c.state === 'excl' ? 'rgba(141,29,44,0.45)' : 'rgba(35,34,32,0.16)')};background:${c.state === 'incl' ? 'rgba(63,122,82,0.18)' : (c.state === 'excl' ? 'rgba(141,29,44,0.16)' : '#fff')};color:${c.state === 'incl' ? '#2E6E4E' : (c.state === 'excl' ? '#8D1D2C' : '#C9C3B8')};">${c.state === 'incl' ? '✓' : (c.state === 'excl' ? '✕' : '·')}</button>` : ''}
                  </td>`)}
                </tr>
                ${cat.collapsed ? '' : cat.products.map((p) => html`
                  <tr>
                    <td style="padding:7px 10px 7px 26px;border-bottom:1px solid var(--line);white-space:nowrap;${p.active ? '' : 'color:var(--faint);'}">${p.name}${p.active ? '' : ' · inactif'}</td>
                    ${p.cells.map((c) => html`<td style="padding:5px 10px;border-bottom:1px solid var(--line);text-align:center;">
                      <button onClick=${c.toggle} title="Cliquer pour changer" style="width:34px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;border:1px solid ${c.state === 'incl' ? 'rgba(63,122,82,0.4)' : (c.state === 'excl' ? 'rgba(141,29,44,0.4)' : 'rgba(35,34,32,0.14)')};background:${c.state === 'incl' ? 'rgba(63,122,82,0.14)' : (c.state === 'excl' ? 'rgba(141,29,44,0.12)' : '#fff')};color:${c.state === 'incl' ? '#2E6E4E' : (c.state === 'excl' ? '#8D1D2C' : '#C9C3B8')};">${c.state === 'incl' ? '✓' : (c.state === 'excl' ? '✕' : '·')}</button>
                    </td>`)}
                  </tr>
                `)}
              `)}
              ${!v.prodMomentCats.length ? html`<tr><td colspan="4" style="padding:12px 10px;color:var(--muted);font-size:12.5px;">Aucun produit dans le catalogue. Importe le catalogue dans l'onglet Produits.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Médiathèque : elle a son écran dans le menu (Contenus) -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;color:var(--muted-2);line-height:1.5;">${v.t('media.pointer')} <span style="color:var(--muted);">${v.t('media.count', { n: v.mediaOverview.total })} · ${v.mediaOverview.videos} ${v.t('media.videos').toLowerCase()} · ${v.mediaOverview.photos} ${v.t('media.photos').toLowerCase()}</span></div>
        <button class="btn btn--sm" onClick=${v.openMediaView}>${v.t('media.open')}</button>
      </div>
    </div>
  </div>
  `}

  ${v.isMediaView && html`
  <div class="app__body app__body--wide">
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;max-width:820px;">${v.t('media.intro')}</p>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button class="btn" onClick=${v.mediaView.refresh}>${v.t('media.refresh')}</button>
          <a class="btn" href=${v.agencyUrl} target="_blank">${v.t('media.agency')} ${icon(ICON.external, 14)}</a>
          <button class="btn btn--primary" onClick=${v.mediaView.toggleUp}>${icon(ICON.upload, 15)}${v.t('media.upload')}</button>
        </div>
      </div>

      ${v.mediaView.up.open && html`
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;">
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);">${v.t('media.moment')}
          <select value=${v.mediaView.up.moment} onChange=${v.mediaView.upMoment} style="padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:150px;">
            ${v.mediaView.momentOpts.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);">${v.t('media.product')}
          <select value=${v.mediaView.up.productId} onChange=${v.mediaView.upProduct} style="padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:200px;max-width:280px;">
            <option value="">${v.t('media.noProduct')}</option>
            ${v.mediaView.products.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);">${v.t('media.season')}
          <select value=${v.mediaView.up.seasonId} onChange=${v.mediaView.upSeason} style="padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:180px;">
            <option value="">${v.t('media.noSeason')}</option>
            ${v.mediaView.seasons.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
          </select>
        </label>
        <label class=${'btn btn--primary' + (v.mediaView.up.busy ? ' is-busy' : '')} style="cursor:pointer;">
          ${icon(ICON.upload, 15)}${v.mediaView.up.busy ? `${v.t('media.sending')} ${v.mediaView.up.pct || 0} %` : v.t('media.file')}
          <input type="file" accept="video/mp4,video/webm,video/quicktime,image/*" onChange=${v.mediaView.upFile} disabled=${v.mediaView.up.busy} style="display:none;" />
        </label>
        <p style="margin:0;flex:1 1 100%;font-size:12px;color:var(--muted);" data-media-where>${v.store.ovh ? v.t('media.whereOvh', { mb: v.store.maxMb }) : v.t('media.whereLocal', { mb: v.store.maxMb })}</p>
      </div>`}

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${v.mediaView.kinds.map((k) => html`<button key=${k.id} onClick=${k.pick} style=${`padding:6px 13px;font-size:12.5px;border-radius:8px;cursor:pointer;${k.on ? 'background:var(--accent);border:1px solid var(--accent);color:#fff;' : 'background:#fff;border:1px solid var(--line);color:var(--muted-2);'}`}>${k.label}</button>`)}
        <span class="topbar__sep"></span>
        ${v.mediaView.moments.map((k) => html`<button key=${k.id} onClick=${k.pick} style=${`padding:6px 13px;font-size:12.5px;border-radius:8px;cursor:pointer;${k.on ? 'background:var(--accent);border:1px solid var(--accent);color:#fff;' : 'background:#fff;border:1px solid var(--line);color:var(--muted-2);'}`}>${k.label}</button>`)}
        <span class="topbar__sep"></span>
        <select value=${v.mediaView.filter.product} onChange=${v.mediaView.onProduct} style="padding:6px 9px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;max-width:220px;">
          <option value="">${v.t('media.anyProduct')}</option>
          ${v.mediaView.products.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
        </select>
        <select value=${v.mediaView.filter.season} onChange=${v.mediaView.onSeason} style="padding:6px 9px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;max-width:200px;">
          <option value="">${v.t('media.anySeason')}</option>
          ${v.mediaView.seasons.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
        </select>
        <input value=${v.mediaView.filter.q} onInput=${v.mediaView.onSearch} placeholder=${v.t('media.search')} style="flex:1 1 180px;min-width:150px;padding:7px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
        <span style="font-size:12px;color:var(--muted);">${v.t('media.count', { n: v.mediaView.cards.length })}${v.mediaView.cards.length !== v.mediaView.total ? ` / ${v.mediaView.total}` : ''}</span>
      </div>

      ${v.mediaView.cards.length ? html`
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;">
        ${v.mediaView.cards.map((c) => html`
          <div key=${c.id} data-media-card style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;">
            <div style="position:relative;aspect-ratio:16/9;background:var(--chip);display:flex;align-items:center;justify-content:center;overflow:hidden;">
              ${!c.present ? html`<span style="font-size:12px;color:var(--accent);">${v.t('media.missing')}</span>`
                : (c.kind === 'photo' ? html`<img src=${c.url} alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;" />`
                  : html`<video src=${c.url} muted playsinline preload="metadata" controls style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#000;"></video>`)}
            </div>
            <div style="padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px;flex:1 1 auto;">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                <div style="min-width:0;">
                  <div title=${c.filename} style="font-size:13px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.filename}</div>
                  <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">${c.kind === 'photo' ? v.t('media.photos') : v.t('media.videos')} · ${c.meta}</div>
                </div>
                <button class="btn btn--icon btn--sm" onClick=${c.del} title="Supprimer du serveur" aria-label="Supprimer du serveur" style="width:30px;color:var(--muted-2);">${icon(ICON.trash, 14)}</button>
              </div>
              ${c.editing ? html`
                <div style="display:flex;flex-direction:column;gap:7px;">
                  <select value=${c.moment} onChange=${c.setMoment} style="padding:6px 9px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;">
                    ${v.mediaView.momentOpts.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                  </select>
                  <select value=${c.productId} onChange=${c.setProduct} style="padding:6px 9px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;">
                    <option value="">${v.t('media.noProduct')}</option>
                    ${v.mediaView.products.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                  </select>
                  <select value=${c.seasonId} onChange=${c.setSeason} style="padding:6px 9px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;">
                    <option value="">${v.t('media.noSeason')}</option>
                    ${v.mediaView.seasons.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                  </select>
                  <button class="btn btn--sm" onClick=${c.toggleEdit} style="align-self:flex-start;">${v.t('media.done')}</button>
                </div>` : html`
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-size:11.5px;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:3px 10px;">${metaIcon(ICON.clock)}${c.momentLabel}</span>
                  ${c.productName && html`<span style="font-size:11.5px;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:3px 10px;">${metaIcon(ICON.products)}${c.productName}</span>`}
                  ${c.seasonName && html`<span style="font-size:11.5px;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:3px 10px;">${metaIcon(ICON.calendar)}${c.seasonName}</span>`}
                  <button class="btn btn--ghost btn--sm" onClick=${c.toggleEdit} style="margin-left:auto;">${v.t('media.editTags')}</button>
                </div>`}
            </div>
          </div>
        `)}
      </div>` : html`
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:28px 22px;text-align:center;font-size:13px;color:var(--muted);">
        ${v.mediaView.total ? v.t('media.noMatch') : v.t('media.empty')}
      </div>`}
    </div>
  </div>
  `}

  ${v.isPromotionsView && html`
  <div class="app__body">
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;max-width:820px;">${v.t('promo.subtitle')}</p>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;" data-bundles data-tfb>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="min-width:0;flex:1 1 320px;">
            <h3 style="margin:0 0 4px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('tfb.title', { n: v.tfbTotal })}</h3>
          </div>
          <button onClick=${v.syncBundles} disabled=${v.bundleBusy || v.bundleState === 'off'} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--accent);cursor:${v.bundleBusy || v.bundleState === 'off' ? 'not-allowed' : 'pointer'};background:${v.bundleState === 'off' ? 'rgba(35,34,32,0.08)' : '#8D1D2C'};color:${v.bundleState === 'off' ? '#8A847C' : '#fff'};">${v.bundleBusy ? v.t('bundles.syncing') : v.t('bundles.sync')}</button>
        </div>
        <div style="padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5;margin-bottom:12px;background:${v.bundleState === 'ok' ? 'rgba(63,122,82,0.08)' : (v.bundleState === 'error' ? 'rgba(141,29,44,0.07)' : 'rgba(35,34,32,0.05)')};color:${v.bundleState === 'ok' ? '#2E6E4E' : (v.bundleState === 'error' ? '#8D1D2C' : '#6E675E')};" data-bundle-status=${v.bundleState}>
          ${v.bundleState === 'ok' ? '● ' : (v.bundleState === 'error' ? '⚠ ' : '○ ')}${v.bundleStatusText}
          ${v.bundleWarnings.map((w) => html`<div style="color:var(--muted-2);margin-top:3px;">⚠ ${w}</div>`)}
          ${v.tfbKindLines.map((l) => html`<div style="margin-top:3px;color:${l.ok ? '#4A4640' : '#8D1D2C'};">${l.ok ? '' : '⚠ '}${l.text}</div>`)}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${v.tfbFilters.map((f) => html`<button onClick=${f.pick} data-tfb-filter=${f.id} style="padding:6px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${f.active ? 'var(--accent)' : 'var(--line)'};background:${f.active ? 'var(--accent)' : '#fff'};color:${f.active ? '#fff' : 'var(--muted-2)'};">${f.label}</button>`)}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${v.tfbShowBundles && v.bundleRows.map((b) => html`
            <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:${b.active ? '#fff' : 'rgba(35,34,32,0.03)'};opacity:${b.active ? 1 : 0.75};" data-bundle=${b.id}>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${badgePill(b.badge)}
                <strong style="font-size:14px;color:var(--ink);flex:1 1 200px;min-width:0;overflow-wrap:anywhere;">${b.name}</strong>
                <span style="padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:500;letter-spacing:0.06em;color:#fff;background:${b.active ? '#2E6E4E' : (b.status === 'DRAFT' ? '#B8860B' : '#8A847C')};">${b.status}</span>
                ${b.voucher && html`<span style="padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:500;color:var(--muted-2);background:rgba(201,123,74,0.15);">${v.t('bundles.voucher')}</span>`}
                <span style="font-size:16px;font-weight:500;color:var(--accent);white-space:nowrap;">${b.price}</span>
                ${b.worth && html`<span style="font-size:12px;color:var(--muted);text-decoration:line-through;white-space:nowrap;">${b.worth}</span>`}
              </div>
              ${b.descr && html`<div style="margin-top:4px;font-size:12px;color:var(--muted-2);">${b.descr}</div>`}
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;">
                ${b.comp.map((c) => html`<span title=${c.missing ? v.t('bundles.missingProduct') : ''} style="padding:4px 10px;border-radius:999px;font-size:12px;background:${c.missing ? 'rgba(141,29,44,0.07)' : '#fff'};border:1px solid ${c.missing ? 'rgba(141,29,44,0.3)' : 'rgba(35,34,32,0.12)'};color:${c.missing ? '#8D1D2C' : '#232220'};">${c.label}${c.missing ? ' ?' : ''}</span>`)}
              </div>
              <div style="margin-top:8px;font-size:12px;color:var(--muted-2);line-height:1.6;">
                <div>${metaIcon(ICON.clock)}${b.when}${b.dates ? html` · ${metaIcon(ICON.calendar)}${b.dates}` : ''}</div>
                <div>${metaIcon(ICON.store)}${b.shops}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <input value=${b.img} onChange=${b.onImg} placeholder=${v.t('bundles.imgPlaceholder')} style="flex:1 1 260px;min-width:0;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--muted-2);" />
                <span style="font-size:11px;color:${b.used ? 'var(--muted-2)' : '#B8B2A8'};">${b.used ? v.t('common.usedBy', { n: b.used }) : v.t('common.unused')}</span>
                <button onClick=${b.create} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('bundles.create')}</button>
              </div>
            </div>
          `)}
          ${v.tfbPromoRows.map((p) => html`
            <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:${p.active ? '#fff' : 'rgba(35,34,32,0.03)'};opacity:${p.active ? 1 : 0.75};" data-tfb-promo=${p.id}>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${badgePill(p.badge)}
                <strong style="font-size:14px;color:var(--ink);flex:1 1 200px;min-width:0;overflow-wrap:anywhere;">${p.name}</strong>
                <span style="padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:500;color:var(--muted-2);background:rgba(35,34,32,0.07);">${p.kindLabel}</span>
                <span style="padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:500;letter-spacing:0.06em;color:#fff;background:${p.active ? '#2E6E4E' : (p.status === 'DRAFT' ? '#B8860B' : '#8A847C')};">${p.status}</span>
                ${p.voucherOnly && html`<span style="padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:500;color:var(--muted-2);background:rgba(201,123,74,0.15);">${v.t('bundles.voucher')}</span>`}
                <span style="font-size:15px;font-weight:500;color:var(--accent);white-space:nowrap;" data-tfb-label>${p.label}</span>
              </div>
              ${p.descr && html`<div style="margin-top:4px;font-size:12px;color:var(--muted-2);">${p.descr}</div>`}
              ${p.targets.length > 0 && html`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;">
                ${p.targets.map((c) => html`<span title=${c.missing ? v.t('bundles.missingProduct') : ''} style="padding:4px 10px;border-radius:999px;font-size:12px;background:${c.missing ? 'rgba(141,29,44,0.07)' : '#fff'};border:1px solid ${c.missing ? 'rgba(141,29,44,0.3)' : 'rgba(35,34,32,0.12)'};color:${c.missing ? '#8D1D2C' : '#232220'};">${c.label}${c.missing ? ' ?' : ''}</span>`)}
              </div>`}
              <div style="margin-top:8px;font-size:12px;color:var(--muted-2);line-height:1.6;">
                ${p.kind !== 'voucher' && html`<div>${metaIcon(ICON.clock)}${p.when}${p.dates ? html` · ${metaIcon(ICON.calendar)}${p.dates}` : ''}</div>`}
                ${p.kind === 'voucher' && html`<div>${metaIcon(ICON.ticket)}${p.voucher}${p.dates ? html` · ${metaIcon(ICON.calendar)}${p.dates}` : ''}</div>`}
                ${p.kind !== 'voucher' && html`<div>${metaIcon(ICON.store)}${p.shops}</div>`}
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <input value=${p.img} onChange=${p.onImg} placeholder=${v.t('bundles.imgPlaceholder')} style="flex:1 1 260px;min-width:0;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--muted-2);" />
                <span style="font-size:11px;color:${p.used ? 'var(--muted-2)' : '#B8B2A8'};">${p.used ? v.t('common.usedBy', { n: p.used }) : v.t('common.unused')}</span>
                <button onClick=${p.create} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('bundles.create')}</button>
              </div>
            </div>
          `)}
          ${!v.tfbTotal && html`<p style="margin:0;font-size:12.5px;color:var(--muted);padding:6px 0;">${v.bundleState === 'off' ? v.t('bundles.emptyOff') : v.t('tfb.empty')}</p>`}
        </div>
        <p style="margin:12px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">${v.t('tfb.footer')}</p>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;" data-tfb-badges>
        <h3 style="margin:0 0 4px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('badges.title')}</h3>
        <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;max-width:760px;">${v.t('badges.subtitle')}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
          ${v.badgeFamilies.map((f) => html`
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;" data-badge-family=${f.id}>
              <div style="flex:1 1 220px;min-width:0;">
                <div style="font-size:13.5px;font-weight:500;color:var(--ink);">${f.label}</div>
                <div style="font-size:11.5px;color:${f.missing ? 'var(--accent)' : 'var(--muted)'};">${v.t('badges.count', { n: f.count })}${f.missing ? ` · ${v.t('badges.missing')}` : ''}</div>
              </div>
              <select value=${f.cur} onChange=${f.onPick} disabled=${v.badgeBusy} aria-label=${f.label} style="flex:0 1 270px;min-width:0;padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                <option value="">${f.houseLabel}</option>
                ${v.badgeStyleOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
              </select>
              <span style="flex:0 0 190px;display:flex;justify-content:flex-end;">${badgePill(f.preview)}</span>
            </div>
          `)}
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;" data-promo-styles>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="min-width:0;flex:1 1 320px;">
            <h3 style="margin:0 0 4px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('styles.title', { n: v.promoCount })}</h3>
            <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;max-width:760px;">${v.t('styles.subtitle')}</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button onClick=${v.addPromoType} style="padding:9px 15px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('promo.addType')}</button>
            <button onClick=${v.savePromoTypes} disabled=${!v.promoDirty || v.promoBusy} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid ${v.promoDirty ? 'var(--accent)' : 'var(--line)'};cursor:${v.promoDirty && !v.promoBusy ? 'pointer' : 'not-allowed'};background:${v.promoDirty ? 'var(--accent)' : '#fff'};color:${v.promoDirty ? '#fff' : 'var(--muted)'};">${v.promoBusy ? v.t('common.saving') : (v.promoDirty ? v.t('common.save') : v.t('common.saved'))}</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${v.promoRows.map((t) => html`
            <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:${t.active ? '#fff' : 'var(--paper)'};opacity:${t.active ? 1 : 0.72};">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:7px;padding:5px 13px 5px 11px;border-radius:999px;font-size:12px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:#fff;background:${t.color};flex:0 0 auto;"><span style="font-size:15px;line-height:1;">${t.icon}</span>${t.name || 'Sans nom'}</span>
                <input value=${t.icon} onInput=${t.onIcon} maxlength="4" title="Icône (emoji)" style="width:56px;text-align:center;padding:9px 6px;font-size:16px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <input value=${t.name} onInput=${t.onName} placeholder=${v.t('styles.namePh')} style="flex:1 1 180px;min-width:0;padding:9px 11px;font-size:14px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);">${v.t('common.color')} <input type="color" value=${t.color} onInput=${t.onColor} title="Couleur du badge" style="width:34px;height:30px;padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;" /></label>
                <button onClick=${t.toggleActive} title=${t.active ? v.t('styles.on') : v.t('styles.off')} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);cursor:pointer;background:${t.active ? 'rgba(63,122,82,0.12)' : 'rgba(141,29,44,0.08)'};color:${t.active ? '#2E6E4E' : '#8D1D2C'};font-size:13px;">${t.active ? '✓' : '⃠'}</button>
                <span style="display:flex;align-items:center;gap:4px;flex:0 0 auto;">
                  <button onClick=${t.up} disabled=${t.isFirst} title="Monter" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${t.isFirst ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${t.isFirst ? 0.4 : 1};">↑</button>
                  <button onClick=${t.down} disabled=${t.isLast} title="Descendre" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${t.isLast ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${t.isLast ? 0.4 : 1};">↓</button>
                  <button onClick=${t.del} title=${v.t('styles.del')} style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px;color:var(--accent);">✕</button>
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-left:2px;">
                <input value=${t.descr} onInput=${t.onDescr} placeholder=${v.t('styles.descrPh')} style="flex:1 1 320px;min-width:0;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--muted-2);" />
                <span style="font-size:11px;color:${t.used ? 'var(--muted-2)' : '#B8B2A8'};">${t.used ? v.t('common.usedBy', { n: t.used }) : v.t('common.unused')}</span>
              </div>
              <div style="margin-top:8px;padding-left:2px;font-size:11.5px;color:${t.dresses.length ? 'var(--ink)' : 'var(--muted)'};" data-style-dresses>${t.dresses.length ? v.t('styles.dresses', { list: t.dresses.join(', ') }) : v.t('styles.manual')}</div>
              <div style="margin-top:9px;padding-left:2px;">${momentTagCells(t.moCells)}</div>
            </div>
          `)}
          ${!v.promoRows.length && html`<p style="margin:0;font-size:12.5px;color:var(--muted);padding:8px 0;">${v.t('styles.empty')}</p>`}
        </div>
        <p style="margin:14px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">${v.t('styles.footer')}</p>
      </div>
    </div>
  </div>
  `}

  ${v.isCampaignsView && html`
  <div class="app__body">
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;max-width:840px;">${v.t('campaign.subtitle')}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button onClick=${v.addCampaign} style="padding:9px 15px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('campaign.add')}</button>
          <button onClick=${v.saveCampaigns} disabled=${!v.campaignDirty || v.campaignBusy} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid ${v.campaignDirty ? 'var(--accent)' : 'var(--line)'};cursor:${v.campaignDirty && !v.campaignBusy ? 'pointer' : 'not-allowed'};background:${v.campaignDirty ? 'var(--accent)' : '#fff'};color:${v.campaignDirty ? '#fff' : 'var(--muted)'};">${v.campaignBusy ? v.t('common.saving') : (v.campaignDirty ? v.t('common.save') : v.t('common.saved'))}</button>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('campaign.count', { n: v.campaignCount })}</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${v.campaignRows.map((c) => html`
            <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:${c.active ? '#fff' : 'var(--paper)'};opacity:${c.active ? 1 : 0.72};">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${c.imageOk
                  ? html`<img src=${c.image} alt="" loading="lazy" style="width:34px;height:34px;border-radius:8px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line);" />`
                  : html`<span style="width:34px;height:34px;border-radius:8px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;background:${c.color};">${c.isGamme ? '🗂' : '📣'}</span>`}
                <input value=${c.name} onInput=${c.onName} placeholder="Nom de la campagne (ex. Rentrée gourmande)" style="flex:1 1 220px;min-width:0;padding:9px 11px;font-size:14px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <select value=${c.scope} onChange=${c.onScope} title="Portée de la campagne" style="flex:0 0 auto;padding:9px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                  <option value="produit">📣 Produit</option>
                  <option value="gamme">🗂 Gamme thématique</option>
                </select>
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);">${v.t('common.color')} <input type="color" value=${c.color} onInput=${c.onColor} title="Couleur d'accent" style="width:34px;height:30px;padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;" /></label>
                <button onClick=${c.toggleActive} title=${c.active ? 'Active — proposée dans le Compositeur' : 'Inactive — masquée du choix'} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);cursor:pointer;background:${c.active ? 'rgba(63,122,82,0.12)' : 'rgba(141,29,44,0.08)'};color:${c.active ? '#2E6E4E' : '#8D1D2C'};font-size:13px;">${c.active ? '✓' : '⃠'}</button>
                <span style="display:flex;align-items:center;gap:4px;flex:0 0 auto;">
                  <button onClick=${c.up} disabled=${c.isFirst} title="Monter" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${c.isFirst ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${c.isFirst ? 0.4 : 1};">↑</button>
                  <button onClick=${c.down} disabled=${c.isLast} title="Descendre" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:${c.isLast ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${c.isLast ? 0.4 : 1};">↓</button>
                  <button onClick=${c.del} title="Supprimer cette campagne" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px;color:var(--accent);">✕</button>
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;">
                ${c.isGamme
                  ? html`<input value=${c.theme} onInput=${c.onTheme} placeholder="Thème / gamme (ex. Viennoiseries)" style="flex:1 1 180px;min-width:0;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />`
                  : html`<select value=${c.productRef} onChange=${c.onProductRef} style="flex:1 1 180px;min-width:0;padding:8px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                      <option value="">— Produit lié (photo/prix) —</option>
                      ${v.campaignProductOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                    </select>`}
                <input value=${c.message} onInput=${c.onMessage} placeholder="Accroche (ex. La rentrée en douceur)" style="flex:1 1 200px;min-width:0;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <span style="display:flex;align-items:center;gap:4px;flex:0 0 auto;">
                  <input value=${c.dateFrom} onInput=${c.onFrom} placeholder="du (JJ/MM)" style="width:96px;padding:8px 9px;font-size:12px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                  <span style="color:var(--muted);">→</span>
                  <input value=${c.dateTo} onInput=${c.onTo} placeholder="au (JJ/MM)" style="width:96px;padding:8px 9px;font-size:12px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;">
                <input value=${c.image} onInput=${c.onImage} placeholder="URL du visuel (optionnel — sinon la photo du produit lié est utilisée)" spellcheck="false" style="flex:1 1 320px;min-width:0;padding:7px 10px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                <span style="font-size:11px;color:${c.used ? 'var(--muted-2)' : '#B8B2A8'};">${c.used ? v.t('common.usedBy', { n: c.used }) : v.t('common.unused')}</span>
              </div>
              <div style="margin-top:9px;">${momentTagCells(c.moCells)}</div>
            </div>
          `)}
          ${!v.campaignRows.length && html`<p style="margin:0;font-size:12.5px;color:var(--muted);padding:8px 0;">Aucune campagne. « + Ajouter une campagne » pour en créer une (ou importe-les depuis l'ERP plus tard).</p>`}
        </div>
        <p style="margin:14px 0 0;font-size:11.5px;color:var(--muted);">Portée <strong>produit</strong> = la campagne affiche la photo et le prix du produit lié. Portée <strong>gamme thématique</strong> = un thème libre (ex. « Viennoiseries »). Supprimer une campagne ne casse pas les éléments qui la diffusaient : ils affichent un repère neutre jusqu'à réassignation.</p>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;" data-tfb-pointer>
        <div style="min-width:0;flex:1 1 320px;">
          <h3 style="margin:0 0 4px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('tfb.pointerTitle', { n: v.tfbTotal })}</h3>
          <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">${v.t('tfb.pointerText')}</p>
        </div>
        <button onClick=${v.goBundles} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">${v.t('tfb.goPromotions')}</button>
      </div>
    </div>
  </div>
  `}

  ${v.isTranslationsView && html`
  <div class="app__body" data-translations>
    <div style="margin:0;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1 1 420px;">
          <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;max-width:840px;line-height:1.5;">${v.t('tr.subtitle')}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">${v.t('tr.lang')}
            <select value=${v.trLang} onChange=${v.onTrLang} style="padding:8px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
              ${v.trLangs.map((l) => html`<option value=${l.id}>${l.label}</option>`)}
            </select>
          </label>
          <button onClick=${v.proposeTr} disabled=${!v.trConfigured || v.trRunning || v.trBusy || !v.trMissing} data-tr-propose style="padding:9px 15px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:${!v.trConfigured || v.trRunning || v.trBusy || !v.trMissing ? 'not-allowed' : 'pointer'};opacity:${!v.trConfigured || !v.trMissing ? 0.55 : 1};">${v.trRunning ? v.trProgress : v.t('tr.propose', { n: v.trMissing })}</button>
          <button onClick=${v.validateAllTr} disabled=${!v.trProposed || v.trBusy} data-tr-validate-all style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:1px solid ${v.trProposed ? 'var(--accent)' : 'var(--line)'};cursor:${v.trProposed && !v.trBusy ? 'pointer' : 'not-allowed'};background:${v.trProposed ? 'var(--accent)' : '#fff'};color:${v.trProposed ? '#fff' : 'var(--muted)'};">${v.t('tr.validateAll', { n: v.trProposed })}</button>
        </div>
      </div>

      <div style="padding:10px 13px;border-radius:12px;font-size:12px;line-height:1.6;background:${v.trConfigured ? 'rgba(63,122,82,0.08)' : 'rgba(201,123,74,0.12)'};color:${v.trConfigured ? '#2E6E4E' : '#8A5A2B'};" data-tr-status=${v.trConfigured ? 'ok' : 'off'}>
        <div>${v.trConfigured ? v.t('tr.claudeReady', { model: v.trModel }) : v.t('tr.claudeOff')}</div>
        ${v.trRunning && html`<div>${v.trProgress}</div>`}
        ${v.trJobText && html`<div style="color:var(--muted-2);">${v.trJobText}</div>`}
        ${v.trJobErrors && html`<div style="color:var(--accent);">⚠ ${v.trJobErrors}</div>`}
        <div style="color:${v.trHasStores ? '#4A4640' : '#8A5A2B'};">${metaIcon(ICON.store)}${v.trStoresText}</div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 20px 18px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${v.trFilters.map((f) => html`<button onClick=${f.pick} data-tr-filter=${f.id} style="padding:6px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${f.active ? 'var(--accent)' : 'var(--line)'};background:${f.active ? 'var(--accent)' : '#fff'};color:${f.active ? '#fff' : 'var(--muted-2)'};">${f.label}</button>`)}
          <input value=${v.trSearch} onInput=${v.onTrSearch} placeholder=${v.t('tr.search')} style="margin-left:auto;flex:0 1 260px;min-width:160px;padding:8px 11px;font-size:12.5px;border:1px solid var(--line);border-radius:999px;background:#fff;" />
        </div>
        ${!v.trLoaded && html`<p style="margin:0;font-size:12.5px;color:var(--muted);">${v.t('app.loading')}</p>`}
        ${v.trLoaded && !v.trGroups.length && html`<p style="margin:0;padding:10px 0;font-size:12.5px;color:var(--muted);">${v.trEmpty}</p>`}
        ${v.trGroups.map((g) => html`
          <div style="margin-top:6px;" data-tr-group=${g.kind}>
            <h3 style="margin:10px 0 8px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${g.label} · ${g.n}</h3>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${g.rows.map((r) => html`
                <div data-tr-row=${r.key} data-tr-state=${r.state} style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) auto;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;border:1px solid ${r.state === 'proposed' ? 'rgba(141,29,44,0.22)' : 'rgba(35,34,32,0.08)'};background:${r.state === 'proposed' ? 'rgba(141,29,44,0.03)' : (r.state === 'validated' || r.state === 'erp' ? '#fff' : 'var(--paper)')};">
                  <div style="min-width:0;">
                    <div style="font-size:13px;color:var(--ink);font-weight:500;overflow-wrap:anywhere;">${r.source}</div>
                    <div style="font-size:11px;color:var(--muted);overflow-wrap:anywhere;">${r.label}${r.where ? ` · ${r.where}` : ''}</div>
                    ${r.before && html`<div style="font-size:11px;color:var(--warn);margin-top:2px;overflow-wrap:anywhere;">↺ ${r.before}</div>`}
                  </div>
                  <div style="min-width:0;">
                    <input value=${r.value} onInput=${r.onInput} onChange=${r.onChange} disabled=${r.state === 'erp'} placeholder=${v.trPlaceholder} style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;border:1px solid ${r.edited ? '#C97B4A' : 'rgba(35,34,32,0.14)'};border-radius:8px;background:${r.state === 'erp' ? 'rgba(35,34,32,0.04)' : '#fff'};color:var(--ink);" />
                    <div style="font-size:10.5px;margin-top:3px;color:${r.state === 'validated' || r.state === 'erp' ? '#2E6E4E' : (r.state === 'proposed' ? '#8D1D2C' : '#8A5A2B')};">${r.state === 'validated' || r.state === 'erp' ? '✓ ' : ''}${r.badge}</div>
                  </div>
                  <div style="display:flex;gap:6px;justify-content:flex-end;min-width:64px;">
                    ${r.state === 'proposed' && html`
                      <button onClick=${r.validate} title=${v.t('tr.validate')} data-tr-validate style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(63,122,82,0.35);background:rgba(63,122,82,0.10);color:var(--green);cursor:pointer;font-size:13px;">✓</button>
                      <button onClick=${r.reject} title=${v.t('tr.reject')} style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--accent);cursor:pointer;font-size:13px;">✕</button>`}
                  </div>
                </div>
              `)}
            </div>
          </div>
        `)}
        <p style="margin:14px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">${v.t('tr.footer')}</p>
      </div>
    </div>
  </div>
  `}

  ${v.isPlanningView && html`
  <div class="app__body">
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;">${v.t('planning.subtitle')}</p>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">1 · Magasins</h3>
        ${v.planStoreChips.length ? html`
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
            ${v.planStoreChips.map((s) => html`
              <button onClick=${s.toggle} style=${s.style}>
                <span style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;">${s.badge ? html`<span style="color:var(--accent);">✓</span>` : ''}${s.label}</span>
                <span style="font-size:11px;color:var(--muted);">${s.sub}</span>
              </button>
            `)}
          </div>
        ` : html`<p style="margin:0;font-size:12.5px;color:var(--muted);">Aucun magasin — importe ton catalogue (⚙ Paramètres → Rafraîchir) ou branche un écran.</p>`}
      </div>

      <!-- 2 · Semaine (modèle A–E) + activation + duplication -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">2 · Semaine (modèle)</h3>
          <span style="font-size:12px;color:var(--muted);">Diffusée actuellement : <strong style="color:var(--green);">Semaine ${v.planActiveWeek}</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${v.planWeekTabs.map((t) => html`
            <button onClick=${t.pick} title=${t.playing ? 'Semaine actuellement diffusée' : ''} style="display:flex;align-items:center;gap:6px;padding:9px 18px;font-size:14px;font-weight:500;border-radius:10px;cursor:pointer;${t.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">
              Sem. ${t.label}${t.playing ? html`<span style="width:7px;height:7px;border-radius:50%;background:${t.active ? '#fff' : '#2E6E4E'};"></span>` : ''}
            </button>
          `)}
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button onClick=${v.activatePlanWeek} disabled=${v.planWeekActive} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;cursor:${v.planWeekActive ? 'default' : 'pointer'};${v.planWeekActive ? 'background:rgba(63,122,82,0.12);color:var(--green);border:1px solid rgba(63,122,82,0.4);' : 'background:var(--green);color:#fff;border:1px solid var(--green);'}">${v.planWeekActive ? `✓ Semaine ${v.planWeek} diffusée` : `▶ Diffuser la semaine ${v.planWeek}`}</button>
          <span style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);">
            Dupliquer la semaine ${v.planWeek} vers
            <select onChange=${(e) => { const t = e.target.value; e.target.value = ''; if (t) v.duplicatePlanWeek(t); }} style="padding:8px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
              <option value="">semaine…</option>
              ${v.planDupTargets.map((w) => html`<option value=${w}>Semaine ${w}</option>`)}
            </select>
          </span>
        </div>
      </div>

      ${!v.planHasStores ? html`
        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:22px 20px;text-align:center;">
          <p style="margin:0;font-size:13px;color:var(--muted);">Sélectionne au moins un magasin ci-dessus pour remplir son planning de la semaine ${v.planWeek}.</p>
        </div>
      ` : html`

      <!-- 3 · Jour de la semaine -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">3 · Jour de la semaine</h3>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">
          ${v.planDayTabs.map((d) => html`
            <button onClick=${d.pick} style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 16px;border-radius:10px;cursor:pointer;min-width:64px;${d.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">
              <span style="font-size:13px;font-weight:500;">${d.label}</span>
              <span style="font-size:10px;${d.active ? 'color:rgba(255,255,255,0.85);' : 'color:var(--muted);'}">${d.count ? `${d.count} film(s)` : '—'}</span>
            </button>
          `)}
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Films — ${v.planDayName} (glisse-les sur un moment)</h3>
        ${v.planFilmCards.length ? html`
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${v.planFilmCards.map((f) => html`
              <div draggable="true" onDragStart=${f.onDragStart} onDragEnd=${f.onDragEnd} style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--paper);border:1px solid ${f.color}55;border-left:4px solid ${f.color};cursor:grab;">
                <span style="font-size:13px;font-weight:500;">${f.name}</span>
                <span style="font-size:10px;font-weight:500;color:${f.color};">${f.catLabel}</span>
                ${f.dayBadge ? html`<span title="Jours de planning de ce film" style="font-size:9px;font-weight:500;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:1px 6px;">${f.dayBadge}</span>` : ''}
                <span style="font-size:10px;color:var(--muted);">${f.count} mod.</span>
                ${f.tags.map((t) => html`<span style="font-size:9px;font-weight:500;color:${f.color};">#${t}</span>`)}
              </div>
            `)}
          </div>
        ` : html`<p style="margin:0;font-size:12.5px;color:var(--muted);">Aucun film disponible pour ${v.planDayName}. Un film n'apparaît que si son « jour de planning » inclut ce jour (réglable dans les propriétés du film, onglet Playlist).</p>`}
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Semaine ${v.planWeek} · ${v.planDayName} — moments</h3>
          <span style="font-size:11.5px;color:${v.planSaving ? '#8A847C' : '#2E6E4E'};">${v.planSaving ? 'Enregistrement…' : '✓ Enregistré automatiquement'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">
          ${v.planCols.map((col) => html`
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="display:flex;align-items:center;gap:7px;">
                  <span style="font-size:13px;font-weight:500;color:var(--ink);">${col.label}</span>
                  <span title="Films dans ce moment (5 max)" style="font-size:10.5px;font-weight:500;color:${col.full ? '#8D1D2C' : '#8A847C'};background:${col.full ? 'rgba(141,29,44,0.1)' : 'rgba(35,34,32,0.06)'};border-radius:999px;padding:2px 8px;">${col.count}/${col.max}</span>
                </span>
                <span style="display:flex;align-items:center;gap:4px;">
                  <input value=${col.from} onInput=${col.onFrom} style="width:62px;padding:5px 7px;font-size:12px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                  <span style="color:var(--muted);font-size:12px;">→</span>
                  <input value=${col.to} onInput=${col.onTo} style="width:62px;padding:5px 7px;font-size:12px;text-align:center;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </span>
              </div>
              <div class="pl-item" onDragOver=${col.onDragOver} onDragLeave=${col.onDragLeave} onDrop=${col.onDrop}
                style="min-height:96px;border-radius:12px;border:2px dashed ${col.films.length ? 'rgba(35,34,32,0.14)' : 'rgba(35,34,32,0.2)'};background:${col.films.length ? '#fff' : 'var(--paper)'};display:flex;flex-direction:column;gap:7px;padding:12px;">
                ${col.films.map((f) => html`
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:${f.color}10;border-left:4px solid ${f.color};">
                    <span style="font-size:10px;font-weight:500;color:${f.color};opacity:0.75;">${f.order}</span>
                    <div style="flex:1 1 auto;min-width:0;">
                      <div style="font-size:13px;font-weight:500;color:${f.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</div>
                      <div style="font-size:10px;color:var(--muted);">${f.count} module(s)</div>
                    </div>
                    <button onClick=${f.remove} title="Retirer" style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:var(--accent);">✕</button>
                  </div>
                `)}
                ${col.films.length
                  ? (col.full
                    ? html`<div style="font-size:10.5px;color:var(--accent);text-align:center;padding:3px;">${col.max} films max atteint — retires-en un pour changer</div>`
                    : html`<div style="font-size:10.5px;color:var(--faint);text-align:center;padding:3px;">＋ glisse un autre film (joué à la suite)</div>`)
                  : html`<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--faint);">Glisse un film ici — ou utilise « ＋ ajouter » ci-dessous (5 max)</div>`}
              </div>
              ${!col.full && col.addFilms.length ? html`
                <select onChange=${col.onAdd} title="Ajouter un film sans glisser" style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:12.5px;border:1px solid rgba(141,29,44,0.25);border-radius:8px;background:#fff;color:var(--accent);cursor:pointer;">
                  <option value="">＋ ajouter un film…</option>
                  ${col.addFilms.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
                </select>
              ` : ''}
            </div>
          `)}
        </div>
        <p style="margin:12px 0 0;font-size:11.5px;color:var(--muted);">Glisse les films sur un moment, ou ajoute-les avec le menu « ＋ ajouter » (jusqu'à 5 par moment, enchaînés en boucle). Les fenêtres horaires sont communes à tous les magasins et à toutes les semaines.</p>
      </div>

      <!-- Liens des écrans (semaine active diffusée en direct) -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <h3 style="margin:0 0 4px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Liens des écrans</h3>
        <p style="margin:0 0 12px;font-size:11.5px;color:var(--muted);">Un lien par magasin, à mettre sur l'écran. Il diffuse en direct la <strong>semaine active (${v.planActiveWeek})</strong>, le bon film selon le jour et l'heure.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${v.planStoreLinks.map((l) => html`
            <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
              <span style="flex:0 0 150px;font-size:13px;font-weight:500;">${l.store}</span>
              <input readonly value=${l.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:7px 10px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              <button onClick=${() => v.copyLink(l.url)} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">⎘ Copier</button>
              <a href=${l.url} target="_blank" style="flex:0 0 auto;font-size:12px;font-weight:500;color:var(--accent);">↗</a>
            </div>
          `)}
        </div>
      </div>
      `}

      <!-- Jours de planning des films (déplacé depuis le formulaire du film) · toujours visible -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Jours de planning des films</h3>
          ${infoTip('Quels films sont PROPOSÉS quel jour quand tu remplis le planning ci-dessus (ex. « Crêpes » = mercredi). Purement un filtre d’organisation : ça ne change pas quand un film est diffusé (ça, c’est « Jours de diffusion », réglé sur le film). Un film coché sur tous les jours est proposé tous les jours.')}
        </div>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted);">Coche les jours où chaque film doit apparaître dans le sélecteur du planning. Décoche pour le masquer ce jour-là.</p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse;width:100%;min-width:460px;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:7px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);">Film</th>
              ${v.planDayTabs.map((d) => html`<th style="padding:7px 8px;font-size:11px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);text-align:center;width:52px;">${d.label}</th>`)}
            </tr></thead>
            <tbody>
              ${v.planDayMatrix.map((p) => html`
                <tr>
                  <td style="padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;">${p.name}${p.mode === 'continu' ? html` <span style="font-size:9.5px;font-weight:500;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:1px 6px;">continu</span>` : ''}</td>
                  ${p.days.map((d) => html`<td style="padding:4px 8px;border-bottom:1px solid var(--line);text-align:center;">
                    <button onClick=${d.toggle} title=${d.on ? 'Proposé ce jour — cliquer pour masquer' : 'Masqué ce jour — cliquer pour proposer'} style="width:30px;height:28px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;border:1px solid ${d.on ? 'rgba(63,122,82,0.4)' : 'rgba(35,34,32,0.14)'};background:${d.on ? 'rgba(63,122,82,0.14)' : '#fff'};color:${d.on ? '#2E6E4E' : '#C9C3B8'};">${d.on ? '✓' : '·'}</button>
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
  <div class="app__body">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:0 0 22px;">
      ${v.kpis.map((k) => html`
        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:20px 22px;">
          <div style="font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;">${k.label}</div>
          <div style="font-size:32px;font-weight:500;color:var(--ink);line-height:1.1;margin:0 0 10px;">${k.value}</div>
          ${k.tone ? html`<span style=${`display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:11.5px;${k.tone === 'bad' ? 'background:rgba(141,29,44,0.08);color:var(--accent);' : 'background:var(--green-soft);color:var(--green);'}`}>${k.sub}</span>`
            : html`<span style="font-size:13px;color:var(--muted-2);">${k.sub}</span>`}
        </div>
      `)}
    </div>

    ${v.hasAlerts && html`
      <div style="margin:0 0 22px;display:flex;align-items:center;gap:12px;padding:14px 20px;border-radius:12px;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.22);">
        <span style="font-size:18px;">⚠</span>
        <span style="font-size:14px;color:var(--accent);font-weight:500;">${v.alertText}</span>
      </div>
    `}

    <div style="margin:0;display:flex;flex-direction:column;gap:18px;">
      ${v.fleet.map((s) => html`
        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:16px 22px;border-bottom:1px solid var(--line);background:var(--paper);">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              ${s.renaming ? html`
                <input value=${this.state.editStoreName} onInput=${s.onRenameInput} onKeyDown=${s.onRenameKey}
                  ref=${(el) => { if (el && document.activeElement !== el && !el._focused) { el._focused = true; el.focus(); el.select(); } }}
                  style="padding:7px 11px;font-size:15px;font-weight:500;border:1px solid var(--accent);border-radius:8px;background:#fff;min-width:260px;" />
                <button onClick=${s.commitRename} style="padding:7px 13px;font-size:12px;font-weight:500;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;">OK</button>
              ` : html`
                <span style="font-size:16px;font-weight:500;">${s.store}</span>
                <button onClick=${s.startRename} title="Renommer le magasin / l'écran" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.8);border:1px solid var(--line);cursor:pointer;font-size:12px;color:var(--muted);">✎</button>
              `}
              <span style="font-size:11.5px;font-weight:400;color:var(--muted-2);background:var(--chip);border-radius:999px;padding:3px 10px;">${s.group}</span>
              <button onClick=${s.copyFilm} title="Copier le lien direct du film de ce magasin (à la taille de son combo d'écrans)" style="padding:5px 11px;font-size:11.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">⎘ Lien film</button>
              <a href=${s.filmUrl} target="_blank" title="Ouvrir le film de ce magasin" style="font-size:11.5px;font-weight:500;color:var(--accent);">↗</a>
            </div>
            <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Combo écrans</span>
              <select value=${s.fmt.screens} onChange=${s.setScreens} title="Nombre d'écrans côte à côte" style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                ${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
              <span style="font-size:12px;color:var(--muted);">×</span>
              <select value=${s.fmt.size} onChange=${s.setSize} title="Diagonale d'une dalle" style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                ${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}
              </select>
              <select value=${s.fmt.orient} onChange=${s.setOrient} title="Orientation des dalles" style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                <option value="paysage">paysage</option>
                <option value="portrait">portrait</option>
              </select>
              <select value=${s.lang} onChange=${s.setLang} title="Langue d'affichage du magasin (noms de produits via la table produits)" style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;text-transform:uppercase;">
                ${s.langOptions.map((l) => html`<option value=${l.id}>${l.id}</option>`)}
              </select>
              <span style="font-size:12.5px;font-weight:500;color:var(--accent);background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:5px 12px;">= ${s.fmt.px}</span>
              <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:${s.connColor};"><span style="width:8px;height:8px;border-radius:50%;background:${s.connColor};"></span>${s.connLabel}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid var(--line);background:#fff;">
            <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Coordonnées</span>
            ${infoTip('Alimentent les champs dynamiques des gabarits, résolus PAR MAGASIN à la diffusion : {{adresse}}, {{horaires}}, {{tel}} et {{magasin}} (le nom). Un seul gabarit affiche ainsi les bonnes infos selon le point de vente. Enregistré en quittant le champ.')}
            <input key=${'ad-' + s.id} defaultValue=${s.address} onChange=${s.setAddress} placeholder="Adresse — {{adresse}}" title="Adresse du magasin — jeton {{adresse}}" style="flex:2 1 220px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
            <input key=${'hr-' + s.id} defaultValue=${s.hours} onChange=${s.setHours} placeholder="Horaires — {{horaires}}" title="Horaires d'ouverture — jeton {{horaires}}" style="flex:1 1 160px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
            <input key=${'ph-' + s.id} defaultValue=${s.phone} onChange=${s.setPhone} placeholder="Téléphone — {{tel}}" title="Téléphone — jeton {{tel}}" style="flex:1 1 140px;min-width:0;padding:7px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid var(--line);background:#fff;">
            <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Compte magasin</span>
            ${infoTip('Un accès propre au magasin, en français ou en néerlandais (…/magasin) : il y voit SES écrans (état, cache réel), le lien d\'écran du magasin, et y déclare ses ruptures du jour — le produit quitte SES écrans seulement. La portée est décidée par le serveur : le compte ne peut ni lire ni modifier un autre magasin.')}
            ${s.account ? html`
              <span style="font-size:12.5px;color:var(--muted-2);">identifiant <strong style="font-family:ui-monospace,monospace;">${s.account}</strong></span>
              <button onClick=${s.resetAccount} style="padding:6px 12px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">Nouveau mot de passe</button>
              <button onClick=${s.deleteAccount} style="padding:6px 12px;font-size:12px;font-weight:500;color:var(--accent);background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:8px;cursor:pointer;">Supprimer</button>
            ` : html`<button onClick=${s.createAccount} style="padding:6px 12px;font-size:12px;font-weight:500;color:#fff;background:var(--accent);border:none;border-radius:8px;cursor:pointer;">Créer le compte magasin</button>`}
            ${s.unavailableNames.length ? html`<span title="Déclarés épuisés par le magasin : retirés de SES écrans jusqu'à ce soir (ou jusqu'à remise en vente)." style="font-size:12px;color:var(--accent);">Épuisés aujourd'hui : <strong>${s.unavailableNames.join(', ')}</strong></span>` : ''}
          </div>
          ${s.cred ? html`
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 22px;border-bottom:1px solid var(--line);background:rgba(63,122,82,0.07);">
              <span style="font-size:12.5px;color:#1F5B2A;line-height:1.6;flex:1 1 320px;">À transmettre au magasin — <strong>le mot de passe ne sera plus affiché</strong> : lien <strong>${s.cred.url}</strong> · identifiant <strong style="font-family:ui-monospace,monospace;">${s.cred.username}</strong> · mot de passe <strong style="font-family:ui-monospace,monospace;">${s.cred.password}</strong></span>
              <button onClick=${() => this.copyLink(`${s.cred.url}\nIdentifiant / Gebruikersnaam : ${s.cred.username}\nMot de passe / Wachtwoord : ${s.cred.password}`)} style="padding:7px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid rgba(63,122,82,0.35);background:#fff;color:#1F5B2A;cursor:pointer;">Copier</button>
              <button onClick=${() => this.setState({ storeCred: null })} style="padding:7px 11px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--muted-2);cursor:pointer;">Masquer</button>
            </div>
          ` : ''}
          <div style="padding:12px 22px;border-bottom:1px solid var(--line);background:var(--paper);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;${s.groups.length ? 'margin-bottom:10px;' : ''}">
              <div style="display:flex;align-items:center;gap:7px;">
                <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('sector.plural')}</span>
                ${infoTip(v.t('sector.help'))}
              </div>
              <button onClick=${s.addGroup} style="padding:6px 12px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('sector.add')}</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${s.groups.map((g) => html`
                <div key=${g.id} class="sig-sector-row" style="display:flex;flex-direction:column;gap:9px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;">
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <input key=${'gn-' + g.id} defaultValue=${g.name} onChange=${g.onName} placeholder=${v.t('sector.namePlaceholder')} style="flex:1 1 160px;min-width:0;padding:6px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                    <!-- Config d'écrans PROPRE au secteur : nombre · taille · position -->
                    <span style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:5px 9px;">
                      <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('sector.screens')}</span>
                      <select value=${g.fmt.screens} onChange=${g.onScreens} title=${v.t('sector.screenCount')} style="padding:5px 7px;font-size:12px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}</select>
                      <span style="font-size:11px;color:var(--muted);">×</span>
                      <select value=${g.fmt.size} onChange=${g.onSize} title=${v.t('sector.screenSize')} style="padding:5px 7px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}</select>
                      <!-- Position : portrait / paysage, choix explicite en 2 boutons -->
                      <span title=${v.t('sector.orient')} style="display:inline-flex;background:var(--chip);border-radius:8px;padding:2px;">
                        ${[['portrait', v.t('sector.portrait'), 8, 13], ['paysage', v.t('sector.landscape'), 15, 9]].map(([id, label, iw, ih]) => html`
                          <button onClick=${() => g.setOrient(id)} title=${label} style="display:flex;align-items:center;gap:5px;padding:4px 9px;font-size:11.5px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${g.fmt.orient === id ? 'background:var(--accent);color:#fff;' : 'background:transparent;color:var(--muted);'}"><span style="display:inline-block;width:${iw}px;height:${ih}px;border-radius:2px;border:1.5px solid currentColor;"></span>${label}</button>`)}
                      </span>
                      <!-- Aperçu visuel de l'agencement (n dalles à l'échelle) -->
                      <span title=${g.fmt.label} style="display:inline-flex;align-items:flex-end;gap:2px;height:26px;">
                        ${Array.from({ length: g.fmt.screens }, (_, i) => html`<span key=${i} style="display:inline-block;width:${g.fmt.orient === 'portrait' ? 13 : 24}px;height:${g.fmt.orient === 'portrait' ? 24 : 13}px;border-radius:2px;background:rgba(141,29,44,0.16);border:1px solid rgba(141,29,44,0.45);"></span>`)}
                      </span>
                      <span class="sig-sector-px" style="font-size:11px;font-weight:500;color:var(--accent);background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:3px 8px;">${g.fmt.px}</span>
                    </span>
                    <a href=${g.previewUrl} target="_blank" title="Aperçu du secteur (boucle catégories)" style="font-size:11.5px;font-weight:500;color:var(--accent);flex:0 0 auto;">${v.t('sector.preview')}</a>
                    <button onClick=${g.del} title=${v.t('sector.delete')} style="flex:0 0 auto;width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;color:var(--accent);">✕</button>
                  </div>
                  <!-- Ce que le secteur filtre : périodes et/ou catégories -->
                  <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                    <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('sector.filters')}</span>
                    ${[[g.filterMoments, g.toggleMoments, v.t('sector.filterMoments'), v.t('sector.filterMomentsHelp')],
                       [g.filterCats, g.toggleCats, v.t('sector.filterCats'), v.t('sector.filterCatsHelp')]].map(([on, toggle, label, help]) => html`
                      <button onClick=${toggle} title=${help} style="display:inline-flex;align-items:center;gap:5px;padding:4px 11px;font-size:11.5px;font-weight:500;border-radius:8px;cursor:pointer;border:1px solid ${on ? '#8D1D2C' : 'rgba(35,34,32,0.16)'};background:${on ? '#8D1D2C' : '#fff'};color:${on ? '#fff' : '#8A847C'};">${on ? '✓' : '○'} ${label}</button>
                    `)}
                    ${g.noFilter ? html`<span style="font-size:11px;color:var(--warn);">${v.t('sector.noFilter')}</span>` : ''}
                  </div>
                  ${g.filterCats ? html`<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                    <span style="font-size:10.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('sector.categories')}</span>
                    ${g.catChips.map((c) => html`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:999px;padding:2px 5px 2px 9px;">${c.name}<button onClick=${c.remove} style="width:15px;height:15px;border-radius:50%;border:none;background:rgba(92,88,82,0.18);color:var(--muted-2);cursor:pointer;font-size:9px;line-height:1;">✕</button></span>`)}
                    ${g.catChips.length ? '' : html`<span style="font-size:11px;color:var(--warn);">${v.t('sector.noCatFollows')}</span>`}
                    ${g.addableCats.length ? html`<select onChange=${g.onAddCat} style="padding:4px 7px;font-size:11.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;"><option value="">${v.t('sector.addCat')}</option>${g.addableCats.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>` : ''}
                  </div>` : ''}
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
                    <div style="display:flex;align-items:center;gap:7px;"><a href=${p.playerUrl} target="_blank" title="Ouvrir ce player dans un onglet (test live)" style="font-size:14px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name} <span style="color:var(--faint);font-weight:400;">↗</span></a><span style=${p.kioskStyle}>${p.kioskLabel}</span></div>
                    <div style="font-size:11.5px;color:var(--muted);">${p.hw} · ${p.orient}</div>
                    ${p.groupOptions.length ? html`<select value=${p.groupId} onChange=${p.setGroup} title=${v.t('sector.playerPick')} style="margin-top:5px;max-width:190px;padding:4px 7px;font-size:11px;font-weight:500;border:1px solid ${p.groupId ? 'rgba(92,88,82,0.4)' : 'rgba(35,34,32,0.16)'};border-radius:8px;background:${p.groupId ? 'rgba(92,88,82,0.08)' : '#fff'};color:${p.groupId ? 'var(--muted-2)' : '#4A4640'};cursor:pointer;">
                      <option value="">${v.t('sector.storeFilm')}</option>
                      ${p.groupOptions.map((g) => html`<option value=${g.id}>▦ ${g.name}</option>`)}
                    </select>` : ''}
                  </div>
                </div>
                <div><span style=${p.statusPillStyle}>${p.statusLabel}</span></div>
                <div style="font-size:12.5px;"><span style="color:var(--muted);">Playlist </span><span style=${p.verStyle}>v${p.playedVer}</span><div style="font-size:11px;color:var(--muted);">${p.verNote}</div><div style="font-size:11px;margin-top:2px;"><span style="color:var(--muted);">Prix </span><span style=${p.dataStyle}>d${p.dataVer}</span><span style="color:${p.dataAgeColor};"> · ${p.dataAge}</span></div></div>
                <div style="font-size:12px;color:var(--muted);min-width:0;">
                  <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
                    <div style="flex:1 1 auto;height:6px;border-radius:3px;background:rgba(35,34,32,0.10);overflow:hidden;"><div style="height:100%;border-radius:3px;background:${p.cacheColor};width:${p.cachePct};"></div></div>
                    <span style="flex:0 0 auto;font-variant-numeric:tabular-nums;">${p.cachePct}</span>
                  </div>
                  <div title=${p.cacheNote} style="font-size:11px;color:${p.cacheNoteColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">${p.cacheNote}</div>
                  <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">▶ ${p.media}</div>
                </div>
                <div style="font-size:12px;color:var(--muted);text-align:right;"><div style="font-weight:500;color:var(--ink);">${p.sync}</div><div>${p.health}</div></div>
              </div>
            `)}
          </div>
        </div>
      `)}
    </div>
  </div>
  `}

  ${st.view === 'campaignVideo' && html`
  <div class="app__body app__body--wide">${renderCampaignWizard(this)}</div>
  `}

  ${v.isHomeView && html`
  <div class="app__body">
    <div style="display:flex;flex-direction:column;gap:18px;">
      <div>
        <p style="margin:0;font-size:13px;color:var(--muted-2);line-height:1.5;">${v.t('home.intro')} ${home.count === home.total ? v.t('home.allReady') : v.t('home.stepsReady', { n: home.count, total: home.total })}</p>
      </div>

      <!-- Ce qui passe maintenant -->
      <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <div style="font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">${v.t('home.nowPlaying')}</div>
          <div style="font-size:21px;font-weight:400;color:var(--ink);">${home.film ? home.film.name : v.t('home.noFilm')} ${home.film && home.film.mode === 'continu' ? html`<span style="font-size:11.5px;font-weight:400;color:var(--ink);background:var(--chip);border-radius:999px;padding:4px 10px;margin-left:6px;vertical-align:3px;">continu</span>` : ''}</div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:6px;">${v.t('home.moment')} : <strong style="color:var(--ink);font-weight:500;">${MOMENT_FULL[home.moment] || '—'}</strong> · ${v.t('home.activeWeek')} : <strong style="color:var(--ink);font-weight:500;">${home.week}</strong> · ${v.t('home.screens')} : <strong style="color:var(--ink);font-weight:500;">${home.online}/${home.screens}</strong> ${v.t('home.online')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a class="btn" href=${new URL('film', location.href).toString()} target="_blank">Voir la diffusion ${icon(ICON.external, 14)}</a>
        </div>
      </div>

      <!-- Prêt à diffuser ? -->
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:20px 22px;">
        <h3 style="margin:0 0 14px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">${v.t('home.readyChecklist')}</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${home.steps.map((s) => html`
            <div style="display:flex;align-items:center;gap:14px;padding:13px 15px;border-radius:12px;background:#fff;border:1px solid var(--line);">
              <span style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;font-size:14px;font-weight:500;${s.ok ? 'background:var(--green-soft);color:var(--green);' : (s.soft ? 'background:var(--chip);color:var(--faint);' : 'background:var(--warn-soft);color:var(--warn);')}">${s.ok ? icon(ICON.ok, 15) : (s.soft ? '○' : '!')}</span>
              <div style="flex:1 1 auto;min-width:0;">
                <div style="font-size:14px;font-weight:500;color:var(--ink);">${s.label}${s.soft && !s.ok ? html` <span style="font-size:11px;font-weight:500;color:var(--muted);">· optionnel</span>` : ''}</div>
                <div style="font-size:12px;color:var(--muted);">${s.hint}</div>
              </div>
              ${!s.ok && s.cta ? html`<button onClick=${s.cta.go} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:500;color:#fff;background:var(--accent);border:none;border-radius:8px;cursor:pointer;">${s.cta.label}</button>`
                : (s.cta ? html`<button onClick=${s.cta.go} style="flex:0 0 auto;padding:9px 16px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${s.cta.label}</button>` : '')}
            </div>
          `)}
        </div>
      </div>

      <!-- Assistant vidéo de campagne : de la campagne du Marketing à la diffusion -->
      <button data-cw-open onClick=${() => this.openWizard()} title=${v.t('hdr.broadcastTip')} style="width:100%;box-sizing:border-box;text-align:left;display:flex;align-items:center;gap:16px;padding:18px 22px;border-radius:12px;background:var(--accent);border:none;cursor:pointer;">
        <div style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,0.14);color:#fff;">${icon(ICON.play, 20)}</div>
        <div style="flex:1 1 auto;min-width:0;">
          <div style="font-size:16px;font-weight:400;color:#fff;">${v.t('home.cwTitle')}</div>
          <div style="font-size:12.5px;color:rgba(255,255,255,0.82);margin-top:3px;line-height:1.45;">${v.t('home.cwSub')}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.85);flex:0 0 auto;">→</div>
      </button>

      <!-- Actions rapides -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        <button onClick=${() => this.startFirstFilm()} style="text-align:left;padding:18px 20px;border-radius:12px;background:#FFFFFF;border:1px solid var(--line);cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:var(--accent-soft);color:var(--accent);margin-bottom:10px;">${icon(ICON.composer, 18)}</div>
          <div style="font-size:14px;font-weight:500;color:var(--ink);">Créer un film continu</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">Une boucle prête, à adapter en quelques clics.</div>
        </button>
        <button onClick=${() => this.openOnboarding()} style="text-align:left;padding:18px 20px;border-radius:12px;background:#FFFFFF;border:1px solid var(--line);cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:var(--accent-soft);color:var(--accent);margin-bottom:10px;">${icon(ICON.screens, 18)}</div>
          <div style="font-size:14px;font-weight:500;color:var(--ink);">Brancher un écran</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">Configure et connecte tes magasins pas à pas.</div>
        </button>
        <button onClick=${() => this.openSeasons()} style="text-align:left;padding:18px 20px;border-radius:12px;background:#FFFFFF;border:1px solid var(--line);cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:var(--accent-soft);color:var(--accent);margin-bottom:10px;">${icon(ICON.seasons, 18)}</div>
          <div style="font-size:14px;font-weight:500;color:var(--ink);">Périodes & données</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">Saisons, produit × moment, médias agence.</div>
        </button>
      </div>
    </div>
  </div>
  `}

  ${v.isComposerView && html`
  <div style="flex:0 0 auto;display:flex;align-items:flex-end;gap:16px;padding:6px 24px 0;background:#fff;border-bottom:1px solid var(--line);flex-wrap:wrap;">
    <nav class="page-tabs" style="margin:0;border-bottom:none;">
      <button onClick=${v.setTabLib} class=${'page-tabs__tab' + (v.isTimelineTab ? '' : ' is-on')}>1 · Bibliothèque — construire</button>
      <button onClick=${v.setTabTimeline} class=${'page-tabs__tab' + (v.isTimelineTab ? ' is-on' : '')}>2 · Playlist — ligne du temps</button>
    </nav>
    <span style="font-size:12px;color:var(--muted);padding-bottom:10px;">${v.isTimelineTab ? 'Glisse les éléments de la bibliothèque sur la ligne du temps, puis Enregistrer et Publier sur le réseau.' : 'Construis ici les éléments (catégories, liaisons) qui composeront tes films.'}</span>
  </div>
  `}

  ${v.isComposerView && v.isLibTab && html`
  <div style="flex:1 1 auto;display:grid;grid-template-columns:${COMPOSER_COLS.lib}px minmax(${COMPOSER_COLS.editorMin}px,1fr) minmax(${COMPOSER_COLS.previewMin}px,${COMPOSER_COLS.previewFr}fr);min-height:0;">

    <aside style="background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow:auto;">
      <div style="flex:0 0 auto;padding:18px 18px 10px;">
        <h2 style="margin:0 0 3px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${v.t('composer.library')}</h2>
        <p style="margin:0 0 9px;font-size:11.5px;color:var(--muted);line-height:1.4;">Tous les éléments · clique pour éditer · ＋ ajoute au film affiché dans l'onglet Playlist</p>
        <!-- Filtre de format : 16:9 paysage / 9:16 portrait -->
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          ${v.libOrientChips.map((o) => html`
            <button onClick=${o.pick} title=${o.label} style=${o.style + 'padding:5px 10px;font-size:11.5px;'}><span>${o.icon}</span>${o.id === 'all' ? 'Tous' : o.label.split(' ')[0]}<span style="font-weight:400;opacity:0.75;">${o.count}</span></button>
          `)}
        </div>
      </div>
      <div style="flex:1 1 auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:7px;">
        ${v.library.map((ml) => html`
          <div onClick=${ml.select} style=${ml.cardStyle}>
            <span style=${ml.badgeStyle}>${ml.typeIcon}</span>
            <div style="flex:1 1 auto;min-width:0;">
              <div style="font-size:13.5px;font-weight:500;line-height:1.3;overflow-wrap:anywhere;">${ml.name}</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;">
                ${ml.catChip}
                ${ml.tagChip}
                <span style="font-size:11px;color:var(--muted);">${ml.libMeta}</span>
              </div>
              <div style="display:flex;align-items:center;gap:3px;margin-top:8px;">
                <button onClick=${ml.addToPlaylist} title="Ajouter à la playlist" style=${ml.addBtn}>＋</button>
                <button onClick=${ml.copy} title="Copier" style=${ml.miniBtn}>⧉</button>
                <button onClick=${ml.dup} title="Dupliquer" style=${ml.miniBtn}>⎘</button>
                <button onClick=${ml.del} title="Supprimer de la bibliothèque" style=${ml.miniBtnDel}>${icon(ICON.trash, 14)}</button>
              </div>
            </div>
          </div>
        `)}
      </div>
      <div style="flex:0 0 auto;padding:12px;border-top:1px solid var(--line);display:flex;gap:8px;">
        <button onClick=${v.openAddPicker} style="flex:1 1 auto;padding:11px;font-size:13.5px;font-weight:500;color:#fff;background:var(--accent);border:none;border-radius:10px;cursor:pointer;">${v.t('composer.addElement')}</button>
        <button onClick=${v.paste} style=${v.pasteStyle}>${v.t('composer.paste')}</button>
      </div>
    </aside>

    <section style="overflow:auto;padding:24px 26px 40px;border-right:1px solid var(--line);">
      <div style="display:flex;flex-direction:column;gap:20px;max-width:600px;">

        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:22px 24px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span style=${v.selTypeBadge}>${v.selTypeLabel}</span>
            <h2 style="margin:0;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">${v.t('composer.selectedModule')}</h2>
          </div>
          <input value=${v.selName} onInput=${v.onSelName} placeholder="Nom du module" style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:19px;font-weight:500;border:1px solid var(--line);border-radius:10px;background:#fff;" />
          <div style="margin-top:8px;display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--muted);flex-wrap:wrap;">
            ${infoTip('Champs dynamiques : dans le titre ou le sous-titre, écris un jeton entre doubles accolades — il est remplacé PAR MAGASIN à la diffusion (un seul gabarit, les bonnes valeurs partout). Jetons : {{magasin}} (nom), {{adresse}}, {{horaires}}, {{tel}} (coordonnées saisies dans l’onglet Réseau) · {{date}} (date du jour) · {{saison}} (période active) · {{moment}} (matin/midi/après-midi). Ex. « Bienvenue à {{magasin}} ». Dans l’aperçu générique le jeton reste visible ; via le lien d’un magasin il est résolu.')}
            <span>Jetons dynamiques :</span>
            ${['{{magasin}}', '{{adresse}}', '{{date}}', '{{saison}}'].map((t) => html`<code style="background:var(--chip);padding:1px 5px;border-radius:4px;">${t}</code>`)}
            <span>…</span>
          </div>
          <div style="margin-top:14px;">
            <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">Catégorie de bibliothèque</label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${v.libTagPicker.map((t) => html`
                <button onClick=${t.pick} style=${t.style}><span style=${t.dotStyle}></span>${t.label}</button>
              `)}
            </div>
          </div>
          <div style="margin-top:14px;">
            <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">
              ${infoTip('Format de l’élément : un écran est soit paysage (16:9), soit portrait (9:16). Ce choix sert de FILTRE au montage — un élément 16:9 n’est proposé que quand tu montes pour des écrans paysage, un 9:16 que pour du portrait.')}
              <span>Format de diffusion</span>
            </label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${v.orientOpts.map((o) => html`
                <button onClick=${o.pick} title=${o.hint} style="padding:8px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${o.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${o.label}</button>
              `)}
            </div>
          </div>
          <div style="margin-top:14px;">
            <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">
              ${infoTip('Périodes de la journée où cet élément peut passer. Aucune cochée = il passe à tous les moments. Sert au filtrage de la boucle continue et à l’aperçu « Contenu par moment ».')}
              <span>Moments de diffusion <span style="font-weight:400;">— ${v.momentSummary}</span></span>
            </label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${v.momentOpts.map((o) => html`
                <button onClick=${o.toggle} style="padding:8px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${o.active ? 'background:var(--muted-2);color:#fff;border:1px solid var(--muted-2);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${o.active ? '✓ ' : ''}${o.label}</button>
              `)}
            </div>
          </div>
          ${v.hasSub && html`
            <div style="margin-top:14px;">
              <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">Sous-titre (accroche)</label>
              <input value=${v.liaisonSub} onInput=${v.onLiaisonSub} placeholder="ex. faites maison chaque matin" style="width:100%;box-sizing:border-box;padding:11px 13px;font-size:15px;border:1px solid var(--line);border-radius:10px;background:#fff;" />
            </div>
          `}
          ${v.hasDur && html`
            <div style="margin-top:14px;display:flex;align-items:center;gap:10px;">
              <label style="font-size:12.5px;font-weight:500;color:var(--muted);">Durée à l'écran</label>
              <input type="number" min="2" max="120" step="1" value=${v.durVal} onInput=${v.onDur} style="width:90px;padding:9px 11px;font-size:14px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
              <span style="font-size:12.5px;color:var(--muted);">secondes</span>
            </div>
          `}
        </div>

        <div style=${secCard}>
          ${secHead('tag', 'Tag campagne', v.tagSummary)}
          ${secOpen('tag') && html`<div style=${secBody}>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">Affiche un macaron (illustration + texte) sur l'écran, pour une campagne commerciale.</p>
            <button onClick=${v.toggleTag} style=${v.tagTrackStyle}><span style=${v.tagKnobStyle}></span></button>
          </div>
          ${v.tagEnabled && html`
            <div style="display:flex;gap:10px;align-items:center;">
              <select value=${v.tagImg} onChange=${v.onTagImg} style="flex:0 0 150px;padding:10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                <option value="">Aucune icône</option>
                <option value="assets/cherry.png">Cerise</option>
                <option value="assets/apple.png">Pomme</option>
                <option value="assets/rhubarb.png">Rhubarbe</option>
                <option value="assets/cake-slice.png">Part de gâteau</option>
                <option value="assets/cookies.png">Cookie</option>
              </select>
              <input value=${v.tagLabel} onInput=${v.onTagLabel} placeholder="ex. Nouveauté · -20%" style="flex:1 1 auto;min-width:0;padding:10px 12px;font-size:15px;font-weight:500;color:var(--accent);border:1px solid var(--line);border-radius:8px;background:#fff;" />
            </div>
          `}
          </div>`}
        </div>

        ${v.hasWatermark && html`
          <div style=${secCard}>
            ${secHead('watermark', 'Filigrane / filtre photo', v.watermarkSummary)}
            ${secOpen('watermark') && html`<div style=${secBody}>
            <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">Superpose un filigrane à l'élément — surtout utile sur les photos : logo en filigrane, logo dans un coin, ou ruban « Nouveau ».</p>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
              ${v.watermarkOpts.map((o) => html`
                <button onClick=${o.pick} style="padding:11px 12px;font-size:13px;font-weight:500;border-radius:8px;cursor:pointer;${o.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${o.label}</button>
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
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">Le produit vient de la table produits — nom et prix (par magasin) suivent automatiquement.</p>
              <button onClick=${v.goProducts} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">▦ Ouvrir la table produits</button>
            </div>
            <select value=${v.curProductRef} onChange=${v.onProductRef} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
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
              <div style="width:64px;height:64px;border-radius:12px;background:#1B1B1B;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;">🎯</div>
              <p style="margin:0;font-size:13px;line-height:1.6;color:var(--muted-2);max-width:420px;">Cet élément diffuse <strong>automatiquement</strong> une vidéo ou photo de la <strong>médiathèque agence</strong>, <strong>tirée au sort</strong> parmi celles taguées pour le <strong>moment courant</strong> (matin/midi/soir, selon les fenêtres du planning) et une <strong>saison active</strong>. La pioche change à chaque diffusion — parfait pour surprendre le client tout en restant de saison.</p>
              <a href=${v.mediaAgencyUrl} target="_blank" style="font-size:13px;font-weight:500;color:var(--accent);">↗ Ouvrir l'espace Vidéo — Agence (upload et tags)</a>
              <p style="margin:0;font-size:11.5px;color:var(--muted);">Règle la <strong>durée</strong> à l'écran ci-dessus, et la <strong>mise en page</strong> (plein écran ou adapté). S'il n'y a aucun média éligible à l'instant, un écran repère « Média ciblé » s'affiche.</p>
            </div>
            </div>`}
          </div>
        `}

        ${v.isPromo && html`
          <div style=${secCard}>
            ${secHead('promo', 'Type de promotion', v.promoSummary)}
            ${secOpen('promo') && html`<div style=${secBody}>
            <div style="margin-bottom:14px;padding:11px 13px;border-radius:10px;background:var(--paper);border:1px solid var(--line);" data-tfb-link>
              <label style="display:block;font-size:12.5px;font-weight:500;color:var(--ink);margin-bottom:6px;">${v.t('tfb.editorTitle')}</label>
              ${v.hasTfbPromos ? html`
                <select value=${v.curTfbRef} onChange=${v.onTfbRef} style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13.5px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
                  <option value="">${v.t('tfb.pickNone')}</option>
                  ${v.tfbOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                </select>
                ${v.tfbPicked && html`
                  <div style="margin-top:9px;font-size:12px;color:var(--muted-2);line-height:1.6;">
                    <div style="font-size:13.5px;font-weight:500;color:var(--ink);">${v.tfbPicked.icon} ${v.tfbPicked.name} · <span style="color:var(--accent);">${v.tfbPicked.label}</span></div>
                    ${v.tfbPicked.targets.length ? html`<div>${v.tfbPicked.targets.map((c) => c.label).join(' · ')}</div>` : ''}
                    <div>${metaIcon(ICON.clock)}${v.tfbPicked.when}${v.tfbPicked.dates ? html` · ${metaIcon(ICON.calendar)}${v.tfbPicked.dates}` : ''}</div>
                    <div>${metaIcon(ICON.store)}${v.tfbPicked.shops}</div>
                    ${v.tfbPicked.voucher && html`<div>${metaIcon(ICON.ticket)}${v.tfbPicked.voucher}</div>`}
                    ${!v.tfbPicked.active && html`<div style="margin-top:4px;color:var(--accent);font-weight:500;">${v.t('tfb.inactiveNote')}</div>`}
                  </div>
                `}
                <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">${v.t('tfb.editorHelp')}</p>
              ` : html`<p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">${v.t('tfb.editorNone')} <button onClick=${v.goBundles} style="background:none;border:none;padding:0;color:var(--accent);font-weight:500;text-decoration:underline;cursor:pointer;font-size:12px;">${v.t('tfb.goPromotions')}</button></p>`}
            </div>
            ${v.promoFamily ? html`
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);" data-promo-family-badge>
                ${badgePill(v.promoFamily.badge)}
                <span style="flex:1 1 220px;min-width:0;font-size:11.5px;color:var(--muted);line-height:1.5;">${v.t('badges.editorFollows', { fam: v.promoFamily.label })}</span>
                <button onClick=${v.goPromoTypes} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('badges.editorChange')}</button>
              </div>
            ` : html`
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">${v.t('badges.editorManual')}</p>
              <button onClick=${v.goPromoTypes} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('badges.editorStyles')}</button>
            </div>
            ${v.hasPromoTypes ? html`
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                ${v.promoTypeOptions.map((o) => html`
                  <button onClick=${o.pick} style="text-align:left;padding:11px 12px;font-size:13px;font-weight:500;border-radius:8px;cursor:pointer;${o.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${o.label}</button>
                `)}
              </div>
              <div style="margin-top:12px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
                <span style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#fff;background:${v.promoColor};"><span style="font-size:15px;">${v.promoIcon}</span>${v.promoName}</span>
                <span style="font-size:11.5px;color:var(--muted);">${v.t('badges.onScreen')}</span>
              </div>
            ` : html`
              <div style="padding:12px 14px;border-radius:10px;background:rgba(141,29,44,0.06);border:1px solid rgba(141,29,44,0.2);font-size:12.5px;color:var(--accent);line-height:1.5;">Aucun sous-type de promotion actif. <button onClick=${v.goPromoTypes} style="background:none;border:none;padding:0;color:var(--accent);font-weight:500;text-decoration:underline;cursor:pointer;font-size:12.5px;">Créer un type de promotion →</button></div>
            `}
            `}
            ${v.promoUsesProduct && html`
              <div style="margin-top:14px;">
                <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">Produit mis en avant (photo + prix)</label>
                <select value=${v.curProductRef} onChange=${v.onProductRef} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
                  <option value="">— Aucun produit —</option>
                  ${v.productOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                </select>
              </div>
            `}
            </div>`}
          </div>
        `}

        ${v.isPromo && html`
          <div style=${secCard}>
            ${secHead('motion', 'Mouvement', v.motionSummary)}
            ${secOpen('motion') && html`<div style=${secBody}>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
              ${v.motionSimple.map((o) => html`<button onClick=${o.pick} style=${o.style}>${o.label}</button>`)}
            </div>
            </div>`}
          </div>
        `}

        ${v.isBundle && html`
          <div style=${secCard}>
            ${secHead('bundle', v.t('bundles.editorTitle'), v.bundleSummary)}
            ${secOpen('bundle') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">${v.t('bundles.editorHelp')}</p>
              <button onClick=${v.goBundles} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${v.t('bundles.manage')}</button>
            </div>
            ${v.hasBundles ? html`
              <select value=${v.curBundleRef} onChange=${v.onBundleRef} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
                <option value="">${v.t('bundles.pick')}</option>
                ${v.bundleOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
              </select>
              ${v.bundlePicked && html`
                <div style="margin-top:12px;padding:11px 13px;border-radius:10px;background:var(--paper);border:1px solid var(--line);font-size:12px;color:var(--muted-2);line-height:1.6;">
                  <div style="font-size:14px;font-weight:500;color:var(--ink);">${v.bundlePicked.name} · ${v.bundlePicked.price}${v.bundlePicked.worth ? html` <span style="color:var(--muted);font-weight:400;text-decoration:line-through;">${v.bundlePicked.worth}</span>` : ''}</div>
                  <div>${v.bundlePicked.comp.map((c) => c.label).join(' + ')}</div>
                  <div>${metaIcon(ICON.clock)}${v.bundlePicked.when}</div>
                  <div>${metaIcon(ICON.store)}${v.bundlePicked.shops}</div>
                  ${!v.bundlePicked.active && html`<div style="margin-top:4px;color:var(--accent);font-weight:500;">${v.t('bundles.inactiveNote')}</div>`}
                </div>
              `}
            ` : html`
              <div style="padding:12px 14px;border-radius:10px;background:rgba(141,29,44,0.06);border:1px solid rgba(141,29,44,0.2);font-size:12.5px;color:var(--accent);line-height:1.5;">${v.t('bundles.noneYet')} <button onClick=${v.goBundles} style="background:none;border:none;padding:0;color:var(--accent);font-weight:500;text-decoration:underline;cursor:pointer;font-size:12.5px;">${v.t('bundles.goSync')}</button></div>
            `}
            </div>`}
          </div>
        `}

        ${v.isCampaign && html`
          <div style=${secCard}>
            ${secHead('campaign', 'Campagne à diffuser', v.campaignSummary)}
            ${secOpen('campaign') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">Choisis une <strong>campagne</strong> dans la liste — son nom, son visuel, son produit lié et sa période s'affichent automatiquement. La liste se gère (ou s'importe) dans <strong>Campagnes</strong>.</p>
              <button onClick=${v.goCampaigns} style="flex:0 0 auto;padding:7px 13px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">📣 Gérer les campagnes</button>
            </div>
            ${v.hasCampaigns ? html`
              <select value=${v.curCampaignRef} onChange=${(e) => this.setSelField('campaignRef', e.target.value)} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:14px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
                <option value="">— Choisir une campagne —</option>
                ${v.campaignOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
              </select>
              ${v.campaignInfo && v.curCampaignRef && html`
                <div style="margin-top:12px;display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
                  ${v.campaignInfo.image
                    ? html`<img src=${v.campaignInfo.image} alt="" loading="lazy" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line);" />`
                    : html`<span style="width:52px;height:52px;border-radius:8px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;background:${v.campaignInfo.color || '#8D1D2C'};">${v.campaignInfo.scope === 'gamme' ? '🗂' : '📣'}</span>`}
                  <div style="flex:1 1 auto;min-width:0;">
                    <div style="font-size:14px;font-weight:500;color:var(--ink);">${v.campaignInfo.name}</div>
                    <div style="font-size:11.5px;color:var(--muted);">${v.campaignInfo.scope === 'gamme' ? `Gamme · ${v.campaignInfo.theme || '—'}` : 'Produit'}${v.campaignInfo.message ? ` · ${v.campaignInfo.message}` : ''}${v.campaignInfo.dateFrom ? ` · du ${v.campaignInfo.dateFrom}${v.campaignInfo.dateTo ? ` au ${v.campaignInfo.dateTo}` : ''}` : ''}</div>
                  </div>
                </div>
              `}
            ` : html`
              <div style="padding:12px 14px;border-radius:10px;background:rgba(141,29,44,0.06);border:1px solid rgba(141,29,44,0.2);font-size:12.5px;color:var(--accent);line-height:1.5;">Aucune campagne dans la liste. <button onClick=${v.goCampaigns} style="background:none;border:none;padding:0;color:var(--accent);font-weight:500;text-decoration:underline;cursor:pointer;font-size:12.5px;">Créer une campagne →</button></div>
            `}
            </div>`}
          </div>
        `}

        ${v.isCampaign && html`
          <div style=${secCard}>
            ${secHead('motion', 'Mouvement', v.motionSummary)}
            ${secOpen('motion') && html`<div style=${secBody}>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
              ${v.motionSimple.map((o) => html`<button onClick=${o.pick} style=${o.style}>${o.label}</button>`)}
            </div>
            </div>`}
          </div>
        `}

        ${v.isHtml && html`
          <div style=${secCard}>
            ${secHead('htmlcode', 'Code HTML', v.htmlSummary)}
            ${secOpen('htmlcode') && html`<div style=${secBody}>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;max-width:420px;">Colle ici ton <strong>code HTML</strong> (document complet ou fragment) : il est mis à l'échelle de l'écran. Les <strong>variables</strong> ci-dessous sont remplacées <strong>par magasin</strong> à la diffusion.</p>
            </div>

            <!-- Format source de la maquette : ratio + dimensions -->
            <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">Format de la maquette collée <span style="font-weight:400;">— ratio ${v.htmlRatio}</span></label>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;">
              ${v.htmlPresets.map((p) => html`
                <button onClick=${p.pick} title=${`${p.w} × ${p.h} px`} style="padding:8px 13px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;${p.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${p.label}</button>
              `)}
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
              <input type="number" min="64" max="20000" value=${v.htmlW} onInput=${v.onHtmlW} title="Largeur de la maquette (px)" style="width:104px;padding:9px 11px;font-size:13.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
              <span style="color:var(--muted);font-size:13px;">×</span>
              <input type="number" min="64" max="20000" value=${v.htmlH} onInput=${v.onHtmlH} title="Hauteur de la maquette (px)" style="width:104px;padding:9px 11px;font-size:13.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:right;" />
              <span style="font-size:12px;color:var(--muted);">px · la mise en page (Adapter / Remplir / Étirer) décide du cadrage</span>
            </div>

            <!-- Variables insérables au curseur -->
            <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:7px;">Variables — clique pour insérer dans le code</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
              ${v.htmlTokens.map((t) => html`
                <button onClick=${t.insert} title=${t.label} style="padding:5px 11px;font-size:12px;font-weight:500;font-family:ui-monospace,monospace;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">${t.token}</button>
              `)}
            </div>

            <!-- Variables détectées dans le code, à lier aux données -->
            ${v.htmlVarRows.length ? html`
              <div style="margin-bottom:14px;padding:12px 13px;border-radius:10px;background:var(--paper);border:1px solid var(--line);">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;">
                  ${infoTip('Chaque {{ variable }} trouvée dans ton code est listée ici. Lie-la à une donnée (produit, promotion, campagne, magasin) ou à une valeur libre : elle sera remplacée à la diffusion, magasin par magasin. Une variable laissée « non liée » retombe sur les jetons standards ({{magasin}}, {{date}}…) ou reste visible telle quelle. Les constantes de marque comme {{ logo }} sont résolues d’office — rien à lier.')}
                  <span style="font-size:12px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--accent);">Variables détectées — ${v.htmlVarsSummary}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:7px;">
                  ${v.htmlVarRows.map((r) => html`
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      <button onClick=${r.select} title="Cliquer pour placer cette variable à l'écran" style="flex:0 0 auto;min-width:120px;text-align:left;font-family:ui-monospace,monospace;font-size:12px;font-weight:500;cursor:pointer;color:${(r.bound || r.isBrandAuto) ? '#2E6E4E' : '#8D1D2C'};background:${(r.bound || r.isBrandAuto) ? 'rgba(63,122,82,0.10)' : 'rgba(141,29,44,0.07)'};border:1px solid ${r.selected ? '#232220' : 'transparent'};border-radius:6px;padding:5px 9px;">${'{{ ' + r.name + ' }}'}${r.moved ? html`<span style="font-weight:400;opacity:0.7;"> ⤧</span>` : ''}</button>
                      <select value=${r.src} onChange=${r.onSrc} style="flex:0 0 auto;padding:7px 9px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                        <option value="">${r.isBrandAuto ? '✓ auto — identité de marque' : '— non liée —'}</option>
                        ${r.sources.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
                      </select>
                      ${r.isBrandAuto && html`<img src=${r.brand} alt="" style="flex:0 0 auto;height:22px;width:auto;max-width:80px;object-fit:contain;" />`}
                      ${r.needsPick && html`
                        <select value=${r.value} onChange=${r.onValue} style="flex:1 1 130px;min-width:0;padding:7px 9px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                          <option value="">— choisir —</option>
                          ${r.pickOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                        </select>
                      `}
                      ${r.fields.length ? html`
                        <select value=${r.field} onChange=${r.onField} style="flex:0 0 auto;padding:7px 9px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                          ${r.fields.map((f) => html`<option value=${f.id}>${f.label}</option>`)}
                        </select>
                      ` : ''}
                      ${r.isLiteral && html`
                        <input value=${r.value} onInput=${r.onValue} placeholder="valeur affichée" style="flex:1 1 150px;min-width:0;padding:7px 10px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                      `}
                      ${r.bound && html`<button onClick=${r.clear} title="Délier" style="flex:0 0 auto;width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:11px;color:var(--accent);">✕</button>`}
                    </div>
                    ${r.selected && html`
                      <div style="margin:2px 0 6px 8px;padding:10px 12px;border-radius:8px;background:#fff;border:1px solid var(--line);display:flex;flex-direction:column;gap:8px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                          <span style="font-size:11.5px;color:var(--muted);">Place à l'écran — décalage en px de la maquette</span>
                          <span style="display:flex;align-items:center;gap:4px;">
                            <button onClick=${() => r.nudge(0, -10)} title="Monter" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;">↑</button>
                            <button onClick=${() => r.nudge(0, 10)} title="Descendre" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;">↓</button>
                            <button onClick=${() => r.nudge(-10, 0)} title="Gauche" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;">←</button>
                            <button onClick=${() => r.nudge(10, 0)} title="Droite" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;">→</button>
                            <button onClick=${r.resetPos} title="Remettre à zéro" style="padding:4px 10px;font-size:11.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;color:var(--muted);">Recentrer</button>
                          </span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                          <span style="font-size:11.5px;color:var(--muted);width:14px;">X</span>
                          <input type="range" min="-800" max="800" step="5" value=${r.x} onInput=${r.onX} style="flex:1 1 auto;accent-color:var(--accent);" />
                          <span style="font-size:11.5px;font-weight:500;width:52px;text-align:right;font-variant-numeric:tabular-nums;">${r.x} px</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                          <span style="font-size:11.5px;color:var(--muted);width:14px;">Y</span>
                          <input type="range" min="-800" max="800" step="5" value=${r.y} onInput=${r.onY} style="flex:1 1 auto;accent-color:var(--accent);" />
                          <span style="font-size:11.5px;font-weight:500;width:52px;text-align:right;font-variant-numeric:tabular-nums;">${r.y} px</span>
                        </div>
                      </div>
                    `}
                  `)}
                </div>
              </div>
            ` : ''}

            <!-- Éditeur de code (non contrôlé : la saisie résiste aux re-rendus) -->
            <textarea id="sig-html-editor" key=${'html-' + v.selId} defaultValue=${v.htmlCode} onInput=${v.onHtmlCode} spellcheck="false" placeholder="Colle ton HTML ici — ex. une affiche générée, un gabarit…" style="width:100%;box-sizing:border-box;min-height:280px;padding:12px 13px;font-size:12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid var(--line);border-radius:10px;background:#fff;resize:vertical;"></textarea>
            <p style="margin:9px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">Les polices <strong>Gotham</strong> et <strong>Vank</strong> et les images de <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">assets/</code> sont déjà disponibles — pas besoin de redéclarer <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">@font-face</code>. Les <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">&lt;script&gt;</code> et gestionnaires d'événements sont retirés à l'affichage (sécurité) ; les <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">&lt;style&gt;</code> sont conservés.</p>
            </div>`}
          </div>
        `}

        ${v.isFilmEl && html`
          <div style=${secCard}>
            ${secHead('video', 'Vidéo', v.videoSummary)}
            ${secOpen('video') && html`<div style=${secBody}>
            <!-- bascule : vidéo unique / vidéo surprise (dossier serveur) -->
            <div style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;margin-bottom:14px;">
              <button onClick=${() => { if (v.isSurprise) v.toggleSurprise(); }} style="padding:7px 14px;font-size:12.5px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${!v.isSurprise ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}">Vidéo unique</button>
              <button onClick=${() => { if (!v.isSurprise) v.toggleSurprise(); }} style="padding:7px 14px;font-size:12.5px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${v.isSurprise ? 'background:#fff;color:var(--muted-2);' : 'background:transparent;color:var(--muted);'}">Vidéo surprise</button>
            </div>

            ${!v.isSurprise && html`
              <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">mp4 ou webm, <strong>8 Mo max</strong> (compresse en 1080p/H.264). Lue en boucle, sans le son, pendant la durée choisie.</p>
              ${v.hasVideo && html`
                <!-- La vignette montre le MÊME cadrage que l'écran, sinon elle ment. -->
                <video src=${v.videoPreview} muted autoplay loop playsinline style="width:100%;aspect-ratio:${W} / ${H};object-fit:${v.vidFit};border-radius:12px;background:${v.bgSwatch};margin-bottom:10px;"></video>
              `}
              <div style="display:flex;gap:10px;">
                <label style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;font-size:13px;font-weight:500;color:var(--accent);border:1px dashed rgba(141,29,44,0.4);border-radius:10px;background:rgba(141,29,44,0.04);cursor:pointer;">
                  <span style="display:inline-flex;">${icon(ICON.upload, 15)}</span><span>${v.hasVideo ? 'Remplacer la vidéo' : 'Importer une vidéo'}</span>
                  <input type="file" accept="video/mp4,video/webm,video/*" onChange=${v.onVideoFile} style="display:none;" />
                </label>
                ${v.hasVideo && html`<button onClick=${v.clearVideo} style="padding:11px 16px;font-size:13px;font-weight:500;color:var(--accent);background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:10px;cursor:pointer;">Retirer</button>`}
              </div>

              <!-- Cadrage : remplir/adapter, puis déplacer et zoomer -->
              ${v.hasVideo && html`
                <div style="margin-top:14px;padding-top:13px;border-top:1px dashed var(--line);">
                  <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;">
                    <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Cadrage à l'écran</span>
                    ${infoTip('« Adapter » montre TOUTE la vidéo, avec des bandes noires si son format diffère de l’écran. « Remplir » couvre l’écran et recadre les bords — les flèches choisissent alors la partie visible, et le zoom règle la taille.')}
                  </div>
                  <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
                    <span style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;height:fit-content;">
                      ${[['contain', '▭ Adapter (tout voir)'], ['cover', '◼ Remplir (recadrer)']].map(([id, lab]) => html`
                        <button onClick=${() => v.setVidFit(id)} style="padding:7px 13px;font-size:12.5px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${v.vidFit === id ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}">${lab}</button>
                      `)}
                    </span>
                    <!-- pavé de flèches -->
                    <div style="display:grid;grid-template-columns:repeat(3,30px);grid-template-rows:repeat(3,30px);gap:3px;">
                      <span></span>
                      <button onClick=${() => v.nudgeVid(0, -1)} title="Monter la vidéo" style="border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">↑</button>
                      <span></span>
                      <button onClick=${() => v.nudgeVid(-1, 0)} title="Décaler à gauche" style="border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">←</button>
                      <button onClick=${v.resetVid} title="Recentrer et remettre le zoom à 1×" style="border-radius:8px;border:1px solid var(--line);background:${v.vidMoved ? 'rgba(141,29,44,0.10)' : '#fff'};color:${v.vidMoved ? '#8D1D2C' : '#8A847C'};cursor:pointer;font-size:11px;">⌖</button>
                      <button onClick=${() => v.nudgeVid(1, 0)} title="Décaler à droite" style="border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">→</button>
                      <span></span>
                      <button onClick=${() => v.nudgeVid(0, 1)} title="Descendre la vidéo" style="border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:12px;">↓</button>
                      <span></span>
                    </div>
                    <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">
                      <span>Zoom · ${v.vidZoom.toFixed(2)}×</span>
                      <span style="display:inline-flex;align-items:center;gap:7px;">
                        <button onClick=${() => v.zoomVid(-1)} title="Réduire" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:13px;">−</button>
                        <input type="range" min="0.5" max="4" step="0.05" value=${v.vidZoom} onInput=${v.onVidZoom} style="width:150px;" />
                        <button onClick=${() => v.zoomVid(1)} title="Agrandir" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:13px;">+</button>
                      </span>
                    </label>
                  </div>
                  ${v.vidMoved ? html`<p style="margin:9px 0 0;font-size:11.5px;color:var(--muted);">Décalage ${v.vidX > 0 ? '+' : ''}${v.vidX} px · ${v.vidY > 0 ? '+' : ''}${v.vidY} px — ⌖ pour recentrer.</p>` : ''}

                  <!-- Couleur de fond : palette de la marque + teinte libre -->
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:13px;">
                    <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">
                      Couleur de fond${infoTip('Ce qu’on voit AUTOUR de la vidéo quand elle ne remplit pas l’écran (mode « adapter », ou zoom réduit). La liste reprend la palette de la marque ; « teinte libre » ouvre le nuancier pour un cas particulier.')}
                    </span>
                    <span title=${v.bgName} style="width:26px;height:26px;flex:0 0 auto;border-radius:8px;border:1px solid rgba(35,34,32,0.22);background:${v.bgSwatch};"></span>
                    <select value=${v.bgColor} onChange=${v.onBgPick} style="flex:1 1 190px;min-width:0;padding:8px 10px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                      ${v.bgOptions.map((c) => html`<option value=${c.id ? c.hex : ''}>${c.name}</option>`)}
                      ${v.bgIsCustom ? html`<option value=${v.bgColor}>Teinte libre (${v.bgColor})</option>` : ''}
                    </select>
                    <label title="Teinte libre" style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);cursor:pointer;">
                      <input type="color" value=${v.bgSwatch} onChange=${v.onBgCustom} style="width:32px;height:28px;padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;" />
                      libre
                    </label>
                  </div>
                </div>
              `}
            `}

            ${v.isSurprise && html`
              <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">Le player pioche <strong>une vidéo au hasard</strong> dans le dossier serveur <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">public/surprise/</code> à chaque diffusion — pour surprendre le client. Ajoute des vidéos ici (≤ 18 Mo) ou dépose-les directement dans le dossier par SFTP (gros fichiers).</p>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
                <span style="font-size:12.5px;font-weight:500;color:var(--muted-2);">${v.surpriseList.length} vidéo(s) dans le dossier</span>
                <button onClick=${v.refreshSurprise} style="padding:6px 12px;font-size:12px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">⟳ Rafraîchir</button>
              </div>
              ${v.surpriseList.length ? html`
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                  ${v.surpriseList.map((vid) => html`
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 11px;border-radius:8px;background:#fff;border:1px solid var(--line);">
                      <span style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎬 ${vid.name}</span>
                      <span style="display:flex;align-items:center;gap:9px;flex:0 0 auto;">
                        <span style="font-size:11px;color:var(--muted);">${Math.round((vid.size || 0) / 1024 / 1024 * 10) / 10} Mo</span>
                        <button onClick=${() => v.delSurprise(vid.name)} title="Supprimer du dossier" style="width:22px;height:22px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:var(--accent);">✕</button>
                      </span>
                    </div>
                  `)}
                </div>
              ` : html`<p style="margin:0 0 12px;font-size:12px;color:var(--faint);">Dossier vide — ajoute au moins une vidéo.</p>`}
              <label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;font-size:13px;font-weight:500;color:var(--muted-2);border:1px dashed rgba(92,88,82,0.45);border-radius:10px;background:rgba(92,88,82,0.05);cursor:${v.surpriseBusy ? 'wait' : 'pointer'};">
                <span style="display:inline-flex;">${icon(ICON.upload, 15)}</span><span>${v.surpriseBusy ? 'Envoi…' : 'Ajouter des vidéos au dossier'}</span>
                <input type="file" accept="video/mp4,video/webm,video/*" multiple onChange=${v.onSurpriseFiles} style="display:none;" />
              </label>
            `}
            </div>`}
          </div>
        `}

        ${v.isAnim && html`
          <div style=${secCard}>
            ${secHead('anim', 'Visuel', v.animSummary)}
            ${secOpen('anim') && html`<div style=${secBody}>
            <div style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;margin-bottom:14px;">
              ${[['texte', '✦ Texte animé'], ['fichier', '🎞 Fichier d\'animation']].map(([id, lab]) => html`
                <button onClick=${() => v.setAnimMode(id)} style="padding:7px 14px;font-size:12.5px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${v.animMode === id ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}">${lab}</button>
              `)}
            </div>
            <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">
              ${v.animMode === 'fichier'
                ? html`Le fichier importé <strong>remplace</strong> le rendu généré : l'élément devient un conteneur. Formats acceptés : <strong>GIF</strong>, PNG, WebP, <strong>SVG animé</strong>, <strong>MP4 / WebM</strong> et <strong>Lottie (.json)</strong> — 18 Mo max.`
                : html`Le titre et l'accroche restent générés (jetons <code style="background:var(--chip);padding:1px 5px;border-radius:4px;">{{magasin}}</code> compris). Tu peux poser un <strong>visuel de fond</strong> derrière — image ou vidéo — avec un voile qui garde le texte lisible.`}
            </p>
            ${(() => {
              const isFile = v.animMode === 'fichier';
              const url = isFile ? v.animFile : v.animBg;
              const kind = isFile ? v.animFileKind : v.animBgKind;
              const onPick = isFile ? v.onAnimFilePick : v.onAnimBgPick;
              const onUrl = isFile ? v.onAnimFileUrl : v.onAnimBgUrl;
              const clear = isFile ? v.clearAnimFile : v.clearAnimBg;
              const label = isFile ? 'fichier d\'animation' : 'visuel de fond';
              return html`
                ${url && html`<div style="margin-bottom:10px;border-radius:12px;overflow:hidden;background:var(--chip);border:1px solid var(--line);">
                  ${kind === 'video'
                    ? html`<video src=${url} muted autoplay loop playsinline style="width:100%;display:block;max-height:200px;object-fit:contain;background:#000;"></video>`
                    : (kind === 'lottie'
                      ? html`<div style="padding:16px 14px;font-size:12.5px;color:var(--muted-2);">🅛 Animation Lottie — aperçu dans l'écran ci-dessus (le lecteur se charge à la demande).</div>`
                      : html`<img src=${url} alt="" style="width:100%;display:block;max-height:200px;object-fit:contain;" />`)}
                </div>`}
                <div style="display:flex;gap:10px;margin-bottom:10px;">
                  <label style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;font-size:13px;font-weight:500;color:var(--accent);border:1px dashed rgba(141,29,44,0.4);border-radius:10px;background:rgba(141,29,44,0.04);cursor:${v.animBusy ? 'wait' : 'pointer'};">
                    <span style="display:inline-flex;">${icon(ICON.upload, 15)}</span><span>${v.animBusy ? 'Envoi…' : (url ? `Remplacer le ${label}` : `Importer un ${label}`)}</span>
                    <input type="file" accept=".gif,.png,.webp,.svg,.jpg,.jpeg,.avif,.mp4,.webm,.mov,.m4v,.json,image/*,video/*,application/json" onChange=${onPick} style="display:none;" />
                  </label>
                  ${url && html`<button onClick=${clear} style="padding:11px 16px;font-size:13px;font-weight:500;color:var(--accent);background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:10px;cursor:pointer;">Retirer</button>`}
                </div>
                <label style="display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">
                  <span>…ou une adresse (fichier déjà sur le serveur)</span>
                  <input key=${'au-' + (isFile ? 'f' : 'b') + v.selId} defaultValue=${url} onChange=${onUrl} placeholder="anim/mon-animation.gif · media/clip.mp4 · https://…" spellcheck="false" style="padding:9px 11px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                </label>`;
            })()}
            <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;">
              <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">
                <span style="display:inline-flex;align-items:center;gap:5px;">Cadrage${infoTip('« Remplir » couvre tout l’écran, quitte à rogner les bords. « Adapter » montre le fichier en entier, avec des bandes si le format diffère.')}</span>
                <span style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;">
                  ${[['cover', 'Remplir'], ['contain', 'Adapter']].map(([id, lab]) => html`
                    <button onClick=${() => v.setAnimFit(id)} style="padding:6px 12px;font-size:12px;font-weight:500;border:none;border-radius:6px;cursor:pointer;${v.animFit === id ? 'background:#fff;color:var(--ink);' : 'background:transparent;color:var(--muted);'}">${lab}</button>
                  `)}
                </span>
              </label>
              ${v.animMode !== 'fichier' && v.animBg && html`
                <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">
                  <span style="display:inline-flex;align-items:center;gap:5px;">Voile sur le fond · ${v.animDim} %${infoTip('Assombrit le visuel de fond pour que le titre reste lisible. 0 % = fond brut.')}</span>
                  <input type="range" min="0" max="90" value=${v.animDim} onInput=${v.onAnimDim} style="width:200px;" />
                </label>
              `}
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
            <p style="margin:0 0 16px;font-size:12px;color:var(--muted);line-height:1.5;">Réglable indépendamment par élément.</p>
            <div style="display:flex;flex-direction:column;gap:14px;">
              ${v.motionGroups.map((g) => html`
                <div>
                  <label style="display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-bottom:6px;">${g.label}</label>
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
              <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.5;">Ajuste finement titre, liste et illustration par-dessus la mise en page.</p>
              <button onClick=${v.resetPos} style="flex:0 0 auto;padding:7px 12px;font-size:12px;font-weight:500;color:var(--muted);background:var(--paper);border:1px solid var(--line);border-radius:8px;cursor:pointer;">Réinitialiser</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${v.posFields.map((pf) => html`
                <div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label style="font-size:12.5px;font-weight:500;color:var(--muted);">${pf.label}</label>
                    <span style="font-size:12.5px;font-weight:500;font-variant-numeric:tabular-nums;">${pf.display}</span>
                  </div>
                  <input type="range" min=${pf.min} max=${pf.max} step=${pf.step} value=${pf.value} onInput=${pf.onInput} style="width:100%;accent-color:var(--accent);" />
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
              <span style="font-size:11.5px;font-weight:500;color:var(--green);background:var(--green-soft);border:none;border-radius:999px;padding:3px 10px;">⛓ ${v.linkedCatName}</span>
            </div>
            <p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5;">Les lignes viennent de la table produits : noms, prix (et prix par magasin), actifs/inactifs suivent automatiquement. Modifie-les dans la table.</p>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
              ${v.linkedRows.map((r) => html`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:${r.active ? '#fff' : 'rgba(35,34,32,0.04)'};opacity:${r.active ? 1 : 0.55};">
                  <span style="font-size:13.5px;font-weight:500;">${r.name}${r.active ? '' : ' · masqué'}</span>
                  <span style="font-size:13.5px;font-weight:500;color:var(--accent);">${r.price} €</span>
                </div>
              `)}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button onClick=${v.goProducts} style="flex:1 1 auto;padding:11px 14px;font-size:13px;font-weight:500;color:#fff;background:var(--accent);border:none;border-radius:10px;cursor:pointer;">▦ Ouvrir la table produits</button>
              <select value=${v.curCatRef} onChange=${v.onLinkCat} style="flex:1 1 auto;padding:10px 12px;font-size:13px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;">
                ${v.catOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
              </select>
              <button onClick=${v.doUnlinkCat} title="Copier les lignes dans l'élément et reprendre la main" style="padding:11px 14px;font-size:13px;font-weight:500;color:var(--accent);background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:10px;cursor:pointer;">Délier</button>
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
                <select value="" onChange=${v.onLinkCat} title="Les lignes viendront de la table produits" style="padding:8px 10px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;max-width:230px;">
                  <option value="">⛓ Lier à la table produits…</option>
                  ${v.catOptions.map((o) => html`<option value=${o.id}>${o.label}</option>`)}
                </select>
                <button onClick=${v.addItem} style="padding:8px 14px;font-size:12.5px;font-weight:500;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer;">+ Ajouter</button>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${v.items.map((it) => html`
                <div style=${it.wrapStyle}>
                  <div style="display:flex;align-items:center;gap:11px;">
                    ${it.thumb}
                    <input value=${it.name} onInput=${it.onName} placeholder="Nom du produit" style="flex:1 1 auto;min-width:0;padding:10px 12px;font-size:15px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                    <div style="position:relative;flex:0 0 104px;">
                      <input value=${it.price} onInput=${it.onPrice} placeholder="0,00" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:10px 24px 10px 12px;font-size:15px;font-weight:500;text-align:right;color:var(--accent);border:1px solid var(--line);border-radius:8px;background:#fff;" />
                      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--muted);pointer-events:none;">€</span>
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
                    <div style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;">
                      <button onClick=${it.setIllus} style=${it.illusTabStyle}>Illustration</button>
                      <button onClick=${it.setPhoto} style=${it.photoTabStyle}>Photo</button>
                    </div>
                    ${infoTip(PHOTO_TIP)}
                    ${it.isIllus && html`
                      <select value=${it.img} onChange=${it.onImg} style="flex:1 1 auto;padding:9px 10px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
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
                      <label style="flex:1 1 auto;display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:12.5px;color:var(--muted);border:1px dashed rgba(35,34,32,0.28);border-radius:8px;background:var(--paper);cursor:pointer;">
                        <span style="display:inline-flex;">${icon(ICON.upload, 15)}</span><span>${it.photoLabel}</span>
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

    <section style="overflow:auto;padding:24px 26px 40px;background:var(--paper);">
      ${previewBlock}
    </section>

  </div>
  `}

  ${v.isComposerView && v.isTimelineTab && html`
  <div class="app__body app__body--wide">
    <div style="display:flex;flex-direction:column;gap:16px;">

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Bibliothèque de films — choisis une catégorie, puis un film à éditer</h3>
          <span style="font-size:12px;color:var(--muted);">film courant : <strong style="color:var(--ink);">${this.activeFilm().name}</strong> · ${v.timelineTotal} · ${v.moduleCount} module(s)</span>
        </div>
        ${filmSelector}
        ${filmModeToggle}
      </div>

      ${filmMode === 'continu' ? contPanel : html`
      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Bibliothèque — choisis d'abord l'orientation de l'écran, puis une catégorie, et glisse un élément sur la ligne du temps (ou clique ＋)</h3>
        <!-- 1 · Orientation de l'écran : filtre principal du montage -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--line);">
          <span style="font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">1 · Orientation de l'écran</span>
          ${v.libOrientChips.map((o) => html`
            <button onClick=${o.pick} style=${o.style}><span>${o.icon}</span>${o.label}<span style="font-weight:400;opacity:0.75;">${o.count}</span></button>
          `)}
        </div>
        <!-- 2 · Catégorie de bibliothèque -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">2 · Catégorie</span>
          ${v.libTagChips.map((t) => html`
            <button onClick=${t.pick} style=${t.style}><span style=${t.dotStyle}></span>${t.label}<span style="font-weight:400;opacity:0.75;">${t.count}</span></button>
          `)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${v.libCards.map((c) => html`
            <div draggable="true" onDragStart=${c.onDragStart} style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--paper);border:1px solid ${c.tagColor}44;border-left:4px solid ${c.tagColor};cursor:grab;">
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;flex:0 0 auto;font-size:11px;background:${c.tagColor}1F;color:${c.tagColor};">${c.typeIcon}</span>
              <div style="min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:12.5px;font-weight:500;white-space:nowrap;">${c.name}</span>
                  <span style="font-size:9px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:${c.tagColor};">${c.tagLabel}</span>
                </div>
                <div style="font-size:10px;color:var(--muted);">${c.meta}${c.inFilm ? '' : ' · hors film'}</div>
              </div>
              <button onClick=${c.add} title="Ajouter à la fin du film" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:500;flex:0 0 auto;">＋</button>
              <button onClick=${c.edit} title="Éditer dans la bibliothèque" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,0.8);border:1px solid var(--line);cursor:pointer;font-size:11px;flex:0 0 auto;">✎</button>
            </div>
          `)}
          ${v.libEmptyMsg && html`<div style="font-size:12px;color:var(--muted);padding:8px 4px;">${v.libEmptyMsg}</div>`}
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Ligne du temps · « ${this.activeFilm().name} »</h3>
        <div onDragOver=${v.timelineEndDrop.onDragOver} onDrop=${v.timelineEndDrop.onDrop} style="display:flex;align-items:stretch;gap:7px;overflow-x:auto;padding:12px;background:var(--chip);border-radius:12px;min-height:96px;">
          ${v.timelineBlocks.map((b) => html`
            <div class="tl-block pl-item" draggable="true" onClick=${b.jump} onDragStart=${b.onDragStart} onDragOver=${b.onDragOver} onDragLeave=${b.onDragLeave} onDrop=${b.onDrop} onDragEnd=${b.onDragEnd} style="${b.blockStyle}width:${b.width}px;" title="Clique pour caler l'aperçu sur ce bloc">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <span style="font-size:10px;font-weight:500;opacity:0.7;">${b.order}</span>
                <button onClick=${b.remove} title="Retirer du film (reste en bibliothèque)" style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:rgba(0,0,0,0.08);border:none;cursor:pointer;font-size:10px;color:inherit;">✕</button>
              </div>
              <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.typeIcon} ${b.name}</div>
              <div style="font-size:10px;opacity:0.7;font-variant-numeric:tabular-nums;">${b.durLabel}</div>
            </div>
          `)}
          ${v.playlistEmpty && html`
            <div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-size:12.5px;color:var(--faint);border:1px dashed rgba(35,34,32,0.2);border-radius:10px;padding:18px;">Glisse ici les éléments de la bibliothèque pour composer le film</div>
          `}
          <div style="flex:1 1 64px;min-width:64px;border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:18px;" title="Dépose ici pour ajouter à la fin">＋</div>
        </div>
        <p style="margin:10px 0 0;font-size:11.5px;color:var(--muted);">Clique un bloc pour caler l'aperçu dessus · glisse pour réordonner · ✕ retire (l'élément reste en bibliothèque) · la largeur d'un bloc reflète sa durée.</p>
      </div>`}

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Rangement du film — catégorie & tags</h3>
        <div style="display:flex;gap:28px;flex-wrap:wrap;">
          <div>
            <div style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;">Catégorie</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmCatVals.map((c) => html`<button onClick=${c.pick} style=${c.style}><span style=${c.dotStyle}></span>${c.label}</button>`)}
            </div>
          </div>
          <div style="flex:1 1 260px;min-width:240px;">
            <div style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;">Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              ${v.filmTagVals.map((t) => html`
                <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 6px 5px 11px;font-size:12px;font-weight:500;border-radius:999px;background:var(--chip);border:1px solid var(--line);">#${t.label}
                  <button onClick=${t.remove} title="Retirer le tag" style="display:flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:10px;color:var(--accent);">✕</button>
                </span>`)}
              <input value=${v.filmTagInput} onInput=${v.onFilmTagInput} onKeyDown=${v.onFilmTagKey} placeholder="+ tag (Entrée)" style="flex:0 1 140px;min-width:110px;padding:6px 10px;font-size:12px;border:1px solid var(--line);border-radius:999px;background:#fff;" />
            </div>
          </div>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Programmation & magasins du film</h3>
            ${infoTip('Priorité : si un magasin a un PLANNING (onglet Planning) qui couvre l’heure courante, c’est le planning qui décide quel film passe sur cet écran. Sinon, ces réglages-ci s’appliquent (jours + fenêtre horaire + magasins ciblés à la publication). En clair : le planning gagne quand il existe, le film sert de réglage par défaut.')}
          </span>
          <span style="font-size:12px;color:var(--muted);">${v.filmSchedSummary}</span>
        </div>
        <div style="display:flex;gap:28px;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
              <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Jours de diffusion</span>
              ${infoTip('Quand le film PASSE réellement à l’écran. Hors de ces jours, l’écran affiche l’attente. À ne pas confondre avec les « Jours de planning » (dans l’onglet Planning), qui ne servent qu’à filtrer les films proposés lors du remplissage du planning hebdo.')}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmDaysVals.map((d) => html`<button onClick=${d.toggle} style=${d.style}>${d.label}</button>`)}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;">Fenêtre horaire</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${v.filmSlotVals.map((s) => html`<button onClick=${s.pick} style=${s.style}>${s.label}</button>`)}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;">Magasins</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <button onClick=${v.filmAllStores.pick} style=${v.filmAllStores.style}>Tous</button>
              ${v.filmStoreVals.map((s) => html`<button onClick=${s.toggle} style=${s.style}>${s.label}</button>`)}
            </div>
          </div>
        </div>
        <p style="margin:12px 0 0;font-size:11.5px;color:var(--muted);">Hors créneau, les écrans affichent l'attente (le lien de partage montre toujours le film). « Tous » = le film part sur tout le réseau à la publication.</p>

        <!-- Contenu du film filtré par moment de vente (matin / midi / après-midi) -->
        <div style="margin-top:14px;padding-top:13px;border-top:1px solid var(--line);">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            ${infoTip('Aperçu du contenu réellement diffusé à chaque moment de la journée. Un produit n’est retenu que s’il est vendu à ce créneau (table « Périodes de vente », onglet Périodes) ; sans aucune règle il passe à tous les moments. Un élément dont tous les produits sont hors créneau est signalé — il serait sauté à l’écran.')}
            <span style="font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Contenu par moment · ${v.libOrient === 'portrait' ? '9:16 portrait' : '16:9 paysage'}</span>
            ${v.filmMomentTabs.map((mo) => html`
              <button onClick=${mo.pick} style="padding:6px 13px;font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;${mo.active ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">${mo.label}${mo.isNow ? ' ●' : ''}</button>
            `)}
          </div>
          ${v.filmMomentRows.length ? html`
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${v.filmMomentRows.map((r) => html`
                <div style="display:flex;align-items:center;gap:9px;padding:7px 11px;border-radius:8px;background:${r.empty ? 'rgba(141,29,44,0.06)' : '#fff'};border:1px solid ${r.empty ? 'rgba(141,29,44,0.25)' : 'rgba(35,34,32,0.08)'};">
                  <span style="flex:0 0 auto;font-size:13px;">${r.icon}</span>
                  <span style="flex:0 0 auto;font-size:12.5px;font-weight:500;min-width:120px;">${r.name}</span>
                  <span style="flex:0 0 auto;font-size:11.5px;color:${r.empty ? '#8D1D2C' : '#8A847C'};">${r.empty ? '⚠ rien à ce moment — élément sauté' : r.detail}</span>
                  ${r.names && html`<span style="flex:1 1 auto;min-width:0;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.names}</span>`}
                </div>
              `)}
            </div>
          ` : html`<p style="margin:0;font-size:12px;color:var(--muted);">Ce film n'a pas encore de contenu.</p>`}
        </div>
      </div>

      ${previewBlock}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-items:start;">
        ${diffusionBlock}
        <div style="background:#FFFFFF;border:1px solid var(--line);border-radius:12px;padding:20px 22px;">
          <h3 style="margin:0 0 12px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">3 · Diffuser</h3>
          <p style="margin:0 0 14px;font-size:12px;color:var(--muted);line-height:1.55;">Un seul geste : <strong>Diffuser</strong>. La <strong>programmation</strong> et les <strong>magasins</strong> se règlent ci-dessus, sur le film ; le lien de visionnage s'affiche juste après.</p>
          <button onClick=${v.openPublish} style="width:100%;box-sizing:border-box;padding:14px 18px;font-size:15px;font-weight:500;border-radius:8px;border:none;cursor:pointer;background:var(--accent);color:#fff;">Diffuser sur le réseau ↗</button>
          <div style="margin-top:9px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted);">
            <span>${v.saved ? '✓ Enregistré automatiquement' : (v.dirty ? '✎ Modifications en cours…' : 'Enregistré automatiquement')}</span>
            <button onClick=${v.save} style="padding:4px 10px;font-size:11px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--muted-2);cursor:pointer;">Enregistrer maintenant</button>
          </div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);line-height:1.5;">Lien direct de ce film (55″) :
            <button onClick=${() => this.copyLink(this.filmUrl({ film: st.activePl, w: 3840, h: 2160 }))} style="margin-left:6px;padding:8px 13px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">⎘ Copier le lien</button>
            <a href=${this.filmUrl({ film: st.activePl, w: 3840, h: 2160 })} target="_blank" style="margin-left:6px;font-size:12px;font-weight:500;">↗ Ouvrir</a>
          </div>
        </div>
      </div>

    </div>
  </div>
  `}

  ${v.onbOpen && html`
    <div onClick=${v.closeOnb} style="position:fixed;inset:0;background:rgba(20,15,12,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:50;">
      <div onClick=${(e) => e.stopPropagation()} style="width:900px;max-width:95vw;max-height:90vh;overflow:auto;background:var(--paper);border-radius:12px;padding:24px 26px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <h2 style="margin:0;font-size:19px;font-weight:500;">Mise en route</h2>
          <button onClick=${v.closeOnb} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--chip);border:1px solid var(--line);cursor:pointer;font-size:14px;">✕</button>
        </div>
        <p style="margin:0 0 16px;font-size:12.5px;color:var(--muted);">Configure chaque magasin pas à pas : écran, langue, test, lien. ${v.onbDoneCount}/${v.onbCount} magasin(s) prêt(s).</p>
        ${v.onbStores.length ? html`
        <div style="display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start;">
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${v.onbStores.map((s) => html`
              <button onClick=${s.pick} style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 13px;border-radius:10px;cursor:pointer;text-align:left;background:${s.on ? '#fff' : 'rgba(255,255,255,0.5)'};border:1px solid ${s.on ? '#8D1D2C' : 'rgba(35,34,32,0.1)'};">
                <span style="font-size:13.5px;font-weight:500;">${s.name}</span>
                <span style="font-size:14px;color:${s.done ? '#2E7D32' : '#C9C3B8'};">${s.done ? '✓' : '○'}</span>
              </button>
            `)}
          </div>
          ${v.onbSel && html`
          <div style="display:flex;flex-direction:column;gap:14px;">

            <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">1 · Écran — ${v.onbSel.name}</h3>
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Combo</span>
                <select value=${v.onbSel.fmt.screens} onChange=${v.onbSel.setScreens} style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                  ${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n}</option>`)}
                </select>
                <span style="font-size:12px;color:var(--muted);">×</span>
                <select value=${v.onbSel.fmt.size} onChange=${v.onbSel.setSize} style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                  ${[32, 43, 49, 55, 65, 75, 85].map((n) => html`<option value=${n}>${n}″</option>`)}
                </select>
                <select value=${v.onbSel.fmt.orient} onChange=${v.onbSel.setOrient} style="padding:7px 9px;font-size:12.5px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">
                  <option value="paysage">paysage</option>
                  <option value="portrait">portrait</option>
                </select>
                <span style="font-size:12.5px;font-weight:500;color:var(--accent);background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.2);border-radius:999px;padding:5px 12px;">= ${v.onbSel.fmt.px}</span>
              </div>
              <div style="margin-top:11px;padding:11px 13px;border-radius:10px;background:${v.onbSel.is4k ? 'rgba(184,134,11,0.08)' : 'rgba(63,122,82,0.07)'};border:1px solid ${v.onbSel.is4k ? 'rgba(184,134,11,0.3)' : 'rgba(63,122,82,0.25)'};">
                <div style="font-size:12px;font-weight:500;color:${v.onbSel.is4k ? '#8a6508' : '#2E6E4E'};margin-bottom:4px;">📶 Débit conseillé — ${v.onbSel.bwReco}</div>
                <div style="font-size:11.5px;color:var(--muted);line-height:1.5;">Repère : 4K H.264 ≈ 25–50 Mbps · 4K H.265/HEVC ≈ 15–25 Mbps · 1080p ≈ 5–10 Mbps. Ça compte surtout pour les <strong>films avec vidéo</strong> (élément Film) en lecture continue ; les menus (images) sont mis en cache sur l'écran et ne consomment qu'au premier chargement.</div>
              </div>
            </div>

            <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">2 · Langue d'affichage</h3>
              <select value=${v.onbSel.lang} onChange=${v.onbSel.setLang} style="padding:8px 12px;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;text-transform:uppercase;">
                ${v.onbSel.langOptions.map((l) => html`<option value=${l.id}>${l.id} — ${l.label}</option>`)}
              </select>
              <span style="font-size:11.5px;color:var(--muted);margin-left:10px;">Les noms de produits s'affichent dans cette langue (alias de la table produits).</span>
            </div>

            <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
                <h3 style="margin:0;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">3 · Test de l'écran</h3>
                <button onClick=${v.onbSel.runTest} style="padding:8px 15px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--green);background:rgba(63,122,82,0.08);color:var(--green);cursor:pointer;">${v.onbSel.test && v.onbSel.test.state === 'testing' ? 'Test…' : '▶ Tester'}</button>
              </div>
              ${v.onbSel.test && v.onbSel.test.state === 'ok' && html`
                <div style="font-size:12.5px;color:var(--green);line-height:1.6;">✓ Lien OK — sert « <strong>${v.onbSel.test.name}</strong> »${v.onbSel.test.plan ? ` (planning : ${v.onbSel.test.plan})` : ''} · ${v.onbSel.test.modules} élément(s) · rendu ${v.onbSel.test.px}${v.onbSel.test.draft ? ' · brouillon (pas encore publié)' : ''}</div>
              `}
              ${v.onbSel.test && v.onbSel.test.state === 'err' && html`<div style="font-size:12.5px;color:var(--accent);">✗ ${v.onbSel.test.error}</div>`}
              ${!v.onbSel.test && html`<div style="font-size:12px;color:var(--muted);">Clique « Tester » pour vérifier que le lien du magasin répond et voir ce qu'il diffuse.</div>`}
            </div>

            <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;">
              <h3 style="margin:0 0 10px;font-size:11.5px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">4 · Lien à mettre sur l'écran</h3>
              <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
                <div style="flex:0 0 auto;text-align:center;">
                  <img src=${qrDataUri(v.onbSel.link)} alt="QR du lien écran" style="width:140px;height:140px;display:block;border:1px solid var(--line);border-radius:10px;background:#fff;" />
                  <div style="font-size:10.5px;color:var(--muted);margin-top:5px;">📱 Scanne pour ouvrir sur l'écran</div>
                </div>
                <div style="flex:1 1 260px;min-width:220px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input readonly value=${v.onbSel.link} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:8px 11px;font-size:11.5px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
                    <button onClick=${v.onbSel.copyLink} style="flex:0 0 auto;padding:8px 14px;font-size:12px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">⎘ Copier</button>
                    <a href=${v.onbSel.link} target="_blank" style="flex:0 0 auto;font-size:12px;font-weight:500;color:var(--accent);">↗</a>
                  </div>
                  <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted);">Ouvre ce lien en plein écran sur l'écran du magasin (mode kiosque), ou scanne le QR depuis la box/TV. Il bascule tout seul selon l'heure si tu as fait un Planning.</p>
                </div>
              </div>
            </div>

            <button onClick=${v.onbSel.toggleDone} style="align-self:flex-start;padding:10px 20px;font-size:13px;font-weight:500;border-radius:8px;cursor:pointer;${v.onbSel.done ? 'background:rgba(63,122,82,0.12);color:var(--green);border:1px solid rgba(63,122,82,0.4);' : 'background:var(--accent);color:#fff;border:none;'}">${v.onbSel.done ? '✓ Magasin configuré — annuler' : 'Marquer ce magasin comme configuré'}</button>

          </div>
          `}
        </div>
        ` : html`<p style="margin:0;font-size:13px;color:var(--muted);">Aucun magasin actif. Fais ⚙ Paramètres → ⟳ Rafraîchir pour importer tes magasins, ou branche un écran.</p>`}
      </div>
    </div>
  `}

  ${v.addPickerOpen && html`
    <div onClick=${v.closeAddPicker} style="position:fixed;inset:0;background:rgba(20,15,12,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:50;">
      <div onClick=${(e) => e.stopPropagation()} style="width:620px;max-width:94vw;max-height:88vh;overflow:auto;background:var(--paper);border-radius:12px;padding:26px 28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="margin:0;font-size:19px;font-weight:500;">Nouvel élément</h2>
          <button onClick=${v.closeAddPicker} style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--chip);border:1px solid var(--line);cursor:pointer;font-size:14px;">✕</button>
        </div>
        <p style="margin:0 0 16px;font-size:12.5px;color:var(--muted);">Choisis le type — chaque type a ses propres mises en page.</p>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
          ${v.typeCards.map((t) => html`
            <button onClick=${t.pick} style="text-align:left;display:flex;gap:13px;align-items:flex-start;padding:15px 16px;border-radius:12px;cursor:pointer;background:#fff;border:1px solid var(--line);">
              <span style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;flex:0 0 auto;font-size:18px;background:rgba(141,29,44,0.1);color:var(--accent);">${t.icon}</span>
              <span style="min-width:0;">
                <span style="display:block;font-size:14px;font-weight:500;margin-bottom:3px;">${t.label}</span>
                <span style="display:block;font-size:11.5px;color:var(--muted);line-height:1.45;">${t.descr}</span>
              </span>
            </button>
          `)}
        </div>
      </div>
    </div>
  `}

  ${v.publishing && html`
    <div onClick=${v.closePublish} style="position:fixed;inset:0;background:rgba(35,34,32,0.55);z-index:20;display:flex;align-items:center;justify-content:center;padding:30px;">
      <div onClick=${v.stop} style="background:var(--chip);border-radius:12px;width:640px;max-width:100%;max-height:90vh;overflow:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 26px;border-bottom:1px solid var(--line);">
          <div>
            <h2 style="margin:0;font-size:19px;font-weight:500;">Publier sur le réseau</h2>
            <p style="margin:4px 0 0;font-size:12.5px;color:var(--muted);">Déploiement atomique · le player bascule quand tous les médias sont en cache</p>
          </div>
          <button onClick=${v.closePublish} style="width:34px;height:34px;border-radius:50%;border:none;background:rgba(35,34,32,0.08);cursor:pointer;font-size:15px;">✕</button>
        </div>
        ${st.pubDone && html`
        <div style="padding:26px;display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <span style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:rgba(63,122,82,0.14);color:var(--green);font-size:22px;flex:0 0 auto;">✓</span>
            <div>
              <div style="font-size:16px;font-weight:500;">Film « ${st.pubDone.name} » ${st.pubDone.scheduled ? 'planifié' : 'déployé'} · v${st.pubDone.version}</div>
              <div style="font-size:12.5px;color:var(--muted);">${st.pubDone.playerCount} écran(s) ciblés · tests live ${st.pubDone.testsOk}/${st.pubDone.testsTotal} OK</div>
            </div>
          </div>
          <div style="background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px;">
            <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Ton lien pour voir le film (public · 55″)</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <input readonly value=${st.pubDone.url} onClick=${(e) => e.target.select()} style="flex:1 1 auto;min-width:0;padding:9px 11px;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              <button onClick=${() => this.copyLink(st.pubDone.url)} style="flex:0 0 auto;padding:9px 14px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;">Copier</button>
              <a href=${st.pubDone.url} target="_blank" style="flex:0 0 auto;padding:9px 12px;font-size:12.5px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);">↗ Ouvrir</a>
            </div>
            <p style="margin:10px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5;">Les liens par magasin sont dans ⚙ Paramètres → Liens de diffusion. Les écrans basculent automatiquement dès leur cache prêt.</p>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button onClick=${v.closePublish} style="padding:9px 18px;font-size:13px;font-weight:500;border-radius:8px;border:none;cursor:pointer;background:var(--accent);color:#fff;">Voir le réseau →</button>
          </div>
        </div>
        `}
        ${!st.pubDone && html`
        <div style="padding:24px 26px;display:flex;flex-direction:column;gap:22px;">
          <div>
            <h3 style="margin:0 0 10px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Type de synchronisation</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <button onClick=${v.setModeFull} style=${v.modeFullStyle}>
                <span style="display:block;font-size:14px;font-weight:500;margin-bottom:3px;">Playlist complète</span>
                <span style="font-size:11.5px;color:var(--muted);line-height:1.35;">Médias + templates + snapshots · bascule atomique</span>
              </button>
              <button onClick=${v.setModeData} style=${v.modeDataStyle}>
                <span style="display:block;font-size:14px;font-weight:500;margin-bottom:3px;">Données prix seules</span>
                <span style="font-size:11.5px;color:var(--muted);line-height:1.35;">Sync incrémentale légère · aucune vidéo re-téléchargée</span>
              </button>
            </div>
          </div>
          ${st.pubMode !== 'data' && html`
          <div>
            <h3 style="margin:0 0 10px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Film à publier</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${st.playlists.map((p) => html`
                <button onClick=${() => this.setState({ pubFilm: p.id })} title=${`${p.name} · ${p.items.length} module(s)`}
                  style="padding:8px 15px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;white-space:nowrap;${p.id === (st.pubFilm || st.activePl) ? 'background:var(--accent);color:#fff;border:1px solid var(--accent);' : 'background:var(--paper);color:var(--ink);border:1px solid var(--line);'}">
                  ${p.name} <span style="opacity:0.65;font-weight:500;">(${p.items.length})</span>
                </button>
              `)}
            </div>
          </div>
          `}
          <div>
            <h3 style="margin:0 0 10px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Activation</h3>
            <div style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;margin-bottom:12px;">
              <button onClick=${v.setWhenNow} style=${v.whenNowStyle}>Maintenant</button>
              <button onClick=${v.setWhenScheduled} style=${v.whenSchedStyle}>Planifiée</button>
            </div>
            ${v.whenScheduled && html`
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:13px;color:var(--muted);">activate_at</span>
                <input type="datetime-local" value=${v.activateAt} onInput=${v.onActivateAt} style="padding:9px 11px;font-size:14px;border:1px solid var(--line);border-radius:8px;background:#fff;" />
              </div>
            `}
          </div>
          <div style="background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px;font-size:13px;color:var(--ink);line-height:1.6;">
            ${v.publishSummary}
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;padding:18px 26px;border-top:1px solid var(--line);">
          <button onClick=${v.closePublish} style="padding:11px 20px;font-size:14px;font-weight:500;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;">Annuler</button>
          <button onClick=${v.deploy} style=${v.deployStyle}>${v.deployLabel}</button>
        </div>
        `}
      </div>
    </div>
  `}

  ${v.hasToast && html`
    <div style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:12px;padding:14px 24px;border-radius:999px;background:var(--ink);color:#fff;font-size:14px;font-weight:500;max-width:calc(100vw - 60px);">
      <span style="width:9px;height:9px;border-radius:50%;background:#5BBE7A;flex:0 0 auto;"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.toast}</span>
    </div>
  `}
  </div>
</div>`;
  }
}

render(h(App), document.getElementById('root'));
