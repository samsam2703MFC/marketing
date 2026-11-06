import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import './StudioVisuel.css'
import { ROOTS } from '../../lib/api/module'
import { imageSocial } from '../../lib/social/refs'
import { ASSET, FONDS, FORMATS, LOGOS, POLICES, TRAITS, tonDe } from './studio-ds'
import type { Format, PhotoVisuel, Qc, Visuel } from './studio-ds'

/**
 * Le studio visuel du module Social & Ads (social/public/Posts Facebook.dc.html, en mode « planche seule »),
 * réécrit en React pour l'écran « Créer un post » : la planche du visuel composé (26 styles, quatre formats),
 * ses textes, son illustration et ses textes posés, aux dimensions de Meta. Le visuel s'exporte en JPEG ou en
 * PNG par html-to-image (le même moteur, les mêmes dimensions, le même rendu) ; un clic sur un texte de la
 * planche ouvre sa couleur chez l'écran hôte et un champ pour le réécrire sur place ; les textes posés se
 * glissent, se double-cliquent et s'effacent. L'écran hôte décide de tout : la planche n'a pas d'état à elle,
 * sauf le champ ouvert et l'export en cours.
 */

/** Ce que l'écran hôte confie à la planche : le visuel (dans la langue de l'aperçu), ses photos, la sélection. */
export interface ControleStudio extends Omit<Visuel, 'nl'> {
  nl?: Visuel['nl']
  photos: PhotoVisuel[]
  /** Textes fermés à l'édition sur place (post publié, prix lu boutique par boutique). */
  noEdit: string[]
  /** Le texte posé sélectionné. */
  txtSel: string | null
  /** Le texte du visuel dont on règle la couleur (entouré sur l'aperçu). */
  texteSel: string | null
}

export interface OptionsImage {
  jpeg?: boolean
  pixelRatio?: number
  quality?: number
}

/** Ce que la planche offre à l'écran hôte : l'export du visuel et son contrôle qualité. */
export interface StudioApi {
  toImage: (o?: OptionsImage) => Promise<string>
  controle: () => Qc[]
}

export interface StudioVisuelProps {
  control: ControleStudio
  onApi?: (api: StudioApi) => void
  /** Un texte posé glissé sur la planche : sa position, en % de la planche. */
  onLabelMove?: (id: string, x: number, y: number) => void
  onLabelSelect?: (id: string) => void
  /** Double-clic sur un texte posé. */
  onLabelEdit?: (id: string) => void
  onLabelDelete?: (id: string) => void
  /** Un clic sur un texte du visuel (titre, prix…) : l'hôte ouvre sa couleur. */
  onTextPick?: (role: string) => void
  /** Le texte réécrit sur la planche même (champ posé à côté). */
  onTextEdit?: (role: string, valeur: string) => void
}

interface HtmlToImage {
  toPng: (node: HTMLElement, o: Record<string, unknown>) => Promise<string>
  toJpeg: (node: HTMLElement, o: Record<string, unknown>) => Promise<string>
}

declare global {
  interface Window {
    htmlToImage?: HtmlToImage
  }
}

let moteur: Promise<HtmlToImage> | null = null
/** html-to-image, la bibliothèque d'export du studio (servie avec le module Social). */
export function moteurExport(): Promise<HtmlToImage> {
  moteur ??= new Promise<HtmlToImage>((ok, ko) => {
    if (window.htmlToImage) {
      ok(window.htmlToImage)
      return
    }
    const sc = document.createElement('script')
    sc.src = `${ROOTS.social}vendor/html-to-image.js`
    sc.async = true
    sc.onload = () => (window.htmlToImage ? ok(window.htmlToImage) : ko(new Error('bibliothèque d’export introuvable')))
    sc.onerror = () => ko(new Error('bibliothèque d’export introuvable'))
    document.head.appendChild(sc)
  }).catch((e: unknown) => {
    moteur = null
    throw e
  })
  return moteur
}

const s = (o: Record<string, string | number | undefined>) => o as CSSProperties

const NOMS_EDITION: Record<string, string> = { eyebrow: 'Mention', title: 'Nom', phrase: 'Phrase', price: 'Prix', unit: 'Unité', promo: 'Offre', promoSub: 'Sous-texte', site: 'Site' }
const ROLES: Record<string, string> = { eyebrow: 'eyebrow', title: 'title', phrase: 'phrase', price: 'price', unit: 'unit', promo: 'promo', promosub: 'promoSub', site: 'site' }
const POLICES_PHRASE: Record<string, string> = { script: "'Studio Playwrite'", display: "'Studio Vank'", sans: "'Studio Gotham'" }
const COULEURS_PHRASE: Record<string, string> = { ruby: '#8D1D2C', noir: '#232220', abricot: '#F2C9A0', blanc: '#FFFFFF', gris: '#8A847C' }
const NEW = ['frise', 'puzzle', 'pastilles', 'epinglees', 'etagere', 'diagonale', 'vedette', 'damier', 'encadre', 'nuit']

const MONTAGES = ['mosaique', 'grille', 'trio', 'collage', 'bandes', 'galerie'].concat(NEW)

/** Une couleur de texte de la palette (plus le gris de la marque) → son code ; « auto » ou inconnue → null. */
function couleurTexte(id: string | undefined | null): string | null {
  if (!id || id === 'auto') return null
  if (id === 'gris') return '#8A847C'
  return FONDS.find((x) => x.id === id)?.hex ?? null
}

/** Une case d'un montage : la photo, détourée ou pleine, son numéro (aperçu seulement), son zoom. */
interface Case {
  src: string
  cut: boolean
  full: boolean
  none: boolean
  n: number | string
  zt: string
  zo: string
  h?: number
  x?: number
  y?: number
  w?: number
  rot?: number
  bg?: string
  badge?: boolean
}

interface Edition {
  role: string
  orig: string
  value: string
  l: number
  t: number
  w: number
}

const formatDe = (k: string | undefined): Format => FORMATS[k ?? ''] ?? FORMATS.carre

export default function StudioVisuel(props: StudioVisuelProps) {
  const { control } = props
  const [exporting, setExporting] = useState(false)
  const [ed, setEd] = useState<Edition | null>(null)
  const [ratios, setRatios] = useState<Record<string, string>>({})
  const ratioWait = useRef<Record<string, boolean>>({})
  const art = useRef<HTMLDivElement | null>(null)
  const prev = useRef<HTMLDivElement | null>(null)
  const edIn = useRef<HTMLInputElement | null>(null)
  // Les dernières valeurs, pour l'export et le contrôle appelés par l'hôte (après un changement de format).
  const derniers = useRef({ control, props, exporting })
  derniers.current = { control, props, exporting }

  const ms = { ...control, exporting }
  const fKey = FORMATS[ms.format] ? ms.format : 'carre'
  const F = formatDe(fKey)
  const ton = tonDe(ms.style)

  // L'aperçu à l'échelle de son conteneur (--s), comme l'ancien studio.
  useLayoutEffect(() => {
    const el = prev.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      if (w) el.style.setProperty('--s', (w / formatDe(derniers.current.control.format).w).toFixed(4))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [])
  useLayoutEffect(() => {
    const el = prev.current
    if (el?.clientWidth) el.style.setProperty('--s', (el.clientWidth / F.w).toFixed(4))
  }, [F.w])

  /**
   * Contrôle qualité du visuel, sur la planche telle qu'elle sera exportée : texte qui dépasse, contraste
   * insuffisant sur un aplat, texte trop petit pour un téléphone, texte dans une zone recadrée par Instagram,
   * photo trop petite, fondu trop faible sous un texte posé sur la photo, logo absent.
   */
  const controle = useCallback((): Qc[] => {
    const el = art.current
    if (!el) return []
    const c = derniers.current.control
    const Fm = formatDe(c.format)
    const out: Qc[] = []
    const ar = el.getBoundingClientRect()
    if (!ar.width || !ar.height) return []
    const k = ar.width / Fm.w
    const lin = (v: number) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    const lum = (x: number[]) => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2])
    const rgb = (x: string) => {
      const m = String(x || '').match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }
    }
    // Le fond réel sous un texte : le premier aplat opaque en remontant (pas de calcul sous une image ou un dégradé).
    const fondDe = (e0: Element) => {
      for (let e: Element | null = e0; e && e !== el.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
        const b = rgb(cs.backgroundColor)
        if (b && b.a >= 0.95) return b.c
        if (e.classList.contains('pf-etq')) return null
      }
      return null
    }
    const photoFond = tonDe(c.style) === null
    const textes = [...el.querySelectorAll('h1,p,span,div')].filter((e) => {
      if (e.closest('.pf-x')) return false
      if (![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length >= 2)) return false
      const cs = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05
    })
    const nom = (e: Element) => {
      const t = (e.textContent ?? '').trim().replace(/\s+/g, ' ')
      return `« ${t.slice(0, 26)}${t.length > 26 ? '…' : ''} »`
    }
    const zone =
      Fm.h > Fm.w * 1.5
        ? { x0: 0, x1: 1, y0: 250 / 1920, y1: 1 - 250 / 1920, nom: 'la story (interface d’Instagram en haut et en bas)' }
        : Fm.w === Fm.h
          ? { x0: 0.125, x1: 0.875, y0: 0, y1: 1, nom: 'la grille du profil Instagram (recadrage 3:4)' }
          : null
    const hors: string[] = []
    const petits: string[] = []
    const contraste: string[] = []
    const coupe: string[] = []
    textes.forEach((e) => {
      const r = e.getBoundingClientRect()
      const x0 = (r.left - ar.left) / ar.width
      const x1 = (r.right - ar.left) / ar.width
      const y0 = (r.top - ar.top) / ar.height
      const y1 = (r.bottom - ar.top) / ar.height
      if (x0 < -0.004 || y0 < -0.004 || x1 > 1.004 || y1 > 1.004) hors.push(nom(e))
      else if (zone && (x0 < zone.x0 - 0.003 || x1 > zone.x1 + 0.003 || y0 < zone.y0 || y1 > zone.y1)) coupe.push(nom(e))
      const fs = parseFloat(getComputedStyle(e).fontSize) || 0
      if (fs && fs < (20 * Math.min(Fm.w, Fm.h)) / 1080) petits.push(nom(e))
      if (!photoFond || e.closest('.pf-etq')) {
        const fg = rgb(getComputedStyle(e).color)
        const bg = fondDe(e)
        if (fg && bg) {
          const a = lum(fg.c)
          const b = lum(bg)
          const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
          if (cr < 3) contraste.push(`${nom(e)} ${cr.toFixed(1)}:1`)
        }
      }
    })
    const liste = (l: string[]) => l.slice(0, 3).join(', ') + (l.length > 3 ? ` et ${l.length - 3} autre(s)` : '')
    if (hors.length) out.push({ niveau: 'erreur', msg: `Texte qui dépasse du visuel : ${liste(hors)}` })
    if (contraste.length) out.push({ niveau: 'attention', msg: `Contraste faible (moins de 3:1) : ${liste(contraste)}` })
    if (coupe.length && zone) out.push({ niveau: 'attention', msg: `Coupé dans ${zone.nom} : ${liste(coupe)}` })
    if (petits.length) out.push({ niveau: 'conseil', msg: `${petits.length} texte(s) de moins de 20 px, peu lisibles sur téléphone : ${liste(petits)}` })
    // Photo : sa définition face à la place qu'elle occupe dans l'image exportée.
    ;[...el.querySelectorAll('img')]
      .filter((i) => i.src && !/logo|img\/illus|img\/products\//.test(i.getAttribute('src') || ''))
      .forEach((i) => {
        const r = i.getBoundingClientRect()
        const besoin = (Math.max(r.width, r.height) / k) * (Fm.out[0] / Fm.w)
        const a = Math.max(i.naturalWidth || 0, i.naturalHeight || 0)
        if (a && besoin > 200 && a < besoin * 0.7) out.push({ niveau: 'attention', msg: `Photo de ${a} px agrandie à ${Math.round(besoin)} px : elle sera floue` })
      })
    if (photoFond && ['plein', 'pleinbandeau', 'pleinhaut', 'pleinfilet'].includes(c.style) && c.fondu != null && +c.fondu < 25)
      out.push({ niveau: 'attention', msg: `Fondu de ${c.fondu} % : le texte posé sur la photo peut être illisible` })
    if (!c.showLogo) out.push({ niveau: 'conseil', msg: 'Pas de logo sur le visuel' })
    return out
  }, [])

  /** Le visuel exporté aux dimensions de Meta (1080 × 1080, 1080 × 1350, 1080 × 1920, 1200 × 630). */
  const toImage = useCallback(async (o: OptionsImage = {}): Promise<string> => {
    const lib = await moteurExport()
    const node = art.current
    if (!node) throw new Error('export indisponible')
    setExporting(true)
    await new Promise((r) => setTimeout(r, 80))
    try {
      if (document.fonts?.ready) await document.fonts.ready
      const Fm = formatDe(derniers.current.control.format)
      const base = { width: Fm.w, height: Fm.h, pixelRatio: ((o.pixelRatio || 1) * Fm.out[0]) / Fm.w, backgroundColor: '#F5EFE4' }
      return o.jpeg ? await lib.toJpeg(node, { ...base, quality: o.quality || 0.85 }) : await lib.toPng(node, base)
    } finally {
      setExporting(false)
    }
  }, [])

  const onApi = props.onApi
  useEffect(() => {
    onApi?.({ toImage, controle })
  }, [onApi, toImage, controle])

  /** Glisser un texte posé : la position (en % de la planche) remonte à l'écran hôte. */
  const dragLabel = (ev: ReactPointerEvent, id: string) => {
    const el = art.current
    const move = props.onLabelMove
    props.onLabelSelect?.(id)
    if (!el || !move) return
    ev.preventDefault()
    const r = el.getBoundingClientRect()
    const pct = (v: number, a: number, b: number) => Math.round(Math.min(100, Math.max(0, ((v - a) / b) * 100)))
    let raf = 0
    let last: PointerEvent | null = null
    const onMove = (e: PointerEvent) => {
      last = e
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (last) move(id, pct(last.clientX, r.left, r.width), pct(last.clientY, r.top, r.height))
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * Le champ qui réécrit un texte de la planche, posé juste sous lui (au-dessus s'il touche le bas), en
   * coordonnées de l'écran dans le conteneur de l'aperçu. L'hôte peut fermer un texte à l'édition (noEdit).
   */
  const ouvrirEdition = (role: string, el: Element) => {
    const box = prev.current
    if (!box || control.noEdit.includes(role)) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const h = 40
    const w = Math.min(b.width - 8, Math.max(240, r.width + 60))
    const l = Math.max(4, Math.min(b.width - w - 4, r.left + r.width / 2 - b.left - w / 2))
    const bas = r.bottom - b.top + 8
    const haut = r.top - b.top - h - 8
    const t = bas + h <= b.height - 4 ? bas : Math.max(4, haut)
    const brut = (control as unknown as Record<string, unknown>)[role]
    const val = brut == null ? '' : String(brut)
    setEd({ role, orig: val, value: val, l, t, w })
    window.setTimeout(() => {
      const i = edIn.current
      if (i) {
        try {
          i.focus({ preventScroll: true })
          i.select()
        } catch {
          /* champ disparu */
        }
      }
    }, 30)
  }
  /** Fermer le champ ; `annuler` remet le texte d'avant le clic. */
  const fermerEdition = (annuler: boolean) => {
    if (!ed) return
    if (annuler && ed.value !== ed.orig) props.onTextEdit?.(ed.role, ed.orig)
    setEd(null)
  }

  const artClick = (e: ReactMouseEvent) => {
    const t = (e.target as Element | null)?.closest?.('[class*="pf-t-"]') ?? null
    const m = t ? /pf-t-(\w+)/.exec(t.className) : null
    if (!t || !m || !ROLES[m[1]]) return
    props.onTextPick?.(ROLES[m[1]])
    if (props.onTextEdit) ouvrirEdition(ROLES[m[1]], t)
  }

  const il = ms.illus?.src ? ms.illus : null
  const trait = il ? (il.trait && il.trait !== 'auto' ? il.trait : ton === 'fonce' ? 'abricot' : 'origine') : 'origine'
  const traitHex = TRAITS.find((t) => t.id === trait)?.hex ?? null
  const illusSrc = il ? imageSocial(il.src) : ''
  useEffect(() => {
    if (!illusSrc || !traitHex || ratios[illusSrc] || ratioWait.current[illusSrc]) return
    ratioWait.current[illusSrc] = true
    const im = new Image()
    im.onload = () => setRatios((r) => ({ ...r, [illusSrc]: `${im.naturalWidth || 1}/${im.naturalHeight || 1}` }))
    im.src = illusSrc
  }, [traitHex, illusSrc, ratios])

  const V = valeurs(ms, F, ratios, {
    onLabelMove: props.onLabelMove,
    onLabelDelete: props.onLabelDelete,
    onLabelEdit: props.onLabelEdit,
    drag: dragLabel,
  })

  // Le thème de la planche (applyTheme de l'ancien studio) : fond, fondu, police et couleur de la phrase,
  // couleur de chaque texte, texte entouré pendant le réglage de sa couleur (jamais à l'export).
  const fondChoisi = FONDS.find((x) => x.id === ms.fond)
  const fond = fondChoisi && fondChoisi.ton === ton ? fondChoisi.hex : null
  const fondu = ms.fondu != null && String(ms.fondu) !== '' ? Math.max(0, Math.min(100, +ms.fondu)) : 60
  const theme: Record<string, string> = { '--fade': (fondu / 60).toFixed(3), '--pf': POLICES_PHRASE[ms.phraseFont] || POLICES_PHRASE.script }
  if (fond) theme['--fond'] = fond
  const pc = COULEURS_PHRASE[ms.phraseColor]
  if (pc) theme['--pc'] = pc
  const classes: string[] = []
  const C: Record<string, string | undefined> = { ...(ms.couleurs || {}), ...(ms.phraseColor && ms.phraseColor !== 'auto' ? { phrase: ms.phraseColor } : {}) }
  for (const k of ['eyebrow', 'title', 'phrase', 'price', 'unit', 'promo', 'promoSub', 'site']) {
    const hx = couleurTexte(C[k])
    const cle = k.toLowerCase()
    if (hx) {
      classes.push(`pf-c-${cle}`)
      theme[`--c-${cle}`] = hx
    }
    if (!exporting && ms.texteSel === k) classes.push(`pf-sel-${cle}`)
  }
  if (!exporting && props.onTextPick) classes.push('pf-pick')
  const edOn = !exporting && ed

  return (
    <div className="studio">
      <div
        ref={prev}
        className="studio__apercu"
        style={s({ aspectRatio: F.ratio })}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        <div style={s({ width: `${F.w}px`, height: `${F.h}px`, transform: 'scale(var(--s,0.5))', transformOrigin: '0 0' })}>
          <div
            ref={art}
            data-format={fKey}
            className={classes.join(' ')}
            onClick={artClick}
            style={s({ width: `${F.w}px`, height: `${F.h}px`, position: 'relative', overflow: 'hidden', fontFamily: "'Studio Gotham'", color: '#232220', background: '#F5EFE4', ...theme })}
          >
            {planche(V)}
          </div>
        </div>
        {edOn ? (
          <div className="studio__edition" style={s({ left: `${edOn.l}px`, top: `${edOn.t}px`, width: `${edOn.w}px` })}>
            <span className="studio__edition-nom">{NOMS_EDITION[edOn.role] || ''}</span>
            <input
              ref={edIn}
              type="text"
              value={edOn.value}
              aria-label={NOMS_EDITION[edOn.role] || ''}
              onChange={(e) => {
                const v = e.target.value
                setEd({ ...edOn, value: v })
                props.onTextEdit?.(edOn.role, v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  fermerEdition(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  fermerEdition(true)
                }
              }}
              onBlur={() => fermerEdition(false)}
            />
            <button type="button" title="Terminer (Entrée) · Échap annule" onMouseDown={(e) => e.preventDefault()} onClick={() => fermerEdition(false)}>
              ✓
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface Gestes {
  onLabelMove?: StudioVisuelProps['onLabelMove']
  onLabelDelete?: StudioVisuelProps['onLabelDelete']
  onLabelEdit?: StudioVisuelProps['onLabelEdit']
  drag: (e: ReactPointerEvent, id: string) => void
}

/** Les valeurs de la planche (renderVals de l'ancien studio, mode planche seule). */
function valeurs(ms: ControleStudio & { exporting: boolean }, F: Format, ratios: Record<string, string>, g: Gestes) {
  const exporting = ms.exporting
  const ton = tonDe(ms.style)
  const selItems = ms.photos.map((p) => ({ src: imageSocial(p.src), cut: p.cut !== false, name: p.name || '', zoom: p.zoom, x: p.x, y: p.y }))
  type Item = (typeof selItems)[number]
  const zt = (p: Item | null) => `scale(${p?.zoom ? Math.min(3, Math.max(0.5, +p.zoom)) : 1})`
  const zo = (p: Item | null) => `${p?.x != null ? p.x : 50}% ${p?.y != null ? p.y : 50}%`
  const eff = (p: Item) => (ms.cutMode === 'auto' ? !!p.cut : ms.cutMode === 'cut')
  const slot = (p: Item | null, i?: number): Case =>
    p
      ? { src: p.src, cut: eff(p), full: !eff(p), none: false, n: (i == null ? 0 : i % selItems.length) + 1, zt: zt(p), zo: zo(p) }
      : { src: '', cut: false, full: false, none: true, n: '', zt: 'none', zo: '50% 50%' }
  const slots = (idx: number[]) => idx.map((i) => slot(selItems.length ? selItems[i % selItems.length] : null, i))
  const isMontage = MONTAGES.includes(ms.style)
  const showBadges = isMontage && selItems.length > 0 && !exporting
  const withXY = (list: Case[], pos: Partial<Case>[]) => list.map((p, i) => ({ ...p, ...pos[i % pos.length] }))
  const withH = (list: Case[], hs: number[]) => list.map((p, i) => ({ h: hs[i % hs.length], ...p }))
  const dam16: Case[] = []
  let di = 0
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if ((r + c) % 2 === 0) {
        const sl = slot(selItems.length ? selItems[di % selItems.length] : null, di)
        di++
        dam16.push({ ...sl, bg: '#EAE4DC', badge: showBadges })
      } else dam16.push({ src: '', cut: false, full: false, none: true, n: '', zt: 'none', zo: '50% 50%', bg: (r + c) % 4 === 1 ? '#F2C9A0' : '#FFFFFF', badge: false })
    }
  const main = selItems[0] ?? null
  const mainCut = main ? eff(main) : false
  const Lg = LOGOS.find((x) => x.id === ms.logo) ?? LOGOS[0]
  const logoMask = !!Lg.hex
  // Illustration du design system : position (centre, en % de la planche), taille (% du petit côté), trait.
  const il = ms.illus?.src ? ms.illus : null
  const trait = il ? (il.trait && il.trait !== 'auto' ? il.trait : ton === 'fonce' ? 'abricot' : 'origine') : 'origine'
  const traitHex = TRAITS.find((t) => t.id === trait)?.hex ?? null
  const illusSrc = il ? imageSocial(il.src) : ''

  const etiquettes = (Array.isArray(ms.textes) ? ms.textes : [])
    .filter((t) => t && String(t.txt || t.sous || '').trim())
    .map((t) => {
      const P = POLICES.find((x) => x.id === t.police) ?? POLICES[0]
      const hex = (k: string | null | undefined) => FONDS.find((f) => f.id === k)?.hex ?? null
      const forme = t.forme || 'etiquette'
      const size = Math.min(220, Math.max(16, +(t.taille ?? 0) || 56))
      const sous = String(t.sous || '').trim()
      const fond = forme === 'texte' ? null : hex(t.fond)
      // Pastille : un rond assez grand pour le texte (largeur estimée d'après la police) et le sous-texte.
      const em = P.id === 'titre' ? 0.5 : P.id === 'script' ? 0.62 : 0.66
      const nTxt = String(t.txt || '').length
      const nSous = sous.length
      const D = Math.round(Math.max(size * 2.4, nTxt * size * em + size * 0.9, nSous * size * 0.3 * 0.86 + size * 0.9) + (sous ? size * 0.45 : 0))
      const sel = !exporting && ms.txtSel === t.id
      return {
        txt: String(t.txt || ''),
        sous,
        hasSous: !!sous,
        sousSize: Math.max(14, Math.round(size * 0.3)),
        size,
        font: P.font,
        weight: P.weight,
        tt: P.tt,
        ls: P.ls,
        fg: hex(t.couleur) || '#FFFFFF',
        bg: fond || 'transparent',
        gap: Math.round(size * 0.14),
        radius: forme === 'pastille' ? '50%' : forme === 'etiquette' ? `${Math.round(size * 0.24)}px` : '0',
        pad: forme === 'etiquette' ? `${Math.round(size * 0.32)}px ${Math.round(size * 0.55)}px` : forme === 'bandeau' ? `${Math.round(size * 0.34)}px 40px` : '0',
        w: forme === 'pastille' ? `${D}px` : forme === 'bandeau' ? '112%' : 'auto',
        h: forme === 'pastille' ? `${D}px` : 'auto',
        x: forme === 'bandeau' ? 50 : Math.min(100, Math.max(0, +(t.x ?? 0) || 50)),
        y: Math.min(100, Math.max(0, t.y != null ? +t.y : 50)),
        rot: Math.max(-45, Math.min(45, +(t.rot ?? 0) || 0)),
        outline: sel ? '3px dashed rgba(141,29,44,0.75)' : 'none',
        cursor: g.onLabelMove ? 'move' : 'default',
        cls: `pf-etq${sel ? ' pf-sel' : ''}`,
        canDel: !exporting && !!g.onLabelDelete,
        stop: (e: ReactPointerEvent) => e.stopPropagation(),
        del: (e: ReactMouseEvent) => {
          e.stopPropagation()
          g.onLabelDelete?.(t.id)
        },
        down: (e: ReactPointerEvent) => g.drag(e, t.id),
        tip: g.onLabelEdit ? 'Glisser pour déplacer · double-clic pour modifier le texte' : '',
        edit: () => g.onLabelEdit?.(t.id),
      }
    })

  const V = {
    logoImgFonce: !logoMask,
    logoImgClair: !logoMask,
    logoMask,
    logoColor: Lg.hex || 'transparent',
    logoSrcFonce: Lg.src || `${ASSET}img/logo.png`,
    logoSrcClair: Lg.src || `${ASSET}img/logo-white.png`,
    etiquettes,
    illusImg: !!il && !traitHex,
    illusMask: !!il && !!traitHex,
    illusSrc,
    illusColor: traitHex || 'transparent',
    illusX: il ? Math.min(100, Math.max(0, il.x != null ? +il.x : 82)) : 50,
    illusY: il ? Math.min(100, Math.max(0, il.y != null ? +il.y : 18)) : 50,
    illusW: il ? Math.round((Math.min(F.w, F.h) * Math.min(80, Math.max(5, il.taille != null ? +il.taille : 28))) / 100) : 0,
    illusRatio: il ? ratios[illusSrc] || '1/1' : '1/1',
    isEpure: ms.style === 'epure',
    isAbricot: ms.style === 'abricot',
    isRuby: ms.style === 'ruby',
    isNoir: ms.style === 'noir',
    isPlein: ms.style === 'plein',
    isDuo: ms.style === 'duo',
    isMosaique: ms.style === 'mosaique',
    isGrille: ms.style === 'grille',
    isTrio: ms.style === 'trio',
    isCollage: ms.style === 'collage',
    isBandes: ms.style === 'bandes',
    isGalerie: ms.style === 'galerie',
    isFrise: ms.style === 'frise',
    isPuzzle: ms.style === 'puzzle',
    isPastilles: ms.style === 'pastilles',
    isEpinglees: ms.style === 'epinglees',
    isEtagere: ms.style === 'etagere',
    isDiagonale: ms.style === 'diagonale',
    isVedette: ms.style === 'vedette',
    isDamier: ms.style === 'damier',
    isEncadre: ms.style === 'encadre',
    isNuit: ms.style === 'nuit',
    isPleinbandeau: ms.style === 'pleinbandeau',
    isPleinencart: ms.style === 'pleinencart',
    isPleinhaut: ms.style === 'pleinhaut',
    isPleinfilet: ms.style === 'pleinfilet',
    photo: main ? main.src : '',
    photoZt: zt(main),
    photoZo: zo(main),
    noPhoto: !main,
    photoCut: !!main && mainCut,
    photoFull: !!main && !mainCut,
    mosA: withH(slots([0, 3, 6, 9]), [344, 430, 344, 430]),
    mosB: withH(slots([1, 4, 7, 10]), [430, 344, 430, 344]),
    mosC: withH(slots([2, 5, 8, 11]), [344, 430, 344, 430]),
    grid4: slots([0, 1, 2, 3]),
    grid9: slots([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    trio0: slot(main),
    trio12: slots([1, 2]),
    colA: slots([0, 1, 2, 3]),
    colB: slots([4]),
    strips: slots([0, 1, 2]),
    anyText: ms.showLogo || ms.showEyebrow || ms.showTitle || ms.showPhrase || ms.showPrice || ms.showSite,
    showBadges,
    frise4: slots([0, 1, 2, 3]),
    puz0: slot(main, 0),
    puz4: slots([1, 2, 3, 4]),
    past4: slots([0, 1, 2, 3]),
    epi3: withXY(slots([0, 1, 2]), [
      { x: 80, y: 160, w: 420, h: 440, rot: -6 },
      { x: 540, y: 130, w: 440, h: 460, rot: 4 },
      { x: 300, y: 450, w: 460, h: 370, rot: -2 },
    ]),
    etaA: slots([0, 1, 2]),
    etaB: slots([3, 4, 5]),
    diag3: withXY(slots([0, 1, 2]), [
      { x: 64, y: 150 },
      { x: 260, y: 405 },
      { x: 456, y: 660 },
    ]),
    ved0: slot(main, 0),
    ved4: slots([1, 2, 3, 4]),
    dam16,
    enc4: slots([0, 1, 2, 3]),
    nuit3: slots([0, 1, 2]),
    showLogo: ms.showLogo,
    showEyebrow: ms.showEyebrow,
    showTitle: ms.showTitle,
    showPhrase: ms.showPhrase,
    showPrice: ms.showPrice,
    showPromo: ms.showPromo,
    showSite: ms.showSite,
    eyebrow: ms.eyebrow,
    title: ms.title,
    phrase: ms.phrase,
    price: ms.price,
    unit: ms.unit,
    promo: ms.promo,
    promoSub: ms.promoSub,
    site: ms.site,
  }

  return V
}

type PlancheV = ReturnType<typeof valeurs>

/** La planche : les 26 styles du studio, l'illustration et les textes posés (balisage repris tel quel). */
function planche(V: PlancheV) {
  return (
    <>

{V.isEpure ? (<>
<div className="pf-root pf-pile" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '72px 80px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '56px', width: 'auto', flex: '0 0 auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '56px', flex: '0 0 auto', width: '328px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '22px', marginTop: '40px', flex: '0 0 auto' })}>
<span style={s({ width: '56px', height: '1.5px', background: '#8D1D2C', display: 'block' })}></span>
<span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '18px', letterSpacing: '0.36em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span>
<span style={s({ width: '56px', height: '1.5px', background: '#8D1D2C', display: 'block' })}></span>
</div>
</>) : null}
{V.showTitle ? (<>
<h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '84px', lineHeight: '0.98', textTransform: 'uppercase', margin: '30px 0 0', color: '#232220', maxWidth: '14ch', textWrap: 'balance' })}>{V.title}</h1>
</>) : null}
{V.showPhrase ? (<>
<p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '26px', lineHeight: '1.5', color: 'var(--pc,#8A847C)', margin: '20px 0 0', maxWidth: '32ch', textWrap: 'pretty' })}>{V.phrase}</p>
</>) : null}
<div className="pf-photo" style={s({ overflow: 'hidden', flex: '1 1 auto', minHeight: '0', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px 0' })}>
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ maxWidth: '82%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoFull ? (<><img src={V.photo} alt="" style={s({ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '24px', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ width: '70%', height: '100%', border: '2px dashed rgba(34,34,34,0.25)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#8A847C' })}>Ajoutez une photo au post</div></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '80px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '84px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '80px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<>
<p className="pf-t-site" style={s({ margin: '28px 0 0', fontWeight: '500', fontSize: '20px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p>
</>) : null}
</div>
</>) : null}
{V.isAbricot ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F2C9A0)', color: '#232220', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#6B4420', '--pr': '#8D1D2C' })}>
<div style={s({ position: 'absolute', top: '72px', left: '72px', right: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '52px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '52px', width: '304px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '16px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}
</div>
<div style={s({ position: 'absolute', top: '196px', left: '72px', width: '680px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' })}>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '104px', lineHeight: '0.92', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '28px', lineHeight: '1.45', color: 'var(--pc,#6B4420)', margin: '28px 0 0', maxWidth: '400px', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
</div>
<div style={s({ overflow: 'hidden', position: 'absolute', right: '56px', bottom: '56px', width: '520px', height: '520px', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' })}>
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoFull ? (<><img src={V.photo} alt="" style={s({ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ width: '100%', height: '100%', border: '2px dashed rgba(35,34,32,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#6B4420' })}>Ajoutez une photo au post</div></>) : null}
</div>
<div style={s({ position: 'absolute', left: '72px', bottom: '72px', display: 'flex', flexDirection: 'column', gap: '22px', alignItems: 'flex-start' })}>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<div style={s({ padding: '0 32px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '72px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '76px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '72px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '0', fontWeight: '500', fontSize: '20px', letterSpacing: '0.14em', color: '#6B4420' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isRuby ? (<>
<div className="pf-root pf-pile" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#8D1D2C)', color: '#FFFFFF', padding: '72px 80px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#F2C9A0', '--pr': '#F2C9A0' })}>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ height: '56px', width: 'auto', flex: '0 0 auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '56px', flex: '0 0 auto', width: '328px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
<div className="pf-photo" style={s({ overflow: 'hidden', flex: '1 1 auto', minHeight: '0', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '36px 0 32px' })}>
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ maxWidth: '78%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoFull ? (<><img src={V.photo} alt="" style={s({ height: '100%', aspectRatio: '1/1', width: 'auto', maxWidth: '100%', objectFit: 'cover', borderRadius: '50%', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ height: '100%', aspectRatio: '1/1', border: '2px dashed rgba(255,255,255,0.4)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#F2C9A0' })}>Ajoutez une photo au post</div></>) : null}
</div>
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '16px', letterSpacing: '0.36em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '92px', lineHeight: '0.96', textTransform: 'uppercase', margin: '18px 0 0', color: '#FFFFFF', maxWidth: '14ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '26px', lineHeight: '1.5', color: 'var(--pc,#F2C9A0)', margin: '16px 0 0', maxWidth: '32ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', marginTop: '32px' })}>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '76px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '80px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '76px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '28px 0 0', fontWeight: '500', fontSize: '20px', letterSpacing: '0.14em', color: '#F2C9A0' })}>{V.site}</p></>) : null}
</div>
</>) : null}
{V.isNoir ? (<>
<div className="pf-root pf-pile" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#232220)', color: '#FFFFFF', padding: '72px 80px 60px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#B8B2A8', '--pr': '#F2C9A0' })}>
{V.showEyebrow ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '22px', flex: '0 0 auto' })}>
<span style={s({ width: '56px', height: '1.5px', background: '#F2C9A0', display: 'block' })}></span>
<span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '16px', letterSpacing: '0.36em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.eyebrow}</span>
<span style={s({ width: '56px', height: '1.5px', background: '#F2C9A0', display: 'block' })}></span>
</div>
</>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '96px', lineHeight: '0.96', textTransform: 'uppercase', margin: '28px 0 0', color: '#FFFFFF', maxWidth: '14ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
<div className="pf-photo" style={s({ overflow: 'hidden', flex: '1 1 auto', minHeight: '0', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '28px 0' })}>
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ maxWidth: '82%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoFull ? (<><img src={V.photo} alt="" style={s({ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '24px', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ width: '70%', height: '100%', border: '2px dashed rgba(255,255,255,0.3)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#B8B2A8' })}>Ajoutez une photo au post</div></>) : null}
</div>
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '32px', lineHeight: '1.4', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '28ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', marginTop: '28px' })}>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '76px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '80px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '76px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
<div style={s({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginTop: '36px', flex: '0 0 auto' })}>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ height: '40px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '40px', width: '234px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '0', fontWeight: '500', fontSize: '20px', letterSpacing: '0.14em', color: '#B8B2A8' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isPlein ? (<>
<div className="pf-root" style={s({ overflow: 'hidden', position: 'absolute', inset: '0', background: '#232220', color: '#FFFFFF', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#F2C9A0', '--pr': '#F2C9A0' })}>
{V.photoFull ? (<><img className="pf-bleed" src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', left: '11%', top: '8%', width: '78%', height: '62%', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ position: 'absolute', left: '15%', top: '10%', width: '70%', height: '50%', border: '2px dashed rgba(255,255,255,0.3)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#B8B2A8' })}>Ajoutez une photo au post</div></>) : null}
<div className="pf-bleed" style={s({ position: 'absolute', inset: '0', background: 'linear-gradient(180deg,rgba(35,34,32,calc(0.45 * var(--fade,1))) 0%,rgba(35,34,32,0) 22%,rgba(35,34,32,0) 42%,rgba(35,34,32,calc(0.45 * var(--fade,1))) 62%,rgba(35,34,32,calc(0.88 * var(--fade,1))) 100%)' })}></div>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ position: 'absolute', top: '64px', left: '64px', height: '52px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ position: 'absolute', top: '64px', left: '64px', height: '52px', width: '304px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ position: 'absolute', top: '80px', right: '64px', fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#FFFFFF', textAlign: 'right', maxWidth: '46%' })}>{V.eyebrow}</span></>) : null}
<div style={s({ position: 'absolute', left: '64px', right: '64px', bottom: '64px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px' })}>
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '28px', lineHeight: '1.4', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '96px', lineHeight: '0.95', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', maxWidth: '12ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', marginTop: '10px' })}>
<div style={s({ padding: '0 32px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '68px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '72px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '68px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '14px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '10px 0 0', fontWeight: '500', fontSize: '20px', letterSpacing: '0.14em', color: '#FFFFFF' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isPleinbandeau ? (<>
<div className="pf-root" style={s({ overflow: 'hidden', position: 'absolute', inset: '0', background: '#232220', color: '#FFFFFF', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#F2C9A0', '--pr': '#F2C9A0' })}>
{V.photoFull ? (<><img className="pf-bleed" src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', left: '12%', top: '16%', width: '76%', height: '50%', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ position: 'absolute', left: '15%', top: '18%', width: '70%', height: '44%', border: '2px dashed rgba(255,255,255,0.35)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: 'rgba(255,255,255,0.35)' })}>Ajoutez une photo au post</div></>) : null}
<div className="pf-bleed" style={s({ position: 'absolute', inset: '0', background: 'linear-gradient(180deg,rgba(35,34,32,calc(0.55 * var(--fade,1))) 0%,rgba(35,34,32,0) 24%)' })}></div>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ position: 'absolute', top: '60px', left: '64px', height: '50px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ position: 'absolute', top: '60px', left: '64px', height: '50px', width: '293px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ position: 'absolute', top: '76px', right: '64px', fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#FFFFFF', textAlign: 'right', maxWidth: '46%' })}>{V.eyebrow}</span></>) : null}
<div className="pf-bas" style={s({ position: 'absolute', left: '0', right: '0', bottom: '0', background: '#8D1D2C', padding: '44px 64px 48px', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '32px' })}>
<div style={s({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', minWidth: '0', flex: '1 1 auto' })}>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '80px', lineHeight: '0.95', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', maxWidth: '13ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '24px', lineHeight: '1.4', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '6px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#F2C9A0' })}>{V.site}</p></>) : null}
</div>
{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}><div style={s({ padding: '0 28px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '64px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '72px', background: 'var(--pr)', display: 'block' })}></span><div style={s({ padding: '0 0 0 28px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '64px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}
</div>
</div>
</>) : null}
{V.isPleinencart ? (<>
<div className="pf-root" style={s({ overflow: 'hidden', position: 'absolute', inset: '0', background: '#8A847C', color: '#232220', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
{V.photoFull ? (<><img className="pf-bleed" src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', left: '30%', top: '6%', width: '64%', height: '62%', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ position: 'absolute', left: '34%', top: '10%', width: '56%', height: '46%', border: '2px dashed rgba(255,255,255,0.5)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: 'rgba(255,255,255,0.5)' })}>Ajoutez une photo au post</div></>) : null}
<div style={s({ position: 'absolute', left: '64px', bottom: '64px', width: 'min(600px,56%)', background: '#F5EFE4', borderRadius: '28px', padding: '40px 44px 36px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px', boxShadow: '0 18px 50px rgba(35,34,32,0.22)' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '40px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '40px', width: '234px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '13px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '68px', lineHeight: '0.96', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.4', color: 'var(--pc,#6B4420)', margin: '0', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}><div style={s({ padding: '0 28px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '64px', background: 'var(--pr)', display: 'block' })}></span><div style={s({ padding: '0 0 0 28px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '2px 0 0', fontWeight: '500', fontSize: '16px', letterSpacing: '0.14em', color: '#6B4420' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isPleinhaut ? (<>
<div className="pf-root" style={s({ overflow: 'hidden', position: 'absolute', inset: '0', background: '#232220', color: '#FFFFFF', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#F2C9A0', '--pr': '#F2C9A0' })}>
{V.photoFull ? (<><img className="pf-bleed" src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', left: '14%', top: '40%', width: '56%', height: '54%', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ position: 'absolute', left: '16%', top: '44%', width: '50%', height: '42%', border: '2px dashed rgba(255,255,255,0.35)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: 'rgba(255,255,255,0.35)' })}>Ajoutez une photo au post</div></>) : null}
<div className="pf-bleed" style={s({ position: 'absolute', inset: '0', background: 'linear-gradient(180deg,rgba(35,34,32,calc(0.88 * var(--fade,1))) 0%,rgba(35,34,32,calc(0.45 * var(--fade,1))) 32%,rgba(35,34,32,0) 52%,rgba(35,34,32,0) 80%,rgba(35,34,32,calc(0.45 * var(--fade,1))) 100%)' })}></div>
<div style={s({ position: 'absolute', left: '64px', right: '64px', top: '56px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '14px' })}>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.34em', textTransform: 'uppercase', color: '#F2C9A0', marginTop: '8px' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '92px', lineHeight: '0.95', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', maxWidth: '14ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '26px', lineHeight: '1.4', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '32ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ position: 'absolute', right: '56px', bottom: '56px', width: '250px', height: '250px', borderRadius: '50%', background: '#8D1D2C', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', textAlign: 'center', transform: 'rotate(-6deg)', boxShadow: '0 14px 40px rgba(35,34,32,0.3)' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '64px', lineHeight: '1', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '4px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.unit}</div>
{V.showPromo ? (<><div className="pf-t-promo" style={s({ fontWeight: '500', fontSize: '22px', lineHeight: '1', color: '#F2C9A0', whiteSpace: 'nowrap', marginTop: '4px' })}>{V.promo} · <span className="pf-t-promosub" style={s({ fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase' })}>{V.promoSub}</span></div></>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ position: 'absolute', left: '64px', bottom: '64px', margin: '0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#FFFFFF' })}>{V.site}</p></>) : null}
</div>
</>) : null}
{V.isPleinfilet ? (<>
<div className="pf-root" style={s({ overflow: 'hidden', position: 'absolute', inset: '0', background: '#232220', color: '#FFFFFF', '--p1': '#FFFFFF', '--p2': '#F2C9A0', '--pl': '#F5EFE4', '--pr': '#F2C9A0' })}>
{V.photoFull ? (<><img className="pf-bleed" src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', left: '16%', top: '12%', width: '68%', height: '48%', objectFit: 'contain', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ position: 'absolute', left: '18%', top: '14%', width: '64%', height: '40%', border: '2px dashed rgba(255,255,255,0.35)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: 'rgba(255,255,255,0.35)' })}>Ajoutez une photo au post</div></>) : null}
<div className="pf-bleed" style={s({ position: 'absolute', inset: '0', background: 'linear-gradient(180deg,rgba(35,34,32,calc(0.35 * var(--fade,1))) 0%,rgba(35,34,32,0) 20%,rgba(35,34,32,0) 46%,rgba(35,34,32,calc(0.6 * var(--fade,1))) 70%,rgba(35,34,32,calc(0.9 * var(--fade,1))) 100%)' })}></div>
<div className="pf-cadre" style={s({ position: 'absolute', inset: '32px', border: '3px solid #F5EFE4', borderRadius: '6px', pointerEvents: 'none' })}></div>
{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ position: 'absolute', top: '72px', left: '50%', transform: 'translateX(-50%)', height: '46px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ position: 'absolute', top: '72px', left: '50%', transform: 'translateX(-50%)', height: '46px', width: '269px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
<div style={s({ position: 'absolute', left: '80px', right: '80px', bottom: '76px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '12px' })}>
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '14px', letterSpacing: '0.34em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '84px', lineHeight: '0.95', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', maxWidth: '14ch', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '24px', lineHeight: '1.4', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '32ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
<div style={s({ marginTop: '6px' })}>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}><div style={s({ padding: '0 28px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '68px', background: 'var(--pr)', display: 'block' })}></span><div style={s({ padding: '0 0 0 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div>
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '16px', letterSpacing: '0.14em', color: '#F5EFE4' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isDuo ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div className="pf-colonne" style={s({ position: 'absolute', left: '0', top: '0', width: '50%', height: '100%', background: '#F2C9A0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', boxSizing: 'border-box', overflow: 'hidden' })}>
{V.photoFull ? (<><img src={V.photo} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.photoCut ? (<><img src={V.photo} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: V.photoZt, transformOrigin: V.photoZo })} /></>) : null}
{V.noPhoto ? (<><div style={s({ width: '100%', height: '60%', border: '2px dashed rgba(35,34,32,0.3)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#6B4420', textAlign: 'center' })}>Ajoutez une photo au post</div></>) : null}
</div>
<div style={s({ position: 'absolute', left: '50%', top: '0', width: '50%', height: '100%', padding: '64px 56px 56px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '44px', width: 'auto', flex: '0 0 auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '44px', flex: '0 0 auto', width: '257px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
<div style={s({ flex: '1 1 auto', minHeight: '0', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: '20px' })}>
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '14px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '76px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '24px', lineHeight: '1.5', color: 'var(--pc,#8A847C)', margin: '0', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 28px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '6px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '64px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 28px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '13px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '24px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
</div>
</>) : null}
{V.isMosaique ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', overflow: 'hidden', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div style={s({ position: 'absolute', left: '24px', top: '0', right: '24px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '24px', alignItems: 'start' })}>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '24px', transform: 'translateY(-70px)' })}>
{V.mosA.map((p, k1) => (<Fragment key={k1}>
<div style={s({ height: `${p.h}px`, background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '26px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '24px', transform: 'translateY(-190px)' })}>
{V.mosB.map((p, k2) => (<Fragment key={k2}>
<div style={s({ height: `${p.h}px`, background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '26px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '24px', transform: 'translateY(-120px)' })}>
{V.mosC.map((p, k3) => (<Fragment key={k3}>
<div style={s({ height: `${p.h}px`, background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '26px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
</div>
{V.anyText ? (<>
<div style={s({ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: '#F5EFE4', borderRadius: '24px', padding: '52px 60px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '18px', width: '600px', boxSizing: 'border-box', boxShadow: '0 24px 60px rgba(35,34,32,0.18)' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '44px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '44px', width: '257px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '14px', letterSpacing: '0.32em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '60px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.5', color: 'var(--pc,#8A847C)', margin: '0', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '6px' })}>
<div style={s({ padding: '0 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '60px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
</>) : null}
</div>
</>) : null}
{V.isGrille ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}
</div>
<div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr)', gap: '24px' })}>
{V.grid4.map((p, k4) => (<Fragment key={k4}>
<div style={s({ minHeight: '0', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '56px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 24px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '60px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
</div>
</div>
</>) : null}
{V.isTrio ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}
</div>
<div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr)', gap: '24px' })}>
<div style={s({ gridRow: '1 / span 2', minHeight: '0', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{V.trio0.n}</span></>) : null}{V.trio0.cut ? (<><img src={V.trio0.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: V.trio0.zt, transformOrigin: V.trio0.zo })} /></>) : null}
{V.trio0.full ? (<><img src={V.trio0.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.trio0.zt, transformOrigin: V.trio0.zo })} /></>) : null}
</div>
{V.trio12.map((p, k5) => (<Fragment key={k5}>
<div style={s({ minHeight: '0', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '56px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 24px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '60px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
</div>
</div>
</>) : null}
{V.isCollage ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '24px', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr)', gap: '24px', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
{V.colA.map((p, k6) => (<Fragment key={k6}>
<div style={s({ minHeight: '0', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
<div style={s({ minHeight: '0', background: '#FFFFFF', borderRadius: '24px', overflow: 'hidden', padding: '36px 28px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '14px' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '36px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '36px', width: '211px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '11px', letterSpacing: '0.28em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '40px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '17px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showPrice ? (<>
<div style={s({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginTop: '4px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '4px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '11px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
{V.showPromo ? (<>
<span style={s({ width: '40px', height: '1.5px', background: 'var(--pr)', display: 'block', margin: '8px 0' })}></span>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '11px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</>) : null}
</div>
</>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '14px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
{V.colB.map((p, k7) => (<Fragment key={k7}>
<div style={s({ minHeight: '0', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
</>) : null}
{V.isBandes ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', display: 'flex', flexDirection: 'column', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '6px' })}>
{V.strips.map((p, k8) => (<Fragment key={k8}>
<div style={s({ minHeight: '0', background: '#EAE4DC', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ flex: '0 0 auto', padding: '44px 64px 52px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '32px' })}>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>
<div style={s({ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '40px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '40px', width: '234px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '14px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}
</div>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '56px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '2px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 24px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '60px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
</div>
</div>
</>) : null}
{V.isGalerie ? (<>
<div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '48px 56px 44px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '24px', '--p1': '#8D1D2C', '--p2': '#232220', '--pl': '#8A847C', '--pr': '#8D1D2C' })}>
<div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '44px', flex: '0 0 auto' })}>
{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '44px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '44px', width: '257px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}
{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '14px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}
</div>
<div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gridTemplateRows: 'repeat(3,minmax(0,1fr))', gap: '20px' })}>
{V.grid9.map((p, k9) => (<Fragment key={k9}>
<div style={s({ minHeight: '0', background: '#EAE4DC', borderRadius: '20px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' })}>
{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}
</div>
</Fragment>))}
</div>
<div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}>
<div style={s({ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>
{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '44px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}
{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '20px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '34ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}
{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '2px 0 0', fontWeight: '500', fontSize: '16px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}
</div>
{V.showPrice ? (<>
<div style={s({ display: 'flex', alignItems: 'center', flex: '0 0 auto' })}>
<div style={s({ padding: '0 20px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', letterSpacing: '-0.01em', color: 'var(--p1)', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div>
<div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.unit}</div>
</div>
{V.showPromo ? (<>
<div style={s({ display: 'flex', alignItems: 'center' })}>
<span style={s({ width: '1.5px', height: '52px', background: 'var(--pr)', display: 'block' })}></span>
<div style={s({ padding: '0 0 0 20px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}>
<div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', color: 'var(--p2)', whiteSpace: 'nowrap' })}>{V.promo}</div>
<div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--pl)' })}>{V.promoSub}</div>
</div>
</div>
</>) : null}
</div>
</>) : null}
</div>
</div>
</>) : null}
{V.isFrise ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '84px', lineHeight: '0.96', textTransform: 'uppercase', margin: '0', color: '#232220', textAlign: 'center', textWrap: 'balance' })}>{V.title}</h1></>) : null}<div style={s({ flex: '1 1 auto', minHeight: '0', display: 'flex', alignItems: 'center' })}><div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '18px', width: '100%' })}>{V.frise4.map((p, k10) => (<Fragment key={k10}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box', aspectRatio: '1/1' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div></div><div style={s({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', flex: '0 0 auto' })}>{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '24px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', textAlign: 'center', maxWidth: '34ch' })}>{V.phrase}</p></>) : null}{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' })}><div style={s({ padding: '0 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '64px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '60px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div></div></>) : null}
{V.isPuzzle ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gridTemplateRows: 'repeat(3,minmax(0,1fr))', gap: '20px' })}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', boxSizing: 'border-box', gridColumn: '1 / span 2', gridRow: '1 / span 2' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{V.puz0.n}</span></>) : null}{V.puz0.cut ? (<><img src={V.puz0.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: V.puz0.zt, transformOrigin: V.puz0.zo })} /></>) : null}{V.puz0.full ? (<><img src={V.puz0.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.puz0.zt, transformOrigin: V.puz0.zo })} /></>) : null}</div>{V.puz4.map((p, k11) => (<Fragment key={k11}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}<div style={s({ minHeight: '0', background: '#FFFFFF', borderRadius: '24px', overflow: 'hidden', padding: '24px 20px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '10px' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '30px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '30px', width: '176px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '10px', letterSpacing: '0.26em', textTransform: 'uppercase', color: '#8D1D2C' })}>{V.eyebrow}</span></>) : null}{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '34px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPrice ? (<><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '44px', lineHeight: '1', color: '#8D1D2C', whiteSpace: 'nowrap', marginTop: '4px' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '4px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '10px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></>) : null}{V.showPromo ? (<><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '30px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap', marginTop: '4px' })}>{V.promo}</div></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '12px', letterSpacing: '0.12em', color: '#8A847C' })}>{V.site}</p></>) : null}</div></div></div></>) : null}
{V.isPastilles ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(2,300px)', gap: '24px 40px', justifyContent: 'center', alignContent: 'center' })}>{V.past4.map((p, k12) => (<Fragment key={k12}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '150px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', boxSizing: 'border-box', width: '300px', height: '300px' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '52px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 22px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '56px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></>) : null}
{V.isEpinglees ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#EAE4DC)', color: '#232220', padding: '0', boxSizing: 'border-box', flexDirection: 'column', gap: '28px', display: 'block' })}><div style={s({ position: 'absolute', left: '64px', right: '64px', top: '56px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div></div>{V.epi3.map((p, k13) => (<Fragment key={k13}><div style={s({ position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, transform: `rotate(${p.rot}deg)`, background: '#FFFFFF', borderRadius: '8px', padding: '18px 18px 54px', boxSizing: 'border-box', boxShadow: '0 18px 40px rgba(35,34,32,0.16)' })}><div style={s({ position: 'relative', width: '100%', height: '100%', background: '#F5EFE4', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></div></Fragment>))}<div style={s({ position: 'absolute', left: '64px', right: '64px', bottom: '56px' })}><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '48px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 21px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '51px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 21px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></div></>) : null}
{V.isEtagere ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'flex', flexDirection: 'column', gap: '36px' })}><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '16px', borderBottom: '3px solid #8D1D2C' })}>{V.etaA.map((p, k14) => (<Fragment key={k14}><div style={s({ overflow: 'hidden', minHeight: '0', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 10px 10px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '92%', objectFit: 'cover', borderRadius: '16px 16px 0 0', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '16px', borderBottom: '3px solid #8D1D2C' })}>{V.etaB.map((p, k15) => (<Fragment key={k15}><div style={s({ overflow: 'hidden', minHeight: '0', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 10px 10px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '92%', objectFit: 'cover', borderRadius: '16px 16px 0 0', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div></div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '52px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 22px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '56px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></>) : null}
{V.isDiagonale ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '0', boxSizing: 'border-box', flexDirection: 'column', gap: '28px', display: 'block' })}><div style={s({ position: 'absolute', left: '64px', right: '64px', top: '56px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div></div>{V.diag3.map((p, k16) => (<Fragment key={k16}><div style={s({ position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, width: '560px', height: '270px', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}<div style={s({ position: 'absolute', left: '64px', bottom: '64px', width: '360px', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'flex-start' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '56px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '20px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 21px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '51px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 21px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '48px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '16px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div></div></>) : null}
{V.isVedette ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgFonce ? (<><img src={V.logoSrcFonce} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8D1D2C', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', boxSizing: 'border-box', flex: '1 1 auto' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{V.ved0.n}</span></>) : null}{V.ved0.cut ? (<><img src={V.ved0.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: V.ved0.zt, transformOrigin: V.ved0.zo })} /></>) : null}{V.ved0.full ? (<><img src={V.ved0.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: V.ved0.zt, transformOrigin: V.ved0.zo })} /></>) : null}</div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '52px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 22px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '56px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div><div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '18px', height: '170px', flex: '0 0 auto' })}>{V.ved4.map((p, k17) => (<Fragment key={k17}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '20px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div></div></>) : null}
{V.isDamier ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#F5EFE4)', color: '#232220', padding: '40px 40px 48px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gridTemplateRows: 'repeat(4,minmax(0,1fr))', gap: '12px' })}>{V.dam16.map((p, k18) => (<Fragment key={k18}><div style={s({ minHeight: '0', position: 'relative', background: p.bg, borderRadius: '16px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px', boxSizing: 'border-box' })}>{p.badge ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '52px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#232220', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#8A847C)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#8A847C' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 22px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', letterSpacing: '-0.01em', color: '#8D1D2C', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '56px', background: '#8D1D2C', display: 'block' })}></span><div style={s({ padding: '0 0 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '52px', lineHeight: '1', color: '#232220', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8A847C' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></>) : null}
{V.isEncadre ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#8D1D2C)', color: '#FFFFFF', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#F2C9A0', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gridTemplateRows: 'repeat(2,minmax(0,1fr))', gap: '24px' })}>{V.enc4.map((p, k19) => (<Fragment key={k19}><div style={s({ minHeight: '0', position: 'relative', background: '#F5EFE4', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box', border: '10px solid #FFFFFF' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '56px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#F2C9A0' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 24px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '60px', background: '#F2C9A0', display: 'block' })}></span><div style={s({ padding: '0 0 0 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '56px', lineHeight: '1', color: '#F2C9A0', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#F2C9A0' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></>) : null}
{V.isNuit ? (<><div className="pf-root" style={s({ position: 'absolute', inset: '0', background: 'var(--fond,#232220)', color: '#FFFFFF', padding: '56px 64px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '28px' })}><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', minHeight: '48px', flex: '0 0 auto' })}>{V.showLogo ? (<>{V.logoImgClair ? (<><img src={V.logoSrcClair} alt="" style={s({ height: '48px', width: 'auto' })} /></>) : null}{V.logoMask ? (<><span style={s({ height: '48px', width: '281px', display: 'block', aspectRatio: '708/121', background: V.logoColor, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` })}></span></>) : null}</>) : null}{V.showEyebrow ? (<><span className="pf-t-eyebrow" style={s({ fontWeight: '500', fontSize: '15px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#F2C9A0', textAlign: 'right', marginLeft: 'auto' })}>{V.eyebrow}</span></>) : null}</div><div style={s({ flex: '1 1 auto', minHeight: '0', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '20px' })}>{V.nuit3.map((p, k20) => (<Fragment key={k20}><div style={s({ minHeight: '0', position: 'relative', background: '#EAE4DC', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' })}>{V.showBadges ? (<><span style={s({ position: 'absolute', top: '12px', left: '12px', zIndex: '2', minWidth: '30px', height: '30px', padding: '0 9px', borderRadius: '999px', background: 'rgba(35,34,32,0.82)', color: '#FFFFFF', fontFamily: "'Studio Gotham'", fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' })}>{p.n}</span></>) : null}{p.cut ? (<><img src={p.src} alt="" style={s({ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: p.zt, transformOrigin: p.zo })} /></>) : null}{p.full ? (<><img src={p.src} alt="" style={s({ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', transform: p.zt, transformOrigin: p.zo })} /></>) : null}</div></Fragment>))}</div><div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flex: '0 0 auto' })}><div style={s({ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', minWidth: '0', flex: '1 1 auto' })}>{V.showTitle ? (<><h1 className="pf-t-title" style={s({ fontFamily: "'Studio Vank','Studio Gotham'", fontWeight: '400', fontSize: '72px', lineHeight: '0.98', textTransform: 'uppercase', margin: '0', color: '#FFFFFF', textWrap: 'balance' })}>{V.title}</h1></>) : null}{V.showPhrase ? (<><p className="pf-t-phrase" style={s({ fontFamily: "var(--pf,'Studio Playwrite'),'Studio Gotham'", fontWeight: '300', fontSize: '22px', lineHeight: '1.45', color: 'var(--pc,#F2C9A0)', margin: '0', maxWidth: '30ch', textWrap: 'pretty' })}>{V.phrase}</p></>) : null}{V.showSite ? (<><p className="pf-t-site" style={s({ margin: '4px 0 0', fontWeight: '500', fontSize: '18px', letterSpacing: '0.14em', color: '#B8B2A8' })}>{V.site}</p></>) : null}</div>{V.showPrice ? (<><div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flex: '0 0 auto' })}><div style={s({ padding: '0 31px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-price" style={s({ fontWeight: '300', fontSize: '72px', lineHeight: '1', letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap' })}>{V.price}<span style={s({ fontSize: '0.5em', fontWeight: '500', verticalAlign: '0.6em', marginLeft: '5px' })}>€</span></div><div className="pf-t-unit" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#B8B2A8' })}>{V.unit}</div></div>{V.showPromo ? (<><div style={s({ display: 'flex', alignItems: 'center' })}><span style={s({ width: '1.5px', height: '77px', background: '#F2C9A0', display: 'block' })}></span><div style={s({ padding: '0 0 0 31px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })}><div className="pf-t-promo" style={s({ fontWeight: '300', fontSize: '72px', lineHeight: '1', color: '#F2C9A0', whiteSpace: 'nowrap' })}>{V.promo}</div><div className="pf-t-promosub" style={s({ fontWeight: '400', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#B8B2A8' })}>{V.promoSub}</div></div></div></>) : null}</div></>) : null}</div></div></>) : null}
{V.illusImg ? (<><img src={V.illusSrc} alt="" style={s({ position: 'absolute', left: `${V.illusX}%`, top: `${V.illusY}%`, width: `${V.illusW}px`, height: 'auto', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: '6' })} /></>) : null}
{V.etiquettes.map((et, k21) => (<Fragment key={k21}><div className={et.cls} onPointerDown={et.down} onDoubleClick={et.edit} title={et.tip} style={s({ position: 'absolute', left: `${et.x}%`, top: `${et.y}%`, transform: `translate(-50%,-50%) rotate(${et.rot}deg)`, zIndex: '7', cursor: et.cursor, touchAction: 'none', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: `${et.gap}px`, background: et.bg, color: et.fg, borderRadius: et.radius, padding: et.pad, width: et.w, height: et.h, boxSizing: 'border-box', outline: et.outline, outlineOffset: '8px' })}><span style={s({ fontFamily: et.font, fontWeight: et.weight, fontSize: `${et.size}px`, lineHeight: '1.02', textTransform: et.tt, letterSpacing: et.ls, whiteSpace: 'pre' })}>{et.txt}</span>{et.hasSous ? (<><span style={s({ fontFamily: "'Studio Gotham'", fontWeight: '500', fontSize: `${et.sousSize}px`, lineHeight: '1.1', letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'pre' })}>{et.sous}</span></>) : null}{et.canDel ? (<><span className="pf-x" onPointerDown={et.stop} onClick={et.del} title="Effacer ce texte" style={s({ position: 'absolute', top: '-26px', right: '-26px', width: '52px', height: '52px', borderRadius: '50%', background: '#232220', color: '#FFFFFF', border: '3px solid #FFFFFF', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', fontFamily: "'Studio Gotham'", fontWeight: '400', fontSize: '34px', lineHeight: '1', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' })}>×</span></>) : null}</div></Fragment>))}
{V.illusMask ? (<><div style={s({ position: 'absolute', left: `${V.illusX}%`, top: `${V.illusY}%`, width: `${V.illusW}px`, aspectRatio: V.illusRatio, transform: 'translate(-50%,-50%)', background: V.illusColor, WebkitMask: `url('${V.illusSrc}') center/contain no-repeat`, mask: `url('${V.illusSrc}') center/contain no-repeat`, pointerEvents: 'none', zIndex: '6' })}></div></>) : null}
    </>
  )
}
