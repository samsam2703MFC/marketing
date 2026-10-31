import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as api from '../../lib/api/module'
import type { BrochureFormat, BrochureSettings, Campaign, CampaignDetail, PrintFile, SavedBrochure } from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import {
  FORMATS,
  FORMAT_TEXTS,
  TEMPLATES,
  TEXT_LABELS,
  blocking,
  brandLangsOf,
  buildDoc,
  buildVersions,
  campaignShops,
  checksFor,
  defaultSettings,
  defaultTexts,
  doubtfulPrice,
  formatPrice,
  missingDutch,
  normalizeSettings,
  productKey,
  savedFor,
  splitLabel,
  webshopHost,
} from '../../lib/brochure'
import type { BrochureCheck, BrochureShop, Lang, TextKey, Version } from '../../lib/brochure'
import { Sheet, fontFaces, pageSize } from './Pages'
import type { Side } from './Pages'
import PAGE_CSS from './brochure.css?inline'

/**
 * Générateur de brochures : un leaflet A5 recto-verso ou un dépliant A4 trois
 * volets, tiré de la campagne, en une version générale et une version par
 * boutique et par langue de la boutique — son adresse, ses horaires, et un QR
 * code qui ouvre son webshop.
 *
 * Les réglages (modèle, textes FR/NL, produits, QR code, boutiques écartées)
 * s'enregistrent d'eux-mêmes, par campagne et par support. L'impression passe
 * par le navigateur : « Enregistrer au format PDF » donne le fichier.
 */

interface Props {
  campaignId: number | null
  onOpenCampaign?: (id: number) => void
}

const OTHER: Record<BrochureFormat, BrochureFormat> = { 'leaflet-a5': 'depliant-a4', 'depliant-a4': 'leaflet-a5' }

const MM = 96 / 25.4

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const localToday = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** La campagne ouverte par défaut : en cours, sinon la prochaine, sinon la plus récente. */
function defaultCampaign(list: Campaign[], today: string): number | null {
  const usable = list.filter((campaign) => campaign.status_code !== 'draft')
  const pool = usable.length ? usable : list
  const running = pool.find((c) => c.starts_on !== null && c.starts_on <= today && (c.ends_on === null || c.ends_on >= today))
  if (running) return running.id
  const next = pool.filter((c) => c.starts_on !== null && c.starts_on > today).sort((a, b) => (a.starts_on ?? '').localeCompare(b.starts_on ?? ''))[0]
  return next?.id ?? pool[0]?.id ?? null
}

interface Bundle {
  id: number
  file: PrintFile
  detail: CampaignDetail
  saved: SavedBrochure[]
}

type Store = Partial<Record<BrochureFormat, BrochureSettings>>

interface Editing {
  key: TextKey
  lang: Lang
  top: number
  left: number
}

export default function BrochureView({ campaignId: initialId, onOpenCampaign }: Props) {
  const today = localToday()
  const campaigns = useAsync(() => api.listCampaigns(), [])
  const shops = useAsync(() => api.listShops(), [])
  const social = useAsync(() => api.getSocialState(), [])
  const [campaignId, setCampaignId] = useState<number | null>(initialId)

  useEffect(() => {
    if (campaignId === null && campaigns.data) setCampaignId(defaultCampaign(campaigns.data, today))
  }, [campaignId, campaigns.data, today])

  const bundle = useAsync<Bundle | null>(
    () =>
      campaignId === null
        ? Promise.resolve(null)
        : Promise.all([api.getPrintFile(campaignId), api.getCampaign(campaignId), api.listBrochures(campaignId)]).then(([file, detail, saved]) => ({
            id: campaignId,
            file,
            detail,
            saved,
          })),
    [campaignId],
  )

  const sorted = useMemo(
    () => [...(campaigns.data ?? [])].sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? '')),
    [campaigns.data],
  )

  return (
    <div className="bro">
      <section className="bro-panelcard bro-pick">
        <label className="bro-pick__field">
          <span className="bro-step">
            <b>1</b> Campagne
          </span>
          <select value={campaignId ?? ''} onChange={(event) => setCampaignId(event.target.value ? Number(event.target.value) : null)}>
            {campaignId === null ? <option value="">Choisir une campagne…</option> : null}
            {sorted.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
                {campaign.starts_on ? ` · ${campaign.starts_on.slice(8, 10)}/${campaign.starts_on.slice(5, 7)}/${campaign.starts_on.slice(0, 4)}` : ''}
                {campaign.status_code === 'draft' ? ' · brouillon' : ''}
              </option>
            ))}
          </select>
        </label>
        {campaignId !== null && onOpenCampaign ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpenCampaign(campaignId)}>
            Suivi de la campagne →
          </button>
        ) : null}
        {campaigns.error ? <p className="error">{campaigns.error}</p> : null}
      </section>

      {bundle.error ? <p className="error">Dossier d’impression illisible : {bundle.error}</p> : null}
      {bundle.loading && campaignId !== null ? <p className="muted">Chargement du dossier d’impression…</p> : null}
      {social.error ? (
        <p className="error">
          Module Social injoignable ({social.error}) : adresses, horaires et langues des boutiques, et lien du webshop, manquent.
        </p>
      ) : null}

      {bundle.data && !bundle.loading && (social.loading || shops.loading) ? <p className="muted">Lecture des boutiques et du webshop…</p> : null}
      {shops.error ? <p className="error">Boutiques illisibles : {shops.error}</p> : null}

      {bundle.data && !bundle.loading && !social.loading && !shops.loading ? (
        <Generator
          key={bundle.data.id}
          bundle={bundle.data}
          shops={shops.data ?? []}
          socialShops={social.data?.shops ?? []}
          brandLangs={brandLangsOf(social.data?.brand?.langs)}
          webshopUrl={social.data?.webshopUrl ?? ''}
          today={today}
        />
      ) : null}
    </div>
  )
}

interface GeneratorProps {
  bundle: Bundle
  shops: api.Shop[]
  socialShops: api.SocialShop[]
  brandLangs: Lang[]
  webshopUrl: string
  today: string
}

function Generator({ bundle, shops, socialShops, brandLangs, webshopUrl, today }: GeneratorProps) {
  const { file, detail } = bundle
  const [format, setFormat] = useState<BrochureFormat>(() =>
    bundle.saved.some((row) => row.format === 'leaflet-a5') || !bundle.saved.length ? 'leaflet-a5' : 'depliant-a4',
  )
  const [store, setStore] = useState<Store>(() => {
    const out: Store = {}
    for (const row of bundle.saved) out[row.format] = normalizeSettings(savedFor(bundle.saved, row.format), file)
    return out
  })
  // Un support jamais réglé reprend les réglages de l'autre : changer de support ne refait rien.
  const settings: BrochureSettings = store[format] ?? store[OTHER[format]] ?? defaultSettings(file)
  const def = FORMATS[format]

  // --- enregistrement ---
  const dirty = useRef(new Set<BrochureFormat>())
  const [edits, setEdits] = useState(0)
  const [save, setSave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ status: 'idle' })
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    if (edits === 0) return
    const timer = window.setTimeout(() => {
      const formats = [...dirty.current]
      dirty.current.clear()
      setSave({ status: 'saving' })
      Promise.all(formats.map((f) => api.saveBrochure(bundle.id, f, storeRef.current[f] as BrochureSettings)))
        .then(() => setSave({ status: 'saved' }))
        .catch((cause: unknown) => {
          formats.forEach((f) => dirty.current.add(f))
          setSave({ status: 'error', text: message(cause) })
        })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [edits, bundle.id])

  function update(change: (current: BrochureSettings) => BrochureSettings) {
    setStore((previous) => {
      const current = previous[format] ?? previous[OTHER[format]] ?? defaultSettings(file)
      return { ...previous, [format]: change(structuredClone(current)) }
    })
    dirty.current.add(format)
    setEdits((count) => count + 1)
  }

  // --- boutiques et versions ---
  const brShops = useMemo(() => campaignShops(detail.scope, detail.shops, shops, socialShops), [detail, shops, socialShops])
  const versions = useMemo(() => buildVersions(brShops, settings.excludedShops, brandLangs), [brShops, settings.excludedShops, brandLangs])
  const [versionKey, setVersionKey] = useState<string | null>(null)
  const version: Version = versions.find((row) => row.key === versionKey) ?? versions.find((row) => row.shop) ?? versions[0]

  // --- catégories du webshop, pour diriger le QR code ---
  const navShop = brShops.find((shop) => shop.n !== null && !shop.test && !shop.unknown)?.n ?? null
  const nav = useAsync(() => (navShop === null ? Promise.resolve(null) : api.getWebshopNav(navShop)), [navShop])
  const categoryName = nav.data?.categories.find((category) => category.id === settings.qr.category)?.name ?? null

  // --- aperçu ---
  const [view, setView] = useState<'both' | Side>('both')
  const sides: Side[] = view === 'both' ? [0, 1] : [view]
  const doc = buildDoc({ file, settings, format, version, webshopUrl, categoryName, proof: true })

  const stageRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(900)
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const page = pageSize(doc, 'preview', true)
  const across = format === 'leaflet-a5' ? sides.length : 1
  const zoom = Math.min(1, (stageWidth - 8) / (across * page.w * MM + (across - 1) * 24))

  // Les blocs de taille fixe dont le texte déborde : il serait coupé à l'impression.
  const [overflow, setOverflow] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    const measure = () => {
      if (cancelled || !pagesRef.current) return
      const found = new Set<string>()
      // Les boîtes des enfants, pas `scrollHeight` : le dessin des lettres de la police de titre
      // dépasse sa ligne sans que rien ne soit coupé.
      pagesRef.current.querySelectorAll<HTMLElement>('[data-fit]').forEach((node) => {
        const box = node.getBoundingClientRect()
        const cut = Array.from(node.children).some((child) => {
          const inner = child.getBoundingClientRect()
          return inner.height > 0 && (inner.bottom > box.bottom + 1 || inner.top < box.top - 1 || inner.right > box.right + 1)
        })
        if (cut) found.add(node.dataset.fit ?? '')
      })
      const next = [...found].sort()
      setOverflow((previous) => (previous.join('|') === next.join('|') ? previous : next))
    }
    const timer = window.setTimeout(measure, 250)
    void document.fonts.ready.then(measure)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  })

  // --- contrôle avant impression ---
  const host = webshopHost(webshopUrl)
  const checksOf = (target: Version): BrochureCheck[] => {
    const checks = checksFor(file, settings, format, target, webshopUrl, today)
    if (!webshopUrl) checks.unshift({ level: 'stop', label: 'Lien du webshop inconnu', detail: 'Le module Social ne l’a pas donné : le QR code ne peut pas se composer.' })
    return checks
  }
  const checks = checksOf(version)
  if (overflow.length) {
    checks.unshift({
      level: 'warn',
      label: `Texte coupé : ${overflow.join(', ')}`,
      detail: 'Le bloc est plein : raccourcissez le texte ou cochez moins de produits.',
      target: 'texts',
    })
  }

  // --- édition sur place ---
  const [textLang, setTextLang] = useState<Lang>('fr')
  const [editing, setEditing] = useState<Editing | null>(null)

  function onStageClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = (event.target as Element).closest<HTMLElement>('[data-k]')
    const stage = stageRef.current
    if (!stage) return
    if (!target || !pagesRef.current?.contains(target)) {
      if (pagesRef.current?.contains(event.target as Node)) setEditing(null)
      return
    }
    const box = target.getBoundingClientRect()
    const frame = stage.getBoundingClientRect()
    const width = Math.min(320, frame.width - 16)
    setTextLang(version.lang)
    setEditing({
      key: target.dataset.k as TextKey,
      lang: version.lang,
      top: box.bottom - frame.top + stage.scrollTop + 8,
      left: Math.max(8, Math.min(box.left - frame.left + box.width / 2 - width / 2, frame.width - width - 8)),
    })
  }

  function setText(lang: Lang, key: TextKey, value: string | null) {
    update((current) => {
      const texts = { ...(current.texts[lang] ?? {}) }
      if (value === null) delete texts[key]
      else texts[key] = value
      return { ...current, texts: { ...current.texts, [lang]: texts } }
    })
  }

  // --- impression ---
  const [printError, setPrintError] = useState<string | null>(null)

  function print(targets: Version[], mode: 'proof' | 'printer') {
    setPrintError(null)
    const docs = targets.map((target) => ({
      doc: buildDoc({ file, settings, format, version: target, webshopUrl, categoryName, proof: mode === 'proof' }),
      blocked: blocking(checksOf(target)),
    }))
    const size = pageSize(doc, mode, settings.cropMarks)
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() =>
      root.render(
        <>
          {docs.flatMap(({ doc: one, blocked }, index) =>
            ([0, 1] as Side[]).map((side) => (
              <Sheet key={`${index}-${side}`} doc={one} side={side} mode={mode} marks={settings.cropMarks} watermark={mode === 'proof' && blocked} />
            )),
          )}
        </>,
      ),
    )
    const markup = container.innerHTML
    root.unmount()

    const win = window.open('', '_blank')
    if (!win) {
      setPrintError('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres pour ce site, puis recommencez.')
      return
    }
    const title = [file.campaign.name, def.label, targets.length === 1 ? targets[0].label.replace(' · ', ' ') : `${targets.length} versions`, mode === 'proof' ? 'épreuve' : 'imprimeur']
      .join(' – ')
      .replace(/[<>&"]/g, '')
    win.document.open()
    win.document.write(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${fontFaces()}\n${PAGE_CSS}\n` +
        `@page{size:${size.w}mm ${size.h}mm;margin:0}html,body{margin:0;padding:0;background:#fff}.bro-page{break-after:page}.bro-page:last-child{break-after:auto}` +
        `@media screen{body{background:#8a857e;display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}}</style></head><body>${markup}</body></html>`,
    )
    win.document.close()
    const loaded = (img: HTMLImageElement) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve())
            img.addEventListener('error', () => resolve())
          })
    void win.document.fonts.ready
      .then(() => Promise.all(Array.from(win.document.images).map(loaded)))
      .then(() => {
        win.focus()
        win.print()
      })
  }

  const ready = versions.filter((target) => !blocking(checksOf(target)))

  // --- produits ---
  const byKey = new Map(file.products.map((product) => [productKey(product), product]))
  const chosen = settings.products.filter((row) => row.on).length

  function moveProduct(index: number, delta: number) {
    update((current) => {
      const products = [...current.products]
      const [row] = products.splice(index, 1)
      products.splice(Math.max(0, Math.min(products.length, index + delta)), 0, row)
      return { ...current, products }
    })
  }

  function setPrice(index: number, raw: string) {
    const cleaned = raw.replace(/\s|€/g, '').replace(',', '.')
    const value = cleaned === '' ? null : Number(cleaned)
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 9999.99)) return
    update((current) => {
      const products = [...current.products]
      products[index] = { ...products[index], price: value === null ? null : Math.round(value * 100) / 100 }
      return { ...current, products }
    })
  }

  // --- textes ---
  const frDefaults = defaultTexts(file, 'fr', host)
  const langDefaults = defaultTexts(file, textLang, host)
  const missing = missingDutch(file, settings, format, host)
  const nlNeeded = versions.some((row) => row.lang === 'nl')

  const thumbVersion: Version = { key: 'thumb', shop: null, lang: 'fr', label: '' }

  return (
    <div className="bro-body">
      {/* ------------------------------------------------ réglages */}
      <div className="bro-col">
        <section className="bro-panelcard">
          <p className="bro-step">
            <b>2</b> Support
          </p>
          <div className="bro-formats">
            {(Object.keys(FORMATS) as BrochureFormat[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`bro-format${id === format ? ' is-on' : ''}`}
                aria-pressed={id === format}
                onClick={() => {
                  setFormat(id)
                  setEditing(null)
                }}
              >
                <i className={`bro-format__icon bro-format__icon--${id}`} />
                <span>
                  {FORMATS[id].label}
                  <small>{FORMATS[id].sub}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="bro-panelcard">
          <p className="bro-step">
            <b>3</b> Modèle
          </p>
          <div className="bro-models">
            {TEMPLATES.map((template) => {
              const thumb = buildDoc({
                file,
                settings: { ...settings, template: template.id },
                format: 'leaflet-a5',
                version: thumbVersion,
                webshopUrl,
                categoryName: null,
                proof: true,
              })
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`bro-model${template.id === settings.template ? ' is-on' : ''}`}
                  aria-pressed={template.id === settings.template}
                  title={template.hint}
                  aria-label={`Modèle ${template.name} : ${template.hint}`}
                  onClick={() => update((current) => ({ ...current, template: template.id }))}
                >
                  <span className="bro-model__thumb" aria-hidden="true">
                    <span style={{ zoom: 0.152 }}>
                      <Sheet doc={thumb} side={0} mode="proof" marks={false} />
                    </span>
                  </span>
                  <span className="bro-model__name">{template.name}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="bro-panelcard" id="bro-products">
          <p className="bro-step">
            <b>4</b> Produits <span className="muted">· {chosen} coché{chosen > 1 ? 's' : ''}, {def.maxProducts} au plus</span>
          </p>
          {settings.products.length === 0 ? (
            <p className="muted bro-hint">L’offre de cette campagne n’a aucun produit : ajoutez-les par « Compléter les campagnes ».</p>
          ) : null}
          {settings.products.map((row, index) => {
            const product = byKey.get(row.key)
            if (!product) return null
            const { name, sub } = splitLabel(product.label)
            const auto = product.price_after ?? product.price_before
            const doubtful = doubtfulPrice(product)
            return (
              <div className={`bro-prod${row.on ? '' : ' is-off'}`} key={row.key}>
                <input
                  type="checkbox"
                  checked={row.on}
                  aria-label={`Montrer ${name}`}
                  onChange={(event) =>
                    update((current) => {
                      const products = [...current.products]
                      products[index] = { ...products[index], on: event.target.checked }
                      return { ...current, products }
                    })
                  }
                />
                <span className="bro-prod__name">
                  {name}
                  <small>
                    {[sub, product.family].filter(Boolean).join(' · ')}
                    {doubtful ? null : ` · ${formatPrice(auto as number, 'fr')} ${file.price_source === 'boutiques' ? 'en boutique' : 'au catalogue'}`}
                  </small>
                </span>
                <label className={`bro-prod__price${doubtful && row.price === null ? ' is-doubt' : ''}`}>
                  <input
                    key={`${format}-${row.price}`}
                    type="text"
                    inputMode="decimal"
                    defaultValue={row.price === null ? '' : row.price.toFixed(2).replace('.', ',')}
                    placeholder={doubtful ? 'prix ?' : (auto as number).toFixed(2).replace('.', ',')}
                    aria-label={`Prix de ${name}`}
                    onBlur={(event) => setPrice(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                    }}
                  />
                  €
                </label>
                <span className="bro-prod__move">
                  <button type="button" aria-label="Monter" disabled={index === 0} onClick={() => moveProduct(index, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label="Descendre" disabled={index === settings.products.length - 1} onClick={() => moveProduct(index, 1)}>
                    ↓
                  </button>
                </span>
              </div>
            )
          })}
          <p className="bro-hint">
            Un prix absent ou à 1,00 € (prix par défaut de l’ERP) est à confirmer : saisi ici, il vaut pour cette brochure seule.
          </p>
        </section>

        <section className="bro-panelcard" id="bro-texts">
          <div className="bro-step bro-step--row">
            <span>
              <b>5</b> Textes
            </span>
            <span className="bro-seg" role="group" aria-label="Langue des textes">
              {(['fr', 'nl'] as Lang[]).map((lang) => (
                <button key={lang} type="button" className={lang === textLang ? 'is-on' : ''} aria-pressed={lang === textLang} onClick={() => setTextLang(lang)}>
                  {lang.toUpperCase()}
                  {lang === 'nl' && missing.length && nlNeeded ? <i className="bro-seg__dot" /> : null}
                </button>
              ))}
            </span>
          </div>
          {textLang === 'nl' && !nlNeeded ? (
            <p className="bro-hint">Aucune boutique de la campagne n’est en néerlandais : ces textes servent si l’une le devient.</p>
          ) : null}
          {FORMAT_TEXTS[format].map((key) => {
            const own = settings.texts[textLang]?.[key]
            const fallback = langDefaults[key]
            const frValue = settings.texts.fr?.[key] ?? frDefaults[key] ?? ''
            const value = own ?? fallback ?? ''
            const isMissing = textLang === 'nl' && missing.includes(key)
            const long = ['title', 'flapText', 'conditions', 'phrase'].includes(key)
            return (
              <label key={key} className={`bro-text${isMissing ? ' is-missing' : ''}${editing?.key === key ? ' is-editing' : ''}`}>
                <span className="bro-text__label">
                  {TEXT_LABELS[key]}
                  {own !== undefined && fallback !== null ? (
                    <button type="button" className="linklike" onClick={() => setText(textLang, key, null)}>
                      par défaut
                    </button>
                  ) : null}
                  {isMissing ? <em>à écrire</em> : null}
                </span>
                <textarea
                  rows={long ? 2 : 1}
                  value={value}
                  placeholder={textLang === 'nl' ? frValue : ''}
                  maxLength={240}
                  onChange={(event) => setText(textLang, key, event.target.value)}
                />
              </label>
            )
          })}
          <p className="bro-hint">Un clic sur un texte de l’aperçu l’ouvre aussi en édition, dans la langue de la version affichée.</p>
        </section>

        <section className="bro-panelcard" id="bro-shops">
          <p className="bro-step">
            <b>6</b> Boutiques et QR code
          </p>
          {brShops.length === 0 ? <p className="muted bro-hint">La campagne ne vise aucune boutique : seule la version générale se tire.</p> : null}
          <div className="bro-shops">
            {brShops.map((shop) => (
              <ShopRow
                key={shop.id}
                shop={shop}
                excluded={settings.excludedShops.includes(shop.id)}
                onToggle={(include) =>
                  update((current) => ({
                    ...current,
                    excludedShops: include ? current.excludedShops.filter((id) => id !== shop.id) : [...current.excludedShops, shop.id],
                  }))
                }
              />
            ))}
          </div>
          <p className="bro-hint">Adresse, horaires, téléphone et langues viennent de la fiche de la boutique dans le module Social.</p>

          <div className="bro-qrpick">
            <span className="bro-text__label">Le QR code ouvre</span>
            <span className="bro-seg" role="group" aria-label="Destination du QR code">
              <button type="button" className={settings.qr.mode === 'webshop' ? 'is-on' : ''} onClick={() => update((c) => ({ ...c, qr: { mode: 'webshop', category: null, group: null } }))}>
                Le webshop de la boutique
              </button>
              <button
                type="button"
                className={settings.qr.mode === 'category' ? 'is-on' : ''}
                disabled={!nav.data}
                onClick={() => {
                  const first = nav.data?.categories[0]
                  if (first) update((c) => ({ ...c, qr: { mode: 'category', category: c.qr.category ?? first.id, group: c.qr.group ?? first.groupe ?? null } }))
                }}
              >
                Une catégorie
              </button>
            </span>
            {settings.qr.mode === 'category' && nav.data ? (
              <select
                value={settings.qr.category ?? ''}
                onChange={(event) => {
                  const category = nav.data?.categories.find((row) => row.id === Number(event.target.value))
                  if (category) update((c) => ({ ...c, qr: { mode: 'category', category: category.id, group: category.groupe || null } }))
                }}
              >
                {nav.data.groupes.map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {nav.data?.categories
                      .filter((category) => category.groupe === group.id)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name} ({category.n})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            ) : null}
            {nav.error ? <p className="bro-hint">Catégories du webshop illisibles : {nav.error}</p> : null}
          </div>

          <label className="bro-check">
            <input type="checkbox" checked={settings.cropMarks} onChange={(event) => update((c) => ({ ...c, cropMarks: event.target.checked }))} />
            Traits de coupe dans le PDF imprimeur
          </label>
        </section>
      </div>

      {/* ------------------------------------------------ aperçu */}
      <div className="bro-stage" ref={stageRef} onClick={onStageClick}>
        <style>{fontFaces()}</style>
        <style>{PAGE_CSS}</style>
        <div className="bro-stagebar">
          <span className="bro-seg" role="group" aria-label="Face">
            {(['both', 0, 1] as Array<'both' | Side>).map((option) => (
              <button key={String(option)} type="button" className={view === option ? 'is-on' : ''} onClick={() => setView(option)}>
                {option === 'both' ? (format === 'leaflet-a5' ? 'Côte à côte' : 'Les deux') : def.faces[option]}
              </button>
            ))}
          </span>
          <span className="bro-chips">
            {versions.map((row) => (
              <button
                key={row.key}
                type="button"
                className={`bro-chip${row.key === version.key ? ' is-on' : ''}${blocking(checksOf(row)) ? ' is-blocked' : ''}`}
                onClick={() => {
                  setVersionKey(row.key)
                  setEditing(null)
                }}
              >
                {row.label}
              </button>
            ))}
          </span>
          <span className={`bro-save bro-save--${save.status}`}>
            {save.status === 'saving' ? 'Enregistrement…' : save.status === 'saved' ? 'Réglages enregistrés' : save.status === 'error' ? `Non enregistré : ${save.text}` : ''}
            {save.status === 'error' ? (
              <button type="button" className="linklike" onClick={() => setEdits((count) => count + 1)}>
                Réessayer
              </button>
            ) : null}
          </span>
        </div>

        <div className={`bro-pages bro-pages--${format}`} ref={pagesRef} style={{ zoom }}>
          {sides.map((side) => (
            <figure key={side} className="bro-figure">
              <Sheet doc={doc} side={side} mode="preview" marks={settings.cropMarks} />
              <figcaption>
                {def.faces[side]} · {def.label} · {version.label}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="bro-legend">
          <i className="bro-legend__trim" /> format fini · au-delà, fond perdu de 3 mm · <i className="bro-legend__q" /> prix à confirmer
        </p>

        {editing ? (
          <div className="bro-editor" style={{ top: editing.top, left: editing.left }} onClick={(event) => event.stopPropagation()}>
            <span className="bro-editor__label">
              {TEXT_LABELS[editing.key]} · {editing.lang.toUpperCase()}
            </span>
            <textarea
              autoFocus
              rows={2}
              maxLength={240}
              value={settings.texts[editing.lang]?.[editing.key] ?? defaultTexts(file, editing.lang, host)[editing.key] ?? ''}
              placeholder={editing.lang === 'nl' ? settings.texts.fr?.[editing.key] ?? frDefaults[editing.key] ?? '' : ''}
              onChange={(event) => setText(editing.lang, editing.key, event.target.value)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                }
              }}
            />
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing(null)}>
              ✓
            </button>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------ contrôle et sortie */}
      <div className="bro-col">
        <section className="bro-panelcard">
          <p className="bro-step">Contrôle avant impression · {version.label}</p>
          <ul className="bro-checks">
            {checks.map((check, index) => (
              <li key={index} className={`bro-checkrow is-${check.level}`}>
                <span className="bro-checkrow__ic" aria-hidden="true">
                  {check.level === 'ok' ? '✓' : check.level === 'warn' ? '!' : '×'}
                </span>
                <span>
                  {check.label}
                  {check.detail ? <small>{check.detail}</small> : null}
                  {check.target ? (
                    <button type="button" className="linklike" onClick={() => document.getElementById(`bro-${check.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                      Corriger
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bro-panelcard">
          <p className="bro-step">Sortie · {versions.length} version{versions.length > 1 ? 's' : ''}</p>
          <ul className="bro-out">
            {versions.map((row) => {
              const blocked = blocking(checksOf(row))
              return (
                <li key={row.key} className={`bro-outrow${row.key === version.key ? ' is-on' : ''}`}>
                  <span className="bro-outrow__name">
                    {row.label}
                    <small>{blocked ? 'à corriger avant l’imprimeur' : 'prête'}</small>
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => print([row], 'proof')}>
                    Épreuve
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={blocked}
                    title={blocked ? 'Le contrôle avant impression signale un point bloquant' : undefined}
                    onClick={() => print([row], 'printer')}
                  >
                    PDF
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="bro-outall">
            <button type="button" className="btn btn--primary" disabled={ready.length === 0} onClick={() => print(ready, 'printer')}>
              PDF imprimeur · {ready.length} version{ready.length > 1 ? 's' : ''} prête{ready.length > 1 ? 's' : ''}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => print(versions, 'proof')}>
              Épreuves de toutes les versions
            </button>
          </div>
          {printError ? <p className="error">{printError}</p> : null}
          <p className="bro-hint">
            Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ». PDF imprimeur : {def.trimW} × {def.trimH} mm et 3 mm de fond perdu
            {settings.cropMarks ? ', traits de coupe' : ''}. Épreuve : au format fini, filigranée tant qu’un point bloque.
          </p>
        </section>
      </div>
    </div>
  )
}

function ShopRow({ shop, excluded, onToggle }: { shop: BrochureShop; excluded: boolean; onToggle: (include: boolean) => void }) {
  const absent = shop.unknown ? 'inconnue du module Social' : !shop.address ? 'adresse manquante' : null
  return (
    <label className={`bro-shop-row${excluded ? ' is-off' : ''}`}>
      <input type="checkbox" checked={!excluded} onChange={(event) => onToggle(event.target.checked)} />
      <span className="bro-shop-row__name">
        {shop.name}
        <small>{absent ? <span className="bro-tag bro-tag--stop">{absent}</span> : shop.address}</small>
      </span>
      <span className="bro-shop-row__langs">
        {shop.langs.map((lang) => (
          <span key={lang} className="bro-tag">
            {lang.toUpperCase()}
          </span>
        ))}
      </span>
    </label>
  )
}
