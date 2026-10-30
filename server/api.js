// API REST du CMS signage — /api/v1/*
import { existsSync, readdirSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDb, getSetting, setSetting, getIntSetting,
  loadModules, loadPlaylist, loadPlaylists, activePlaylistId, saveDraft, storeFormat, DB_PATH,
  loadElementTypes, loadCatalog, saveCatalog, applyStorePrices, applyStoreLang, applyStoreTokens, loadLangs,
  loadPromoTypes, savePromoTypes, loadCampaigns, saveCampaigns, applyHtmlVars,
  loadLibCategories, saveLibCategories, LIB_SOURCES, loadIngredients, saveIngredients,
  loadSequences, saveSequences, SEQ_PLACEMENTS,
  loadSeasons, saveSeasons, currentSeasons, currentMoment,
  loadMedia, addMediaRow, getMediaRow, delMediaRow,
  loadProductMoments, saveProductMoments, SALE_MOMENTS, currentSaleMoment, momentTagFilters,
  buildContinuous, continuousRevision, normContinuous,
  loadScreenGroups, screenGroupById, saveScreenGroup, deleteScreenGroup, setPlayerGroup,
  loadPlan, savePlan, planFilmAt, setActiveWeek, duplicateWeek,
  checkLogin, createSession, sessionUser, destroySession, agencyAccountEnabled,
  userInfo, listStoreAccounts, setStoreAccount, deleteStoreAccount, STORE_LOGIN_RE,
  storeUnavailable, setStoreUnavailable, storeDataStamp, endOfDayBrussels,
  loadBundles, saveSyncedBundles, setBundleImg,
  loadTfbPromos, saveSyncedTfbPromos, setTfbPromoImg, TFB_PROMO_KINDS,
  translationSources, validateTranslations, rejectTranslations, setTranslation, applyTranslations,
} from './db.js';
import { tfbConfigured, tfbPublicConfig, fetchBundles, fetchPromotions, fetchShops, tfbAuthBackoff } from './tfbuddy.js';
import { TRANSLATE_MODEL, translateConfigured, translationJob, startTranslationJob } from './translate.js';
import { randomBytes } from 'node:crypto';
import { httpsStatus } from './https-status.js';
import { loginAllowed, loginFailed, loginSucceeded } from './auth.js';
// Liste des fichiers d'un snapshot — la même que celle du cache des écrans.
import { snapshotAssets } from '../public/js/assets.js';
import { publicPwaConfig, savePwaConfig, resetPwaConfig, testPwa, importPwa, pwaBaseName, importSeasons, inspectSeasons, inspectIngredients, pwaConfig, matchStore } from './pwadb.js';
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
// Fichiers d'animation : fonds et animations autonomes des éléments « animation ».
const ANIM_DIR = join(API_ROOT, 'public', 'anim');
const ANIM_EXT = new Set(['.gif', '.png', '.webp', '.svg', '.jpg', '.jpeg', '.avif',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.json']);
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
// Secteur d'écrans : remplace le contenu du snapshot par sa propre boucle
// continue. Le secteur décide EXPLICITEMENT de ce qu'il filtre — les périodes
// de vente (matin/midi/après-midi) et/ou les catégories. Renvoie true si le
// contenu a été remplacé ; false si le secteur ne filtre rien (→ garder le
// film du magasin).
function applyGroupContent(snap, group, date) {
  let cats = [];
  try { cats = JSON.parse(group.cats || '[]'); } catch { cats = []; }
  const useCats = group.filter_cats !== 0 && cats.length > 0;
  const useMoments = group.filter_moments === 1;
  if (!useCats && !useMoments) return false;
  const cfg = normContinuous({ source: 'tout', perMoment: useMoments, order: 'catalogue',
    catsInclude: useCats ? cats : [],
    ratios: { liaison: 0, produitSeul: 1, media: 0, animation: 0, surprise: 0 }, maxItems: 40, fallback: 'tout' });
  const gen = buildContinuous(cfg, date, { surprise: surpriseUrls() });
  snap.modules = gen.modules; snap.playlist = gen.playlist; snap.media = gen.media;
  snap.continuous = true; snap.revision = gen.revision; snap.continuousMeta = gen.meta;
  snap.playlistName = group.name; snap.zoneCats = useCats ? cats : [];
  return true;
}
// « Régie → Apparition… » : le résumé, pour un produit, de tout ce que la régie
// sait de son passage à l'écran — périodes du produit ET de sa catégorie,
// saisons, campagnes, éléments de bibliothèque qui le montrent, secteurs
// d'écrans où il peut apparaître. Lecture seule : tous les réglages se font
// dans le back office de la régie, l'ERP ne fait que l'afficher.
function appearanceOf(productId, date = new Date()) {
  const cat = loadCatalog();
  const p = (cat.products || []).find((x) => x.id === productId);
  if (!p) return { error: `produit inconnu : ${productId}` };
  const catName = new Map((cat.categories || []).map((c) => [c.id, c.name]));
  const rows = loadProductMoments();
  const stateOf = (kind, id, mo) => {
    const r = rows.find((x) => x.productId === id && x.moment === mo && x.kind === kind);
    return r ? (r.exception ? 'exclu' : 'visible') : 'aucune règle';
  };
  // Visible à un moment donné = la catégorie laisse passer ET le produit aussi.
  const okAt = (kind, id, mo) => {
    const mine = rows.filter((x) => x.productId === id && x.kind === kind);
    if (!mine.length) return true;
    const here = mine.find((x) => x.moment === mo);
    if (here) return !here.exception;
    return !mine.some((x) => !x.exception);
  };
  const LBL = { matin: 'Matin', midi: 'Midi', aprem: 'Après-midi' };
  const moments = SALE_MOMENTS.map((mo) => ({
    id: mo, label: LBL[mo] || mo,
    produit: stateOf('produit', p.id, mo),
    categorie: stateOf('categorie', p.categoryId, mo),
    visible: okAt('categorie', p.categoryId, mo) && okAt('produit', p.id, mo),
  }));
  const now = currentSaleMoment(date);
  const nowRow = moments.find((m) => m.id === now) || { visible: true };
  const modules = loadModules();
  const shows = (m) => m.productRef === p.id || (m.items || []).some((it) => it.productId === p.id);
  const tagOk = momentTagFilters(date);
  const stores = getDb().prepare('SELECT id, name FROM sig_stores ORDER BY name').all();
  const sectors = stores.flatMap((s) => loadScreenGroups(s.id).map((g) => ({
    storeId: s.id, store: s.name, sectorId: g.id, sector: g.name,
    filtreCategories: g.filterCats !== false && g.cats.length > 0,
    filtrePeriodes: !!g.filterMoments,
    // Le secteur montre ce produit s'il ne filtre pas les catégories, ou si la
    // sienne est dans la liste. Le filtre de périodes s'applique en plus.
    montre: !(g.filterCats !== false && g.cats.length) || g.cats.includes(p.categoryId),
  })));
  return {
    source: 'Régie — back office (lecture seule)',
    produit: {
      id: p.id, nom: p.name, prix: p.price, actif: p.active !== false,
      rupture: !!p.unavailable, categorieId: p.categoryId, categorie: catName.get(p.categoryId) || '',
    },
    maintenant: {
      moment: now, label: LBL[now] || now,
      visible: p.active !== false && !p.unavailable && !!nowRow.visible,
      raison: p.active === false ? 'produit inactif' : (p.unavailable ? 'produit en rupture' : (nowRow.visible ? '' : 'hors période')),
    },
    periodes: moments,
    saisons: currentSeasons(date).filter((s) => (s.products || []).includes(p.id)).map((s) => ({ id: s.id, nom: s.name })),
    campagnes: loadCampaigns().filter((c) => c.productRef === p.id).map((c) => ({
      id: c.id, nom: c.name, active: c.active !== false, dansSaPeriode: tagOk.campagne(c.id),
    })),
    elements: modules.filter(shows).map((m) => ({
      id: m.id, type: m.type, nom: m.name || '',
      orientation: m.orient === 'portrait' ? 'portrait' : 'paysage',
      periodes: Array.isArray(m.moments) ? m.moments : [],
    })),
    secteurs: sectors,
  };
}
// Finition d'un snapshot avant diffusion : prix + langue du magasin, puis
// pioche des vidéos surprise et des médias ciblés. UN SEUL endroit, appelé par
// la visionneuse ET les écrans, pour qu'ils ne divergent jamais (la boucle
// continue, elle, est régénérée juste avant par applyContinuous).
// Bundles TFBuddy : chaque élément « bundle » reçoit SON bundle, résolu pour
// ce magasin — ses produits viennent du catalogue (photo ; prix et nom du
// magasin posés ensuite par applyStorePrices / applyStoreLang), ses créneaux
// partent avec lui (l'écran ne le montre qu'à ses jours et heures). Il tombe
// s'il n'est pas actif dans TFBuddy, pas pour ce magasin, hors de ses dates,
// ou si un de ses produits est épuisé ici.
const brusselsDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
function applyBundles(snap, storeId, date) {
  if (!snap.modules.some((m) => m.type === 'bundle')) return;
  const db = getDb();
  const bundles = new Map(loadBundles().map((b) => [b.id, b]));
  const off = new Set(storeId ? storeUnavailable(storeId, date).map((r) => r.productId) : []);
  const prods = new Map(db.prepare('SELECT id, name, price, img, src FROM sig_products').all().map((p) => [p.id, p]));
  const lang = (storeId && (db.prepare('SELECT lang FROM sig_stores WHERE id = ?').get(storeId) || {}).lang) || 'fr';
  const today = brusselsDay(date);
  const keep = [];
  for (const m of snap.modules) {
    if (m.type !== 'bundle') { keep.push(m); continue; }
    const b = bundles.get(m.bundleRef);
    if (!b || b.status !== 'ACTIVE') continue;
    if (storeId && b.scope === 'selected' && !b.storeIds.includes(storeId)) continue;
    if ((b.dateFrom && today < b.dateFrom) || (b.dateTo && today > b.dateTo)) continue;
    if (b.items.some((it) => it.productId && off.has(it.productId))) continue;
    m.items = b.items.map((it) => {
      const p = prods.get(it.productId);
      return p
        ? { name: p.name, price: p.price, img: p.img, src: p.src, active: true, productId: p.id, qty: it.qty }
        : { name: it.name || `Produit ${it.extProductId}`, price: '', img: '', src: 'illus', active: true, qty: it.qty };
    });
    m.bundle = { id: b.id, name: b.name, descr: b.descr, price: b.price, img: b.img, slots: b.schedule, lang };
    keep.push(m);
  }
  const ids = new Set(keep.map((m) => m.id));
  snap.modules = keep;
  snap.playlist = (snap.playlist || []).filter((id) => ids.has(id));
}

// Promotions TFBuddy (« X achetés = Y offert », quantité, remise programmée,
// bon d'achat) : un élément « promotion » relié (tfbRef) suit SA promotion —
// il tombe si elle n'est pas active, pas pour ce magasin, hors de ses dates,
// ou si tous ses produits sont épuisés ici ; ses créneaux partent avec lui
// (l'écran ne le montre qu'à ses jours et heures). Le produit montré (photo,
// prix du magasin posé ensuite par applyStorePrices) est celui choisi en régie
// s'il est disponible, sinon le premier disponible de la promotion.
function applyTfbPromos(snap, storeId, date) {
  if (!snap.modules.some((m) => m.tfbRef)) return;
  const db = getDb();
  const promos = new Map(loadTfbPromos().map((p) => [p.id, p]));
  const off = new Set(storeId ? storeUnavailable(storeId, date).map((r) => r.productId) : []);
  const prods = new Map(db.prepare('SELECT id, name, price, img, src, category_id, active FROM sig_products').all().map((p) => [p.id, p]));
  const lang = (storeId && (db.prepare('SELECT lang FROM sig_stores WHERE id = ?').get(storeId) || {}).lang) || 'fr';
  const today = brusselsDay(date);
  const keep = [];
  for (const m of snap.modules) {
    if (!m.tfbRef) { keep.push(m); continue; }
    const p = promos.get(m.tfbRef);
    if (!p || p.status !== 'ACTIVE') continue;
    if (storeId && p.scope === 'selected' && !p.storeIds.includes(storeId)) continue;
    if ((p.dateFrom && today < p.dateFrom) || (p.dateTo && today > p.dateTo)) continue;
    // Produits de la promotion ; à défaut, ceux de ses catégories.
    let ids = p.products.map((x) => x.productId).filter((id) => id && prods.has(id));
    if (!ids.length) {
      const cats = new Set(p.categories.map((c) => c.categoryId).filter(Boolean));
      ids = [...prods.values()].filter((x) => x.active && cats.has(x.category_id)).map((x) => x.id);
    }
    const avail = ids.filter((id) => !off.has(id));
    if (ids.length && !avail.length) continue;
    const heroId = m.productRef && !off.has(m.productRef) && prods.has(m.productRef) ? m.productRef : (avail[0] || '');
    const hp = heroId ? prods.get(heroId) : null;
    m.items = hp ? [{ name: hp.name, price: hp.price, img: hp.img, src: hp.src, active: true, productId: hp.id }] : [];
    m.tfb = { id: p.id, kind: p.kind, name: p.name, descr: p.descr, mech: p.mech, slots: p.schedule, img: p.img, lang };
    keep.push(m);
  }
  const keptIds = new Set(keep.map((m) => m.id));
  snap.modules = keep;
  snap.playlist = (snap.playlist || []).filter((id) => keptIds.has(id));
}

// ---- Synchro des bundles TFBuddy -------------------------------------------
// Toutes les 30 min (et à la demande en régie). Le résultat — ou l'erreur,
// dite telle quelle — reste dans sig_settings (tfbuddy_bundles).
export function bundleSyncStatus() {
  try { return JSON.parse(getSetting('tfbuddy_bundles', '{}')) || {}; } catch { return {}; }
}
let bundleSyncRun = null;
export function syncBundles({ manual = false } = {}) {
  if (bundleSyncRun) return bundleSyncRun;
  bundleSyncRun = (async () => {
    const t0 = Date.now();
    const prev = bundleSyncStatus();
    if (!tfbConfigured()) {
      const st = { ok: false, at: nowIso(), configured: false, error: 'compte TFBuddy non configuré — secrets TFBUDDY_PHONE et TFBUDDY_PASSWORD' };
      setSetting('tfbuddy_bundles', JSON.stringify(st));
      return st;
    }
    // Identifiants refusés : la synchro automatique attend (pas de blocage du compte).
    if (!manual && tfbAuthBackoff()) return prev;
    let st;
    // Chaque famille est lue à part : une famille refusée (403) n'empêche pas
    // les autres ; des identifiants refusés (401), si — inutile d'insister.
    const lists = {};
    const failed = {};
    for (const kind of ['bundle', ...TFB_PROMO_KINDS]) {
      try {
        lists[kind] = kind === 'bundle' ? await fetchBundles() : await fetchPromotions(kind);
      } catch (e) {
        failed[kind] = { ok: false, error: String(e.message || e), httpStatus: e.status || 0 };
        if (e.status === 401 || !e.status) { for (const k of ['bundle', ...TFB_PROMO_KINDS]) if (!lists[k] && !failed[k]) failed[k] = failed[kind]; break; }
      }
    }
    try {
      // Magasins : la correspondance manuelle de l'import PWA d'abord (mêmes
      // ids), puis par slug / nom, comme l'import.
      const manualMap = {};
      for (const [storeId, extId] of Object.entries(pwaConfig().shopMap || {})) manualMap[String(extId)] = storeId;
      let shops = [];
      let shopsError = '';
      if (Object.values(lists).some((l) => l.some((b) => (b.shopIds || []).some((x) => !manualMap[x])))) {
        try { shops = await fetchShops(); } catch (e) { shopsError = String(e.message || e); }
      }
      const byExt = new Map(shops.map((x) => [x.id, x]));
      const sigStores = getDb().prepare('SELECT id, name FROM sig_stores').all();
      const storeOf = (ext) => manualMap[ext] || (byExt.has(ext) ? ((matchStore(byExt.get(ext), sigStores).match || {}).id || '') : '');
      const kinds = {};
      for (const kind of ['bundle', ...TFB_PROMO_KINDS]) {
        if (lists[kind]) kinds[kind] = { ok: true, ...(kind === 'bundle' ? saveSyncedBundles(lists[kind], storeOf) : saveSyncedTfbPromos(kind, lists[kind], storeOf)) };
        else kinds[kind] = { ...failed[kind], count: ((prev.kinds || {})[kind] || {}).count || (kind === 'bundle' ? prev.count || 0 : 0) };
      }
      const firstError = Object.values(kinds).find((k) => !k.ok);
      const b = kinds.bundle;
      st = {
        ok: !firstError, at: nowIso(), configured: true, ms: Date.now() - t0, account: tfbPublicConfig().role,
        // Les champs de premier niveau restent ceux des bundles.
        count: b.ok ? b.count : (prev.count || 0), active: b.ok ? b.active : (prev.active || 0),
        unmappedShops: b.unmappedShops || [], unknownProducts: b.unknownProducts || [],
        kinds,
        ...(firstError ? { error: firstError.error, httpStatus: firstError.httpStatus, lastOk: prev.ok ? prev.at : (prev.lastOk || null) } : {}),
        ...(shopsError ? { shopsError } : {}),
      };
    } catch (e) {
      st = { ok: false, at: nowIso(), configured: true, ms: Date.now() - t0, error: String(e.message || e), httpStatus: e.status || 0,
        count: prev.count || 0, active: prev.active || 0, kinds: prev.kinds || {}, lastOk: prev.ok ? prev.at : (prev.lastOk || null) };
    }
    setSetting('tfbuddy_bundles', JSON.stringify(st));
    scheduleMirror();
    return st;
  })().finally(() => { bundleSyncRun = null; });
  return bundleSyncRun;
}
export function startBundleSync() {
  if (!tfbConfigured()) return;
  setTimeout(() => { syncBundles().catch(() => {}); }, 15000);
  setInterval(() => { syncBundles().catch(() => {}); }, 30 * 60000);
}
const bundlesJson = () => ({
  bundles: loadBundles(), promos: loadTfbPromos(), sync: bundleSyncStatus(), tfbuddy: tfbPublicConfig(),
  // Noms des magasins : la page Promotions les montre sans charger le réseau.
  stores: getDb().prepare('SELECT id, name FROM sig_stores ORDER BY name').all(),
});

// ---- Traductions (voir server/translate.js) --------------------------------
// Langues cibles : celles de la régie, sauf le français (langue source).
const trLang = (x) => {
  const l = String(x || 'nl');
  return l !== 'fr' && loadLangs().some((g) => g.id === l) ? l : null;
};
function translationsJson(lang) {
  const items = translationSources(lang);
  const n = (f) => items.filter(f).length;
  const job = translationJob();
  return {
    lang, items,
    langs: loadLangs().filter((l) => l.id !== 'fr'),
    stores: getDb().prepare('SELECT id, name FROM sig_stores WHERE lang = ? ORDER BY name').all(lang),
    counts: {
      total: items.length,
      erp: n((s) => s.fromErp),
      validated: n((s) => !s.fromErp && s.translation && s.translation.status === 'valide'),
      proposed: n((s) => !s.fromErp && s.translation && s.translation.status === 'propose'),
      missing: n((s) => s.missing),
      stale: n((s) => s.missing && s.stale),
    },
    claude: { configured: translateConfigured(), model: TRANSLATE_MODEL },
    job: job && job.lang === lang ? job : null,
  };
}

// Ruptures déclarées par le magasin : ses écrans ne montrent plus ces
// produits — ni dans les listes, ni en « produit seul », promo ou campagne.
function applyStoreUnavailable(snap, storeId, date) {
  const off = new Set(storeId ? storeUnavailable(storeId, date).map((r) => r.productId) : []);
  snap.storeStamp = storeId ? storeDataStamp(storeId, date) : '';
  if (!off.size) return;
  const keep = [];
  for (const m of snap.modules) {
    if (m.productRef && off.has(m.productRef)) continue;
    if (Array.isArray(m.items)) m.items = m.items.filter((it) => !(it && it.productId && off.has(it.productId)));
    if (m.type === 'produit' && !(m.items || []).length) continue;
    keep.push(m);
  }
  const ids = new Set(keep.map((m) => m.id));
  snap.modules = keep;
  snap.playlist = (snap.playlist || []).filter((id) => ids.has(id));
}

function finishSnapshot(snap, storeId, date = new Date()) {
  if (!snap || !Array.isArray(snap.modules)) return snap;
  applyBundles(snap, storeId, date);
  applyTfbPromos(snap, storeId, date);
  applyStoreUnavailable(snap, storeId, date);
  applyStorePrices(snap.modules, storeId);
  // Traductions validées en régie, puis les noms de l'ERP (qui gardent la main).
  applyTranslations(snap.modules, storeId);
  applyStoreLang(snap.modules, storeId);
  // Variables liées d'un gabarit HTML d'abord, puis les jetons magasin pour
  // tout ce qui n'a pas été lié explicitement.
  applyHtmlVars(snap.modules, storeId, date);
  applyStoreTokens(snap.modules, storeId, date);
  resolveSurprise(snap.modules);
  resolveMediaElements(snap.modules, date);
  // Après les pioches (surprise, média ciblé) : la liste reflète ce qui jouera.
  snap.media = snapshotAssets(snap);
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
const parseDetail = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
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
    // L'écran Paramètres dit si l'espace agence est ouvert, plutôt que
    // d'annoncer un mot de passe qui n'existe pas.
    agencyEnabled: agencyAccountEnabled(),
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
      detail: parseDetail(p.detail),
    });
  }
  // Les magasins sans écran restent visibles (on peut préparer combo, langue
  // et lien avant de brancher l'écran) — seul le bac interne « st-new » vide
  // est masqué.
  const out = [...byStore.values()].filter((s) => s.players.length > 0 || s.id !== 'st-new');
  const accounts = new Map(listStoreAccounts().map((a) => [a.storeId, a.username]));
  for (const s of out) {
    const anyOnline = s.players.some((p) => p.state !== 'offline');
    if (!anyOnline) s.conn = 'offline';
    s.account = accounts.get(s.id) || null;
    s.unavailable = storeUnavailable(s.id);
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
  return snapshotAssets({ modules });
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
// Détail du cache hors ligne envoyé par l'écran : seuls les champs attendus,
// en nombres et booléens — rien d'autre n'entre en base.
function cleanDetail(d) {
  if (!d || typeof d !== 'object') return null;
  const n = (v) => (Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : 0);
  const a = d.assets && typeof d.assets === 'object' ? d.assets : {};
  const s = d.storage && typeof d.storage === 'object' ? d.storage : {};
  return {
    assets: { total: n(a.total), cached: n(a.cached), missing: n(a.missing), external: n(a.external), error: n(a.error), quota: !!a.quota },
    storage: { persisted: !!s.persisted, usage: n(s.usage), quota: n(s.quota) },
    offlineCache: !!d.offlineCache, secure: !!d.secure, sw: !!d.sw, fromCache: !!d.fromCache, offlineFor: n(d.offlineFor),
  };
}

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
    const detail = cleanDetail(body.detail);
    if (detail) db.prepare('UPDATE sig_players SET detail = ? WHERE id = ?').run(JSON.stringify(detail), id);
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
      // Ruptures du magasin et bundles TFBuddy : l'écran se resynchronise quand ils changent.
      storeStamp: storeDataStamp(playerRow(id).store_id),
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
// Espace magasin
function storeRow(id) {
  return id ? getDb().prepare('SELECT * FROM sig_stores WHERE id = ?').get(String(id)) : null;
}
// Mot de passe lisible (ni 0/O ni 1/l) : xxxx-xxxx-xxxx, 60 bits d'aléa.
function newStorePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += A[b[i] % A.length] + (i === 3 || i === 7 ? '-' : '');
  return out;
}
// Identifiant proposé pour un magasin : son nom, sans la marque, en minuscules.
function suggestStoreLogin(st) {
  const base = String(st.name || st.id).replace(/^\s*(l['’]\s*)?atelier\s+by\s*/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'magasin';
  const taken = (u) => !!getDb().prepare('SELECT 1 AS x FROM sig_users WHERE username = ?').get(u);
  let login = base.length >= 3 ? base : `magasin-${base}`;
  for (let i = 2; taken(login); i++) login = `${base}-${i}`;
  return login;
}
// Ce qu'un magasin voit : ses écrans (état réel, cache), ses liens, ses
// produits (noms dans SA langue) et ses ruptures en cours.
function myStoreJson(st) {
  const fleet = fleetJson();
  const mine = fleet.stores.find((s) => s.id === st.id) || { players: [] };
  const cat = loadCatalog();
  const lang = st.lang || 'fr';
  const off = new Map(storeUnavailable(st.id).map((r) => [r.productId, r]));
  const catName = new Map(cat.categories.map((c) => [c.id, (c.aliases && c.aliases[lang]) || c.name]));
  const priced = cat.products.some((p) => p.prices && p.prices[st.id] != null);
  const products = cat.products
    .filter((p) => p.active && !p.unavailable && (!priced || (p.prices && p.prices[st.id] != null)))
    .map((p) => ({
      id: p.id, name: (p.aliases && p.aliases[lang]) || p.name, category: catName.get(p.categoryId) || '',
      price: (p.prices && p.prices[st.id] != null) ? p.prices[st.id] : p.price,
      unavailable: off.has(p.id), until: off.has(p.id) ? off.get(p.id).until : null,
    }));
  return {
    store: { id: st.id, name: st.name, lang, address: st.address || '', hours: st.hours || '', format: storeFormat(st) },
    screens: mine.players.map((p) => ({
      id: p.id, name: p.name, state: p.state, playedVer: p.playedVer, assignedVer: p.assignedVer,
      cache: p.cache, detail: p.detail, syncAgo: p.syncAgo, media: p.media,
      link: `player.html?id=${encodeURIComponent(p.id)}&token=${encodeURIComponent(p.token)}`,
    })),
    links: { film: `film?store=${encodeURIComponent(st.id)}` },
    version: fleet.version,
    products,
    unavailable: storeUnavailable(st.id),
    endOfDay: endOfDayBrussels(),
    now: nowIso(),
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
        // Adresse https de la régie si le serveur en a une (null sinon).
        https: httpsStatus(ctx.basePath) || null,
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
      // Derrière l'hôte https d'Apache : cookie « Secure », jamais envoyé en clair.
      const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ? '; Secure' : '';
      setCookies.push(`sig_session=${token}; Path=${ctx.cookiePath}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
      const who = userInfo(body.username) || { role: 'admin', storeId: '' };
      return send(200, { ok: true, user: String(body.username), token, role: who.role, storeId: who.storeId || undefined });
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
    const who = userInfo(user);
    if (!who) return send(401, { error: 'Authentification requise' });
    const role = who.role;

    if (req.method === 'GET' && path === '/me') {
      const st = who.storeId ? storeRow(who.storeId) : null;
      return send(200, { ok: true, user, role, store: st ? { id: st.id, name: st.name, lang: st.lang || 'fr' } : null });
    }

    // ---- espace magasin : SON magasin, rien d'autre ---------------------------
    // Le magasin vient du compte (base), jamais de la requête : un compte
    // magasin ne peut ni lire ni modifier un autre magasin.
    if (role === 'magasin') {
      const st = storeRow(who.storeId);
      if (!st) return send(403, { error: 'Compte magasin sans magasin — à recréer depuis la régie' });
      if (req.method === 'GET' && path === '/my-store') return send(200, { ...myStoreJson(st), https: httpsStatus(ctx.basePath) || null });
      if (req.method === 'POST' && path === '/my-store/unavailable') {
        const body = await readBody();
        const productId = String(body.productId || '');
        if (!loadCatalog().products.some((p) => p.id === productId)) return send(404, { error: 'produit inconnu' });
        const until = body.mode === 'manuel' ? null : endOfDayBrussels();
        const list = setStoreUnavailable(st.id, productId, !!body.unavailable, { until, by: user });
        return send(200, { ok: true, unavailable: list, storeStamp: storeDataStamp(st.id) });
      }
      return send(403, { error: 'Compte magasin : réservé à l\'espace magasin' });
    }

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

    if (req.method === 'GET' && path === '/state') return send(200, { ...stateJson(), https: httpsStatus(ctx.basePath) || null });
    if (req.method === 'GET' && path === '/fleet') return send(200, fleetJson());

    // ---- types d'éléments & table produits (rien en dur : tout en base) ----
    if (req.method === 'GET' && path === '/element-types') return send(200, { types: loadElementTypes() });
    if (req.method === 'GET' && path === '/langs') return send(200, { langs: loadLangs() });

    // ---- sous-types de promotion (dynamiques : happy hour, flash, bundle…) --
    // Alimentent l'élément « promotion ». Gérables en régie, importables ERP.
    if (req.method === 'GET' && path === '/promo-types') return send(200, { promoTypes: loadPromoTypes() });
    if (req.method === 'PUT' && path === '/promo-types') {
      const body = await readBody();
      if (!Array.isArray(body.promoTypes)) return send(400, { error: 'promoTypes requis' });
      const promoTypes = savePromoTypes(body.promoTypes);
      scheduleMirror();
      return send(200, { ok: true, promoTypes, savedAt: nowIso() });
    }

    // ---- « Régie → Apparition… » : ce que l'ERP LIT pour la carte produit ---
    // La régie est la seule source des tags (tous les réglages se font ici) ;
    // l'ERP ne fait que lire ce résumé pour l'afficher sur la fiche produit.
    if (req.method === 'GET' && path === '/appearance') {
      const pid = url.searchParams.get('product') || '';
      if (!pid) return send(400, { error: 'paramètre product requis' });
      const out = appearanceOf(pid);
      return out.error ? send(404, out) : send(200, out);
    }

    // ---- catégories de la bibliothèque (classement des éléments) -----------
    // Éditables dans les Paramètres, avec la TABLE de la régie qui les alimente.
    if (req.method === 'GET' && path === '/lib-categories') return send(200, { libCategories: loadLibCategories(), libSources: LIB_SOURCES });
    if (req.method === 'PUT' && path === '/lib-categories') {
      const body = await readBody();
      if (!Array.isArray(body.libCategories)) return send(400, { error: 'libCategories requis' });
      const libCategories = saveLibCategories(body.libCategories);
      scheduleMirror();
      return send(200, { ok: true, libCategories, libSources: LIB_SOURCES, savedAt: nowIso() });
    }

    // ---- bundles TFBuddy (lus sur l'API TFBuddy, déposables comme item) ----
    if (req.method === 'GET' && path === '/bundles') return send(200, bundlesJson());
    if (req.method === 'POST' && path === '/bundles/sync') {
      const sync = await syncBundles({ manual: true });
      return send(200, { ok: !!sync.ok, ...bundlesJson() });
    }
    {
      const mb = /^\/bundles\/([A-Za-z0-9_-]+)$/.exec(path);
      if (mb && req.method === 'PATCH') {
        const body = await readBody();
        if (!setBundleImg(mb[1], body.img)) return send(404, { error: 'bundle inconnu' });
        scheduleMirror();
        return send(200, { ok: true, ...bundlesJson() });
      }
      // Visuel d'une autre promotion TFBuddy (même liste, même synchro).
      const mp = /^\/tfb-promos\/([A-Za-z0-9_-]+)$/.exec(path);
      if (mp && req.method === 'PATCH') {
        const body = await readBody();
        if (!setTfbPromoImg(mp[1], body.img)) return send(404, { error: 'promotion inconnue' });
        scheduleMirror();
        return send(200, { ok: true, ...bundlesJson() });
      }
    }

    // ---- traductions des textes affichés (néerlandais des magasins flamands) --
    // Claude PROPOSE, la régie VALIDE : seule une traduction validée — et qui
    // traduit le texte français actuel — atteint un écran.
    if (path === '/translations' || path.startsWith('/translations/')) {
      const body = req.method === 'GET' ? {} : await readBody();
      const lang = trLang(req.method === 'GET' ? url.searchParams.get('lang') : body.lang);
      if (!lang) return send(400, { error: 'langue cible inconnue (le français est la langue source)' });
      if (req.method === 'GET' && path === '/translations') return send(200, translationsJson(lang));
      if (req.method === 'POST' && path === '/translations/propose') {
        if (!translateConfigured()) return send(409, { error: 'clé API Anthropic absente — ajouter le secret ANTHROPIC_API_KEY puis relancer la livraison', ...translationsJson(lang) });
        const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds.map(String) : null;
        const running = translationJob();
        if (running && running.running && running.lang !== lang) return send(409, { error: `une proposition est déjà en cours (${running.lang})`, ...translationsJson(lang) });
        startTranslationJob(lang, { kinds });
        return send(202, { ok: true, ...translationsJson(lang) });
      }
      if (req.method === 'POST' && path === '/translations/validate') {
        const keys = Array.isArray(body.keys) ? body.keys.map(String) : null;
        const edits = body.edits && typeof body.edits === 'object' ? body.edits : {};
        const validated = validateTranslations(lang, { keys, edits });
        scheduleMirror();
        return send(200, { ok: true, validated, ...translationsJson(lang) });
      }
      if (req.method === 'POST' && path === '/translations/reject') {
        const rejected = rejectTranslations(lang, Array.isArray(body.keys) ? body.keys.map(String) : []);
        scheduleMirror();
        return send(200, { ok: true, rejected, ...translationsJson(lang) });
      }
      if (req.method === 'PUT' && path === '/translations') {
        if (!setTranslation(lang, String(body.key || ''), body.text)) return send(404, { error: 'texte inconnu (supprimé, ou son français a changé)' });
        scheduleMirror();
        return send(200, { ok: true, ...translationsJson(lang) });
      }
      return send(404, { error: 'route inconnue' });
    }

    // ---- campagnes marketing (liste d'entités déposables comme item) --------
    // Gérables en régie, importables depuis l'ERP ensuite.
    if (req.method === 'GET' && path === '/campaigns') return send(200, { campaigns: loadCampaigns() });
    if (req.method === 'PUT' && path === '/campaigns') {
      const body = await readBody();
      if (!Array.isArray(body.campaigns)) return send(400, { error: 'campaigns requis' });
      const campaigns = saveCampaigns(body.campaigns);
      scheduleMirror();
      return send(200, { ok: true, campaigns, savedAt: nowIso() });
    }

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
    // ---- suites montées à la main (intro, outro, présentation de gamme…) ----
    if (req.method === 'GET' && path === '/sequences') return send(200, { sequences: loadSequences(), placements: SEQ_PLACEMENTS });
    if (req.method === 'PUT' && path === '/sequences') {
      const body = await readBody();
      if (!Array.isArray(body.sequences)) return send(400, { error: 'sequences requis' });
      const sequences = saveSequences(body.sequences);
      scheduleMirror();
      return send(200, { ok: true, sequences, savedAt: nowIso() });
    }

    // ---- fichiers d'animation (fond ou animation autonome) ------------------
    // Servis depuis public/anim/ ; séparés de la médiathèque agence, qui a sa
    // propre logique de tags (moment · produit · saison).
    if (req.method === 'POST' && path === '/anim-assets') {
      const body = await readBody();
      const rawName = String(body.name || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const mData = /^data:[\w/+.-]+;base64,(.+)$/s.exec(String(body.dataUrl || ''));
      if (!rawName || !mData) return send(400, { error: 'nom ou fichier manquant' });
      const ext = extname(rawName).toLowerCase();
      if (!ANIM_EXT.has(ext)) return send(400, { error: 'format non supporté (.gif, .png, .webp, .svg, .mp4, .webm, .json Lottie…)' });
      const buf = Buffer.from(mData[1], 'base64');
      if (buf.length > 18 * 1024 * 1024) return send(413, { error: 'fichier trop lourd pour l’upload (max 18 Mo) — dépose-le dans public/anim/ sur le serveur' });
      // Un Lottie doit être un JSON lisible : mieux vaut le refuser ici que
      // laisser un écran vide en magasin.
      if (ext === '.json') {
        try { JSON.parse(buf.toString('utf8')); }
        catch { return send(400, { error: 'ce .json n’est pas lisible — export Lottie/Bodymovin attendu' }); }
      }
      try { mkdirSync(ANIM_DIR, { recursive: true }); } catch { /* déjà là */ }
      writeFileSync(join(ANIM_DIR, rawName), buf);
      return send(200, { ok: true, url: 'anim/' + encodeURIComponent(rawName), name: rawName, size: buf.length });
    }
    if (req.method === 'GET' && path === '/anim-assets') {
      let files = [];
      try {
        files = readdirSync(ANIM_DIR).filter((n) => ANIM_EXT.has(extname(n).toLowerCase())).sort()
          .map((n) => ({ name: n, url: 'anim/' + encodeURIComponent(n), size: statSync(join(ANIM_DIR, n)).size }));
      } catch { /* dossier absent : liste vide */ }
      return send(200, { dir: 'public/anim', assets: files });
    }

    // ---- matières premières : ingrédient ↔ animation -----------------------
    // Le lien se règle en régie ; le module produit du franchiseur ne fait que
    // le lire. Le diagnostic cherche la table des ingrédients côté ERP.
    if (req.method === 'GET' && path === '/ingredients') return send(200, { ingredients: loadIngredients() });
    if (req.method === 'PUT' && path === '/ingredients') {
      const body = await readBody();
      if (!Array.isArray(body.ingredients)) return send(400, { error: 'ingredients requis' });
      const ingredients = saveIngredients(body.ingredients);
      scheduleMirror();
      return send(200, { ok: true, ingredients, savedAt: nowIso() });
    }
    if (req.method === 'POST' && path === '/ingredients/inspect') {
      try {
        const body = await readBody();
        const det = await inspectIngredients(body.table);
        const insp = det.inspected || [];
        return send(200, { ok: insp.length > 0, db: det.db, inspected: insp });
      } catch (e) { return send(200, { ok: false, error: e.message }); }
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

    // Comptes magasin (admin) : un magasin = un compte, mot de passe généré et
    // montré UNE fois ; le réinitialiser coupe les sessions ouvertes.
    if (req.method === 'GET' && path === '/store-accounts') return send(200, { accounts: listStoreAccounts() });
    {
      const mAcc = path.match(/^\/stores\/([A-Za-z0-9_-]+)\/account$/);
      if (mAcc && (req.method === 'POST' || req.method === 'DELETE')) {
        const st = storeRow(mAcc[1]);
        if (!st) return send(404, { error: `magasin inconnu : ${mAcc[1]}` });
        if (req.method === 'DELETE') return send(200, { ok: deleteStoreAccount(st.id) });
        const body = await readBody();
        const wanted = String(body.username || '').trim().toLowerCase() || suggestStoreLogin(st);
        if (!STORE_LOGIN_RE.test(wanted)) return send(400, { error: 'identifiant : 3 à 40 caractères, minuscules, chiffres et tirets' });
        if (['admin', 'agence'].includes(wanted)) return send(400, { error: 'identifiant réservé' });
        const password = newStorePassword();
        try {
          const out = setStoreAccount(st.id, wanted, password);
          return send(200, { ok: true, storeId: st.id, username: out.username, password, created: out.created });
        } catch (e) { return send(409, { error: String(e.message || e) }); }
      }
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
