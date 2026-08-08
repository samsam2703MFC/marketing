import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

/**
 * Comptes des secteurs retenus, en regard de l'assistant.
 *
 * L'étape annonçait « 184 comptes estimés » sans pouvoir en nommer un seul.
 * C'est un chiffre de cadrage — une intention de démarchage — et il ne dit rien
 * de ce qu'on a réellement sous la main. Ce panneau montre les comptes du
 * vivier, avec la boutique qui les appellera : c'est elle qui décide si le
 * périmètre choisi tient debout.
 *
 * Il occupe la colonne restée vide à droite du formulaire, où le regard va
 * naturellement après avoir coché un secteur.
 */
export default function ProspectPanel({ sectorIds }: { sectorIds: number[] }) {
  const { data, error, loading } = useAsync(
    () => api.listProspects(sectorIds),
    [sectorIds.join(',')],
  )

  // L'effectif vient de la base, pas de la longueur de la liste : celle-ci est
  // bornée, et compter ses lignes annoncerait deux cents comptes à qui va en
  // démarcher neuf cents. L'écart, quand il existe, est écrit noir sur blanc
  // plutôt que laissé à deviner au bas d'un panneau qui s'arrête net.
  const count = useAsync(() => api.countProspects(sectorIds), [sectorIds.join(',')])
  const total = count.data?.total ?? data?.length ?? 0

  if (sectorIds.length === 0) {
    return (
      <aside className="side-panel">
        <h3>Comptes visés</h3>
        <p className="muted">
          Cochez un secteur pour voir les comptes qu’il contient, et la boutique qui les
          appellera.
        </p>
      </aside>
    )
  }

  return (
    <aside className="side-panel">
      <h3>Comptes visés</h3>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Lecture du vivier…</p> : null}

      {data && data.length === 0 ? (
        <p className="muted">
          Aucun compte dans le vivier pour ces secteurs. La génération de leads ne créera rien
          tant que la reprise ERP n’a pas rattaché de comptes à ces secteurs.
        </p>
      ) : null}

      {data && data.length > 0 ? (
        <>
          <p className="muted">
            {total} compte{total > 1 ? 's' : ''} dans le vivier
            {data.length < total ? ` · ${data.length} affichés` : ''}
          </p>
          <ul className="side-panel__list">
            {data.map((prospect) => (
              <li key={prospect.id}>
                {/* `title` porte le nom entier : une raison sociale longue est
                    tronquée à l'affichage, pas perdue. */}
                <strong title={prospect.company_name}>{prospect.company_name}</strong>
                <span className="muted" title={prospect.shop_name ?? undefined}>
                  {prospect.shop_name ?? 'Sans boutique référente'}
                  {prospect.city ? ` · ${prospect.city}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  )
}
