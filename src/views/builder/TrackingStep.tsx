import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { KpiPeriode, References, TrackingAction, TrackingBaseline, TrackingScope } from '../../lib/api/module'
import type { Draft } from './CampaignBuilder'

/**
 * Le suivi de la campagne : l'action qu'elle doit faire bouger, et comment on la juge.
 *
 * Le type de campagne porte un levier et son KPI ; il ne dit pas ce que CETTE
 * campagne a promis. « Lancement webshop » vise des commandes en ligne, une
 * ouverture vise du passage en caisse — et l'une se juge sur tout le réseau quand
 * l'autre se juge boutique par boutique. C'est ce que l'étape fait choisir, dans
 * une liste qui vient du référentiel : l'écran n'invente aucune action.
 *
 * Quand l'action se lit en caisse (trafic, panier), la référence de l'an dernier
 * aux mêmes dates est lue au cockpit, comme pour le KPI du levier : une cible se
 * pose au-dessus d'un chiffre connu, pas au-dessus de zéro. Hors caisse (webshop,
 * CRM), l'écran dit où la mesure se lira, sans afficher de chiffre qu'aucune
 * connexion ne fournit.
 */
export default function TrackingStep({
  draft,
  patch,
  refs,
  shops,
}: {
  draft: Draft
  patch: (change: Partial<Draft>) => void
  refs: References
  shops: Array<{ id: number; code: string; name: string }>
}) {
  const actions = refs.trackingActions ?? []
  const action = actions.find((entry) => entry.id === draft.tracking_action_id) ?? null
  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id) ?? null

  const choisir = (value: string) => {
    if (value === '') {
      patch({ tracking_action_id: null })
      return
    }
    // La portée suit celle de la campagne tant qu'on ne l'a pas changée : une
    // campagne locale se juge d'abord boutique par boutique.
    patch({
      tracking_action_id: Number(value),
      tracking_scope: draft.tracking_action_id === null ? (draft.scope === 'LOCALE' ? 'SHOP' : 'NETWORK') : draft.tracking_scope,
    })
  }

  return (
    <>
      <h2>Suivi</h2>
      <p className="muted">
        Ce que la campagne doit faire bouger, et comment on le juge : boutique par boutique, ou
        sur le total du réseau. Facultatif — une campagne sans suivi reste une campagne.
      </p>

      <div className="filters__row">
        <label className="field">
          <span>Action suivie</span>
          <select value={draft.tracking_action_id ?? ''} onChange={(event) => choisir(event.target.value)}>
            <option value="">— Pas de suivi —</option>
            {actions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        {action !== null ? (
          // Un groupe de boutons, pas une étiquette : un <label> autour d'eux
          // ferait basculer le premier à chaque clic sur son texte.
          <div className="field" role="group" aria-label="Mesurée">
            <span>Mesurée</span>
            <span className="filters__row">
              {(
                [
                  ['NETWORK', 'Pour le réseau'],
                  ['SHOP', 'Par boutique'],
                ] as Array<[TrackingScope, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`filter${draft.tracking_scope === value ? ' is-on' : ''}`}
                  onClick={() => patch({ tracking_scope: value })}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>

      {type?.default_kpi_label ? (
        <p className="muted">
          Indicateur proposé par le type « {type.label} » : {type.default_kpi_label}.
        </p>
      ) : null}

      {action !== null ? (
        <>
          <div className="filters__row">
            <label className="field">
              <span>
                Cible {draft.tracking_scope === 'SHOP' ? 'par boutique' : 'du réseau'} ({action.unit_label})
              </span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={draft.tracking_target}
                placeholder="à fixer"
                onChange={(event) => patch({ tracking_target: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Comparée à</span>
              <select
                value={draft.tracking_baseline}
                onChange={(event) => patch({ tracking_baseline: event.target.value as TrackingBaseline })}
              >
                <option value="N1">Mêmes dates l'an dernier</option>
                <option value="AVANT">Même durée juste avant le lancement</option>
              </select>
            </label>
          </div>
          <p className="muted">Se lit : {action.source_label}.</p>
          {action.cockpit_measure !== null ? (
            <TrackingReference draft={draft} action={action} shops={shops} />
          ) : (
            <p className="muted wizard__hint">
              Pas de chiffre de référence ici : {action.source_label.toLowerCase()} n'est pas encore
              relié à l'assistant. Le choix est enregistré avec la campagne et repris dans son suivi.
            </p>
          )}
        </>
      ) : null}
    </>
  )
}

/** `1 250,4` — l'écriture des nombres du reste de l'assistant. */
function nombre(value: number | null | undefined, decimales: number): string {
  if (value === null || value === undefined) return '—'

  return value.toLocaleString('fr-BE', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
}

/**
 * La référence lue en caisse : le réseau, et chaque boutique quand le suivi se
 * juge boutique par boutique. Mêmes dates l'an dernier (décalage de 364 jours),
 * par la route du cockpit qui sert aussi le KPI du levier.
 */
function TrackingReference({
  draft,
  action,
  shops,
}: {
  draft: Draft
  action: TrackingAction
  shops: Array<{ id: number; code: string; name: string }>
}) {
  // Les identifiants du module ne sont pas ceux de la caisse : la boutique porte
  // le code `erp-4`, c'est ce 4 que le cockpit connaît.
  const erpIds =
    draft.scope === 'LOCALE'
      ? shops
          .filter((shop) => draft.shop_ids.includes(shop.id))
          .map((shop) => /^erp-(\d+)$/.exec(shop.code)?.[1] ?? '')
          .filter((id) => id !== '')
      : []
  const periode = draft.starts_on !== '' && draft.ends_on !== '' && draft.ends_on >= draft.starts_on

  const kpi = useAsync<KpiPeriode | null>(
    () =>
      periode
        ? api.getKpiPeriode({ from: draft.starts_on, to: draft.ends_on, metric: action.cockpit_measure, shopIds: erpIds })
        : Promise.resolve(null),
    [draft.starts_on, draft.ends_on, action.cockpit_measure ?? '', erpIds.join(',')],
  )

  if (!periode) {
    return (
      <p className="muted wizard__hint">
        La période n'est pas encore posée (étape « Type &amp; cadrage ») : la référence de l'an
        dernier s'affichera ici, aux mêmes dates.
      </p>
    )
  }
  if (kpi.loading) return <p className="muted wizard__hint">Lecture des ventes de l'an dernier…</p>
  if (kpi.error !== null) return <p className="error">Référence indisponible : {kpi.error}</p>
  if (kpi.data === null) return null

  const { kpi: definition, reseau, magasins, fenetres } = kpi.data
  const unite = definition.cle === 'trafic' ? '' : ' €'

  return (
    <>
      <div className="kpi-band">
        <div className="kpi-band__main">
          <span className="kpi-band__nom">{definition.nom}</span>
          <span className="badge badge--mesure">Mesuré</span>
          <p className="kpi-band__src">
            Référence : du {fenetres.pendantN1Du} au {fenetres.pendantN1Au} (mêmes jours, l'an dernier) ·{' '}
            {kpi.data.source}
          </p>
          {draft.tracking_baseline === 'AVANT' ? (
            <p className="kpi-band__src">
              La référence « juste avant le lancement » se lit quand cette période sera écoulée ;
              l'an dernier est affiché en attendant, et il est nommé.
            </p>
          ) : null}
        </div>
        <div className="kpi-band__val">
          <b>
            {nombre(reseau.valeurRetenue ?? reseau.valeurPendant, definition.decimales)}
            {unite}
          </b>
          <span>réseau</span>
        </div>
      </div>

      {draft.tracking_scope === 'SHOP' && magasins.length > 0 ? (
        <table className="kpi-ref">
          <thead>
            <tr>
              <th>Boutique</th>
              <th className="num">L'an dernier</th>
              <th className="num">Cible</th>
            </tr>
          </thead>
          <tbody>
            {magasins.map((ligne) => (
              <tr key={ligne.id}>
                <td>{ligne.nom}</td>
                <td className="num">
                  {nombre(ligne.valeurRetenue, definition.decimales)}
                  {ligne.valeurRetenue === null ? '' : unite}
                  {ligne.source === 'repli' ? <sup className="repli" title={ligne.repli?.libelle ?? ''}>*</sup> : null}
                </td>
                <td className="num objectif">{draft.tracking_target.trim() === '' ? '—' : `${draft.tracking_target}${unite}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
