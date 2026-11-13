// Éditeur du film — étape 6 de l'assistant vidéo de campagne (maquette
// validée : « editeur.html », captures editeur-1 / editeur-2).
//
// Un film est fait de scènes ; chaque scène a une durée et des calques (photo
// de la médiathèque, texte, prix / promo), affichés sur une frise de calques.
// L'aperçu, les écrans des magasins (renderer.js → paintScenes) et la vidéo
// exportée passent par la MÊME fonction de dessin : drawScene (scenes.js).
//
// Ce module ne garde rien lui-même : les scènes vivent dans l'état de
// l'assistant (cw.scenes, cw.nl pour les textes néerlandais saisis) et partent
// avec le film (élément « scenes » de la bibliothèque, choix de l'assistant).
import { html, h, Component } from './vendor/preact-htm.js';
import {
  drawScene, normScenes, normScene, scenesDuration, layerBox, portraitBox, photoRect, preloadScenes, ensureSceneFonts,
  mediaEl, sceneAt, SCENE_FONTS, FITS, ANIMS_IN, OUT_DUR, REF,
} from './scenes.js';
import { BRAND_COLORS, RUBY, INK } from './palette.js';

const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; e.body = json; throw e; }
  return json;
}
let UIDC = 0;
const uid = (p) => p + Date.now().toString(36).slice(-5) + (UIDC++).toString(36);
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtS = (v) => `${(Math.round(v * 10) / 10).toFixed(1).replace('.', ',')} s`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TEXT_COLORS = ['#FFFFFF', RUBY, INK, '#FBF8F2', '#B8860B', '#6E4A2B'];
const ANIM_LABEL = { none: 'fe.anim.none', hand: 'fe.anim.hand', type: 'fe.anim.type', fade: 'fe.anim.fade', slideUp: 'fe.anim.slideUp', slideLeft: 'fe.anim.slideLeft' };
const FIT_LABEL = { cover: 'fe.fit.cover', contain: 'fe.fit.contain', fill: 'fe.fit.fill', none: 'fe.fit.none' };

// ---------------------------------------------------------------------------
// État : les scènes de l'assistant.
export const scenesOf = (cw) => (Array.isArray(cw.scenes) ? cw.scenes : []);
function edit(app, setCw, fn) {
  setCw(app, (cw) => {
    const next = fn(JSON.parse(JSON.stringify(scenesOf(cw))), cw);
    return { scenes: normScenes(next) };
  });
}
// Instant joué en direct (lecture), repris à la pause.
let liveT = 0;
const curScene = (cw) => { const s = scenesOf(cw); return s[clamp(cw.sceneIdx || 0, 0, Math.max(0, s.length - 1))] || null; };
const curLayer = (cw) => { const s = curScene(cw); return s ? (s.layers.find((l) => l.id === cw.layerId) || null) : null; };
function editLayer(app, setCw, id, patch) {
  edit(app, setCw, (scenes, cw) => {
    const s = scenes[clamp(cw.sceneIdx || 0, 0, scenes.length - 1)];
    if (s) s.layers = s.layers.map((l) => (l.id === id ? deepMerge(l, typeof patch === 'function' ? patch(l) : patch) : l));
    return scenes;
  });
}
const deepMerge = (a, b) => {
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? { ...a[k], ...b[k] } : b[k];
  return o;
};

// Première composition proposée (données de la campagne, jamais inventées) :
// une scène par produit retenu (trois au plus) — accroche de l'offre écrite à
// la main, nom du produit en titre, son prix et l'offre dans un rectangle ; la
// photo du produit si la médiathèque de la régie en a une.
export function seedScenes(M) {
  const { cw, st, camp } = M;
  const offer = camp && camp.offer;
  const promo = (offer && (offer.discount || offer.mechanic || offer.title)) || '';
  const lib = (st.mediaLib || []).filter((m) => m.present !== false && m.kind === 'photo');
  const prods = M.selProds.slice(0, 3);
  const make = (p, i) => {
    const photo = p ? lib.find((m) => m.productId === p.id) : null;
    const layers = [];
    if (photo) layers.push({ id: uid('p'), kind: 'photo', src: 'media/' + encodeURIComponent(photo.filename), mediaId: photo.id, name: photo.filename, fit: 'contain', motion: 'kenburns', x: 82, y: 60, scale: 100, anim: { in: 'none', start: 0 } });
    const hook = i === 0 ? (cw.hookFr || (camp && camp.name) || '') : '';
    if (hook) layers.push({ id: uid('t'), kind: 'text', text: hook, font: 'hand', size: 64, color: INK, box: { x: 6, y: 9, w: 52, h: 34 }, anim: { in: 'hand', start: 0.6, inDur: 3 } });
    if (p) layers.push({ id: uid('t'), kind: 'text', text: p.name, font: 'title', size: 70, color: INK, box: { x: 6, y: 62, w: 60, h: 14 }, anim: { in: 'fade', start: hook ? 2.6 : 0.4, inDur: 0.6 } });
    if (p) layers.push({ id: uid('r'), kind: 'price', productId: p.id, promo, size: 34, box: { x: 6, y: 79, w: 50, h: 10 }, anim: { in: 'slideUp', start: hook ? 3.2 : 1, inDur: 0.7 } });
    return { id: uid('s'), dur: i === 0 ? 8 : 6, layers };
  };
  const list = prods.length ? prods.map(make) : [make(null, 0)];
  return normScenes(list);
}

// Lignes de produits pour l'aperçu (prix du magasin choisi), comme le serveur
// les résout pour chaque magasin à la diffusion.
export function previewItems(M, scenes) {
  const sid = M.cw.previewStore || (M.storesChosen[0] && M.storesChosen[0].id) || '';
  const ids = new Set(scenes.flatMap((s) => s.layers.filter((l) => l.kind === 'price' && l.productId).map((l) => l.productId)));
  return [...ids].map((id) => M.prodById.get(id)).filter(Boolean)
    .filter((p) => !sid || M.soldIn(p, sid))
    .map((p) => ({ productId: p.id, name: p.name, price: (sid && M.priceIn(p, sid)) || p.price, active: true }));
}

// ---------------------------------------------------------------------------
// Aperçu : canvas dessiné par drawScene, poignées et glisser par-dessus.
class Stage extends Component {
  constructor(props) { super(props); this.t = props.t || 0; this.drag = null; this.override = null; }
  componentDidMount() {
    ensureSceneFonts();
    this.loop = () => { this.paint(); this.raf = requestAnimationFrame(this.loop); };
    this.raf = requestAnimationFrame(this.loop);
  }
  componentWillUnmount() { cancelAnimationFrame(this.raf); }
  componentDidUpdate(prev) {
    if (prev.playing !== this.props.playing && this.props.playing) { this.t0 = performance.now() - (this.props.t || 0) * 1000; }
    if (!this.props.playing) { this.t = this.props.t || 0; this.t0 = null; }
  }
  scene() {
    const s = this.props.scene;
    if (!s || !this.override) return s;
    return { ...s, layers: s.layers.map((l) => (l.id === this.override.id ? this.override : l)) };
  }
  frame() {
    const cv = this.cv;
    if (!cv) return null;
    return { x: 0, y: 0, w: cv.width, h: cv.height, portrait: this.props.portrait, items: this.props.items };
  }
  paint() {
    const cv = this.cv;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr);
    const hh = Math.round(cv.clientHeight * dpr);
    if (!w || !hh) return;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== hh) cv.height = hh;
    const s = this.scene();
    if (this.props.playing) {
      if (this.t0 == null) this.t0 = performance.now() - this.t * 1000;
      this.t = (performance.now() - this.t0) / 1000;
      if (s && this.t >= s.dur) {
        this.t = 0;
        this.t0 = performance.now();
      }
      if (this.props.onTick) this.props.onTick(this.t);
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, hh);
    if (s) drawScene(ctx, s, this.t, this.frame());
  }
  hit(ev) {
    const r = this.cv.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * 100;
    const py = ((ev.clientY - r.top) / r.height) * 100;
    const s = this.props.scene;
    if (!s) return null;
    for (const l of [...s.layers].reverse()) {
      if (l.kind === 'photo') continue;
      const b = layerBox(l, this.props.portrait);
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return l;
    }
    return [...s.layers].reverse().find((l) => l.kind === 'photo') || null;
  }
  down(ev, mode) {
    ev.preventDefault();
    ev.stopPropagation();
    const l = mode === 'move' || !this.props.selected ? this.hit(ev) : this.props.selected;
    if (!l) { this.props.onSelect(''); return; }
    if (!this.props.selected || this.props.selected.id !== l.id) this.props.onSelect(l.id);
    const r = this.cv.getBoundingClientRect();
    this.drag = { mode, l, x0: ev.clientX, y0: ev.clientY, r };
    const move = (e) => this.move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.end(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  move(ev) {
    const d = this.drag;
    if (!d) return;
    const dx = ((ev.clientX - d.x0) / d.r.width) * 100;
    const dy = ((ev.clientY - d.y0) / d.r.height) * 100;
    const P = this.props.portrait;
    const l = d.l;
    if (l.kind === 'photo') {
      const F = this.frame();
      const rect = F && photoRect(l, this.t, F, this.props.scene);
      if (!rect) return;
      const pos = P ? (l.p || { x: 50, y: 45, scale: l.scale }) : { x: l.x, y: l.y, scale: l.scale };
      const fx = F.w - rect.w; const fy = F.h - rect.h;
      const nx = Math.abs(fx) < 1 ? pos.x : clamp(pos.x + (dx / 100) * F.w / fx * 100, 0, 100);
      const ny = Math.abs(fy) < 1 ? pos.y : clamp(pos.y + (dy / 100) * F.h / fy * 100, 0, 100);
      this.override = P ? { ...l, p: { ...pos, x: nx, y: ny } } : { ...l, x: nx, y: ny };
    } else {
      const b = layerBox(l, P);
      let nb;
      if (d.mode === 'move') nb = { ...b, x: b.x + dx, y: b.y + dy };
      else {
        nb = { ...b };
        if (d.mode.includes('e')) nb.w = Math.max(4, b.w + dx);
        if (d.mode.includes('s')) nb.h = Math.max(4, b.h + dy);
        if (d.mode.includes('w')) { nb.x = b.x + Math.min(dx, b.w - 4); nb.w = Math.max(4, b.w - dx); }
        if (d.mode.includes('n')) { nb.y = b.y + Math.min(dy, b.h - 4); nb.h = Math.max(4, b.h - dy); }
      }
      const r2 = (v) => Math.round(v * 10) / 10;
      nb = { x: r2(nb.x), y: r2(nb.y), w: r2(nb.w), h: r2(nb.h) };
      this.override = P ? { ...l, boxP: nb } : { ...l, box: nb };
    }
    this.forceUpdate();
  }
  end() {
    const o = this.override;
    this.drag = null;
    this.override = null;
    if (o) this.props.onCommit(o);
  }
  render(props) {
    const s = this.scene();
    const sel = props.selected && s ? s.layers.find((l) => l.id === props.selected.id) : null;
    const T = props.T;
    let box = null;
    if (sel && sel.kind !== 'photo') {
      const b = layerBox(sel, props.portrait);
      const handle = (k, style) => html`<i class="fe-h" style=${style} onPointerDown=${(e) => this.down(e, k)}></i>`;
      box = html`<div class="fe-sel" style=${`left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;`} onPointerDown=${(e) => this.down(e, 'move')}>
        <span class="fe-sel__lbl">${T(sel.kind === 'price' ? 'fe.layer.price' : 'fe.layer.text')} · ${T(ANIM_LABEL[sel.anim.in])}</span>
        ${handle('nw', 'left:-5px;top:-5px;cursor:nwse-resize')}${handle('ne', 'right:-5px;top:-5px;cursor:nesw-resize')}
        ${handle('sw', 'left:-5px;bottom:-5px;cursor:nesw-resize')}${handle('se', 'right:-5px;bottom:-5px;cursor:nwse-resize')}
      </div>`;
    } else if (sel) {
      box = html`<div class="fe-sel fe-sel--photo" title=${T('fe.photo.dragTip')}><span class="fe-sel__lbl">${T('fe.layer.photo')} · ${T(FIT_LABEL[sel.fit])} · ${Math.round(props.portrait && sel.p ? sel.p.scale : sel.scale)} %</span></div>`;
    }
    return html`<div class=${'fe-stage' + (props.portrait ? ' fe-stage--p' : '')}>
      <canvas ref=${(el) => { this.cv = el; }} class="fe-canvas"></canvas>
      <div class="fe-over" onPointerDown=${(e) => this.down(e, 'move')}>${box}</div>
    </div>`;
  }
}

// ---------------------------------------------------------------------------
// Carte principale : outils, aperçu, frise des calques, pied.
export function filmEditorCard(app, M, setCw, nav) {
  const { cw, T } = M;
  const scenes = scenesOf(cw);
  const scene = curScene(cw);
  const idx = clamp(cw.sceneIdx || 0, 0, Math.max(0, scenes.length - 1));
  const sel = curLayer(cw);
  const portrait = cw.orient === 'portrait';
  const items = previewItems(M, scenes);
  const playT = clamp(cw.playT || 0, 0, scene ? scene.dur : 0);
  const total = scenesDuration(scenes);
  const select = (id) => setCw(app, { layerId: id });
  const addLayer = (l) => {
    edit(app, setCw, (sc, c) => {
      const s = sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)];
      if (!s) return sc;
      if (l.kind === 'photo') s.layers.unshift(l); else s.layers.push(l);
      return sc;
    });
    setCw(app, { layerId: l.id });
  };
  const addText = () => addLayer({ id: uid('t'), kind: 'text', text: T('fe.newText'), font: 'hand', size: 60, color: INK, box: { x: 8, y: 12, w: 50, h: 22 }, anim: { in: 'hand', start: Math.min(0.5, scene ? scene.dur / 4 : 0), inDur: 2.5 } });
  const addPrice = () => {
    const p = M.selProds[0];
    const offer = M.camp && M.camp.offer;
    addLayer({ id: uid('r'), kind: 'price', productId: p ? p.id : '', promo: (offer && (offer.discount || offer.title)) || '', size: 34, box: { x: 6, y: 80, w: 50, h: 10 }, anim: { in: 'slideUp', start: 1, inDur: 0.7 } });
  };
  const goScene = (i) => setCw(app, { sceneIdx: i, layerId: '', playT: 0, playing: false });
  const addScene = () => {
    edit(app, setCw, (sc) => { sc.push({ id: uid('s'), dur: 6, layers: [] }); return sc; });
    setCw(app, (c) => ({ sceneIdx: scenesOf(c).length - 1, layerId: '', playT: 0 }));
  };
  const dupScene = () => {
    if (!scene) return;
    const copy = JSON.parse(JSON.stringify(scene));
    copy.id = uid('s');
    copy.layers = copy.layers.map((l) => ({ ...l, id: uid(l.kind[0]) }));
    edit(app, setCw, (sc) => { sc.splice(idx + 1, 0, copy); return sc; });
    setCw(app, { sceneIdx: idx + 1, layerId: '', playT: 0 });
  };
  const head = html`
    <div class="cw-card__head">
      <span class="cw-card__title">6 · ${T('fe.title')} — ${T('fe.sceneOf', { i: idx + 1, n: scenes.length })}</span>
      <span class="cw-card__aside">${T('fe.totalDur', { d: fmtS(total) })} · ${portrait ? T('fe.portrait916') : T('fe.landscape169')}</span>
    </div>`;
  const tabs = html`<div class="fe-scenes">
    ${scenes.map((s, i) => html`<button type="button" key=${s.id} class=${'fe-scn' + (i === idx ? ' is-on' : '')} onClick=${() => goScene(i)}>${T('fe.scene', { i: i + 1 })} <span class="cw-muted">${fmtS(s.dur)}</span></button>`)}
    <button type="button" class="fe-scn fe-scn--add" disabled=${scenes.length >= 12} onClick=${addScene}>＋ ${T('fe.addScene')}</button>
  </div>`;
  const tools = html`<div class="fe-tools">
    <button type="button" class="btn" disabled=${!scene} onClick=${() => setCw(app, { drawer: { open: true, tab: 'marketing', campaign: true } })}>＋ ${T('fe.addPhoto')}</button>
    <button type="button" class="btn" disabled=${!scene} onClick=${addText}>＋ ${T('fe.addText')}</button>
    <button type="button" class="btn" disabled=${!scene} onClick=${addPrice}>＋ ${T('fe.addPrice')}</button>
    <span class="fe-flex"></span>
    <span class="cw-seg">
      <button type="button" class=${!portrait ? 'is-on' : ''} onClick=${() => setCw(app, { orient: 'paysage' })}>${T('fe.landscape')}</button>
      <button type="button" class=${portrait ? 'is-on' : ''} onClick=${() => setCw(app, { orient: 'portrait' })}>${T('fe.portraitBtn')}</button>
    </span>
    <button type="button" class="btn btn--sm" disabled=${!scene} onClick=${() => setCw(app, { playing: !cw.playing, playT: cw.playing ? liveT : (playT >= (scene ? scene.dur - 0.05 : 0) ? 0 : playT) })}>${cw.playing ? `❚❚ ${T('fe.pause')}` : `▶ ${T('fe.play')}`}</button>
  </div>`;
  const stage = scene ? h(Stage, {
    scene, items, portrait, playing: !!cw.playing, t: playT, T,
    selected: sel,
    onSelect: select,
    onCommit: (l) => editLayer(app, setCw, l.id, l),
    onTick: (t) => { liveT = t; const ph = document.querySelector('.fe-playhead'); if (ph && scene) ph.style.left = `calc(178px + (100% - 178px) * ${t / scene.dur})`; },
  }) : html`<div class="cw-note">${T('fe.noScene')}</div>`;
  return html`
    <section class="cw-card fe">
      ${head}${tabs}${tools}${stage}
      ${scene ? timeline(app, M, setCw, scene, sel, playT) : ''}
      ${exportBlock(app, M, setCw, scenes, items)}
    </section>
    ${cw.drawer && cw.drawer.open ? html`<${MediaDrawer} app=${app} M=${M} setCw=${setCw} onPick=${(layer) => addLayer(layer)} />` : ''}
    <div class="cw-foot">
      <button type="button" class="btn" onClick=${nav.back}>← ${nav.backLabel}</button>
      <span class="cw-foot__group">
        <button type="button" class="btn" disabled=${!scene} onClick=${dupScene}>${T('fe.dupScene')}</button>
        <button type="button" class="btn" disabled=${!scenes.length || !!(cw.exportJob && cw.exportJob.running)} onClick=${() => setCw(app, { exportOpen: !cw.exportOpen })}>${T('fe.export')}</button>
        <button type="button" class="btn btn--primary" disabled=${!nav.canNext} title=${nav.canNext ? '' : (nav.blockedTip || T('cw.nextBlocked'))} onClick=${nav.next}>${nav.nextLabel} →</button>
      </span>
    </div>`;
}

// Frise des calques : une ligne par calque (le plus haut d'abord), un bloc du
// début à la fin, la partie hachurée = l'animation d'entrée.
function timeline(app, M, setCw, scene, sel, playT) {
  const { T } = M;
  const dur = scene.dur;
  const step = dur <= 12 ? 1 : dur <= 24 ? 2 : 5;
  const ticks = [];
  for (let v = 0; v <= dur + 1e-6; v += step) ticks.push(Math.round(v * 10) / 10);
  const seek = (ev, el) => {
    const r = el.getBoundingClientRect();
    setCw(app, { playT: clamp(((ev.clientX - r.left) / r.width) * dur, 0, dur), playing: false });
  };
  const dragBlock = (ev, l) => {
    ev.stopPropagation();
    setCw(app, { layerId: l.id });
    const track = ev.currentTarget.parentElement.getBoundingClientRect();
    const x0 = ev.clientX;
    const a0 = l.anim;
    let moved = 0;
    const move = (e) => { moved = ((e.clientX - x0) / track.width) * dur; const blk = ev.target.closest('.fe-blk'); if (blk) blk.style.transform = `translateX(${e.clientX - x0}px)`; };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const blk = ev.target.closest('.fe-blk'); if (blk) blk.style.transform = '';
      if (Math.abs(moved) < 0.05) return;
      const start = clamp(a0.start + moved, 0, dur - 0.1);
      editLayer(app, setCw, l.id, { anim: { start: Math.round(start * 10) / 10, outAt: clamp(a0.outAt + (start - a0.start), start, dur) } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const rows = [...scene.layers].reverse();
  const ico = (l) => (l.kind === 'photo' ? '▣' : l.kind === 'price' ? '€' : 'Aa');
  const name = (l) => (l.kind === 'photo' ? (l.name || l.src.split('/').pop()) : l.kind === 'price' ? T('fe.layer.priceName') : (l.text || '').split('\n')[0]);
  return html`<div class="fe-tl">
    <div class="fe-tl__h"><span>${T('fe.layers')}</span>
      <div class="fe-tl__scale" onPointerDown=${(e) => seek(e, e.currentTarget)}>${ticks.map((v) => html`<span key=${v} style=${`left:${(v / dur) * 100}%`}>${v === 0 ? '0 s' : v}</span>`)}</div></div>
    ${rows.map((l) => {
      const end = l.anim.out === 'fade' ? Math.min(dur, l.anim.outAt + OUT_DUR) : dur;
      const left = (l.anim.start / dur) * 100;
      const width = Math.max(1.5, ((end - l.anim.start) / dur) * 100);
      const inW = l.anim.in === 'none' ? 0 : Math.min(100, (l.anim.inDur / Math.max(0.1, end - l.anim.start)) * 100);
      const label = l.kind === 'photo'
        ? `${T(FIT_LABEL[l.fit])} · ${Math.round(l.scale)} %${l.motion === 'kenburns' ? ` · ${T('fe.motion.kenburns')}` : ''}`
        : `${T(ANIM_LABEL[l.anim.in])}${l.anim.in !== 'none' ? ` · ${fmtS(l.anim.inDur)}` : ''}`;
      return html`<div key=${l.id} class=${'fe-row' + (sel && sel.id === l.id ? ' is-on' : '')} onClick=${() => setCw(app, { layerId: l.id })}>
        <div class="fe-row__n"><em>${ico(l)}</em><span>${name(l)}</span></div>
        <div class="fe-track" onPointerDown=${(e) => { if (e.target === e.currentTarget) seek(e, e.currentTarget); }}>
          <div class=${'fe-blk' + (l.kind === 'photo' ? ' fe-blk--img' : '')} style=${`left:${left}%;width:${width}%`} onPointerDown=${(e) => dragBlock(e, l)} title=${T('fe.blockTip')}>
            ${inW ? html`<span class="fe-blk__an" style=${`width:${inW}%`}></span>` : ''}<span class="fe-blk__t">${label}</span>
          </div>
          ${''}
        </div>
      </div>`;
    })}
    ${rows.length ? html`<div class="fe-playhead" style=${`left:calc(178px + (100% - 178px) * ${playT / dur})`}></div>` : html`<div class="cw-note">${T('fe.emptyScene')}</div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Panneau de droite : le calque sélectionné (ou la scène).
export function filmEditorPanel(app, M, setCw, nlState) {
  const { cw, T } = M;
  const scene = curScene(cw);
  const l = curLayer(cw);
  const portrait = cw.orient === 'portrait';
  if (!scene) return html`<section class="cw-card cw-card--side"><div class="cw-note">${T('fe.noScene')}</div></section>`;
  const setL = (patch) => editLayer(app, setCw, l.id, patch);
  const setA = (patch) => setL({ anim: patch });
  const numIn = (label, value, onChange, { step = 0.1, min = 0, max = 999, unit = '' } = {}) => html`
    <label class="fe-field"><span>${label}</span><span class="fe-field__v"><input type="number" step=${step} min=${min} max=${max} value=${value} onChange=${(e) => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (Number.isFinite(v)) onChange(clamp(v, min, max)); }} />${unit}</span></label>`;
  const sceneSec = html`<div class="fe-sec">
    <div class="cw-card__head"><span class="cw-card__title">${T('fe.scene', { i: (cw.sceneIdx || 0) + 1 })}</span>
      <button type="button" class="btn btn--sm btn--ghost" disabled=${scenesOf(cw).length < 2} onClick=${() => { edit(app, setCw, (sc, c) => { sc.splice(clamp(c.sceneIdx || 0, 0, sc.length - 1), 1); return sc; }); setCw(app, { sceneIdx: Math.max(0, (cw.sceneIdx || 0) - 1), layerId: '' }); }}>${T('fe.delScene')}</button></div>
    <div class="fe-two">
      ${numIn(T('fe.sceneDur'), scene.dur, (v) => edit(app, setCw, (sc, c) => { sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)].dur = v; return sc; }), { step: 0.5, min: 1, max: 120, unit: ' s' })}
      <div class="fe-field"><span>${T('fe.bg')}</span>${swatches(BRAND_COLORS.map((c) => c.hex), scene.bg, (hx) => edit(app, setCw, (sc, c) => { sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)].bg = hx; return sc; }), T)}</div>
    </div>
  </div>`;
  if (!l) return html`<section class="cw-card cw-card--side fe-panel">${sceneSec}</section>`;
  const layerActions = html`<span class="cw-foot__group">
    <button type="button" class="btn btn--sm btn--ghost" title=${T('fe.upTip')} onClick=${() => edit(app, setCw, (sc, c) => { const s = sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)]; const i = s.layers.findIndex((x) => x.id === l.id); if (i < s.layers.length - 1) [s.layers[i], s.layers[i + 1]] = [s.layers[i + 1], s.layers[i]]; return sc; })}>↑</button>
    <button type="button" class="btn btn--sm btn--ghost" title=${T('fe.downTip')} onClick=${() => edit(app, setCw, (sc, c) => { const s = sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)]; const i = s.layers.findIndex((x) => x.id === l.id); if (i > 0) [s.layers[i], s.layers[i - 1]] = [s.layers[i - 1], s.layers[i]]; return sc; })}>↓</button>
    <button type="button" class="btn btn--sm btn--ghost" onClick=${() => { edit(app, setCw, (sc, c) => { const s = sc[clamp(c.sceneIdx || 0, 0, sc.length - 1)]; s.layers = s.layers.filter((x) => x.id !== l.id); return sc; }); setCw(app, { layerId: '' }); }}>${T('fe.delLayer')}</button>
  </span>`;
  let body;
  if (l.kind === 'photo') {
    const pos = portrait ? (l.p || { x: 50, y: 45, scale: l.scale }) : { x: l.x, y: l.y, scale: l.scale };
    const setPos = (patch) => setL(portrait ? { p: { ...pos, ...patch } } : patch);
    const media = (M.st.mediaLib || []).find((m) => m.id === l.mediaId || ('media/' + encodeURIComponent(m.filename)) === l.src);
    body = html`<div class="fe-sec">
      <div class="cw-card__head"><span class="cw-card__title">${T('fe.layer.photo')}</span><span class="cw-card__aside">${l.name || l.src.split('/').pop()}</span></div>
      <div class="fe-lab">${T('fe.fit')}</div>
      <div class="fe-fit">${FITS.map((f) => html`<button type="button" key=${f} class=${'fe-fit__i' + (l.fit === f ? ' is-on' : '')} onClick=${() => setL({ fit: f })}><span class=${'fe-fit__ic fe-fit__ic--' + f}><b></b></span>${T(FIT_LABEL[f])}</button>`)}</div>
      <div class="fe-lab">${T('fe.scale')} <span>${Math.round(pos.scale)} %</span></div>
      <input class="fe-range" type="range" min="10" max="300" step="1" value=${pos.scale} onInput=${(e) => setPos({ scale: Number(e.target.value) })} />
      <div class="fe-two">
        ${numIn(T('fe.posX'), Math.round(pos.x), (v) => setPos({ x: v }), { step: 1, min: 0, max: 100, unit: ' %' })}
        ${numIn(T('fe.posY'), Math.round(pos.y), (v) => setPos({ y: v }), { step: 1, min: 0, max: 100, unit: ' %' })}
      </div>
      <div class="fe-two">
        <label class="fe-field"><span>${T('fe.motion')}</span><select class="cw-input cw-input--sm" value=${l.motion} onChange=${(e) => setL({ motion: e.target.value })}>
          <option value="none">${T('fe.motion.none')}</option><option value="kenburns">${T('fe.motion.kenburns')}</option></select></label>
        <div class="fe-field"><span>${T('fe.cutout')}</span>
          <button type="button" class="btn btn--sm" disabled=${l.mediaKind !== 'photo' || !media || !!cw.cutBusy} title=${T('fe.cutoutTip')} onClick=${() => cutout(app, M, setCw, l, media)}>${cw.cutBusy ? T('fe.cutoutBusy') : T('fe.cutoutDo')}</button></div>
      </div>
      ${cw.cutError ? html`<div class="cw-note cw-note--warn">${cw.cutError}</div>` : ''}
    </div>`;
  } else {
    const nl = (cw.nl || {})[l.id] || {};
    const setNl = (patch) => setCw(app, (c) => ({ nl: { ...(c.nl || {}), [l.id]: { ...((c.nl || {})[l.id] || {}), ...patch } } }));
    const field = l.kind === 'price' ? 'promo' : 'text';
    const trChip = nlState(l, field);
    const prodOpts = M.selProds.length ? M.selProds : [];
    body = html`<div class="fe-sec">
      <div class="cw-card__head"><span class="cw-card__title">${l.kind === 'price' ? T('fe.layer.priceSel') : T('fe.layer.textSel')}</span><span class="cw-card__aside">FR · NL</span></div>
      ${l.kind === 'price' ? html`<label class="fe-field"><span>${T('fe.product')}</span>
        <select class="cw-input cw-input--sm" value=${l.productId} onChange=${(e) => setL({ productId: e.target.value })}>
          <option value="">${T('fe.noProduct')}</option>
          ${prodOpts.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select></label>` : ''}
      <label class="fe-field"><span>${l.kind === 'price' ? T('fe.promoFr') : T('fe.textFr')}</span>
        ${l.kind === 'price' ? html`<input class="cw-input cw-input--sm" value=${l.promo} onInput=${(e) => setL({ promo: e.target.value })} />`
          : html`<textarea class="cw-input cw-input--sm fe-ta" rows="2" value=${l.text} onInput=${(e) => setL({ text: e.target.value })}></textarea>`}</label>
      <label class="fe-field"><span>${l.kind === 'price' ? T('fe.promoNl') : T('fe.textNl')} ${trChip}</span>
        ${l.kind === 'price' ? html`<input class="cw-input cw-input--sm" value=${nl.promo || ''} disabled=${!l.promo} onInput=${(e) => setNl({ promo: e.target.value })} />`
          : html`<textarea class="cw-input cw-input--sm fe-ta" rows="2" value=${nl.text || ''} onInput=${(e) => setNl({ text: e.target.value })}></textarea>`}</label>
      <div class="fe-lab">${T('fe.font')}</div>
      <div class="fe-fonts">${Object.keys(SCENE_FONTS).map((f) => html`<button type="button" key=${f} class=${'fe-font' + (l.font === f ? ' is-on' : '')} onClick=${() => setL({ font: f })}><span style=${`font-family:${SCENE_FONTS[f].family}`}>${f === 'title' ? 'AA' : 'Aa'}</span><small>${T('fe.font.' + f)}</small></button>`)}</div>
      <div class="fe-two">
        ${numIn(T('fe.size'), l.size, (v) => setL({ size: v }), { step: 1, min: 12, max: 400, unit: ' px' })}
        <div class="fe-field"><span>${T('fe.color')}</span>${swatches(TEXT_COLORS, l.color, (hx) => setL({ color: hx }), T)}</div>
      </div>
      ${l.kind === 'price' ? html`<div class="fe-field"><span>${T('fe.boxColor')}</span>${swatches([RUBY, INK, '#B8860B', '#2E6E4E', '#FFFFFF'], l.bg, (hx) => setL({ bg: hx }), T)}</div>` : ''}
      <div class="fe-field"><span>${T('fe.align')}</span><span class="cw-seg">${['left', 'center', 'right'].map((a) => html`<button type="button" key=${a} class=${l.align === a ? 'is-on' : ''} onClick=${() => setL({ align: a })}>${T('fe.align.' + a)}</button>`)}</span></div>
      ${(() => {
        const b = layerBox(l, portrait);
        const setB = (patch) => setL(portrait ? { boxP: { ...b, ...patch } } : { box: { ...b, ...patch } });
        return html`<div class="fe-four">
          ${numIn('X', Math.round(b.x), (v) => setB({ x: v }), { step: 1, min: -50, max: 100, unit: ' %' })}
          ${numIn('Y', Math.round(b.y), (v) => setB({ y: v }), { step: 1, min: -50, max: 100, unit: ' %' })}
          ${numIn(T('fe.w'), Math.round(b.w), (v) => setB({ w: v }), { step: 1, min: 3, max: 150, unit: ' %' })}
          ${numIn(T('fe.h'), Math.round(b.h), (v) => setB({ h: v }), { step: 1, min: 3, max: 150, unit: ' %' })}
        </div>`;
      })()}
    </div>`;
  }
  const a = l.anim;
  const animSec = html`<div class="fe-sec">
    <div class="fe-lab">${T('fe.animIn')}</div>
    <div class="fe-anims">${ANIMS_IN.filter((x) => l.kind !== 'photo' || ['none', 'fade', 'slideUp', 'slideLeft'].includes(x)).map((x) => html`
      <button type="button" key=${x} class=${'fe-anim' + (a.in === x ? ' is-on' : '')} onClick=${() => setA({ in: x, ...(x === 'hand' && a.inDur < 1.5 ? { inDur: 3 } : {}), ...(x === 'type' && a.inDur < 1 ? { inDur: 2 } : {}) })}>${T(ANIM_LABEL[x])}<span>${T(ANIM_LABEL[x] + 'Sub')}</span></button>`)}</div>
    <div class="fe-two">
      ${numIn(T('fe.start'), a.start, (v) => setA({ start: v }), { step: 0.1, min: 0, max: scene.dur, unit: ' s' })}
      ${numIn(T('fe.dur'), a.inDur, (v) => setA({ inDur: v }), { step: 0.1, min: 0.1, max: 30, unit: ' s' })}
    </div>
    <div class="fe-two">
      <label class="fe-field"><span>${T('fe.out')}</span><select class="cw-input cw-input--sm" value=${a.out} onChange=${(e) => setA({ out: e.target.value })}>
        <option value="none">${T('fe.out.none')}</option><option value="fade">${T('fe.out.fade')}</option></select></label>
      ${a.out === 'fade' ? numIn(T('fe.outAt'), a.outAt, (v) => setA({ outAt: v }), { step: 0.1, min: a.start, max: scene.dur, unit: ' s' }) : html`<span></span>`}
    </div>
  </div>`;
  return html`<section class="cw-card cw-card--side fe-panel">
    ${body}${animSec}
    <div class="fe-sec fe-sec--end">${layerActions}</div>
    ${sceneSec}
  </section>`;
}

function swatches(list, value, onPick, T) {
  return html`<span class="fe-sw">${list.map((hx) => {
    const c = BRAND_COLORS.find((x) => x.hex.toLowerCase() === hx.toLowerCase());
    return html`<button type="button" key=${hx} class=${'fe-sw__i' + (String(value).toLowerCase() === hx.toLowerCase() ? ' is-on' : '')} style=${`background:${hx}`} title=${c ? c.name : hx} aria-label=${c ? c.name : hx} onClick=${() => onPick(hx)}></button>`;
  })}</span>`;
}

async function cutout(app, M, setCw, l, media) {
  setCw(app, { cutBusy: true, cutError: '' });
  try {
    const r = await api('POST', '/film-media/cutout', { mediaId: media.id });
    if (r.mediaLib) app.setState({ mediaLib: r.mediaLib });
    editLayer(app, setCw, l.id, { src: 'media/' + encodeURIComponent(r.media.filename), mediaId: r.media.id, name: r.media.filename, fit: l.fit === 'cover' ? 'contain' : l.fit });
    setCw(app, { cutBusy: false });
  } catch (e) {
    setCw(app, { cutBusy: false, cutError: `${M.T('fe.cutoutKo')} : ${e.message}` });
  }
}

// ---------------------------------------------------------------------------
// Tiroir « Médiathèque » : Marketing · régie · webshop · import.
class MediaDrawer extends Component {
  constructor(props) {
    super(props);
    this.state = { q: '', chip: '', kind: '', campaign: true, sel: null, busy: '', error: '', mk: null, ws: null, upPct: 0 };
  }
  componentDidMount() { this.load(); this.esc = (e) => { if (e.key === 'Escape') this.close(); }; window.addEventListener('keydown', this.esc); }
  componentWillUnmount() { window.removeEventListener('keydown', this.esc); }
  tab() { const d = this.props.M.cw.drawer || {}; return d.tab || 'marketing'; }
  setTab(tab) { this.props.setCw(this.props.app, (c) => ({ drawer: { ...(c.drawer || {}), tab } })); this.setState({ sel: null, chip: '', error: '' }, () => this.load(tab)); }
  close() { this.props.setCw(this.props.app, { drawer: null }); }
  async load(tab = this.tab()) {
    if (tab === 'marketing' && !this.state.mk) {
      this.setState({ busy: 'load' });
      try { const r = await api('GET', '/film-media/marketing'); this.setState({ mk: r, busy: '' }); }
      catch (e) { this.setState({ mk: { ok: false, error: e.message, items: [] }, busy: '' }); }
    }
    if (tab === 'webshop' && !this.state.ws) {
      this.setState({ busy: 'load' });
      try { const r = await api('GET', '/film-media/webshop'); this.setState({ ws: r, busy: '' }); }
      catch (e) { this.setState({ ws: { ok: false, error: e.message, items: [] }, busy: '' }); }
    }
    if (tab === 'regie' && !(this.props.app.state.mediaLib || []).length) this.props.app.loadMediaLib();
  }
  // Toutes les sources sous une forme commune : { key, kind, name, sub, thumb, cats, season, moment, products, raw }.
  items() {
    const { M } = this.props;
    const tab = this.tab();
    const T = M.T;
    const prodNames = M.selProds.map((p) => norm(p.name)).filter(Boolean);
    const campOffer = new Set(((M.d && M.d.products) || []).map((p) => String(p.offerItemId)));
    const nameHit = (s) => prodNames.some((n) => n && norm(s).includes(n));
    if (tab === 'marketing') {
      return ((this.state.mk && this.state.mk.items) || []).map((a) => ({
        key: 'mk:' + a.id, src: 'marketing', id: a.id, kind: a.kind === 'video' ? 'video' : (a.cutout ? 'illustration' : 'photo'),
        name: a.name, sub: [a.category && a.category.label, a.season && a.season.label, a.width && a.height ? `${a.width} × ${a.height}` : ''].filter(Boolean).join(' · '),
        thumb: a.thumb, chips: [a.category && a.category.label, a.season && a.season.label].filter(Boolean),
        campaign: (a.offerItem && campOffer.has(String(a.offerItem.id))) || nameHit(a.name) || (a.offerItem && nameHit(a.offerItem.name)),
      }));
    }
    if (tab === 'webshop') {
      return ((this.state.ws && this.state.ws.items) || []).map((p) => ({
        key: 'ws:' + p.id, src: 'webshop', url: p.image, productId: p.productId, kind: 'photo', name: p.name, sub: p.category, thumb: p.thumb,
        chips: [p.category].filter(Boolean), campaign: (p.productId && M.cw.products.includes(p.productId)) || nameHit(p.name),
      }));
    }
    if (tab === 'regie') {
      const seasons = new Map((M.st.seasons || []).map((s) => [s.id, s.name]));
      const prod = (id) => M.prodById.get(id);
      return (M.st.mediaLib || []).filter((m) => m.present !== false).map((m) => ({
        key: 'rg:' + m.id, src: 'regie', media: m, kind: m.kind === 'film' ? 'video' : (/\.png$/i.test(m.filename) ? 'illustration' : 'photo'),
        name: m.filename, sub: [prod(m.productId) && prod(m.productId).name, seasons.get(m.seasonId), m.moment !== 'all' ? T('moment.' + m.moment) : ''].filter(Boolean).join(' · '),
        thumb: m.kind === 'photo' ? m.url : '', video: m.kind === 'film' ? m.url : '',
        chips: [prod(m.productId) && M.catName.get(prod(m.productId).categoryId), seasons.get(m.seasonId), m.moment !== 'all' ? T('moment.' + m.moment) : ''].filter(Boolean),
        campaign: M.cw.products.includes(m.productId) || nameHit(m.filename),
      }));
    }
    return [];
  }
  async add() {
    const it = this.state.sel;
    if (!it) return;
    const { app, onPick, M } = this.props;
    this.setState({ busy: 'add', error: '' });
    try {
      let media;
      if (it.src === 'regie') media = it.media;
      else {
        const r = await api('POST', '/film-media/import', it.src === 'marketing' ? { source: 'marketing', id: it.id } : { source: 'webshop', url: it.url, name: it.name, productId: it.productId });
        if (r.mediaLib) app.setState({ mediaLib: r.mediaLib });
        media = r.media;
      }
      onPick(photoLayer(media));
      this.setState({ busy: '' });
      this.close();
    } catch (e) { this.setState({ busy: '', error: `${M.T('fe.drawer.addKo')} : ${e.message}` }); }
  }
  async upload(file) {
    if (!file) return;
    const { app, onPick, M } = this.props;
    const kind = (file.type || '').startsWith('image/') ? 'photo' : 'film';
    this.setState({ busy: 'up', error: '' });
    try {
      const name = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const res = await fetch(apiUrl(`/media/upload?kind=${kind}&name=${encodeURIComponent(name)}`), { method: 'POST', credentials: 'same-origin', body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      app.setState({ mediaLib: j.media || [] });
      const media = (j.media || []).find((m) => m.filename === j.filename);
      if (!media) throw new Error('média introuvable après l’envoi');
      onPick(photoLayer(media));
      this.setState({ busy: '' });
      this.close();
    } catch (e) { this.setState({ busy: '', error: `${M.T('fe.drawer.upKo')} : ${e.message}` }); }
  }
  render({ M }, st) {
    const T = M.T;
    const tab = this.tab();
    const all = this.items();
    const q = norm(st.q);
    const chipsAll = [...new Set(all.flatMap((x) => x.chips))].slice(0, 8);
    const list = all.filter((x) => (!st.campaign || x.campaign) && (!st.chip || x.chips.includes(st.chip)) && (!st.kind || x.kind === st.kind)
      && (!q || norm(`${x.name} ${x.sub}`).includes(q)));
    const src = tab === 'marketing' ? st.mk : tab === 'webshop' ? st.ws : null;
    const chip = (on, label, onClick) => html`<button type="button" class=${'cw-pick' + (on ? ' is-on' : '')} onClick=${onClick}>${label}</button>`;
    const kindLabel = (k) => T('fe.kind.' + k);
    return html`<div class="fe-drawer" onClick=${(e) => { if (e.target === e.currentTarget) this.close(); }}>
      <div class="fe-dr" role="dialog" aria-label=${T('fe.drawer.title')}>
        <div class="fe-dr__h"><h2>${T('fe.drawer.title')}</h2><button type="button" class="btn btn--sm" aria-label=${T('fe.close')} onClick=${() => this.close()}>✕</button></div>
        <span class="cw-seg">${['marketing', 'regie', 'webshop', 'import'].map((t) => html`<button type="button" key=${t} class=${tab === t ? 'is-on' : ''} onClick=${() => this.setTab(t)}>${T('fe.drawer.' + t)}</button>`)}</span>
        ${tab === 'import' ? html`<div class="fe-dr__imp">
          <label class="btn btn--primary fe-file" title=${T('fe.drawer.importNote')}>${st.busy === 'up' ? T('fe.drawer.uploading') : T('fe.drawer.chooseFile')}
            <input type="file" accept="image/*,video/*" disabled=${!!st.busy} onChange=${(e) => this.upload(e.target.files && e.target.files[0])} /></label>
</div>` : html`
          <input class="cw-input fe-dr__q" placeholder=${T('fe.drawer.search')} value=${st.q} onInput=${(e) => this.setState({ q: e.target.value })} />
          <div class="cw-chips fe-dr__chips">
            ${chip(st.campaign, T('fe.drawer.campaign'), () => this.setState({ campaign: !st.campaign }))}
            ${chipsAll.map((c) => chip(st.chip === c, c, () => this.setState({ chip: st.chip === c ? '' : c })))}
            ${['photo', 'video', 'illustration'].map((k) => chip(st.kind === k, kindLabel(k + 's'), () => this.setState({ kind: st.kind === k ? '' : k })))}
          </div>
          ${src && src.ok === false ? html`<div class="cw-note cw-note--warn">${src.error}</div>` : ''}
          ${st.busy === 'load' ? html`<div class="cw-note">${T('fe.drawer.loading')}</div>` : ''}
          <div class="fe-grid">
            ${list.map((x) => html`<button type="button" key=${x.key} class=${'fe-th' + (st.sel && st.sel.key === x.key ? ' is-on' : '')} onClick=${() => this.setState({ sel: x })}>
              <span class="fe-th__im">${x.thumb ? html`<img src=${x.thumb} alt="" loading="lazy" />` : x.video ? html`<video src=${x.video} muted preload="metadata"></video>` : ''}<span class="fe-th__t">${kindLabel(x.kind)}</span>${st.sel && st.sel.key === x.key ? html`<span class="fe-th__ok">✓</span>` : ''}</span>
              <span class="fe-th__cap">${x.name}<span>${x.sub}</span></span>
            </button>`)}
          </div>
          ${!list.length && st.busy !== 'load' ? html`<div class="cw-note">${all.length ? T('fe.drawer.noneFiltered') : T('fe.drawer.none')}</div>` : ''}`}
        ${st.error ? html`<div class="cw-note cw-note--err">${st.error}</div>` : ''}
        <div class="fe-dr__f"><span class="cw-muted">${st.sel ? T('fe.drawer.chosen', { k: kindLabel(st.sel.kind) }) : ''}</span>
          <span class="cw-foot__group"><button type="button" class="btn" onClick=${() => this.close()}>${T('fe.cancel')}</button>
          <button type="button" class="btn btn--primary" disabled=${!st.sel || !!st.busy || tab === 'import'} onClick=${() => this.add()}>${st.busy === 'add' ? T('fe.drawer.copying') : T('fe.drawer.add')}</button></span></div>
      </div>
    </div>`;
  }
}
const photoLayer = (m) => ({
  id: uid('p'), kind: 'photo', src: 'media/' + encodeURIComponent(m.filename), mediaId: m.id, name: m.filename,
  mediaKind: m.kind === 'film' ? 'video' : 'photo', fit: 'cover', motion: 'none', x: 50, y: 50, scale: 100, anim: { in: 'none', start: 0 },
});

// ---------------------------------------------------------------------------
// Export vidéo : la même fonction de dessin, sur un canvas à la résolution de
// l'écran visé, capturé (captureStream) et encodé par MediaRecorder (WebM).
export const EXPORT_SIZES = [
  { id: 'uhd', w: 3840, h: 2160 },
  { id: 'fhd', w: 1920, h: 1080 },
];
export function exportMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
export async function renderVideo(scenes, { w, h, items = [], fps = 30, onProgress = () => {}, signal } = {}) {
  const mime = exportMime();
  if (!mime) throw new Error('ce navigateur ne sait pas enregistrer de vidéo WebM (MediaRecorder)');
  await preloadScenes(scenes);
  for (const s of scenes) for (const l of s.layers) if (l.kind === 'photo' && l.mediaKind === 'video') { const v = mediaEl(l.src, 'video'); if (v) { v.currentTime = 0; v.play().catch(() => {}); } }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const total = scenesDuration(scenes);
  const F = { x: 0, y: 0, w, h, portrait: h > w, items };
  const draw = (t) => { const { scene, lt } = sceneAt(scenes, t); ctx.clearRect(0, 0, w, h); drawScene(ctx, scene, lt, F); };
  draw(0);
  const stream = cv.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(w * h * fps * 0.12) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((ok) => { rec.onstop = ok; });
  rec.start(500);
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (signal && signal.aborted) { reject(new Error('export annulé')); return; }
      const t = (performance.now() - t0) / 1000;
      if (t >= total) { draw(total - 0.001); onProgress(1); resolve(); return; }
      draw(t);
      onProgress(t / total);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => { setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150); });
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: 'video/webm' });
}

function exportBlock(app, M, setCw, scenes, items) {
  const { cw, T } = M;
  if (!cw.exportOpen && !(cw.exportJob && (cw.exportJob.running || cw.exportJob.media || cw.exportJob.error))) return '';
  const job = cw.exportJob || {};
  const portrait = cw.orient === 'portrait';
  const size = EXPORT_SIZES.find((x) => x.id === (cw.exportSize || 'uhd')) || EXPORT_SIZES[0];
  const W0 = portrait ? size.h : size.w;
  const H0 = portrait ? size.w : size.h;
  const run = async () => {
    setCw(app, { exportJob: { running: true, pct: 0 } });
    try {
      const blob = await renderVideo(scenes, { w: W0, h: H0, items, onProgress: (p) => { const el = document.querySelector('.fe-exp__bar > i'); if (el) el.style.width = `${Math.round(p * 100)}%`; } });
      if (!blob.size) throw new Error('la vidéo enregistrée est vide');
      const title = (cw.titleFr || (M.camp && M.camp.name) || 'film').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'film';
      const name = `${title}-${W0}x${H0}.webm`;
      const res = await fetch(apiUrl(`/media/upload?kind=film&name=${encodeURIComponent(name)}`), { method: 'POST', credentials: 'same-origin', body: blob });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      app.setState({ mediaLib: j.media || [] });
      const media = (j.media || []).find((m) => m.filename === j.filename) || { filename: j.filename };
      setCw(app, { exportJob: { running: false, media, size: blob.size, w: W0, h: H0, local: URL.createObjectURL(blob) } });
    } catch (e) { setCw(app, { exportJob: { running: false, error: e.message } }); }
  };
  const mime = exportMime();
  return html`<div class="fe-exp">
    <div class="cw-card__head"><span class="cw-card__title">${T('fe.export')}</span><span class="cw-card__aside">${T('fe.exp.format', { w: W0, h: H0, d: fmtS(scenesDuration(scenes)) })}</span></div>
    <div class="fe-exp__row">
      <span class="cw-seg">${EXPORT_SIZES.map((x) => html`<button type="button" key=${x.id} class=${(cw.exportSize || 'uhd') === x.id ? 'is-on' : ''} disabled=${job.running} onClick=${() => setCw(app, { exportSize: x.id })}>${T('fe.exp.' + x.id)} · ${portrait ? `${x.h}×${x.w}` : `${x.w}×${x.h}`}</button>`)}</span>
      <button type="button" class="btn" disabled=${job.running || !mime} title=${mime ? T('fe.exp.tip') : T('fe.exp.noRecorder')} onClick=${run}>${job.running ? T('fe.exp.running') : T('fe.exp.go')}</button>
    </div>
    ${job.running ? html`<div class="fe-exp__bar"><i style="width:0%"></i></div>` : ''}
    ${job.error ? html`<div class="cw-note cw-note--err">${T('fe.exp.ko')} : ${job.error}</div>` : ''}
    ${job.media ? html`<div class="cw-note cw-note--acc fe-exp__done">
      <span>${T('fe.exp.done', { f: job.media.filename, mb: (job.size / 1048576).toFixed(1).replace('.', ',') })}</span>
      <span class="cw-foot__group"><a class="btn btn--sm" href=${'media/' + encodeURIComponent(job.media.filename)} download=${job.media.filename}>${T('fe.exp.download')}</a>
      <a class="btn btn--sm" href=${'media/' + encodeURIComponent(job.media.filename)} target="_blank" rel="noopener">${T('fe.exp.open')} ↗</a></span></div>` : ''}
  </div>`;
}

export { REF, portraitBox };
