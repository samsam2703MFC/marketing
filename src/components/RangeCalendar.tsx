import { useState } from 'react'

/**
 * Choix de dates, en français, sans champ natif.
 *
 * Les deux champs `<input type="date">` demandaient d'ouvrir un calendrier,
 * choisir, refermer, recommencer sur le second — et affichaient `mm/dd/yyyy`,
 * l'ordre américain, à des gens qui écrivent le jour d'abord. Une date saisie
 * au clavier dans le mauvais ordre est acceptée sans broncher : une campagne
 * partie en juillet au lieu de mars ne se voit qu'au moment où personne ne la
 * comprend.
 *
 * Le calendrier reste donc ouvert, en français, la semaine commençant le lundi.
 * Premier clic : le début. Deuxième : la fin. Deux mois côte à côte parce
 * qu'une campagne franchit presque toujours une fin de mois — les afficher
 * évite d'avoir à naviguer entre les deux clics.
 *
 * `DayCalendar` en est la forme à une date — une écriture comptable tombe un
 * jour, pas sur une période. Même grille, même ordre de lecture : les deux
 * cohabitent dans un formulaire sans que l'œil ait à changer d'habitude.
 */

const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** Date ISO à partir de composantes locales — `toISOString` décalerait d'un jour. */
function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function today(): { year: number; month: number } {
  const now = new Date()

  return { year: now.getFullYear(), month: now.getMonth() }
}

/** Lundi = 0. `getDay()` compte à partir du dimanche, qui n'ouvre pas la semaine ici. */
function firstCell(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function daysIn(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * « 12/09/2026 », jour d'abord.
 *
 * Le même ordre que partout ailleurs dans le module — récapitulatif, cartes de
 * campagne, calendrier. Il n'y a plus de saisie libre de date nulle part, donc
 * plus d'ambiguïté à lever par une forme longue : ce qui compte désormais est
 * qu'un seul ordre se lise d'un écran à l'autre.
 */
function human(value: string): string {
  const [year, month, day] = value.split('-').map(Number)

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

function Month({
  year,
  month,
  from,
  to,
  onPick,
}: {
  year: number
  month: number
  from: string
  to: string
  onPick: (value: string) => void
}) {
  const start = firstCell(year, month)
  const total = daysIn(year, month)
  const now = new Date()
  const stamp = iso(now.getFullYear(), now.getMonth(), now.getDate())

  const cells: Array<number | null> = []
  for (let i = 0; i < start; i++) cells.push(null)
  for (let day = 1; day <= total; day++) cells.push(day)

  return (
    <div className="calendar__month">
      <div className="calendar__title">
        {MOIS[month]} {year}
      </div>

      <div className="calendar__grid">
        {JOURS.map((jour, index) => (
          <div key={index} className="calendar__weekday" aria-hidden="true">
            {jour}
          </div>
        ))}

        {cells.map((day, index) => {
          if (day === null) {
            return <div key={index} className="calendar__blank" />
          }

          const value = iso(year, month, day)
          // Une borne unique est à la fois début et fin : sans ce cas, le
          // premier clic n'allume rien et on croit qu'il n'a pas été pris.
          const isFrom = value === from
          const isTo = value === to || (to === '' && value === from)
          const inside = from !== '' && to !== '' && value > from && value < to

          return (
            <button
              key={index}
              type="button"
              className={
                'calendar__day' +
                (isFrom ? ' is-from' : '') +
                (isTo ? ' is-to' : '') +
                (inside ? ' is-inside' : '') +
                (value === stamp ? ' is-today' : '')
              }
              aria-pressed={isFrom || isTo || inside}
              onClick={() => onPick(value)}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function RangeCalendar({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (range: { starts_on: string; ends_on: string }) => void
}) {
  // Le mois affiché suit la période déjà saisie — on revient sur une campagne
  // de septembre en la voyant, pas en cherchant septembre.
  const [anchor, setAnchor] = useState(() => {
    if (from !== '') {
      const [year, month] = from.split('-').map(Number)

      return { year, month: month - 1 }
    }

    return today()
  })

  function shift(months: number) {
    const total = anchor.year * 12 + anchor.month + months

    setAnchor({ year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 })
  }

  function pick(value: string) {
    // Période complète, ou clic avant le début : on repart de ce jour. Refuser
    // un clic antérieur obligerait à effacer d'abord pour corriger une borne
    // de départ trop tardive, ce que personne ne devine.
    if (from === '' || to !== '' || value < from) {
      onChange({ starts_on: value, ends_on: '' })

      return
    }

    onChange({ starts_on: from, ends_on: value })
  }

  const second = anchor.month === 11
    ? { year: anchor.year + 1, month: 0 }
    : { year: anchor.year, month: anchor.month + 1 }

  return (
    <div className="calendar">
      <div className="calendar__bar">
        <button
          type="button"
          className="calendar__nav"
          onClick={() => shift(-1)}
          aria-label="Mois précédent"
        >
          ‹
        </button>

        <p className="calendar__range">
          {from === '' ? (
            'Cliquez le premier jour, puis le dernier.'
          ) : to === '' ? (
            <>
              Du <strong>{human(from)}</strong> — cliquez le dernier jour.
            </>
          ) : (
            <>
              Du <strong>{human(from)}</strong> au <strong>{human(to)}</strong>
            </>
          )}
        </p>

        {from !== '' ? (
          <button
            type="button"
            className="calendar__clear"
            onClick={() => onChange({ starts_on: '', ends_on: '' })}
          >
            Effacer
          </button>
        ) : null}

        <button
          type="button"
          className="calendar__nav"
          onClick={() => shift(1)}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="calendar__months">
        <Month year={anchor.year} month={anchor.month} from={from} to={to} onPick={pick} />
        <Month year={second.year} month={second.month} from={from} to={to} onPick={pick} />
      </div>
    </div>
  )
}

/**
 * La même grille, pour une seule date.
 *
 * Un mois plutôt que deux : on choisit un jour, pas un intervalle, et le second
 * mois n'aurait servi qu'à occuper la place. La navigation reste, pour les
 * factures qui arrivent en retard.
 */
export function DayCalendar({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [anchor, setAnchor] = useState(() => {
    if (value !== '') {
      const [year, month] = value.split('-').map(Number)

      return { year, month: month - 1 }
    }

    return today()
  })

  function shift(months: number) {
    const total = anchor.year * 12 + anchor.month + months

    setAnchor({ year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 })
  }

  return (
    <div className="calendar calendar--single">
      <div className="calendar__bar">
        <button
          type="button"
          className="calendar__nav"
          onClick={() => shift(-1)}
          aria-label="Mois précédent"
        >
          ‹
        </button>

        <p className="calendar__range">
          {value === '' ? 'Cliquez un jour.' : <strong>{human(value)}</strong>}
        </p>

        <button
          type="button"
          className="calendar__nav"
          onClick={() => shift(1)}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="calendar__months">
        {/* `from` et `to` sur le même jour : la grille marque alors une seule
            case, sans qu'il faille lui apprendre un troisième état. */}
        <Month
          year={anchor.year}
          month={anchor.month}
          from={value}
          to={value}
          onPick={onChange}
        />
      </div>
    </div>
  )
}
