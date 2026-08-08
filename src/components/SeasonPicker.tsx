import { asset } from '../lib/assets'
import { SEASONS } from '../lib/seasons'
import type { Season } from '../lib/seasons'

interface SeasonPickerProps {
  /** Saison sélectionnée (`null` = toutes). */
  value: number | null
  onChange: (id: number | null) => void
  /** Gammes proposées — celles de l'ERP par défaut. */
  seasons?: Season[]
  /** Empile les boutons verticalement (colonne de l'écran Offre). */
  column?: boolean
}

/**
 * Barre de filtres par gamme saisonnière : un bouton illustré par saison,
 * recliquer la saison active désélectionne.
 */
export default function SeasonPicker({ value, onChange, seasons = SEASONS, column }: SeasonPickerProps) {
  return (
    <div
      className={column ? 'seasons seasons--column' : 'seasons'}
      role="group"
      aria-label="Filtrer par saison"
    >
      {seasons.map((season) => {
        const active = season.id === value
        return (
          <button
            key={season.id}
            type="button"
            className={active ? 'season season--active' : 'season'}
            aria-pressed={active}
            title={season.dbName}
            onClick={() => onChange(active ? null : season.id)}
          >
            {season.image ? (
              <img className="season__illustration" src={asset(season.image)} alt="" />
            ) : (
              <span className="season__illustration" aria-hidden="true">
                {season.emoji}
              </span>
            )}
            {season.label}
          </button>
        )
      })}
    </div>
  )
}
