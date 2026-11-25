import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as api from '../../lib/api/module'
import type { Catalogue, CatalogueLang, OrderConditions, OrderForm } from '../../lib/api/module'
import { openPrintWindow } from '../../lib/print'
import { OrderFormSheets, orderFormCss, orderFormSheetCount, orderFormSize } from './OrderForm'
import type { OrderFormMode } from './OrderForm'

/**
 * « Bon de commande ▾ » (maquette E1, 25/11/2026) : dans la liste des imprimés et dans l'éditeur d'un catalogue. La
 * langue (FR, NL, FR + NL), la version (générale, ou celle d'une boutique), les conditions de la boutique en LECTURE
 * (elle les règle dans son dashboard), « Aperçu » et « PDF ». Le bon est composé par l'API : le contenu exact de la
 * version du catalogue.
 */

type LangChoice = 'fr' | 'nl' | 'frnl'

const langsOf = (choice: LangChoice): CatalogueLang[] => (choice === 'frnl' ? ['fr', 'nl'] : [choice])

function render(forms: OrderForm[], mode: OrderFormMode): string {
  const container = document.createElement('div')
  const root = createRoot(container)
  flushSync(() => root.render(<OrderFormSheets forms={forms} mode={mode} />))
  const markup = container.innerHTML
  root.unmount()
  return markup
}

const shortDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'numeric' }) : '')

export function OrderFormMenu({
  cat,
  shopNames,
  conditions,
  initialLang,
  initialShop,
  align = 'right',
}: {
  cat: Catalogue
  shopNames: Map<number, string>
  conditions: OrderConditions[] | null
  initialLang?: CatalogueLang
  initialShop?: number | null
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const own = cat.owner === 'boutique'
  const versions: Array<number | null> = own ? [cat.shop?.id ?? null] : [null, ...cat.shopIds]
  const [lang, setLang] = useState<LangChoice>(initialLang ?? (cat.langs.length > 1 ? 'frnl' : cat.langs[0] ?? 'fr'))
  const [shop, setShop] = useState<number | null>(own ? cat.shop?.id ?? null : initialShop ?? null)
  const [forms, setForms] = useState<OrderForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let gone = false
    setLoading(true)
    setError(null)
    // La version d'un catalogue de franchisé est la sienne : l'API la prend d'office.
    Promise.all(langsOf(lang).map((l) => api.getCatalogueOrderForm(cat.id, l, own ? null : shop)))
      .then((list) => !gone && setForms(list))
      .catch((cause: unknown) => !gone && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !gone && setLoading(false))
    return () => {
      gone = true
    }
  }, [open, lang, shop, cat.id, own])

  const versionShops = own ? (cat.shop ? [cat.shop.id] : []) : cat.shopIds
  const configured = new Set((conditions ?? []).filter((c) => c.configured).map((c) => c.shopId))
  const without = versionShops.filter((id) => !configured.has(id))
  const sheets = forms ? forms.reduce((n, f) => n + orderFormSheetCount(f), 0) : null
  const first = forms?.[0] ?? null
  const shopLabel = shop === null ? 'générale' : shopNames.get(shop) ?? cat.shop?.name ?? `#${shop}`
  const own_c = shop !== null ? (conditions ?? []).find((c) => c.shopId === shop) ?? null : null

  function print(mode: OrderFormMode, preview: boolean) {
    if (!forms) return
    const win = window.open('', '_blank')
    if (!win) {
      setError('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres pour ce site, puis recommencez.')
      return
    }
    const title = ['Bon de commande', cat.title, shop === null ? 'générale' : shopLabel, langsOf(lang).map((l) => l.toUpperCase()).join('+')].join(' – ')
    const size = orderFormSize(mode)
    if (preview) {
      win.document.open()
      win.document.write(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title><style>${orderFormCss()}\n` +
          `@page{size:${size.w}mm ${size.h}mm;margin:0}html,body{margin:0}.bdc-sheet{break-after:page}.bdc-sheet:last-child{break-after:auto}` +
          `@media screen{body{background:#8a857e;display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}}</style></head><body>${render(forms, mode)}</body></html>`,
      )
      win.document.close()
      return
    }
    const failure = openPrintWindow({ title, markup: render(forms, mode), css: orderFormCss(), size, pageClass: 'bdc-sheet', target: win })
    if (failure) setError(failure)
  }

  return (
    <span className={`bdc-menu bdc-menu--${align}`} ref={box}>
      <button type="button" className={`btn btn--sm bdc-menu__btn${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Bon de commande ▾
      </button>
      {open ? (
        <div className="bdc-pop" role="dialog" aria-label={`Bon de commande · ${cat.title}`}>
          <div className="bdc-pop__k">Bon de commande · {cat.title}</div>
          <div className="bdc-pop__row">
            <span className="bro-seg" role="group" aria-label="Langue du bon">
              {(['fr', 'nl', 'frnl'] as LangChoice[]).map((l) => (
                <button key={l} type="button" className={lang === l ? 'is-on' : ''} onClick={() => setLang(l)}>
                  {l === 'frnl' ? 'FR + NL' : l.toUpperCase()}
                </button>
              ))}
            </span>
            {own ? (
              <span className="bdc-pop__shop">{cat.shop?.name ?? 'Boutique'}</span>
            ) : (
              <select className="bdc-pop__select" aria-label="Version" value={shop === null ? '' : String(shop)} onChange={(e) => setShop(e.target.value === '' ? null : Number(e.target.value))}>
                {versions.map((id) => (
                  <option key={id ?? 'g'} value={id === null ? '' : String(id)}>
                    {id === null ? 'Version générale' : shopNames.get(id) ?? `#${id}`}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="bdc-pop__text">
            {loading && !first
              ? 'Composition du bon…'
              : first
                ? `Feuille A4 · le contenu exact de la version ${shop === null ? 'générale' : shopLabel} : ${first.counts.products} produit${first.counts.products > 1 ? 's' : ''} dans l’ordre des pages, ${first.counts.offers} offre${first.counts.offers > 1 ? 's' : ''} et leurs dates, la disponibilité par catégorie.`
                : null}
          </p>
          {error ? <p className="error bdc-pop__text">{error}</p> : null}
          <div className="bdc-pop__cond">
            <div className="bdc-pop__condh">
              <span>Conditions de la boutique</span>
              {shop !== null && own_c?.configured ? <span className="bdc-pop__by">par la boutique · {shortDate(own_c.updatedAt)}</span> : null}
            </div>
            {shop === null ? (
              <p className="bdc-pop__muted">Version générale : le cadre « Conditions de la boutique » reste à remplir à la main.</p>
            ) : own_c?.configured ? (
              <dl className="bdc-pop__dl">
                <dt>Délai minimum</dt>
                <dd>{own_c.minDelay ? `${own_c.minDelay.value} ${own_c.minDelay.unit === 'days' ? (own_c.minDelay.value > 1 ? 'jours' : 'jour') : 'h'}` : '—'}</dd>
                <dt>Dernier jour fêtes</dt>
                <dd>{own_c.holidayDeadlines.length ? own_c.holidayDeadlines.map((d) => `${dm(d.for)} → ${dm(d.until)}`).join(' · ') : '—'}</dd>
                <dt>Acompte</dt>
                <dd>{own_c.depositPct === null ? '—' : `${own_c.depositPct} %`}</dd>
                <dt>Retrait · livraison</dt>
                <dd>
                  {own_c.pickup ? 'oui' : 'non'} ·{' '}
                  {own_c.delivery.enabled
                    ? ['oui', own_c.delivery.radiusKm !== null ? `${own_c.delivery.radiusKm} km` : null, own_c.delivery.feeCents !== null ? (own_c.delivery.feeCents / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' }) : null].filter(Boolean).join(', ')
                    : 'non'}
                </dd>
                <dt>Mention</dt>
                <dd>{own_c.note.fr || '—'}</dd>
              </dl>
            ) : (
              <p className="bdc-pop__muted">Pas encore réglées : le cadre s’imprime vide, à remplir à la main.</p>
            )}
            {shop !== null ? <p className="bdc-pop__muted">Lecture seule : la boutique les modifie dans son dashboard (Mon catalogue › Export PDF).</p> : null}
          </div>
          <div className="bdc-pop__actions">
            <button type="button" className="btn btn--sm" disabled={!forms || loading} onClick={() => print('proof', true)}>
              Aperçu
            </button>
            <button type="button" className="btn btn--sm btn--primary" disabled={!forms || loading} onClick={() => print('proof', false)}>
              PDF{sheets !== null ? ` · ${sheets} feuille${sheets > 1 ? 's' : ''} (${langsOf(lang).map((l) => l.toUpperCase()).join(', ')})` : ''}
            </button>
            <button type="button" className="btn btn--sm" disabled={!forms || loading} title="Avec les traits de coupe, comme le catalogue pour l’imprimeur" onClick={() => print('printer', false)}>
              Imprimeur
            </button>
            {without.length ? (
              <span className="bdc-pop__muted bdc-pop__without" title={without.map((id) => shopNames.get(id) ?? `#${id}`).join(', ')}>
                {without.length} boutique{without.length > 1 ? 's' : ''} sans conditions
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  )
}

const dm = (date: string): string => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`

/** La colonne « Bon de commande » de la liste : produits du catalogue et boutiques qui ont réglé leurs conditions. */
export function OrderFormCell({ cat, conditions }: { cat: Catalogue; conditions: OrderConditions[] | null }) {
  const configured = new Set((conditions ?? []).filter((c) => c.configured).map((c) => c.shopId))
  const shops = cat.owner === 'boutique' ? (cat.shop ? [cat.shop.id] : []) : cat.shopIds
  const done = shops.filter((id) => configured.has(id)).length
  return (
    <>
      <span className={`bro-tag${cat.productCount ? ' bdc-tag--ok' : ''}`}>{cat.productCount ? `✓ ${cat.productCount} produit${cat.productCount > 1 ? 's' : ''}` : 'aucun produit'}</span>
      <small className="catv-subt">
        {conditions === null
          ? 'conditions : …'
          : cat.owner === 'boutique'
            ? done
              ? 'conditions réglées'
              : 'conditions à remplir à la main'
            : shops.length
              ? `conditions : ${done} boutique${done > 1 ? 's' : ''} sur ${shops.length}`
              : 'version générale : cadre à remplir'}
      </small>
    </>
  )
}
