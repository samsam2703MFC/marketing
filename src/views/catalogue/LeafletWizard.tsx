import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as api from '../../lib/api/module'
import type { CatalogueBrochureTexts, CatalogueDocument, CatalogueLang } from '../../lib/api/module'
import { FORMATS, TEMPLATES, TEXT_LABELS } from '../../lib/brochure'
import type { BrochureDoc, TextKey } from '../../lib/brochure'
import { Sheet, fontFaces } from '../brochure/Pages'
import type { Side } from '../brochure/Pages'
import PAGE_CSS from '../brochure/brochure.css?inline'
import { Nav, STATUS_LABELS, Seg, Thumb, VersionPicker } from './CatalogueWizard'
import type { WizardProps, WizardStep } from './CatalogueWizard'
import { SUPPORT_LABELS, documentTexts, leafletBlocked, leafletChecks, leafletDoc, leafletFormat, leafletItems, leafletTextKeys, supportOf } from './leaflet'
import type { LeafletCheck, LeafletTarget } from './leaflet'

/**
 * L'assistant d'un leaflet A5 ou d'un dépliant A4 tiré d'un catalogue (21/11/2026, fusion des imprimés, étape 2). Le
 * parcours de l'assistant du catalogue, au format de la brochure :
 *   1 · Imprimé — langues, boutiques (une version chacune), la couverture et la dernière page qu'il reprend ;
 *   2 · Produits — ceux du webshop, 6 (leaflet) ou 9 (dépliant) au plus, et les promotions ;
 *   3 · Modèle et textes — les huit modèles des brochures, les textes récrits (sinon ceux du catalogue) ;
 *   4 · Validation — le contrôle avant impression de chaque version ;
 *   5 · Aperçu et impression — les deux faces (la feuille se retourne), le PDF et son état.
 */

const MM = 96 / 25.4

const STEPS = (max: number): Array<{ n: WizardStep; label: string; hint: string }> => [
  { n: 1, label: 'Imprimé', hint: 'langues, boutiques' },
  { n: 2, label: 'Produits', hint: `${max} au plus, promotions` },
  { n: 3, label: 'Modèle et textes', hint: 'le style, les mots' },
  { n: 4, label: 'Validation', hint: 'ce qui s’imprimera' },
  { n: 5, label: 'Aperçu, imprimer', hint: 'recto-verso, le PDF' },
]

/** Les textes longs s'écrivent sur plusieurs lignes. */
const LONG: TextKey[] = ['phrase', 'flapText', 'conditions', 'innerSub']

/** Une face au format fini, réduite à la largeur demandée (le rendu de l'impression). */
function FaceThumb({ doc, side, width }: { doc: BrochureDoc; side: Side; width: number }) {
  const def = FORMATS[doc.format]
  const zoom = width / (def.trimW * MM)
  return (
    <span className="lf-thumb" style={{ width, height: def.trimH * MM * zoom }}>
      <span style={{ zoom }}>
        <Sheet doc={doc} side={side} mode="proof" marks={false} />
      </span>
    </span>
  )
}

/**
 * Les blocs de taille fixe dont le texte déborde (le relevé de l'aperçu des brochures) : il serait coupé à
 * l'impression. On mesure les boîtes des enfants, pas `scrollHeight` : la police de titre dépasse sa ligne sans rien couper.
 */
function useOverflow(ref: RefObject<HTMLElement | null>): string[] {
  const [found, setFound] = useState<string[]>([])
  useLayoutEffect(() => {
    let cancelled = false
    const measure = () => {
      if (cancelled || !ref.current) return
      const names = new Set<string>()
      ref.current.querySelectorAll<HTMLElement>('[data-fit]').forEach((node) => {
        const box = node.getBoundingClientRect()
        const cut = Array.from(node.children).some((child) => {
          const inner = child.getBoundingClientRect()
          const slack = Math.max(1, box.height / 200)
          return inner.height > 0 && (inner.bottom > box.bottom + slack || inner.top < box.top - slack || inner.right > box.right + slack)
        })
        if (cut) names.add(node.dataset.fit ?? '')
      })
      const next = [...names].sort()
      setFound((previous) => (previous.join('|') === next.join('|') ? previous : next))
    }
    const timer = window.setTimeout(measure, 250)
    void document.fonts.ready.then(measure)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  })
  return found
}

export default function LeafletWizard(props: WizardProps) {
  const { step, setStep, cat, doc } = props
  const def = FORMATS[leafletFormat(cat)]
  return (
    <div className="wz lf">
      <style>{fontFaces()}</style>
      <style>{PAGE_CSS}</style>
      <nav className="wz-steps" aria-label={`Les étapes du ${def.label.toLowerCase()}`}>
        {STEPS(def.maxProducts).map((s) => (
          <button key={s.n} type="button" className={`wz-step${s.n === step ? ' is-on' : s.n < step ? ' is-done' : ''}`} onClick={() => setStep(s.n)} aria-current={s.n === step ? 'step' : undefined}>
            <span className="wz-step__no">{s.n < step ? '✓' : s.n}</span>
            <span className="wz-step__txt">
              <b>{s.label}</b>
              <i>{s.hint}</i>
            </span>
          </button>
        ))}
      </nav>
      {props.docError ? <p className="error">{props.docError}</p> : null}
      {step === 1 ? <StepSupport {...props} /> : null}
      {step === 2 ? <StepProducts {...props} /> : null}
      {step === 3 ? <StepLook {...props} /> : null}
      {step === 4 ? <StepChecks {...props} /> : null}
      {step === 5 ? <StepPrint {...props} /> : null}
      {!doc && step !== 2 ? <p className="muted">Composition de l’imprimé…</p> : null}
    </div>
  )
}

/** Où mène un point du contrôle : une étape, ou la page de la marque à modifier. */
function goTo(p: WizardProps, target: LeafletTarget | undefined) {
  if (target === undefined) return
  if (target === 'cover') p.onBrandPage(0)
  else if (target === 'back') p.onBrandPage((p.doc?.pages.length ?? 1) - 1)
  else p.setStep(target)
}

const TARGET_LABELS: Record<string, string> = { 1: 'Imprimé', 2: 'Produits', 3: 'Textes', cover: 'Couverture', back: 'Dernière page' }

// --- 1 · Imprimé -----------------------------------------------------------------------------------

function StepSupport(p: WizardProps) {
  const { cat, doc, change, busy } = p
  const def = FORMATS[leafletFormat(cat)]
  const n = doc?.pages.length ?? 0
  const own = new Set(cat.brandPagesOwn ?? [])
  return (
    <div className="wz-body wz-body--2">
      <section className="wz-pan">
        <div className="wz-kick">Étape 1 · {SUPPORT_LABELS[supportOf(cat)]}</div>
        <h2 className="wz-title">{cat.title}</h2>
        <div className="wz-rows">
          <div className="wz-row">
            <span>Format</span>
            <b>{def.label}</b>
            <small>{def.sub} · fond perdu 3 mm. Il porte {def.maxProducts} produits au plus.</small>
          </div>
          <div className="wz-row">
            <span>Langues</span>
            <Seg
              label="Langues"
              value={cat.langs.includes('nl') ? (cat.langs.includes('fr') ? 'fr,nl' : 'nl') : 'fr'}
              options={[['fr', 'FR'], ['nl', 'NL'], ['fr,nl', 'FR + NL']]}
              disabled={busy}
              onChange={(v) => {
                const langs = v.split(',') as CatalogueLang[]
                change({ langs })
                if (!langs.includes(p.lang)) p.setLang(langs[0])
              }}
            />
            <small>Une version par langue.</small>
          </div>
        </div>
        <div className="wz-sub">Boutiques · une version chacune, à ses prix, avec son adresse et son QR</div>
        <div className="wz-shops">
          {p.shops.map((shop) => (
            <label key={shop.id} className={`wz-shop${cat.shopIds.includes(shop.id) ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={cat.shopIds.includes(shop.id)}
                onChange={(event) => {
                  const next = event.target.checked ? [...cat.shopIds, shop.id] : cat.shopIds.filter((s) => s !== shop.id)
                  if (!event.target.checked && p.versionShop === shop.id) p.setVersionShop(null)
                  change({ shopIds: next })
                }}
              />
              {shop.name}
            </label>
          ))}
        </div>
        <p className="wz-note">Sans boutique : la version générale seule (« Toutes nos boutiques »), au prix le plus répandu.</p>
        <Nav
          back={
            <button type="button" className="btn btn--danger btn--sm" onClick={p.onDelete}>
              Supprimer
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(2)}>
              Produits ›
            </button>
          }
        />
      </section>
      <aside className="wz-pan wz-brand">
        <div className="wz-kick">Ce qu’il reprend des pages de la marque</div>
        <p className="wz-note">
          La couverture donne le titre, le sous-titre et le visuel ; la dernière page, le QR code et la boutique. Les textes se récrivent pour l’imprimé à l’étape 3.
        </p>
        <div className="wz-brand__grid lf-brand">
          {doc
            ? ([
                [0, 'Couverture', 'titre, visuel', 'cover'],
                [n - 1, 'Dernière page', 'QR, boutique', 'back'],
              ] as const).map(([i, label, hint, slot]) => (
                <button key={label} type="button" className="wz-brand__page" onClick={() => p.onBrandPage(i)} title={`${label} — ✎ modifier`}>
                  <Thumb doc={doc} index={i} width={118} />
                  <b>{label}</b>
                  <i>
                    {hint}
                    {own.has(slot) ? ' · à lui' : ''}
                  </i>
                </button>
              ))
            : null}
        </div>
        {doc ? (
          <div className="lf-faces lf-faces--small">
            {([0, 1] as Side[]).map((side) => (
              <figure key={side}>
                <FaceThumb doc={leafletDoc({ cat, doc, proof: true })} side={side} width={leafletFormat(cat) === 'leaflet-a5' ? 150 : 300} />
                <figcaption>{def.faces[side]}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  )
}

// --- 2 · Produits ----------------------------------------------------------------------------------

function StepProducts(p: WizardProps) {
  const def = FORMATS[leafletFormat(p.cat)]
  const checked = p.cat.products.filter((row) => row.on).length
  const items = p.doc ? leafletItems(p.doc) : []
  const over = checked > def.maxProducts
  return (
    <div className="wz-body wz-body--2">
      <div className="wz-col">
        <div className="wz-lead">
          <div className="wz-kick">Étape 2 · Produits</div>
          <p>
            Les produits du webshop et leurs prix (ceux de chaque boutique dans sa version). Le {def.label.toLowerCase()} en porte <b>{def.maxProducts} au plus</b> :{' '}
            <b className={over ? 'lf-over' : ''}>
              {checked} coché{checked > 1 ? 's' : ''}
            </b>
            .
          </p>
        </div>
        {p.productsPanel}
      </div>
      <div className="wz-col">
        <section className="wz-pan">
          <div className="wz-kick">Ce qui s’imprime · dans cet ordre</div>
          {!p.doc ? <p className="muted">Composition…</p> : null}
          {p.doc && items.length === 0 ? <p className="muted">Aucun produit coché.</p> : null}
          <ol className="lf-order">
            {items.map((item, i) => (
              <li key={`${item.kind ?? 'product'}-${item.id}`} className={i >= def.maxProducts ? 'is-out' : ''}>
                <span>{item.name}</span>
                {api.isDocOffer(item) ? <span className="bro-tag">{item.badge}</span> : null}
                {i >= def.maxProducts ? <small>ne s’imprime pas</small> : null}
              </li>
            ))}
          </ol>
          <small>L’ordre est celui des catégories du webshop, puis des produits.</small>
        </section>
        {p.offersPanel}
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(1)}>
              ‹ Imprimé
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(3)}>
              Modèle et textes ›
            </button>
          }
        />
      </div>
    </div>
  )
}

// --- 3 · Modèle et textes --------------------------------------------------------------------------

function StepLook(p: WizardProps) {
  const { cat, doc, change, busy, lang } = p
  const format = leafletFormat(cat)
  const def = FORMATS[format]
  const facesRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(facesRef)
  const own = cat.brochureTexts?.[lang] ?? {}
  const base = doc ? documentTexts(doc) : null

  function save(key: TextKey, value: string | null) {
    const next: Partial<Record<string, string>> = { ...own }
    if (value === null) delete next[key]
    else next[key] = value
    const texts: CatalogueBrochureTexts = { [lang]: next }
    change({ brochureTexts: texts })
  }

  return (
    <div className="wz-body wz-body--side lf-look">
      <div className="wz-col">
        <section className="wz-pan">
          <div className="wz-kick">Étape 3 · Le modèle</div>
          <div className={`lf-tpls${format === 'depliant-a4' ? ' lf-tpls--wide' : ''}`}>
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`lf-tpl${(cat.brochureTemplate ?? 'papier') === template.id ? ' is-on' : ''}`}
                disabled={busy}
                onClick={() => change({ brochureTemplate: template.id })}
                aria-pressed={(cat.brochureTemplate ?? 'papier') === template.id}
              >
                {doc ? <FaceThumb doc={leafletDoc({ cat, doc, proof: true, template: template.id })} side={0} width={format === 'leaflet-a5' ? 112 : 190} /> : <span className="lf-thumb" />}
                <b>{template.name}</b>
                <i>{template.hint}</i>
              </button>
            ))}
          </div>
        </section>
        <section className="wz-pan">
          <div className="wz-valbar">
            <div className="wz-kick">Les textes · {lang.toUpperCase()}</div>
            <span className="wz-grow" />
            <VersionPicker {...p} />
          </div>
          <p className="wz-note">Vide : le texte du catalogue (en gris). « Masquer » : rien n’est imprimé. Chaque langue a les siens.</p>
          <div className="lf-texts">
            {leafletTextKeys(cat).map((key) => {
              const saved = own[key]
              const hidden = saved === ''
              const placeholder = base?.[key] ?? ''
              const fieldKey = `${lang}-${key}-${saved ?? '∅'}`
              const field = {
                defaultValue: saved ?? '',
                placeholder: hidden ? '(masqué)' : placeholder,
                disabled: hidden,
                maxLength: 400,
                'aria-label': TEXT_LABELS[key],
                onBlur: (event: { target: { value: string } }) => {
                  const value = event.target.value.trim()
                  if (hidden) return
                  if (value === '' && saved !== undefined) save(key, null)
                  else if (value !== '' && value !== saved) save(key, value)
                },
              }
              return (
                <div key={key} className={`lf-text${saved !== undefined && !hidden ? ' is-own' : ''}${hidden ? ' is-hidden' : ''}`}>
                  <span className="lf-text__l">
                    {TEXT_LABELS[key]}
                    {saved !== undefined && !hidden ? <small>récrit</small> : null}
                  </span>
                  {LONG.includes(key) ? <textarea key={fieldKey} rows={2} {...field} /> : <input key={fieldKey} {...field} />}
                  <span className="lf-text__a">
                    {saved !== undefined && !hidden ? (
                      <button type="button" className="linklike" onClick={() => save(key, null)} title="Revenir au texte du catalogue">
                        ↺ catalogue
                      </button>
                    ) : null}
                    <button type="button" className="linklike" onClick={() => save(key, hidden ? null : '')}>
                      {hidden ? 'Afficher' : 'Masquer'}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
          {overflow.length ? <p className="wz-info">Texte coupé dans l’aperçu : {overflow.join(', ')}. Raccourcissez-le, ou cochez moins de produits.</p> : null}
        </section>
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(2)}>
              ‹ Produits
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(4)}>
              Validation ›
            </button>
          }
        />
      </div>
      <aside className="wz-pan lf-preview">
        <div className="wz-kick">
          Aperçu · {def.label} · {p.versionShop !== null ? p.shopName(p.versionShop) : 'version générale'} · {lang.toUpperCase()}
        </div>
        <div className="lf-faces lf-faces--stack" ref={facesRef}>
          {doc
            ? ([0, 1] as Side[]).map((side) => (
                <figure key={side}>
                  <FaceThumb doc={leafletDoc({ cat, doc, proof: true })} side={side} width={format === 'leaflet-a5' ? 300 : 300} />
                  <figcaption>{def.faces[side]}</figcaption>
                </figure>
              ))
            : null}
        </div>
      </aside>
    </div>
  )
}

// --- 4 · Validation --------------------------------------------------------------------------------

function CheckList({ checks, p }: { checks: LeafletCheck[]; p: WizardProps }) {
  return (
    <ul className="wz-checks">
      {checks.map((check, i) => (
        <li key={`${check.label}-${i}`} className={`wz-check is-${check.level}`}>
          <span className="wz-check__ic">{check.level === 'ok' ? '✓' : check.level === 'stop' ? '✕' : '!'}</span>
          <div>
            <b>{check.label}</b>
            {check.detail ? <p>{check.detail}</p> : null}
          </div>
          <div className="wz-check__ge">
            {check.target !== undefined ? (
              <button type="button" className="btn btn--sm" onClick={() => goTo(p, check.target)}>
                {TARGET_LABELS[String(check.target)]} ›
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function StepChecks(p: WizardProps) {
  const { cat, doc } = p
  const def = FORMATS[leafletFormat(cat)]
  const facesRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(facesRef)
  const checks = doc ? leafletChecks(cat, doc, overflow) : []
  const stops = checks.filter((c) => c.level === 'stop').length
  const warns = checks.filter((c) => c.level === 'warn').length
  const [all, setAll] = useState<{ status: 'idle' | 'loading' | 'done'; rows: Array<{ lang: CatalogueLang; shop: number | null; checks: LeafletCheck[] | null; error?: string }> }>({ status: 'idle', rows: [] })
  async function checkAll() {
    const versions = cat.langs.flatMap((lang) => [{ lang, shop: null as number | null }, ...p.versionShops.map((shop) => ({ lang, shop: shop as number | null }))])
    setAll({ status: 'loading', rows: [] })
    const rows = await Promise.all(
      versions.map(async (v) => {
        try {
          const one: CatalogueDocument = await api.getCatalogueDocument(cat.id, v.lang, v.shop)
          return { ...v, checks: leafletChecks(cat, one) }
        } catch (cause) {
          return { ...v, checks: null, error: cause instanceof Error ? cause.message : String(cause) }
        }
      }),
    )
    setAll({ status: 'done', rows })
  }
  const versionLabel = (shop: number | null) => (shop === null ? 'Version générale' : p.shopName(shop))
  return (
    <div className="wz-body wz-body--side">
      <section className="wz-pan">
        <div className="wz-kick">Étape 4 · Validation</div>
        <div className="wz-valbar">
          <h2 className="wz-title">Je vérifie avant d’imprimer</h2>
          <span className="wz-grow" />
          <VersionPicker {...p} />
        </div>
        {doc ? (
          <p className={stops ? 'lf-verdict is-stop' : 'lf-verdict is-ok'}>
            {stops
              ? `${stops} point${stops > 1 ? 's' : ''} bloque${stops > 1 ? 'nt' : ''} le PDF de l’imprimeur pour cette version (l’épreuve reste possible, marquée « ÉPREUVE »).`
              : `Cette version part à l’imprimeur${warns ? ` · ${warns} point${warns > 1 ? 's' : ''} à voir` : ''}.`}
          </p>
        ) : (
          <p className="muted">Le Marketing compose l’imprimé…</p>
        )}
        <CheckList checks={checks} p={p} />
        <div className="wz-allv">
          <div className="wz-opt__t">
            Toutes les versions
            <span className="wz-grow" />
            <button type="button" className="btn btn--sm" disabled={all.status === 'loading'} onClick={() => void checkAll()}>
              {all.status === 'loading' ? 'Composition…' : all.status === 'done' ? 'Revérifier' : `Vérifier les ${cat.langs.length * (1 + p.versionShops.length)} versions`}
            </button>
          </div>
          {all.status === 'done' ? (
            <table className="wz-table wz-table--v">
              <tbody>
                {all.rows.map((r) => {
                  const blocked = r.checks ? r.checks.filter((c) => c.level === 'stop').length : 0
                  const toSee = r.checks ? r.checks.filter((c) => c.level === 'warn').length : 0
                  return (
                    <tr key={`${r.lang}-${r.shop}`}>
                      <td>{versionLabel(r.shop)}</td>
                      <td>{r.lang.toUpperCase()}</td>
                      <td>
                        {r.error ? <span className="error">{r.error}</span> : blocked ? <span className="lf-over">✕ {blocked} bloquant{blocked > 1 ? 's' : ''}</span> : <span className="wz-ok">✓ prête</span>}
                        {!r.error && toSee ? ` · ${toSee} à voir` : ''}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => {
                            p.setLang(r.lang)
                            p.setVersionShop(r.shop)
                          }}
                        >
                          Ouvrir
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <small>Chaque boutique a sa version (ses prix, son adresse, son QR) : elles se vérifient d’un coup.</small>
          )}
        </div>
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(3)}>
              ‹ Modèle et textes
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(5)}>
              Aperçu, imprimer ›
            </button>
          }
        />
      </section>
      <aside className="wz-pan">
        <div className="wz-kick">{def.label} · cette version</div>
        <div className="lf-faces lf-faces--stack" ref={facesRef}>
          {doc
            ? ([0, 1] as Side[]).map((side) => (
                <figure key={side}>
                  <FaceThumb doc={leafletDoc({ cat, doc, proof: true })} side={side} width={290} />
                  <figcaption>{def.faces[side]}</figcaption>
                </figure>
              ))
            : null}
        </div>
      </aside>
    </div>
  )
}

// --- 5 · Aperçu et impression ----------------------------------------------------------------------

/** La feuille, recto puis verso : un clic la retourne (le « feuilleter » d'un imprimé à deux faces). */
function FlipSheet({ doc, width }: { doc: BrochureDoc; width: number }) {
  const [back, setBack] = useState(false)
  const def = FORMATS[doc.format]
  const height = (def.trimH / def.trimW) * width
  return (
    <div className="lf-flipbox">
      <button type="button" className={`lf-flip${back ? ' is-back' : ''}`} style={{ width, height }} onClick={() => setBack(!back)} aria-label={`Retourner : ${back ? def.faces[0] : def.faces[1]}`}>
        <span className="lf-flip__in">
          <span className="lf-flip__face">
            <FaceThumb doc={doc} side={0} width={width} />
          </span>
          <span className="lf-flip__face lf-flip__face--back">
            <FaceThumb doc={doc} side={1} width={width} />
          </span>
        </span>
      </button>
      <div className="lf-flipbar">
        <Seg label="Face" value={back ? 1 : 0} options={[[0, def.faces[0]], [1, def.faces[1]]]} onChange={(side) => setBack(side === 1)} />
        <small>Un clic sur la feuille la retourne.</small>
      </div>
    </div>
  )
}

function StepPrint(p: WizardProps) {
  const { cat, doc, change, busy } = p
  const def = FORMATS[leafletFormat(cat)]
  const [qty, setQty] = useState<string>(cat.printQty ? String(cat.printQty) : '')
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useLayoutEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const checks = doc ? leafletChecks(cat, doc) : []
  const blocked = leafletBlocked(checks)
  const sheetWidth = Math.max(220, Math.min(def.trimW > 200 ? width - 24 : 460, width - 24))
  return (
    <div className="wz-body wz-body--side">
      <div className="wz-col">
        <section className="wz-pan" ref={stageRef}>
          <div className="wz-fb__head">
            <span className="wz-kick">{def.label} · comme imprimé</span>
            <small>{def.sub}</small>
            <span className="wz-grow" />
            <VersionPicker {...p} />
          </div>
          {doc ? <FlipSheet key={`${p.lang}-${p.versionShop}`} doc={leafletDoc({ cat, doc, proof: true })} width={sheetWidth} /> : <p className="muted">Composition de l’imprimé…</p>}
        </section>
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(4)}>
              ‹ Validation
            </button>
          }
        />
      </div>
      <aside className="wz-col">
        <section className="wz-pan">
          <div className="wz-kick">Imprimer</div>
          <dl className="wz-dl">
            <dt>Imprimé</dt>
            <dd>{def.label} · {def.sub}</dd>
            <dt>Modèle</dt>
            <dd>{TEMPLATES.find((t) => t.id === (cat.brochureTemplate ?? 'papier'))?.name ?? cat.brochureTemplate}</dd>
            <dt>Versions</dt>
            <dd>
              {cat.langs.map((l) => l.toUpperCase()).join(' + ')} · générale + {p.versionShops.length} boutique{p.versionShops.length > 1 ? 's' : ''}
            </dd>
            <dt>Prix</dt>
            <dd>ceux du webshop, lus maintenant</dd>
          </dl>
          {blocked ? (
            <p className="wz-info">
              Cette version a des points bloquants : son PDF imprimeur sera refusé.{' '}
              <button type="button" className="linklike" onClick={() => p.setStep(4)}>
                Voir la validation
              </button>
            </p>
          ) : null}
          <button type="button" className="btn btn--primary wz-wide" onClick={() => p.print('printer', true)}>
            PDF pour l’imprimeur · les versions prêtes
          </button>
          <button type="button" className="btn wz-wide" disabled={blocked} onClick={() => p.print('printer', false)}>
            PDF imprimeur · cette version
          </button>
          <button type="button" className="btn wz-wide" onClick={() => p.print('proof', false)}>
            Épreuve · cette version
          </button>
          <small>Imprimeur : fond perdu 3 mm et traits de coupe{def.id === 'depliant-a4' ? ', plis en pointillé' : ''}, recto puis verso. Épreuve : au format fini, pour relire ; marquée « ÉPREUVE » tant qu’un point bloque.</small>
        </section>
        <section className="wz-pan">
          <div className="wz-kick">État</div>
          <Seg label="État" value={cat.status} options={(['brouillon', 'pret', 'imprime'] as const).map((s) => [s, STATUS_LABELS[s]])} disabled={busy} onChange={(status) => change({ status })} />
          <label className="wz-qty">
            <span>Exemplaires imprimés</span>
            <input type="number" min={1} value={qty} onChange={(event) => setQty(event.target.value)} onBlur={() => change({ printQty: qty ? Number(qty) : null })} />
          </label>
          <button type="button" className="btn btn--sm" disabled={busy || !qty} onClick={() => change({ status: 'imprime', printQty: Number(qty) })}>
            Marquer imprimé · {qty || '0'} ex.
          </button>
        </section>
      </aside>
    </div>
  )
}
