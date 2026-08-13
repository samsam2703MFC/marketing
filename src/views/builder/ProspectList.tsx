import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { Prospect } from '../../lib/api/module'

/**
 * Comptes des secteurs retenus, sous les secteurs eux-mêmes.
 *
 * L'étape annonçait « 184 comptes estimés » sans pouvoir en nommer un seul.
 * C'est un chiffre de cadrage — une intention de démarchage — et il ne dit rien
 * de ce qu'on a réellement sous la main.
 *
 * Les comptes sont groupés par boutique référente et coulent sur trois
 * colonnes : c'est elle qui passera l'appel, et voir « Corbais · 8 » à côté de
 * « Halle · 3 » dit d'un regard comment la charge se répartit. La liste vivait
 * en colonne à droite du formulaire, où huit cents comptes tenaient dans un
 * filet de deux cents pixels.
 */
export default function ProspectList({
  sectorIds,
  shopIds = [],
}: {
  sectorIds: number[]
  /**
   * Boutiques de la campagne. Ne sont alors montrés que les comptes qui leur
   * sont rattachés — la boutique préférée du client dans l'ERP, celle où il a
   * l'habitude d'aller et qui l'appellera. Vide pour une campagne réseau : elle
   * vise tout le vivier.
   */
  shopIds?: number[]
}) {
  const [query, setQuery] = useState('')

  const { data, error, loading } = useAsync(
    () => api.listProspects(sectorIds, shopIds),
    [sectorIds.join(','), shopIds.join(',')],
  )

  // L'effectif vient de la base, pas de la longueur de la liste : celle-ci est
  // bornée, et compter ses lignes annoncerait deux cents comptes à qui va en
  // démarcher neuf cents. L'écart, quand il existe, est écrit noir sur blanc.
  const count = useAsync(
    () => api.countProspects(sectorIds, shopIds),
    [sectorIds.join(','), shopIds.join(',')],
  )
  const total = count.data?.total ?? data?.length ?? 0
  const reseau = count.data?.network ?? 0
  const sansBoutique = count.data?.without_shop ?? 0

  if (sectorIds.length === 0) {
    return (
      <p className="muted">
        Cochez un secteur pour voir les comptes qu’il contient, et la boutique qui les appellera.
      </p>
    )
  }

  if (error !== null) return <p className="error">{error}</p>
  if (loading && data === null) return <p className="muted">Lecture du vivier…</p>
  if (data === null) return null

  if (data.length === 0) {
    // Deux vides très différents : « ces secteurs n'ont personne » appelle un
    // autre secteur, « personne n'est rattaché à ces boutiques » appelle une
    // autre boutique. Les confondre envoie chercher au mauvais endroit.
    return shopIds.length > 0 && reseau > 0 ? (
      <p className="muted">
        Aucun compte de ces secteurs n’est rattaché {shopIds.length > 1
          ? `aux ${shopIds.length} boutiques choisies`
          : 'à la boutique choisie'}, alors que le réseau en compte {reseau}.
        {sansBoutique > 0
          ? ` ${sansBoutique} compte${sansBoutique > 1 ? 's n’ont' : ' n’a'} aucune boutique de
             rattachement dans l’ERP : la génération les répartira quand même sur vos boutiques.`
          : ''}
      </p>
    ) : (
      <p className="muted">
        Aucun compte dans le vivier pour ces secteurs. La génération de leads ne créera rien tant
        que la reprise ERP n’a pas rattaché de comptes à ces secteurs.
      </p>
    )
  }

  const needle = query.trim().toLowerCase()
  const matching =
    needle === ''
      ? data
      : data.filter(
          (prospect) =>
            prospect.company_name.toLowerCase().includes(needle) ||
            (prospect.city ?? '').toLowerCase().includes(needle) ||
            (prospect.shop_name ?? '').toLowerCase().includes(needle),
        )

  // Groupement par boutique, dans l'ordre où les comptes arrivent — le serveur
  // les rend déjà triés, et les regrouper ne doit pas rebattre cet ordre.
  const groups: Array<{ shop: string; accounts: Prospect[] }> = []
  for (const prospect of matching) {
    const shop = prospect.shop_name ?? 'Sans boutique référente'
    const group = groups.find((candidate) => candidate.shop === shop)
    if (group) group.accounts.push(prospect)
    else groups.push({ shop, accounts: [prospect] })
  }

  return (
    <>
      <div className="prospects__head">
        <p className="muted">
          {total} compte{total > 1 ? 's' : ''}
          {/* D'où vient le chiffre : le vivier entier, ou la part que les
              boutiques choisies en retiennent. Sans cette précision, un
              effectif qui tombe de 184 à 12 en cochant une boutique se lit
              comme une perte de données. */}
          {shopIds.length === 0
            ? ' dans le vivier'
            : ` rattaché${total > 1 ? 's' : ''} à ${
                shopIds.length > 1 ? `vos ${shopIds.length} boutiques` : 'votre boutique'
              }, sur ${reseau} dans le réseau`}
          {data.length < total ? ` · ${data.length} affichés` : ''} ·{' '}
          {groups.length} boutique{groups.length > 1 ? 's' : ''} concernée
          {groups.length > 1 ? 's' : ''}
          {/* Les orphelins ne sont pas listés — ils ne sont « chez » personne —
              mais la génération les répartira sur les boutiques de la
              campagne. Les taire ferait découvrir des leads inattendus après
              coup. */}
          {shopIds.length > 0 && sansBoutique > 0
            ? ` · ${sansBoutique} sans boutique de rattachement, non listé${
                sansBoutique > 1 ? 's' : ''
              } ici mais réparti${sansBoutique > 1 ? 's' : ''} à la génération`
            : ''}
        </p>
        <input
          type="search"
          className="prospects__search"
          value={query}
          placeholder="Chercher un compte, une ville…"
          aria-label="Chercher parmi les comptes visés"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {matching.length === 0 ? (
        <p className="muted">Aucun compte ne répond à « {query.trim()} ».</p>
      ) : (
        <ul className="prospects">
          {groups.map((group) => (
            <li key={group.shop} className="prospects__group">
              <p className="prospects__shop">
                {group.shop}
                <span className="muted"> · {group.accounts.length}</span>
              </p>
              <ul>
                {group.accounts.map((prospect) => (
                  <li key={prospect.id}>
                    {/* `title` porte le nom entier : une raison sociale longue
                        est tronquée à l'affichage, pas perdue. */}
                    <strong title={prospect.company_name}>{prospect.company_name}</strong>
                    {prospect.city ? <span className="muted"> · {prospect.city}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
