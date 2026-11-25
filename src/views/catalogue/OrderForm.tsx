import type { CatalogueLang, OrderForm, OrderFormCategory, OrderFormItem, OrderFormOffer } from '../../lib/api/module'
import { qrPath } from '../../lib/qr'
import { fontFaces } from '../brochure/Pages'
import { BLEED, MARKS, Marks } from './CataloguePages'

/**
 * Le bon de commande d'un catalogue imprimé (maquette F, validée le 25/11/2026) : une feuille A4, recto, au contenu
 * EXACT de la version du catalogue — l'API le compose (`…/order-form`), cet écran ne fait que le mettre en page.
 *
 * Si le contenu dépasse, une seconde feuille, l'en-tête répété, jamais une ligne coupée : la hauteur de chaque ligne
 * est fixée ici (en mm, d'après la longueur de son texte), la répartition aussi — l'aperçu et l'impression tombent
 * pareil. FR + NL : les bons de chaque langue à la suite, dans le même PDF.
 *
 * `mode` : `proof` (format fini) ou `printer` (traits de coupe, comme le catalogue pour l'imprimeur).
 */

export type OrderFormMode = 'proof' | 'printer'

const A4 = { w: 210, h: 297 }
const PAD = { top: 10, side: 12, bottom: 8 }
const BODY = A4.h - PAD.top - PAD.bottom
/** Hauteurs fixes (mm) : en-tête de la 1re feuille, de la suivante, pied d'une feuille qui continue. */
const TOP_FIRST = 79
const TOP_NEXT = 19
const FOOT_NEXT = 6
const ROW_PAD = 2.4
const LINE = 3.6
const CAT_ROW = 7.4
const FOOTER_LINE = 3.1

const mm = (v: number): string => `${Math.round(v * 100) / 100}mm`

type Row =
  | { kind: 'cat'; title: string; pages: number[]; cont: boolean; h: number }
  | { kind: 'item'; item: OrderFormItem; h: number }
  | { kind: 'foot'; text: string; h: number }
  | { kind: 'offersTitle'; cont: boolean; h: number }
  | { kind: 'offer'; offer: OrderFormOffer; h: number }
  | { kind: 'other'; h: number }

/** Lignes nécessaires à un texte dans une largeur donnée (estimation prudente : 0,56 em par caractère). */
const lines = (chars: number, widthMm: number, fontMm: number): number => Math.max(1, Math.ceil(chars / Math.floor(widthMm / (fontMm * 0.56))))

function promoText(item: OrderFormItem): string | null {
  if (!item.promo) return null
  return item.promo.period ? `${item.promo.label} · ${item.promo.period}` : item.promo.label
}

function offerSub(offer: OrderFormOffer): string {
  return [offer.deal, offer.contents].filter((x) => x && x.trim() !== '').join(' · ')
}

function rows(form: OrderForm): Row[] {
  const out: Row[] = []
  const pushCat = (c: OrderFormCategory) => {
    out.push({ kind: 'cat', title: c.title, pages: c.pages, cont: false, h: CAT_ROW })
    for (const item of c.items) {
      const promo = promoText(item)
      const n = lines(item.name.length + (promo ? promo.length * 0.8 + 4 : 0), 100, 2.6)
      out.push({ kind: 'item', item, h: ROW_PAD + n * LINE })
    }
    if (c.footer) out.push({ kind: 'foot', text: c.footer, h: 1.4 + lines(c.footer.length, 182, 2.15) * FOOTER_LINE })
  }
  form.categories.forEach(pushCat)
  if (form.offers.length) {
    out.push({ kind: 'offersTitle', cont: false, h: CAT_ROW })
    for (const offer of form.offers) {
      const head = lines(offer.name.length + ((offer.badge.length + (offer.period?.length ?? 0)) * 0.8 + 6), 122, 2.6)
      const sub = offerSub(offer)
      const n = sub ? lines(sub.length, 122, 2.1) : 0
      out.push({ kind: 'offer', offer, h: ROW_PAD + 0.4 + head * LINE + n * 3 })
    }
  }
  out.push({ kind: 'other', h: ROW_PAD + LINE })
  return out
}

/** Le bas de la dernière feuille : conditions, totaux, « Réservé à la boutique », pied. */
function bottomHeight(form: OrderForm): number {
  const c = form.conditions
  const text = c.configured ? c.lines.reduce((s, l) => s + lines(l.length, 112, 2.25), 0) * 3.3 : 4 * 5
  const box = Math.max(7 + text + (c.configured ? 3.3 : 0), 31)
  return box + 10
}

export interface OrderFormSheet {
  rows: Row[]
  first: boolean
  last: boolean
  index: number
  total: number
}

/** La répartition sur des feuilles A4 : une ligne n'est jamais coupée, un titre de catégorie n'est jamais seul en bas. */
export function paginate(form: OrderForm): OrderFormSheet[] {
  const all = rows(form)
  const sheets: Row[][] = [[]]
  let room = BODY - TOP_FIRST - FOOT_NEXT
  let current: { kind: 'cat' | 'offersTitle'; row: Row } | null = null
  for (let i = 0; i < all.length; i++) {
    const row = all[i]
    // Un titre se garde avec la ligne qui le suit.
    const need = row.kind === 'cat' || row.kind === 'offersTitle' ? row.h + (all[i + 1]?.h ?? 0) : row.h
    if (need > room && sheets[sheets.length - 1].length > 0) {
      sheets.push([])
      room = BODY - TOP_NEXT - FOOT_NEXT
      if (current && row.kind !== 'cat' && row.kind !== 'offersTitle') {
        const repeat: Row = current.kind === 'cat' && current.row.kind === 'cat'
          ? { ...current.row, cont: true }
          : { kind: 'offersTitle', cont: true, h: CAT_ROW }
        sheets[sheets.length - 1].push(repeat)
        room -= repeat.h
      }
    }
    if (row.kind === 'cat' || row.kind === 'offersTitle') current = { kind: row.kind, row }
    sheets[sheets.length - 1].push(row)
    room -= row.h
  }
  // Le bas (conditions, totaux) sur la dernière feuille ; s'il n'y tient pas, une feuille de plus.
  if (room < bottomHeight(form)) sheets.push([])
  return sheets.map((r, index) => ({ rows: r, first: index === 0, last: index === sheets.length - 1, index, total: sheets.length }))
}

function money(cents: number | null, lang: CatalogueLang): string {
  if (cents === null) return ''
  return (cents / 100).toLocaleString(lang === 'nl' ? 'nl-BE' : 'fr-BE', { style: 'currency', currency: 'EUR' })
}

function pagesText(pages: number[], form: OrderForm): string {
  if (!pages.length) return ''
  const word = form.labels.pagesWord ?? 'pages'
  if (pages.length === 1) return `${form.version.lang === 'nl' ? 'blz.' : 'page'} ${pages[0]}`
  const sorted = [...pages].sort((a, b) => a - b)
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1)
  return contiguous ? `${word} ${sorted[0]}–${sorted[sorted.length - 1]}` : `${word} ${sorted.join(', ')}`
}

function Qr({ url, size }: { url: string; size: number }) {
  const path = qrPath(url)
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} width={mm(size)} height={mm(size)} shapeRendering="crispEdges" aria-label={url}>
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href

function Cells() {
  return (
    <>
      <td className="bdc-q">
        <span className="bdc-box" />
      </td>
      <td className="bdc-t">
        <span className="bdc-line" />
      </td>
    </>
  )
}

function RowView({ row, form }: { row: Row; form: OrderForm }) {
  const lang = form.version.lang
  const L = form.labels
  switch (row.kind) {
    case 'cat':
      return (
        <tr className="bdc-cat" style={{ height: mm(row.h) }}>
          <td colSpan={5}>
            <span className="bdc-vank">{row.title}</span>
            {row.cont ? <span className="bdc-pp">{L.continued}</span> : <span className="bdc-pp">{pagesText(row.pages, form)}</span>}
          </td>
        </tr>
      )
    case 'item': {
      const promo = promoText(row.item)
      const old = row.item.oldPriceCents
      return (
        <tr className="bdc-item" style={{ height: mm(row.h) }}>
          <td className="bdc-name">
            {row.item.name}
            {promo ? <span className="bdc-pr">{promo}</span> : null}
          </td>
          <td className="bdc-fmt">{row.item.format ?? ''}</td>
          <td className="bdc-px">
            {old !== null ? <s>{money(old, lang)}</s> : null}
            {money(row.item.priceCents, lang)}
          </td>
          <Cells />
        </tr>
      )
    }
    case 'foot':
      return (
        <tr className="bdc-ft" style={{ height: mm(row.h) }}>
          <td colSpan={5}>{row.text}</td>
        </tr>
      )
    case 'offersTitle':
      return (
        <tr className="bdc-cat" style={{ height: mm(row.h) }}>
          <td colSpan={5}>
            <span className="bdc-vank">{L.offers}</span>
            {row.cont ? <span className="bdc-pp">{L.continued}</span> : <span className="bdc-pp">{pagesText([...new Set(form.offers.flatMap((o) => o.pages))], form)}</span>}
          </td>
        </tr>
      )
    case 'offer': {
      const o = row.offer
      const chip = [o.badge, o.period].filter(Boolean).join(' · ')
      const sub = offerSub(o)
      return (
        <tr className="bdc-offer" style={{ height: mm(row.h) }}>
          <td colSpan={2}>
            <span className="bdc-onm">{o.name}</span>
            {chip ? <span className="bdc-pr">{chip}</span> : null}
            {sub ? <span className="bdc-cd">{sub}</span> : null}
          </td>
          <td className="bdc-px">
            {o.priceCents !== null && o.oldPriceCents !== null ? <s>{money(o.oldPriceCents, lang)}</s> : null}
            {money(o.priceCents, lang)}
          </td>
          <Cells />
        </tr>
      )
    }
    case 'other':
      return (
        <tr className="bdc-other" style={{ height: mm(row.h) }}>
          <td colSpan={3}>
            {L.other} <span className="bdc-dots" />
          </td>
          <Cells />
        </tr>
      )
  }
}

function Field({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className={`bdc-f${wide ? ' bdc-span2' : ''}`}>
      <span className="bdc-lb">{label}</span>
      <span className="bdc-ln" />
    </div>
  )
}

function Head({ form, sheet }: { form: OrderForm; sheet: OrderFormSheet }) {
  const L = form.labels
  const shop = form.version.shop
  const logo = form.charter.logoUrl ?? asset('img/logo.png')
  const c = form.conditions
  const showPickup = !c.configured || c.pickup
  const showDelivery = !c.configured || c.delivery
  if (!sheet.first) {
    return (
      <div className="bdc-hd2" style={{ height: mm(TOP_NEXT) }}>
        <div className="bdc-hd2__top">
          <img src={logo} alt="" />
          <span className="bdc-vank bdc-hd2__t">{L.title}</span>
          <span className="bdc-hd2__s">
            {L.subtitle} · {L.sheet} {sheet.index + 1}/{sheet.total}
          </span>
        </div>
        <TableHead form={form} />
      </div>
    )
  }
  return (
    <div className="bdc-top" style={{ height: mm(TOP_FIRST) }}>
      <div className="bdc-hd">
        <div>
          <img className="bdc-logo" src={logo} alt="" />
          <div className="bdc-vank bdc-title">{L.title}</div>
          <div className="bdc-sub">{L.subtitle}</div>
        </div>
        {form.qr ? (
          <div className="bdc-qrbox">
            <Qr url={form.qr.url} size={21} />
            <div className="bdc-qrl">{form.qr.label}</div>
            <div className="bdc-qrh">{form.qr.sub}</div>
          </div>
        ) : null}
      </div>
      <div className="bdc-shop">
        {shop ? (
          <>
            <span>
              <b>{/l['’]atelier/i.test(shop.name) ? shop.name : `${L.brand} ${shop.name}`}</b>
            </span>
            {shop.address ? <span>{shop.address}</span> : null}
            {shop.phone ? <span>{(form.version.lang === 'nl' ? 'Tel. ' : 'Tél. ') + shop.phone}</span> : null}
            {shop.hours ? <span>{shop.hours.replace(/\n+/g, ' · ')}</span> : null}
            {shop.holidayHours ? <span>{shop.holidayHours.replace(/\n+/g, ' · ')}</span> : null}
          </>
        ) : (
          <>
            <span>
              <b>{L.brand}</b> <span className="bdc-dots bdc-dots--w" />
            </span>
            <span>
              {form.version.lang === 'nl' ? 'Tel.' : 'Tél.'} <span className="bdc-dots bdc-dots--s" />
            </span>
          </>
        )}
      </div>
      <div className="bdc-cli">
        <Field label={L.name} wide />
        <Field label={L.phone} />
        <Field label={L.email} wide />
        <div className="bdc-f bdc-cks">
          {showPickup ? (
            <span className="bdc-ck">
              <i />
              {L.pickup}
            </span>
          ) : null}
          {showDelivery ? (
            <span className="bdc-ck">
              <i />
              {L.delivery}
            </span>
          ) : null}
        </div>
        <Field label={L.date} />
        <Field label={L.time} />
        {showDelivery ? <Field label={L.address} /> : <span />}
        <div className="bdc-f bdc-span3">
          <span className="bdc-lb">{L.remark}</span>
          <span className="bdc-ln" />
        </div>
      </div>
      <TableHead form={form} />
    </div>
  )
}

function TableHead({ form }: { form: OrderForm }) {
  const L = form.labels
  return (
    <table className="bdc-table bdc-thead">
      <Cols />
      <thead>
        <tr>
          <th>{L.product}</th>
          <th>{L.format}</th>
          <th className="r">{L.price}</th>
          <th className="c">{L.qty}</th>
          <th className="r">{L.total}</th>
        </tr>
      </thead>
    </table>
  )
}

function Cols() {
  return (
    <colgroup>
      <col />
      <col style={{ width: '24mm' }} />
      <col style={{ width: '30mm' }} />
      <col style={{ width: '15mm' }} />
      <col style={{ width: '21mm' }} />
    </colgroup>
  )
}

function Bottom({ form }: { form: OrderForm }) {
  const L = form.labels
  const c = form.conditions
  return (
    <div className="bdc-bottom">
      <div className="bdc-bas">
        <div className="bdc-cond">
          <div className="bdc-ch">
            <b>{c.title}</b>
            {c.by ? <span>{c.by}</span> : null}
          </div>
          {c.configured ? (
            c.lines.map((line, i) => <div key={i}>· {line}</div>)
          ) : (
            <>
              <div className="bdc-hint">{L.emptyHint}</div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="bdc-fill" />
              ))}
            </>
          )}
          <div className="bdc-note">{L.prices}</div>
        </div>
        <div className="bdc-sum">
          <div>
            {L.total} <span className="bdc-line" />
          </div>
          <div>
            {L.deposit} <span className="bdc-line" />
          </div>
          <div>
            {L.rest} <span className="bdc-line" />
          </div>
        </div>
      </div>
      <div className="bdc-res">
        <span>{L.reserved}</span>
        <span>
          {L.number} <span className="bdc-lnw" />
        </span>
        <span>
          {L.receivedBy} <span className="bdc-lnw" />
        </span>
        <span>
          {L.on} <span className="bdc-lnw" />
        </span>
        <span className="bdc-ck">
          <i />
          {L.ready}
        </span>
        <span className="bdc-ck">
          <i />
          {L.collected}
        </span>
      </div>
    </div>
  )
}

function Sheet({ form, sheet, mode }: { form: OrderForm; sheet: OrderFormSheet; mode: OrderFormMode }) {
  const offset = mode === 'printer' ? BLEED + MARKS : 0
  const colors = form.charter.colors
  const face = (
    <div className="bdc-a4" style={{ ['--p' as string]: colors.primary, ['--i' as string]: colors.ink, left: mm(offset), top: mm(offset) }}>
      <Head form={form} sheet={sheet} />
      <table className="bdc-table">
        <Cols />
        <tbody>
          {sheet.rows.map((row, i) => (
            <RowView key={i} row={row} form={form} />
          ))}
        </tbody>
      </table>
      {sheet.last ? <Bottom form={form} /> : null}
      <div className="bdc-foot">
        <span>
          {form.labels.footer}
          {sheet.total > 1 ? ` · ${form.labels.sheet} ${sheet.index + 1}/${sheet.total}` : ''}
        </span>
        <span>L’Atelier By</span>
      </div>
    </div>
  )
  return (
    <div className="bdc-sheet" style={{ width: mm(A4.w + offset * 2), height: mm(A4.h + offset * 2) }}>
      {face}
      {mode === 'printer' ? <Marks format="A4" offset={offset} /> : null}
    </div>
  )
}

/** Les feuilles d'un ou plusieurs bons (FR + NL : un bon par langue, à la suite). */
export function OrderFormSheets({ forms, mode }: { forms: OrderForm[]; mode: OrderFormMode }) {
  return (
    <>
      {forms.flatMap((form, f) => paginate(form).map((sheet) => <Sheet key={`${f}-${sheet.index}`} form={form} sheet={sheet} mode={mode} />))}
    </>
  )
}

/** Le nombre de feuilles A4 d'un bon. */
export const orderFormSheetCount = (form: OrderForm): number => paginate(form).length

/** La taille d'une feuille imprimée (mm) : A4, ou A4 avec ses traits de coupe. */
export const orderFormSize = (mode: OrderFormMode): { w: number; h: number } =>
  mode === 'printer' ? { w: A4.w + (BLEED + MARKS) * 2, h: A4.h + (BLEED + MARKS) * 2 } : A4

/** Les polices de la marque et la feuille de style du bon (aperçu et fenêtre d'impression). */
export function orderFormCss(): string {
  return `${fontFaces()}\n${CSS}`
}

const CSS = `
.bdc-sheet{position:relative;overflow:hidden;background:#fff;flex:0 0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bdc-a4{position:absolute;box-sizing:border-box;width:${A4.w}mm;height:${A4.h}mm;padding:${PAD.top}mm ${PAD.side}mm ${PAD.bottom}mm;display:flex;flex-direction:column;font-family:'GothamPrint',sans-serif;font-weight:400;color:var(--i,#232220);background:#fff;overflow:hidden}
.bdc-a4 *{box-sizing:border-box}
.bdc-vank{font-family:'Vank','GothamPrint',serif;text-transform:uppercase;color:var(--p,#8D1D2C);font-weight:400;letter-spacing:.01em}
.bdc-top{flex:0 0 auto;display:flex;flex-direction:column;overflow:hidden}
.bdc-hd{display:grid;grid-template-columns:1fr 34mm;gap:6mm;align-items:start;height:34mm}
.bdc-logo{height:7mm;display:block}
.bdc-title{font-size:11.5mm;line-height:1;margin-top:2.5mm}
.bdc-sub{font-size:2.9mm;letter-spacing:.16em;text-transform:uppercase;margin-top:2mm;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bdc-qrbox{border:.3mm solid var(--p,#8D1D2C);border-radius:2.5mm;padding:2mm;text-align:center;display:flex;flex-direction:column;align-items:center}
.bdc-qrl{font-size:2.5mm;font-weight:500;color:var(--p,#8D1D2C);margin-top:1mm;line-height:1.2}
.bdc-qrh{font-size:2.05mm;color:#6b625a;margin-top:.4mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30mm}
.bdc-shop{height:10.5mm;display:flex;gap:.4mm 4mm;flex-wrap:wrap;align-content:center;font-size:2.45mm;line-height:1.3;color:#4a423b;border-top:.25mm solid #e4dccf;border-bottom:.25mm solid #e4dccf;overflow:hidden}
.bdc-shop b{font-weight:500;color:var(--p,#8D1D2C)}
.bdc-cli{margin-top:2.2mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.6mm 5mm;font-size:2.5mm;height:23mm}
.bdc-f{display:flex;align-items:flex-end;gap:2mm;min-width:0}
.bdc-lb{color:#6b625a;white-space:nowrap;letter-spacing:.06em;text-transform:uppercase;font-size:2.05mm}
.bdc-ln{flex:1;border-bottom:.25mm solid #b9ada0;height:4.4mm}
.bdc-span2{grid-column:span 2}.bdc-span3{grid-column:span 3}
.bdc-cks{align-items:center}
.bdc-ck{display:inline-flex;align-items:center;gap:1.3mm;margin-right:3.5mm;font-size:2.5mm;white-space:nowrap}
.bdc-ck i{width:3mm;height:3mm;border:.3mm solid #8a7f74;border-radius:.6mm;display:inline-block}
.bdc-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:2.6mm;line-height:${LINE / 2.6}}
.bdc-thead{margin-top:2.4mm}
.bdc-table th{font-size:2mm;letter-spacing:.1em;text-transform:uppercase;color:#6b625a;text-align:left;padding:0 1.5mm 1mm;border-bottom:.35mm solid var(--p,#8D1D2C);font-weight:400}
.bdc-table th.r,.bdc-px,.bdc-t{text-align:right}
.bdc-table th.c,.bdc-q{text-align:center}
.bdc-table td{padding:0 1.5mm;border-bottom:.2mm solid #eee6da;vertical-align:middle;overflow:hidden}
.bdc-cat td{border-bottom:none;vertical-align:bottom;padding-bottom:.6mm}
.bdc-cat .bdc-vank{font-size:3.9mm;line-height:1}
.bdc-pp{font-size:1.9mm;color:#9a8f84;margin-left:2mm;letter-spacing:.04em}
.bdc-ft td{border-bottom:none;font-size:2.15mm;line-height:${FOOTER_LINE / 2.15};color:#6b625a;font-style:italic;vertical-align:top;padding-top:.3mm}
.bdc-fmt{color:#6b625a;font-size:2.3mm;white-space:nowrap}
.bdc-px{white-space:nowrap;font-weight:500}
.bdc-px s{color:#9a8f84;font-weight:400;margin-right:1mm}
.bdc-pr{display:inline-block;margin-left:1.6mm;font-size:2.05mm;line-height:1.35;color:var(--p,#8D1D2C);background:#F7EDEE;border-radius:.8mm;padding:0 1.2mm;white-space:nowrap}
.bdc-box{width:9mm;height:4.2mm;border:.3mm solid #8a7f74;border-radius:.8mm;display:inline-block;vertical-align:middle}
.bdc-line{width:15mm;border-bottom:.25mm solid #b9ada0;height:3.8mm;display:inline-block}
.bdc-offer td{background:#FBF4F4}
.bdc-onm{color:var(--p,#8D1D2C);font-weight:500}
.bdc-cd{display:block;font-size:2.1mm;line-height:${3 / 2.1};color:#6b625a}
.bdc-other td{color:#9a8f84}
.bdc-dots{display:inline-block;width:70mm;border-bottom:.25mm dotted #9a8f84;height:2.6mm}
.bdc-dots--w{width:60mm}.bdc-dots--s{width:28mm}
.bdc-bottom{margin-top:auto;flex:0 0 auto}
.bdc-bas{display:grid;grid-template-columns:1fr 62mm;gap:5mm;align-items:end}
.bdc-cond{border:.3mm solid #e4dccf;border-radius:2mm;padding:2mm 3mm;font-size:2.25mm;line-height:1.45;color:#4a423b}
.bdc-ch{display:flex;justify-content:space-between;align-items:baseline;gap:3mm;margin-bottom:.6mm}
.bdc-ch b{font-weight:500;color:var(--i,#232220);font-size:2.5mm;white-space:nowrap}
.bdc-ch span{font-size:1.85mm;letter-spacing:.08em;text-transform:uppercase;color:var(--p,#8D1D2C);text-align:right}
.bdc-hint{color:#9a8f84;font-size:2.05mm}
.bdc-fill{height:5mm;border-bottom:.25mm dotted #9a8f84}
.bdc-note{margin-top:.8mm;font-size:1.95mm;color:#9a8f84}
.bdc-sum{border:.3mm solid var(--i,#232220);border-radius:2mm;overflow:hidden;font-size:2.7mm}
.bdc-sum div{white-space:nowrap;gap:2mm;display:flex;justify-content:space-between;align-items:flex-end;padding:1.7mm 3mm;border-bottom:.2mm solid #e4dccf}
.bdc-sum div:last-child{border:none;background:var(--p,#8D1D2C);color:#fff;font-weight:500}
.bdc-sum div:last-child .bdc-line{border-color:rgba(255,255,255,.7)}
.bdc-sum .bdc-line{width:16mm}
.bdc-res{margin-top:2.4mm;border-top:.25mm dashed #b9ada0;padding-top:1.8mm;font-size:2.1mm;color:#6b625a;display:flex;gap:5mm;align-items:center}
.bdc-lnw{display:inline-block;width:20mm;border-bottom:.25mm solid #b9ada0;height:3.3mm}
.bdc-foot{font-size:1.85mm;color:#9a8f84;margin-top:1.4mm;display:flex;justify-content:space-between;gap:4mm;height:${FOOT_NEXT - 1.4}mm;align-items:flex-end;flex:0 0 auto}
.bdc-a4 > table + .bdc-foot{margin-top:auto}
.bdc-hd2{flex:0 0 auto;overflow:hidden}
.bdc-hd2__top{display:flex;align-items:center;gap:4mm;height:9mm}
.bdc-hd2__top img{height:5.5mm}
.bdc-hd2__t{font-size:5.5mm}
.bdc-hd2__s{font-size:2.3mm;letter-spacing:.12em;text-transform:uppercase;color:#6b625a;margin-left:auto;white-space:nowrap}
`
