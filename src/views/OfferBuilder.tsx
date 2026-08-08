import { useState } from 'react'
import SeasonPicker from '../components/SeasonPicker'
import { SEASONS } from '../lib/seasons'
import { CATEGORIES, PRODUCTS } from '../lib/catalog'

/** Nombre de produits par famille — catalogue statique, calculé une fois. */
const PRODUCT_COUNTS = new Map(
  CATEGORIES.map((category) => [
    category.id,
    PRODUCTS.filter((product) => product.categoryId === category.id).length,
  ]),
)

/**
 * Écran « Nouvelle offre » (maquette A validée) : trois colonnes
 * saison → catégories → produits, synthèse et validation en bas.
 *
 * Cocher une catégorie présélectionne tous ses produits, décochables
 * ensuite un à un. La validation reste locale tant que l'ERP n'expose
 * pas de route « offres ».
 */
export default function OfferBuilder() {
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [categoryIds, setCategoryIds] = useState<ReadonlySet<number>>(new Set())
  const [productIds, setProductIds] = useState<ReadonlySet<number>>(new Set())
  const [validated, setValidated] = useState(false)

  const season = SEASONS.find((candidate) => candidate.id === seasonId) ?? null
  const visibleProducts = PRODUCTS.filter((product) => categoryIds.has(product.categoryId))
  const canValidate = season !== null && productIds.size > 0

  const pickSeason = (id: number | null) => {
    setValidated(false)
    setSeasonId(id)
  }

  const toggleCategory = (id: number) => {
    setValidated(false)
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
    setValidated(false)
    const next = new Set(productIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setProductIds(next)
  }

  const selectAllVisible = () => {
    setValidated(false)
    setProductIds(new Set(visibleProducts.map((product) => product.id)))
  }

  const reset = () => {
    setSeasonId(null)
    setCategoryIds(new Set())
    setProductIds(new Set())
    setValidated(false)
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
                  <img src={category.image} alt="" />
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

      {validated && season ? (
        <div className="card summary">
          <div>
            <strong>Offre validée ✓</strong>
            <ul className="recap">
              <li>
                Saison : {season.emoji} {season.label}
              </li>
              <li>
                Catégories ({categoryIds.size}) : {selectedCategoryNames.join(', ')}
              </li>
              <li>Produits : {productIds.size} sélectionnés</li>
            </ul>
            <p className="muted footnote">
              L'enregistrement dans l'ERP sera branché dès qu'une route « offres » existera.
            </p>
          </div>
          <span className="summary__spacer" />
          <button type="button" className="ghost" onClick={() => setValidated(false)}>
            Modifier
          </button>
          <button type="button" onClick={reset}>
            Nouvelle offre
          </button>
        </div>
      ) : (
        <div className="card summary">
          <strong>Votre offre :</strong>
          <span>
            {season ? `${season.emoji} ${season.label}` : 'aucune saison'} · {categoryIds.size}{' '}
            catégories · {productIds.size} produits
          </span>
          <span className="summary__spacer" />
          <button type="button" className="ghost" onClick={reset}>
            Réinitialiser
          </button>
          <button type="button" disabled={!canValidate} onClick={() => setValidated(true)}>
            Valider l'offre
          </button>
        </div>
      )}
    </>
  )
}
