import { formatDate, formatEur, formatNumber } from '../lib/useAsync'
import type { CampaignDetail } from '../lib/api/module'
import { useLabel } from '../state/references'

/**
 * Fiche de cadrage d'une campagne.
 *
 * Tout ce que l'assistant fait saisir — ton, cible, secteurs, offre, brief
 * agence, tenues, canaux, visuels, rétroplanning — était enregistré et relu par
 * aucun écran. Une fiche illisible ne vaut guère mieux qu'une fiche perdue :
 * l'agence croit avoir été brieffée, personne ne retrouve le brief.
 *
 * Les sections vides ne s'affichent pas : un cadrage partiel est normal, et une
 * suite de tirets ne renseigne personne.
 */

/** Date de lancement moins `n` jours, pour situer un jalon. */
function milestoneDate(startsOn: string | null, days: number): string {
  if (!startsOn) return '—'

  const date = new Date(`${startsOn}T00:00:00`)
  date.setDate(date.getDate() - days)

  return formatDate(date.toISOString().slice(0, 10))
}

/** `11:30:00` → `11:30`. Les secondes n'apportent rien à une plage d'ouverture. */
function shortTime(value: string | null): string {
  return value ? value.slice(0, 5) : '—'
}


export default function CampaignBrief({ campaign }: { campaign: CampaignDetail }) {
  const targetLabel = useLabel((refs) => refs.clientTargets)
  const offer = campaign.offer
  const master = campaign.assets.find((asset) => asset.is_master) ?? campaign.assets[0]
  const enabledChannels = campaign.channels.filter((channel) => channel.is_enabled)
  const targets = campaign.levers.filter((lever) => (lever.target_value ?? 0) > 0)

  const framing: Array<[string, string]> = [
    ['Type', campaign.type_label ?? '—'],
    ['Ton', campaign.tone_label ?? '—'],
    ['Cible client', targetLabel(campaign.client_target)],
    [
      'Période',
      `${formatDate(campaign.starts_on)} → ${formatDate(campaign.ends_on)}`,
    ],
    [
      'Portée',
      campaign.scope === 'RESEAU'
        ? 'Réseau'
        : campaign.shops.map((shop) => shop.shop_name).join(', ') || '—',
    ],
    ['Budget', formatEur(campaign.budget_amount)],
  ]

  if (campaign.objective_coef_pct !== null) {
    const coef = campaign.objective_coef_pct
    framing.push(['Objectif', `N-1 ${coef < 0 ? '−' : '+'} ${Math.abs(coef)} %`])
  }

  return (
    <section className="card brief">
      <h2>Cadrage de la campagne</h2>

      <div className="brief__grid">
        {framing.map(([key, value]) => (
          <div key={key} className="brief__cell">
            <span className="muted">{key}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      {targets.length > 0 ? (
        <>
          <h3 className="section-label">Objectifs par levier</h3>
          <ul className="chips">
            {targets.map((lever) => (
              <li key={lever.lever_id} className="chip chip--lever">
                <span className="dot" style={{ background: lever.color_hex }} />
                {lever.label} · {formatEur(lever.target_value ?? 0)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {offer ? (
        <>
          <h3 className="section-label">Offre</h3>
          <p>
            <strong>{offer.title}</strong>
            {offer.mechanic_text ? <span className="muted"> — {offer.mechanic_text}</span> : null}
          </p>
          <p className="muted">
            {offer.starts_on || offer.ends_on
              ? `Du ${formatDate(offer.starts_on)} au ${formatDate(offer.ends_on)}`
              : 'Fenêtre non précisée'}
            {' · '}
            {/* Pas d'heure enregistrée signifie « sans contrainte horaire », et
                non « de 00:00 à 23:59 » : les deux se distinguent en base. */}
            {offer.hour_from === null && offer.hour_to === null
              ? 'toute la journée'
              : `${shortTime(offer.hour_from)} – ${shortTime(offer.hour_to)}`}
          </p>
          {offer.items.length > 0 ? (
            <ul className="chips">
              {offer.items.map((item, index) => (
                <li key={index} className="chip">
                  {item.label}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {campaign.sectors.length > 0 ? (
        <>
          <h3 className="section-label">Secteurs visés</h3>
          <ul className="chips">
            {campaign.sectors.map((sector) => (
              <li key={sector.id} className="chip">
                {sector.label} · {formatNumber(sector.estimated_leads_count)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {enabledChannels.length > 0 ? (
        <>
          <h3 className="section-label">Diffusion</h3>
          <ul className="chips">
            {enabledChannels.map((channel, index) => (
              <li key={index} className="chip">
                {channel.label}
                {channel.budget_amount ? ` · ${formatEur(channel.budget_amount)}` : ''}
                {channel.agency_name ? <span className="muted"> · {channel.agency_name}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {campaign.uniforms.length > 0 ? (
        <>
          <h3 className="section-label">Tenues & accessoires</h3>
          <ul className="chips">
            {campaign.uniforms.map((name) => (
              <li key={name} className="chip">
                {name}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {master ? (
        <>
          <h3 className="section-label">Visuels</h3>
          <div className="brief__asset">
            {master.file_url ? (
              <img
                src={master.file_url}
                alt=""
                style={{ objectPosition: `50% ${master.focal_point_y ?? 50}%` }}
              />
            ) : null}
            <p className="muted">
              {master.renders_count} déclinaison{master.renders_count > 1 ? 's' : ''}
              {master.pending_count > 0
                ? `, dont ${master.pending_count} à produire`
                : ', toutes produites'}
              . Cadrage vertical à {Math.round(master.focal_point_y ?? 50)} %.
            </p>
          </div>
        </>
      ) : null}

      {campaign.pos_questions.length > 0 || Number(campaign.pos_survey_enabled) === 1 ? (
        <>
          <h3 className="section-label">Questionnaire en caisse</h3>
          {campaign.pos_questions.length === 0 ? (
            <p className="muted">Activé, aucune question saisie.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Réponse</th>
                    <th>Obligatoire</th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.pos_questions.map((question) => (
                    <tr key={question.id}>
                      <td>
                        {question.label}
                        {/* Les propositions comptent autant que la question :
                            c'est ce que le client entendra réellement. */}
                        {question.options ? (
                          <div className="muted">{question.options.split('\n').join(' · ')}</div>
                        ) : null}
                      </td>
                      <td className="muted">{question.answer_type_label ?? question.answer_type}</td>
                      <td className="muted">{question.is_required ? 'Oui' : 'Non'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {campaign.b2b_options.length > 0 || Number(campaign.b2b_webshop_enabled) === 1 ? (
        <>
          <h3 className="section-label">Web-shop B2B</h3>
          {campaign.b2b_options.length === 0 ? (
            <p className="muted">Personnalisé, aucune option retenue.</p>
          ) : (
            <ul className="chips">
              {campaign.b2b_options.map((option) => (
                <li key={option} className="chip">
                  {option}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {campaign.agency_asks.length > 0 || campaign.agency_note ? (
        <>
          <h3 className="section-label">Brief agence</h3>
          {campaign.agency_asks.length > 0 ? (
            <ul className="chips">
              {campaign.agency_asks.map((ask) => (
                <li key={ask} className="chip">
                  {ask}
                </li>
              ))}
            </ul>
          ) : null}
          {campaign.agency_note ? <p>{campaign.agency_note}</p> : null}
        </>
      ) : null}

      {campaign.retroplanning.length > 0 ? (
        <>
          <h3 className="section-label">Rétroplanning</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Jalon</th>
                  <th className="num">J −</th>
                  <th>Date</th>
                  <th>Responsable</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {campaign.retroplanning.map((step) => (
                  <tr key={step.id}>
                    <td>{step.label}</td>
                    <td className="num">{step.days_before_launch}</td>
                    <td className="muted">
                      {milestoneDate(campaign.starts_on, step.days_before_launch)}
                    </td>
                    <td className="muted">{step.position_label ?? '—'}</td>
                    <td className="muted">{step.done_at ? 'Fait' : 'À faire'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}
