// Rendu signage partagé — utilisé par l'aperçu du back office ET par le player.
// Port fidèle du moteur de la maquette (écran virtuel 6480 × 3840, 3 dalles).
export const RUBY = '#8D1D2C';
export const INK = '#232220';
export const FVANK = "'Vank','Gotham'";
export const FUI = "'Gotham'";
export const W = 6480;
export const H = 3840;
export const SCREEN = 2160;
export const BAND_H = 320;
export const PAD_L = 110;
export const NAME_W = 1720;
export const GAP = 160;
export const PRICE_W = 560;
export const BAND_W = Math.round((PAD_L + NAME_W + GAP + PRICE_W) * 1.10);
export const ILLO = 2130;
export const ROW_TOP = 1040;
export const LIAISON_DUR = 3.5;

export const clx = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hx = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mixHex = (h1, h2, t) => {
  const [r1, g1, b1] = hx(h1), [r2, g2, b2] = hx(h2);
  const c = (a, b) => Math.round(mix(a, b, t));
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
};
export const fmtTime = (s) => {
  const m = Math.floor(s / 60), ss = Math.floor(Math.max(0, s) % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

export const LAYOUTS = [
  { id: 'illo-right', icon: '▤', label: 'Texte à gauche · illustration à droite' },
  { id: 'illo-left', icon: '▤', label: 'Texte à droite · illustration à gauche' },
  { id: 'text-only', icon: '≡', label: 'Texte centré · sans illustration' },
  { id: 'illo-bg', icon: '◉', label: 'Illustration centrée en fond' },
  { id: 'two-col', icon: '▥', label: 'Liste sur 2 colonnes' },
  { id: 'illo-top', icon: '⬒', label: 'Illustration en haut · liste dessous' },
  { id: 'hero', icon: '★', label: 'Produit à la une (plein écran)' },
];
export const MOTIONS = [
  { id: 'm1', label: 'Mouvement 1 · Doux' },
  { id: 'm2', label: 'Mouvement 2 · Ample' },
  { id: 'm3', label: 'Mouvement 3 · Pulsé' },
  { id: 'none', label: 'Pas de mouvement' },
];
export const MO = {
  none: { w: 0, r: 0, osc: 0, slide: false, fspd: 0, pulse: false },
  m1: { w: 22, r: 1.6, osc: 1, slide: true, fspd: 2, pulse: false },
  m2: { w: 44, r: 3.2, osc: 1, slide: true, fspd: 3, pulse: false },
  m3: { w: 16, r: 1.0, osc: 1, slide: true, fspd: 1.4, pulse: true },
};

export const newTag = () => ({ enabled: false, label: 'Nouveauté', img: 'assets/cherry.png' });
export const newSched = () => ({ days: [true, true, true, true, true, true, true], from: '00:00', to: '23:59' });
export const newPos = () => ({ titleY: 0, listX: 0, listY: 0, illoX: 0, illoY: 0, illoScale: 1 });

export const activeItems = (m) => ((m && m.items) ? m.items : []).filter((x) => x.active);
// Une liste de prix sans produit actif est sautée à la lecture du film.
export const playable = (m) => (m && m.type === 'category' ? activeItems(m).length > 0 : true);
export const moduleDur = (m, secPerLine) => {
  if (m.type === 'liaison') return LIAISON_DUR;
  if (m.type === 'produit') return m.dur > 0 ? m.dur : 8;
  if (m.type === 'film') return m.dur > 0 ? m.dur : 10;
  if (m.type === 'animation') return m.dur > 0 ? m.dur : 6;
  return Math.max(1, activeItems(m).length) * secPerLine;
};

export function layoutCfg(L, n) {
  const c = { mode: 'list', listL: 200, illoCX: 4950, illoCY: null, illoSize: ILLO, illoOp: 1, illoBehind: false, illoShown: true, rowTop: ROW_TOP, cols: 1 };
  if (L === 'illo-left') { c.listL = 2360; c.illoCX = 1150; }
  else if (L === 'text-only') { c.illoShown = false; c.listL = (W - BAND_W) / 2; }
  else if (L === 'illo-bg') {
    c.listL = (W - BAND_W) / 2; c.illoCX = W / 2; c.illoOp = 0.12; c.illoBehind = true;
    c.illoCY = (ROW_TOP + (ROW_TOP + (n > 1 ? Math.min(352, (H - ROW_TOP - 200) / (n - 1)) : 0) * (n - 1))) / 2;
  } else if (L === 'two-col') { c.mode = 'twocol'; c.illoShown = false; c.cols = 2; }
  else if (L === 'illo-top') { c.rowTop = 2180; c.illoCX = W / 2; c.illoSize = 1400; c.illoCY = 1180; }
  else if (L === 'hero') { c.mode = 'hero'; }
  return c;
}

// Rendu d'un module à l'instant lt (secondes locales au module).
// opts : { secPerLine, interactive, onIlloDown, onListDown }
export function renderModule(h, m, lt, opts) {
  opts = opts || {};
  const secPerLine = opts.secPerLine || 4;
  const kids = [];
  kids.push(h('div', { key: 's1', style: { position: 'absolute', left: SCREEN, top: 0, width: 2, height: H, background: 'rgba(35,34,32,0.07)' } }));
  kids.push(h('div', { key: 's2', style: { position: 'absolute', left: SCREEN * 2, top: 0, width: 2, height: H, background: 'rgba(35,34,32,0.07)' } }));
  const tag = m.tag && m.tag.enabled ? m.tag : null;
  const tagEl = () => {
    if (!tag) return null;
    return h('div', {
      key: 'tag',
      style: {
        position: 'absolute', right: 180, top: 230, display: 'flex', alignItems: 'center', gap: 36,
        background: RUBY, color: '#fff', borderRadius: 999, padding: '34px 60px 34px 44px',
        boxShadow: '0 24px 60px rgba(141,29,44,0.30)', zIndex: 6,
        transform: `rotate(-3deg) scale(${1 + 0.02 * Math.sin(lt * Math.PI * 2)})`, transformOrigin: 'center',
      },
    },
    tag.img ? h('img', { src: tag.img, alt: '', style: { width: 150, height: 150, objectFit: 'contain', filter: 'brightness(0) invert(1)' } }) : null,
    h('span', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 130, letterSpacing: '0.02em', textTransform: 'uppercase', lineHeight: 1 } }, tag.label || ''));
  };

  if (m.type === 'liaison') {
    const dur = moduleDur(m, secPerLine);
    const a = Math.min(easeIO(clx(lt / 0.5, 0, 1)), easeIO(clx((dur - lt) / 0.5, 0, 1)));
    const sc = 1 + 0.03 * (lt / dur);
    kids.push(h('div', {
      key: 'lz',
      style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 80, opacity: a, transform: `scale(${sc})`, transformOrigin: 'center' },
    },
    h('img', { src: 'assets/logo.png', alt: '', style: { height: 420, width: 'auto' } }),
    h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 300, letterSpacing: '0.01em', textTransform: 'uppercase', color: INK, textAlign: 'center', lineHeight: 0.95 } }, (m.name || '').toUpperCase()),
    h('div', { style: { fontFamily: FUI, fontWeight: 500, fontSize: 76, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8A847C' } }, m.sub || '')));
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // ---- Film : vidéo importée, plein écran (cover) ou letterbox (contain) ----
  if (m.type === 'film') {
    if (m.video) {
      kids.push(h('div', { key: 'vbg', style: { position: 'absolute', inset: 0, background: '#000' } }));
      kids.push(h('video', {
        key: 'vid' + m.id,
        src: m.video,
        autoplay: true, muted: true, loop: true, playsinline: true,
        style: { position: 'absolute', inset: 0, width: W, height: H, objectFit: m.layout === 'contain' ? 'contain' : 'cover' },
      }));
    } else if (m.surprise) {
      const n = m.surpriseCount || (m.surpriseVideos || []).length;
      kids.push(h('div', { key: 'surp', style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 60, alignItems: 'center', justifyContent: 'center', background: '#141414', color: '#fff' } },
        h('div', { style: { fontSize: 300 } }, '🎲'),
        h('div', { style: { fontFamily: FUI, fontSize: 96, letterSpacing: '0.12em', textTransform: 'uppercase' } }, 'Vidéo surprise'),
        h('div', { style: { fontFamily: FUI, fontSize: 74, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em' } }, `${n} vidéo(s) · piochée au hasard`)));
    } else {
      kids.push(h('div', { key: 'novid', style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 70, alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { fontSize: 260, color: '#C9C3B8' } }, '▶'),
        h('div', { style: { fontFamily: FUI, fontSize: 90, color: '#8A847C', letterSpacing: '0.14em', textTransform: 'uppercase' } }, 'importe une vidéo dans la régie')));
    }
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // ---- Animation : titre + accroche animés (crème/encre ou rubis/blanc) ----
  if (m.type === 'animation') {
    const dur = moduleDur(m, secPerLine);
    const band = m.layout === 'band';
    const mo = MO[m.motion || 'm1'] || MO.m1;
    const a = Math.min(easeIO(clx(lt / 0.5, 0, 1)), easeIO(clx((dur - lt) / 0.5, 0, 1)));
    const drift = mo.w * 2 * Math.sin(lt * Math.PI * (mo.fspd || 1) * 0.5);
    const zoom = 1 + 0.05 * (lt / dur) + (mo.pulse ? 0.015 * Math.sin(lt * Math.PI * 3) : 0);
    if (band) kids.push(h('div', { key: 'abg', style: { position: 'absolute', inset: 0, background: RUBY } }));
    kids.push(h('div', {
      key: 'anim',
      style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 90, opacity: a, transform: `translateY(${drift}px) scale(${zoom})`, transformOrigin: 'center' },
    },
    band ? h('img', { src: 'assets/logo-white.png', alt: '', style: { height: 300, width: 'auto' } }) : null,
    h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 380, letterSpacing: `${0.02 + 0.03 * (0.5 + 0.5 * Math.sin(lt * Math.PI * 1.2))}em`, textTransform: 'uppercase', color: band ? '#fff' : INK, textAlign: 'center', lineHeight: 0.95, padding: '0 200px' } }, (m.name || '').toUpperCase()),
    m.sub ? h('div', { style: { fontFamily: FUI, fontWeight: 500, fontSize: 88, letterSpacing: '0.22em', textTransform: 'uppercase', color: band ? 'rgba(255,255,255,0.75)' : '#8A847C', textAlign: 'center' } }, m.sub) : null,
    band ? null : h('div', { style: { width: 620, height: 16, background: RUBY, borderRadius: 8 } })));
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // ---- Produit : un seul produit en très grand (photo, nom, prix) ----------
  if (m.type === 'produit') {
    const it = activeItems(m)[0] || (m.items || [])[0];
    const P0 = m.pos || newPos();
    const mo = MO[m.motion || 'm1'] || MO.m1;
    const wob = mo.w * Math.sin(lt * Math.PI * (mo.fspd || 1));
    if (!it) {
      kids.push(h('div', { key: 'nopr', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FUI, fontSize: 90, color: '#8A847C', letterSpacing: '0.14em', textTransform: 'uppercase' } }, 'choisis un produit dans la régie'));
      return kids;
    }
    const full = m.layout === 'hero-full';
    const left = m.layout === 'hero-left';
    if (full) {
      kids.push(h('div', { key: 'pbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4' } }));
      kids.push(h('img', { key: 'pimg', src: it.img, alt: '', style: { position: 'absolute', inset: 0, width: W, height: H, objectFit: it.src === 'photo' ? 'cover' : 'contain', opacity: it.src === 'photo' ? 1 : 0.9, transform: `scale(${1 + 0.04 * (lt / moduleDur(m, secPerLine))})`, transformOrigin: 'center' } }));
      kids.push(h('div', { key: 'pshade', style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1400, background: 'linear-gradient(transparent, rgba(20,10,8,0.78))' } }));
      kids.push(h('div', { key: 'ptxt', style: { position: 'absolute', left: 260, bottom: 220, display: 'flex', flexDirection: 'column', gap: 40 } },
        h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 340, letterSpacing: '0.01em', textTransform: 'uppercase', color: '#fff', lineHeight: 0.95 } }, (it.name || m.name || '').toUpperCase()),
        h('div', { style: { fontFamily: FUI, fontWeight: 300, fontSize: 220, color: '#fff' } }, (it.price || ''), h('span', { style: { fontSize: 110, verticalAlign: 'super' } }, '€'))));
    } else {
      const imgCX = left ? 1620 : W - 1620;
      const txtX = left ? 3400 : 260;
      const imgSize = Math.round(2600 * (P0.illoScale || 1));
      kids.push(h('div', { key: 'pimgw', style: { position: 'absolute', left: imgCX - imgSize / 2 + P0.illoX, top: H / 2 - imgSize / 2 + P0.illoY, width: imgSize, height: imgSize, transform: `translateY(${wob}px) rotate(${mo.r * Math.sin(lt * Math.PI * 0.8)}deg)` } },
        h('img', { src: it.img, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain', borderRadius: it.src === 'photo' ? 60 : 0, boxShadow: it.src === 'photo' ? '0 60px 160px rgba(35,34,32,0.35)' : 'none' } })));
      kids.push(h('div', { key: 'ptxt', style: { position: 'absolute', left: txtX + P0.listX, top: H / 2 - 560 + P0.titleY, width: 2800, display: 'flex', flexDirection: 'column', gap: 70 } },
        h('div', { style: { fontFamily: FUI, fontWeight: 500, fontSize: 74, letterSpacing: '0.24em', textTransform: 'uppercase', color: RUBY } }, m.name || 'À la une'),
        h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 350, letterSpacing: '0.01em', textTransform: 'uppercase', color: INK, lineHeight: 0.95 } }, (it.name || '').toUpperCase()),
        h('div', { style: { width: 520, height: 16, background: RUBY, borderRadius: 8 } }),
        h('div', { style: { fontFamily: FUI, fontWeight: 300, fontSize: 250, color: RUBY } }, (it.price || ''), h('span', { style: { fontSize: 120, verticalAlign: 'super' } }, '€')),
        m.sub ? h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: 66, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8A847C' } }, m.sub) : null));
    }
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  const act = activeItems(m);
  const n = act.length;
  const L = m.layout || 'illo-right';
  const cfg = layoutCfg(L, n);
  const P = m.pos || newPos();
  cfg.listL += P.listX; cfg.rowTop += P.listY; cfg.illoCX += P.illoX;
  if (cfg.illoCY != null) cfg.illoCY += P.illoY;
  cfg.illoSize = Math.round(cfg.illoSize * (P.illoScale || 1));
  const moList = MO[m.motionList || m.motion || 'm1'] || MO.m1;
  const moIllo = MO[m.motionIllo || m.motion || 'm1'] || MO.m1;
  const moTitle = MO[m.motionTitle || m.motion || 'm1'] || MO.m1;
  const osc = moTitle.osc ? (0.5 + 0.5 * Math.sin(lt * Math.PI * 1.2)) : 0;
  const tPulse = moTitle.pulse ? (1 + 0.02 * (0.5 + 0.5 * Math.sin(lt * Math.PI * 4))) : 1;
  kids.push(h('img', { key: 'b1', src: 'assets/sweet-tart-big.png', style: { position: 'absolute', left: -360, top: 300, width: 1700, opacity: 0.05 } }));
  kids.push(h('img', { key: 'b2', src: 'assets/rhubarb.png', style: { position: 'absolute', right: -260, bottom: -320, width: 1300, opacity: 0.05 } }));

  if (cfg.mode === 'hero') {
    const raw = lt / secPerLine;
    const idx = n ? ((Math.floor(raw) % n) + n) % n : 0;
    const tin = raw - Math.floor(raw);
    const cross = moList.slide ? easeIO(clx(tin / 0.4, 0, 1)) : 1;
    const fromI = (idx - 1 + n) % n;
    const hs = Math.round(2500 * (P.illoScale || 1));
    const hwob = moIllo.w * Math.sin(lt * Math.PI * (moIllo.fspd || 1));
    const hero = (i, op) => h('div', {
      key: 'h' + i,
      style: { position: 'absolute', inset: 0, opacity: op, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 180, transform: `translate(${(P.illoX + P.listX) / 2}px,${(P.illoY + P.listY + P.titleY) / 2}px)` },
    },
    h('img', { src: act[i].img, alt: '', style: { width: hs, height: hs, objectFit: 'contain', transform: `translateY(${hwob}px)` } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 70, maxWidth: 2400 } },
      h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: 360, lineHeight: 0.95, letterSpacing: '0.01em', textTransform: 'uppercase', color: INK } }, act[i].name),
      h('div', { style: { fontFamily: FUI, fontWeight: 300, fontSize: 300, lineHeight: 1, color: RUBY } }, act[i].price,
        h('span', { style: { fontSize: '0.46em', fontWeight: 400, verticalAlign: '0.72em', marginLeft: 10 } }, '€'))));
    if (n) { if (idx !== fromI) kids.push(hero(fromI, 1 - cross)); kids.push(hero(idx, cross)); }
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // titre + filet (toutes les mises en page « liste »)
  kids.push(h('div', {
    key: 'ti',
    style: { position: 'absolute', left: 0, top: 210 + P.titleY, width: W, textAlign: 'center', fontFamily: FVANK, fontWeight: 400, fontSize: 440, lineHeight: 1, letterSpacing: `${0.02 + 0.02 * osc}em`, textTransform: 'uppercase', color: INK, transform: `scale(${tPulse})`, transformOrigin: 'top center' },
  }, (m.name || '').toUpperCase()));
  const ruleW = 1500 + 140 * osc;
  kids.push(h('div', { key: 'ru', style: { position: 'absolute', left: (W - ruleW) / 2, top: 640, width: ruleW, height: 16, background: RUBY, borderRadius: 8, opacity: 0.9 } }));

  if (cfg.mode === 'twocol') {
    const perCol = Math.ceil(n / 2);
    const avail = H - cfg.rowTop - 200;
    const rowH = perCol > 1 ? Math.min(352, avail / (perCol - 1)) : 0;
    const colGap = 330;
    const totalW = BAND_W * 2 + colGap;
    const leftX = (W - totalW) / 2 + P.listX;
    const rightX = leftX + BAND_W + colGap;
    const lineYc = (r) => cfg.rowTop + r * rowH;
    const raw = lt / secPerLine;
    const idx = n ? ((Math.floor(raw) % n) + n) % n : 0;
    const tin = raw - Math.floor(raw);
    const slideT = moList.slide ? easeIO(clx(tin / 0.34, 0, 1)) : 1;
    const colOf = (i) => (i < perCol ? 0 : 1);
    const rowOf = (i) => (i < perCol ? i : i - perCol);
    const fromI = (idx - 1 + n) % n;
    if (n) {
      const bx = colOf(idx) ? rightX : leftX;
      const by = (idx === 0 && Math.floor(raw) === 0) ? lineYc(0)
        : (colOf(idx) === colOf(fromI) ? mix(lineYc(rowOf(fromI)), lineYc(rowOf(idx)), slideT) : lineYc(rowOf(idx)));
      kids.push(h('div', { key: 'ba', style: { position: 'absolute', left: bx, top: by - BAND_H / 2, width: BAND_W, height: BAND_H, background: RUBY, borderRadius: 18, zIndex: 1, boxShadow: '0 30px 70px rgba(141,29,44,0.28)' } }));
    }
    act.forEach((t, i) => {
      let wht = 0;
      if (i === idx) wht = slideT;
      else if (i === fromI && idx !== 0 && colOf(i) === colOf(idx)) wht = 1 - slideT;
      const x = colOf(i) ? rightX : leftX;
      kids.push(h('div', { key: 'r' + i, style: { position: 'absolute', left: x, top: lineYc(rowOf(i)) - BAND_H / 2, width: BAND_W, height: BAND_H, display: 'flex', alignItems: 'center', gap: GAP, padding: `0 ${PAD_L}px`, boxSizing: 'border-box', zIndex: 2 } },
        h('span', { style: { width: NAME_W, flexShrink: 0, fontFamily: FVANK, fontWeight: 400, fontSize: 110, letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1, color: mixHex(INK, '#FFFFFF', wht), whiteSpace: 'nowrap', overflow: 'hidden' } }, t.name),
        h('span', { style: { width: PRICE_W, flexShrink: 0, textAlign: 'right', fontFamily: FUI, fontWeight: 300, fontSize: 110, letterSpacing: '-0.012em', lineHeight: 1, color: mixHex(RUBY, '#FFFFFF', wht) } }, t.price,
          h('span', { style: { fontSize: '0.46em', fontWeight: 400, verticalAlign: '0.72em', marginLeft: 8 } }, '€'))));
    });
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // variantes liste à une colonne
  const avail = H - cfg.rowTop - 200;
  const rowH = n > 1 ? Math.min(352, avail / (n - 1)) : 0;
  const lineYc = (i) => cfg.rowTop + i * rowH;
  const raw = lt / secPerLine;
  const idx = n ? ((Math.floor(raw) % n) + n) % n : 0;
  const tin = raw - Math.floor(raw);
  const slideT = moList.slide ? easeIO(clx(tin / 0.34, 0, 1)) : 1;
  const cross = moList.slide ? easeIO(clx(tin / 0.40, 0, 1)) : 1;
  const fromI = (idx - 1 + n) % n;
  const bandY = n ? (idx === 0 && Math.floor(raw) === 0 ? lineYc(0) : mix(lineYc(fromI), lineYc(idx), slideT)) : 0;
  const illoCY = cfg.illoCY != null ? cfg.illoCY : (n ? ((lineYc(0) + lineYc(n - 1)) / 2 - (cfg.illoBehind ? 0 : 170)) : H / 2);
  const wobY = moIllo.w * Math.sin(lt * Math.PI * (moIllo.fspd || 1));
  const wobR = moIllo.r * Math.sin(lt * Math.PI * ((moIllo.fspd || 1) * 0.8));
  const drag = opts.interactive;
  const illo = (i, op, z) => h('div', {
    key: 'il' + i + z,
    onMouseDown: drag ? opts.onIlloDown : undefined,
    style: { position: 'absolute', left: cfg.illoCX - cfg.illoSize / 2, top: illoCY - cfg.illoSize / 2, width: cfg.illoSize, height: cfg.illoSize, opacity: op * cfg.illoOp, zIndex: drag ? 9 : z, transform: `translateY(${wobY}px) rotate(${wobR}deg)`, transformOrigin: 'center', cursor: drag ? 'grab' : 'default' },
  },
  h('img', { src: act[i].img, alt: '', draggable: false, style: { width: cfg.illoSize, height: cfg.illoSize, objectFit: 'contain', display: 'block', pointerEvents: 'none' } }));
  if (cfg.illoShown && cfg.illoBehind && n) { if (idx !== fromI) kids.push(illo(fromI, 1 - cross, 0)); kids.push(illo(idx, cross, 0)); }
  if (n) kids.push(h('div', { key: 'ba', onMouseDown: drag ? opts.onListDown : undefined, style: { position: 'absolute', left: cfg.listL, top: bandY - BAND_H / 2, width: BAND_W, height: BAND_H, background: RUBY, borderRadius: 18, zIndex: 1, boxShadow: '0 30px 70px rgba(141,29,44,0.28)', cursor: drag ? 'grab' : 'default' } }));
  act.forEach((t, i) => {
    let wht = 0;
    if (i === idx) wht = slideT;
    else if (i === fromI && idx !== 0) wht = 1 - slideT;
    const pulse = (moList.pulse && i === idx) ? (1 + 0.05 * (0.5 + 0.5 * Math.sin(lt * Math.PI * 4))) : 1;
    kids.push(h('div', { key: 'r' + i, style: { position: 'absolute', left: cfg.listL, top: lineYc(i) - BAND_H / 2, width: BAND_W, height: BAND_H, display: 'flex', alignItems: 'center', gap: GAP, padding: `0 ${PAD_L}px`, boxSizing: 'border-box', zIndex: 2, transform: `scale(${pulse})`, transformOrigin: 'center' } },
      h('span', { style: { width: NAME_W, flexShrink: 0, fontFamily: FVANK, fontWeight: 400, fontSize: 128, letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1, color: mixHex(INK, '#FFFFFF', wht), whiteSpace: 'nowrap', overflow: 'hidden' } }, t.name),
      h('span', { style: { width: PRICE_W, flexShrink: 0, textAlign: 'right', fontFamily: FUI, fontWeight: 300, fontSize: 128, letterSpacing: '-0.012em', lineHeight: 1, color: mixHex(RUBY, '#FFFFFF', wht) } }, t.price,
        h('span', { style: { fontSize: '0.46em', fontWeight: 400, verticalAlign: '0.72em', marginLeft: 8 } }, '€'))));
  });
  if (cfg.illoShown && !cfg.illoBehind && n) { if (idx !== fromI) kids.push(illo(fromI, 1 - cross, 3)); kids.push(illo(idx, cross, 3)); }
  const te = tagEl(); if (te) kids.push(te);
  return kids;
}

// Un module est-il programmé pour être diffusé maintenant ? (jours + fenêtre horaire)
export function scheduledNow(m, date = new Date()) {
  const s = m.schedule;
  if (!s) return true;
  const dow = (date.getDay() + 6) % 7; // 0 = lundi
  if (s.days && s.days.length === 7 && !s.days[dow]) return false;
  const hm = date.getHours() * 60 + date.getMinutes();
  const parse = (t, fb) => {
    const mm = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return mm ? (+mm[1]) * 60 + (+mm[2]) : fb;
  };
  const from = parse(s.from, 0);
  const to = parse(s.to, 24 * 60 - 1);
  return hm >= from && hm <= to;
}
