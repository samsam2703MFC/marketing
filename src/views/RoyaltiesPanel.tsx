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
  }, [data])

  // Le bilan ne se vide qu'en changeant de mois. L'effacer à chaque relecture
  // le faisait disparaître aussitôt affiché : écrire les entrées recharge le
  // tableau, et le compte-rendu de ce qu'on venait d'écrire partait avec.
  useEffect(() => {
    setBilan(null)
  }, [mois])

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

      // D'où viennent les montants écrits : une facture ERP reprise et un
      // calcul local n'appellent pas la même confiance, et le bilan doit le
      // dire sans qu'on rouvre le grand livre.
      const origine =
        bilanEcriture.from_erp === 0
          ? ''
          : bilanEcriture.from_erp === bilanEcriture.created
            ? ' — reprises des factures ERP'
            : ` — dont ${bilanEcriture.from_erp} reprises des factures ERP`

      setBilan(
        `${bilanEcriture.created} entrée${bilanEcriture.created > 1 ? 's' : ''} écrite${bilanEcriture.created > 1 ? 's' : ''}`
        + ` — ${formatEur(bilanEcriture.total_amount, 2)}`
        + origine
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

      <ErpState etat={data?.erp ?? null} />

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
                      {/* D'où vient le chiffre affiché : une valeur reprise de
                          la facture ne se relit pas comme une valeur tapée. */}
                      {vientDeLErp(boutique, 'ca') ? (
                        <span
                          className="royalties__origine"
                          title={
                            // Un chiffre calculé ne se présente pas comme un
                            // chiffre lu : la facture ne porte pas toujours son
                            // assiette, et on la retrouve alors par le taux.
                            deduite(boutique)
                              ? `${boutique.erp?.document_ref} — assiette déduite du taux et du montant`
                              : boutique.erp?.document_ref
                          }
                        >
                          {deduite(boutique) ? 'ERP ≈' : 'ERP'}
                        </span>
                      ) : null}
                    </td>
                    {ROYALTY_KINDS.map(({ kind }) => {
                      const taux = nombre(saisie.taux[kind])
                      const ecrit = boutique.movements[kind]
                      const facture = boutique.erp?.lines[kind]

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
                          {/* Le montant : celui déjà écrit, sinon celui que
                              l'ERP a facturé, sinon celui que le taux
                              produirait. C'est le chiffre qu'on relit avant de
                              facturer, et qu'on ne calcule pas de tête. */}
                          <span className="royalties__calcul">
                            {ecrit !== undefined
                              ? formatEur(ecrit.amount, 2)
                              : facture !== undefined
                                ? formatEur(facture.amount, 2)
                                : base !== null && taux !== null
                                  ? formatEur(Math.round(base * taux) / 100, 2)
                                  : '—'}
                            {ecrit === undefined && facture !== undefined ? (
                              <span className="royalties__origine">ERP</span>
                            ) : null}
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
 * L'état de la lecture ERP, en une ligne.
 *
 * Les chiffres, eux, sont déjà dans le tableau : `royalty_invoice` fait foi, et
 * les tenir dans un bloc à part obligeait à comparer deux listes de l'œil pour
 * répondre à « ce magasin est-il à jour ? » — la question que le tableau doit
 * trancher. Ne reste ici que ce qu'une case ne peut pas dire : la table est-elle
 * lisible, et si non, que contient-elle vraiment.
 */
function ErpState({
  etat,
}: {
  etat: {
    available: boolean
    reason: string | null
    invoices: number
    inventory: Record<string, { 'non reconnues': string[]; disponibles: string[] }>
    unknown_labels: string[]
  } | null
}) {
  const [detail, setDetail] = useState(false)

  if (etat === null) return null

  return (
    <div className={`erpinvoices${etat.available ? '' : ' is-off'}`}>
      <div className="erpinvoices__head">
        <strong>Facturé par l’ERP</strong>
        <span className="muted">
          {etat.available
            ? etat.invoices === 0
              ? 'aucune facture sur ce mois'
              : `${etat.invoices} facture${etat.invoices > 1 ? 's' : ''} reprise${etat.invoices > 1 ? 's' : ''} dans le tableau`
            : 'lecture impossible'}
        </span>
        <button type="button" className="linklike" onClick={() => setDetail(!detail)}>
          {detail ? 'Masquer les colonnes' : 'Voir les colonnes lues'}
        </button>
      </div>

      {etat.available ? null : <p className="error">{etat.reason}</p>}

      {/* Une ligne dont la nature n'est pas reconnue n'est pas importée : mal
          classée, elle s'écrirait aussi bien qu'une autre et personne ne le
          verrait. Son libellé exact est donc affiché — c'est ce qu'il faut
          savoir pour la rattacher. */}
      {etat.unknown_labels.length === 0 ? null : (
        <p className="muted erpinvoices__inconnus">
          Non rattaché à une redevance, donc non repris :{' '}
          {etat.unknown_labels.map((libelle) => (
            <span key={libelle} className="erpinvoices__libelle">
              {libelle}
            </span>
          ))}
        </p>
      )}

      {detail ? (
        <div className="erpinvoices__detail">
          {/* Ce qu'il faut lire pour comprendre un import qui ne trouve rien :
              les noms de colonnes de l'ERP ne sont pas connus de ce dépôt, ils
              sont reconnus — et ce qui ne l'est pas se voit. */}
          {Object.entries(etat.inventory).map(([table, contenu]) => (
            <p key={table} className="muted">
              <strong>{table}</strong> — non reconnues :{' '}
              {contenu['non reconnues'].length === 0 ? 'aucune' : contenu['non reconnues'].join(', ')}
              <br />
              colonnes présentes : {contenu.disponibles.join(', ')}
            </p>
          ))}
          {Object.keys(etat.inventory).length === 0 ? (
            <p className="muted">Aucune table lue.</p>
          ) : null}
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

/**
 * L'état d'une ligne au chargement.
 *
 * Ce que l'ERP a facturé remplit les cases restées vides : c'est le chiffre qui
 * fait foi, et le retaper à la main serait à la fois du travail et une occasion
 * de se tromper. Un taux ou un CA déjà saisis dans le module l'emportent — on ne
 * remplace pas ce que quelqu'un a écrit exprès.
 */
function lire(boutique: RoyaltyShop): Saisie {
  const taux: Partial<Record<RoyaltyKind, string>> = {}
  for (const { kind } of ROYALTY_KINDS) {
    const valeur = boutique.rates[kind]?.rate_pct ?? boutique.erp?.lines[kind]?.rate ?? undefined
    taux[kind] = valeur === undefined || valeur === null ? '' : String(valeur).replace('.', ',')
  }

  const ca = boutique.revenue_amount ?? boutique.erp?.revenue ?? null

  return {
    ca: ca === null ? '' : String(ca).replace('.', ','),
    taux,
  }
}

/**
 * Vrai quand le CA affiché a été retrouvé par le calcul plutôt que lu.
 *
 * L'ERP ne stocke pas toujours l'assiette : un montant et un pourcentage
 * suffisent à la retrouver, mais le chiffre obtenu n'a pas le même statut que
 * celui qu'on lit sur la facture, et l'écran doit le dire.
 */
function deduite(boutique: RoyaltyShop): boolean {
  return ROYALTY_KINDS.some(({ kind }) => boutique.erp?.lines[kind]?.base_derived === true)
}

/** Vrai quand la valeur affichée vient de la facture ERP et non de la saisie. */
function vientDeLErp(boutique: RoyaltyShop, champ: 'ca' | RoyaltyKind): boolean {
  if (champ === 'ca') {
    return boutique.revenue_amount === null && (boutique.erp?.revenue ?? null) !== null
  }

  return (
    boutique.rates[champ] === undefined
    && (boutique.erp?.lines[champ]?.rate ?? null) !== null
  )
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
