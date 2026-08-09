import { useState } from 'react'
import RangeCalendar from './RangeCalendar'

/**
 * Période d'analyse : la fenêtre de ventes qui sert de repère.
 *
 * Elle vit dans deux étapes — « Prix » compte les volumes à compenser,
 * « Objectifs » les volumes à dépasser — et c'est le même réglage. En faire un
 * composant plutôt que deux copies évite le cas où l'on corrige les raccourcis
 * d'un côté et pas de l'autre, et où les deux écrans se mettent à parler de
 * deux périodes en s'appelant pareil.
 *
 * Repliée par défaut : le réglage se fait une fois, deux mois de calendrier
 * affichés en permanence mangeaient le haut de l'écran.
 */

/** `AAAA-MM-JJ` local. */
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** `01/11/2025`, l'ordre français — celui du reste de l'assistant. */
function human(value: string): string {
  const [year, month, day] = value.split('-')

  return year === undefined || month === undefined || day === undefined
    ? value
    : `${day}/${month}/${year}`
}

/** Nombre de jours couverts, bornes comprises. */
function span(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`)
  const end = Date.parse(`${to}T00:00:00`)

  return Number.isNaN(start) || Number.isNaN(end)
    ? 0
    : Math.round((end - start) / 86_400_000) + 1
}

/** Raccourcis de période : libellé → bornes. */
export function shortcuts(): Array<{ label: string; from: string; to: string }> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  return [
    { label: 'Mois en cours', from: iso(new Date(year, month, 1)), to: iso(now) },
    {
      label: 'Mois dernier',
      from: iso(new Date(year, month - 1, 1)),
      to: iso(new Date(year, month, 0)),
    },
    {
      label: 'Trimestre en cours',
      from: iso(new Date(year, month - (month % 3), 1)),
      to: iso(now),
    },
    { label: 'Année en cours', from: iso(new Date(year, 0, 1)), to: iso(now) },
    {
      label: '12 derniers mois',
      from: iso(new Date(year - 1, month, now.getDate())),
      to: iso(now),
    },
  ]
}

export default function AnalysisPeriod({
  from,
  to,
  compare,
  tickets,
  onChange,
  onCompare,
}: {
  from: string
  to: string
  /** Absent : l'étape ne compare pas à N-1 et la pastille ne s'affiche pas. */
  compare?: boolean
  /** Nombre de tickets lus sur la période, quand l'écran le connaît. */
  tickets?: number | null
  onChange: (range: { from: string; to: string }) => void
  onCompare?: (next: boolean) => void
}) {
  const [open, setOpen] = useState(false)

  const active = shortcuts().find(
    (shortcut) => from === shortcut.from && to === shortcut.to,
  )

  return (
    <>
      <div className="period-bar">
        <strong>
          Du {human(from)} au {human(to)}
        </strong>
        <span className="period-bar__meta">
          {span(from, to)} jours
          {tickets === null || tickets === undefined
            ? null
            : ` · ${tickets.toLocaleString('fr-BE')} tickets`}
          {active === undefined ? null : ` · ${active.label.toLowerCase()}`}
        </span>
        <span className="period-bar__spacer" />
        <div className="period-bar__actions">
          {shortcuts().map((shortcut) => (
            <button
              key={shortcut.label}
              type="button"
              className={`filter${active?.label === shortcut.label ? ' is-on' : ''}`}
              onClick={() => onChange({ from: shortcut.from, to: shortcut.to })}
            >
              {shortcut.label}
            </button>
          ))}
          {onCompare === undefined ? null : (
            <button
              type="button"
              className={`filter${compare ? ' is-on' : ''}`}
              aria-pressed={compare}
              onClick={() => onCompare(!compare)}
            >
              Comparer à N-1
            </button>
          )}
          <button
            type="button"
            className={`filter${open ? ' is-on' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Fermer le calendrier' : 'Modifier la période'}
          </button>
        </div>
      </div>

      {/* Les champs natifs affichaient `mm/dd/yyyy` — l'ordre américain — parce
          qu'un `input[type=date]` suit la locale du navigateur et non celle de
          l'application. Le calendrier maison règle la question. */}
      {open ? (
        <RangeCalendar
          from={from}
          to={to}
          onChange={(range) => onChange({ from: range.starts_on, to: range.ends_on })}
        />
      ) : null}

      {to < from ? <p className="error">La date de fin précède la date de début.</p> : null}
    </>
  )
}
