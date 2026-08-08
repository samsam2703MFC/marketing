import { useState } from 'react'
import SeasonPicker from '../components/SeasonPicker'
import { marketing } from '../lib/api'
import { asset } from '../lib/assets'
import { describeError } from '../state/auth'
import { SEASONS, seasonOccurrence } from '../lib/seasons'
import { CATEGORIES, PRODUCTS } from '../lib/catalog'

/** Nombre de produits par famille — catalogue statique, calculé une fois. */
const PRODUCT_COUNTS = new Map(
  CATEGORIES.map((category) => [
    category.id,
    PRODUCTS.filter((product) => product.categoryId === category.id).length,
  ]),
)

/** Campagne créée pour une offre validée. */
interface SavedOffer {
  id: number | string
  name: string
  dateFrom: string
  dateTo: string
}

/**
 * Écran « Nouvelle offre » (maquette A validée) : trois colonnes
 * saison → catégories → produits, synthèse et validation en bas.
 *
 * Cocher une catégorie présélectionne tous ses produits, décochables
 * ensuite un à un. Faute de route « offres » dans l'ERP, la validation
 * enregistre une campagne marketing : les dates viennent de l'occurrence
 * de la saison et la sélection est encodée dans la description (texte
 * lisible + ligne `[offer:v1]` en JSON, réexploitable plus tard).
 */
export default function OfferBuilder() {
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [categoryIds, setCategoryIds] = useState<ReadonlySet<number>>(new Set())
  const [productIds, setProductIds] = useState<ReadonlySet<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SavedOffer | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const season = SEASONS.find((candidate) => candidate.id === seasonId) ?? null
  const visibleProducts = PRODUCTS.filter((product) => categoryIds.has(product.categoryId))
  const canValidate = season !== null && productIds.size > 0

  /** Toute retouche repart d'un brouillon : l'offre déjà enregistrée reste en base. */
  const touch = () => {
    setSaved(null)
    setSaveError(null)
  }

  const pickSeason = (id: number | null) => {
    touch()
    setSeasonId(id)
  }

  const toggleCategory = (id: number) => {
    touch()
    const nextCategories = new Set(categoryIds)
    const nextProducts = new Set(productIds)
    const familyProducts = PRODUCTS.filter((product) => product.categoryId === id)
    if (nextCategories.has(id)) {
      nextCategories.delete(id)
      familyProducts.forEach((product) => nextProducts.delete(product.id))
    } else {
      nextCategories.add(id)
      familyProducts.forEach((product) => nextProducts.add(product.id))
    }
    setCategoryIds(nextCategories)
    setProductIds(nextProducts)
  }

  const toggleProduct = (id: number) => {
    touch()
    const next = new Set(productIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setProductIds(next)
  }

  const selectAllVisible = () => {
    touch()
    setProductIds(new Set(visibleProducts.map((product) => product.id)))
  }

  const reset = () => {
    setSeasonId(null)
    setCategoryIds(new Set())
    setProductIds(new Set())
    setSaved(null)
    setSaveError(null)
  }

  const saveOffer = async () => {
    if (!season || saving) return
    setSaving(true)
    setSaveError(null)

    const categories = CATEGORIES.filter((category) => categoryIds.has(category.id))
    const products = PRODUCTS.filter((product) => productIds.has(product.id))
    const { dateFrom, dateTo } = seasonOccurrence(season)
    const name = `Offre ${season.label}`
    const description = [
      `Saison : ${season.label}`,
      `Catégories (${categories.length}) : ${categories.map((category) => category.name).join(', ')}`,
      `Produits (${products.length}) : ${products.map((product) => product.name).join(', ')}`,
      '',
      `[offer:v1] ${JSON.stringify({
        season: season.id,
        categories: categories.map((category) => category.id),
        products: products.map((product) => product.id),
      })}`,
    ].join('\n')

    try {
      const created = await marketing.createCampaign({
        name,
        description,
        date_from: dateFrom,
        date_to: dateTo,
      })
      setSaved({ id: created.inserted_id, name, dateFrom, dateTo })
    } catch (cause: unknown) {
      setSaveError(describeError(cause))
    } finally {
      setSaving(false)
    }
  }

  const selectedCategoryNames = CATEGORIES.filter((category) => categoryIds.has(category.id)).map(
    (category) => category.name,
  )

  return (
    <>
      <div className="pagehead">
        <h1>Nouvelle offre</h1>
        <span className="muted">saison → catégories → produits, dans l'ordre que vous voulez</span>
      </div>

      <div className="offer-layout">
        <section className="card">
          <h2>1 · Saison</h2>
          <SeasonPicker column value={seasonId} onChange={pickSeason} />
        </section>

        <section className="card">
          <h2>
            2 · Catégories{' '}
            {categoryIds.size > 0 ? <span className="muted">({categoryIds.size} sélectionnées)</span> : null}
          </h2>
          <div className="tiles">
            {CATEGORIES.map((category) => {
              const active = categoryIds.has(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  className={active ? 'tile tile--on' : 'tile'}
                  aria-pressed={active}
                  onClick={() => toggleCategory(category.id)}
                >
                  {active ? <span className="tile__badge">✓</span> : null}
                  <img src={asset(category.image)} alt="" />
                  <span className="tile__name">{category.name}</span>
                  <span className="tile__count">{PRODUCT_COUNTS.get(category.id)} produits</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="card">
          <h2>
            3 · Produits{' '}
            {productIds.size > 0 ? <span className="muted">({productIds.size} sélectionnés)</span> : null}
            {visibleProducts.length > 0 ? (
              <button type="button" className="selectall" onClick={selectAllVisible}>
                Tout sélectionner
              </button>
            ) : null}
          </h2>
          {visibleProducts.length === 0 ? (
            <p className="muted">Sélectionnez au moins une catégorie pour lister ses produits.</p>
          ) : (
            <div className="rows">
              {visibleProducts.map((product) => {
                const checked = productIds.has(product.id)
                const category = CATEGORIES.find((candidate) => candidate.id === product.categoryId)
                return (
                  <button
                    key={product.id}
                    type="button"
                    className="row"
                    aria-pressed={checked}
                    onClick={() => toggleProduct(product.id)}
                  >
                    <span className={checked ? 'cb cb--on' : 'cb'} />
                    {product.name}
                    <span className="cat">{category?.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {saved && season ? (
        <div className="card summary">
          <div>
            <strong>Offre enregistrée ✓</strong>
            <ul className="recap">
              <li>
                Campagne marketing n° {saved.id} — « {saved.name} »
              </li>
              <li>
                Période : {saved.dateFrom} → {saved.dateTo}
              </li>
              <li>
                {selectedCategoryNames.length} catégories ({selectedCategoryNames.join(', ')}) ·{' '}
                {productIds.size} produits
              </li>
            </ul>
            <p className="muted footnote">
              Retrouvez-la dans l'onglet Réseau, carte Campagnes — la sélection complète est encodée
              dans sa description.
            </p>
          </div>
          <span className="summary__spacer" />
          <button type="button" onClick={reset}>
            Nouvelle offre
          </button>
        </div>
      ) : (
        <div className="card summary">
          <strong>Votre offre :</strong>
          <span>
            {season ? (
              <>
                {season.image ? <img className="season-mini" src={asset(season.image)} alt="" /> : season.emoji}{' '}
                {season.label}
              </>
            ) : (
              'aucune saison'
            )}{' '}
            · {categoryIds.size} catégories · {productIds.size} produits
          </span>
          <span className="summary__spacer" />
          <button type="button" className="ghost" onClick={reset}>
            Réinitialiser
          </button>
          <button type="button" disabled={!canValidate || saving} onClick={() => void saveOffer()}>
            {saving ? 'Enregistrement…' : "Valider l'offre"}
          </button>
          {saveError ? (
            <p className="error summary__error">Enregistrement impossible : {saveError}</p>
          ) : null}
        </div>
      )}
    </>
  )
}
