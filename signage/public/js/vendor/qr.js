// Générateur de QR code autonome (zéro dépendance) — QR Model 2, mode octet
// (UTF-8), niveau de correction M, sélection de version + masque automatiques.
// Rendu SVG. Portage fidèle de l'algorithme de référence (domaine public,
// d'après « QR Code generator » de Nayuki). Versions 1 à 20 suffisent
// largement pour une URL d'écran.
//
// API : qrSvg(text, { scale=8, margin=4, dark='#000', light='#fff' }) -> string SVG.

// --- Galois field GF(256) pour Reed-Solomon --------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(deg) {
  // Produit ∏(x - α^i), stocké coefficient de plus haut degré en tête (monique).
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                       // × x (le terme dominant reste 1)
      next[j + 1] ^= gfMul(poly[j], EXP[i]);     // × α^i (décalé d'un degré)
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen); // ecLen+1 coeffs, gen[0] = terme dominant (1)
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift(); res.push(0);
    // division polynomiale : on XOR le générateur SANS son terme dominant.
    for (let j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
  }
  return res;
}

// --- Tables (niveau M) : [ec codewords/bloc, nb blocs groupe1, data/bloc g1,
//     nb blocs groupe2, data/bloc g2] par version (1..20) -------------------
const ECC_M = {
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44], 11: [30, 1, 50, 4, 51], 12: [22, 6, 36, 2, 37],
  13: [22, 8, 37, 1, 38], 14: [24, 4, 40, 5, 41], 15: [24, 5, 41, 5, 42], 16: [28, 7, 45, 3, 46],
  17: [28, 10, 46, 1, 47], 18: [26, 9, 43, 4, 44], 19: [26, 3, 44, 11, 45], 20: [26, 3, 41, 13, 42],
};
const ALIGN_POS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
  8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58],
  13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
};

function dataCapacity(ver) { const [ec, b1, d1, b2, d2] = ECC_M[ver]; return b1 * d1 + b2 * d2; }

// --- Encodage des données (mode octet UTF-8) -------------------------------
function encodeData(bytes, ver) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                                  // indicateur mode octet
  push(bytes.length, ver < 10 ? 8 : 16);            // compteur de caractères
  for (const b of bytes) push(b, 8);
  const cap = dataCapacity(ver) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminateur
  while (bits.length % 8 !== 0) bits.push(0);
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bits.length < cap) { push(pad[pi++ % 2], 8); }
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; cw.push(v); }
  return cw;
}

// Entrelacement des blocs data + ecc
function interleave(cw, ver) {
  const [ecLen, b1, d1, b2, d2] = ECC_M[ver];
  const blocks = []; let pos = 0;
  for (let i = 0; i < b1; i++) { const d = cw.slice(pos, pos + d1); pos += d1; blocks.push({ d, ec: rsEncode(d, ecLen) }); }
  for (let i = 0; i < b2; i++) { const d = cw.slice(pos, pos + d2); pos += d2; blocks.push({ d, ec: rsEncode(d, ecLen) }); }
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// --- Matrice ---------------------------------------------------------------
function buildMatrix(ver, finalCw) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null)); // null = libre
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const res = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true; };

  const finder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(rr, cc, dark ? 1 : 0); res(rr, cc);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // timing
  for (let i = 8; i < size - 8; i++) { const v = i % 2 === 0 ? 1 : 0; if (m[6][i] === null) { set(6, i, v); res(6, i); } if (m[i][6] === null) { set(i, 6, v); res(i, 6); } }

  // alignement
  const aps = ALIGN_POS[ver];
  for (const ar of aps) for (const ac of aps) {
    if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      set(ar + dr, ac + dc, dark ? 1 : 0); res(ar + dr, ac + dc);
    }
  }

  // zones réservées format (autour des finders) + version
  for (let i = 0; i < 9; i++) { res(8, i); res(i, 8); }
  for (let i = 0; i < 8; i++) { res(8, size - 1 - i); res(size - 1 - i, 8); }
  set(size - 8, 8, 1); res(size - 8, 8); // module noir fixe
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { res(i, size - 11 + j); res(size - 11 + j, i); }

  // Placement des données (en zigzag depuis le bas-droite)
  let bitIdx = 0;
  const totalBits = finalCw.length * 8;
  const bitAt = (i) => (i < totalBits ? (finalCw[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // saute la colonne de timing
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[row][cc] === null && !reserved[row][cc]) { set(row, cc, bitAt(bitIdx)); bitIdx++; }
      }
    }
    upward = !upward;
  }

  return { m, size, reserved };
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(base, reserved, size, maskFn) {
  const m = base.map((row) => row.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved[r][c] && maskFn(r, c)) m[r][c] ^= 1;
  return m;
}

// Format info (niveau M = 0b00) + masque, BCH(15,5)
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
  const bits = ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  return bits & 0x7fff;
}
function placeFormat(m, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => (bits >> (14 - i)) & 1; // séquence placée MSB d'abord (spec)
  for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
  m[8][7] = bit(6); m[8][8] = bit(7); m[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i);
  // Seconde copie : bits 0..6 en bas (vertical), bits 7..14 à droite (horizontal).
  // Le module (size-8, 8) reste le module noir fixe — on ne le touche pas.
  for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) m[8][size - 15 + i] = bit(i);
}
function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) & 1 ? 0x1f25 : 0);
  return (ver << 12) | (rem & 0xfff);
}
function placeVersion(m, size, ver) {
  if (ver < 7) return;
  const bits = versionBits(ver);
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    m[r][size - 11 + c] = b; m[size - 11 + c][r] = b;
  }
}

function penalty(m, size) {
  let score = 0;
  // règle 1 : suites de 5+ mêmes modules
  for (let r = 0; r < size; r++) for (let d = 0; d < 2; d++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      const a = d ? m[c][r] : m[r][c]; const b = d ? m[c - 1][r] : m[r][c - 1];
      if (a === b) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
    }
  }
  // règle 2 : blocs 2x2
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  // règle 3 : motif 1:1:3:1:1
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) for (let c = 0; c < size - 10; c++) {
    let m1 = true, m2 = true;
    for (let k = 0; k < 11; k++) { if (m[r][c + k] !== pat1[k]) m1 = false; if (m[r][c + k] !== pat2[k]) m2 = false; }
    if (m1 || m2) score += 40;
  }
  for (let c = 0; c < size; c++) for (let r = 0; r < size - 10; r++) {
    let m1 = true, m2 = true;
    for (let k = 0; k < 11; k++) { if (m[r + k][c] !== pat1[k]) m1 = false; if (m[r + k][c] !== pat2[k]) m2 = false; }
    if (m1 || m2) score += 40;
  }
  // règle 4 : proportion de noir
  let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

function utf8Bytes(str) {
  const out = [];
  for (const ch of str) {
    let cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) { out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)); }
    else if (cp < 0x10000) { out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
    else { out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
  }
  return out;
}

export function qrMatrix(text, forceMask) {
  const bytes = utf8Bytes(String(text));
  let ver = 1;
  const need = (v) => bytes.length + (v < 10 ? 2 : 3); // octets data mini (mode+count arrondis)
  while (ver <= 20 && dataCapacity(ver) < need(ver)) ver++;
  if (ver > 20) throw new Error('texte trop long pour le QR');
  const cw = encodeData(bytes, ver);
  const finalCw = interleave(cw, ver);
  const { m, size, reserved } = buildMatrix(ver, finalCw);
  // choix du meilleur masque
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask != null && mask !== forceMask) continue;
    const masked = applyMask(m, reserved, size, MASKS[mask]);
    placeFormat(masked, size, mask); placeVersion(masked, size, ver);
    const sc = penalty(masked, size);
    if (sc < bestScore) { bestScore = sc; best = masked; }
  }
  return best;
}

export function qrSvg(text, opts = {}) {
  const scale = opts.scale || 8, margin = opts.margin == null ? 4 : opts.margin;
  const dark = opts.dark || '#232220', light = opts.light || '#ffffff';
  const m = qrMatrix(text);
  const size = m.length;
  const dim = (size + margin * 2) * scale;
  let path = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) path += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
