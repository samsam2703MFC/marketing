import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate, formatEur, formatPeriod } from '../lib/useAsync'
import type { Granularity, LedgerPeriod, LedgerRow, MovementDraft } from '../lib/api/module'
import LinkBadge from '../components/LinkBadge'
import { useLabel, useReferences } from '../state/references'
import { describeError } from '../state/auth'
import RangeCalendar, { DayCalendar } from '../components/RangeCalendar'

const GRANULARITIES: Array<{ value: Granularity; label: string }> = [
  { value: 'month', label: 'Mois' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Année' },
]

/**
 * Grand livre du fonds marketing.
 *
 * Entrées d'abord avec leur sous-total, sorties ensuite avec le leur, et un
 * solde courant qui cumule à travers les deux blocs — calculé côté serveur,
 * qui seul voit la séquence complète des périodes.
 */
export default function FundsView() {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saisie, setSaisie] = useState(false)
  const [fenetre, setFenetre] = useState(false)
  const [rechargement, setRechargement] = useState(0)

  const { data, error, loading } = useAsync(
    () => api.getLedger(granularity, from || undefined, to || undefined),
    [granularity, from, to, rechargement],
  )

  const periods = data?.periods ?? []

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          {GRANULARITIES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={`filter${granularity === entry.value ? ' is-on' : ''}`}
              onClick={() => setGranularity(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="filters__row">
          {/* Même calendrier que la saisie : les deux derniers champs natifs de
              l'écran affichaient encore `mm/dd/yyyy` juste au-dessus d'un
              formulaire qui écrit le jour d'abord. */}
          <button
            type="button"
            className={`filter${fenetre ? ' is-on' : ''}`}
            aria-expanded={fenetre}
            onClick={() => setFenetre(!fenetre)}
          >
            {from === '' && to === ''
              ? 'Toute la période'
              : `Du ${from === '' ? '…' : jour(from)} au ${to === '' ? '…' : jour(to)}`}
          </button>
          <button type="button" className="filter" onClick={() => setCollapsed(new Set())}>
            Tout déplier
          </button>
          <button
            type="button"
            className="filter"
            onClick={() => setCollapsed(new Set(periods.map((p) => p.period_key)))}
          >
            Tout replier
          </button>

          <button
            type="button"
            className={`filter${saisie ? ' is-on' : ''}`}
            aria-expanded={saisie}
            onClick={() => setSaisie(!saisie)}
          >
            {saisie ? 'Fermer la saisie' : '+ Entrée ou sortie'}
          </button>
        </div>
      </div>

      {fenetre ? (
        <RangeCalendar
          from={from}
          to={to}
          onChange={(plage) => {
            setFrom(plage.starts_on)
            setTo(plage.ends_on)
            if (plage.ends_on !== '') setFenetre(false)
          }}
        />
      ) : null}

      {saisie ? (
        <MovementForm
          onDone={() => {
            setSaisie(false)
            setRechargement((tour) => tour + 1)
          }}
          onCancel={() => setSaisie(false)}
        />
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      {data ? (
        <section className="card balance">
          <h2>Solde du fonds</h2>
          <p className="metric">{formatEur(data.closing_balance, 2)}</p>
        </section>
      ) : null}

      {periods.length === 0 && !loading ? (
        <p className="muted">Aucun mouvement sur cette période.</p>
      ) : null}

      {periods.map((period) => (
        <Period
          key={period.period_key}
          period={period}
          open={!collapsed.has(period.period_key)}
          onToggle={() => toggle(period.period_key)}
        />
      ))}
    </>
  )
}

function Period({
  period,
  open,
  onToggle,
}: {
  period: LedgerPeriod
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="card ledger">
      <button type="button" className="ledger__head" onClick={onToggle} aria-expanded={open}>
        <span className="ledger__key">{formatPeriod(period.period_key)}</span>
        <span className="ledger__totals">
          <span className="ledger__in">+ {formatEur(period.entries_total, 2)}</span>
          <span className="ledger__out">− {formatEur(period.exits_total, 2)}</span>
          <span className="ledger__balance">{formatEur(period.closing_balance, 2)}</span>
        </span>
      </button>

      {open ? (
        <div className="table-scroll">
          <table>
            <tbody>
              <Block rows={period.entries} label="Entrées" total={period.entries_total} sign="+" />
              <Block rows={period.exits} label="Sorties" total={period.exits_total} sign="−" />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function Block({
  rows,
  label,
  total,
  sign,
}: {
  rows: LedgerRow[]
  label: string
  total: number
  sign: '+' | '−'
}) {
  const sourceLabel = useLabel((refs) => refs.fundSources)

  if (rows.length === 0) return null

  return (
    <>
      <tr className="ledger__section">
        <th colSpan={4}>{label}</th>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="ledger__date">{formatDate(row.movement_date)}</td>
          <td>
            {/* Badge de rattachement : la ligne est liée à une campagne. */}
            {row.is_linked ? (
              <LinkBadge
                color={row.lever_color_hex ?? undefined}
                title={row.campaign_name ?? undefined}
              />
            ) : null}
            {row.label}
            {row.shop_name ? <span className="muted"> — {row.shop_name}</span> : null}
            {/* La période couverte sous le libellé : « 12 000 € le 14 avril »
                ne dit pas si l'on paie un trimestre ou une année, et deux
                lecteurs qui n'ouvrent pas la pièce comptent deux choses. */}
            {row.period_from !== null && row.period_to !== null ? (
              <span className="ledger__periode">
                période du {formatDate(row.period_from)} au {formatDate(row.period_to)}
              </span>
            ) : null}
          </td>
          {/* Sans référentiel, cette colonne affichait « ROYALTY » tel quel. */}
          <td className="muted">{row.supplier_name ?? sourceLabel(row.source)}</td>
          <td className="num">{formatEur(row.amount, 2)}</td>
        </tr>
      ))}
      <tr className="ledger__total">
        <td colSpan={3}>Sous-total {label.toLowerCase()}</td>
        <td className="num">
          {sign} {formatEur(total, 2)}
        </td>
      </tr>
    </>
  )
}

/** « 13/08/2026 », l'ordre du reste du module. */
function jour(valeur: string): string {
  const [annee, mois, quantieme] = valeur.split('-')

  return annee === undefined || mois === undefined || quantieme === undefined
    ? valeur
    : `${quantieme}/${mois}/${annee}`
}

/**
 * Saisie d'une entrée ou d'une sortie du fonds.
 *
 * Le sens d'abord, parce qu'il change la lecture de tout le reste : un montant
 * n'est ni positif ni négatif ici, c'est le sens qui porte le signe — et le
 * serveur refuse un montant signé pour cette raison.
 *
 * La période est distincte de la date : « 12 000 € le 14 avril » ne dit pas si
 * l'on paie un trimestre ou une année, et il faut ouvrir la pièce pour le
 * savoir. Elle reste facultative — un achat de PLV n'en couvre aucune.
 */
function MovementForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const references = useReferences()
  const campaigns = useAsync(() => api.listCampaigns({}), [])

  const [sens, setSens] = useState<'IN' | 'OUT'>('OUT')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  const [libelle, setLibelle] = useState('')
  const [montant, setMontant] = useState('')
  const [levier, setLevier] = useState('')
  const [fournisseur, setFournisseur] = useState('')
  const [campagne, setCampagne] = useState('')
  const [source, setSource] = useState('')
  const [piece, setPiece] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  // Un seul calendrier ouvert à la fois : deux grilles côte à côte dans un
  // formulaire de dix champs, on ne sait plus laquelle on remplit.
  const [ouvert, setOuvert] = useState<'date' | 'periode' | null>(null)

  const somme = Number(montant.trim().replace(',', '.'))
  const montantValide = montant.trim() !== '' && Number.isFinite(somme) && somme > 0
  // Les deux bornes, ou aucune : une période ouverte d'un côté ne se totalise
  // pas, et le serveur la refuserait après coup.
  const periodeValide = (debut === '') === (fin === '') && (fin === '' || fin >= debut)
  const complet = libelle.trim() !== '' && montantValide && date !== '' && periodeValide

  const enregistrer = async () => {
    setEnvoi(true)
    setErreur(null)

    const mouvement: MovementDraft = {
      direction: sens,
      movement_date: date,
      label: libelle.trim(),
      amount: somme,
      period_from: debut || null,
      period_to: fin || null,
      lever_id: levier === '' ? null : Number(levier),
      supplier_name: fournisseur.trim() || null,
      campaign_id: campagne === '' ? null : Number(campagne),
      source: source || null,
      document_ref: piece.trim() || null,
    }

    try {
      await api.addMovement(mouvement)
      onDone()
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="card movement">
      <h2 className="movement__title">Nouveau mouvement</h2>

      <div className="movement__sens">
        {([
          ['IN', 'Entrée', 'Ce qui alimente le fonds'],
          ['OUT', 'Sortie', 'Ce que le fonds dépense'],
        ] as const).map(([code, label, note]) => (
          <button
            key={code}
            type="button"
            className={`choice${sens === code ? ' is-on' : ''}`}
            aria-pressed={sens === code}
            onClick={() => setSens(code)}
          >
            <strong>{label}</strong>
            <span className="muted">{note}</span>
          </button>
        ))}
      </div>

      <div className="movement__grid">
        <label className="field field--block">
          Libellé
          <input
            value={libelle}
            placeholder={sens === 'IN' ? 'Redevance marketing T1' : 'Impression dépliants Épiphanie'}
            onChange={(e) => setLibelle(e.target.value)}
          />
        </label>

        <label className="field">
          Montant
          <span className="objectives__pct">
            <input
              value={montant}
              inputMode="decimal"
              placeholder="0,00"
              aria-invalid={montant.trim() !== '' && !montantValide}
              onChange={(e) => setMontant(e.target.value)}
            />
            €
          </span>
        </label>

        <div className="field">
          <span>Date d’écriture</span>
          <button
            type="button"
            className="datefield"
            aria-expanded={ouvert === 'date'}
            onClick={() => setOuvert(ouvert === 'date' ? null : 'date')}
          >
            {date === '' ? 'Choisir une date' : jour(date)}
          </button>
        </div>

        <label className="field">
          Levier
          <select value={levier} onChange={(e) => setLevier(e.target.value)}>
            <option value="">Aucun</option>
            {references.levers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Fournisseur
          <input
            value={fournisseur}
            placeholder={sens === 'IN' ? 'Franchisé, marque…' : 'Imprimeur, agence…'}
            onChange={(e) => setFournisseur(e.target.value)}
          />
        </label>

        {/* Les deux bornes sous une seule étiquette : « du » et « au » séparés
            se retrouvaient sur deux lignes de la grille, et le second champ
            n'avait plus l'air d'appartenir au premier. */}
        <div className="field movement__periode">
          <span>Période couverte</span>
          <button
            type="button"
            className="datefield"
            aria-expanded={ouvert === 'periode'}
            onClick={() => setOuvert(ouvert === 'periode' ? null : 'periode')}
          >
            {debut === '' && fin === ''
              ? 'Aucune — mouvement ponctuel'
              : `du ${debut === '' ? '…' : jour(debut)} au ${fin === '' ? '…' : jour(fin)}`}
          </button>
        </div>

        <label className="field">
          Campagne
          <select value={campagne} onChange={(e) => setCampagne(e.target.value)}>
            <option value="">Aucune</option>
            {(campaigns.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Origine
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Autre</option>
            {references.fundSources.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Pièce
          <input
            value={piece}
            placeholder="N° de facture"
            onChange={(e) => setPiece(e.target.value)}
          />
        </label>
      </div>

      {ouvert === 'date' ? (
        <DayCalendar
          value={date}
          onChange={(valeur) => {
            setDate(valeur)
            setOuvert(null)
          }}
        />
      ) : null}

      {ouvert === 'periode' ? (
        <RangeCalendar
          from={debut}
          to={fin}
          onChange={(plage) => {
            setDebut(plage.starts_on)
            setFin(plage.ends_on)
            // On referme quand la période est complète : rouvrir pour corriger
            // est un clic, refermer soi-même à chaque saisie en est un aussi,
            // à chaque fois.
            if (plage.ends_on !== '') setOuvert(null)
          }}
        />
      ) : null}

      {!periodeValide ? (
        <p className="error">
          {(debut === '') !== (fin === '')
            ? 'Donnez le début et la fin de la période, ou aucun des deux.'
            : 'La fin de période précède son début.'}
        </p>
      ) : null}

      {erreur === null ? null : <p className="error">{erreur}</p>}

      <p className="muted movement__apercu">
        {montantValide
          ? `${sens === 'IN' ? '+' : '−'} ${formatEur(somme, 2)} sur le solde du fonds`
          : 'Le montant se saisit sans signe : c’est le sens qui le porte.'}
      </p>

      <div className="movement__actions">
        <button type="button" className="filter" onClick={onCancel} disabled={envoi}>
          Annuler
        </button>
        <button
          type="button"
          className="filter is-on"
          disabled={!complet || envoi}
          onClick={enregistrer}
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer le mouvement'}
        </button>
      </div>
    </section>
  )
}
