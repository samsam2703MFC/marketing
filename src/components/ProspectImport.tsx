import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatNumber } from '../lib/useAsync'
import type { ImportReport, ProspectRow, SyncReport, SyncResult } from '../lib/api/module'
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
  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<SyncResult | null>(null)

  const parsed = parseCsv(text)
  const named = parsed.rows.filter((row) => (row.company_name ?? '').trim() !== '')

  const totals = (availability.data ?? []).reduce(
    (sum, sector) => ({
      estimated: sum.estimated + sector.estimated_leads_count,
      available: sum.available + sector.available,
    }),
    { estimated: 0, available: 0 },
  )

  // Le total vient de la base : un compte relevant de trois secteurs apparaît
  // sur trois lignes, et additionner les lignes gonflerait le vivier d'autant.
  const sectorIds = (availability.data ?? []).map((sector) => sector.id)
  const distinct = useAsync(() => api.countProspects(sectorIds), [sectorIds.join(',')])
  const available = distinct.data?.total ?? totals.available

  // Les secteurs repris de l'ERP n'ont pas de chiffre de cadrage : l'ERP tient
  // ses types de compte, pas une intention de démarchage. La colonne disparaît
  // quand elle ne contiendrait que des zéros.
  const framed = totals.estimated > 0

  /**
   * Reprise depuis l'ERP.
   *
   * C'est la source normale : les boutiques et les clients professionnels
   * vivent dans l'ERP, l'import de fichier ne sert qu'aux comptes qu'il ne
   * connaît pas (prospection achetée, salon, liste d'un franchisé).
   */
  async function runSync() {
    setSyncing(true)
    setFailure(null)
    setSync(null)

    try {
      setSync(await api.syncErp())
      setReloadKey((current) => current + 1)
    } catch (cause: unknown) {
      setFailure(describeError(cause))
    } finally {
      setSyncing(false)
    }
  }

  async function send() {
    setSending(true)
    setFailure(null)
    setReport(null)

    try {
      setReport(await api.importProspects(named, 'import CSV'))
      setText('')
      setReloadKey((current) => current + 1)
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
        Ce sont ces comptes que la génération de leads distribue aux boutiques.
        {framed
          ? ' Le chiffre de cadrage d’un secteur dit combien on vise ; le vivier, combien on a réellement.'
          : ' Les secteurs sont les types de compte professionnel de l’ERP, et chaque compte peut en relever de plusieurs.'}
      </p>

      {availability.error ? <p className="error">{availability.error}</p> : null}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Secteur</th>
              {framed ? <th className="num">Cadrage</th> : null}
              <th className="num">Dans le vivier</th>
            </tr>
          </thead>
          <tbody>
            {(availability.data ?? []).map((sector) => (
              <tr key={sector.id}>
                <td>{sector.label}</td>
                {framed ? (
                  <td className="num muted">{formatNumber(sector.estimated_leads_count)}</td>
                ) : null}
                <td className="num">{formatNumber(sector.available)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ledger__total">
              <td>Total</td>
              {framed ? <td className="num muted">{formatNumber(totals.estimated)}</td> : null}
              <td className="num">{formatNumber(available)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {totals.available > available ? (
        <p className="muted">
          {formatNumber(totals.available - available)} compte
          {totals.available - available > 1 ? 's' : ''} relève
          {totals.available - available > 1 ? 'nt' : ''} de plusieurs secteurs : le total compte
          les comptes, pas les lignes.
        </p>
      ) : null}

      <h3 className="section-label">Reprendre depuis l’ERP</h3>
      <p className="muted">
        Les boutiques et les clients marqués professionnels viennent de l’ERP. La reprise est
        rejouable : elle met à jour les fiches connues et n’ajoute que les nouvelles.
      </p>
      <div className="filters__row">
        <button type="button" className="filter is-on" onClick={runSync} disabled={syncing}>
          {syncing ? 'Reprise…' : 'Reprendre boutiques & comptes B2B'}
        </button>
      </div>

      {sync ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Reprise</th>
                <th>Source</th>
                <th className="num">Lues</th>
                <th className="num">Créées</th>
                <th className="num">Mises à jour</th>
                <th className="num">Écartées</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Boutiques', sync.shops],
                  ['Comptes B2B', sync.prospects],
                  ['Secteurs', sync.sectors],
                  // Ces rapports peuvent porter une erreur seule : la ligne ne
                  // se montre que quand la reprise a réellement lu.
                  ['Produits', sync.products && 'read' in sync.products ? sync.products : undefined],
                  ['Saisons', sync.seasons && 'read' in sync.seasons ? sync.seasons : undefined],
                ] as Array<[string, SyncReport | undefined]>
              )
                .filter((entry): entry is [string, SyncReport] => entry[1] !== undefined)
                .map(([label, report]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="muted">
                      <code>{report.source}</code>
                    </td>
                    <td className="num">{report.read}</td>
                    <td className="num">{report.created}</td>
                    <td className="num">{report.updated}</td>
                    <td className="num">{report.skipped}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Le rattachement aux secteurs se rend à part : il compte des liens, pas
          des fiches, et c'est la seule partie de la reprise qui peut échouer
          seule. Un tableau à zéro n'aurait pas dit laquelle des deux. */}
      {sync?.links?.error ? (
        <p className="error">Secteurs non rattachés : {sync.links.error}</p>
      ) : null}

      {sync?.products && 'error' in sync.products ? (
        <p className="error">Catalogue produit non repris : {sync.products.error}</p>
      ) : null}

      {sync?.seasons && 'error' in sync.seasons ? (
        <p className="error">Gammes saisonnières non reprises : {sync.seasons.error}</p>
      ) : null}

      {sync?.season_links?.error ? (
        <p className="error">Disponibilités produit ↔ gamme non reprises : {sync.season_links.error}</p>
      ) : null}

      {sync?.season_links && !sync.season_links.error ? (
        <p className="muted">
          {sync.season_links.linked ?? 0} disponibilité{(sync.season_links.linked ?? 0) > 1 ? 's' : ''}{' '}
          produit ↔ gamme depuis <code>{sync.season_links.source}</code>
          {(sync.season_links.unknown_product ?? 0) > 0
            ? `, ${sync.season_links.unknown_product} ligne(s) sur un produit hors catalogue`
            : ''}
          {(sync.season_links.unknown_season ?? 0) > 0
            ? `, ${sync.season_links.unknown_season} sur une gamme inconnue`
            : ''}
          .
        </p>
      ) : null}

      {sync?.links && !sync.links.error ? (
        <p className="muted">
          {sync.links.linked ?? 0} rattachement{(sync.links.linked ?? 0) > 1 ? 's' : ''} compte ↔
          secteur depuis <code>{sync.links.source}</code>
          {(sync.links.unknown_client ?? 0) > 0
            ? `, ${sync.links.unknown_client} ligne(s) sur un client hors vivier`
            : ''}
          {(sync.links.unknown_sector ?? 0) > 0
            ? `, ${sync.links.unknown_sector} sur un type inconnu`
            : ''}
          .{sync.links.warning ? ` ${sync.links.warning}` : ''}
        </p>
      ) : null}

      {/* La correspondance mesurée, et non la seule liste des colonnes
          retenues : certaines le sont sur la foi de leur nom, et « 4/4 » ou
          « 1/2 » est ce qui dit si ce nom disait vrai. */}
      {sync?.links?.match ? (
        <p className="muted">
          Correspondance des colonnes : <code>{sync.links.match}</code>
        </p>
      ) : null}

      {(sync?.links?.without_sector ?? 0) > 0 ? (
        <p className="muted">
          {sync?.links?.without_sector} compte
          {(sync?.links?.without_sector ?? 0) > 1 ? 's' : ''} du vivier ne relève d’aucun secteur :
          aucune campagne ne les retiendra tant que l’ERP ne leur donne pas de type de compte.
        </p>
      ) : null}

      <h3 className="section-label">Importer un fichier</h3>
      <p className="muted">
        Pour les comptes que l’ERP ne connaît pas : prospection achetée, salon, liste d’un
        franchisé.
      </p>
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
