import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as api from '../../lib/api/module'
import { CATALOGUE_RULE_DEFAULT } from '../../lib/api/module'
import type { CatalogueCharter, CatalogueCharterShop, CatalogueLang } from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import { openPrintWindow } from '../../lib/print'
import { qrPath } from '../../lib/qr'
import { fontFaces } from '../brochure/Pages'
import { BLEED, MARKS } from './CataloguePages'
import { MediaPicker } from './MediaPicker'
import CARD_CSS from './business-card-pages.css?inline'
import './catalogue.css'
import './business-cards.css'
import Erreur from '../../components/Erreur'

/**
 * Les cartes de visite des boutiques (27/11/2026, Sam : « dans la gestion des imprimés : rajouter pour chaque magasin
 * les cartes de visite ») : un onglet des Imprimés, une carte par boutique.
 *
 * Rien n'est saisi ici : la carte imprime ce que la dernière page des catalogues imprime déjà pour la boutique — son nom,
 * son adresse, ses téléphones, son e-mail et ses horaires (ERP et TFBuddy, ou saisis dans les pages de la marque ›
 * Dernière page), le QR de son webshop ou de Google Maps. Un champ vide n'imprime rien ; ce qui manque est dit sous la
 * carte, et se complète à un seul endroit, les pages de la marque.
 *
 * Le logo est celui du magasin (27/11/2026, Sam : « il faut utiliser le logo du magasin ») : celui de la charte n'y est
 * jamais mis à sa place. Une boutique sans logo n'a pas de carte imprimable ; son logo se choisit sous la carte (le même
 * champ que dans les pages de la marque › Dernière page, `logoMediaId`).
 *
 * 85 × 55 mm (le format européen). Deux sorties, par le moteur des imprimés (`lib/print.ts`) :
 *   - la planche A4 pour l'imprimante du magasin : 10 cartes par feuille, la feuille des rectos puis celle des versos,
 *     à imprimer en recto verso (bord long) ; la grille est centrée, donc le verso tombe sous le recto ;
 *   - le PDF de l'imprimeur : par boutique, le recto puis le verso, 3 mm de fond perdu et les traits de coupe. Une carte
 *     dont le texte dépasse n'y entre pas (le leaflet fait de même avec ses points bloquants) : la planche la garde.
 * Une carte sans le logo du magasin n'entre dans aucune des deux.
 */

/** La carte de visite européenne, en millimètres. */
export const CARD_MM = { w: 85, h: 55 }
/** La planche A4 de l'imprimante : 2 × 5 cartes bord à bord, centrées. */
const A4 = { w: 210, h: 297 }
const PLATE = { cols: 2, rows: 5 }
const PLATE_LEFT = (A4.w - CARD_MM.w * PLATE.cols) / 2
const PLATE_TOP = (A4.h - CARD_MM.h * PLATE.rows) / 2

const MM = 96 / 25.4
const PREVIEW_ZOOM = 1.15

export type CardSide = 'recto' | 'verso'
/**
 * Le recto : le logo du magasin dans ses couleurs, sur le papier ; ou sur la couleur principale de la charte, où il passe
 * en blanc, comme sur les couvertures des catalogues.
 */
export type CardRecto = 'couleur' | 'papier'
/** Le QR du verso : le webshop de la boutique, son adresse sur Google Maps, ou aucun. */
export type CardQr = 'webshop' | 'maps' | 'aucun'
export interface CardOptions {
  lang: CatalogueLang
  recto: CardRecto
  qr: CardQr
  hours: boolean
  /** Le nom de la boutique sous le logo (à retirer quand le logo du magasin le porte déjà). */
  name: boolean
}
type CardCharter = Pick<CatalogueCharter, 'colors'>

const mm = (value: number): string => `${value}mm`
const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** Les horaires imprimés : ceux saisis pour la boutique, sinon ceux de l'ERP ; en néerlandais, le français à défaut. */
function hoursOf(shop: CatalogueCharterShop, lang: CatalogueLang): string {
  if (lang === 'nl') return shop.openingHoursNl || shop.openingHoursFr || shop.hoursNl || shop.hours
  return shop.openingHoursFr || shop.hours
}

/**
 * La ligne des horaires : ceux de l'ERP ne sont qu'une plage (« 6h00–18h30 ») et prennent « Ouvert », comme à la
 * dernière page des catalogues ; ceux saisis pour la boutique (« Lun – ven : 7h – 18h30 ») s'impriment tels quels.
 */
function hoursLine(shop: CatalogueCharterShop, lang: CatalogueLang): string {
  const own = lang === 'nl' ? shop.openingHoursNl || shop.openingHoursFr : shop.openingHoursFr
  if (own) return own
  const erp = hoursOf(shop, lang)
  return erp ? `${lang === 'nl' ? 'Open' : 'Ouvert'} ${erp}` : ''
}

/** L'adresse du webshop telle qu'elle s'imprime : sans « https:// », sans paramètre (« ?shop=2 »), sans « / » final. */
export function webLabel(url: string | null): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function qrOf(shop: CatalogueCharterShop, options: CardOptions): { url: string; label: string } | null {
  const nl = options.lang === 'nl'
  if (options.qr === 'webshop' && shop.qrUrl) return { url: shop.qrUrl, label: nl ? 'Bestel online' : 'Commander en ligne' }
  if (options.qr === 'maps' && shop.mapsUrl) return { url: shop.mapsUrl, label: nl ? 'Kom langs' : 'Venir au magasin' }
  return null
}

/** Les lignes du verso, dans l'ordre : adresse, téléphones, e-mail, horaires, puis l'adresse du webshop en pied. */
function cardLines(shop: CatalogueCharterShop, options: CardOptions): Array<{ key: string; text: string }> {
  const lines = [
    { key: 'address', text: shop.address },
    { key: 'phone', text: [shop.phone, shop.phone2].filter(Boolean).join(' · ') },
    { key: 'email', text: shop.email },
    { key: 'hours', text: options.hours ? hoursLine(shop, options.lang) : '' },
    { key: 'web', text: webLabel(shop.qrUrl) },
  ]
  return lines.filter((line) => line.text.trim() !== '')
}

/** Ce qui manque à la carte d'une boutique, hors logo, tel qu'on le dit sous l'aperçu (un vide n'imprime rien). */
function cardMissing(shop: CatalogueCharterShop, options: CardOptions): string[] {
  const out: string[] = []
  if (!shop.address) out.push('adresse')
  if (!shop.phone && !shop.phone2) out.push('téléphone')
  if (!shop.email) out.push('e-mail')
  if (options.hours && !hoursOf(shop, options.lang)) out.push('horaires')
  if (options.qr === 'webshop' && !shop.qrUrl) out.push('QR (adresse du webshop)')
  if (options.qr === 'maps' && !shop.mapsUrl) out.push('QR (Google Maps)')
  return out
}

function Qr({ url }: { url: string }) {
  const path = qrPath(url)
  return (
    <svg className="bc-qr" viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" aria-label={url}>
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

/** Une face, fond perdu compris (91 × 61 mm) : le format fini est à `--b` du bord. */
export function CardFace({ shop, charter, side, options, textRef }: {
  shop: CatalogueCharterShop
  charter: CardCharter
  side: CardSide
  options: CardOptions
  /** L'aperçu y mesure le texte du verso : il ne doit pas dépasser de la carte. */
  textRef?: (node: HTMLDivElement | null) => void
}) {
  const colors = charter.colors
  const style = {
    width: mm(CARD_MM.w + BLEED * 2),
    height: mm(CARD_MM.h + BLEED * 2),
    '--b': mm(BLEED),
    '--p': colors.primary,
    '--s': colors.secondary,
    '--a': colors.accent,
    '--i': colors.ink,
    '--ab': colors.rule ?? CATALOGUE_RULE_DEFAULT,
  } as CSSProperties
  // Le logo du magasin, jamais celui de la charte à sa place ; sur la couleur, il passe en blanc (comme en couverture).
  // Sans lui, l'aperçu le dit à sa place (une telle carte ne s'imprime pas).
  const onColor = side === 'recto' && options.recto === 'couleur'
  const qr = qrOf(shop, options)
  return (
    <div className={`bc-face bc-face--${side}${side === 'recto' ? ` bc-face--${options.recto}` : ''}`} style={style} lang={options.lang}>
      <div className="bc-trim">
        {side === 'recto' ? (
          <div className={`bc-recto${options.name ? '' : ' bc-recto--alone'}`}>
            {shop.logoUrl ? (
              <img className={`bc-logo${onColor ? ' bc-logo--white' : ''}`} src={shop.logoUrl} alt="" />
            ) : (
              <div className="bc-logo-missing">Logo du magasin à choisir</div>
            )}
            {options.name ? (
              <>
                <div className="bc-recto__rule" />
                <div className="bc-recto__shop">{shop.name}</div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="bc-verso">
            <div className="bc-verso__text" ref={textRef}>
              <div className="bc-verso__who">L’Atelier By — {shop.name}</div>
              <div className="bc-verso__rule" />
              {cardLines(shop, options).map((line) => (
                <p key={line.key} className={`bc-line bc-line--${line.key}`}>
                  {line.text}
                </p>
              ))}
            </div>
            {qr ? (
              <div className="bc-verso__qr">
                <Qr url={qr.url} />
                <div className="bc-verso__qrlabel">{qr.label}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

/** Les traits de coupe d'une ou plusieurs cartes : aux abscisses `xs` et aux ordonnées `ys`, hors de la zone `area`. */
function CropMarks({ total, xs, ys, area, gap }: {
  total: { w: number; h: number }
  xs: number[]
  ys: number[]
  area: { x: number; y: number; w: number; h: number }
  /** Le blanc entre le trait et la zone coupée (le fond perdu, sur une carte seule). */
  gap: number
}) {
  const reachTop = area.y - gap
  const reachBottom = area.y + area.h + gap
  const reachLeft = area.x - gap
  const reachRight = area.x + area.w + gap
  const len = 5
  return (
    <svg className="bc-marks" viewBox={`0 0 ${total.w} ${total.h}`} width={mm(total.w)} height={mm(total.h)}>
      <g stroke="#000" strokeWidth="0.25" fill="none">
        {xs.map((x) => (
          <g key={`x${x}`}>
            <line x1={x} y1={Math.max(0, reachTop - len)} x2={x} y2={reachTop} />
            <line x1={x} y1={reachBottom} x2={x} y2={Math.min(total.h, reachBottom + len)} />
          </g>
        ))}
        {ys.map((y) => (
          <g key={`y${y}`}>
            <line x1={Math.max(0, reachLeft - len)} y1={y} x2={reachLeft} y2={y} />
            <line x1={reachRight} y1={y} x2={Math.min(total.w, reachRight + len)} y2={y} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/** Une carte pour l'imprimeur : 85 × 55 mm, 3 mm de fond perdu, les traits de coupe (105 × 75 mm). */
function PrinterSheet(props: { shop: CatalogueCharterShop; charter: CardCharter; side: CardSide; options: CardOptions }) {
  const offset = BLEED + MARKS
  const total = { w: CARD_MM.w + offset * 2, h: CARD_MM.h + offset * 2 }
  return (
    <div className="bc-sheet" style={{ width: mm(total.w), height: mm(total.h) }}>
      <div className="bc-sheet__face" style={{ left: mm(offset - BLEED), top: mm(offset - BLEED) }}>
        <CardFace {...props} />
      </div>
      <CropMarks total={total} xs={[offset, offset + CARD_MM.w]} ys={[offset, offset + CARD_MM.h]} area={{ x: offset, y: offset, w: CARD_MM.w, h: CARD_MM.h }} gap={BLEED} />
    </div>
  )
}

/** La planche A4 : 10 fois la même face, bord à bord, et les traits de coupe autour de la grille. */
function PlateSheet(props: { shop: CatalogueCharterShop; charter: CardCharter; side: CardSide; options: CardOptions }) {
  const cells = Array.from({ length: PLATE.cols * PLATE.rows }, (_, index) => ({ col: index % PLATE.cols, row: Math.floor(index / PLATE.cols) }))
  const xs = Array.from({ length: PLATE.cols + 1 }, (_, col) => PLATE_LEFT + col * CARD_MM.w)
  const ys = Array.from({ length: PLATE.rows + 1 }, (_, row) => PLATE_TOP + row * CARD_MM.h)
  // Sous la grille, le fond de la face : sans lui, la jointure de deux cartes laisse un filet clair (l'anticrénelage).
  const ground = props.side === 'recto' && props.options.recto === 'couleur' ? props.charter.colors.primary : props.charter.colors.secondary
  return (
    <div className="bc-sheet" style={{ width: mm(A4.w), height: mm(A4.h) }}>
      <div className="bc-ground" style={{ left: mm(PLATE_LEFT), top: mm(PLATE_TOP), width: mm(CARD_MM.w * PLATE.cols), height: mm(CARD_MM.h * PLATE.rows), background: ground }} />
      {cells.map(({ col, row }) => (
        <div key={`${col}-${row}`} className="bc-cell" style={{ left: mm(PLATE_LEFT + col * CARD_MM.w), top: mm(PLATE_TOP + row * CARD_MM.h), width: mm(CARD_MM.w), height: mm(CARD_MM.h) }}>
          <CardFace {...props} />
        </div>
      ))}
      <CropMarks total={A4} xs={xs} ys={ys} area={{ x: PLATE_LEFT, y: PLATE_TOP, w: CARD_MM.w * PLATE.cols, h: CARD_MM.h * PLATE.rows }} gap={1} />
    </div>
  )
}

/** La feuille des cartes et les polices, pour l'aperçu et la fenêtre d'impression. */
export function businessCardCss(): string {
  return `${fontFaces()}\n${CARD_CSS}`
}

/** L'aperçu d'une face, au format fini (le fond perdu rogné), à l'échelle de l'écran. */
function Preview({ children }: { children: ReactNode }) {
  const zoom = PREVIEW_ZOOM
  return (
    <div className="bcv-face" style={{ width: CARD_MM.w * MM * zoom, height: CARD_MM.h * MM * zoom }}>
      <span style={{ zoom }}>
        <span className="bcv-face__trim" style={{ width: mm(CARD_MM.w), height: mm(CARD_MM.h) }}>
          <span className="bcv-face__bleed" style={{ left: mm(-BLEED), top: mm(-BLEED) }}>
            {children}
          </span>
        </span>
      </span>
    </div>
  )
}

/** Une boutique : sa carte (recto, verso), son logo, ce qui y manque, et si elle part à l'impression. */
function ShopCard({ shop, charter, options, picked, onPick, onOverflow, onChooseLogo, logoSave }: {
  shop: CatalogueCharterShop
  charter: CardCharter
  options: CardOptions
  picked: boolean
  onPick: (on: boolean) => void
  onOverflow: (over: boolean) => void
  /** Ouvre la médiathèque pour le logo du magasin. */
  onChooseLogo: () => void
  /** L'enregistrement du logo de CETTE boutique, s'il est en cours ou a échoué. */
  logoSave: { saving: boolean; error: string | null } | null
}) {
  const text = useRef<HTMLDivElement | null>(null)
  const [over, setOver] = useState(false)
  const lines = cardLines(shop, options).map((line) => line.text).join('|')
  // Le texte du verso tient-il dans la carte ? Mesuré quand les polices sont là (une police de repli est plus étroite).
  useLayoutEffect(() => {
    let live = true
    const measure = () => {
      const node = text.current
      if (!node || !live) return
      const value = node.scrollHeight > node.clientHeight + 1
      setOver(value)
      onOverflow(value)
    }
    measure()
    void document.fonts.ready.then(measure)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, options.qr, options.lang])
  const missing = cardMissing(shop, options)
  return (
    <section className={`card bcv-shop${picked ? '' : ' bcv-shop--off'}`}>
      <div className="bcv-shop__head">
        <label className="bro-check bcv-shop__pick">
          <input type="checkbox" checked={picked} onChange={(event) => onPick(event.target.checked)} />
          <b>{shop.name}</b>
        </label>
        {shop.error ? <span className="bro-tag">TFBuddy : {shop.error}</span> : null}
        <span className="catv-grow" />
        <button type="button" className={`btn btn--sm${shop.logoUrl ? '' : ' btn--primary'}`} disabled={logoSave?.saving} onClick={onChooseLogo} title="Une image de la médiathèque, du réseau ou de la boutique : le même logo que dans ses catalogues">
          {logoSave?.saving ? 'Enregistrement…' : shop.logoUrl ? 'Changer le logo du magasin' : 'Choisir le logo du magasin'}
        </button>
      </div>
      <div className="bcv-shop__faces">
        <figure className="bcv-shop__side">
          <Preview>
            <CardFace shop={shop} charter={charter} side="recto" options={options} />
          </Preview>
          <figcaption>Recto</figcaption>
        </figure>
        <figure className="bcv-shop__side">
          <Preview>
            <CardFace shop={shop} charter={charter} side="verso" options={options} textRef={(node) => { text.current = node }} />
          </Preview>
          <figcaption>Verso</figcaption>
        </figure>
      </div>
      {logoSave?.error ? <Erreur>Le logo n’a pas été enregistré : {logoSave.error}</Erreur> : null}
      {!shop.logoUrl ? (
        <p className="catv-warn">Pas de logo du magasin : sa carte ne s’imprime pas sans lui (celui de la charte n’est pas mis à sa place).</p>
      ) : null}
      {over ? (
        <p className="catv-warn">
          Le texte dépasse de la carte : raccourcissez les horaires (pages de la marque › Dernière page) ou décochez « Horaires ». La planche A4 garde la carte ; le PDF de l’imprimeur l’écarte.
        </p>
      ) : null}
      {missing.length ? (
        <p className="bcv-shop__missing">Inconnu, donc non imprimé : {missing.join(', ')}.</p>
      ) : shop.logoUrl ? (
        <p className="bcv-shop__ok">Tout ce que la carte imprime est connu.</p>
      ) : null}
    </section>
  )
}

export default function BusinessCardsView({ onEditShops }: { onEditShops?: () => void }) {
  const charter = useAsync(() => api.getCatalogueCharter(), [])
  const checks = useAsync(() => api.getCatalogueCharterChecks(), [])
  const [lang, setLang] = useState<CatalogueLang>('fr')
  // Le papier d'abord : le logo du magasin y garde ses couleurs.
  const [recto, setRecto] = useState<CardRecto>('papier')
  const [qr, setQr] = useState<CardQr>('webshop')
  const [hours, setHours] = useState(true)
  const [name, setName] = useState(true)
  // Les boutiques dont le logo vient d'être choisi ici (la réponse du serveur remplace la ligne lue).
  const [saved, setSaved] = useState<Record<number, CatalogueCharterShop>>({})
  const [picking, setPicking] = useState<number | null>(null)
  const [logoSave, setLogoSave] = useState<{ id: number; saving: boolean; error: string | null } | null>(null)
  // Les boutiques écartées de l'impression (toutes partent par défaut).
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set())
  const [overflowing, setOverflowing] = useState<Set<number>>(() => new Set())
  const [printNote, setPrintNote] = useState<{ error: boolean; text: string } | null>(null)

  const options: CardOptions = { lang, recto, qr, hours, name }
  const shops = (checks.data?.shops ?? []).map((shop) => saved[shop.id] ?? shop)
  const chosen = shops.filter((shop) => !excluded.has(shop.id))
  const loaded = charter.data ? { colors: charter.data.colors } : null

  /** Le logo du magasin, choisi dans la médiathèque : enregistré tout de suite, comme dans les pages de la marque. */
  function saveLogo(id: number, mediaId: number) {
    setLogoSave({ id, saving: true, error: null })
    api.saveCatalogueShop(id, { logoMediaId: mediaId }).then(
      (row) => {
        setSaved((current) => ({ ...current, [row.id]: row }))
        setLogoSave(null)
      },
      (cause: unknown) => setLogoSave({ id, saving: false, error: message(cause) }),
    )
  }

  function pick(id: number, on: boolean) {
    setExcluded((current) => {
      const next = new Set(current)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function flag(id: number, over: boolean) {
    setOverflowing((current) => {
      if (current.has(id) === over) return current
      const next = new Set(current)
      if (over) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function print(kind: 'plate' | 'printer') {
    setPrintNote(null)
    if (!loaded) return
    const printer = kind === 'printer'
    // Sans le logo du magasin, pas de carte ; pour l'imprimeur, pas de texte qui dépasse.
    const noLogo = chosen.filter((shop) => !shop.logoUrl)
    const tooLong = printer ? chosen.filter((shop) => shop.logoUrl && overflowing.has(shop.id)) : []
    const kept = chosen.filter((shop) => shop.logoUrl && !(printer && overflowing.has(shop.id)))
    const left = [
      noLogo.length ? `sans logo du magasin : ${noLogo.map((shop) => shop.name).join(', ')}` : null,
      tooLong.length ? `le texte dépasse : ${tooLong.map((shop) => shop.name).join(', ')}` : null,
    ].filter(Boolean).join(' ; ')
    if (!chosen.length) {
      setPrintNote({ error: true, text: 'Cochez au moins une boutique.' })
      return
    }
    if (!kept.length) {
      setPrintNote({ error: true, text: `Aucune carte cochée ne peut partir (${left}) : voir sous les cartes.` })
      return
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() =>
      root.render(
        <>
          {kept.flatMap((shop) =>
            (['recto', 'verso'] as const).map((side) =>
              printer
                ? <PrinterSheet key={`${shop.id}-${side}`} shop={shop} charter={loaded} side={side} options={options} />
                : <PlateSheet key={`${shop.id}-${side}`} shop={shop} charter={loaded} side={side} options={options} />,
            ),
          )}
        </>,
      ),
    )
    const markup = container.innerHTML
    root.unmount()
    const offset = BLEED + MARKS
    const failure = openPrintWindow({
      title: ['Cartes de visite', kept.length === 1 ? kept[0].name : `${kept.length} boutiques`, lang.toUpperCase(), printer ? 'imprimeur' : 'planche A4'].join(' – '),
      markup,
      css: businessCardCss(),
      size: printer ? { w: CARD_MM.w + offset * 2, h: CARD_MM.h + offset * 2 } : A4,
      pageClass: 'bc-sheet',
    })
    if (failure) setPrintNote({ error: true, text: failure })
    else if (kept.length < chosen.length) {
      setPrintNote({ error: true, text: `Écartée(s) ${printer ? 'du PDF de l’imprimeur' : 'de la planche'} — ${left}.` })
    } else {
      setPrintNote({
        error: false,
        text: printer
          ? 'Le PDF s’ouvre dans un nouvel onglet : par boutique, le recto puis le verso, 3 mm de fond perdu et traits de coupe. Choisissez « Enregistrer au format PDF ».'
          : 'La planche s’ouvre dans un nouvel onglet : par boutique, une feuille de rectos puis une de versos. Imprimez en recto verso, bord long, à 100 % (sans « ajuster à la page »).',
      })
    }
  }

  const error = charter.error ?? checks.error
  return (
    <div className="catv bcv">
      <style>{businessCardCss()}</style>
      <p className="catv-note">
        Une carte par boutique, 85 × 55 mm : au recto le logo du magasin, au verso ses coordonnées et un QR. Les coordonnées
        viennent de la fiche de la boutique (ERP, TFBuddy) et de ce qui est saisi dans les pages de la marque › Dernière page :
        un champ vide n’imprime rien. Le logo se choisit sous chaque carte ; sans lui, la carte ne s’imprime pas.
      </p>

      <div className="catv-toolbar">
        <span className="bro-seg" role="group" aria-label="Langue">
          {([['fr', 'FR'], ['nl', 'NL']] as const).map(([value, label]) => (
            <button key={value} type="button" className={lang === value ? 'is-on' : ''} onClick={() => setLang(value)}>
              {label}
            </button>
          ))}
        </span>
        <span className="bro-seg" role="group" aria-label="Recto">
          {([['papier', 'Recto papier', 'Le logo du magasin dans ses couleurs, sur le papier de la charte'], ['couleur', 'Recto couleur', 'Le logo du magasin en blanc sur la couleur principale, comme sur les couvertures des catalogues']] as const).map(([value, label, title]) => (
            <button key={value} type="button" title={title} className={recto === value ? 'is-on' : ''} onClick={() => setRecto(value)}>
              {label}
            </button>
          ))}
        </span>
        <span className="bro-seg" role="group" aria-label="QR code du verso">
          {([['webshop', 'QR webshop'], ['maps', 'QR Google Maps'], ['aucun', 'Sans QR']] as const).map(([value, label]) => (
            <button key={value} type="button" className={qr === value ? 'is-on' : ''} onClick={() => setQr(value)}>
              {label}
            </button>
          ))}
        </span>
        <label className="bro-check bcv-toggle">
          <input type="checkbox" checked={hours} onChange={(event) => setHours(event.target.checked)} />
          Horaires
        </label>
        <label className="bro-check bcv-toggle" title="À décocher quand le logo du magasin porte déjà son nom">
          <input type="checkbox" checked={name} onChange={(event) => setName(event.target.checked)} />
          Nom sous le logo
        </label>
        <span className="catv-grow" />
        {onEditShops ? (
          <button type="button" className="btn" onClick={onEditShops} title="Téléphone 2, webshop direct, horaires, lien Google Maps, logo : pages de la marque › Dernière page">
            ✎ Coordonnées des boutiques
          </button>
        ) : null}
      </div>

      {/* Ce qui part à l'impression, et les deux sorties. */}
      <div className="catv-toolbar">
        {loaded && shops.length ? (
          <span className="bcv-count">
            {chosen.length} carte{chosen.length > 1 ? 's' : ''} à imprimer sur {shops.length} boutique{shops.length > 1 ? 's' : ''}
            {shops.length > 1 ? (
              <>
                {' · '}
                <button type="button" className="linklike" onClick={() => setExcluded(new Set())}>
                  toutes
                </button>
                {' · '}
                <button type="button" className="linklike" onClick={() => setExcluded(new Set(shops.map((shop) => shop.id)))}>
                  aucune
                </button>
              </>
            ) : null}
          </span>
        ) : null}
        <span className="catv-grow" />
        <button type="button" className="btn" disabled={!loaded || !shops.length} onClick={() => print('plate')} title="10 cartes par feuille A4, à imprimer en recto verso sur l’imprimante du magasin, puis à couper">
          ⎙ Planche A4 · mon imprimante
        </button>
        <button type="button" className="btn btn--primary" disabled={!loaded || !shops.length} onClick={() => print('printer')} title="85 × 55 mm, 3 mm de fond perdu, traits de coupe : le fichier à envoyer à l’imprimeur">
          PDF imprimeur
        </button>
      </div>

      {printNote ? <p className={printNote.error ? 'catv-warn' : 'catv-note'}>{printNote.text}</p> : null}
      {error ? <Erreur>{error}</Erreur> : null}
      {charter.data?.publication?.draftChanged ? (
        <p className="catv-note">La charte a des changements non publiés : les cartes montrent déjà son logo et ses couleurs en cours.</p>
      ) : null}
      {(checks.loading && !checks.data) || (charter.loading && !charter.data) ? <p className="muted">Lecture des boutiques…</p> : null}
      {checks.data && !shops.length ? <p className="muted">Aucune boutique reliée à la caisse.</p> : null}

      {loaded && shops.length ? (
        <div className="bcv-list">
          {shops.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              charter={loaded}
              options={options}
              picked={!excluded.has(shop.id)}
              onPick={(on) => pick(shop.id, on)}
              onOverflow={(over) => flag(shop.id, over)}
              onChooseLogo={() => setPicking(shop.id)}
              logoSave={logoSave?.id === shop.id ? logoSave : null}
            />
          ))}
        </div>
      ) : null}

      {picking !== null ? (
        <MediaPicker
          title="Logo du magasin"
          onClose={() => setPicking(null)}
          onPick={(chosenAsset) => {
            saveLogo(picking, Number(chosenAsset.id))
            setPicking(null)
          }}
        />
      ) : null}
    </div>
  )
}
