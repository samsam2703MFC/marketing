import { useEffect, useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatEur } from '../lib/useAsync'
import { ROYALTY_KINDS } from '../lib/api/module'
import type { RoyaltyKind, RoyaltyShop } from '../lib/api/module'
import { describeError } from '../state/auth'

/**
 * Grille des redevances d'un mois.
 *
 * Ce qui alimente le fonds ne se tape pas ligne à ligne : c'est un pourcentage
 * du chiffre d'affaires net de chaque magasin, décliné en trois. Vingt magasins
 * font soixante écritures par mois, et personne ne relit l'année pour vérifier
 * qu'aucune ne manque.
 *
 * L'écran montre donc les trois taux et le CA côte à côte, puis écrit les
 * entrées. Il ne réécrit jamais celles qui existent : une redevance corrigée à
 * la main — remise accordée, mois partiel négocié — serait sinon écrasée sans
 * que personne puisse dire ce qui a disparu.
 */
export default function RoyaltiesPanel({ onWritten }: { onWritten: () => void }) {
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [tour, setTour] = useState(0)
  const [brouillon, setBrouillon] = useState<Record<number, Saisie>>({})
  const [erreur, setErreur] = useState<string | null>(null)
  const [bilan, setBilan] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const { data, loading } = useAsync(() => api.getRoyalties(mois), [mois, tour])

  // Le brouillon repart du serveur à chaque mois : garder les saisies d'avril en
  // passant à mai enregistrerait le CA d'avril sur mai sans que rien ne le dise.
  useEffect(() => {
    if (data === null) return

    const depart: Record<number, Saisie> = {}
    for (const boutique of data.shops) {
      depart[boutique.shop_id] = lire(boutique)
    }
    setBrouillon(depart)
    setBilan(null)
  }, [data])

  const boutiques = data?.shops ?? []
  const modifie = boutiques.some((boutique) => {
    const saisie = brouillon[boutique.shop_id]

    return saisie !== undefined && !identique(saisie, lire(boutique))
  })

  const enregistrer = async () => {
    setEnvoi(true)
    setErreur(null)

    const rates: Array<{ shop_id: number; kind: RoyaltyKind; rate_pct: number }> = []
    const revenues: Array<{ shop_id: number; revenue_amount: number | null }> = []

    for (const boutique of boutiques) {
      const saisie = brouillon[boutique.shop_id]
      if (saisie === undefined) continue

      for (const { kind } of ROYALTY_KINDS) {
        const valeur = nombre(saisie.taux[kind])
        // Un taux effacé n'est pas un taux à zéro : on ne touche pas à la ligne
        // existante plutôt que de facturer 0 % sans qu'on l'ait demandé.
        if (valeur !== null) {
          rates.push({ shop_id: boutique.shop_id, kind, rate_pct: valeur })
        }
      }

      revenues.push({ shop_id: boutique.shop_id, revenue_amount: nombre(saisie.ca) })
    }

    try {
      const reponse = await api.saveRoyalties({ month: mois, rates, revenues })
      setBilan(
        `${reponse.rates_changed} taux modifié${reponse.rates_changed > 1 ? 's' : ''}, `
        + `${reponse.revenues_saved} chiffre${reponse.revenues_saved > 1 ? 's' : ''} d’affaires enregistré${reponse.revenues_saved > 1 ? 's' : ''}.`,
      )
      setTour((n) => n + 1)
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  const generer = async () => {
    setEnvoi(true)
    setErreur(null)

    try {
      const bilanEcriture = await api.generateRoyalties(mois)
      const manques = [
        bilanEcriture.skipped > 0 ? `${bilanEcriture.skipped} déjà écrite${bilanEcriture.skipped > 1 ? 's' : ''}` : null,
        bilanEcriture.without_revenue > 0 ? `${bilanEcriture.without_revenue} sans CA déclaré` : null,
        bilanEcriture.without_rate > 0 ? `${bilanEcriture.without_rate} sans taux` : null,
      ].filter((part): part is string => part !== null)

      setBilan(
        `${bilanEcriture.created} entrée${bilanEcriture.created > 1 ? 's' : ''} écrite${bilanEcriture.created > 1 ? 's' : ''}`
        + ` — ${formatEur(bilanEcriture.total_amount, 2)}`
        + (manques.length > 0 ? ` (${manques.join(', ')})` : ''),
      )
      setTour((n) => n + 1)
      onWritten()
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  const changer = (shopId: number, champ: 'ca' | RoyaltyKind, valeur: string) =>
    setBrouillon((courant) => {
      const saisie = courant[shopId] ?? { ca: '', taux: {} }

      return {
        ...courant,
        [shopId]:
          champ === 'ca'
            ? { ...saisie, ca: valeur }
            : { ...saisie, taux: { ...saisie.taux, [champ]: valeur } },
      }
    })

  return (
    <section className="card royalties">
      <header className="royalties__head">
        <h2>Redevances</h2>
        {/* Pas de champ `month` natif : il s'affiche « August 2026 » à des gens
            qui écrivent « août », exactement comme les champs de date natifs
            affichaient mm/dd/yyyy avant d'être remplacés. */}
        <div className="royalties__mois">
          <button type="button" className="filter" aria-label="Mois précédent" onClick={() => setMois(decale(mois, -1))}>
            ‹
          </button>
          <span className="royalties__moisnom">{nomDuMois(mois)}</span>
          <button type="button" className="filter" aria-label="Mois suivant" onClick={() => setMois(decale(mois, 1))}>
            ›
          </button>
        </div>
      </header>

      <p className="muted royalties__note">
        Le taux s’applique au chiffre d’affaires net du mois. Une révision prend effet au
        premier du mois affiché : les mois déjà facturés gardent leur taux.
      </p>

      <ErpInvoices
        month={mois}
        tour={tour}
        onImported={() => {
          setTour((n) => n + 1)
          onWritten()
        }}
      />

      {loading ? <p className="muted">Chargement…</p> : null}
      {erreur === null ? null : <p className="error">{erreur}</p>}
      {bilan === null ? null : <p className="royalties__bilan">{bilan}</p>}

      {boutiques.length === 0 && !loading ? (
        <p className="muted">Aucune boutique dans votre périmètre.</p>
      ) : (
        <div className="table-scroll">
          <table className="royalties__grille">
            <thead>
              <tr>
                <th>Boutique</th>
                <th className="num">CA net du mois</th>
                {ROYALTY_KINDS.map(({ kind, label, public: publique }) => (
                  <th key={kind} className="num">
                    {label}
                    {/* Le cadenas dit ce que le franchisé verra : c'est la seule
                        différence de nature entre les trois redevances. */}
                    {publique ? null : (
                      <span className="royalties__prive" title="Réservé à la marque">
                        {' '}
                        🔒
                      </span>
                    )}
                  </th>
                ))}
                <th className="num">Écrit</th>
              </tr>
            </thead>
            <tbody>
              {boutiques.map((boutique) => {
                const saisie = brouillon[boutique.shop_id] ?? { ca: '', taux: {} }
                const base = nombre(saisie.ca)

                return (
                  <tr key={boutique.shop_id}>
                    <td>
                      {boutique.shop_name}
                      {boutique.city === null ? null : (
                        <span className="muted"> — {boutique.city}</span>
                      )}
                    </td>
                    <td className="num">
                      <input
                        className="royalties__champ"
                        value={saisie.ca}
                        inputMode="decimal"
                        placeholder="non déclaré"
                        onChange={(e) => changer(boutique.shop_id, 'ca', e.target.value)}
                      />
                    </td>
                    {ROYALTY_KINDS.map(({ kind }) => {
                      const taux = nombre(saisie.taux[kind])
                      const ecrit = boutique.movements[kind]

                      return (
                        <td key={kind} className="num">
                          <span className="royalties__taux">
                            <input
                              className="royalties__champ royalties__champ--pct"
                              value={saisie.taux[kind] ?? ''}
                              inputMode="decimal"
                              placeholder="—"
                              title={
                                boutique.rates[kind]?.from_default === true
                                  ? 'Taux par défaut de la marque'
                                  : undefined
                              }
                              onChange={(e) => changer(boutique.shop_id, kind, e.target.value)}
                            />
                            %
                          </span>
                          {/* Le montant que produirait ce taux, avant écriture :
                              c'est le chiffre qu'on ne calcule pas de tête, et
                              celui qu'on veut relire avant de facturer. */}
                          <span className="royalties__calcul">
                            {ecrit !== undefined
                              ? formatEur(ecrit.amount, 2)
                              : base !== null && taux !== null
                                ? formatEur(Math.round(base * taux) / 100, 2)
                                : '—'}
                          </span>
                        </td>
                      )
                    })}
                    <td className="num">
                      <span className="muted">
                        {Object.keys(boutique.movements).length} / {ROYALTY_KINDS.length}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="movement__actions">
        <button type="button" className="filter" disabled={!modifie || envoi} onClick={enregistrer}>
          {envoi ? 'Enregistrement…' : 'Enregistrer la grille'}
        </button>
        <button
          type="button"
          className="action"
          disabled={envoi || boutiques.length === 0}
          onClick={generer}
        >
          Écrire les entrées du mois
        </button>
      </div>
    </section>
  )
}

/**
 * Les redevances telles que l'ERP les a facturées.
 *
 * C'est la source qui fait foi : `royalty_invoice` existe déjà, et recalculer le
 * même fait à partir d'un taux tenu à part produirait un second chiffre — le
 * jour où les deux divergent, personne ne sait lequel est le bon.
 *
 * Quand la lecture échoue, l'écran montre pourquoi et ce que les tables
 * contiennent réellement, au lieu de laisser croire qu'il n'y a rien à
 * reprendre. Les noms de colonnes de l'ERP ne sont pas connus de ce dépôt ; ils
 * sont reconnus, et ce qui ne l'est pas se voit.
 */
function ErpInvoices({
  month,
  tour,
  onImported,
}: {
  month: string
  tour: number
  onImported: () => void
}) {
  const { data, loading } = useAsync(() => api.getErpRoyalties(month), [month, tour])
  const [envoi, setEnvoi] = useState(false)
  const [bilan, setBilan] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [detail, setDetail] = useState(false)

  if (loading || data === null) return null

  const factures = data.invoices
  const lignes = factures.reduce((total, facture) => total + facture.lines.length, 0)
  const reprendre = async () => {
    setEnvoi(true)
    setErreur(null)

    try {
      const resultat = await api.importErpRoyalties(month)
      const restes = [
        resultat.skipped > 0 ? `${resultat.skipped} déjà reprise${resultat.skipped > 1 ? 's' : ''}` : null,
        resultat.unmatched_shop > 0 ? `${resultat.unmatched_shop} sans boutique rapprochée` : null,
        resultat.unknown_kind > 0 ? `${resultat.unknown_kind} de nature non reconnue` : null,
      ].filter((part): part is string => part !== null)

      setBilan(
        `${resultat.created} entrée${resultat.created > 1 ? 's' : ''} reprise${resultat.created > 1 ? 's' : ''}`
        + ` — ${formatEur(resultat.total_amount, 2)}`
        + (restes.length > 0 ? ` (${restes.join(', ')})` : ''),
      )
      onImported()
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className={`erpinvoices${data.available ? '' : ' is-off'}`}>
      <div className="erpinvoices__head">
        <strong>Facturé par l’ERP</strong>
        {data.available ? (
          <span className="muted">
            {factures.length} facture{factures.length > 1 ? 's' : ''}, {lignes} ligne
            {lignes > 1 ? 's' : ''} sur ce mois
          </span>
        ) : (
          <span className="muted">lecture impossible</span>
        )}

        <button type="button" className="linklike" onClick={() => setDetail(!detail)}>
          {detail ? 'Masquer le détail' : 'Voir le détail'}
        </button>

        {data.available && factures.length > 0 ? (
          <button type="button" className="action" disabled={envoi} onClick={reprendre}>
            {envoi ? 'Reprise…' : 'Reprendre au grand livre'}
          </button>
        ) : null}
      </div>

      {data.available ? null : <p className="error">{data.reason}</p>}
      {erreur === null ? null : <p className="error">{erreur}</p>}
      {bilan === null ? null : <p className="royalties__bilan">{bilan}</p>}

      {detail ? (
        <div className="erpinvoices__detail">
          {/* Les colonnes reconnues, et celles que la table contient. C'est ce
              qu'il faut lire pour comprendre un import qui ne trouve rien. */}
          {Object.entries(data.inventory).map(([table, contenu]) => (
            <p key={table} className="muted">
              <strong>{table}</strong> — non reconnues :{' '}
              {contenu['non reconnues'].length === 0 ? 'aucune' : contenu['non reconnues'].join(', ')}
              <br />
              colonnes présentes : {contenu.disponibles.join(', ')}
            </p>
          ))}

          {factures.map((facture) => (
            <p key={facture.erp_id} className="muted">
              <strong>{facture.document_ref}</strong> — {facture.shop_name}
              {facture.shop_id === null ? ' (boutique non rapprochée)' : ''} —{' '}
              {facture.lines
                .map(
                  (ligne) =>
                    `${ligne.kind ?? 'nature inconnue'} ${formatEur(ligne.amount, 2)}`,
                )
                .join(' · ')}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** « août 2026 » — la même langue que le reste de l'écran. */
function nomDuMois(valeur: string): string {
  const [annee, mois] = valeur.split('-').map(Number)

  return annee === undefined || mois === undefined || MOIS[mois - 1] === undefined
    ? valeur
    : `${MOIS[mois - 1]} ${annee}`
}

function decale(valeur: string, pas: number): string {
  const [annee, mois] = valeur.split('-').map(Number)
  if (annee === undefined || mois === undefined) return valeur

  const rang = annee * 12 + (mois - 1) + pas

  return `${String(Math.floor(rang / 12)).padStart(4, '0')}-${String((rang % 12) + 1).padStart(2, '0')}`
}

/** Saisie en cours d'une ligne : des chaînes, parce qu'un champ vide n'est pas 0. */
type Saisie = { ca: string; taux: Partial<Record<RoyaltyKind, string>> }

function lire(boutique: RoyaltyShop): Saisie {
  const taux: Partial<Record<RoyaltyKind, string>> = {}
  for (const { kind } of ROYALTY_KINDS) {
    const valeur = boutique.rates[kind]?.rate_pct
    taux[kind] = valeur === undefined ? '' : String(valeur).replace('.', ',')
  }

  return {
    ca: boutique.revenue_amount === null ? '' : String(boutique.revenue_amount).replace('.', ','),
    taux,
  }
}

function identique(a: Saisie, b: Saisie): boolean {
  return (
    a.ca === b.ca
    && ROYALTY_KINDS.every(({ kind }) => (a.taux[kind] ?? '') === (b.taux[kind] ?? ''))
  )
}

/** La virgule est ce qu'on tape ici ; le point est ce que le serveur attend. */
function nombre(valeur: string | undefined): number | null {
  if (valeur === undefined || valeur.trim() === '') return null

  const lu = Number(valeur.trim().replace(/\s/g, '').replace(',', '.'))

  return Number.isFinite(lu) ? lu : null
}
