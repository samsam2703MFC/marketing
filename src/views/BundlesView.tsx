import * as api from '../lib/api/module'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'

/** Menus et formules, avec leur composition et leur marge. */
export default function BundlesView() {
  const { data, error, loading } = useAsync(() => api.listBundles(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data?.length) {
    return (
      <section className="card">
        <h2>Bundles & menus</h2>
        <p className="muted">
          Aucun bundle : <code>mar_bundle</code> est alimentée par l’import produit de l’ERP,
          qui n’est pas encore raccordé. Le module ne crée pas de bundle lui-même.
        </p>
      </section>
    )
  }

  return (
    <div className="campaign-grid">
      {data.map((bundle) => (
        <article key={bundle.id} className="card bundle">
          {bundle.image_url ? (
            <img className="campaign__image" src={bundle.image_url} alt="" />
          ) : null}

          <div className="bundle__body">
            <div className="campaign__head">
              <h3>{bundle.name}</h3>
              {bundle.price_amount !== null ? (
                <span className="bundle__price">{formatEur(bundle.price_amount, 2)}</span>
              ) : null}
            </div>

            {bundle.margin_pct !== null ? (
              <p className="muted campaign__meta">Marge {formatNumber(bundle.margin_pct)} %</p>
            ) : null}

            {bundle.items.length > 0 ? (
              <ul className="chips bundle__items">
                {bundle.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="chip chip--lever">
                    {item.quantity > 1 ? `${item.quantity}× ` : ''}
                    {item.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Composition non renseignée.</p>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
