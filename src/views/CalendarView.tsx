import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate } from '../lib/useAsync'

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/**
 * Frise annuelle sur 12 colonnes.
 *
 * Le positionnement des barres vient du serveur (`start_month`, `span_months`),
 * qui tronque déjà les campagnes à cheval sur deux exercices. Le front ne
 * refait pas ce calcul : la règle de découpage n'a pas à exister en double.
 */
export default function CalendarView({ onOpen }: { onOpen: (campaignId: number) => void }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const { data, error, loading } = useAsync(() => api.getCalendar(year), [year])

  return (
    <>
      <div className="filters__row">
        <button type="button" className="filter" onClick={() => setYear((y) => y - 1)}>
          ← {year - 1}
        </button>
        <span className="year">{year}</span>
        <button type="button" className="filter" onClick={() => setYear((y) => y + 1)}>
          {year + 1} →
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      <section className="card">
        <div className="frieze">
          <div className="frieze__months" aria-hidden="true">
            {MONTHS.map((initial, index) => (
              <div key={`${initial}-${index}`} className="frieze__month">
                {initial}
              </div>
            ))}
          </div>

          {data && data.length === 0 ? (
            <p className="muted">Aucune campagne sur {year}.</p>
          ) : null}

          {(data ?? []).map((bar) => (
            <div key={bar.id} className="frieze__row">
              <button
                type="button"
                className="frieze__bar"
                onClick={() => onOpen(bar.id)}
                style={{
                  gridColumn: `${bar.start_month} / span ${bar.span_months}`,
                  color: bar.status_text_hex,
                  background: bar.status_bg_rgba,
                  borderColor: bar.status_text_hex,
                }}
                title={`${bar.name} · ${formatDate(bar.starts_on)} → ${formatDate(bar.ends_on)}`}
              >
                <span className="frieze__bar-label">{bar.name}</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {data && data.length > 0 ? (
        <section className="card table-card">
          <h2>Détail</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campagne</th>
                  <th>Périmètre</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th>Mois couverts</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {data.map((bar) => (
                  <tr key={bar.id}>
                    <td>{bar.name}</td>
                    <td>{bar.scope === 'RESEAU' ? 'Réseau' : 'Locale'}</td>
                    <td>{formatDate(bar.starts_on)}</td>
                    <td>{formatDate(bar.ends_on)}</td>
                    <td>
                      {MONTH_NAMES[bar.start_month - 1]}
                      {bar.span_months > 1 ? ` → ${MONTH_NAMES[bar.start_month + bar.span_months - 2]}` : ''}
                    </td>
                    <td>
                      <span
                        className="chip"
                        style={{ color: bar.status_text_hex, background: bar.status_bg_rgba }}
                      >
                        {bar.status_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
