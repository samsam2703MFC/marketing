import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { formatDe } from '../../lib/franchise/visuel'
import type { PhotoVisuel, ReglagesVisuel } from '../../lib/franchise/visuel'

/**
 * Le visuel d'un post franchisé, dessiné dans la charte du réseau (repris de social/public/franchise-visuel.js,
 * le rendu du studio « Posts Facebook » ramené à ses six styles de base) : style, mention, nom du produit,
 * photo, phrase, prix, offre et site, au format choisi. Dessiné sur un canevas : ce que l'écran montre est
 * exactement l'image envoyée au serveur (`toImage`, JPEG), qui la publie.
 */

export interface VisuelHandle {
  /** L'image du visuel à sa taille réelle (data: JPEG ou PNG) ; `format` : le même visuel dans un autre format (story). */
  toImage: (o?: { jpeg?: boolean; quality?: number; format?: string }) => Promise<string>
}

interface Palette {
  bg: string
  fg: string
  accent: string
  doux: string
  clair: boolean
}
const PALETTES: Record<string, Palette> = {
  epure: { bg: '#F5EFE4', fg: '#1c1a17', accent: '#8D1D2C', doux: '#7a736a', clair: true },
  abricot: { bg: '#F2C9A0', fg: '#1c1a17', accent: '#8D1D2C', doux: '#6b4420', clair: true },
  ruby: { bg: '#8D1D2C', fg: '#FFFFFF', accent: '#F2C9A0', doux: '#F4E3E5', clair: false },
  noir: { bg: '#1c1a17', fg: '#FFFFFF', accent: '#F2C9A0', doux: '#CFC6BA', clair: false },
  plein: { bg: '#1c1a17', fg: '#FFFFFF', accent: '#F2C9A0', doux: '#F4EFE8', clair: false },
  duo: { bg: '#8D1D2C', fg: '#FFFFFF', accent: '#F2C9A0', doux: '#F4E3E5', clair: false },
}
export const paletteDe = (style: string) => PALETTES[style] ?? PALETTES.epure

const BASE = import.meta.env.BASE_URL || '/'
const F = { sans: "'VisuelGotham', 'Gotham', system-ui, sans-serif", display: "'VisuelVank', 'Gotham', sans-serif", script: "'VisuelScript', cursive" }

let polices: Promise<void> | null = null
/** Les polices de la marque (Gotham, Vank, Playwrite), chargées une fois pour le canevas. */
function chargerPolices(): Promise<void> {
  if (polices) return polices
  const fichiers: [string, string][] = [
    ['VisuelGotham', 'fonts/Gotham_Medium.otf'],
    ['VisuelVank', 'fonts/GC_Vank.ttf'],
    ['VisuelScript', 'fonts/PlaywriteDEVA-Regular.ttf'],
  ]
  polices = Promise.all(
    fichiers.map(async ([nom, f]) => {
      try {
        const ff = new FontFace(nom, `url(${BASE}${f})`)
        await ff.load()
        document.fonts.add(ff)
      } catch {
        /* police absente : celle du système */
      }
    }),
  ).then(() => undefined)
  return polices
}

const IMAGES = new Map<string, Promise<HTMLImageElement | null>>()
function image(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  const deja = IMAGES.get(src)
  if (deja) return deja
  const p = new Promise<HTMLImageElement | null>((ok) => {
    const i = new Image()
    // Une image d'un autre site sans en-tête CORS ne se dessine pas : le visuel resterait inexportable.
    if (!src.startsWith('data:')) i.crossOrigin = 'anonymous'
    i.onload = () => ok(i)
    i.onerror = () => ok(null)
    i.src = src
  })
  IMAGES.set(src, p)
  return p
}

/** Les lignes d'un texte dans une largeur, au plus `max` (la dernière tronquée par « … »). */
function lignes(g: CanvasRenderingContext2D, texte: string, largeur: number, max: number): string[] {
  const mots = String(texte || '').split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const m of mots) {
    const t = cur ? `${cur} ${m}` : m
    if (g.measureText(t).width <= largeur || !cur) cur = t
    else {
      out.push(cur)
      cur = m
    }
  }
  if (cur) out.push(cur)
  if (out.length > max) {
    const r = out.slice(0, max)
    let d = r[max - 1]
    while (d.length > 1 && g.measureText(`${d}…`).width > largeur) d = d.slice(0, -1)
    r[max - 1] = `${d}…`
    return r
  }
  return out
}

function arrondi(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

/** Une photo dans un cadre : entière (détourée) ou qui le remplit ; zoom et cadrage du franchisé. */
function photoDans(g: CanvasRenderingContext2D, img: HTMLImageElement, ph: PhotoVisuel, x: number, y: number, w: number, h: number, couvrir: boolean, r: number, fond?: string) {
  const iw = img.naturalWidth || 1
  const ih = img.naturalHeight || 1
  const k = (couvrir ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * (ph.zoom || 1)
  const dw = iw * k
  const dh = ih * k
  const fx = (ph.x ?? 50) / 100
  const fy = (ph.y ?? 50) / 100
  const dx = x + (w - dw) * fx
  const dy = y + (h - dh) * fy
  g.save()
  arrondi(g, x, y, w, h, r)
  g.clip()
  // Une photo détourée (dessin du design system) se pose sur le crème de la marque : sur un fond foncé, elle disparaîtrait.
  if (fond) {
    g.fillStyle = fond
    g.fillRect(x, y, w, h)
  }
  g.drawImage(img, dx, dy, dw, dh)
  g.restore()
}

async function dessiner(c: HTMLCanvasElement, v: ReglagesVisuel) {
  await chargerPolices()
  const fmt = formatDe(v.format)
  const W = fmt.w
  const H = fmt.h
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) return
  const pal = paletteDe(v.style)
  const ph = v.photos[0] ?? null
  const [img, logo] = await Promise.all([image(ph?.src ?? ''), image(`${BASE}img/${pal.clair ? 'logo.png' : 'logo-white.png'}`)])
  const u = Math.min(W, H) / 1080
  const P = 64 * u
  const couvrir = v.cutMode === 'full' || (v.cutMode !== 'cut' && !ph?.cut)
  g.textBaseline = 'alphabetic'
  g.textAlign = 'center'

  // Le fond, et la photo des styles où elle le remplit.
  g.fillStyle = pal.bg
  g.fillRect(0, 0, W, H)
  const large = W / H > 1.4
  let zone = { x: 0, y: 0, w: W, h: H }
  if (v.style === 'plein') {
    if (img && ph) photoDans(g, img, ph, 0, 0, W, H, !ph.cut, 0, ph.cut ? '#F5EFE4' : undefined)
    const f = Math.max(0, Math.min(100, v.fondu ?? 60)) / 100
    const gr = g.createLinearGradient(0, H * 0.25, 0, H)
    gr.addColorStop(0, 'rgba(28,26,23,0)')
    gr.addColorStop(1, `rgba(28,26,23,${(0.25 + 0.65 * f).toFixed(2)})`)
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
    const gh = g.createLinearGradient(0, 0, 0, H * 0.3)
    gh.addColorStop(0, `rgba(28,26,23,${(0.15 + 0.35 * f).toFixed(2)})`)
    gh.addColorStop(1, 'rgba(28,26,23,0)')
    g.fillStyle = gh
    g.fillRect(0, 0, W, H * 0.3)
  } else if (v.style === 'duo') {
    if (large) {
      if (img && ph) photoDans(g, img, ph, W / 2, 0, W / 2, H, !ph.cut, 0, ph.cut ? '#F5EFE4' : undefined)
      zone = { x: 0, y: 0, w: W / 2, h: H }
    } else {
      if (img && ph) photoDans(g, img, ph, 0, 0, W, H * 0.52, !ph.cut, 0, ph.cut ? '#F5EFE4' : undefined)
      zone = { x: 0, y: H * 0.52, w: W, h: H * 0.48 }
    }
  }

  const cx = zone.x + zone.w / 2
  const largeurTexte = zone.w - 2 * P
  let y = zone.y + P

  // Haut : logo, mention, nom du produit.
  if (v.showLogo && logo) {
    const lh = 46 * u
    const lw = (logo.naturalWidth / Math.max(1, logo.naturalHeight)) * lh
    g.drawImage(logo, cx - lw / 2, y, lw, lh)
    y += lh + 30 * u
  }
  if (v.showEyebrow && v.eyebrow.trim()) {
    g.font = `400 ${28 * u}px ${F.sans}`
    g.fillStyle = pal.accent
    if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${3 * u}px`
    for (const l of lignes(g, v.eyebrow.toUpperCase(), largeurTexte, 2)) {
      y += 30 * u
      g.fillText(l, cx, y)
    }
    if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
    y += 22 * u
  }
  if (v.showTitle && v.title.trim()) {
    const t = (v.style === 'plein' || v.style === 'duo' ? 92 : 84) * u
    g.font = `400 ${t}px ${F.display}`
    g.fillStyle = pal.fg
    for (const l of lignes(g, v.title.toUpperCase(), largeurTexte, 2)) {
      y += t * 0.92
      g.fillText(l, cx, y)
    }
    y += 26 * u
  }

  // Bas : site, prix et offre, phrase (de bas en haut).
  let bas = zone.y + zone.h - P
  if (v.showSite && v.site.trim()) {
    g.font = `400 ${24 * u}px ${F.sans}`
    g.fillStyle = pal.doux
    g.fillText(v.site, cx, bas)
    bas -= 50 * u
  }
  const prix = v.showPrice && v.price.trim()
  const promo = v.showPromo && v.promo.trim()
  if (prix || promo) {
    const hBloc = 96 * u
    const top = bas - hBloc
    g.font = `700 ${64 * u}px ${F.sans}`
    const tp = prix ? `${v.price} €` : ''
    const wp = prix ? g.measureText(tp).width : 0
    g.font = `400 ${22 * u}px ${F.sans}`
    const wu = prix ? g.measureText(v.unit).width : 0
    g.font = `700 ${50 * u}px ${F.sans}`
    const wo = promo ? g.measureText(v.promo).width : 0
    g.font = `400 ${20 * u}px ${F.sans}`
    const wos = promo ? g.measureText(v.promoSub).width : 0
    const bp = prix ? Math.max(wp, wu) : 0
    const bo = promo ? Math.max(wo, wos) + 48 * u : 0
    const gap = prix && promo ? 34 * u : 0
    let x = cx - (bp + gap + bo) / 2
    if (prix) {
      g.textAlign = 'center'
      g.fillStyle = pal.fg
      g.font = `700 ${64 * u}px ${F.sans}`
      g.fillText(tp, x + bp / 2, top + 60 * u)
      g.font = `400 ${22 * u}px ${F.sans}`
      g.fillStyle = pal.doux
      g.fillText(v.unit, x + bp / 2, top + 90 * u)
      x += bp + gap
    }
    if (promo) {
      g.fillStyle = pal.accent
      arrondi(g, x, top, bo, hBloc, 14 * u)
      g.fill()
      g.fillStyle = pal.clair ? '#FFFFFF' : '#1c1a17'
      g.font = `700 ${50 * u}px ${F.sans}`
      g.fillText(v.promo, x + bo / 2, top + (v.promoSub ? 54 : 64) * u)
      if (v.promoSub) {
        g.font = `400 ${20 * u}px ${F.sans}`
        g.fillText(v.promoSub, x + bo / 2, top + 82 * u)
      }
    }
    bas = top - 24 * u
  }
  if (v.showPhrase && v.phrase.trim()) {
    const t = (v.phraseFont === 'display' ? 54 : v.phraseFont === 'sans' ? 40 : 44) * u
    g.font = `400 ${t}px ${v.phraseFont === 'display' ? F.display : v.phraseFont === 'sans' ? F.sans : F.script}`
    g.fillStyle = pal.accent
    const ls = lignes(g, v.phraseFont === 'display' ? v.phrase.toUpperCase() : v.phrase, largeurTexte, 2)
    for (let i = ls.length - 1; i >= 0; i--) {
      g.fillText(ls[i], cx, bas)
      bas -= t * 1.3
    }
    bas -= 6 * u
  }

  // Au milieu : la photo des styles à fond uni.
  if (v.style !== 'plein' && v.style !== 'duo' && img && ph) {
    const h = bas - y - 10 * u
    if (h > 80 * u) {
      const w = Math.min(largeurTexte, h * 1.4)
      photoDans(g, img, ph, cx - w / 2, y, w, h, couvrir, 18 * u, !couvrir && !pal.clair ? '#F5EFE4' : undefined)
    }
  }
}

export default function VisuelPost({ reglages, ref, titre }: { reglages: ReglagesVisuel; ref?: Ref<VisuelHandle>; titre?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pret, setPret] = useState(false)
  const dernier = useRef(reglages)
  dernier.current = reglages
  const cle = JSON.stringify(reglages)

  useEffect(() => {
    let vivant = true
    const c = canvas.current
    if (!c) return
    setPret(false)
    void dessiner(c, JSON.parse(cle) as ReglagesVisuel).then(() => {
      if (vivant) setPret(true)
    })
    return () => {
      vivant = false
    }
  }, [cle])

  useImperativeHandle(
    ref,
    () => ({
      toImage: async (o) => {
        const c = document.createElement('canvas')
        await dessiner(c, o?.format ? { ...dernier.current, format: o.format } : dernier.current)
        return o?.jpeg === false ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', o?.quality ?? 0.9)
      },
    }),
    [],
  )

  const fmt = formatDe(reglages.format)
  return (
    <div className={`fpub-visuel${pret ? '' : ' is-calcul'}`} style={{ aspectRatio: `${fmt.w} / ${fmt.h}` }} title={titre}>
      <canvas ref={canvas} aria-label="Visuel du post" />
    </div>
  )
}
