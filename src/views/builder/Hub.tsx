import { module as api } from '../../lib/api'
import { useAsync, formatDate, formatEur, formatNumber } from '../../lib/useAsync'
import type { References, SocialAttached } from '../../lib/api/module'
import type { Draft } from './CampaignBuilder'

/**
 * L'assistant « hub » de la maquette validée : sept étapes qui suivent la vie d'une
 * campagne — on la cadre, on dit ce qu'elle vend, avec quels médias, sur quels canaux,
 * comment on la suit, ce qu'elle coûte et quand, puis ce qu'elle donne.
 *
 * Chaque étape regroupe une ou plusieurs étapes de saisie de l'assistant (leurs clés) :
 * les règles de chacune — ce qui bloque, où l'on reprend un brouillon — ne changent
 * pas, seule la présentation se range en sept. Une étape à plusieurs écrans les montre
 * en sous-étapes.
 */
export const HUBS: Array<{ label: string; keys: string[] }> = [
  { label: 'Cadrage', keys: ['framing'] },
  { label: 'Offre & promotions', keys: ['offer', 'objectives', 'pricing'] },
  { label: 'Médias', keys: ['photos', 'medias'] },
  { label: 'Canaux', keys: ['communication'] },
  { label: 'Suivi & traçabilité', keys: ['tracking'] },
  { label: 'Budget & planning', keys: ['budget', 'planning'] },
  { label: 'Récap & résultats', keys: ['review', 'leads'] },
]

export function hubIndexOf(key: string): number {
  return Math.max(0, HUBS.findIndex((hub) => hub.keys.includes(key)))
}

type StepLike = { key: string; label: string; blocking: (draft: Draft) => string | null }

/** Une étape (de saisie) est atteignable si elle est derrière, ou si tout ce qui la précède est complet. */
function atteignable(steps: StepLike[], index: number, step: number, draft: Draft): boolean {
  return index <= step || steps.slice(0, index).every((entry) => entry.blocking(draft) === null)
}

/** `lancement-webshop` : le code de suivi des liens (utm_campaign), tiré du nom de la campagne. */
export function slugOf(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'campagne'
  )
}

/** En-tête : le nom de la campagne et ce qui la situe d'un coup d'œil. */
export function HubHeader({
  draft,
  refs,
  shops,
  statut,
}: {
  draft: Draft
  refs: References
  shops: Array<{ id: number; name: string }>
  statut: string
}) {
  const status = refs.campaignStatuses.find((entry) => entry.code === statut)
  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id)
  const boutiques = draft.scope === 'RESEAU' ? shops.length : draft.shop_ids.length

  return (
    <header className="hub-head">
      <span className="hub-head__crumb">Campagnes · assistant</span>
      <h2 className="hub-head__name">{draft.name.trim() || 'Nouvelle campagne'}</h2>
      <p className="hub-head__meta">
        {status ? (
          <span className="hub-chip" style={{ color: status.text_hex, background: status.bg_rgba }}>
            {status.label}
          </span>
        ) : null}
        <span>
          {draft.starts_on ? formatDate(draft.starts_on) : 'début à fixer'} →{' '}
          {draft.ends_on ? formatDate(draft.ends_on) : 'fin à fixer'}
        </span>
        <span>·</span>
        <span>
          {draft.scope === 'RESEAU' ? 'Réseau' : 'Locale'} · {boutiques} boutique{boutiques > 1 ? 's' : ''}
        </span>
        {type ? (
          <>
            <span>·</span>
            <span>{type.label}</span>
          </>
        ) : null}
      </p>
    </header>
  )
}

/** Les sept étapes, reliées ; puis les sous-étapes de l'étape en cours quand elle en a plusieurs. */
export function HubStepper({
  steps,
  step,
  draft,
  onGo,
}: {
  steps: StepLike[]
  step: number
  draft: Draft
  onGo: (index: number) => void
}) {
  const ici = hubIndexOf(steps[step].key)
  const sous = HUBS[ici].keys

  return (
    <>
      <nav className="hub-steps" aria-label="Étapes de la campagne">
        {HUBS.map((hub, n) => {
          const premier = steps.findIndex((entry) => entry.key === hub.keys[0])
          const complet = hub.keys.every((key) => steps.find((entry) => entry.key === key)?.blocking(draft) === null)
          const ouvert = atteignable(steps, premier, step, draft)

          return (
            <div key={hub.label} className="hub-steps__item">
              {n > 0 ? <span className={`hub-steps__line${n <= ici ? ' is-done' : ''}`} aria-hidden="true" /> : null}
              <button
                type="button"
                className={`hub-step${n === ici ? ' is-cur' : ''}${n < ici && complet ? ' is-done' : ''}`}
                disabled={!ouvert}
                title={ouvert ? undefined : 'Une étape précédente est incomplète.'}
                onClick={() => onGo(premier)}
              >
                <i>{n < ici && complet ? '✓' : n + 1}</i>
                {hub.label}
              </button>
            </div>
          )
        })}
      </nav>
      {sous.length > 1 ? (
        <nav className="hub-sub" aria-label="Sous-étapes">
          {sous.map((key) => {
            const index = steps.findIndex((entry) => entry.key === key)

            return (
              <button
                key={key}
                type="button"
                className={`hub-sub__tab${index === step ? ' is-on' : ''}`}
                aria-current={index === step ? 'step' : undefined}
                disabled={!atteignable(steps, index, step, draft)}
                onClick={() => onGo(index)}
              >
                {steps[index].label}
              </button>
            )
          })}
        </nav>
      ) : null}
    </>
  )
}

/** Colonne de droite : la campagne en un coup d'œil, telle qu'elle est saisie à l'instant. */
export function HubSummary({
  draft,
  refs,
  shops,
}: {
  draft: Draft
  refs: References
  shops: Array<{ id: number; name: string }>
}) {
  const target = refs.clientTargets.find((entry) => entry.code === draft.client_target)
  const canaux = refs.channels.filter((channel) => draft.channels[channel.id] !== undefined).map((channel) => channel.label)
  const produits = draft.offer_items.filter((item) => item.label.trim() !== '').length
  const action = (refs.trackingActions ?? []).find((entry) => entry.id === draft.tracking_action_id)
  const lignes: Array<[string, string]> = [
    ['Période', draft.starts_on && draft.ends_on ? `${formatDate(draft.starts_on)} → ${formatDate(draft.ends_on)}` : 'à fixer'],
    [
      'Boutiques',
      draft.scope === 'RESEAU'
        ? 'Tout le réseau'
        : shops.filter((shop) => draft.shop_ids.includes(shop.id)).map((shop) => shop.name).join(', ') || 'à choisir',
    ],
    [
      'Cible',
      `${target?.label ?? draft.client_target}${draft.client_target !== 'b2c' && draft.sector_ids.length > 0 ? ` · ${draft.sector_ids.length} secteur${draft.sector_ids.length > 1 ? 's' : ''}` : ''}`,
    ],
    ['Offre', draft.offer_title.trim() || (produits > 0 ? `${produits} produit${produits > 1 ? 's' : ''}` : 'à choisir')],
    ['Canaux', canaux.length > 0 ? canaux.join(', ') : 'aucun'],
    ['Suivi', action ? `${action.label} · ${draft.tracking_scope === 'SHOP' ? 'par boutique' : 'réseau'}` : 'à choisir'],
    ['Budget', draft.budget_amount.trim() === '' ? 'à fixer' : formatEur(Number(draft.budget_amount))],
  ]

  return (
    <section className="card hub-aside__card">
      <span className="hub-aside__kicker">Résumé</span>
      <h3>La campagne en un coup d’œil</h3>
      <dl className="hub-kv">
        {lignes.map(([cle, valeur]) => (
          <div key={cle}>
            <dt>{cle}</dt>
            <dd>{valeur}</dd>
          </div>
        ))}
        <div>
          <dt>Code de suivi</dt>
          <dd>
            <code>utm_campaign={slugOf(draft.name)}</code>
          </dd>
        </div>
      </dl>
    </section>
  )
}

/** Ce que le module Social a rattaché à la campagne, lu une fois par écran. */
export function useAttached(campaignId: number | null) {
  return useAsync<SocialAttached | null>(
    () => (campaignId === null ? Promise.resolve(null) : api.getSocialAttached(campaignId)),
    [campaignId],
  )
}

function argent(montant: number, devise: string | null): string {
  return `${formatNumber(montant)} ${devise ?? ''}`.trim()
}

/**
 * Colonne de droite : déjà rattaché à la campagne (posts, publications, publicités Meta).
 * `voirClics` : les clics ne sont montrés qu'au réseau, pas dans l'espace boutique.
 */
export function HubAttached({ campaignId, voirClics }: { campaignId: number | null; voirClics: boolean }) {
  const attached = useAttached(campaignId)

  return (
    <section className="card hub-aside__card">
      <span className="hub-aside__kicker">Rattaché</span>
      {campaignId === null ? (
        <p className="muted">Rien encore : la campagne s’enregistre à la première étape suivante.</p>
      ) : attached.loading ? (
        <p className="muted">Lecture du module Social…</p>
      ) : attached.error !== null || attached.data === null ? (
        <p className="muted">Module Social injoignable{attached.error ? ` : ${attached.error}` : ''}.</p>
      ) : (
        <>
          <p className="muted">
            {attached.data.posts.total} post{attached.data.posts.total > 1 ? 's' : ''} du module
            {attached.data.publicationsMeta > 0 ? ` · ${attached.data.publicationsMeta} publication(s) des Pages` : ''}
            {' · '}
            {attached.data.publicites.length} publicité{attached.data.publicites.length > 1 ? 's' : ''} Meta
          </p>
          {attached.data.publicites.map((ad) => (
            <p key={ad.id} className="hub-attached__ad">
              <strong>{ad.nom}</strong>
              <span className="muted">
                {ad.statut}
                {voirClics ? ` · ${ad.clics === null ? '—' : `${formatNumber(ad.clics)} clics`}` : ''} · {argent(ad.depense, ad.devise)}
              </span>
            </p>
          ))}
        </>
      )}
    </section>
  )
}

/** Les liens suivis, canal par canal : chaque visite et chaque commande disent d'où elles viennent. */
export function Traceability({ draft, campaignId }: { draft: Draft; campaignId: number | null }) {
  const attached = useAttached(campaignId)
  const slug = slugOf(draft.name)
  const webshop = attached.data?.webshop ?? null
  const lignes: Array<[string, string, string]> = [
    ['Facebook', 'facebook', 'post'],
    ['Instagram', 'instagram', 'post'],
    ['Publicités Meta', 'meta', 'paid'],
    ['Google', 'google', 'cpc'],
    ['Newsletter', 'newsletter', 'email'],
    ['SMS', 'sms', 'sms'],
    ['PLV · QR code', 'qr', 'print'],
  ]

  return (
    <>
      <h3 className="section-label">Traçabilité</h3>
      <p className="muted">
        Le lien de chaque canal porte la campagne : Google Analytics range chaque visite et chaque
        commande du webshop sous <code>utm_campaign={slug}</code>.
        {webshop === null ? ' L’adresse du webshop vient du module Social une fois la campagne enregistrée.' : ''}
      </p>
      <table className="kpi-ref hub-links">
        <thead>
          <tr>
            <th>Canal</th>
            <th>Lien suivi</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map(([canal, source, medium]) => {
            const params = `utm_campaign=${slug}&utm_source=${source}&utm_medium=${medium}`

            return (
              <tr key={canal}>
                <td>{canal}</td>
                <td>
                  <code>{webshop === null ? `?${params}` : `${webshop}?${params}`}</code>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

/** En tête de l'étape « Canaux » : ce que le module Social fait pour la campagne, et où le faire. */
export function SocialChannels({ campaignId, voirClics }: { campaignId: number | null; voirClics: boolean }) {
  const attached = useAttached(campaignId)

  if (campaignId === null) {
    return (
      <p className="muted wizard__hint">
        Facebook, Instagram et les publicités Meta se rattachent à la campagne une fois enregistrée :
        passez à l’étape suivante, puis revenez ici.
      </p>
    )
  }

  const data = attached.data
  const statuts = data
    ? Object.entries(data.posts.parStatut)
        .map(([statut, n]) => `${n} ${statut.toLowerCase()}`)
        .join(', ')
    : ''

  return (
    <div className="hub-social">
      <div className="hub-social__card">
        <span className="hub-social__ic hub-social__ic--fb">f</span>
        <div>
          <strong>Facebook &amp; Instagram</strong>
          <p className="muted">
            {data
              ? `${data.posts.total} post${data.posts.total > 1 ? 's' : ''} rattaché${data.posts.total > 1 ? 's' : ''}${statuts ? ` (${statuts})` : ''}${data.publicationsMeta ? ` · ${data.publicationsMeta} publication(s) des Pages` : ''}`
              : attached.loading
                ? 'Lecture du module Social…'
                : 'Module Social injoignable.'}
          </p>
          <p className="filters__row">
            <a className="btn btn--sm" href={api.socialScreen('SA Campagnes.dc.html', campaignId)} target="_blank" rel="noopener">
              Planifier les posts ↗
            </a>
            <a className="btn btn--sm" href={api.socialScreen('SA Post.dc.html', campaignId)} target="_blank" rel="noopener">
              Créer un post ↗
            </a>
          </p>
        </div>
      </div>
      <div className="hub-social__card">
        <span className="hub-social__ic hub-social__ic--meta">M</span>
        <div>
          <strong>Publicités Meta</strong>
          <p className="muted">
            {data
              ? `${data.publicites.length} publicité${data.publicites.length > 1 ? 's' : ''} rattachée${data.publicites.length > 1 ? 's' : ''}${data.publicites.length ? `${voirClics ? ` · ${formatNumber(data.totaux.clics)} clics` : ''} · ${argent(data.totaux.depense, data.totaux.devise)}` : ''}`
              : attached.loading
                ? 'Lecture du module Social…'
                : 'Module Social injoignable.'}
          </p>
          <p className="filters__row">
            <a className="btn btn--sm" href={`${api.socialScreen('SA Publicites.dc.html', null)}?new=1&c=bo-${campaignId}`} target="_blank" rel="noopener">
              Nouvelle publicité ↗
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

/** Récap : le tableau de bord de la campagne, puis ce qui manque avant le lancement. */
export function LaunchBoard({
  draft,
  refs,
  campaignId,
  voirClics,
}: {
  draft: Draft
  refs: References
  campaignId: number | null
  voirClics: boolean
}) {
  const attached = useAttached(campaignId)
  const data = attached.data
  const action = (refs.trackingActions ?? []).find((entry) => entry.id === draft.tracking_action_id)
  const tuiles: Array<[string, string, string]> = [
    voirClics
      ? [
          'Publicités Meta · clics',
          data ? formatNumber(data.totaux.clics) : '—',
          data ? `${formatNumber(data.totaux.affichages)} affichages` : 'module Social',
        ]
      : ['Publicités Meta · affichages', data ? formatNumber(data.totaux.affichages) : '—', 'module Social'],
    [
      'Publicités Meta · dépensé',
      data && data.totaux.devise !== null ? argent(data.totaux.depense, data.totaux.devise) : '—',
      voirClics && data && data.totaux.clics > 0 && data.totaux.devise !== null
        ? `coût par clic ${argent(Math.round((data.totaux.depense / data.totaux.clics) * 100) / 100, data.totaux.devise)}`
        : 'chiffres gardés par le module Social',
    ],
    [
      'Posts Facebook et Instagram',
      data ? String(data.posts.total + data.publicationsMeta) : '—',
      data ? `${data.posts.total} du module · ${data.publicationsMeta} des Pages` : 'module Social',
    ],
    [
      'Suivi',
      action ? action.label : 'à choisir',
      action
        ? `${draft.tracking_scope === 'SHOP' ? 'par boutique' : 'pour le réseau'} · ${draft.tracking_target.trim() === '' ? 'cible à fixer' : `cible ${draft.tracking_target} ${action.unit_label}`}`
        : 'étape « Suivi & traçabilité »',
    ],
  ]
  const contrôles: Array<[string, boolean]> = [
    ['Période posée', draft.starts_on !== '' && draft.ends_on !== ''],
    ['Action suivie et sa cible', draft.tracking_action_id !== null && draft.tracking_target.trim() !== ''],
    ['Budget total', draft.budget_amount.trim() !== '' && Number(draft.budget_amount) > 0],
    ['Offre (produits ou gamme)', draft.offer_items.some((item) => item.label.trim() !== '')],
    ['Visuel principal', draft.image_url.trim() !== ''],
    ['Au moins un canal retenu', Object.keys(draft.channels).length > 0],
    ['Rétroplanning', draft.retro.some((entry) => entry.label.trim() !== '')],
    ['Posts ou publicités rattachés', data !== null && data.posts.total + data.publicationsMeta + data.publicites.length > 0],
  ]
  const faits = contrôles.filter(([, ok]) => ok).length

  return (
    <div className="hub-board">
      <h3 className="section-label">Tableau de bord de la campagne</h3>
      <div className="hub-kpis">
        {tuiles.map(([libelle, valeur, sous]) => (
          <div key={libelle} className="hub-kpi">
            <span className="muted">{libelle}</span>
            <b>{valeur}</b>
            <span className="muted">{sous}</span>
          </div>
        ))}
      </div>
      <h3 className="section-label">
        Ce qui manque avant le lancement
        <span className="section-label__aside">
          {faits} / {contrôles.length} prêts
        </span>
      </h3>
      <ul className="hub-check">
        {contrôles.map(([libelle, ok]) => (
          <li key={libelle} className={ok ? 'is-ok' : ''}>
            <span aria-hidden="true">{ok ? '✓' : ''}</span>
            {libelle}
          </li>
        ))}
      </ul>
    </div>
  )
}
