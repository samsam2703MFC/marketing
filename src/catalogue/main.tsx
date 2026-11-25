import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as api from '../lib/api/module'
import type { CatalogueDocument, CatalogueLang } from '../lib/api/module'
import { printWhenReady } from '../lib/print'
import { qrPath } from '../lib/qr'
import { CataloguePage, CatalogueSheet, FORMAT_MM, catalogueCss, sheetSize } from '../views/catalogue/CataloguePages'
import type { CatalogueSheetMode } from '../views/catalogue/CataloguePages'
import { OrderFormSheets, orderFormCss, orderFormSize } from '../views/catalogue/OrderForm'
import type { OrderForm } from '../lib/api/module'

/**
 * Les pages publiques d'un catalogue, servies par le Marketing sous `/marketing/catalogue/` — aucune session :
 *
 *  - `?t=…` : le lien d'IMPRESSION signé (48 h) que le dashboard magasin demande (`…/print-links`). Les pages, puis la
 *    boîte d'impression : « Enregistrer au format PDF ». `&mode=` : `proof` (défaut, format fini — aussi le « PDF léger à
 *    partager »), `printer` (fond perdu 3 mm et traits de coupe, pour l'imprimeur), `livret` (sur mon imprimante :
 *    feuilles A4 paysage, 2 pages A5 par face, dans l'ordre d'un livret plié au milieu).
 *  - `?t=…&affiche=A4|A3&l=…` : l'AFFICHE du magasin (« Notre catalogue de Noël · Scannez pour le feuilleter ») avec le
 *    QR du catalogue en ligne (le lien permanent `l`).
 *  - `?t=…&bon=fr|nl|fr,nl` : le BON DE COMMANDE de la même version (feuille A4 ; FR + NL : un bon par langue, à la
 *    suite) ; `&mode=printer` : avec les traits de coupe, pour l'imprimeur.
 *  - `?l=…` : le CATALOGUE EN LIGNE, par son lien permanent (QR, affiche) : à feuilleter, lecture seule, toujours la
 *    dernière version ; FR | NL.
 */

const params = new URLSearchParams(window.location.search)
const MM = 96 / 25.4

/** L'adresse du catalogue en ligne d'un lien permanent (celle que le QR de l'affiche ouvre). */
const onlineUrl = (link: string): string => `${window.location.origin}${window.location.pathname}?l=${encodeURIComponent(link)}`

function Qr({ url, mm }: { url: string; mm: number }) {
  const path = qrPath(url)
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} width={`${mm}mm`} height={`${mm}mm`} shapeRendering="crispEdges" aria-label={url}>
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

const BASE_CSS = `html,body{margin:0;padding:0}
@media screen{body{background:#8a857e}#root{display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}}
.cat-print__bar{position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:10px 16px;border-radius:0 0 12px 12px;background:#fff;font:13px system-ui,sans-serif}
.cat-print__bar button{padding:7px 16px;border:1px solid #8D1D2C;border-radius:8px;background:#8D1D2C;color:#fff;font:inherit;cursor:pointer}
.cat-print__msg{font:14px system-ui,sans-serif;padding:24px;color:#1c1a17;background:#fff}
@media print{.cat-print__bar{display:none}}`

/** Le bon de commande d'un lien d'impression : une ou deux langues, puis la boîte d'impression. */
function OrderPage({ token }: { token: string }) {
  const langs = (params.get('bon') ?? 'fr').split(',').filter((l): l is CatalogueLang => l === 'fr' || l === 'nl')
  const mode = params.get('mode') === 'printer' ? 'printer' : 'proof'
  const [forms, setForms] = useState<OrderForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = langs.join(',')
  useEffect(() => {
    Promise.all((key ? key.split(',') : ['fr']).map((l) => api.getCataloguePrintOrderForm(token, l as CatalogueLang))).then(
      (list) => {
        setForms(list)
        document.title = `${list[0].labels.title} – ${list[0].catalogue.title}${list[0].version.shop ? ` – ${list[0].version.shop.name}` : ''} – ${key.toUpperCase().replace(',', '+')}`
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }, [token, key])
  useEffect(() => {
    if (forms && params.get('imprimer') !== '0') printWhenReady(window)
  }, [forms])
  if (error) return <p className="cat-print__msg">{error}</p>
  if (!forms) return <p className="cat-print__msg">Composition du bon de commande…</p>
  const size = orderFormSize(mode)
  // `imprimer=0` : l'aperçu dans un cadre (dashboard) — ni barre, ni marge grise.
  const apercu = params.get('imprimer') === '0'
  return (
    <>
      <style>{`${orderFormCss()}\n@page{size:${size.w}mm ${size.h}mm;margin:0}.bdc-sheet{break-after:page}.bdc-sheet:last-child{break-after:auto}\n${BASE_CSS}${apercu ? '\n@media screen{body{background:#EDE7DE}#root{gap:4mm;padding:0}}.cat-print__bar{display:none}' : ''}`}</style>
      <div className="cat-print__bar">
        <span>
          {forms[0].labels.title} · {forms[0].catalogue.title} · {forms.map((f) => f.version.lang.toUpperCase()).join(' + ')} · {mode === 'printer' ? 'PDF imprimeur (traits de coupe)' : 'A4'}
        </span>
        <button type="button" onClick={() => window.print()}>
          Imprimer · Enregistrer en PDF
        </button>
      </div>
      <OrderFormSheets forms={forms} mode={mode} />
    </>
  )
}

function PrintPage() {
  const token = params.get('t') ?? ''
  const link = params.get('l') ?? ''
  const poster = params.get('affiche')
  const mode = (params.get('mode') ?? 'proof') as CatalogueSheetMode | 'livret'
  const [lang, setLang] = useState<CatalogueLang>(params.get('lang') === 'nl' ? 'nl' : 'fr')
  const [doc, setDoc] = useState<CatalogueDocument | null>(null)
  const [error, setError] = useState<string | null>(token || link ? null : 'Lien du catalogue incomplet.')
  const online = !token && link !== ''

  useEffect(() => {
    if (!token && !link) return
    const read = token ? api.getCataloguePrint(token) : api.getCatalogueLink(link, lang)
    read.then(
      (one) => {
        setDoc(one)
        document.title = online ? `${one.catalogue.title} — L’Atelier By` : `${one.catalogue.title} – ${one.catalogue.format}`
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }, [token, link, lang, online])

  useEffect(() => {
    if (doc && !online && params.get('imprimer') !== '0') printWhenReady(window)
  }, [doc, online])

  if (error) return <p className="cat-print__msg">{error}</p>
  if (!doc) return <p className="cat-print__msg">Composition du catalogue…</p>

  if (online) return <OnlineCatalogue doc={doc} lang={lang} onLang={setLang} />
  if (poster === 'A4' || poster === 'A3') return <Poster doc={doc} size={poster} link={link} />
  if (mode === 'livret' && doc.catalogue.format === 'A5') return <Booklet doc={doc} />

  const sheetMode: CatalogueSheetMode = mode === 'printer' ? 'printer' : 'proof'
  const size = sheetSize(doc.catalogue.format, sheetMode)
  return (
    <>
      <style>{`${catalogueCss()}\n@page{size:${size.w}mm ${size.h}mm;margin:0}.cat-sheet{break-after:page}.cat-sheet:last-child{break-after:auto}\n${BASE_CSS}`}</style>
      <div className="cat-print__bar">
        <span>
          {doc.catalogue.title} · {doc.catalogue.format} · {doc.version.lang.toUpperCase()} · {sheetMode === 'printer' ? 'PDF imprimeur (fond perdu 3 mm, traits de coupe)' : 'PDF'}
        </span>
        <button type="button" onClick={() => window.print()}>
          Imprimer · Enregistrer en PDF
        </button>
      </div>
      {doc.pages.map((_, index) => (
        <CatalogueSheet key={index} doc={doc} index={index} mode={sheetMode} />
      ))}
    </>
  )
}

/**
 * Sur mon imprimante (livret A4) : chaque feuille A4 paysage porte deux pages A5, recto et verso, dans l'ordre d'un
 * livret piqué : imprimé recto verso (bord court), plié au milieu, les pages se suivent. Un nombre de pages qui n'est
 * pas un multiple de 4 est complété de pages blanches à la fin, avant la dernière.
 */
function Booklet({ doc }: { doc: CatalogueDocument }) {
  const pages: Array<number | null> = doc.pages.map((_, i) => i)
  while (pages.length % 4 !== 0) pages.splice(pages.length - 1, 0, null)
  const n = pages.length
  const faces: Array<[number | null, number | null]> = []
  for (let i = 0; i < n / 4; i++) {
    faces.push([pages[n - 1 - 2 * i], pages[2 * i]])
    faces.push([pages[2 * i + 1], pages[n - 2 - 2 * i]])
  }
  const a5 = FORMAT_MM.A5
  return (
    <>
      <style>{`${catalogueCss()}\n@page{size:297mm 210mm;margin:0}.cat-livret{display:flex;width:297mm;height:210mm;background:#fff;overflow:hidden;break-after:page}.cat-livret:last-child{break-after:auto}.cat-livret__half{width:148.5mm;height:210mm;overflow:hidden;display:flex;align-items:center;justify-content:center}\n${BASE_CSS}`}</style>
      <div className="cat-print__bar">
        <span>{`${doc.catalogue.title} · livret A4 · ${faces.length / 2} feuille(s) recto verso, bord court, à plier au milieu`}</span>
        <button type="button" onClick={() => window.print()}>
          Imprimer
        </button>
      </div>
      {faces.map((face, f) => (
        <div key={f} className="cat-livret">
          {face.map((index, side) => (
            <div key={side} className="cat-livret__half">
              {index !== null ? (
                <div className="cat-sheet" style={{ width: `${a5.w}mm`, height: `${a5.h}mm` }}>
                  <div className="cat-sheet__face" style={{ left: '-3mm', top: '-3mm' }}>
                    <CataloguePage doc={doc} index={index} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

/** L'affiche du magasin : le visuel de la couverture, « Notre catalogue de … », le QR du catalogue en ligne. */
function Poster({ doc, size, link }: { doc: CatalogueDocument; size: 'A4' | 'A3'; link: string }) {
  const cover = doc.pages[0]
  const nl = doc.version.lang === 'nl'
  const title = params.get('titre') || (cover.kind === 'cover' ? `${nl ? 'Onze catalogus ·' : 'Notre catalogue de'} ${cover.title}` : doc.catalogue.title)
  const dim = size === 'A3' ? { w: 297, h: 420 } : { w: 210, h: 297 }
  const u = dim.w / 210
  const drawing = cover.kind === 'cover' && cover.drawing ? new URL(`${import.meta.env.BASE_URL}${cover.drawing}`, window.location.href).href : null
  const image = cover.kind === 'cover' ? cover.imageUrl : null
  const shop = doc.version.shop?.name ?? null
  const colors = doc.charter.colors
  return (
    <>
      <style>{`${catalogueCss()}\n@page{size:${dim.w}mm ${dim.h}mm;margin:0}\n${BASE_CSS}
.cat-poster{position:relative;width:${dim.w}mm;height:${dim.h}mm;overflow:hidden;background:${colors.secondary};color:${colors.ink};display:flex;flex-direction:column;align-items:center;text-align:center;padding:${16 * u}mm ${16 * u}mm ${12 * u}mm;box-sizing:border-box;font-family:'GothamPrint',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cat-poster__logo{height:${12 * u}mm}
.cat-poster__art{flex:1 1 0;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:${8 * u}mm 0}
.cat-poster__art img{height:100%;width:auto;max-width:80%;object-fit:contain}
.cat-poster__art img.photo{width:100%;height:100%;max-width:none;object-fit:cover;border-radius:${3 * u}mm}
.cat-poster__title{font-family:'Vank','GothamPrint',serif;text-transform:uppercase;color:${colors.primary};font-size:${21 * u}mm;line-height:.98}
.cat-poster__scan{margin-top:${6 * u}mm;font-weight:500;font-size:${6 * u}mm}
.cat-poster__qr{margin-top:${6 * u}mm;padding:${3 * u}mm;background:#fff;border-radius:${2 * u}mm}
.cat-poster__shop{margin-top:${6 * u}mm;font-weight:500;letter-spacing:.2em;text-transform:uppercase;font-size:${4 * u}mm}`}</style>
      <div className="cat-print__bar">
        <span>{`Affiche ${size} · ${title}`}</span>
        <button type="button" onClick={() => window.print()}>
          Imprimer · Enregistrer en PDF
        </button>
      </div>
      <div className="cat-poster">
        <img className="cat-poster__logo" src={doc.charter.logoUrl ?? new URL(`${import.meta.env.BASE_URL}img/logo.png`, window.location.href).href} alt="" />
        <div className="cat-poster__art">{image ? <img className="photo" src={image} alt="" /> : drawing ? <img src={drawing} alt="" /> : null}</div>
        <div className="cat-poster__title">{title}</div>
        <div className="cat-poster__scan">{nl ? 'Scan om te bladeren' : 'Scannez pour le feuilleter'}</div>
        {link ? (
          <div className="cat-poster__qr">
            <Qr url={onlineUrl(link)} mm={52 * u} />
          </div>
        ) : null}
        <div className="cat-poster__shop">{shop ? `L’Atelier By · ${shop}` : 'L’Atelier By'}</div>
      </div>
    </>
  )
}

/** Le catalogue en ligne : les pages l'une sous l'autre, à la largeur de l'écran (téléphone d'abord). */
function OnlineCatalogue({ doc, lang, onLang }: { doc: CatalogueDocument; lang: CatalogueLang; onLang: (l: CatalogueLang) => void }) {
  const [width, setWidth] = useState(() => Math.min(window.innerWidth - 24, 620))
  useEffect(() => {
    const resize = () => setWidth(Math.min(window.innerWidth - 24, 620))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const size = FORMAT_MM[doc.catalogue.format]
  const zoom = width / (size.w * MM)
  return (
    <>
      <style>{`${catalogueCss()}\nhtml,body{margin:0;background:#EDE7DE}#root{display:flex;flex-direction:column;align-items:center;gap:14px;padding:0 0 28px}
.cat-online__bar{position:sticky;top:0;z-index:2;width:100%;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid #e6e0d8;font:14px system-ui,sans-serif;color:#1c1a17}
.cat-online__bar span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cat-online__bar button{padding:5px 10px;border:1px solid #e6e0d8;border-radius:8px;background:#fff;font:inherit;font-size:12px;cursor:pointer}
.cat-online__bar button.on{background:#8D1D2C;border-color:#8D1D2C;color:#fff}
.cat-online__page{box-shadow:0 1px 4px rgba(0,0,0,.12);overflow:hidden}`}</style>
      <div className="cat-online__bar">
        <span>{doc.catalogue.title}</span>
        {(['fr', 'nl'] as CatalogueLang[]).map((l) => (
          <button key={l} type="button" className={l === lang ? 'on' : ''} onClick={() => onLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      {doc.pages.map((_, index) => (
        <div key={index} className="cat-online__page" style={{ width, height: size.h * MM * zoom }}>
          <span style={{ zoom, display: 'block' }}>
            <CatalogueSheet doc={doc} index={index} mode="proof" />
          </span>
        </div>
      ))}
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{params.get('bon') && params.get('t') ? <OrderPage token={params.get('t') ?? ''} /> : <PrintPage />}</StrictMode>,
)
