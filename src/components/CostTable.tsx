import { formatEur } from '../lib/useAsync'
import type { CostKind } from '../lib/api/module'

/** Libellés des natures de coût. Les codes viennent de `mar_roi_cost.cost_kind`. */
const KINDS: Record<string, string> = {
  MEDIA: 'Achat média',
  PRODUCTION: 'Production & impression',
  AGENCE: 'Honoraires agence',
  REMISE: 'Remises accordées',
  LOGISTIQUE: 'Logistique',
  AUTRE: 'Autres',
}

/**
 * Postes de coût par nature.
 *
 * La colonne « source » n'est pas décorative : c'est elle qui permet de
 * contester un chiffre, donc de lui faire confiance. Un total sans provenance
 * ne se vérifie pas.
 */
export default function CostTable({ costs }: { costs: CostKind[] }) {
  if (costs.length === 0) {
    return <p className="muted">Aucun poste de coût saisi.</p>
  }

  const total = costs.reduce((sum, cost) => sum + cost.total_amount, 0)

  return (
    <section className="card table-card">
      <h2>Postes de coût</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nature</th>
              <th>Source de calcul</th>
              <th className="num">Lignes</th>
              <th className="num">Montant</th>
              <th className="num">Part</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((cost) => (
              <tr key={cost.cost_kind}>
                <td>{KINDS[cost.cost_kind] ?? cost.cost_kind}</td>
                <td className="muted">{cost.sources ?? '—'}</td>
                <td className="num">{cost.lines_count}</td>
                <td className="num">{formatEur(cost.total_amount)}</td>
                <td className="num">
                  {total === 0 ? '—' : `${Math.round((cost.total_amount / total) * 100)} %`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ledger__total">
              <td colSpan={3}>Total</td>
              <td className="num">{formatEur(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
