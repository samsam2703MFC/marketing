// Scènes d'un film — LE moteur de rendu des scènes, partagé par :
//   · l'éditeur du film (assistant vidéo de campagne, étape 6) ;
//   · les écrans des magasins (player, visionneuse « film ») via renderer.js ;
//   · l'export vidéo (canvas → captureStream → MediaRecorder, WebM).
// Une seule fonction dessine une scène à un instant donné : drawScene(). Les
// trois usages l'appellent, rien n'est dessiné ailleurs.
//
// Un film est fait de SCÈNES (durée, fond, calques) ; un calque est :
//   · photo  — un média de la régie (photo ou vidéo), cadré (remplir, ajuster,
//              étirer, taille réelle), mis à l'échelle, positionné (X / Y en %),
//              avec un zoom lent facultatif (Ken Burns) ;
//   · text   — un texte (FR ; le néerlandais passe par les traductions validées
//              de la régie), police manuscrite / titre / Gotham, taille, couleur,
//              cadre (x, y, l, h en % de l'image) ;
//   · price  — « Prix / promo » : le prix du produit dans LE magasin (résolu par
//              magasin à la diffusion, m.items) et un texte de promotion.
// Chaque calque a une entrée (aucune, écriture à la main, machine à écrire,
// fondu, glissé du bas, glissé de la gauche) avec un début et une durée, et
// une sortie (aucune ou fondu).
//
// Aucun import DOM au chargement : ce module tourne aussi côté serveur
// (normScenes, sceneMediaUrls).
import { RUBY, INK, STAGE_BG, BRAND_COLORS } from './palette.js';

// Polices : noms des familles déclarées dans css/base.css.
export const SCENE_FONTS = {
  hand: { family: "'Playwrite DEVA'", weight: 400, upper: false, line: 1.5 },
  title: { family: "'Vank', 'Gotham'", weight: 400, upper: true, line: 1.02 },
  gotham: { family: "'Gotham'", weight: 400, upper: false, line: 1.18 },
};
export const FONT_IDS = ['hand', 'title', 'gotham'];
export const FITS = ['cover', 'contain', 'fill', 'none'];
export const MOTIONS = ['none', 'kenburns'];
export const ANIMS_IN = ['none', 'hand', 'type', 'fade', 'slideUp', 'slideLeft'];
export const ANIMS_OUT = ['none', 'fade'];
export const OUT_DUR = 0.6;
// Les tailles de texte sont exprimées en pixels d'une image de référence dont
// le petit côté fait 1080 px (« 52 px » = 52 px sur un écran Full HD, 104 px
// sur un écran 4K) : la même scène garde ses proportions à toute résolution.
export const REF = 1080;
export const MAX_SCENES = 12;
export const MAX_LAYERS = 12;

// ---------------------------------------------------------------------------
// Normalisation (régie, serveur) : ce qui est enregistré avec le film.
const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
const r2 = (n) => Math.round(n * 100) / 100;
const pick = (v, list, d) => (list.includes(v) ? v : d);
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toUpperCase() : d);
const sid = (v, d) => (String(v || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || d);
const txt = (v, n = 400) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, n);
// Une scène ne cite que des fichiers de la régie (médiathèque ou décor) : un
// fichier pris au Marketing est COPIÉ dans la régie avant d'arriver ici.
export function sceneSrc(v) {
  const s = String(v || '').trim();
  return /^(media|assets)\/[^\s"'<>\\]{1,240}$/.test(s) && !s.includes('..') ? s : '';
}
const isVideoSrc = (s) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(s).split(/[?#]/)[0]);
const normBox = (b, d) => {
  const o = b && typeof b === 'object' ? b : {};
  const x = num(o.x, -50, 100, d.x); const y = num(o.y, -50, 100, d.y);
  return { x: r2(x), y: r2(y), w: r2(num(o.w, 3, 150, d.w)), h: r2(num(o.h, 3, 150, d.h)) };
};
const DEF_BOX = { x: 6, y: 10, w: 50, h: 30 };
// Cadre en portrait déduit du paysage : même hauteur relative, pleine largeur utile.
export const portraitBox = (b) => ({ x: 6, y: b.y, w: 88, h: b.h });

function normAnim(a, dur) {
  const o = a && typeof a === 'object' ? a : {};
  const start = r2(num(o.start, 0, dur, 0));
  return {
    in: pick(o.in, ANIMS_IN, 'fade'),
    start,
    inDur: r2(num(o.inDur, 0.1, 30, 0.6)),
    out: pick(o.out, ANIMS_OUT, 'none'),
    outAt: r2(num(o.outAt, start, dur, Math.max(start, dur - OUT_DUR))),
  };
}

export function normLayer(l, dur, i = 0) {
  const o = l && typeof l === 'object' ? l : {};
  const kind = pick(o.kind, ['photo', 'text', 'price'], 'text');
  const base = { id: sid(o.id, `l${i + 1}`), kind, name: txt(o.name, 80), anim: normAnim(o.anim, dur) };
  if (kind === 'photo') {
    const src = sceneSrc(o.src);
    const pos = (p, d) => ({ x: r2(num(p && p.x, 0, 100, d.x)), y: r2(num(p && p.y, 0, 100, d.y)), scale: r2(num(p && p.scale, 10, 400, d.scale)) });
    const land = pos(o, { x: 50, y: 50, scale: 100 });
    return {
      ...base, src, mediaKind: o.mediaKind === 'video' || (o.mediaKind == null && isVideoSrc(src)) ? 'video' : 'photo',
      fit: pick(o.fit, FITS, 'cover'), motion: pick(o.motion, MOTIONS, 'none'), ...land,
      p: o.p && typeof o.p === 'object' ? pos(o.p, land) : null,
      mediaId: txt(o.mediaId, 40),
    };
  }
  const box = normBox(o.box, DEF_BOX);
  const out = {
    ...base, box, boxP: o.boxP ? normBox(o.boxP, portraitBox(box)) : null,
    font: pick(o.font, FONT_IDS, kind === 'price' ? 'gotham' : 'hand'),
    size: r2(num(o.size, 12, 400, kind === 'price' ? 40 : 64)),
    color: hex(o.color, kind === 'price' ? '#FFFFFF' : INK),
    align: pick(o.align, ['left', 'center', 'right'], 'left'),
  };
  if (kind === 'text') return { ...out, text: txt(o.text) };
  return { ...out, productId: txt(o.productId, 40), promo: txt(o.promo, 120), bg: hex(o.bg, RUBY) };
}

export function normScene(s, i = 0) {
  const o = s && typeof s === 'object' ? s : {};
  const dur = r2(num(o.dur, 1, 120, 8));
  return {
    id: sid(o.id, `s${i + 1}`), dur, bg: hex(o.bg, STAGE_BG),
    layers: (Array.isArray(o.layers) ? o.layers : []).slice(0, MAX_LAYERS).map((l, k) => normLayer(l, dur, k)).filter((l) => !(l.kind === 'photo' && !l.src)),
  };
}
export function normScenes(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_SCENES).map(normScene);
}
export const scenesDuration = (scenes) => (scenes || []).reduce((t, s) => t + (Number(s.dur) || 0), 0);
// La scène jouée à l'instant t du film, et l'instant dans la scène.
export function sceneAt(scenes, t) {
  const list = scenes || [];
  let x = Math.max(0, Number(t) || 0);
  for (let i = 0; i < list.length; i++) {
    if (x < list[i].dur || i === list.length - 1) return { scene: list[i], lt: Math.min(x, list[i].dur), index: i, offset: scenesDuration(list.slice(0, i)) };
    x -= list[i].dur;
  }
  return { scene: null, lt: 0, index: -1, offset: 0 };
}
// Fichiers d'un film en scènes (cache hors ligne des écrans, champ `media`).
export const sceneMediaUrls = (scenes) => (scenes || []).flatMap((s) => (s.layers || []).filter((l) => l.kind === 'photo' && l.src).map((l) => l.src));
// Produits dont le prix est montré (lignes résolues par magasin : m.items).
export const scenePriceProducts = (scenes) => [...new Set((scenes || []).flatMap((s) => (s.layers || []).filter((l) => l.kind === 'price' && l.productId).map((l) => l.productId)))];
export const brandHexes = () => BRAND_COLORS.map((c) => c.hex);

// ---------------------------------------------------------------------------
// Médias (navigateur seulement) : un élément par adresse, gardé.
const MEDIA = new Map();
export function mediaEl(src, kind) {
  if (typeof document === 'undefined' || !src) return null;
  let el = MEDIA.get(src);
  if (!el) {
    if (kind === 'video') {
      el = document.createElement('video');
      el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
      el.src = src;
      el.play().catch(() => {});
    } else {
      el = new Image();
      el.decoding = 'async';
      el.src = src;
    }
    MEDIA.set(src, el);
    if (MEDIA.size > 80) MEDIA.delete(MEDIA.keys().next().value);
  }
  return el;
}
const mediaReady = (el) => !!el && (el.tagName === 'VIDEO' ? el.readyState >= 2 && el.videoWidth > 0 : el.complete && el.naturalWidth > 0);
// Tout ce qu'une liste de scènes affiche, chargé (export, première image).
export async function preloadScenes(scenes, resolve = (u) => u) {
  await ensureSceneFonts();
  const waits = [];
  for (const s of scenes || []) {
    for (const l of s.layers || []) {
      if (l.kind !== 'photo' || !l.src) continue;
      const el = mediaEl(resolve(l.src), l.mediaKind);
      if (!el || mediaReady(el)) continue;
      waits.push(new Promise((ok) => {
        const done = () => ok();
        el.addEventListener(el.tagName === 'VIDEO' ? 'loadeddata' : 'load', done, { once: true });
        el.addEventListener('error', done, { once: true });
        setTimeout(done, 15000);
      }));
    }
  }
  await Promise.all(waits);
}
let fontsP = null;
let fontsReady = false;
export function ensureSceneFonts() {
  if (typeof document === 'undefined' || !document.fonts) { fontsReady = true; return Promise.resolve(); }
  if (!fontsP) {
    fontsP = Promise.all(Object.values(SCENE_FONTS).map((f) => document.fonts.load(`${f.weight} 64px ${f.family}`).catch(() => null))).then(() => { fontsReady = true; LAYOUTS.clear(); });
  }
  return fontsP;
}

// ---------------------------------------------------------------------------
// Dessin.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lum = (h) => { const c = hex(h, '#000000'); const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };

// Le texte d'un calque « Prix / promo », pour CE magasin (null : produit non
// vendu ici, le calque ne s'affiche pas).
export function priceText(l, items) {
  let price = '';
  if (l.productId) {
    const it = (items || []).find((x) => x && x.productId === l.productId && x.active !== false);
    if (!it) return null;
    price = String(it.price || '').trim();
  }
  const parts = [];
  if (price) parts.push(`${price} €`);
  if (l.promo) parts.push(l.promo);
  return parts.join(' · ');
}

// Découpe d'un texte en lignes dans la largeur du cadre (mots entiers ; un
// retour à la ligne saisi est gardé).
const LAYOUTS = new Map();
function layoutText(ctx, l, text, F) {
  const font = SCENE_FONTS[l.font] || SCENE_FONTS.hand;
  const B = F.portrait ? (l.boxP || portraitBox(l.box)) : l.box;
  const unit = Math.min(F.w, F.h) / REF;
  const px = Math.max(4, l.size * unit);
  const bx = F.x + (B.x / 100) * F.w;
  const by = F.y + (B.y / 100) * F.h;
  const bw = (B.w / 100) * F.w;
  const bh = (B.h / 100) * F.h;
  const shown = font.upper ? text.toUpperCase() : text;
  const key = [l.font, px.toFixed(2), bw.toFixed(1), shown].join('|');
  let lay = LAYOUTS.get(key);
  ctx.font = `${font.weight} ${px}px ${font.family}`;
  if (!lay) {
    const lines = [];
    const pad = l.kind === 'price' ? px * 0.55 : 0;
    const maxW = Math.max(px, bw - pad * 2);
    for (const para of shown.split('\n')) {
      const words = para.split(/(\s+)/).filter((w) => w !== '');
      let cur = '';
      for (const w of words) {
        const tryS = cur + w;
        if (cur.trim() && ctx.measureText(tryS.trimEnd()).width > maxW && w.trim()) { lines.push(cur.trimEnd()); cur = w.trimStart(); }
        else cur = tryS;
      }
      lines.push(cur.trimEnd());
    }
    // Position de chaque caractère (écriture à la main, machine à écrire).
    const rows = lines.map((s) => {
      const xs = [0];
      for (let i = 1; i <= s.length; i++) xs.push(ctx.measureText(s.slice(0, i)).width);
      return { s, w: xs[xs.length - 1], xs };
    });
    lay = { rows, pad };
    LAYOUTS.set(key, lay);
    if (LAYOUTS.size > 200) LAYOUTS.delete(LAYOUTS.keys().next().value);
  }
  const lineH = px * font.line;
  return { ...lay, font, px, lineH, bx, by, bw, bh };
}

// Hors-écran réutilisé pour l'écriture à la main (texte puis masque).
const OFF = [];
function offscreen(w, h, i = 0) {
  if (!OFF[i]) OFF[i] = document.createElement('canvas');
  const c = OFF[i];
  const W2 = Math.max(2, Math.ceil(w)); const H2 = Math.max(2, Math.ceil(h));
  if (c.width !== W2 || c.height !== H2) { c.width = W2; c.height = H2; } else c.getContext('2d').clearRect(0, 0, W2, H2);
  return c;
}

// Opacité, décalage et progression d'un calque à l'instant lt (null : caché).
function animState(l, lt, F) {
  const a = l.anim;
  if (lt < a.start) return null;
  let alpha = 1;
  if (a.out === 'fade' && lt > a.outAt) {
    alpha = 1 - (lt - a.outAt) / OUT_DUR;
    if (alpha <= 0) return null;
  }
  const p = a.in === 'none' ? 1 : clamp((lt - a.start) / a.inDur, 0, 1);
  let dx = 0; let dy = 0;
  if (a.in === 'fade') alpha *= easeOut(p);
  else if (a.in === 'slideUp') { alpha *= clamp(p * 1.6, 0, 1); dy = (1 - easeOut(p)) * F.h * 0.12; }
  else if (a.in === 'slideLeft') { alpha *= clamp(p * 1.6, 0, 1); dx = -(1 - easeOut(p)) * F.w * 0.15; }
  return { alpha, p, dx, dy, mode: a.in, since: lt - a.start };
}

// Rectangle d'une photo dans le cadre F à l'instant lt (null : pas encore chargée).
export function photoRect(l, lt, F, scene) {
  const el = mediaEl((F.resolve || ((u) => u))(l.src), l.mediaKind);
  if (!mediaReady(el)) return null;
  const iw = el.videoWidth || el.naturalWidth;
  const ih = el.videoHeight || el.naturalHeight;
  // Portrait sans réglage propre : la photo centrée dans la dalle.
  const P = F.portrait ? (l.p || { x: 50, y: 45, scale: l.scale }) : l;
  const kb = l.motion === 'kenburns' ? 1 + 0.08 * clamp(lt / Math.max(0.1, scene.dur), 0, 1) : 1;
  const k = (P.scale / 100) * kb;
  let w; let h;
  if (l.fit === 'fill') { w = F.w * k; h = F.h * k; }
  else {
    const s = l.fit === 'cover' ? Math.max(F.w / iw, F.h / ih)
      : l.fit === 'contain' ? Math.min(F.w / iw, F.h / ih)
        // Taille réelle : un pixel de l'image = un pixel de l'écran visé (4K).
        : (F.portrait ? F.w / 2160 : F.w / 3840);
    w = iw * s * k; h = ih * s * k;
  }
  return { el, w, h, x: F.x + (F.w - w) * (P.x / 100), y: F.y + (F.h - h) * (P.y / 100) };
}

function drawPhoto(ctx, l, lt, F, scene) {
  const st = animState(l, lt, F);
  if (!st) return;
  const r = photoRect(l, lt, F, scene);
  if (!r) return;
  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.drawImage(r.el, r.x + st.dx, r.y + st.dy, r.w, r.h);
  ctx.restore();
}

// Lignes d'un texte, telles qu'elles s'écrivent (machine à écrire : n premiers
// caractères ; sinon tout).
function drawLines(c, L, color, shadow, ox, oy, upto = Infinity) {
  c.font = `${L.font.weight} ${L.px}px ${L.font.family}`;
  c.fillStyle = color;
  c.textBaseline = 'alphabetic';
  if (shadow) { c.shadowColor = 'rgba(60,30,10,0.38)'; c.shadowBlur = L.px * 0.22; c.shadowOffsetY = L.px * 0.04; }
  let left = upto;
  L.rows.forEach((r, i) => {
    if (left <= 0) return;
    const s = left >= r.s.length ? r.s : r.s.slice(0, left);
    left -= r.s.length;
    c.fillText(s, ox + rowX(L, r), oy + baseline(L, i));
  });
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
}
const rowX = (L, r, align = L.align) => (align === 'center' ? (L.bw - r.w) / 2 : align === 'right' ? L.bw - r.w - L.pad : L.pad);
const baseline = (L, i) => L.px * (L.font === SCENE_FONTS.hand ? 1.1 : 0.92) + i * L.lineH + (L.padY || 0);

function drawText(ctx, l, lt, F, text) {
  const st = animState(l, lt, F);
  if (!st || !text) return;
  const L0 = layoutText(ctx, l, text, F);
  const L = { ...L0, align: l.align, padY: l.kind === 'price' ? L0.px * 0.32 : 0 };
  const shadow = l.kind === 'text' && lum(l.color) > 0.62;
  const ox = L.bx + st.dx;
  const oy = L.by + st.dy;
  ctx.save();
  ctx.globalAlpha = st.alpha;
  if (l.kind === 'price') {
    // Rectangle aux couleurs de l'offre, ajusté au texte (rayon 6 px à 1080p).
    const tw = Math.max(...L.rows.map((r) => r.w), 0) + L.pad * 2;
    const th = L.rows.length * L.lineH + L.padY * 2 - (L.lineH - L.px);
    const bxw = l.align === 'center' ? (L.bw - tw) / 2 : l.align === 'right' ? L.bw - tw : 0;
    const boxA = st.mode === 'hand' || st.mode === 'type' ? clamp(st.since / 0.3, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = st.alpha * boxA;
    ctx.fillStyle = l.bg;
    roundRect(ctx, ox + bxw, oy, tw, th, (6 * Math.min(F.w, F.h)) / REF);
    ctx.fill();
    ctx.restore();
    L.align = 'left';
    L.pad = bxw + L.pad;
  }
  if (st.mode === 'type' && st.p < 1) {
    const total = L.rows.reduce((t, r) => t + r.s.length, 0);
    const n = Math.floor(st.p * total + 1e-6);
    drawLines(ctx, L, l.color, shadow, ox, oy, n);
    // Curseur qui clignote au bout du texte.
    let left = n; let row = 0;
    while (row < L.rows.length - 1 && left > L.rows[row].s.length) { left -= L.rows[row].s.length; row++; }
    const r = L.rows[row];
    const cx = ox + rowX(L, r) + r.xs[Math.min(left, r.s.length)] + L.px * 0.04;
    if (Math.floor(st.since * 2.4) % 2 === 0) { ctx.fillStyle = l.color; ctx.fillRect(cx, oy + baseline(L, row) - L.px * 0.8, Math.max(1, L.px * 0.06), L.px * 0.95); }
  } else if (st.mode === 'hand' && st.p < 1) {
    drawHand(ctx, L, l, st, shadow, ox, oy);
  } else {
    drawLines(ctx, L, l.color, shadow, ox, oy);
  }
  ctx.restore();
}

// Écriture à la main : la plume avance le long du texte, à vitesse constante
// (chaque lettre prend le temps de sa largeur, un temps de levée entre deux
// mots et entre deux lignes). Le texte est tracé sur un hors-écran, puis un
// masque ne garde que ce que la plume a déjà parcouru — bord d'encre fondu,
// plume visible au bout du trait qui monte et descend avec l'écriture.
function drawHand(ctx, L, l, st, shadow, ox, oy) {
  const lift = L.px * 0.5;
  const segs = L.rows.map((r) => r.w + lift);
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let left = easeIO(st.p) * 0.15 + st.p * 0.85;
  left *= total;
  let row = 0;
  while (row < L.rows.length - 1 && left > segs[row]) { left -= segs[row]; row++; }
  const xr = Math.min(left, L.rows[row].w);
  const m = L.px * 0.8;
  const c0 = offscreen(L.bw + m * 2, L.rows.length * L.lineH + L.px * 1.4 + m * 2);
  const c = c0.getContext('2d');
  c.clearRect(0, 0, c0.width, c0.height);
  drawLines(c, L, l.color, shadow, m, m);
  // Masque (sur son propre hors-écran : un « destination-in » efface tout ce
  // qu'il ne couvre pas, il ne s'applique donc qu'une fois) : lignes déjà
  // écrites entières, ligne en cours jusqu'à la plume, bord fondu.
  const k0 = offscreen(c0.width, c0.height, 1);
  const k = k0.getContext('2d');
  k.clearRect(0, 0, k0.width, k0.height);
  k.fillStyle = '#000';
  const feather = L.px * 0.32;
  const band = (i) => {
    const b = m + baseline(L, i);
    return [b - L.px * 1.15, L.px * 1.15 + Math.min(L.px * 0.55, L.lineH - L.px * 0.6)];
  };
  for (let i = 0; i < row; i++) { const [y0, hh] = band(i); k.fillRect(0, y0, k0.width, hh); }
  const r = L.rows[row];
  const x0 = m + rowX(L, r);
  const [y0, hh] = band(row);
  k.fillRect(0, y0, Math.max(0, x0 + xr - feather), hh);
  const g = k.createLinearGradient(x0 + xr - feather, 0, x0 + xr, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = g;
  k.fillRect(Math.max(0, x0 + xr - feather), y0, feather, hh);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(k0, 0, 0);
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(c0, ox - m, oy - m);
  // La plume : un trait fin au bout de l'écriture, qui suit le dessin des lettres.
  if (xr < r.w) {
    const by = oy + baseline(L, row);
    const wob = Math.sin(st.since * 22) * 0.32 + Math.sin(st.since * 9) * 0.18;
    const tipY = by - L.px * (0.42 + wob * 0.55);
    const tipX = ox + rowX(L, r) + xr;
    ctx.save();
    ctx.strokeStyle = l.color;
    ctx.globalAlpha *= 0.85;
    ctx.lineWidth = Math.max(1, L.px * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + L.px * 0.12, tipY - L.px * 0.55);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dessine la scène à l'instant lt dans le rectangle F = { x, y, w, h } du
// contexte. F.portrait : composition portrait (cadres boxP, positions p).
// F.items : lignes de produits résolues pour le magasin (prix). F.resolve :
// adresse locale d'un fichier (cache hors ligne), identité par défaut.
export function drawScene(ctx, scene, lt, F0) {
  if (!scene) return;
  const F = { resolve: (u) => u, items: [], ...F0 };
  if (F.portrait == null) F.portrait = F.h > F.w * 1.05;
  ensureSceneFonts();
  ctx.save();
  ctx.beginPath();
  ctx.rect(F.x, F.y, F.w, F.h);
  ctx.clip();
  ctx.fillStyle = scene.bg || STAGE_BG;
  ctx.fillRect(F.x, F.y, F.w, F.h);
  for (const l of scene.layers || []) {
    if (l.kind === 'photo') drawPhoto(ctx, l, lt, F, scene);
    else if (l.kind === 'text') drawText(ctx, l, lt, F, l.text);
    else if (l.kind === 'price') {
      const t = priceText(l, F.items);
      if (t) drawText(ctx, l, lt, F, t);
    }
  }
  ctx.restore();
}

// Rectangle d'un calque texte / prix dans le cadre, en % (éditeur : poignées).
export const layerBox = (l, portrait) => (portrait ? (l.boxP || portraitBox(l.box)) : l.box);

// ---------------------------------------------------------------------------
// Sur un écran : le film en scènes est dessiné dans un <canvas> posé sur la
// partie VISIBLE du canevas (6480 × 3840) — en paysage, la bande 16:9 ; en
// portrait, la dalle centrale 9:16. La composition suit la forme visible, et la
// résolution du canvas celle de l'écran (pas de mise à l'échelle floue).
function clipRect(el) {
  let rect = null;
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const r = p.getBoundingClientRect();
      rect = rect ? { left: Math.max(rect.left, r.left), top: Math.max(rect.top, r.top), right: Math.min(rect.right, r.right), bottom: Math.min(rect.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }
  const vw = window.innerWidth; const vh = window.innerHeight;
  const v = { left: 0, top: 0, right: vw, bottom: vh };
  return rect ? { left: Math.max(rect.left, v.left), top: Math.max(rect.top, v.top), right: Math.min(rect.right, v.right), bottom: Math.min(rect.bottom, v.bottom) } : v;
}
export function paintScenes(el, m, lt, stageW, stageH) {
  if (!el || typeof window === 'undefined') return;
  const cv = el.firstChild;
  if (!cv || !cv.getContext) return;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return;
  const s = r.width / stageW;
  const c = clipRect(el);
  let vx = (Math.max(c.left, r.left) - r.left) / s;
  let vy = (Math.max(c.top, r.top) - r.top) / s;
  let vw = (Math.min(c.right, r.right) - Math.max(c.left, r.left)) / s;
  let vh = (Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top)) / s;
  if (!(vw > 10 && vh > 10)) { vx = 0; vy = 0; vw = stageW; vh = stageH; }
  const dpr = window.devicePixelRatio || 1;
  let pw = vw * s * dpr; let ph = vh * s * dpr;
  const cap = 3840 / Math.max(pw, ph);
  if (cap < 1) { pw *= cap; ph *= cap; }
  pw = Math.max(2, Math.round(pw)); ph = Math.max(2, Math.round(ph));
  const st = cv.style;
  const L = `${vx}px`; const T = `${vy}px`;
  if (st.left !== L) st.left = L;
  if (st.top !== T) st.top = T;
  if (st.width !== `${vw}px`) st.width = `${vw}px`;
  if (st.height !== `${vh}px`) st.height = `${vh}px`;
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  const ctx = cv.getContext('2d');
  const { scene, lt: slt } = sceneAt(m.scenes, lt);
  drawScene(ctx, scene, slt, { x: 0, y: 0, w: pw, h: ph, items: m.items || [] });
  // Un aperçu figé (vignette de l'assistant) n'est pas redessiné à chaque
  // image : tant qu'une photo ou une police arrive, on redessine un peu plus tard.
  const pending = (scene ? scene.layers : []).some((l) => l.kind === 'photo' && !mediaReady(mediaEl(l.src, l.mediaKind)));
  clearTimeout(el.__sceneRetry);
  if (pending || !fontsReady) {
    const n = (el.__sceneTries || 0) + 1;
    el.__sceneTries = n;
    if (n < 40) el.__sceneRetry = setTimeout(() => { if (el.isConnected) paintScenes(el, m, lt, stageW, stageH); }, 250);
  } else el.__sceneTries = 0;
}

export { INK, RUBY, STAGE_BG };
