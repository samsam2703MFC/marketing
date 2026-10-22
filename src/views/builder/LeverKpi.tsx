import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { KpiDefinition, KpiPeriode } from '../../lib/api/module'
import type { References } from '../../lib/api/module'
import type { Draft } from './CampaignBuilder'

/**
 * Le KPI du levier, sur la période choisie.
 *
 * Le type de campagne porte un levier ; le levier porte un KPI ; le KPI se lit
 * sur la caisse. Jusqu'ici l'étape ne demandait qu'un « écart au N-1 (%) » sans
 * jamais dire N-1 de quoi : on saisissait +12 % sans savoir si cela voulait
 * dire dix clients de plus par jour ou deux cents.
 *
 * La période visée est presque toujours à venir. Ce qui s'affiche n'est donc
 * pas elle, mais ce que les MÊMES DATES ont donné l'an dernier, en deux
 * fenêtres : « avant » (la longueur de la campagne, juste avant) et
 * « pendant ». L'écart entre les deux est la pente naturelle de la saison —
 * septembre fait déjà mieux qu'août sans qu'on ait rien fait — et c'est
 * au-dessus d'elle que l'objectif se pose.
 *
 * Le calcul vient du cockpit, qui tient le compte du panel : même route, même
 * décalage de 364 jours, mêmes jours ouverts que son écran « Mesure des
 * campagnes ». Deux écrans qui répondent à « combien a fait septembre l'an
 * dernier » doivent répondre la même chose.
 */

/** Un nombre dans l'unité du KPI, ou « — » : un trou n'est pas un zéro. */
function valeur(v: number | null | undefined, kpi: KpiDefinition): string {
  if (v === null || v === undefined) return '—'

  const texte = v.toLocaleString('fr-BE', {
    minimumFractionDigits: kpi.decimales,
    maximumFractionDigits: kpi.decimales,
  })

  return kpi.cle === 'trafic' ? texte : `${texte} €`
}

/** `+1,8 %` / `−8,3 %`. */
function ecart(pct: number | null): { texte: string; ton: 'up' | 'down' | 'flat' } {
  if (pct === null) return { texte: '—', ton: 'flat' }

  const arrondi = Math.round(pct * 10) / 10

  return {
    texte: `${arrondi > 0 ? '+' : arrondi < 0 ? '−' : ''}${Math.abs(arrondi)
      .toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`,
    ton: arrondi > 0 ? 'up' : arrondi < 0 ? 'down' : 'flat',
  }
}

/** `03/08`, pour un en-tête : l'année est dite une fois, au-dessus du tableau. */
function jourCourt(iso: string): string {
  const [, m, j] = iso.split('-')

  return m === undefined || j === undefined ? iso : `${j}/${m}`
}

/** `01/09/2025`, l'ordre français — celui du reste de l'assistant. */
function jour(iso: string): string {
  const [a, m, j] = iso.split('-')

  return a === undefined || m === undefined || j === undefined ? iso : `${j}/${m}/${a}`
}

/** L'objectif dans l'unité du KPI : `+6 %` ne se lit pas en clients par jour. */
function cible(base: number | null, pct: string): number | null {
  if (base === null) return null

  const coef = Number(pct)

  return pct.trim() === '' || Number.isNaN(coef) ? base : base * (1 + coef / 100)
}

export default function LeverKpi({
  draft,
  refs,
  shops,
}: {
  draft: Draft
  refs: References
  shops: Array<{ id: number; code: string; name: string }>
}) {
  /** Vide : on suit le levier. Rempli : la bascule de l'écran a tranché. */
  const [metric, setMetric] = useState<string | null>(null)

  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id) ?? null
  const lever = refs.levers.find((entry) => entry.id === type?.lever_id) ?? null

  // Périmètre : les identifiants du module ne sont pas ceux de la caisse. La
  // boutique porte le code `erp-4` ; c'est ce 4 que le cockpit connaît.
  const erpIds = draft.scope === 'LOCALE'
    ? shops
        .filter((shop) => draft.shop_ids.includes(shop.id))
        .map((shop) => /^erp-(\d+)$/.exec(shop.code)?.[1] ?? '')
        .filter((id) => id !== '')
    : []

  const periode = draft.starts_on !== '' && draft.ends_on !== '' && draft.ends_on >= draft.starts_on

  const kpi = useAsync<KpiPeriode | null>(
    () =>
      periode
        ? api.getKpiPeriode({
            from: draft.starts_on,
            to: draft.ends_on,
            lever: lever?.code ?? null,
            metric,
            shopIds: erpIds,
          })
        : Promise.resolve(null),
    [draft.starts_on, draft.ends_on, lever?.code ?? '', metric ?? '', erpIds.join(',')],
  )

  return (
    <>
      <h3 className="section-label">Le KPI du levier</h3>

      {type === null ? (
        <p className="muted">
          Aucun type choisi : le levier suivi vient du type, et son KPI avec lui.
        </p>
      ) : (
        <p className="muted kpi__intro">
          Le type « {type.label} » porte le levier{' '}
          <strong>{lever?.label ?? type.lever_label ?? 'non renseigné'}</strong> : son KPI est
          repris ici, avec sa référence lue sur la caisse.
        </p>
      )}

      {!periode ? (
        <p className="muted wizard__hint">
          La période n'est pas encore posée. Renseignez-la à l'étape « Type &amp; cadrage » : la
          référence de l'an dernier s'affichera ici, aux mêmes dates.
        </p>
      ) : kpi.loading ? (
        <p className="muted wizard__hint">Lecture des ventes de l'an dernier…</p>
      ) : kpi.error !== null ? (
        <p className="error">{kpi.error}</p>
      ) : kpi.data === null ? null : (
        <Reference donnees={kpi.data} pct={draft.objective_coef_pct} choisir={setMetric} />
      )}
    </>
  )
}

function Reference({
  donnees,
  pct,
  choisir,
}: {
  donnees: KpiPeriode
  pct: string
  choisir: (metric: string) => void
}) {
  const { kpi, fenetres, reseau } = donnees
  const mesurables = donnees.leviers.filter((lever) => lever.mesure !== null)
  // L'objectif du réseau se pose sur le total AFFICHÉ — celui qui égale la
  // somme des lignes. Le poser sur le seul cumul N-1 donnait une cible plus
  // petite que la somme des cibles du tableau.
  const objectif = cible(reseau.valeurRetenue ?? reseau.valeurPendant, pct)
  const pente = ecart(reseau.variation)

  return (
    <>
      {/* La bascule ne propose que ce qui se mesure : offrir « taux d'invendus »
          pour répondre « — » à chaque ligne serait une promesse non tenue. */}
      <div className="filters__row kpi__bascule">
        {Object.values(donnees.catalogue).map((entry) => (
          <button
            key={entry.cle}
            type="button"
            className={`filter${entry.cle === donnees.mesure ? ' is-on' : ''}`}
            onClick={() => choisir(entry.cle)}
            title={entry.calcul}
          >
            {entry.nom}
          </button>
        ))}
      </div>

      <div className="kpi-band">
        <div className="kpi-band__main">
          <span className="kpi-band__nom">{kpi.nom}</span>
          <span className="badge badge--mesure">Mesuré</span>
          <p className="kpi-band__src">
            {kpi.calcul} · {donnees.source}
          </p>
          {donnees.levierMesurable === false ? (
            <p className="kpi-band__src">
              Le levier de ce type n'a pas de KPI en caisse —{' '}
              {donnees.leviers.find((lever) => lever.code === donnees.levierDemande)?.raison ??
                'il se relève au bilan'}
              . Le trafic est affiché à sa place, et il est nommé.
            </p>
          ) : null}
        </div>
        <div className="kpi-band__val">
          <b>{valeur(reseau.valeurRetenue ?? reseau.valeurPendant, kpi)}</b>
          <span>
            {reseau.source === 'n1'
              ? 'réseau, N-1 pendant'
              : `réseau — dont ${reseau.nRepli} sur moyenne 3 mois`}
          </span>
        </div>
        <div className="kpi-band__val">
          <b>{valeur(objectif, kpi)}</b>
          <span>{pct.trim() === '' ? 'sans écart visé' : `objectif à ${Number(pct) < 0 ? '−' : '+'}${Math.abs(Number(pct))} %`}</span>
        </div>
      </div>

      {/* Les dates vivent dans les en-têtes ; il ne reste ici que ce qu'une date
          ne dit pas : de quelle année il s'agit, et pourquoi 364 et non 365. */}
      <p className="muted kpi__fenetres">
        Deux fenêtres de {fenetres.jours} jours en {jour(fenetres.pendantN1Au).slice(-4)}, à 364
        jours en arrière — 52 semaines exactes, pour que les mêmes jours de semaine tombent en
        face. « Pendant » est la fenêtre de la campagne ; « avant » est celle qui la précède.
      </p>

      <div className="table-scroll">
        <table className="kpi-ref">
          <thead>
            <tr>
              <th>Magasin</th>
              <th className="num">
                Avant<small>{jourCourt(fenetres.avantN1Du)} → {jourCourt(fenetres.avantN1Au)}</small>
              </th>
              <th className="num">
                Pendant<small>{jourCourt(fenetres.pendantN1Du)} → {jourCourt(fenetres.pendantN1Au)}</small>
              </th>
              <th className="num">Variation naturelle</th>
              <th className="num">Objectif</th>
            </tr>
          </thead>
          <tbody>
            {donnees.magasins.map((ligne) => {
              const variation = ecart(ligne.variation)

              return (
                <tr key={ligne.id}>
                  <td>{ligne.nom}</td>
                  {ligne.sansN1 && ligne.repli === null ? (
                    <>
                      <td className="num nil" colSpan={3}>
                        Aucun relevé sur ces dates l'an dernier
                      </td>
                      <td className="num nil">à poser à la main</td>
                    </>
                  ) : ligne.sansN1 && ligne.repli !== null ? (
                    <>
                      {/* Pas de N-1, mais une activité récente : on la montre,
                          marquée — la comparaison saisonnière, elle, n'existe
                          pas, et la colonne « variation » reste vide. */}
                      <td className="num nil">—</td>
                      <td className="num">
                        {valeur(ligne.repli.valeur, kpi)}
                        <sup className="repli" title={`Pas de relevé l'an dernier : moyenne du ${jour(ligne.repli.du)} au ${jour(ligne.repli.au)}`}>
                          (i)
                        </sup>
                      </td>
                      <td className="num nil">—</td>
                      <td className="num objectif">{valeur(cible(ligne.repli.valeur, pct), kpi)}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{valeur(ligne.valeurAvant, kpi)}</td>
                      <td className="num">{valeur(ligne.valeurPendant, kpi)}</td>
                      <td className={`num ${variation.ton}`}>{variation.texte}</td>
                      <td className="num objectif">{valeur(cible(ligne.valeurPendant, pct), kpi)}</td>
                    </>
                  )}
                </tr>
              )
            })}
            <tr className="total">
              <td>Réseau</td>
              {reseau.valeurRetenue === null && reseau.sansN1 ? (
                <td className="num nil" colSpan={4}>
                  Aucun relevé sur ces dates l'an dernier
                </td>
              ) : (
                <>
                  <td className="num">{valeur(reseau.valeurAvant, kpi)}</td>
                  <td className="num">
                    {valeur(reseau.valeurRetenue ?? reseau.valeurPendant, kpi)}
                    {reseau.source === 'n1' ? null : (
                      <sup className="repli" title={`Dont ${reseau.nRepli} magasin(s) sur la moyenne des 3 derniers mois`}>
                        (i)
                      </sup>
                    )}
                  </td>
                  {/* La variation ne porte que sur les magasins qui ont un N-1 :
                      comparer une moyenne de trois mois à l'été dernier ne veut
                      rien dire, et la mêler au réseau fausserait la pente. */}
                  <td className={`num ${pente.ton}`} title={reseau.source === 'n1' ? undefined : `Calculée sur les ${reseau.nN1} magasins qui ont un N-1`}>
                    {pente.texte}
                  </td>
                  <td className="num objectif">{valeur(objectif, kpi)}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted wizard__hint">
        {kpi.nom} — la variation naturelle est ce que la période a fait de plus que la précédente{' '}
        <em>sans campagne</em> : l'objectif se pose au-dessus d'elle, pas au-dessus de zéro.
      </p>

      {donnees.magasins.some((ligne) => ligne.source === 'repli') ? (
        <p className="muted wizard__hint">
          <sup className="repli">(i)</sup> Pas de relevé l'an dernier — magasin ouvert depuis. La
          référence est la <strong>moyenne des 3 derniers mois</strong> ({jour(fenetres.repliDu)} →{' '}
          {jour(fenetres.repliAu)}) : un point de départ, pas une comparaison saisonnière. Le total
          du réseau les additionne ; sa variation, elle, ne porte que sur les {reseau.nN1} magasins
          qui ont un N-1.
        </p>
      ) : null}

      {donnees.motifs.map((motif) => (
        <p key={motif} className="muted wizard__hint">
          {motif}.
        </p>
      ))}

      <h3 className="section-label">Le KPI de chaque levier</h3>
      <p className="muted">
        Le tableau des montants visés, plus bas, dit combien on met sur chaque levier ; celui-ci
        dit ce qu'on ira relire. Les leviers que la caisse ne connaît pas le disent : ils se
        relèvent à la main au moment du bilan.
      </p>
      <div className="kpi-leviers">
        {donnees.leviers.map((lever) => (
          <div
            key={lever.id}
            className={`kpi-levier${lever.mesure === donnees.mesure && mesurables.length > 0 ? ' is-on' : ''}`}
          >
            <div className="kpi-levier__t">
              <span className="dot" style={{ background: lever.couleur }} />
              {lever.nom}
            </div>
            <div className="kpi-levier__k">{lever.kpi?.nom ?? '—'}</div>
            <div className="kpi-levier__s">{lever.kpi?.calcul ?? lever.raison}</div>
          </div>
        ))}
      </div>
    </>
  )
}
