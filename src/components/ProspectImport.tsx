import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatNumber } from '../lib/useAsync'
import type { ImportReport, ProspectRow } from '../lib/api/module'
import { describeError } from '../state/auth'

/**
 * Import du vivier de comptes B2B.
 *
 * Le découpage du fichier se fait ici, pas sur le serveur : l'utilisateur voit
 * ses colonnes interprétées avant d'envoyer quoi que ce soit, et le serveur n'a
 * pas à connaître les séparateurs ni les encodages d'un CSV. Ce qui part sur le
 * réseau est déjà structuré.
 *
 * C'est ce vivier qui alimente la génération des leads : sans lui, la case
 * « générer » de l'assistant ne peut rien produire.
 */

/** Colonnes reconnues. Les en-têtes sont comparés sans accents ni casse. */
const COLUMNS: Record<string, keyof ProspectRow> = {
  ref: 'external_ref',
  reference: 'external_ref',
  societe: 'company_name',
  entreprise: 'company_name',
  nom: 'company_name',
  secteur: 'sector',
  contact: 'contact_name',
  email: 'contact_email',
  mail: 'contact_email',
  telephone: 'contact_phone',
  tel: 'contact_phone',
  volume: 'size_label',
  taille: 'size_label',
  potentiel: 'potential_amount',
  ville: 'city',
  cp: 'postal_code',
  'code postal': 'postal_code',
}

function normalise(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Découpe une ligne CSV en respectant les guillemets.
 *
 * Un `split(';')` casserait sur `"Dupont, SA";offices` — et une raison sociale
 * contenant le séparateur est la règle plutôt que l'exception.
 */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      // Deux guillemets consécutifs à l'intérieur d'un champ en représentent un.
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === separator && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }

  cells.push(current)

  return cells.map((cell) => cell.trim())
}

/** Texte CSV → lignes structurées, plus les en-têtes non reconnus. */
function parseCsv(text: string): { rows: ProspectRow[]; unknown: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return { rows: [], unknown: [] }

  // Le séparateur se déduit de l'en-tête : les exports français utilisent le
  // point-virgule, les anglo-saxons la virgule, et deviner mal décale tout.
  const separator = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','

  const headers = splitLine(lines[0], separator).map(normalise)
  const unknown = headers.filter((header) => header !== '' && !(header in COLUMNS))

  const rows = lines.slice(1).map((line) => {
    const cells: string[] = splitLine(line, separator)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      const field = COLUMNS[header]
      if (field && cells[index] !== undefined) row[field] = cells[index]
    })

    return row as unknown as ProspectRow
  })

  return { rows, unknown }
}

export default function ProspectImport() {
  // Le compteur force la relecture du vivier après un import : sans lui,
  // l'écran annoncerait encore l'effectif d'avant.
  const [reloadKey, setReloadKey] = useState(0)
  const availability = useAsync(() => api.getSectorAvailability(), [reloadKey])
  const [text, setText] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const parsed = parseCsv(text)
  const named = parsed.rows.filter((row) => (row.company_name ?? '').trim() !== '')

  const totals = (availability.data ?? []).reduce(
    (sum, sector) => ({
      estimated: sum.estimated + sector.estimated_leads_count,
      available: sum.available + sector.available,
    }),
    { estimated: 0, available: 0 },
  )

  async function send() {
    setSending(true)
    setFailure(null)
    setReport(null)

    try {
      setReport(await api.importProspects(named, 'import CSV'))
      setText('')
      setReloadKey(reloadKey + 1)
    } catch (cause: unknown) {
      setFailure(describeError(cause))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card table-card">
      <h2>Vivier B2B</h2>
      <p className="muted">
        Ce sont ces comptes que la génération de leads distribue aux boutiques. Le chiffre de
        cadrage d’un secteur dit combien on vise ; le vivier, combien on a réellement.
      </p>

      {availability.error ? <p className="error">{availability.error}</p> : null}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Secteur</th>
              <th className="num">Cadrage</th>
              <th className="num">Dans le vivier</th>
            </tr>
          </thead>
          <tbody>
            {(availability.data ?? []).map((sector) => (
              <tr key={sector.id}>
                <td>{sector.label}</td>
                <td className="num muted">{formatNumber(sector.estimated_leads_count)}</td>
                <td className="num">{formatNumber(sector.available)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ledger__total">
              <td>Total</td>
              <td className="num muted">{formatNumber(totals.estimated)}</td>
              <td className="num">{formatNumber(totals.available)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="section-label">Importer un fichier</h3>
      <p className="muted">
        Colonnes reconnues : <code>ref</code>, <code>société</code>, <code>secteur</code>,{' '}
        <code>contact</code>, <code>email</code>, <code>téléphone</code>, <code>volume</code>,{' '}
        <code>potentiel</code>, <code>ville</code>, <code>cp</code>. La colonne{' '}
        <code>ref</code> rend l’import rejouable : sans elle, réimporter le même fichier crée des
        doublons.
      </p>

      <label className="field field--grow">
        Fichier CSV
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            file.text().then(setText)
          }}
        />
      </label>

      <label className="field field--block">
        …ou collez son contenu
        <textarea
          rows={5}
          value={text}
          placeholder="ref;société;secteur;contact;email"
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {parsed.unknown.length > 0 ? (
        <p className="muted">
          Colonnes ignorées : {parsed.unknown.join(', ')}.
        </p>
      ) : null}

      {text.trim() !== '' ? (
        <p className="muted wizard__hint">
          {named.length} ligne{named.length > 1 ? 's' : ''} exploitable
          {named.length > 1 ? 's' : ''} sur {parsed.rows.length} lue
          {parsed.rows.length > 1 ? 's' : ''}
          {named.filter((row) => (row.external_ref ?? '') === '').length > 0
            ? ` — dont ${named.filter((row) => (row.external_ref ?? '') === '').length} sans référence`
            : ''}
          .
        </p>
      ) : null}

      {failure ? <p className="error">{failure}</p> : null}

      {report ? (
        <>
          <p className="muted wizard__hint">
            {report.imported} créé(s), {report.updated} mis à jour, {report.skipped} écarté(s)
            {report.without_ref > 0 ? `, ${report.without_ref} sans référence` : ''}.
          </p>
          {report.errors.length > 0 ? (
            <ul className="card">
              {report.errors.slice(0, 10).map((error, index) => (
                <li key={index} className="muted">
                  {error}
                </li>
              ))}
              {report.errors.length > 10 ? (
                <li className="muted">… et {report.errors.length - 10} autre(s).</li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}

      <div className="filters__row">
        <button
          type="button"
          className="filter is-on"
          onClick={send}
          disabled={sending || named.length === 0}
        >
          {sending ? 'Import…' : `Importer ${named.length} compte(s)`}
        </button>
        {text.trim() !== '' ? (
          <button type="button" className="filter" onClick={() => setText('')}>
            Effacer
          </button>
        ) : null}
      </div>
    </section>
  )
}
