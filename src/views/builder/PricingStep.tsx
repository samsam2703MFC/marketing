import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { SalesQuantities } from '../../lib/api/module'
import { Fragment } from 'react'
import type { Draft, MechanicCode } from './CampaignBuilder'
import AnalysisPeriod from './AnalysisPeriod'

/**
 * Étape « Prix » : la promotion produit par produit, et ce qu'elle coûte.
 *
 * Une promotion réduit la marge unitaire ; retrouver la marge d'avant demande
 * de vendre plus. Combien exactement se calcule : Q1 = Q0 × M0 / M1. C'est la
 * seule question que cet écran pose, et il la pose deux fois — par produit dans
 * le tableau, puis pour le réseau entier dans le bilan.
 *
 * Le coût matière n'existe pas encore côté ERP (voir docs/FOOD-COST-A-CONSTRUIRE.md).
 * On part donc d'un **taux de marge** dont le coût se déduit : C = P × (1 − m).
 * Le jour où le food cost arrive, ce taux devient calculé au lieu d'être saisi
 * et pas une ligne de ce fichier ne change.
 */

/** TVA alimentaire. Les marges se calculent en HT, l'écran affiche en TTC. */
const TVA_PCT = 6

const MECANIQUES: Array<{ code: MechanicCode; label: string; unite: string }> = [
  { code: 'PERCENT',       label: 'Pourcentage',      unite: '%' },
  { code: 'CROSSED_PRICE', label: 'Prix barré',       unite: '€ TTC' },
  { code: 'BUY_X_GET_Y',   label: 'Offre liée',       unite: '' },
  { code: 'BUNDLE_FIXED',  label: 'Prix de formule',  unite: '€ TTC' },
  { code: 'FREE_DELIVERY', label: 'Livraison offerte', unite: '' },
]

const ht = (ttc: number): number => ttc / (1 + TVA_PCT / 100)

const eur = (value: number): string =>
  `${value.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const fr = (value: number): string => Math.round(value).toLocaleString('fr-BE')

const dec = (value: number, digits = 2): string =>
  value.toLocaleString('fr-BE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Nombre saisi, ou `null` : une saisie en cours ne doit rien fausser. */
function read(value: string): number | null {
  const cleaned = value.trim().replace(',', '.')

  return cleaned !== '' && /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null
}

interface Simulation {
  /** Prix HT avant et après, marge unitaire avant et après. */
  p0: number
  p1: number
  cout: number
  m0: number
  m1: number
  ttc0: number
  ttc1: number
  /** Multiplicateur de volume, ou `null` quand la marge après est négative. */
  k: number | null
  /** Vrai tant que la promotion laisse une marge à compenser. */
  viable: boolean
  /** Vrai quand rien n'est saisi : le produit est dans l'offre, pas en promo. */
  neutre: boolean
}

/**
 * Ce que la promotion fait à une unité vendue.
 *
 * Une marge après promotion nulle ou négative ne rend pas un très grand
 * multiplicateur : elle n'en rend aucun. C'est le seul résultat que l'écran
 * doit refuser d'arrondir, parce qu'un grand nombre se lit comme une réponse
 * alors que la réponse est « aucun volume ne compense ».
 */
function simuler(
  mecanique: MechanicCode | '',
  valeur: { remise: number | null; prix: number | null; achete: number | null; offert: number | null },
  ttc0: number,
  margePct: number,
): Simulation {
  const p0 = ht(ttc0)
  const cout = p0 * (1 - margePct / 100)
  const m0 = p0 - cout

  let p1 = p0
  let ttc1 = ttc0
  let neutre = false

  if (mecanique === 'PERCENT' && valeur.remise !== null) {
    p1 = p0 * (1 - valeur.remise / 100)
    ttc1 = ttc0 * (1 - valeur.remise / 100)
  } else if ((mecanique === 'CROSSED_PRICE' || mecanique === 'BUNDLE_FIXED') && valeur.prix !== null) {
    ttc1 = valeur.prix
    p1 = ht(valeur.prix)
  } else if (mecanique === 'BUY_X_GET_Y' && valeur.achete !== null && valeur.offert !== null
             && valeur.achete > 0 && valeur.offert > 0) {
    // Le lot se vend au prix de `achete` mais coûte `achete + offert` : la
    // recette moyenne par pièce baisse alors que le coût par pièce ne bouge pas.
    const pieces = valeur.achete + valeur.offert
    p1 = (valeur.achete * p0) / pieces
    ttc1 = (valeur.achete * ttc0) / pieces
  } else {
    // `FREE_DELIVERY` ne touche pas le prix du produit, et une mécanique dont
    // la valeur n'est pas encore saisie non plus : dans les deux cas la marge
    // est inchangée, et l'écran doit le dire plutôt que d'afficher « ×1 ».
    neutre = true
  }

  const m1 = p1 - cout
  const viable = m1 > 0

  return {
    p0, p1, cout, m0, m1, ttc0, ttc1,
    k: neutre ? 1 : viable ? m0 / m1 : null,
    viable,
    neutre,
  }
}

export default function PricingStep({
  draft,
  patch,
}: {
  draft: Draft
  patch: (change: Partial<Draft>) => void
}) {
  /**
   * Seuls les produits ont un prix.
   *
   * Une gamme saisonnière entre dans l'offre au même titre qu'un produit —
   * « Gamme Épiphanie » — mais elle ne se vend pas à l'unité : lui demander une
   * marge et un volume à compenser n'a pas de sens, et la ligne restait vide en
   * salissant le tableau. La famille vient du catalogue, jamais du libellé.
   */
  const produits = draft.offer_items
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.category === 'produit')

  const itemIds = produits
    .map(({ element }) => element.offer_item_id)
    .filter((id): id is number => id !== null)

  // Volumes de référence : ceux de la période d'analyse de l'étape Objectifs.
  // Sans eux, la compensation n'a pas de base de départ — et la réponse serait
  // un multiplicateur abstrait plutôt qu'un nombre de pièces.
  const sales = useAsync<SalesQuantities | null>(
    () =>
      itemIds.length === 0
        ? Promise.resolve(null)
        : api.getSalesQuantities({
            itemIds,
            from: draft.analysis_from,
            to: draft.analysis_to,
            compare: false,
          }),
    [draft.analysis_from, draft.analysis_to, itemIds.join(',')],
  )

  const margeReseau = read(draft.margin_pct_default) ?? 0

  const patchItem = (index: number, change: Partial<Draft['offer_items'][number]>) => {
    patch({
      offer_items: draft.offer_items.map((element, position) =>
        position === index ? { ...element, ...change } : element,
      ),
    })
  }

  /**
   * Changer de mécanique efface la valeur de la précédente. Garder « −20 % »
   * en passant au prix barré laisserait deux promotions sur la même ligne, et
   * le calcul en choisirait une sans le dire.
   */
  const setMecanique = (index: number, code: MechanicCode | '') => {
    patchItem(index, {
      mechanic_type: code,
      discount_pct: '',
      fixed_price: '',
      buy_qty: code === 'BUY_X_GET_Y' ? '2' : '',
      get_qty: code === 'BUY_X_GET_Y' ? '1' : '',
    })
  }

  const volumeOf = (itemId: number | null): number => {
    if (itemId === null || sales.data === null) return 0

    return sales.data.network.by_product[itemId] ?? 0
  }

  // Une ligne par produit de l'offre, avec sa simulation.
  const lignes = produits.map(({ element, index }) => {
    const prix = read(element.baseline_price)
      ?? (sales.data?.products.find((p) => p.item_id === element.offer_item_id) ? null : null)
    const ttc0 = prix ?? 0
    const marge = read(element.margin_pct) ?? margeReseau
    const q0 = volumeOf(element.offer_item_id)

    const sim = simuler(
      element.mechanic_type,
      {
        remise: read(element.discount_pct),
        prix: read(element.fixed_price),
        achete: read(element.buy_qty),
        offert: read(element.get_qty),
      },
      ttc0,
      marge,
    )

    const q1 = sim.k === null ? null : Math.ceil(q0 * sim.k)

    return { element, index, ttc0, marge, q0, sim, q1, prixManquant: prix === null }
  })

  /**
   * Lignes rangées par famille de catalogue, dans l'ordre où l'API rend les
   * produits — elle trie déjà par famille puis par nom, il suffit de découper.
   */
  const familleDe = (ligne: (typeof lignes)[number]): string =>
    sales.data?.products.find((p) => p.item_id === ligne.element.offer_item_id)?.family ?? 'Autres'

  // Les lignes suivent l'ordre de l'offre, qui est celui où l'on a coché les
  // produits — deux cougnous séparés par une galette y sont possibles, et le
  // découpage en aurait fait deux catégories « Cougnou ». On regroupe donc
  // avant de découper, en gardant l'ordre des produits dans chaque famille.
  const familles = [...lignes]
    .sort((gauche, droite) => familleDe(gauche).localeCompare(familleDe(droite), 'fr'))
    .reduce<Array<{
    nom: string
    lignes: typeof lignes
    q0: number
    q1: number
  }>>((groupes, ligne) => {
    const nom = familleDe(ligne)
    const dernier = groupes[groupes.length - 1]
    const q1 = ligne.q1 ?? ligne.q0

    if (dernier !== undefined && dernier.nom === nom) {
      dernier.lignes.push(ligne)
      dernier.q0 += ligne.q0
      dernier.q1 += q1
    } else {
      groupes.push({ nom, lignes: [ligne], q0: ligne.q0, q1 })
    }

    return groupes
  }, [])

  /** Écrit le même changement sur plusieurs lignes d'un coup. */
  const patchMany = (indexes: number[], change: Partial<Draft['offer_items'][number]>) => {
    patch({
      offer_items: draft.offer_items.map((element, position) =>
        indexes.includes(position) ? { ...element, ...change } : element,
      ),
    })
  }

  /**
   * Valeur commune à toute une famille, ou chaîne vide si ses produits ne
   * s'accordent pas. Afficher la valeur du premier laisserait croire que la
   * famille entière est réglée dessus alors qu'un seul l'est.
   */
  const commun = (
    famille: { lignes: typeof lignes },
    champ: 'mechanic_type' | 'discount_pct' | 'fixed_price' | 'margin_pct',
  ): string => {
    const valeurs = new Set(famille.lignes.map((ligne) => ligne.element[champ]))

    return valeurs.size === 1 ? [...valeurs][0] : ''
  }

  /** La mécanique de la famille s'impose à tous ses produits. */
  const setFamilyMecanique = (famille: { lignes: typeof lignes }, code: MechanicCode | '') => {
    patchMany(famille.lignes.map((ligne) => ligne.index), {
      mechanic_type: code,
      discount_pct: '',
      fixed_price: '',
      buy_qty: code === 'BUY_X_GET_Y' ? '2' : '',
      get_qty: code === 'BUY_X_GET_Y' ? '1' : '',
    })
  }

  const enPromo = lignes.filter(
    (l) => l.element.mechanic_type !== '' && !l.sim.neutre && !l.prixManquant,
  )
  const cassees = lignes.filter(
    (l) => l.element.mechanic_type !== '' && !l.sim.neutre && !l.prixManquant && !l.sim.viable,
  )
  const sansPrix = lignes.filter((l) => l.prixManquant && l.element.mechanic_type !== '')

  const q0Total = lignes.reduce((sum, l) => sum + l.q0, 0)
  // Un produit dont la promotion détruit la marge ne contribue pas à la
  // compensation : on garde son volume actuel plutôt que d'inventer un chiffre.
  const q1Total = lignes.reduce((sum, l) => sum + (l.prixManquant ? l.q0 : (l.q1 ?? l.q0)), 0)
  const supplement = q1Total - q0Total

  const objectif = Object.values(draft.shop_objectives).reduce(
    (sum, value) => (/^\d+$/.test(value) ? sum + Number(value) : sum),
    0,
  )
  const gain = objectif - q1Total

  const parts = [q0Total, supplement, Math.max(0, gain)]
  const echelle = Math.max(objectif, q1Total, 1)

  if (produits.length === 0) {
    return (
      <>
        <h2>Prix</h2>
        <p className="muted">
          {draft.offer_items.length === 0
            ? 'Aucun produit dans l’offre : retournez à l’étape « Offre » pour en sélectionner — les promotions et leurs marges portent sur eux.'
            : 'L’offre ne contient que des gammes. Choisissez des produits à l’étape « Offre » : une promotion se pose sur ce qui se vend à l’unité.'}
        </p>
      </>
    )
  }

  return (
    <>
      <h2>Prix</h2>
      <p className="muted">
        Choisissez la mécanique de promotion produit par produit. La colonne « à vendre » dit ce
        qu’il faudra écouler pour retrouver la marge d’avant — à confronter à l’objectif posé à
        l’étape précédente.
      </p>

      {/* Les volumes de référence viennent d'une période d'analyse — la même
          qu'à l'étape « Objectifs de vente », où elle est réglée en premier.
          Elle reste modifiable ici, et l'autre écran la retrouve telle quelle :
          une seule période vaut pour toute la campagne. */}
      <AnalysisPeriod
        from={draft.analysis_from}
        to={draft.analysis_to}
        tickets={sales.data?.network.tickets ?? null}
        onChange={(range) => patch({ analysis_from: range.from, analysis_to: range.to })}
      />

      {/* Taux de marge : la seule donnée que l'écran ne sait pas encore lire
          ailleurs. Le bandeau le dit plutôt que de la faire passer pour un
          chiffre venu du système. */}
      <div className="margin-bar">
        <span className="margin-bar__label">Taux de marge réseau</span>
        <span className="objectives__pct">
          <input
            value={draft.margin_pct_default}
            inputMode="numeric"
            aria-label="Taux de marge réseau en pourcentage"
            onChange={(e) => patch({ margin_pct_default: e.target.value })}
          />
          %
        </span>
        <span className="margin-bar__hint">appliqué à tout produit qui n’a pas le sien</span>
        <span className="margin-bar__spacer" />
        <span className="tag-warn">Saisi — le food cost de l’ERP le remplacera</span>
      </div>

      {sales.error !== null ? (
        <p className="error">Volumes indisponibles : {sales.error}</p>
      ) : null}

      <h3 className="section-label">
        Promotions
        <span className="section-label__aside">
          Prix TTC · marges et compensation calculées en HT
        </span>
      </h3>

      <div className="table-card">
        <div className="table-scroll">
          <table className="pricing">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="num">Prix actuel</th>
                <th className="num">Taux de marge</th>
                <th className="pricing__sep">Mécanique</th>
                <th className="num">Prix après</th>
                <th className="num">Marge après</th>
                <th className="num pricing__sep">À vendre</th>
                <th className="num">Écart</th>
              </tr>
            </thead>
            <tbody>
              {familles.map((famille) => (
              <Fragment key={famille.nom}>
              {/* Ligne de catégorie : elle règle la mécanique de tous ses
                  produits d'un coup. Les lignes en dessous corrigent ce qui
                  doit l'être — un parfum moins remisé que les autres. */}
              <tr className="pricing__family">
                <td>
                  {famille.nom}
                  <span className="sub">
                    {famille.lignes.length} produit{famille.lignes.length > 1 ? 's' : ''} ·{' '}
                    {fr(famille.q0)} pièces sur la période
                  </span>
                </td>
                <td className="num"><span className="muted">—</span></td>
                <td className="num">
                  <span className="objectives__pct">
                    <input
                      value={commun(famille, 'margin_pct')}
                      placeholder={draft.margin_pct_default}
                      inputMode="numeric"
                      aria-label={`Taux de marge pour la catégorie ${famille.nom}`}
                      title="S’applique à tous les produits de la catégorie"
                      onChange={(e) =>
                        patchMany(famille.lignes.map((l) => l.index), { margin_pct: e.target.value })
                      }
                    />
                    %
                  </span>
                </td>
                <td className="pricing__sep">
                  <div className="pricing__mecanique">
                    <select
                      value={commun(famille, 'mechanic_type')}
                      aria-label={`Mécanique pour la catégorie ${famille.nom}`}
                      onChange={(e) =>
                        setFamilyMecanique(famille, e.target.value as MechanicCode | '')
                      }
                    >
                      <option value="">Aucune promotion</option>
                      {MECANIQUES.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.label}
                        </option>
                      ))}
                    </select>

                    {commun(famille, 'mechanic_type') === 'PERCENT' ? (
                      <span className="objectives__pct">
                        <input
                          value={commun(famille, 'discount_pct')}
                          inputMode="numeric"
                          aria-label={`Remise pour la catégorie ${famille.nom}`}
                          onChange={(e) =>
                            patchMany(famille.lignes.map((l) => l.index), {
                              discount_pct: e.target.value,
                            })
                          }
                        />
                        %
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="num"><span className="muted">—</span></td>
                <td className="num"><span className="muted">—</span></td>
                <td className="num pricing__sep">
                  <strong>{fr(famille.q1)}</strong>
                </td>
                <td className="num">
                  {famille.q1 > famille.q0 ? `+${fr(famille.q1 - famille.q0)}` : '—'}
                </td>
              </tr>

              {famille.lignes.map((ligne) => {
                const { element, index, sim } = ligne
                const mecanique = MECANIQUES.find((m) => m.code === element.mechanic_type)
                const inactive = element.mechanic_type === ''

                return (
                  <tr
                    key={index}
                    className={
                      inactive || ligne.prixManquant || ligne.sim.viable ? undefined : 'is-stop'
                    }
                  >
                    <td className="objectives__child">
                      {element.label}
                      <span className="sub">
                        {ligne.q0 === 0
                          ? 'aucune vente sur la période analysée'
                          : `${fr(ligne.q0)} pièces sur la période`}
                      </span>
                    </td>

                    <td className="num">
                      <span className="objectives__pct">
                        <input
                          value={element.baseline_price}
                          placeholder="0,00"
                          inputMode="decimal"
                          aria-label={`Prix de ${element.label}`}
                          onChange={(e) => patchItem(index, { baseline_price: e.target.value })}
                        />
                        €
                      </span>
                      <span className="sub">
                        {ligne.prixManquant ? 'à renseigner' : `${eur(sim.p0)} HT`}
                      </span>
                    </td>

                    <td className="num">
                      <span className="objectives__pct">
                        <input
                          value={element.margin_pct}
                          placeholder={draft.margin_pct_default}
                          inputMode="numeric"
                          title="Vide : suit le taux réseau"
                          aria-label={`Taux de marge de ${element.label}`}
                          onChange={(e) => patchItem(index, { margin_pct: e.target.value })}
                        />
                        %
                      </span>
                      <span className="sub">{eur(sim.m0)} de marge</span>
                    </td>

                    <td className="pricing__sep">
                      <div className="pricing__mecanique">
                        <select
                          value={element.mechanic_type}
                          aria-label={`Mécanique pour ${element.label}`}
                          onChange={(e) => setMecanique(index, e.target.value as MechanicCode | '')}
                        >
                          <option value="">Aucune promotion</option>
                          {MECANIQUES.map((m) => (
                            <option key={m.code} value={m.code}>
                              {m.label}
                            </option>
                          ))}
                        </select>

                        {element.mechanic_type === 'PERCENT' ? (
                          <span className="objectives__pct">
                            <input
                              value={element.discount_pct}
                              inputMode="numeric"
                              aria-label={`Remise sur ${element.label}`}
                              onChange={(e) => patchItem(index, { discount_pct: e.target.value })}
                            />
                            %
                          </span>
                        ) : null}

                        {element.mechanic_type === 'CROSSED_PRICE'
                          || element.mechanic_type === 'BUNDLE_FIXED' ? (
                          <span className="objectives__pct">
                            <input
                              value={element.fixed_price}
                              inputMode="decimal"
                              aria-label={`Prix imposé pour ${element.label}`}
                              onChange={(e) => patchItem(index, { fixed_price: e.target.value })}
                            />
                            {mecanique?.unite}
                          </span>
                        ) : null}

                        {element.mechanic_type === 'BUY_X_GET_Y' ? (
                          <span className="objectives__pct">
                            <input
                              value={element.buy_qty}
                              inputMode="numeric"
                              aria-label={`Quantité achetée pour ${element.label}`}
                              onChange={(e) => patchItem(index, { buy_qty: e.target.value })}
                            />
                            achetés,
                            <input
                              value={element.get_qty}
                              inputMode="numeric"
                              aria-label={`Quantité offerte pour ${element.label}`}
                              onChange={(e) => patchItem(index, { get_qty: e.target.value })}
                            />
                            offert
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="num">
                      {ligne.prixManquant || inactive || sim.neutre ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {eur(sim.ttc1)}
                          <span className="sub">{eur(sim.p1)} HT</span>
                        </>
                      )}
                    </td>

                    <td className="num">
                      {ligne.prixManquant && !inactive ? (
                        <span className="tag-warn">prix manquant</span>
                      ) : ligne.prixManquant || inactive || sim.neutre ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <span className={sim.viable ? undefined : 'pricing__stop'}>
                            {eur(sim.m1)}
                          </span>
                          <span className="sub">
                            {sim.viable
                              ? `${Math.round((sim.m1 / sim.p1) * 100)} % de marge`
                              : 'marge détruite'}
                          </span>
                        </>
                      )}
                    </td>

                    <td className="num pricing__sep">
                      {ligne.prixManquant || inactive || sim.neutre ? (
                        <span className="muted">{fr(ligne.q0)}</span>
                      ) : sim.viable && ligne.q1 !== null ? (
                        <>
                          <strong>{fr(ligne.q1)}</strong>
                          <span className="sub">×{dec(sim.k ?? 1)}</span>
                        </>
                      ) : (
                        <span className="tag-stop">impossible</span>
                      )}
                    </td>

                    <td className="num">
                      {ligne.prixManquant || inactive || sim.neutre ? (
                        <span className="muted">—</span>
                      ) : ligne.q1 === null ? (
                        <span className="pricing__stop">aucun volume ne compense</span>
                      ) : (
                        <>
                          +{fr(ligne.q1 - ligne.q0)}
                          <span className="sub">pièces</span>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total offre</td>
                <td /><td /><td className="pricing__sep" /><td /><td />
                <td className="num pricing__sep">
                  <strong>{fr(q1Total)}</strong>
                  <span className="sub">contre {fr(q0Total)} aujourd’hui</span>
                </td>
                <td className="num">
                  +{fr(supplement)}
                  <span className="sub">pièces</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {sansPrix.length > 0 ? (
        <p className="pricing__flag pricing__flag--warn">
          {sansPrix.length === 1 ? 'Un produit est en promotion' : `${sansPrix.length} produits sont en promotion`}{' '}
          sans prix de référence : {sansPrix.map((l) => l.element.label).join(', ')}. Leur marge ne
          se calcule pas, et le total ci-dessous les compte à leur volume actuel — renseignez leur
          prix pour qu’ils entrent dans la compensation.
        </p>
      ) : null}

      {cassees.map((ligne) => (
        <p key={ligne.index} className="pricing__flag pricing__flag--stop">
          <strong>{ligne.element.label}</strong> — la promotion descend la marge à{' '}
          {eur(ligne.sim.m1)}. Chaque pièce vendue coûte {eur(Math.abs(ligne.sim.m1))} au réseau :
          vendre plus creuse le trou au lieu de le combler. Restez sous {Math.round(ligne.marge)} %
          de remise, ou retirez ce produit de la promotion.
        </p>
      ))}

      {/* Conditions : elles valent pour toutes les promotions de l'offre. Les
          dates viennent de la campagne et ne se ressaisissent pas — deux dates
          qu'on saisit deux fois finissent par diverger. */}
      <h3 className="section-label">
        Conditions
        <span className="section-label__aside">Communes à toutes les promotions ci-dessus</span>
      </h3>

      <div className="card cond-card">
        <div className="cond-card__field">
          <span className="cond-card__label">Période</span>
          <span className="cond-card__value">
            {draft.starts_on === '' || draft.ends_on === ''
              ? 'À définir à l’étape « Type & cadrage »'
              : `Du ${draft.starts_on.split('-').reverse().join('/')} au ${draft.ends_on
                  .split('-')
                  .reverse()
                  .join('/')}`}
            <span className="cond-card__note">héritée de la campagne</span>
          </span>
        </div>

        <div className="cond-card__field">
          <span className="cond-card__label">Quantité maximum</span>
          <span className="objectives__pct">
            <input
              value={draft.max_qty_per_ticket}
              placeholder="—"
              inputMode="numeric"
              aria-label="Quantité maximum par ticket"
              onChange={(e) => patch({ max_qty_per_ticket: e.target.value })}
            />
            par ticket
          </span>
          <span className="cond-card__note">vide = sans limite</span>
        </div>

        <div className="cond-card__field">
          <span className="cond-card__label">Cumul</span>
          <div className="filters__row">
            <button
              type="button"
              className={`filter${draft.promo_cumulative ? '' : ' is-on'}`}
              aria-pressed={!draft.promo_cumulative}
              onClick={() => patch({ promo_cumulative: false })}
            >
              Non cumulable
            </button>
            <button
              type="button"
              className={`filter${draft.promo_cumulative ? ' is-on' : ''}`}
              aria-pressed={draft.promo_cumulative}
              onClick={() => patch({ promo_cumulative: true })}
            >
              Cumulable
            </button>
          </div>
        </div>
      </div>

      {/* ── Bilan ──────────────────────────────────────────────────────────
          La question posée à l'objectif de l'étape précédente : couvre-t-il ce
          que la promotion coûte ? La poser ici évite de découvrir à l'arrivée
          qu'une hausse de 45 % ne laissait rien une fois la remise payée. */}
      {enPromo.length > 0 ? (
        <>
          <h3 className="section-label">
            Ce que ça demande au réseau
            <span className="section-label__aside">
              Volumes de la période analysée à l’étape « Objectifs »
            </span>
          </h3>

          <div className="card kpi-row">
            <div className="kpi" style={{ borderLeftColor: 'var(--chart-real)' }}>
              <div className="kpi__value">{fr(q0Total)}</div>
              <div className="kpi__label">Volume actuel</div>
              <div className="kpi__note">sur la période analysée</div>
            </div>
            <div className="kpi" style={{ borderLeftColor: 'var(--prize)' }}>
              <div className="kpi__value">{fr(q1Total)}</div>
              <div className="kpi__label">Seuil de compensation</div>
              <div className="kpi__note">
                +{fr(supplement)} pièces
                {q0Total === 0 ? '' : `, soit +${Math.round((supplement / q0Total) * 100)} %`}
              </div>
            </div>
            <div className="kpi" style={{ borderLeftColor: 'var(--chart-goal)' }}>
              <div className="kpi__value">{fr(objectif)}</div>
              <div className="kpi__label">Objectif du réseau</div>
              <div className="kpi__note">
                {objectif === 0 ? 'pas encore posé' : 'posé à l’étape « Objectifs »'}
              </div>
            </div>
            <div className="kpi" style={{ borderLeftColor: 'var(--accent)' }}>
              <div className="kpi__value">
                {objectif === 0 ? '—' : `${gain >= 0 ? '+' : '−'}${fr(Math.abs(gain))}`}
              </div>
              <div className="kpi__label">{gain >= 0 ? 'Gain réel' : 'Manque'}</div>
              <div className="kpi__note">au-delà de la compensation</div>
            </div>
          </div>

          {objectif > 0 ? (
            <div className="card pricing__gauge">
              <div className="pricing__bar">
                {parts.map((part, rank) => (
                  <span
                    key={rank}
                    className={`pricing__part pricing__part--${rank + 1}`}
                    style={{ width: `${(part / echelle) * 100}%` }}
                  />
                ))}
              </div>
              <div className="pricing__legend">
                <span>
                  <i className="pricing__mark pricing__mark--1" />
                  {fr(q0Total)} déjà vendues
                </span>
                <span>
                  <i className="pricing__mark pricing__mark--2" />
                  +{fr(supplement)} pour compenser les promotions
                </span>
                <span>
                  <i className="pricing__mark pricing__mark--3" />
                  {gain >= 0 ? `+${fr(gain)} de gain réel` : `${fr(-gain)} manquantes`}
                </span>
              </div>
            </div>
          ) : null}

          <p
            className={`pricing__flag ${
              objectif === 0 || gain >= 0 ? 'pricing__flag--warn' : 'pricing__flag--stop'
            }`}
          >
            {objectif === 0 ? (
              <>
                Aucun objectif posé à l’étape précédente. Il en faudrait{' '}
                <strong>{fr(q1Total)} pièces</strong> rien que pour retrouver la marge
                d’aujourd’hui : revenez le poser, ou assumez la promotion sans cible.
              </>
            ) : gain >= 0 ? (
              <>
                <strong>L’objectif de {fr(objectif)} pièces couvre la promotion.</strong>{' '}
                {fr(supplement)} des {fr(objectif - q0Total)} pièces supplémentaires ne feront que
                rembourser la remise : seules {fr(gain)} sont du gain.
              </>
            ) : (
              <>
                <strong>L’objectif de {fr(objectif)} pièces ne couvre pas la promotion.</strong> Il
                en manque {fr(-gain)} pour seulement retrouver la marge d’aujourd’hui : à ce
                rythme, la campagne coûtera de la marge même si l’objectif est atteint.
              </>
            )}
          </p>
        </>
      ) : null}
    </>
  )
}
