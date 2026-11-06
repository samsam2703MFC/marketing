import type { PointerEvent, ReactNode } from 'react'

/**
 * Les graphiques de la Grille Instagram (repris de social/public/graphes.js) : une série par graphique, sur
 * un seul axe ; des bandes régulières (un jour), le point au milieu de sa bande ; au survol, un repère
 * commun aux graphiques du même axe et l'infobulle du graphique survolé. Courbe et aire en SVG
 * (viewBox 0 0 1000 100), barres en blocs ; marges : 44 px à gauche, 10 px à droite, 12 px en haut,
 * 24 px en bas pour les dates.
 */

// Chaque compte garde sa couleur (Instagram) ; gagnés / perdus : paire lisible par tous (daltonisme vérifié).
export const C = { fb: '#1877F2', ig: '#C13584', mark: '#232220', up: '#1F8A60', down: '#D97B29' }
export const fmtG = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d })
const axe = (v: number) => (Math.abs(v) >= 10000 ? `${fmtG(v / 1000, Math.abs(v) >= 100000 ? 0 : 1)} k` : fmtG(v))
export const signe = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${fmtG(v)}` : v < 0 ? `−${fmtG(-v)}` : '0')
const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
export const court = (d: string) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${+m[3]} ${MO[+m[2] - 1]}` : ''
}

/** Graduations « rondes » (1, 2, 5 × 10ⁿ, pas entier) couvrant [lo, hi]. */
function nice(lo: number, hi: number, k = 4) {
  if (!(hi > lo)) hi = lo + 1
  const raw = (hi - lo) / k
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  const step = Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p)
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  const t: number[] = []
  for (let v = a; v <= b + step / 2; v += step) t.push(Math.round(v) || 0)
  return { lo: a, hi: b, ticks: t }
}

export interface Legende {
  c: string
  n: string
  w: string
  h: string
  r: string
  ring: string
}
export const lg = {
  ligne: (c: string, n: string): Legende => ({ c, n, w: '14px', h: '2px', r: '1px', ring: 'none' }),
  point: (n: string): Legende => ({ c: C.mark, n, w: '8px', h: '8px', r: '50%', ring: '0 0 0 2px #FFFFFF, 0 0 0 2.5px rgba(34,34,34,0.25)' }),
  barre: (c: string, n: string): Legende => ({ c, n, w: '10px', h: '10px', r: '3px', ring: 'none' }),
}

/**
 * Les jours qu'un compte n'a pas encore (ou pas entièrement) comptés chez Meta : anormalement bas (moins de
 * 10 % du jour médian), souvent les 2 ou 3 derniers jours. Laissés en blanc et hors des moyennes, signalés.
 */
export function incomplets(vals: (number | null)[]): boolean[] {
  const ok = vals.filter((v): v is number => v != null).sort((a, b) => a - b)
  const med = ok.length ? ok[Math.floor(ok.length / 2)] : 0
  return vals.map((v) => v != null && med >= 100 && v < med * 0.1)
}
/** La phrase qui signale ces jours (`jours` : les dates AAAA-MM-JJ des bandes). */
export function plages(bad: boolean[], jours: string[]): string {
  const out: string[] = []
  let a = -1
  bad.concat([false]).forEach((x, i) => {
    if (x && a < 0) a = i
    if (!x && a >= 0) {
      const m1 = jours[a].slice(5, 7)
      const m2 = jours[i - 1].slice(5, 7)
      out.push(a === i - 1 ? court(jours[a]) : m1 === m2 ? `${+jours[a].slice(8, 10)}–${court(jours[i - 1])}` : `${court(jours[a])} – ${court(jours[i - 1])}`)
      a = -1
    }
  })
  return out.length
    ? `Chiffres incomplets chez Meta (anormalement bas), laissés en blanc et hors des moyennes : ${out.join(', ').replace(/\.?$/, '.')}${
        bad.slice(-4).some(Boolean) ? ' Meta compte souvent les derniers jours avec quelques jours de retard.' : ''
      }`
    : ''
}

export interface Survol {
  k: string
  i: number
}
interface Axe {
  n: number
  titre: (i: number) => string
  court: (i: number) => string
  etiquettes?: number
  hov: Survol | null
  setHov: (h: Survol | null) => void
}

const PT = 12
const PB = 24
const xAt = (f: number) => `calc(44px + (100% - 54px) * ${f.toFixed(4)})`

function Carte({ title, sub, legend, note, children }: { title: string; sub?: string; legend: Legende[]; note?: string; children?: ReactNode }) {
  return (
    <div className="card grille__graphe">
      <div className="grille__graphe-tete">
        <span className="grille__graphe-nom">
          <span>{title}</span>
          {sub ? <span className="muted">{sub}</span> : null}
        </span>
        <span className="grille__legende">
          {legend.map((l) => (
            <span key={l.n}>
              <span style={{ width: l.w, height: l.h, borderRadius: l.r, background: l.c, boxShadow: l.ring }} />
              {l.n}
            </span>
          ))}
        </span>
      </div>
      {children}
      {note ? <span className="grille__note">{note}</span> : null}
    </div>
  )
}

function axeDe(ax: Axe, k: string, lignes: (i: number) => string[]) {
  const n = Math.max(1, ax.n)
  const hov = ax.hov && ax.hov.i < n ? ax.hov : null
  const fOf = (i: number) => (i + 0.5) / n
  const dates = () => {
    const kk = Math.min(n, ax.etiquettes ?? 5)
    const out: { left: string; label: string }[] = []
    for (let j = 0; j < kk; j++) {
      const i = kk === 1 ? 0 : Math.round((j * (n - 1)) / (kk - 1))
      out.push({ left: xAt(fOf(i)), label: ax.court(i) })
    }
    return out
  }
  const idx = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - b.left) / Math.max(1, b.width)) * n)))
  }
  const zone = (
    <div
      className="grille__zone"
      onPointerMove={(e) => {
        const i = idx(e)
        if (!ax.hov || ax.hov.i !== i || ax.hov.k !== k) ax.setHov({ k, i })
      }}
      onPointerLeave={() => {
        if (ax.hov) ax.setHov(null)
      }}
    />
  )
  const bulle =
    hov && hov.k === k ? (
      <div className="grille__bulle" style={{ left: xAt(fOf(hov.i)), transform: fOf(hov.i) > 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
        <div>{ax.titre(hov.i)}</div>
        {lignes(hov.i).map((t, j) => (
          <div key={j} className="grille__bulle-ligne">
            {t}
          </div>
        ))}
      </div>
    ) : null
  return { n, hov, fOf, dates, zone, bulle }
}

/** Une courbe (une série) : `vals` un nombre ou null par bande ; `marque(i)` : un point noir sur la bande (jour de publication). */
export function Courbe(
  props: Axe & {
    k: string
    title: string
    sub?: string
    serie: string
    note?: string
    vide: string
    zero?: boolean
    H?: number
    vals: (number | null)[]
    color: string
    marque?: (i: number) => boolean
    lignes: (i: number) => string[]
  },
) {
  const { k, title, sub, serie, note, vide, vals, color, marque, lignes } = props
  const { hov, fOf, dates, zone, bulle } = axeDe(props, k, lignes)
  const ok = vals.filter((v): v is number => v != null)
  if (!ok.length) return <Carte title={title} sub={sub} legend={[]} note={vide} />
  const zero = props.zero !== false
  const H = props.H ?? 200
  const PH = H - PT - PB
  const sc = zero ? nice(0, Math.max(...ok)) : nice(Math.min(...ok), Math.max(...ok))
  const y = (v: number) => 1 - (v - sc.lo) / (sc.hi - sc.lo)
  let line = ''
  let area = ''
  let seg: [string, string][] = []
  const fin = () => {
    if (!seg.length) return
    line += `${seg.map((p, j) => `${j ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')} `
    if (zero && seg.length > 1) area += `M${seg[0][0]} 100 ${seg.map((p) => `L${p[0]} ${p[1]}`).join(' ')} L${seg[seg.length - 1][0]} 100 Z `
    seg = []
  }
  vals.forEach((v, i) => {
    if (v == null) fin()
    else seg.push([(fOf(i) * 1000).toFixed(1), (y(v) * 100).toFixed(2)])
  })
  fin()
  const dots: { left: string; top: string; size: string; bg: string }[] = []
  vals.forEach((v, i) => {
    if (v != null && marque && marque(i)) dots.push({ left: xAt(fOf(i)), top: `${(PT + y(v) * PH).toFixed(1)}px`, size: '8px', bg: C.mark })
  })
  const hv = hov ? vals[hov.i] : null
  if (hov && hv != null) dots.push({ left: xAt(fOf(hov.i)), top: `${(PT + y(hv) * PH).toFixed(1)}px`, size: '10px', bg: color })
  const legend = [lg.ligne(color, serie)].concat(marque ? [lg.point('jour avec publication')] : [])
  return (
    <Carte title={title} sub={sub} legend={legend} note={note}>
      <div className="grille__trace" style={{ height: H }}>
        {sc.ticks.map((t) => (
          <Graduation key={t} top={PT + y(t) * PH} label={axe(t)} fort={zero && t === sc.lo} />
        ))}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="grille__svg" style={{ height: PH }}>
          <path d={area} fill={`${color}1A`} stroke="none" />
          <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {hov ? <span className="grille__repere" style={{ height: PH, left: xAt(fOf(hov.i)) }} /> : null}
        {dots.map((d, i) => (
          <span key={i} className="grille__point" style={{ left: d.left, top: d.top, width: d.size, height: d.size, background: d.bg }} />
        ))}
        {dates().map((x, i) => (
          <span key={i} className="grille__date" style={{ left: x.left }}>
            {x.label}
          </span>
        ))}
        {zone}
        {bulle}
      </div>
    </Carte>
  )
}

/** Des barres : `hauts` au-dessus de la ligne de base, `bas` (facultatif) en dessous (gagnés / perdus). */
export function Barres(
  props: Axe & {
    k: string
    title: string
    sub?: string
    note?: string
    vide: string
    legend: Legende[]
    H?: number
    hauts: (number | null)[]
    bas: (number | null)[] | null
    lignes: (i: number) => string[]
  },
) {
  const { k, title, sub, note, vide, legend, hauts, bas, lignes } = props
  const { hov, dates, zone, bulle } = axeDe(props, k, lignes)
  if (!hauts.some((v) => v != null)) return <Carte title={title} sub={sub} legend={[]} note={vide} />
  const H = props.H ?? 160
  const PH = H - PT - PB
  const sc = nice(-Math.max(0, ...(bas ?? []).filter((v): v is number => v != null)), Math.max(1, ...hauts.filter((v): v is number => v != null)), bas ? 4 : 3)
  const y = (v: number) => ((sc.hi - v) / (sc.hi - sc.lo)) * PH
  const y0 = y(0)
  return (
    <Carte title={title} sub={sub} legend={legend} note={note}>
      <div className="grille__trace" style={{ height: H }}>
        {sc.ticks.map((t) => (
          <Graduation key={t} top={PT + y(t)} label={bas ? signe(t) : axe(t)} fort={t === 0} />
        ))}
        <div className="grille__barres" style={{ height: PH }}>
          {hauts.map((g, i) => {
            const p = bas ? bas[i] : 0
            const hu = g ? y0 - y(g) : 0
            const hd = p ? y(-p) - y0 : 0
            return (
              <span key={i} style={{ background: hov && hov.i === i ? 'rgba(34,34,34,0.06)' : 'transparent' }}>
                <span className="grille__haut" style={{ top: y0 - hu, height: hu, background: C.up }} />
                <span className="grille__bas" style={{ top: y0 + 1, height: hd, background: C.down }} />
              </span>
            )
          })}
        </div>
        {dates().map((x, i) => (
          <span key={i} className="grille__date" style={{ left: x.left }}>
            {x.label}
          </span>
        ))}
        {zone}
        {bulle}
      </div>
    </Carte>
  )
}

function Graduation({ top, label, fort }: { top: number; label: string; fort: boolean }) {
  return (
    <>
      <span className="grille__ligne" style={{ top, borderTopColor: fort ? 'rgba(34,34,34,0.30)' : 'rgba(34,34,34,0.08)' }} />
      <span className="grille__grad" style={{ top: top - 6 }}>
        {label}
      </span>
    </>
  )
}
