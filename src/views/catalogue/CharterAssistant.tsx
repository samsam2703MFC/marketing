import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../lib/api/module'
import type {
  CatalogueBackTemplate,
  CatalogueBrandPage,
  CatalogueBrandPages,
  CatalogueBrandSlot,
  CatalogueBrandTemplate,
  CatalogueCharter,
  CatalogueCharterChecks,
  CatalogueCharterShop,
  CatalogueCharterVersion,
  CatalogueCover,
  CatalogueCoverTemplate,
  CatalogueDocPage,
  CatalogueDocument,
  CatalogueFormat,
  CatalogueLang,
  CatalogueOwnBrandPages,
  MediaAsset,
} from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import { seasonLabel } from '../builder/illustrations'
import { CatalogueSheet, FORMAT_MM, catalogueCss } from './CataloguePages'
import { MediaPicker } from './MediaPicker'
import './charter-assistant.css'

/**
 * L'assistant des pages de la marque (maquettes A1-A4, client 15/11/2026 : « les deux, garde les 3 gabarits ») : les
 * quatre pages que chaque catalogue reçoit de la marque — couverture (une par gamme), page 2, avant-dernière, dernière
 * page —, en cinq étapes avec leur aperçu en direct, FR et NL.
 *
 * Ce que l'assistant écrit est un BROUILLON (enregistré tout seul, « Brouillon enregistré ») : les catalogues lisent la
 * charte PUBLIÉE. « Publier pour tous les catalogues » (étape 5) en fait une nouvelle version, que prennent les
 * catalogues pas encore marqués imprimés ; un catalogue imprimé garde la version de son impression. L'historique
 * permet de revenir à une version d'avant.
 */

const MM = 96 / 25.4

type Step = 1 | 2 | 3 | 4 | 5
/** Une étape de l'assistant (1 couverture · 2 page 2 · 3 avant-dernière · 4 dernière page · 5 récapitulatif). */
export type CharterStep = Step

const STEPS: Array<{ n: Step; label: string; hint: string; next: string }> = [
  { n: 1, label: 'Couverture', hint: 'page 1 · une par gamme', next: 'Page 2' },
  { n: 2, label: 'Page 2', hint: 'le mot de la boulangerie', next: 'Avant-dernière' },
  { n: 3, label: 'Avant-dernière', hint: 'nos services', next: 'Dernière page' },
  { n: 4, label: 'Dernière page', hint: 'QR · boutique', next: 'Récapitulatif' },
  { n: 5, label: 'Récapitulatif', hint: 'puis publier', next: '' },
]

const COVER_TEMPLATES: Array<{ t: CatalogueCoverTemplate; label: string; hint: string }> = [
  { t: 'A', label: 'Pleine couleur', hint: 'titre sur le bordeaux' },
  { t: 'B', label: 'Illustration', hint: 'papier, dessin au centre' },
  { t: 'C', label: 'Photo', hint: 'visuel en haut, bandeau' },
]

const BRAND_TEMPLATES: Array<{ t: CatalogueBrandTemplate; label: string; hint: string }> = [
  { t: 'A', label: 'Texte seul', hint: 'le texte et le logo' },
  { t: 'B', label: 'Image en haut', hint: 'photo, puis le texte' },
  { t: 'C', label: 'Image en bas', hint: 'texte, photo pleine largeur' },
]

const BACK_TEMPLATES: Array<{ t: CatalogueBackTemplate; label: string; hint: string }> = [
  { t: 'A', label: 'QR et boutique', hint: 'le QR à gauche, une phrase à droite, la boutique en pied' },
  { t: 'B', label: 'Boutique en avant', hint: 'QR plus petit, adresse et horaires en grand' },
]

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href

const dateFr = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

/** Le dessin de saison reconnu dans un nom de gamme (la règle de `seasonSlug` de l'API). */
function seasonOf(name: string): string | null {
  const flat = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  const found = (
    [
      ['noel', 'noel'], ['nicolas', 'saint-nicolas'], ['epiphanie', 'epiphanie'], ['chandeleur', 'chandeleur'], ['valentin', 'saint-valentin'],
      ['paque', 'paques'], ['pascal', 'paques'], ['mere', 'fete-des-meres'], ['printan', 'printemps'], ['estival', 'ete'], ['automn', 'automne'],
      ['hivern', 'hiver'], ['glace', 'glace'],
    ] as const
  ).find(([key]) => flat.includes(key))
  return found ? found[1] : null
}

const pick = (lang: CatalogueLang, fr: string, nl: string): string => (lang === 'nl' ? nl || fr : fr)

/** La couverture telle que l'API la composera (`CatalogueService::coverPage`). */
function coverPage(cover: CatalogueCover, lang: CatalogueLang, shop: CatalogueCharterShop | null): Extract<CatalogueDocPage, { kind: 'cover' }> {
  const imageUrl = cover.visual === 'media' ? (cover.imageUrl ?? null) : cover.visual === null ? (cover.imageUrl ?? null) : null
  const slug = cover.visual === 'none' ? null : (cover.illustration ?? seasonOf(cover.titleFr))
  return {
    kind: 'cover',
    locked: true,
    title: pick(lang, cover.titleFr, cover.titleNl) || '—',
    subtitle: pick(lang, cover.subtitleFr, cover.subtitleNl),
    // Le nom de la boutique sous le titre, sauf si la couverture le masque.
    eyebrow: cover.showShop === false ? null : shop?.name ?? null,
    imageUrl,
    template: cover.template,
    // « La gamme » : le texte choisi (sinon celui d'une gamme), masqué si la couverture le masque (v1.12).
    kicker: (() => {
      if (cover.look?.kicker?.show === false) return null
      const custom = pick(lang, cover.kickerFr ?? '', cover.kickerNl ?? '')
      return custom !== '' ? custom : cover.gamme !== null ? (lang === 'nl' ? 'Het gamma' : 'La gamme') : null
    })(),
    look: api.docLook('cover', cover.look),
    drawing: imageUrl === null && slug ? `img/print/${slug}.png` : null,
    titleFont: cover.titleFont ?? null,
    titleColor: api.CATALOGUE_COVER_COLORS.find((c) => c.id === cover.titleColor)?.hex ?? null,
    subtitleFont: cover.subtitleFont ?? null,
    subtitleColor: api.CATALOGUE_COVER_COLORS.find((c) => c.id === cover.subtitleColor)?.hex ?? null,
    noVisual: cover.visual === 'none',
  }
}

function brandPage(slot: 'page2' | 'penultimate', content: CatalogueBrandPage, lang: CatalogueLang): Extract<CatalogueDocPage, { kind: 'brand' }> {
  return {
    kind: 'brand',
    locked: true,
    slot,
    title: pick(lang, content.titleFr, content.titleNl),
    text: pick(lang, content.textFr, content.textNl),
    imageUrl: content.template === 'A' ? null : (content.imageUrl ?? null),
    template: content.template,
    look: api.docLook(slot, content.look),
  }
}

function backPage(charter: CatalogueCharter, lang: CatalogueLang, shop: CatalogueCharterShop | null): Extract<CatalogueDocPage, { kind: 'back' }> {
  return {
    kind: 'back',
    locked: true,
    title: pick(lang, charter.back.titleFr, charter.back.titleNl),
    text: pick(lang, charter.back.textFr, charter.back.textNl),
    qrUrl: shop?.qrUrl ?? null,
    host: shop?.host ?? null,
    shop: shop ? { id: shop.id, erpShopId: shop.erpShopId, name: shop.name, address: shop.address, hours: lang === 'nl' ? shop.hoursNl || shop.hours : shop.hours, phone: shop.phone, email: shop.email, phone2: shop.phone2 } : null,
    template: charter.back.template,
    look: api.docLook('back', charter.back.look),
  }
}

/** Les quatre pages de la marque, composées dans le navigateur pour l'aperçu en direct. */
function brandDoc(charter: CatalogueCharter, cover: CatalogueCover, lang: CatalogueLang, shop: CatalogueCharterShop | null, format: CatalogueFormat): CatalogueDocument {
  return {
    catalogue: { id: 0, title: '', format, owner: 'marque' },
    version: { shop: null, lang },
    // Le logo de la boutique de l'aperçu (charte, « Rempli par chaque boutique ») remplace celui de la charte, comme au document.
    charter: { logoUrl: shop?.logoUrl ?? charter.logoUrl, colors: charter.colors },
    pages: [coverPage(cover, lang, shop), brandPage('page2', charter.page2, lang), brandPage('penultimate', charter.penultimate, lang), backPage(charter, lang, shop)],
    warnings: [],
  }
}

/** Une page, au format, réduite à `width` pixels. */
function Page({ doc, index, width }: { doc: CatalogueDocument; index: number; width: number }) {
  const size = FORMAT_MM[doc.catalogue.format]
  const zoom = width / (size.w * MM)
  return (
    <div className="cha-page" style={{ width, height: size.h * MM * zoom }}>
      <span style={{ zoom }}>
        <CatalogueSheet doc={doc} index={index} mode="preview" />
      </span>
    </div>
  )
}

/** Une vignette de gabarit (choix), dessinée simplement. */
function TemplateMini({ kind, t }: { kind: 'cover' | 'brand' | 'back'; t: string }) {
  if (kind === 'cover') {
    if (t === 'A') return <span className="cha-mini cha-mini--fill"><i className="l1" /><i className="l2" /></span>
    if (t === 'B') return <span className="cha-mini"><img src={asset('img/print/noel.png')} alt="" /><i className="bar" /><i className="gold" /></span>
    return <span className="cha-mini"><i className="photo" /><i className="band" /></span>
  }
  if (kind === 'brand') {
    if (t === 'A') return <span className="cha-mini"><i className="bar bar--top" /><i className="lines" /></span>
    if (t === 'B') return <span className="cha-mini"><i className="photo photo--top" /><i className="bar bar--mid" /><i className="lines lines--low" /></span>
    return <span className="cha-mini"><i className="bar bar--top" /><i className="lines lines--short" /><i className="photo photo--bottom" /></span>
  }
  return t === 'A' ? <span className="cha-mini cha-mini--wide"><i className="qr" /><i className="foot" /></span> : <span className="cha-mini cha-mini--wide"><i className="qr qr--small" /><i className="block" /></span>
}

function Choice<T extends string>({ items, value, onChange, kind }: { items: Array<{ t: T; label: string; hint: string }>; value: T; onChange: (t: T) => void; kind: 'cover' | 'brand' | 'back' }) {
  return (
    <div className={`cha-choices cha-choices--${items.length}`}>
      {items.map((item) => (
        <button key={item.t} type="button" className={`cha-choice${value === item.t ? ' is-on' : ''}`} onClick={() => onChange(item.t)} aria-pressed={value === item.t}>
          <TemplateMini kind={kind} t={item.t} />
          <span className="cha-choice__text">
            <span className="cha-choice__l">{`${item.t} · ${item.label}`}</span>
            <span className="cha-choice__s">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * La police et la couleur d'un texte de la couverture (17/11/2026, Sam : « éditer en fonction du design system la typo
 * — Gotham, Vank, Deva — et la couleur — abricot, rubis… ») ; « A » garde la couleur du gabarit.
 *
 * Pas de choix « Gabarit » pour la police (Sam, 17/11 : « take off gabarit typo ») : la police du gabarit est l'une des
 * trois — Vank pour le titre, Gotham pour le sous-titre — et c'est elle qui est montrée choisie. La choisir enregistre
 * l'absence de choix (`null`) : le texte s'imprime exactement comme le gabarit le règle.
 */
function TextStyle({
  label,
  font = null,
  fallback = 'gotham',
  color = null,
  onChange,
  show,
  onShow,
  hint,
}: {
  label: string
  font?: api.CatalogueCoverFont | null
  /** La police du gabarit pour ce texte. */
  fallback?: api.CatalogueCoverFont
  color?: api.CatalogueCoverColor | null
  /** Sans `onChange` : pas de police ni de couleur (un logo, un QR code, une ligne des coordonnées). */
  onChange?: (patch: { font?: api.CatalogueCoverFont | null; color?: api.CatalogueCoverColor | null }) => void
  /** Afficher / Masquer l'élément (v1.12, 21/11/2026 : « toutes les données éditables, visibles ou pas »). */
  show?: boolean
  onShow?: (show: boolean) => void
  hint?: string
}) {
  const current = font ?? fallback
  return (
    <div className={`cha-style${show === false ? ' is-hidden' : ''}`}>
      <span className="cha-style__l">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {onShow ? (
        <span className="bro-seg cha-style__show" role="group" aria-label={`Afficher ou masquer — ${label}`}>
          <button type="button" className={show !== false ? 'is-on' : ''} onClick={() => onShow(true)}>
            Afficher
          </button>
          <button type="button" className={show === false ? 'is-on' : ''} onClick={() => onShow(false)}>
            Masquer
          </button>
        </span>
      ) : null}
      {onChange ? (
        <>
      <span className="bro-seg cha-style__fonts" role="group" aria-label={`Police — ${label}`}>
        {api.CATALOGUE_COVER_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={current === f.id ? 'is-on' : ''}
            style={{ fontFamily: f.css }}
            onClick={() => onChange({ font: f.id === fallback ? null : f.id })}
            title={f.id === fallback ? `${f.label} — la police du gabarit` : f.label}
          >
            {f.label}
          </button>
        ))}
      </span>
      <span className="cha-swatches" role="group" aria-label={`Couleur — ${label}`}>
        <button type="button" className={`cha-swatch cha-swatch--auto${color === null ? ' is-on' : ''}`} onClick={() => onChange({ color: null })} title="La couleur du gabarit" aria-label="Couleur du gabarit">
          A
        </button>
        {api.CATALOGUE_COVER_COLORS.map((c) => (
          <button key={c.id} type="button" className={`cha-swatch${color === c.id ? ' is-on' : ''}`} style={{ background: c.hex }} onClick={() => onChange({ color: c.id })} title={c.label} aria-label={c.label} />
        ))}
      </span>
        </>
      ) : null}
    </div>
  )
}

/** La luminance relative d'une couleur #RRGGBB (WCAG), pour le contraste du texte sur le fond des pages. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/**
 * Les couleurs de tous les catalogues, choisies parmi celles de la marque (17/11/2026, Sam : « je dois pouvoir choisir le
 * fond de couleur des pages via les couleurs de la marque ») : le fond des pages (papier), la principale (bandeaux,
 * titres), l'accent (filets), le texte. « + » garde une autre couleur. Un texte peu lisible sur le fond est dit.
 */
function ColorsCard({ colors, onChange }: { colors: CatalogueCharter['colors']; onChange: (key: keyof CatalogueCharter['colors'], hex: string) => void }) {
  const roles: Array<[keyof CatalogueCharter['colors'], string, string]> = [
    ['secondary', 'Fond des pages', 'le papier de toutes les pages'],
    ['primary', 'Principale', 'bandeaux, titres, prix'],
    ['accent', 'Accent', 'filets, « La gamme »'],
    ['ink', 'Texte', 'noms, textes'],
  ]
  const ratio = contrast(colors.secondary, colors.ink)
  return (
    <section className="cha-card">
      <div className="cha-lab">Couleurs de tous les catalogues</div>
      <div className="cha-styles cha-styles--flat">
        {roles.map(([key, label, hint]) => {
          const inPalette = api.CATALOGUE_COVER_COLORS.some((c) => c.hex === colors[key].toUpperCase())
          return (
            <div key={key} className="cha-style">
              <span className="cha-style__l" title={hint}>
                {label}
              </span>
              <span className="cha-swatches cha-swatches--left" role="group" aria-label={label}>
                {api.CATALOGUE_COVER_COLORS.map((c) => (
                  <button key={c.id} type="button" className={`cha-swatch${colors[key].toUpperCase() === c.hex ? ' is-on' : ''}`} style={{ background: c.hex }} onClick={() => onChange(key, c.hex)} title={c.label} aria-label={c.label} />
                ))}
                <label className={`cha-swatch cha-swatch--other${inPalette ? '' : ' is-on'}`} title="Une autre couleur" style={inPalette ? undefined : { background: colors[key] }}>
                  {inPalette ? '+' : ''}
                  <input type="color" value={colors[key]} onChange={(event) => onChange(key, event.target.value.toUpperCase())} />
                </label>
              </span>
              <span className="cha-style__hint">{hint}</span>
            </div>
          )
        })}
      </div>
      {ratio < 4.5 ? <p className="cha-note cha-note--warn">Le texte se lit mal sur ce fond (contraste {ratio.toFixed(1)} : 1, 4,5 au moins) : choisissez un fond clair, ou un texte plus foncé ou plus clair.</p> : null}
    </section>
  )
}

/** Une ligne du tableau « Rempli par chaque boutique » que l'on saisit : enregistrée en quittant le champ (ou Entrée). */
function ShopInput({ label, value, placeholder, max, onSave }: { label: string; value: string; placeholder: string; max: number; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft.trim() !== value) onSave(draft.trim())
  }
  return (
    <tr>
      <td>{label}</td>
      <td>
        <input
          className="cha-shopin"
          value={draft}
          maxLength={max}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      </td>
      <td>
        <span className={`cha-dot${draft.trim() ? '' : ' cha-dot--off'}`} /> Saisi ici · cette boutique
      </td>
    </tr>
  )
}

function Field({ label, value, onChange, placeholder, area = false, max = 240 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean; max?: number }) {
  return (
    <label className="cha-field">
      <span>{label}</span>
      {area ? (
        <textarea rows={7} value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  )
}

// --- Mode « ce catalogue » (21/11/2026) ---------------------------------------------------------------

/** Ses 4 pages (les siennes, sinon celles de la charte publiée) sous la forme d'une charte à une seule couverture. */
function charterOf(read: CatalogueBrandPages): CatalogueCharter {
  return {
    logoMediaId: null,
    logoUrl: read.logoUrl,
    colors: read.colors,
    covers: [{ ...(read.own.cover ?? read.common.cover), gamme: read.gamme }],
    back: read.own.back ?? read.common.back,
    page2: read.own.page2 ?? read.common.page2,
    penultimate: read.own.penultimate ?? read.common.penultimate,
    updatedAt: null,
  }
}

const COVER_KEYS = ['titleFr', 'titleNl', 'subtitleFr', 'subtitleNl', 'mediaId', 'template', 'visual', 'illustration', 'titleFont', 'titleColor', 'subtitleFont', 'subtitleColor', 'showShop', 'kickerFr', 'kickerNl', 'look']
const PAGE_KEYS = ['titleFr', 'titleNl', 'textFr', 'textNl', 'mediaId', 'template', 'look']
const BACK_KEYS = ['titleFr', 'titleNl', 'textFr', 'textNl', 'template', 'look']

/** Une valeur comparable : les clés d'un objet triées (l'ordre d'un `look` modifié n'est pas celui de l'API). */
const canon = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y))) : v)

const same = (a: object, b: object, keys: string[]): boolean =>
  keys.every((k) => canon((a as Record<string, unknown>)[k]) === canon((b as Record<string, unknown>)[k]))

/** Les pages qui diffèrent de celles de la charte publiée sont à lui ; les autres la suivent (null). */
function ownOf(charter: CatalogueCharter, common: CatalogueBrandPages['common']): CatalogueOwnBrandPages {
  const cover = charter.covers[0]
  return {
    cover: same(cover, common.cover, COVER_KEYS) ? null : cover,
    page2: same(charter.page2, common.page2, PAGE_KEYS) ? null : charter.page2,
    penultimate: same(charter.penultimate, common.penultimate, PAGE_KEYS) ? null : charter.penultimate,
    back: same(charter.back, common.back, BACK_KEYS) ? null : charter.back,
  }
}

const SLOT_OF_STEP: Record<number, CatalogueBrandSlot> = { 1: 'cover', 2: 'page2', 3: 'penultimate', 4: 'back' }

/**
 * Ouvert depuis un catalogue (21/11/2026, Sam : « je dois pouvoir aussi éditer les templates de marque ») : `step` est
 * l'étape de la page cliquée, `gammes` celles du catalogue — la couverture ouverte est la sienne, par la règle de l'API
 * (la première de ses gammes qui a une couverture, sinon la générique) — et `backLabel` le lien de retour.
 */
export default function CharterAssistant({ onBack, step: initialStep, gammes: catalogueGammes, backLabel = '‹ Catalogues', doneLabel = 'Enregistrer et revenir au catalogue', catalogue }: {
  onBack: () => void
  step?: Step
  gammes?: number[]
  backLabel?: string
  /** Mode « ce catalogue », dernière étape : le bouton qui enregistre et repart (au catalogue, ou à la liste). */
  doneLabel?: string
  /**
   * Mode « ce catalogue » (21/11/2026, Sam : « je ne dois pas modifier tout, mais chaque catalogue créé par la
   * marque ») : les 4 pages de CE catalogue de la marque. Une page modifiée devient la sienne ; les autres suivent la
   * charte publiée. Enregistré tout seul, sans publication ; ni gammes, ni logo, ni couleurs (communs à tous).
   */
  catalogue?: { id: number; title: string }
}) {
  /** Mode « ce catalogue » : les pages de la charte qu'il lit, pour savoir lesquelles sont à lui et y revenir. */
  const common = useRef<CatalogueBrandPages['common'] | null>(null)
  const loaded = useAsync<CatalogueCharter>(
    () => (catalogue
      ? api.getCatalogueBrandPages(catalogue.id).then((read) => {
        common.current = read.common
        return charterOf(read)
      })
      : api.getCatalogueCharter()),
    [],
  )
  const webshop = useAsync(() => api.getWebshopProducts([]), [])
  const recent = useAsync(() => api.listMedia({ kind: 'image', perPage: 3 }), [])
  const [checks, setChecks] = useState<CatalogueCharterChecks | null>(null)
  const [checksError, setChecksError] = useState<string | null>(null)
  const [versions, setVersions] = useState<CatalogueCharterVersion[] | null>(null)
  const [charter, setCharter] = useState<CatalogueCharter | null>(null)
  const [step, setStep] = useState<Step>(() => {
    if (initialStep) return initialStep
    const n = Number(new URLSearchParams(window.location.search).get('etape'))
    return (n >= 1 && n <= 5 ? n : 1) as Step
  })
  const [lang, setLang] = useState<CatalogueLang>('fr')
  const [format, setFormat] = useState<CatalogueFormat>('A5')
  const [coverIndex, setCoverIndex] = useState(0)
  const [shopId, setShopId] = useState<number | null>(null)
  const [picking, setPicking] = useState<null | 'cover' | 'page2' | 'penultimate' | 'logo' | 'shopLogo'>(null)
  const [shopSave, setShopSave] = useState<{ status: 'idle' | 'saving' | 'error'; text?: string }>({ status: 'idle' })
  const [save, setSave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ status: 'idle' })
  const [published, setPublished] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [allDrawings, setAllDrawings] = useState(false)
  const dirty = useRef(false)
  /** Modifié pendant cette visite et pas encore publié : les catalogues montrent toujours la version publiée. */
  const unpublished = useRef(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (loaded.data && !charter) {
      setCharter(loaded.data)
      const covers = loaded.data.covers
      if (catalogue) {
        setCoverIndex(0)
      } else if (catalogueGammes) {
        // Ouvert depuis un catalogue : sa couverture.
        const own = catalogueGammes.map((g) => covers.findIndex((c) => c.gamme === g)).find((i) => i >= 0)
        setCoverIndex(own ?? Math.max(0, covers.findIndex((c) => c.gamme === null)))
      } else if (covers.length > 1) {
        // Ouvert sur la couverture d'une gamme du webshop (la première après la générique), comme la maquette.
        setCoverIndex(1)
      }
    }
  }, [loaded.data, charter])

  function readChecks() {
    api.getCatalogueCharterChecks().then(
      (read) => {
        setChecks(read)
        setChecksError(null)
        setShopId((current) => current ?? [...read.shops].sort((a, b) => a.missing.length - b.missing.length)[0]?.id ?? null)
      },
      (cause: unknown) => setChecksError(message(cause)),
    )
  }
  useEffect(readChecks, [])
  useEffect(() => {
    if (step === 5) api.listCatalogueCharterVersions().then(setVersions, () => setVersions([]))
  }, [step])

  // Le brouillon s'enregistre tout seul, 0,8 s après la dernière modification.
  function change(update: (current: CatalogueCharter) => CatalogueCharter) {
    setCharter((current) => (current ? update(current) : current))
    dirty.current = true
    if (!catalogue) unpublished.current = true
    setSave({ status: 'idle' })
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 800)
  }
  const latest = useRef<CatalogueCharter | null>(null)
  latest.current = charter

  async function flush(): Promise<boolean> {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const current = latest.current
    if (!current || !dirty.current) return true
    dirty.current = false
    setSave({ status: 'saving' })
    try {
      if (catalogue) {
        if (!common.current) return false
        const read = await api.saveCatalogueBrandPages(catalogue.id, ownOf(current, common.current))
        common.current = read.common
      } else {
        const saved = await api.saveCatalogueCharter(current)
        setCharter((now) => (now ? { ...now, publication: saved.publication, updatedAt: saved.updatedAt } : saved))
      }
      setSave({ status: 'saved' })
      return true
    } catch (cause) {
      dirty.current = true
      setSave({ status: 'error', text: message(cause) })
      return false
    }
  }

  /** Quitter l'assistant : le brouillon est enregistré ; s'il n'est pas publié, le dire avant de partir. */
  async function leave() {
    await flush()
    if (
      unpublished.current &&
      !window.confirm(
        'Vos changements sont enregistrés en brouillon, mais pas encore publiés : les catalogues montrent toujours la version publiée.\n\n'
          + 'OK : partir quand même. Annuler : rester et publier (étape 5).',
      )
    ) {
      void go(5)
      return
    }
    onBack()
  }

  /** « Enregistrer » (21/11/2026) : enregistre tout de suite ce qui est à l'écran et le dit, avec l'heure. */
  async function saveNow() {
    dirty.current = true
    if (await flush()) {
      const time = new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
      setSave({ status: 'saved', text: catalogue ? `✓ Enregistré à ${time}` : `✓ Brouillon enregistré à ${time}` })
    }
  }

  async function go(next: Step) {
    if (!(await flush())) return
    setStep(next)
    if (next >= 4) readChecks()
    window.scrollTo({ top: 0 })
  }

  const gammes = webshop.data?.gammes ?? []
  const shops = checks?.shops ?? []
  const shop = shops.find((s) => s.id === shopId) ?? shops[0] ?? null
  /** Ce que la boutique imprime en plus à la dernière page (second téléphone, webshop direct, logo) : enregistré tout de suite. */
  function saveShop(patch: { phone2?: string; webshopUrl?: string; logoMediaId?: number | null }) {
    if (!shop) return
    setShopSave({ status: 'saving' })
    api.saveCatalogueShop(shop.id, patch).then(
      (row) => {
        setChecks((current) => (current ? { ...current, shops: current.shops.map((s) => (s.id === row.id ? row : s)) } : current))
        setShopSave({ status: 'idle' })
      },
      (cause: unknown) => setShopSave({ status: 'error', text: message(cause) }),
    )
  }

  const doc = useMemo(
    () => (charter ? brandDoc(charter, charter.covers[coverIndex] ?? charter.covers[0], lang, shop, format) : null),
    [charter, coverIndex, lang, shop, format],
  )

  if (loaded.error) return <p className="error">{loaded.error}</p>
  if (!charter || !doc) return <p className="muted">Lecture de la charte…</p>

  const cover = charter.covers[coverIndex] ?? charter.covers[0]
  const gammeName = (id: number | null): string => (id === null ? 'Générique' : seasonLabel(gammes.find((g) => g.id === id)?.name ?? cover.titleFr))

  function setCover(patch: Partial<CatalogueCover>) {
    change((c) => ({ ...c, covers: c.covers.map((one, i) => (i === coverIndex ? { ...one, ...patch } : one)) }))
  }
  function addCover(gamme: number) {
    const name = seasonLabel(gammes.find((g) => g.id === gamme)?.name ?? '')
    const next = charter?.covers.length ?? 0
    change((c) => ({
      ...c,
      covers: [...c.covers, { gamme, titleFr: name, titleNl: '', subtitleFr: '', subtitleNl: '', mediaId: null, imageUrl: null, template: 'B', visual: 'illustration', illustration: seasonOf(name) }],
    }))
    setCoverIndex(next)
  }
  function setBrand(slot: 'page2' | 'penultimate', patch: Partial<CatalogueBrandPage>) {
    change((c) => ({ ...c, [slot]: { ...c[slot], ...patch } }))
  }
  /** Un élément d'une page (v1.12) : affiché ou masqué, sa police, sa couleur. */
  function setLook(kind: api.CatalogueLookKind, element: string, patch: Partial<api.CatalogueLookEntry>) {
    const merge = (look: api.CatalogueLook | undefined): api.CatalogueLook => {
      const full = api.fullLook(kind, look)
      return { ...full, [element]: { ...full[element], ...patch } }
    }
    if (kind === 'cover') setCover({ look: merge(cover.look) })
    else if (kind === 'back') change((c) => ({ ...c, back: { ...c.back, look: merge(c.back.look) } }))
    else change((c) => ({ ...c, [kind]: { ...c[kind], look: merge(c[kind].look) } }))
  }
  const lookOf = (kind: api.CatalogueLookKind, look: api.CatalogueLook | undefined) => api.fullLook(kind, look)
  /** Une ligne « élément » : afficher/masquer et, pour un texte, sa police et sa couleur. */
  const lookRow = (kind: api.CatalogueLookKind, look: api.CatalogueLook | undefined, element: string, label: string, fallback: api.CatalogueCoverFont = 'gotham', hint?: string) => {
    const e = lookOf(kind, look)[element]
    const type = api.CATALOGUE_LOOK[kind][element]
    return (
      <TextStyle
        key={element}
        label={label}
        hint={hint}
        show={e.show}
        onShow={type === 'style' ? undefined : (v) => setLook(kind, element, { show: v })}
        font={e.font}
        color={e.color}
        fallback={fallback}
        onChange={type === 'show' ? undefined : (p) => setLook(kind, element, p)}
      />
    )
  }
  /** Mode « ce catalogue » : la page reprend celle de la charte publiée (et la suit de nouveau). */
  function backToCommon(slot: CatalogueBrandSlot) {
    const base = common.current
    if (!base) return
    change((c) => (slot === 'cover' ? { ...c, covers: [{ ...base.cover, gamme: c.covers[0]?.gamme ?? null }] } : { ...c, [slot]: base[slot] }))
  }

  async function publish(fromVersion?: number) {
    if (!(await flush())) return
    const affected = checks?.catalogues.affected ?? 0
    const text = fromVersion
      ? `Revenir à la version ${fromVersion} ? Elle est republiée pour les ${affected} catalogue(s) pas encore imprimé(s).`
      : `Publier ces 4 pages pour tous les catalogues ? ${affected} catalogue(s) pas encore imprimé(s) les prennent à leur prochain aperçu et à leur prochain PDF ; ${checks?.catalogues.printed ?? 0} catalogue(s) imprimé(s) gardent leur version.`
    if (!window.confirm(text)) return
    setPublishing(true)
    try {
      const done = await api.publishCatalogueCharter(fromVersion ? { fromVersion } : {})
      unpublished.current = false
      setPublished(`Version ${done.version} publiée le ${dateFr(done.publishedAt)} : ${done.catalogues.affected} catalogue(s) la prennent.`)
      const fresh = await api.getCatalogueCharter()
      setCharter(fresh)
      setVersions(await api.listCatalogueCharterVersions())
      readChecks()
    } catch (cause) {
      setPublished(`Publication refusée : ${message(cause)}`)
    } finally {
      setPublishing(false)
    }
  }

  const coverStatus = (c: CatalogueCover): { label: string; tone: '' | 'ok' | 'warn' } =>
    !c.titleNl || (c.subtitleFr && !c.subtitleNl) ? { label: 'NL à écrire', tone: 'warn' } : { label: 'Faite', tone: 'ok' }
  const stepDone = (n: Step): boolean => n < step
  const publication = charter.publication

  // --- étapes ---------------------------------------------------------------------------------------
  const drawings = (() => {
    const first = cover.illustration ?? seasonOf(cover.titleFr)
    const all = [...new Set([...(first ? [first] : []), ...api.SEASON_DRAWINGS])]
    return allDrawings ? all : all.slice(0, 3)
  })()

  const coverStep = (
    <>
      {catalogue ? null : <section className="cha-card">
        <div className="cha-lab">
          Couverture de quelle gamme ? <span className="cha-tag">une couverture par gamme du webshop</span>
        </div>
        <div className="cha-gammes">
          {charter.covers.map((c, i) => {
            const st = coverStatus(c)
            return (
              <button key={i} type="button" className={`cha-gamme${i === coverIndex ? ' is-on' : ''}`} onClick={() => setCoverIndex(i)}>
                <span className="cha-gamme__t">{c.gamme === null ? 'Générique' : `Gamme ${gammeName(c.gamme)}`}</span>
                <span className="cha-gamme__s">{c.gamme === null ? 'par défaut · quand la gamme n’a pas la sienne' : i === coverIndex ? 'en cours' : ' '}</span>
                <span className={`cha-tag cha-tag--${st.tone}`}>{st.label}</span>
              </button>
            )
          })}
          {gammes
            .filter((g) => !charter.covers.some((c) => c.gamme === g.id))
            .slice(0, Math.max(0, 4 - charter.covers.length))
            .map((g) => (
              <button key={g.id} type="button" className="cha-gamme" onClick={() => addCover(g.id)}>
                <span className="cha-gamme__t">{`Gamme ${seasonLabel(g.name)}`}</span>
                <span className="cha-gamme__s">&nbsp;</span>
                <span className="cha-tag">À faire</span>
              </button>
            ))}
          {gammes.some((g) => !charter.covers.some((c) => c.gamme === g.id)) ? (
            <label className="cha-gamme cha-gamme--add">
              <span>＋ Une gamme du webshop</span>
              <select value="" onChange={(event) => event.target.value && addCover(Number(event.target.value))}>
                <option value="">Choisir…</option>
                {gammes
                  .filter((g) => !charter.covers.some((c) => c.gamme === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {seasonLabel(g.name)}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        {webshop.error ? <p className="cha-warn">Gammes du webshop illisibles : {webshop.error}</p> : null}
        {coverIndex > 0 ? (
          <button type="button" className="linklike cha-remove" onClick={() => { change((c) => ({ ...c, covers: c.covers.filter((_, i) => i !== coverIndex) })); setCoverIndex(0) }}>
            Retirer la couverture de cette gamme (la générique la remplace)
          </button>
        ) : null}
      </section>}

      <section className="cha-card">
        <div className="cha-lab">
          Visuel <span className="cha-grow" />
          <span className="bro-seg" role="group" aria-label="Visuel">
            <button type="button" className={cover.visual === 'illustration' || cover.visual === null ? 'is-on' : ''} onClick={() => setCover({ visual: 'illustration', illustration: cover.illustration ?? seasonOf(cover.titleFr) })}>
              Illustration de saison
            </button>
            <button type="button" className={cover.visual === 'media' ? 'is-on' : ''} onClick={() => setPicking('cover')}>
              Médiathèque
            </button>
            <button type="button" className={cover.visual === 'none' ? 'is-on' : ''} onClick={() => setCover({ visual: 'none' })}>
              Sans visuel
            </button>
          </span>
        </div>
        <div className={`cha-visuals${allDrawings ? ' cha-visuals--all' : ''}`}>
          {drawings.map((slug) => (
            <button
              key={slug}
              type="button"
              className={`cha-visual${cover.visual !== 'media' && cover.visual !== 'none' && (cover.illustration ?? seasonOf(cover.titleFr)) === slug ? ' is-on' : ''}`}
              title={slug}
              onClick={() => setCover({ visual: 'illustration', illustration: slug })}
            >
              <img src={asset(`img/print/${slug}.png`)} alt="" />
            </button>
          ))}
          {(recent.data?.items ?? []).map((m) => (
            <button key={m.id} type="button" className={`cha-visual cha-visual--photo${cover.visual === 'media' && cover.mediaId === Number(m.id) ? ' is-on' : ''}`} title={m.name} onClick={() => setCover({ visual: 'media', mediaId: Number(m.id), imageUrl: m.url })}>
              <img src={m.thumbnailUrl ?? m.webUrl} alt="" />
            </button>
          ))}
          {cover.visual === 'media' && cover.mediaId !== null && !(recent.data?.items ?? []).some((m) => Number(m.id) === cover.mediaId) ? (
            <button type="button" className="cha-visual cha-visual--photo is-on" onClick={() => setPicking('cover')}>
              <img src={cover.imageUrl ?? ''} alt="" />
            </button>
          ) : null}
        </div>
        <p className="cha-note">
          Illustrations de saison de la marque (dessin au trait) · trois photos récentes de la médiathèque, « Médiathèque » ouvre le reste.{' '}
          <button type="button" className="linklike" onClick={() => setAllDrawings((v) => !v)}>
            {allDrawings ? 'Moins de dessins' : `Les ${api.SEASON_DRAWINGS.length} dessins`}
          </button>
        </p>
      </section>

      <section className="cha-card">
        <div className="cha-lab">Textes de la couverture</div>
        <div className="cha-grid2">
          <Field label="Titre FR" value={cover.titleFr} onChange={(v) => setCover({ titleFr: v })} />
          <Field label="Titre NL" value={cover.titleNl} placeholder="À écrire — sinon le titre français est imprimé" onChange={(v) => setCover({ titleNl: v })} />
          <Field label="Sous-titre FR" value={cover.subtitleFr} onChange={(v) => setCover({ subtitleFr: v })} />
          <Field label="Sous-titre NL" value={cover.subtitleNl} placeholder="À écrire" onChange={(v) => setCover({ subtitleNl: v })} />
        </div>
        <div className="cha-grid2">
          <Field label="Au-dessus du titre FR" value={cover.kickerFr ?? ''} placeholder="La gamme" onChange={(v) => setCover({ kickerFr: v })} />
          <Field label="Au-dessus du titre NL" value={cover.kickerNl ?? ''} placeholder="Het gamma" onChange={(v) => setCover({ kickerNl: v })} />
        </div>
      </section>

      <section className="cha-card">
        <div className="cha-lab">
          Chaque élément de la couverture <span className="cha-tag">afficher ou masquer · police · couleur</span>
        </div>
        <div className="cha-styles cha-styles--flat">
          {lookRow('cover', cover.look, 'logo', 'Logo')}
          {lookRow('cover', cover.look, 'kicker', 'Au-dessus du titre', 'gotham', cover.template === 'A' ? 'pas sur le gabarit A' : '« La gamme »')}
          <TextStyle
            label="Titre"
            show={lookOf('cover', cover.look).title.show}
            onShow={(v) => setLook('cover', 'title', { show: v })}
            font={cover.titleFont ?? null}
            fallback="vank"
            color={cover.titleColor ?? null}
            onChange={(p) => setCover({ ...('font' in p ? { titleFont: p.font } : {}), ...('color' in p ? { titleColor: p.color } : {}) })}
          />
          <TextStyle
            label="Sous-titre"
            show={lookOf('cover', cover.look).subtitle.show}
            onShow={(v) => setLook('cover', 'subtitle', { show: v })}
            font={cover.subtitleFont ?? null}
            fallback="gotham"
            color={cover.subtitleColor ?? null}
            onChange={(p) => setCover({ ...('font' in p ? { subtitleFont: p.font } : {}), ...('color' in p ? { subtitleColor: p.color } : {}) })}
          />
          <TextStyle
            label="Nom de la boutique"
            hint={`« L’Atelier By · ${shop?.name ?? 'Halle'} »`}
            show={cover.showShop !== false}
            onShow={(v) => setCover({ showShop: v })}
            font={lookOf('cover', cover.look).shop.font}
            color={lookOf('cover', cover.look).shop.color}
            fallback="gotham"
            onChange={(p) => setLook('cover', 'shop', p)}
          />
        </div>
        <p className="cha-note">Polices et couleurs de la marque (design system) ; la police montrée choisie est celle du gabarit, « A » garde sa couleur.</p>
      </section>

      <section className="cha-card">
        <div className="cha-lab">Gabarit de la couverture</div>
        <Choice kind="cover" items={COVER_TEMPLATES} value={cover.template} onChange={(t) => setCover({ template: t })} />
      </section>
    </>
  )

  const brandStep = (slot: 'page2' | 'penultimate') => {
    const content = charter[slot]
    const label = slot === 'page2' ? 'page 2' : 'avant-dernière page'
    const fit = api.BRAND_TEXT_FIT[content.template]
    const weight = Math.max(api.textWeight(content.textFr), api.textWeight(content.textNl))
    return (
      <>
        <section className="cha-card">
          <div className="cha-lab">{`Titre de la ${label}`}</div>
          <div className="cha-grid2">
            <Field label="Titre FR" value={content.titleFr} onChange={(v) => setBrand(slot, { titleFr: v })} />
            <Field label="Titre NL" value={content.titleNl} placeholder="À écrire — sinon le français est imprimé" onChange={(v) => setBrand(slot, { titleNl: v })} />
          </div>
        </section>
        <section className="cha-card">
          <div className="cha-lab">
            {`Chaque élément de la ${label}`} <span className="cha-tag">afficher ou masquer · police · couleur</span>
          </div>
          <div className="cha-styles cha-styles--flat">
            {lookRow(slot, content.look, 'logo', 'Logo', 'gotham', content.template === 'B' ? 'pas avec « image en haut »' : undefined)}
            {lookRow(slot, content.look, 'title', 'Titre', 'vank')}
            {lookRow(slot, content.look, 'text', 'Texte', 'gotham')}
            {slot === 'penultimate' ? lookRow(slot, content.look, 'legend', 'Allergènes', 'gotham', 'la légende des pictogrammes') : null}
          </div>
        </section>
        <section className="cha-card">
          <div className="cha-lab">
            Texte <span className="cha-grow" />
            <span className="cha-hint" title="Une ligne vide sépare deux paragraphes ; des lignes qui se suivent deviennent une liste à puces.">ⓘ mise en forme</span>
          </div>
          <div className="cha-grid2">
            <div>
              <Field area label="Texte FR" value={content.textFr} max={1200} onChange={(v) => setBrand(slot, { textFr: v })} />
              <div className="cha-count">{`${content.textFr.length.toLocaleString('fr-BE')} / 1 200 caractères`}</div>
              <div className={`cha-fit${weight > fit ? ' is-over' : ''}`}>
                <i style={{ width: `${Math.min(100, (weight / fit) * 100)}%` }} />
              </div>
              <p className={`cha-note${weight > fit ? ' cha-note--warn' : ''}`}>
                {weight > fit ? 'Trop long pour ce gabarit : la fin sera coupée. Raccourcissez, ou choisissez « texte seul ».' : 'Tient sur la page avec ce gabarit (A5 et A4).'}
              </p>
            </div>
            <div>
              <Field area label="Texte NL" value={content.textNl} max={1200} placeholder="À écrire" onChange={(v) => setBrand(slot, { textNl: v })} />
              {!content.textNl && content.textFr ? (
                <>
                  <p className="cha-tag cha-tag--warn cha-tag--block">NL à écrire : le français sera imprimé dans les versions néerlandaises</p>
                  <button type="button" className="btn btn--sm" onClick={() => setBrand(slot, { textNl: content.textFr })}>
                    Recopier le français pour traduire
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </section>
        <section className="cha-card">
          <div className="cha-lab">Image</div>
          <div className="cha-image">
            {content.imageUrl ? <img src={content.imageUrl} alt="" /> : <span className="cha-image__none">Sans image : le logo</span>}
            <div>
              <div className="cha-image__name">{content.imageUrl ? 'Photo de la médiathèque' : 'Aucune photo'}</div>
              <div className="cha-row">
                <button type="button" className="btn btn--sm" onClick={() => setPicking(slot)}>
                  {content.imageUrl ? 'Changer' : 'Choisir dans la médiathèque'}
                </button>
                {content.mediaId !== null ? (
                  <button type="button" className="btn btn--sm" onClick={() => setBrand(slot, { mediaId: null, imageUrl: null, template: 'A' })}>
                    Retirer (le logo seul)
                  </button>
                ) : null}
              </div>
              {content.template !== 'A' && !content.imageUrl ? <p className="cha-note cha-note--warn">Ce gabarit attend une image : sans elle, le logo seul est imprimé.</p> : null}
            </div>
          </div>
        </section>
        <section className="cha-card">
          <div className="cha-lab">{`Gabarit de la ${label}`}</div>
          <Choice kind="brand" items={BRAND_TEMPLATES} value={content.template} onChange={(t) => setBrand(slot, { template: t })} />
        </section>
      </>
    )
  }

  const missingFor = (s: CatalogueCharterShop, key: 'address' | 'hours' | 'phone' | 'qr'): boolean => s.missing.includes(key)
  const toComplete = shops.filter((s) => s.missing.some((m) => m !== 'qr'))
  const backStep = (
    <>
      <section className="cha-card">
        <div className="cha-lab">Ce que la marque écrit</div>
        <div className="cha-grid2">
          <Field label="Titre FR" value={charter.back.titleFr} onChange={(v) => change((c) => ({ ...c, back: { ...c.back, titleFr: v } }))} />
          <Field label="Titre NL" value={charter.back.titleNl} placeholder="À écrire" onChange={(v) => change((c) => ({ ...c, back: { ...c.back, titleNl: v } }))} />
          <Field label="Texte FR" value={charter.back.textFr} onChange={(v) => change((c) => ({ ...c, back: { ...c.back, textFr: v } }))} />
          <Field label="Texte NL" value={charter.back.textNl} placeholder="À écrire" onChange={(v) => change((c) => ({ ...c, back: { ...c.back, textNl: v } }))} />
        </div>
        <div className="cha-lab cha-lab--sub">Gabarit</div>
        <Choice kind="back" items={BACK_TEMPLATES} value={charter.back.template} onChange={(t) => change((c) => ({ ...c, back: { ...c.back, template: t } }))} />
      </section>

      <section className="cha-card">
        <div className="cha-lab">
          Chaque élément de la dernière page <span className="cha-tag">afficher ou masquer · police · couleur</span>
        </div>
        <div className="cha-styles cha-styles--flat">
          {lookRow('back', charter.back.look, 'logo', 'Logo')}
          {lookRow('back', charter.back.look, 'title', 'Titre', 'vank')}
          {lookRow('back', charter.back.look, 'text', 'Texte', 'gotham')}
          {lookRow('back', charter.back.look, 'qr', 'QR code', 'gotham', 'et l’adresse du webshop')}
          {lookRow('back', charter.back.look, 'shop', 'Coordonnées', 'gotham', 'le bloc de la boutique')}
          {lookRow('back', charter.back.look, 'address', 'Adresse')}
          {lookRow('back', charter.back.look, 'hours', 'Horaires')}
          {lookRow('back', charter.back.look, 'phone', 'Téléphone(s)')}
          {lookRow('back', charter.back.look, 'email', 'E-mail')}
        </div>
      </section>

      <section className="cha-card">
        <div className="cha-lab">
          Rempli par chaque boutique — rien à saisir <span className="cha-grow" />
          <span className="cha-lab__plain">Boutique de l’aperçu</span>
          <select className="cha-select" value={shop?.id ?? ''} onChange={(event) => setShopId(Number(event.target.value))}>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {checksError ? <p className="cha-warn">{checksError}</p> : null}
        {shop ? (
          <table className="cha-table">
            <thead>
              <tr>
                <th>Sur la page</th>
                <th>{`Valeur pour ${shop.name}`}</th>
                <th>Vient de</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Nom', `L’Atelier By — ${shop.name}`, 'ERP · fiche de la boutique', false],
                  ['Adresse', shop.address, 'TFBuddy · boutique', missingFor(shop, 'address')],
                  ['Horaires', lang === 'nl' ? shop.hoursNl || shop.hours : shop.hours, 'TFBuddy · boutique', missingFor(shop, 'hours')],
                  ['Téléphone', shop.phone, 'TFBuddy · boutique', missingFor(shop, 'phone')],
                  ['E-mail', shop.email, 'ERP · fiche de la boutique', !shop.email],
                  ['QR code', shop.qrUrl ? (shop.host ?? shop.qrUrl) : '', shop.webshopUrl ? 'Webshop direct, saisi ci-dessous' : 'Réglage webshop_url (Social)', missingFor(shop, 'qr')],
                ] as Array<[string, string, string, boolean]>
              ).map(([what, value, from, missing]) => (
                <tr key={what}>
                  <td>{what}</td>
                  <td>{missing || !value ? <span className="cha-tag cha-tag--warn">inconnu</span> : value}</td>
                  <td>
                    <span className={`cha-dot${missing ? ' cha-dot--warn' : ''}`} /> {from}
                  </td>
                </tr>
              ))}
              <ShopInput key={`p2-${shop.id}`} label="Téléphone 2" value={shop.phone2} placeholder="ex. 0470 12 34 56" max={40} onSave={(v) => saveShop({ phone2: v })} />
              <ShopInput key={`w-${shop.id}`} label="Webshop direct" value={shop.webshopUrl} placeholder="https://… l’adresse de la boutique sur le webshop (le QR y mène)" max={300} onSave={(v) => saveShop({ webshopUrl: v })} />
              <tr>
                <td>Logo</td>
                <td>
                  <span className="cha-shoplogo">
                    {shop.logoUrl ? <img src={shop.logoUrl} alt="" /> : <span className="cha-tag">celui de la charte</span>}
                    <button type="button" className="btn btn--sm" onClick={() => setPicking('shopLogo')}>
                      {shop.logoUrl ? 'Changer' : 'Choisir dans la médiathèque'}
                    </button>
                    {shop.logoUrl ? (
                      <button type="button" className="linklike" onClick={() => saveShop({ logoMediaId: null })}>
                        Retirer
                      </button>
                    ) : null}
                  </span>
                </td>
                <td>
                  <span className="cha-dot" /> Saisi ici · ses catalogues seulement
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">{checks ? 'Aucune boutique reliée à la caisse.' : 'Lecture des boutiques…'}</p>
        )}
        {shopSave.status === 'error' ? <p className="cha-warn">{shopSave.text}</p> : shopSave.status === 'saving' ? <p className="cha-note">Enregistrement…</p> : null}
        <p className="cha-note">
          Changer une adresse, des horaires, le téléphone ou l’e-mail se fait dans l’ERP : le prochain PDF les reprend. Le second téléphone, le webshop direct et le
          logo, que l’ERP ne porte pas, se saisissent ici, boutique par boutique (vides : rien ne s’imprime, le QR mène au webshop du réseau, le logo est celui
          de la charte).
        </p>
      </section>

      {toComplete.length || (checks && checks.webshopUrl === null) ? (
        <section className="cha-card cha-card--warn">
          <div className="cha-lab">Boutiques à compléter avant d’imprimer</div>
          {toComplete.map((s) => (
            <div key={s.id} className="cha-todo">
              <span className="cha-todo__name">{s.name}</span>
              <span className="cha-tag cha-tag--warn">
                {[missingFor(s, 'address') ? 'adresse' : '', missingFor(s, 'hours') ? 'horaires' : '', missingFor(s, 'phone') ? 'téléphone' : ''].filter(Boolean).join(', ')} inconnu(s) de TFBuddy
              </span>
              <span className="cha-todo__where">à corriger dans l’ERP (fiche de la boutique)</span>
            </div>
          ))}
          {checks && checks.webshopUrl === null ? (
            <div className="cha-todo">
              <span className="cha-todo__name">Toutes les boutiques</span>
              <span className="cha-tag cha-tag--warn">Adresse du webshop du réseau inconnue : pas de QR code sans webshop direct</span>
              <span className="cha-todo__where">webshop direct de chaque boutique (ci-dessus), ou réglage webshop_url du module Social</span>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )

  const recapDocs = doc
  const recap = (
    <>
      <section className="cha-card">
        <div className="cha-lab">
          Les 4 pages de la marque <span className="cha-grow" />
          <span className="cha-lab__plain">Couverture de la gamme</span>
          <span className="bro-seg" role="group" aria-label="Couverture">
            {charter.covers.map((c, i) => (
              <button key={i} type="button" className={i === coverIndex ? 'is-on' : ''} onClick={() => setCoverIndex(i)}>
                {gammeName(c.gamme)}
              </button>
            ))}
          </span>
          <span className="cha-lab__plain">Boutique</span>
          <select className="cha-select" value={shop?.id ?? ''} onChange={(event) => setShopId(Number(event.target.value))}>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="cha-recap">
          {(
            [
              [0, 'Couverture', cover.template, 1],
              [1, 'Page 2', charter.page2.template, 2],
              [2, 'Avant-dernière', charter.penultimate.template, 3],
              [3, 'Dernière page', charter.back.template, 4],
            ] as Array<[number, string, string, Step]>
          ).map(([index, label, t, s]) => (
            <figure key={index}>
              <Page doc={recapDocs} index={index} width={250} />
              <figcaption>
                {`${label} · gabarit ${t} · `}
                <button type="button" className="linklike" onClick={() => void go(s)}>
                  modifier
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <div className="cha-recap__bottom">
        <section className="cha-card">
          <div className="cha-lab">Avant de publier</div>
          {checks ? (
            <ul className="cha-checks">
              {checks.items.map((item) => (
                <li key={item.code} className={`cha-check cha-check--${item.level}`}>
                  <span className="cha-check__icon">{item.level === 'ok' ? '✓' : '!'}</span>
                  <span>
                    {item.message}{' '}
                    {item.level === 'warn' ? (
                      <button type="button" className="linklike" onClick={() => void go(item.step as Step)}>
                        {item.code === 'nl' ? 'Écrire ›' : 'Voir ›'}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{checksError ?? 'Vérification…'}</p>
          )}
        </section>
        <section className="cha-card">
          <div className="cha-lab">Ce que fait « Publier »</div>
          <ul className="cha-checks">
            <li className="cha-check cha-check--ok">
              <span className="cha-check__icon">✓</span>
              <span>Les catalogues de la marque et ceux des franchisés prennent ces 4 pages à leur prochain aperçu et à leur prochain PDF.</span>
            </li>
            <li className="cha-check cha-check--ok">
              <span className="cha-check__icon">✓</span>
              <span>Un catalogue déjà marqué imprimé ne change pas : il garde la version de son impression.</span>
            </li>
            <li className="cha-check cha-check--ok">
              <span className="cha-check__icon">✓</span>
              <span>La version publiée reste dans l’historique : « Revenir à la version du … ».</span>
            </li>
          </ul>
          <p className="cha-note">
            {checks
              ? `${checks.catalogues.affected} catalogue(s) pas encore imprimé(s) la prendront ; ${checks.catalogues.printed} imprimé(s) gardent leur version.`
              : 'Le nombre de catalogues concernés est compté et affiché dans la confirmation.'}
            {publication?.version ? ` En ligne : version ${publication.version} du ${dateFr(publication.publishedAt)}${publication.draftChanged ? ' — le brouillon a changé depuis.' : ' — le brouillon est publié.'}` : ' Aucune version publiée encore : les catalogues lisent la charte d’origine.'}
          </p>
          {published ? <p className="cha-published">{published}</p> : null}
          <div className="cha-row cha-row--end">
            <button type="button" className="btn btn--primary" disabled={publishing} onClick={() => void publish()}>
              {publishing ? 'Publication…' : 'Publier pour tous les catalogues'}
            </button>
          </div>
        </section>
      </div>
      <div className="cha-recap__bottom">
        <section className="cha-card">
          <div className="cha-lab">Versions publiées</div>
          {versions === null ? <p className="cha-note">Lecture…</p> : versions.length === 0 ? <p className="cha-note">Aucune version publiée : les catalogues lisent la charte d’origine.</p> : null}
          <ul className="cha-versions">
            {(versions ?? []).map((v) => (
              <li key={v.version}>
                <span>{`Version ${v.version} · ${dateFr(v.publishedAt)}${v.note ? ` · ${v.note}` : ''}`}</span>
                {v.current ? (
                  <span className="cha-tag cha-tag--ok">en ligne</span>
                ) : (
                  <button type="button" className="linklike" disabled={publishing} onClick={() => void publish(v.version)}>
                    {`Revenir à la version du ${dateFr(v.publishedAt)}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="cha-card">
          <div className="cha-lab">Logo et couleurs de tous les catalogues</div>
          <div className="cha-row">
            {charter.logoUrl ? <img className="cha-logo" src={charter.logoUrl} alt="" /> : <span className="cha-note cha-note--inline">Logo officiel de la marque</span>}
            <button type="button" className="btn btn--sm" onClick={() => setPicking('logo')}>
              Logo de la médiathèque
            </button>
            {charter.logoMediaId !== null ? (
              <button type="button" className="linklike" onClick={() => change((c) => ({ ...c, logoMediaId: null, logoUrl: null }))}>
                logo officiel
              </button>
            ) : null}
          </div>
        </section>
        <ColorsCard colors={charter.colors} onChange={(key, hex) => change((c) => ({ ...c, colors: { ...c.colors, [key]: hex } }))} />
      </div>
    </>
  )

  // --- l'aperçu de droite ---------------------------------------------------------------------------
  const previewIndex = step === 1 ? 0 : step === 2 ? 1 : step === 3 ? 2 : 3
  const previewTitle = step === 1 ? (catalogue ? 'Couverture de ce catalogue' : `Couverture « ${gammeName(cover.gamme)} »`) : step === 2 ? 'Page 2' : step === 3 ? 'Avant-dernière' : 'Dernière page'
  const preview = (
    <aside className="cha-preview">
      <section className="cha-card">
        <div className="cha-lab">
          {`Aperçu · ${previewTitle}`} <span className="cha-grow" />
          {step === 2 || step === 3 ? (
            <span className="bro-seg" role="group" aria-label="Format">
              {(['A5', 'A4'] as CatalogueFormat[]).map((f) => (
                <button key={f} type="button" className={format === f ? 'is-on' : ''} onClick={() => setFormat(f)}>
                  {f}
                </button>
              ))}
            </span>
          ) : (
            <span className="cha-tag cha-tag--ex">{`boutique : ${shop?.name ?? '—'}`}</span>
          )}
        </div>
        <div className="cha-preview__page">
          <Page doc={doc} index={previewIndex} width={360} />
          <span className="cha-lock">🔒 Marque</span>
        </div>
        {step === 1 ? (
          <div className="cha-strip">
            {(
              [
                [0, '1'],
                [1, '2'],
                [-1, 'pages produits'],
                [2, 'avant-dern.'],
                [3, 'dernière'],
              ] as Array<[number, string]>
            ).map(([index, label]) => (
              <div key={label} className="cha-strip__item">
                {index >= 0 ? <Page doc={{ ...doc, catalogue: { ...doc.catalogue, format: 'A5' } }} index={index} width={62} /> : <span className="cha-strip__gap">pages<br />produits</span>}
                {index >= 0 ? <span>{label}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {(step === 2 || step === 3) && !catalogue ? <p className="cha-note">La même page dans tous les catalogues : ceux de la marque et ceux que les franchisés font dans leur dashboard.</p> : null}
        {step === 4 ? (
          <p className="cha-note">
            <span className="cha-green">● Rempli par la boutique :</span> nom, adresse, horaires, téléphone et QR (le webshop de chaque boutique).
          </p>
        ) : null}
      </section>
      {catalogue ? (
        <p className="cha-note">Logo et couleurs : communs à tous les catalogues (« Modifier les pages de la marque », depuis la liste).</p>
      ) : (
        <ColorsCard colors={charter.colors} onChange={(key, hex) => change((c) => ({ ...c, colors: { ...c.colors, [key]: hex } }))} />
      )}
    </aside>
  )

  // Mode « ce catalogue » : la page de l'étape est-elle à lui, ou celle de la charte ?
  const slot = SLOT_OF_STEP[step] ?? null
  const ownNow = catalogue && common.current ? ownOf(charter, common.current) : null
  const banner = catalogue && slot && ownNow ? (
    <section className={`cha-card cha-own${ownNow[slot] ? ' is-own' : ''}`}>
      {ownNow[slot] ? (
        <>
          <span className="cha-tag cha-tag--ok">Propre à ce catalogue</span>
          <span className="cha-own__t">{`Cette page n’est que dans « ${catalogue.title} » : les autres catalogues gardent la page commune.`}</span>
          <button type="button" className="linklike" onClick={() => backToCommon(slot)}>
            Revenir à la page commune
          </button>
        </>
      ) : (
        <>
          <span className="cha-tag">Page commune</span>
          <span className="cha-own__t">{`La même que dans les autres catalogues. Modifiez-la ici : le changement ne vaudra que pour « ${catalogue.title} ».`}</span>
        </>
      )}
    </section>
  ) : null
  const steps = catalogue ? STEPS.filter((s) => s.n <= 4).map((s) => (s.n === 1 ? { ...s, hint: 'page 1 de ce catalogue' } : s)) : STEPS

  const current = STEPS[step - 1]
  return (
    <div className="catv cha">
      <style>{catalogueCss()}</style>
      <div className="cha-head">
        <div>
          <button type="button" className="linklike catv-back" onClick={() => void leave()}>
            {backLabel}
          </button>
          <p className="catv-kicker">{catalogue ? `Catalogue « ${catalogue.title} » · ses pages de la marque` : 'Catalogues · réglage de la marque'}</p>
          <h2 className="catv-h1">{catalogue ? 'Pages de la marque de ce catalogue' : 'Assistant des pages de la marque'}</h2>
        </div>
        <span className="cha-grow" />
        <span className="bro-seg" role="group" aria-label="Langue de l’aperçu">
          {(['fr', 'nl'] as CatalogueLang[]).map((l) => (
            <button key={l} type="button" className={lang === l ? 'is-on' : ''} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <span className={`cha-save${save.status === 'error' ? ' is-error' : ''}`}>
          {save.status === 'saving'
            ? 'Enregistrement…'
            : save.status === 'error'
              ? `Non enregistré : ${save.text ?? ''}`
              : save.status === 'saved' && save.text
                ? save.text
                : dirty.current
                  ? 'Modifié… enregistrement automatique'
                  : catalogue ? 'Enregistré' : 'Brouillon enregistré'}
        </span>
        {step < 5 ? (
          <button type="button" className="btn btn--primary" onClick={() => void saveNow()}>
            Enregistrer
          </button>
        ) : null}
        <button type="button" className="btn" disabled={step === 1} onClick={() => void go((step - 1) as Step)}>
          ‹ Précédent
        </button>
        {catalogue && step === 4 ? (
          <button type="button" className="btn" onClick={() => void leave()}>
            {doneLabel}
          </button>
        ) : step < 5 ? (
          <button type="button" className="btn" onClick={() => void go((step + 1) as Step)}>
            {`Suivant · ${current.next} ›`}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => { dirty.current = true; void flush() }}>
            Enregistrer sans publier
          </button>
        )}
      </div>
      <nav className="cha-steps" aria-label="Étapes">
        {steps.map((s) => (
          <button key={s.n} type="button" className={`cha-step${s.n === step ? ' is-on' : ''}${stepDone(s.n) ? ' is-done' : ''}`} onClick={() => void go(s.n)}>
            <span className="cha-step__no">{stepDone(s.n) ? '✓' : s.n}</span>
            <span>
              <span className="cha-step__l">{`${s.n} · ${s.label}`}</span>
              <span className="cha-step__d">{s.hint}</span>
            </span>
          </button>
        ))}
      </nav>
      {step === 5 ? (
        recap
      ) : (
        <div className="cha-body">
          <div className="cha-main">
            {banner}
            {step === 1 ? coverStep : step === 2 ? brandStep('page2') : step === 3 ? brandStep('penultimate') : backStep}
          </div>
          {preview}
        </div>
      )}
      {picking !== null ? (
        <MediaPicker
          onClose={() => setPicking(null)}
          onPick={(asset: MediaAsset) => {
            const mediaId = Number(asset.id)
            if (picking === 'logo') change((c) => ({ ...c, logoMediaId: mediaId, logoUrl: asset.url }))
            else if (picking === 'shopLogo') saveShop({ logoMediaId: mediaId })
            else if (picking === 'cover') setCover({ visual: 'media', mediaId, imageUrl: asset.url })
            else setBrand(picking, { mediaId, imageUrl: asset.url, template: charter[picking].template === 'A' ? 'B' : charter[picking].template })
            setPicking(null)
          }}
        />
      ) : null}
    </div>
  )
}
