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
  if (m.type === 'promotion') return m.dur > 0 ? m.dur : 7;
  if (m.type === 'campagne') return m.dur > 0 ? m.dur : 8;
  if (m.type === 'html') return m.dur > 0 ? m.dur : 10;
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
// Filtre « filigrane / logo » optionnel, superposé à l'élément (surtout utile
// sur les photos). m.watermark : 'filigrane' | 'logo' | 'nouveau'.
export function watermarkEl(h, m) {
  const w = m && m.watermark;
  if (!w || w === 'none') return null;
  if (w === 'logo') {
    return h('div', { key: 'wm', style: { position: 'absolute', right: 120, bottom: 110, zIndex: 7, background: 'rgba(255,255,255,0.82)', borderRadius: 28, padding: '26px 40px', boxShadow: '0 16px 44px rgba(35,34,32,0.22)' } },
      h('img', { src: 'assets/logo.png', alt: '', style: { height: 150, width: 'auto', display: 'block' } }));
  }
  if (w === 'nouveau') {
    return h('div', { key: 'wm', style: { position: 'absolute', top: 300, left: -260, width: 1200, zIndex: 7, transform: 'rotate(-35deg)', background: RUBY, color: '#fff', textAlign: 'center', padding: '40px 0', boxShadow: '0 20px 50px rgba(141,29,44,0.4)', fontFamily: FVANK, fontSize: 150, letterSpacing: '0.06em', textTransform: 'uppercase' } }, 'Nouveau');
  }
  // filigrane : grand logo très discret, centré derrière/devant.
  return h('div', { key: 'wm', style: { position: 'absolute', inset: 0, zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' } },
    h('img', { src: 'assets/logo.png', alt: '', style: { width: '58%', height: 'auto', opacity: 0.1 } }));
}

// ---------------------------------------------------------------------------
// Gabarit HTML — le code collé en régie peut être un document complet
// (<!DOCTYPE>, <head><style>…</style></head>, <body>…</body>) ou un simple
// fragment. On en extrait les feuilles de style et le contenu du corps.
export function splitHtmlDoc(src) {
  let s = String(src || '');
  // Feuilles de style : collectées puis retirées du corps.
  const css = [];
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m0, inner) => { css.push(inner); return ''; });
  // Corps : <body>…</body> s'il existe, sinon on retire l'enveloppe du document.
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(s);
  let out = body ? body[1] : s
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|body)\b[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  return { css: css.join('\n'), body: out.trim() };
}
// Hygiène du code collé : le gabarit vient de la régie (admin), mais on retire
// tout ce qui pourrait s'exécuter — scripts, gestionnaires on*, URL javascript:.
export function sanitizeHtml(src) {
  return String(src || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

export function renderModule(h, m, lt, opts) {
  const kids = renderModuleInner(h, m, lt, opts);
  if (Array.isArray(kids) && m && m.watermark && m.watermark !== 'none') {
    const wm = watermarkEl(h, m);
    if (wm) kids.push(wm);
  }
  return kids;
}

function renderModuleInner(h, m, lt, opts) {
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

  // ---- Média ciblé : vidéo/photo agence tirée au sort (moment + saison) -----
  if (m.type === 'media') {
    if (m.mediaKind === 'film' && m.video) {
      kids.push(h('div', { key: 'mbg', style: { position: 'absolute', inset: 0, background: '#000' } }));
      kids.push(h('video', { key: 'mvid' + m.id, src: m.video, autoplay: true, muted: true, loop: true, playsinline: true,
        style: { position: 'absolute', inset: 0, width: W, height: H, objectFit: m.layout === 'contain' ? 'contain' : 'cover' } }));
    } else if (m.mediaKind === 'photo' && m.mediaUrl) {
      kids.push(h('div', { key: 'mbg', style: { position: 'absolute', inset: 0, background: m.layout === 'contain' ? '#F5EFE4' : '#000' } }));
      kids.push(h('img', { key: 'mimg', src: m.mediaUrl, alt: '',
        style: { position: 'absolute', inset: 0, width: W, height: H, objectFit: m.layout === 'contain' ? 'contain' : 'cover' } }));
    } else {
      const n = m.mediaCount == null ? (m.mediaTotal || 0) : m.mediaCount;
      kids.push(h('div', { key: 'mnone', style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 60, alignItems: 'center', justifyContent: 'center', background: '#1B1B1B', color: '#fff' } },
        h('div', { style: { fontSize: 300 } }, '🎯'),
        h('div', { style: { fontFamily: FUI, fontSize: 92, letterSpacing: '0.1em', textTransform: 'uppercase' } }, 'Média ciblé'),
        h('div', { style: { fontFamily: FUI, fontSize: 70, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em', textAlign: 'center', padding: '0 200px' } }, `${n} média(s) agence éligible(s) · moment + saison`)));
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

  // ---- Promotion : offre commerciale (badge du sous-type + accroche) --------
  // Le sous-type (happy hour, flash, bundle…) vient de la base (sig_promo_types)
  // et est résolu en amont dans m.promo { name, icon, color }. Sur les mises en
  // page « hero », la photo du produit lié (productRef) accompagne l'offre.
  if (m.type === 'promotion') {
    const dur = moduleDur(m, secPerLine);
    const pt = m.promo || { name: 'Offre', icon: '🏷️', color: '#C0392B' };
    const col = pt.color || '#C0392B';
    const a = Math.min(easeIO(clx(lt / 0.5, 0, 1)), easeIO(clx((dur - lt) / 0.5, 0, 1)));
    const it = activeItems(m)[0] || (m.items || [])[0];
    const hero = (m.layout === 'hero-right' || m.layout === 'hero-left') && it;
    const band = m.layout === 'band';
    // Puce du sous-type : icône + libellé, aux couleurs de la promo.
    const badge = (dark) => h('div', {
      key: 'pbadge',
      style: { display: 'inline-flex', alignItems: 'center', gap: 34, alignSelf: hero ? 'flex-start' : 'center',
        background: dark ? 'rgba(255,255,255,0.16)' : col, color: '#fff', borderRadius: 999, padding: '30px 62px 30px 48px',
        fontFamily: FUI, fontWeight: 500, fontSize: 92, letterSpacing: '0.12em', textTransform: 'uppercase',
        boxShadow: dark ? 'none' : '0 20px 50px rgba(35,34,32,0.22)' },
    }, h('span', { style: { fontSize: 110, lineHeight: 1 } }, pt.icon || '🏷️'), h('span', null, pt.name || 'Offre'));
    // Bloc « offre » : accroche (m.name) + détail (m.sub), + prix si produit lié.
    const offer = (onLight) => h('div', {
      key: 'poffer',
      style: { display: 'flex', flexDirection: 'column', gap: 60, alignItems: hero ? 'flex-start' : 'center', textAlign: hero ? 'left' : 'center', maxWidth: hero ? 2700 : 5200 },
    },
    badge(!onLight),
    h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: hero ? 300 : 360, letterSpacing: '0.01em', textTransform: 'uppercase', color: onLight ? INK : '#fff', lineHeight: 0.95 } }, (m.name || 'Offre spéciale').toUpperCase()),
    h('div', { style: { width: 560, height: 16, background: col, borderRadius: 8 } }),
    m.sub ? h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: hero ? 96 : 108, letterSpacing: '0.06em', color: onLight ? '#6E675E' : 'rgba(255,255,255,0.86)', lineHeight: 1.15 } }, m.sub) : null,
    it && it.price ? h('div', { style: { fontFamily: FUI, fontWeight: 300, fontSize: 220, color: onLight ? col : '#fff' } }, it.price, h('span', { style: { fontSize: 110, verticalAlign: 'super' } }, '€')) : null);

    if (hero) {
      const left = m.layout === 'hero-left';
      const P0 = m.pos || newPos();
      const mo = MO[m.motion || 'm1'] || MO.m1;
      const wob = mo.w * Math.sin(lt * Math.PI * (mo.fspd || 1));
      const imgCX = left ? 1620 : W - 1620;
      const txtX = left ? 3400 : 260;
      const imgSize = Math.round(2500 * (P0.illoScale || 1));
      kids.push(h('div', { key: 'pbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4', opacity: a } }));
      kids.push(h('div', { key: 'pimgw', style: { position: 'absolute', left: imgCX - imgSize / 2 + P0.illoX, top: H / 2 - imgSize / 2 + P0.illoY, width: imgSize, height: imgSize, opacity: a, transform: `translateY(${wob}px) rotate(${mo.r * Math.sin(lt * Math.PI * 0.8)}deg)` } },
        h('img', { src: it.img, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain', borderRadius: it.src === 'photo' ? 60 : 0, boxShadow: it.src === 'photo' ? '0 60px 160px rgba(35,34,32,0.35)' : 'none' } })));
      kids.push(h('div', { key: 'ptxt', style: { position: 'absolute', left: txtX + P0.listX, top: H / 2 - 700 + P0.titleY, width: 2820, opacity: a } }, offer(true)));
    } else {
      const zoom = 1 + 0.04 * (lt / dur);
      if (!band) kids.push(h('div', { key: 'pbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4' } }));
      else kids.push(h('div', { key: 'pbg', style: { position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${col}, ${mixHex(col, '#000000', 0.28)})` } }));
      kids.push(h('div', { key: 'pwrap', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 260px', opacity: a, transform: `scale(${zoom})`, transformOrigin: 'center' } }, offer(!band)));
    }
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // ---- Gabarit HTML : code collé en régie, mis à l'échelle de l'écran ------
  // La maquette a sa taille source (m.htmlW × m.htmlH — ex. 1920×1080 pour du
  // 16:9, 1080×1920 pour du 9:16, 840×1189 pour une affiche A1). On la met à
  // l'échelle du canevas : adapter (tout visible), remplir (recadre) ou étirer.
  if (m.type === 'html') {
    const raw = m.html || '';
    if (!raw.trim()) {
      kids.push(h('div', { key: 'hnone', style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 60, alignItems: 'center', justifyContent: 'center', background: '#F5EFE4' } },
        h('div', { style: { fontSize: 260, color: '#C9C3B8', fontFamily: FUI } }, '⟨⟩'),
        h('div', { style: { fontFamily: FUI, fontSize: 90, color: '#8A847C', letterSpacing: '0.14em', textTransform: 'uppercase' } }, 'colle ton code HTML dans la régie')));
      return kids;
    }
    // Une variable d'image encore non liée ({{ logo }} dans un src) donnerait
    // une image cassée et une requête inutile : on la neutralise à l'affichage.
    const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const { css, body } = splitHtmlDoc(
      sanitizeHtml(raw).replace(/\b(src|srcset)\s*=\s*("|')\s*\{\{[^{}]*\}\}\s*\2/gi, `src="${BLANK}"`)
    );
    const dw = Math.max(64, m.htmlW || 1920);
    const dh = Math.max(64, m.htmlH || 1080);
    const mode = m.layout || 'fit';
    const sx = W / dw, sy = H / dh;
    const s = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const tf = mode === 'stretch' ? `scale(${sx}, ${sy})` : `scale(${s})`;
    kids.push(h('div', { key: 'hbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4', overflow: 'hidden' } }));
    if (css) kids.push(h('style', { key: 'hcss', dangerouslySetInnerHTML: { __html: css } }));
    kids.push(h('div', {
      key: 'hwrap',
      style: {
        position: 'absolute', left: '50%', top: '50%', width: dw, height: dh,
        marginLeft: -dw / 2, marginTop: -dh / 2, transform: tf, transformOrigin: 'center',
        overflow: 'hidden',
      },
      dangerouslySetInnerHTML: { __html: body },
    }));
    const te = tagEl(); if (te) kids.push(te);
    return kids;
  }

  // ---- Campagne marketing : contenu porté par la campagne choisie ----------
  // c = m.campaign { name, scope, productRef, theme, image, message, dateFrom,
  // dateTo, color }. Portée « produit » → photo/prix du produit lié (items[0]) ;
  // « gamme » → libellé du thème. Un visuel (image) prime sur la photo produit.
  if (m.type === 'campagne') {
    const dur = moduleDur(m, secPerLine);
    const c = m.campaign || { name: m.name || 'Campagne', scope: 'produit', theme: '', image: '', message: '', dateFrom: '', dateTo: '', color: '#8D1D2C' };
    const col = c.color || '#8D1D2C';
    const a = Math.min(easeIO(clx(lt / 0.5, 0, 1)), easeIO(clx((dur - lt) / 0.5, 0, 1)));
    const it = activeItems(m)[0] || (m.items || [])[0];
    const img = c.image || '';                 // visuel de campagne (URL)
    const visual = img || (it ? it.img : '');   // à défaut, la photo du produit lié
    const dateLabel = c.dateFrom && c.dateTo ? `Du ${c.dateFrom} au ${c.dateTo}` : (c.dateFrom || '');
    const scopeLabel = c.scope === 'gamme' ? (c.theme || 'Gamme') : (it ? it.name : (c.theme || ''));
    const cover = m.layout === 'cover';
    const hero = (m.layout === 'hero-right' || m.layout === 'hero-left');
    // Puce « portée » : gamme (thème) ou produit.
    const chip = (dark) => h('div', { key: 'cchip', style: { display: 'inline-flex', alignItems: 'center', gap: 24, alignSelf: (cover || hero) ? 'flex-start' : 'center', background: dark ? 'rgba(255,255,255,0.18)' : col, color: '#fff', borderRadius: 999, padding: '26px 52px', fontFamily: FUI, fontWeight: 500, fontSize: 78, letterSpacing: '0.12em', textTransform: 'uppercase' } },
      h('span', { style: { fontSize: 88, lineHeight: 1 } }, c.scope === 'gamme' ? '🗂' : '📣'),
      h('span', null, scopeLabel || 'Campagne'));
    // Bloc texte : nom + message + portée + dates.
    const textBlock = (onDark) => h('div', { key: 'ctxt', style: { display: 'flex', flexDirection: 'column', gap: 54, alignItems: (cover || hero) ? 'flex-start' : 'center', textAlign: (cover || hero) ? 'left' : 'center', maxWidth: hero ? 2820 : (cover ? 4200 : 5200) } },
      scopeLabel ? chip(onDark) : null,
      h('div', { style: { fontFamily: FVANK, fontWeight: 400, fontSize: hero ? 300 : 360, letterSpacing: '0.01em', textTransform: 'uppercase', color: onDark ? '#fff' : INK, lineHeight: 0.95 } }, (c.name || 'Campagne').toUpperCase()),
      h('div', { style: { width: 560, height: 16, background: onDark ? '#fff' : col, borderRadius: 8, opacity: onDark ? 0.9 : 1 } }),
      c.message ? h('div', { style: { fontFamily: FUI, fontWeight: 400, fontSize: hero ? 92 : 104, letterSpacing: '0.05em', color: onDark ? 'rgba(255,255,255,0.88)' : '#6E675E', lineHeight: 1.15 } }, c.message) : null,
      it && it.price ? h('div', { style: { fontFamily: FUI, fontWeight: 300, fontSize: 210, color: onDark ? '#fff' : col } }, it.price, h('span', { style: { fontSize: 104, verticalAlign: 'super' } }, '€')) : null,
      dateLabel ? h('div', { style: { fontFamily: FUI, fontWeight: 600, fontSize: 62, letterSpacing: '0.1em', textTransform: 'uppercase', color: onDark ? 'rgba(255,255,255,0.7)' : '#8A847C' } }, dateLabel) : null);

    if (cover) {
      // Visuel plein écran + dégradé + texte en bas à gauche (sur fond sombre).
      if (visual) {
        kids.push(h('div', { key: 'cbg', style: { position: 'absolute', inset: 0, background: '#1a1207' } }));
        kids.push(h('img', { key: 'cimg', src: visual, alt: '', style: { position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover', opacity: a, transform: `scale(${1 + 0.04 * (lt / dur)})`, transformOrigin: 'center' } }));
        kids.push(h('div', { key: 'cshade', style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1900, background: `linear-gradient(transparent, rgba(20,12,7,0.82))` } }));
      } else {
        kids.push(h('div', { key: 'cbg', style: { position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${col}, ${mixHex(col, '#000000', 0.3)})` } }));
      }
      kids.push(h('div', { key: 'cwrap', style: { position: 'absolute', left: 260, right: 260, bottom: 260, opacity: a } }, textBlock(true)));
    } else if (hero) {
      const left = m.layout === 'hero-left';
      const P0 = m.pos || newPos();
      const mo = MO[m.motion || 'm1'] || MO.m1;
      const wob = mo.w * Math.sin(lt * Math.PI * (mo.fspd || 1));
      const imgCX = left ? 1620 : W - 1620;
      const txtX = left ? 3400 : 260;
      const imgSize = Math.round(2500 * (P0.illoScale || 1));
      kids.push(h('div', { key: 'cbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4', opacity: a } }));
      if (visual) {
        const isPhoto = !img && it && it.src === 'photo';
        kids.push(h('div', { key: 'cimgw', style: { position: 'absolute', left: imgCX - imgSize / 2 + P0.illoX, top: H / 2 - imgSize / 2 + P0.illoY, width: imgSize, height: imgSize, opacity: a, transform: `translateY(${wob}px)` } },
          h('img', { src: visual, alt: '', style: { width: '100%', height: '100%', objectFit: (img || isPhoto) ? 'cover' : 'contain', borderRadius: (img || isPhoto) ? 60 : 0, boxShadow: (img || isPhoto) ? '0 60px 160px rgba(35,34,32,0.35)' : 'none' } })));
      }
      kids.push(h('div', { key: 'ctxtw', style: { position: 'absolute', left: txtX + P0.listX, top: H / 2 - 760 + P0.titleY, width: 2860, opacity: a } }, textBlock(false)));
    } else {
      // Centré : fond crème, texte centré.
      const zoom = 1 + 0.035 * (lt / dur);
      kids.push(h('div', { key: 'cbg', style: { position: 'absolute', inset: 0, background: '#F5EFE4' } }));
      kids.push(h('div', { key: 'cwrap', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 300px', opacity: a, transform: `scale(${zoom})`, transformOrigin: 'center' } }, textBlock(false)));
    }
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
