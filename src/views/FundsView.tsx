import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate, formatEur, formatPeriod } from '../lib/useAsync'
import type {
  Frequency,
  Granularity,
  LedgerPeriod,
  LedgerRow,
  MovementDraft,
  Recurrence,
  RecurrenceDraft,
} from '../lib/api/module'
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
  /** Écriture en cours de correction, tant qu'elle n'est pas enregistrée. */
  const [aCorriger, setACorriger] = useState<LedgerRow | null>(null)

  const { data, error, loading } = useAsync(
    () => api.getLedger(granularity, from || undefined, to || undefined),
    [granularity, from, to, rechargement],
  )

  const frais = useAsync(() => api.listRecurrences(), [rechargement])

  const relire = () => setRechargement((tour) => tour + 1)

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

          {/* Une action, pas un filtre : ajouter une écriture n'est pas du même
              ordre que restreindre l'affichage, et la pastille le noyait au
              milieu des autres. */}
          <button
            type="button"
            className={`action${saisie ? ' is-open' : ''}`}
            aria-expanded={saisie}
            onClick={() => setSaisie(!saisie)}
          >
            {saisie ? 'Fermer la saisie' : '+ Ajouter un mouvement'}
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
            relire()
          }}
          onCancel={() => setSaisie(false)}
        />
      ) : null}

      {/* La correction s'ouvre là où la saisie s'ouvrirait : une même écriture
          ne se lit pas à deux endroits selon qu'on la crée ou qu'on la répare. */}
      {aCorriger === null ? null : (
        <MovementForm
          key={aCorriger.id}
          initial={aCorriger}
          onDone={() => {
            setACorriger(null)
            relire()
          }}
          onCancel={() => setACorriger(null)}
        />
      )}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      {data ? (
        <section className="card balance">
          <h2>Solde du fonds</h2>
          <p className="metric">{formatEur(data.closing_balance, 2)}</p>
        </section>
      ) : null}

      <RecurrenceList frais={frais.data ?? []} onChange={relire} />

      {periods.length === 0 && !loading ? (
        <p className="muted">Aucun mouvement sur cette période.</p>
      ) : null}

      {periods.map((period) => (
        <Period
          key={period.period_key}
          period={period}
          open={!collapsed.has(period.period_key)}
          onToggle={() => toggle(period.period_key)}
          onEdit={setACorriger}
        />
      ))}
    </>
  )
}

const RYTHMES: Record<Frequency, string> = {
  month: 'Tous les mois',
  quarter: 'Tous les trimestres',
  year: 'Tous les ans',
}

/**
 * Les frais récurrents en cours.
 *
 * Ils ne s'ajoutent pas au solde : leurs échéances sont déjà des lignes du
 * grand livre, plus bas. Cette carte dit seulement d'où viennent ces lignes —
 * sans elle, douze « Agence — janvier à décembre » ressemblent à douze saisies.
 */
function RecurrenceList({ frais, onChange }: { frais: Recurrence[]; onChange: () => void }) {
  const [aSupprimer, setASupprimer] = useState<Recurrence | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [echec, setEchec] = useState<string | null>(null)

  if (frais.length === 0) return null

  const supprimer = async () => {
    if (aSupprimer === null) return

    setOccupe(true)
    setEchec(null)

    try {
      await api.deleteRecurrence(aSupprimer.id)
      setASupprimer(null)
      onChange()
    } catch (erreur) {
      setEchec(describeError(erreur))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <section className="card recurrences">
      <h2>Frais récurrents</h2>

      <ul className="recurrences__list">
        {frais.map((entree) => (
          <li key={entree.id} className="recurrences__item">
            <span className="recurrences__label">
              <strong>{entree.label}</strong>
              <span className="muted">
                {RYTHMES[entree.frequency]} — du {formatDate(entree.starts_on)} au{' '}
                {formatDate(entree.ends_on)}
                {entree.shop_name === null ? '' : ` — ${entree.shop_name}`}
              </span>
            </span>
            <span className="recurrences__chiffres">
              <span className={entree.direction === 'IN' ? 'ledger__in' : 'ledger__out'}>
                {entree.direction === 'IN' ? '+' : '−'} {formatEur(entree.amount, 2)}
              </span>
              <span className="muted">
                {entree.occurrences} échéance{entree.occurrences > 1 ? 's' : ''} —{' '}
                {formatEur(entree.total_amount, 2)}
              </span>
            </span>
            <button type="button" className="filter" onClick={() => setASupprimer(entree)}>
              Supprimer
            </button>
          </li>
        ))}
      </ul>

      {/* La confirmation nomme le nombre de lignes : supprimer un abonnement
          retire ses échéances du solde, et « êtes-vous sûr ? » ne dit pas
          combien on s'apprête à perdre. */}
      {aSupprimer === null ? null : (
        <div
          className="confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-frais"
          onClick={() => (occupe ? null : setASupprimer(null))}
        >
          <div className="confirm__box card" onClick={(evenement) => evenement.stopPropagation()}>
            <h3 id="confirm-frais">Supprimer « {aSupprimer.label} » ?</h3>
            <p className="muted">
              Ses {aSupprimer.occurrences} échéance{aSupprimer.occurrences > 1 ? 's' : ''}, soit{' '}
              {formatEur(aSupprimer.total_amount, 2)}, seront retirées du grand livre et du solde.
              C’est définitif.
            </p>

            {echec === null ? null : <p className="error">{echec}</p>}

            <div className="confirm__actions">
              <button
                type="button"
                className="filter"
                disabled={occupe}
                onClick={() => setASupprimer(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="filter confirm__danger"
                disabled={occupe}
                onClick={supprimer}
              >
                {occupe ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Period({
  period,
  open,
  onToggle,
  onEdit,
}: {
  period: LedgerPeriod
  open: boolean
  onToggle: () => void
  onEdit: (row: LedgerRow) => void
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
              <Block
                rows={period.entries}
                label="Entrées"
                total={period.entries_total}
                sign="+"
                onEdit={onEdit}
              />
              <Block
                rows={period.exits}
                label="Sorties"
                total={period.exits_total}
                sign="−"
                onEdit={onEdit}
              />
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
  onEdit,
}: {
  rows: LedgerRow[]
  label: string
  total: number
  sign: '+' | '−'
  onEdit: (row: LedgerRow) => void
}) {
  const sourceLabel = useLabel((refs) => refs.fundSources)

  if (rows.length === 0) return null

  return (
    <>
      <tr className="ledger__section">
        <th colSpan={5}>{label}</th>
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
            {/* L'échéance dit d'où elle vient : douze lignes identiques dans le
                grand livre ressemblent sinon à douze saisies à la main. */}
            {row.recurrence_id === null ? null : (
              <span className="ledger__recurrent" title="Échéance d’un frais récurrent">
                ↻
              </span>
            )}
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
          {/* Corriger plutôt que ressaisir : effacer puis réécrire changerait
              l'identifiant de la ligne, et ce qui pointe dessus le perdrait. */}
          <td className="ledger__edit">
            <button
              type="button"
              className="linklike"
              title="Corriger cette écriture"
              onClick={() => onEdit(row)}
            >
              Modifier
            </button>
          </td>
        </tr>
      ))}
      <tr className="ledger__total">
        <td colSpan={4}>Sous-total {label.toLowerCase()}</td>
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
function MovementForm({
  initial = null,
  onDone,
  onCancel,
}: {
  /** Écriture à corriger. Absente, le formulaire en crée une. */
  initial?: LedgerRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const references = useReferences()
  const campaigns = useAsync(() => api.listCampaigns({}), [])
  const shops = useAsync(() => api.listShops(), [])
  const correction = initial !== null

  const [sens, setSens] = useState<'IN' | 'OUT'>(initial?.direction ?? 'OUT')
  const [date, setDate] = useState(
    () => initial?.movement_date ?? new Date().toISOString().slice(0, 10),
  )
  const [debut, setDebut] = useState(initial?.period_from ?? '')
  const [fin, setFin] = useState(initial?.period_to ?? '')
  const [libelle, setLibelle] = useState(initial?.label ?? '')
  const [montant, setMontant] = useState(
    initial === null ? '' : String(initial.amount).replace('.', ','),
  )
  const [levier, setLevier] = useState(initial?.lever_id === null ? '' : String(initial?.lever_id ?? ''))
  const [fournisseur, setFournisseur] = useState(initial?.supplier_name ?? '')
  const [campagne, setCampagne] = useState(
    initial?.campaign_id === null ? '' : String(initial?.campaign_id ?? ''),
  )
  const [boutique, setBoutique] = useState(
    initial?.shop_id === null ? '' : String(initial?.shop_id ?? ''),
  )
  /** Vrai quand l'écriture ne concerne qu'un magasin, et non le réseau. */
  const [cible, setCible] = useState<'reseau' | 'boutique'>(
    initial !== null && initial.shop_id !== null ? 'boutique' : 'reseau',
  )
  const [source, setSource] = useState(initial?.source ?? '')
  const [piece, setPiece] = useState(initial?.document_ref ?? '')
  /**
   * Publique par défaut : le fonds marketing se rend des comptes au réseau qui
   * l'alimente. Une écriture qui demande le silence — un revenu propre à la
   * marque — le demande donc explicitement, ici.
   */
  const [publique, setPublique] = useState(initial === null ? true : initial.is_public)
  /**
   * Rythme de répétition. « Ponctuel » écrit une ligne ; les trois autres
   * écrivent un frais récurrent, c'est-à-dire une échéance par période.
   * Une correction ne le propose pas : rectifier mars ne redéfinit pas
   * l'abonnement, et l'inverse serait une surprise coûteuse.
   */
  const [rythme, setRythme] = useState<'once' | Frequency>('once')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [suppression, setSuppression] = useState(false)
  // Un seul calendrier ouvert à la fois : deux grilles côte à côte dans un
  // formulaire de dix champs, on ne sait plus laquelle on remplit.
  const [ouvert, setOuvert] = useState<'date' | 'periode' | null>(null)

  const somme = Number(montant.trim().replace(',', '.'))
  const montantValide = montant.trim() !== '' && Number.isFinite(somme) && somme > 0
  const recurrent = rythme !== 'once'
  // Les deux bornes, ou aucune : une période ouverte d'un côté ne se totalise
  // pas, et le serveur la refuserait après coup. Un frais récurrent, lui, exige
  // les deux : sans fin, il n'a pas de nombre d'échéances — donc pas de total.
  const periodeValide = recurrent
    ? debut !== '' && fin !== '' && fin >= debut
    : (debut === '') === (fin === '') && (fin === '' || fin >= debut)
  const echeances = recurrent && periodeValide ? compterEcheances(debut, fin, rythme) : 0
  const complet =
    libelle.trim() !== ''
    && montantValide
    && (recurrent || date !== '')
    && periodeValide
    && (!recurrent || (echeances > 0 && echeances <= 240))
    // « Une boutique » sans boutique choisie enregistrerait une écriture
    // réseau : le formulaire attend plutôt qu'il tranche.
    && (cible === 'reseau' || boutique !== '')

  const shopId = cible === 'boutique' && boutique !== '' ? Number(boutique) : null
  const commun = {
    direction: sens,
    label: libelle.trim(),
    amount: somme,
    lever_id: levier === '' ? null : Number(levier),
    supplier_name: fournisseur.trim() || null,
    campaign_id: campagne === '' ? null : Number(campagne),
    shop_id: shopId,
    source: source || null,
    document_ref: piece.trim() || null,
    is_public: publique,
  }

  const enregistrer = async () => {
    setEnvoi(true)
    setErreur(null)

    try {
      if (recurrent) {
        const frais: RecurrenceDraft = {
          ...commun,
          frequency: rythme,
          starts_on: debut,
          ends_on: fin,
        }
        await api.addRecurrence(frais)
      } else {
        const mouvement: MovementDraft = {
          ...commun,
          movement_date: date,
          period_from: debut || null,
          period_to: fin || null,
        }

        if (initial === null) {
          await api.addMovement(mouvement)
        } else {
          await api.updateMovement(initial.id, mouvement)
        }
      }

      onDone()
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async () => {
    if (initial === null) return

    setEnvoi(true)
    setErreur(null)

    try {
      await api.deleteMovement(initial.id)
      onDone()
    } catch (echec) {
      setErreur(describeError(echec))
      setSuppression(false)
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="card movement">
      <h2 className="movement__title">
        {correction
          ? 'Corriger l’écriture'
          : recurrent
            ? 'Nouveau frais récurrent'
            : 'Nouveau mouvement'}
      </h2>

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

      <div className="movement__sens">
        {([
          ['reseau', 'Tout le réseau', 'Le fonds commun'],
          ['boutique', 'Une boutique', 'Imputé à un seul magasin'],
        ] as const).map(([code, label, note]) => (
          <button
            key={code}
            type="button"
            className={`choice${cible === code ? ' is-on' : ''}`}
            aria-pressed={cible === code}
            onClick={() => {
              setCible(code)
              if (code === 'reseau') setBoutique('')
            }}
          >
            <strong>{label}</strong>
            <span className="muted">{note}</span>
          </button>
        ))}
      </div>

      {/* Le rythme après le sens, avant tout le reste : il change ce que
          demandent les champs suivants — une date d'écriture pour une ligne,
          une plage de répétition pour un abonnement. */}
      {correction ? null : (
        <div className="movement__rythme">
          <span className="field__legend">Répétition</span>
          <div className="filters__row">
            {([
              ['once', 'Ponctuel'],
              ['month', 'Tous les mois'],
              ['quarter', 'Tous les trimestres'],
              ['year', 'Tous les ans'],
            ] as const).map(([code, label]) => (
              <button
                key={code}
                type="button"
                className={`filter${rythme === code ? ' is-on' : ''}`}
                aria-pressed={rythme === code}
                onClick={() => setRythme(code)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {cible === 'boutique' ? (
        <label className="field field--block">
          Boutique
          <select value={boutique} onChange={(e) => setBoutique(e.target.value)}>
            <option value="">Choisir une boutique…</option>
            {(shops.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.city === null ? '' : ` — ${entry.city}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="movement__grid">
        <label className="field field--block">
          Libellé
          <input
            value={libelle}
            placeholder={sens === 'IN' ? 'Dotation du fonds T1' : 'Impression dépliants Épiphanie'}
            onChange={(e) => setLibelle(e.target.value)}
          />
        </label>

        <label className="field">
          {recurrent ? 'Montant par échéance' : 'Montant'}
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

        {/* Un frais récurrent n'a pas de date d'écriture : chaque échéance porte
            la sienne, celle du jour où elle tombe. */}
        {recurrent ? null : (
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
        )}

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
          <span>{recurrent ? 'Plage de répétition' : 'Période couverte'}</span>
          <button
            type="button"
            className="datefield"
            aria-expanded={ouvert === 'periode'}
            onClick={() => setOuvert(ouvert === 'periode' ? null : 'periode')}
          >
            {debut === '' && fin === ''
              ? recurrent
                ? 'Choisir la plage de répétition'
                : 'Aucune — mouvement ponctuel'
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

        {/* Une ligne muette par accident vaut moins qu'une ligne visible par
            accident : la case se décoche, elle ne se coche pas. */}
        <label className="field field--inline">
          <input
            type="checkbox"
            checked={publique}
            onChange={(e) => setPublique(e.target.checked)}
          />
          <span>
            Visible par le réseau
            <span className="muted"> — décochez pour réserver à la marque</span>
          </span>
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

      {/* Rien tant que rien n'est saisi : un formulaire qui s'ouvre en rouge
          reproche à l'utilisateur de ne pas avoir encore commencé. */}
      {!periodeValide && (debut !== '' || fin !== '') ? (
        <p className="error">
          {recurrent && (debut === '' || fin === '')
            ? 'Un frais récurrent a un début et une fin : sans fin, on ne sait pas combien d’échéances écrire.'
            : (debut === '') !== (fin === '')
              ? 'Donnez le début et la fin de la période, ou aucun des deux.'
              : 'La fin de période précède son début.'}
        </p>
      ) : null}

      {recurrent && periodeValide && echeances > 240 ? (
        <p className="error">
          Ce rythme donnerait {echeances} échéances (maximum 240) : vérifiez la date de fin.
        </p>
      ) : null}

      {erreur === null ? null : <p className="error">{erreur}</p>}

      {/* L'aperçu dit ce que le bouton va faire. Pour un abonnement, ce n'est
          pas le montant saisi qui touche le solde, c'est le total — et c'est
          exactement le chiffre qu'on ne calcule pas de tête. */}
      <p className="muted movement__apercu">
        {!montantValide
          ? 'Le montant se saisit sans signe : c’est le sens qui le porte.'
          : recurrent && echeances > 0
            ? `${echeances} échéance${echeances > 1 ? 's' : ''} de ${formatEur(somme, 2)} — ${sens === 'IN' ? '+' : '−'} ${formatEur(somme * echeances, 2)} sur le solde du fonds`
            : `${sens === 'IN' ? '+' : '−'} ${formatEur(somme, 2)} sur le solde du fonds`}
      </p>

      <div className="movement__actions">
        {/* La suppression vit dans la correction : c'est là qu'on découvre
            qu'une ligne n'aurait pas dû exister, et un bouton par ligne du
            grand livre en ferait un champ de mines. */}
        {correction ? (
          <button
            type="button"
            className="filter confirm__danger movement__supprimer"
            disabled={envoi}
            onClick={() => setSuppression(true)}
          >
            Supprimer l’écriture
          </button>
        ) : null}

        <button type="button" className="filter" onClick={onCancel} disabled={envoi}>
          Annuler
        </button>
        <button
          type="button"
          className="filter is-on"
          disabled={!complet || envoi}
          onClick={enregistrer}
        >
          {envoi
            ? 'Enregistrement…'
            : correction
              ? 'Enregistrer la correction'
              : recurrent
                ? echeances > 0
                  ? `Écrire les ${echeances} échéances`
                  : 'Écrire les échéances'
                : 'Enregistrer le mouvement'}
        </button>
      </div>

      {!suppression || initial === null ? null : (
        <div
          className="confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ecriture"
          onClick={() => (envoi ? null : setSuppression(false))}
        >
          <div className="confirm__box card" onClick={(evenement) => evenement.stopPropagation()}>
            <h3 id="confirm-ecriture">Supprimer « {initial.label} » ?</h3>
            <p className="muted">
              {formatEur(initial.amount, 2)} du {formatDate(initial.movement_date)} quitteront le
              grand livre, et le solde du fonds avec.
              {initial.recurrence_id === null
                ? ''
                : ' Cette ligne vient d’un frais récurrent : les autres échéances restent.'}
            </p>

            <div className="confirm__actions">
              <button
                type="button"
                className="filter"
                disabled={envoi}
                onClick={() => setSuppression(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="filter confirm__danger"
                disabled={envoi}
                onClick={supprimer}
              >
                {envoi ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Nombre d'échéances entre deux dates, bornes comprises.
 *
 * Même arithmétique que le serveur, et pour la même raison : chaque échéance se
 * compte depuis le début, jamais depuis la précédente. En repartant de la
 * dernière, un 31 janvier deviendrait le 28 février puis le 28 mars, et
 * l'aperçu annoncerait un nombre que le serveur n'écrirait pas.
 */
function compterEcheances(debut: string, fin: string, rythme: Frequency): number {
  const pas = rythme === 'month' ? 1 : rythme === 'quarter' ? 3 : 12
  const [a1, m1, j1] = debut.split('-').map(Number)
  if (a1 === undefined || m1 === undefined || j1 === undefined) return 0

  let compte = 0
  for (let rang = 0; rang <= 241; rang++) {
    const total = a1 * 12 + (m1 - 1) + rang * pas
    const annee = Math.floor(total / 12)
    const mois = (total % 12) + 1
    // Le quantième ramené au dernier jour du mois quand il n'existe pas : le
    // 31 mars répété donne le 30 avril, pas le 1er mai.
    const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
    const quantieme = Math.min(j1, dernier)
    const echeance = `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(quantieme).padStart(2, '0')}`

    if (echeance > fin) break
    compte++
  }

  return compte
}
