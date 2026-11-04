import { useMemo, useState, type ReactNode } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { campaignShops } from '../../lib/brochure'
import { fontFaces } from '../brochure/Pages'
import type { Channel, ChannelGroup, References, ShopSupport, TextProposal } from '../../lib/api/module'
import type { ChannelEntry, Draft, MessageDraft } from './CampaignBuilder'

/**
 * L'assistant réunit tous les supports de la campagne (maquette validée le 04/11/2026) :
 * en boutique, extérieur, réseaux sociaux, Google, direct. Ce fichier porte ce que les
 * étapes « Cible », « Supports », « Contenus » et « Planning » y ajoutent.
 */

type Patch = (change: Partial<Draft>) => void
type Shop = { id: number; name: string; city: string | null; code?: string }

export const GROUPS: Array<{ key: ChannelGroup; label: string; hint: string }> = [
  { key: 'boutique', label: 'En boutique', hint: 'ce que le client voit sur place' },
  { key: 'exterieur', label: 'Extérieur', hint: 'ce qui se voit de la rue et dans les boîtes aux lettres' },
  { key: 'social', label: 'Réseaux sociaux', hint: 'module Social & Ads, mêmes Pages et mêmes droits' },
  { key: 'google', label: 'Google', hint: 'une publication sur la fiche n’est pas une publicité' },
  { key: 'direct', label: 'Direct & digital', hint: 'clients connus, boutique en ligne' },
]

/** L'écran qui produit un support, tel que le menu le nomme. */
export const EDITORS: Record<string, string> = {
  brochures: 'Brochures & leaflets',
  'social-post': 'Créer un post',
  'social-ads': 'Publicités Meta',
  'social-google': 'Avis & fiches Google',
  instore: 'Marketing en magasin',
}

const PLACEHOLDERS: Record<string, string> = {
  affiches: 'A1 ×6 · A2 ×9 · A3 ×14 — pose J-3',
  ecrans: 'Boucle 15 s, dès J-7',
  plv: 'Chevalet A5 ×4 · stop-rayon ×12',
  animation: 'Dégustation le samedi, 10 h – 12 h',
  affichage: 'Pose J-7',
  leaflet: 'Distribution en caisse et toutes-boîtes',
  depliant: 'Carte de la gamme, en caisse',
  flyer: 'Zones, prestataire',
  partenaires: 'Commerces voisins, QR croisé',
  vehicules: 'Camionnette de livraison',
  posts_meta: '3 posts par semaine',
  meta_ads: 'Rayon, langue, âge',
  stories: '4 stories',
  gbp_post: '2 posts par fiche',
  google_local: 'Mots-clés, rayon',
  avis_google: 'Carte QR en caisse',
  email: 'J-10, segments',
  sms: 'J-1, rappel',
  pwa_push: 'Le jour J',
}

const isPaid = (channel: Channel): boolean => channel.is_paid === true || Number(channel.is_paid) === 1

/** Les supports d'une famille, dans l'ordre du référentiel. */
function channelsOf(refs: References, group: ChannelGroup): Channel[] {
  return refs.channels.filter((channel) => channel.grp === group)
}

// ---------------------------------------------------------------------------
// Étape « Supports »
// ---------------------------------------------------------------------------

export function SupportsGrid({
  refs,
  draft,
  patch,
  agencies,
  onToggle,
  onChange,
}: {
  refs: References
  draft: Draft
  patch: Patch
  agencies: Array<{ id: number; name: string }>
  onToggle: (channelId: number) => void
  onChange: (channelId: number, change: Partial<ChannelEntry>) => void
}) {
  const declared = useAsync(() => api.listShopSupports().catch(() => [] as ShopSupport[]), [])
  const [uniformsOpen, setUniformsOpen] = useState(draft.uniform_ids.length > 0)

  // Les supports des boutiques de la campagne : toutes, pour une campagne réseau qui n'en nomme aucune.
  const supports = useMemo(() => {
    const all = declared.data ?? []
    const ids = new Set(draft.shop_ids.map(String))
    return draft.scope === 'LOCALE' || ids.size > 0 ? all.filter((s) => ids.has(s.shopId)) : all
  }, [declared.data, draft.scope, draft.shop_ids])

  const chosen = refs.channels.filter((channel) => draft.channels[channel.id] !== undefined)
  const engaged = chosen
    .filter((channel) => draft.channels[channel.id]?.valide)
    .reduce((total, channel) => total + Number(draft.channels[channel.id]?.budget || 0), 0)
  const planned = chosen
    .filter((channel) => !draft.channels[channel.id]?.valide)
    .reduce((total, channel) => total + Number(draft.channels[channel.id]?.budget || 0), 0)

  return (
    <div className="sup">
      {GROUPS.map((group) => (
        <div key={group.key}>
          <div className="sup__family">
            <b>{group.label}</b>
            <span>{group.hint}</span>
          </div>
          <div className="sup__grid">
            {channelsOf(refs, group.key).map((channel) => (
              <SupportCard
                key={channel.id}
                channel={channel}
                entry={draft.channels[channel.id]}
                agencies={agencies}
                supports={supports}
                onToggle={() => onToggle(channel.id)}
                onChange={(change) => onChange(channel.id, change)}
              />
            ))}

            {group.key === 'boutique' ? (
              <>
                <BoundCard
                  on={draft.pos_survey_enabled}
                  title="Consignes équipe"
                  description="Ce que l’équipe demande et dit en caisse"
                  onToggle={() => patch({ pos_survey_enabled: !draft.pos_survey_enabled })}
                >
                  Les questions se rédigent plus bas, dans « Questionnaire en caisse ».
                </BoundCard>
                <BoundCard
                  on={draft.uniform_ids.length > 0 || uniformsOpen}
                  title="Tenues & accessoires"
                  description="Tablier, bonnet, couronne…"
                  onToggle={() => {
                    if (draft.uniform_ids.length > 0 || uniformsOpen) {
                      setUniformsOpen(false)
                      patch({ uniform_ids: [] })
                    } else {
                      setUniformsOpen(true)
                    }
                  }}
                >
                  <span className="sup__chips">
                    {refs.uniforms.map((uniform) => (
                      <button
                        key={uniform.id}
                        type="button"
                        className={`filter${draft.uniform_ids.includes(uniform.id) ? ' is-on' : ''}`}
                        title={uniform.description ?? uniform.name}
                        onClick={() =>
                          patch({
                            uniform_ids: draft.uniform_ids.includes(uniform.id)
                              ? draft.uniform_ids.filter((id) => id !== uniform.id)
                              : [...draft.uniform_ids, uniform.id],
                          })
                        }
                      >
                        {uniform.name}
                      </button>
                    ))}
                  </span>
                </BoundCard>
              </>
            ) : null}

            {group.key === 'direct' ? (
              <BoundCard
                on={draft.show_web_shop}
                title="Vitrine de la boutique en ligne"
                description="La campagne paraît sur le webshop pendant sa période"
                onToggle={() => patch({ show_web_shop: !draft.show_web_shop })}
              >
                Les liens et QR codes des autres supports y mènent, suivis par le code de la campagne.
              </BoundCard>
            ) : null}
          </div>
        </div>
      ))}

      <p className="muted wizard__hint">
        {chosen.length === 0
          ? 'Aucun support retenu.'
          : `${chosen.length} support${chosen.length > 1 ? 's' : ''} retenu${chosen.length > 1 ? 's' : ''} · ${fr(engaged)} € validés${planned > 0 ? ` · ${fr(planned)} € encore à valider` : ''}.`}
      </p>
    </div>
  )
}

function fr(value: number): string {
  return value.toLocaleString('fr-BE', { maximumFractionDigits: 0 })
}

function SupportCard({
  channel,
  entry,
  agencies,
  supports,
  onToggle,
  onChange,
}: {
  channel: Channel
  entry: ChannelEntry | undefined
  agencies: Array<{ id: number; name: string }>
  supports: ShopSupport[]
  onToggle: () => void
  onChange: (change: Partial<ChannelEntry>) => void
}) {
  const on = entry !== undefined
  const paid = isPaid(channel)
  const kind = channel.code === 'affichage' ? 'bache' : channel.code === 'affiches' ? 'affiche' : null
  const mine = kind === null ? [] : supports.filter((s) => s.kind === kind)
  const declaredQty = mine.reduce((total, s) => total + s.quantity, 0)

  return (
    <div className={`sup__card${on ? ' is-on' : ''}`}>
      <button type="button" className="sup__head" onClick={onToggle} aria-pressed={on}>
        <span className="sup__check" aria-hidden="true">{on ? '✓' : ''}</span>
        <span className="sup__title">
          <b>{channel.label}</b>
          {channel.description ? <small>{channel.description}</small> : null}
        </span>
        {paid ? <span className="sup__tag sup__tag--paid">payant</span> : null}
      </button>

      {on && entry ? (
        <div className="sup__body">
          <div className="sup__fields">
            <label>
              Quantité
              <input type="number" min={0} value={entry.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
            </label>
            <label className="sup__wide">
              Précisions
              <input
                value={entry.details}
                maxLength={300}
                placeholder={PLACEHOLDERS[channel.code] ?? ''}
                onChange={(e) => onChange({ details: e.target.value })}
              />
            </label>
            <label>
              Budget €
              <input type="number" min={0} step={50} value={entry.budget} onChange={(e) => onChange({ budget: e.target.value })} />
            </label>
            <label>
              Réalisé par
              <select
                value={entry.agencyId ?? ''}
                onChange={(e) => onChange({ agencyId: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Interne</option>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="sup__valid">
            <input type="checkbox" checked={entry.valide} onChange={(e) => onChange({ valide: e.target.checked })} />
            {paid ? 'Validé : le budget publicitaire est engagé' : 'Validé : le support est arrêté'}
          </label>

          {kind !== null ? (
            mine.length === 0 ? (
              <p className="sup__note">
                Aucune {kind === 'bache' ? 'bâche' : 'affiche'} déclarée pour ces boutiques : elles se déclarent dans Marketing en
                magasin › Bâches &amp; affiches.
              </p>
            ) : (
              <div className="sup__declared">
                <span>
                  {kind === 'bache'
                    ? `${declaredQty} bâche${declaredQty > 1 ? 's' : ''} déclarée${declaredQty > 1 ? 's' : ''} : `
                    : `${declaredQty} cadre${declaredQty > 1 ? 's' : ''} d’affiche : `}
                  {summarize(mine)}
                </span>
                {String(declaredQty) !== entry.quantity ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ quantity: String(declaredQty) })}>
                    Reprendre {declaredQty}
                  </button>
                ) : null}
              </div>
            )
          ) : null}

          {channel.editor && EDITORS[channel.editor] ? (
            <p className="sup__note">Se produit dans : {EDITORS[channel.editor]}.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** `300 × 100 ×4 · 200 × 80 mesh ×3` ou `A1 ×6 · A2 ×9`, par boutique et format. */
export function summarize(supports: ShopSupport[]): string {
  const byFormat = new Map<string, number>()
  for (const s of supports) {
    const key = s.kind === 'bache' ? `${s.widthCm} × ${s.heightCm}${s.material === 'mesh' ? ' mesh' : ''}` : (s.paperFormat ?? '?')
    byFormat.set(key, (byFormat.get(key) ?? 0) + s.quantity)
  }
  return [...byFormat.entries()].map(([format, n]) => `${format} ×${n}`).join(' · ')
}

function BoundCard({
  on,
  title,
  description,
  onToggle,
  children,
}: {
  on: boolean
  title: string
  description: string
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className={`sup__card${on ? ' is-on' : ''}`}>
      <button type="button" className="sup__head" onClick={onToggle} aria-pressed={on}>
        <span className="sup__check" aria-hidden="true">{on ? '✓' : ''}</span>
        <span className="sup__title">
          <b>{title}</b>
          <small>{description}</small>
        </span>
      </button>
      {on && children ? <div className="sup__body sup__note">{children}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Étape « Cible » — ce qui s'ajoute à la cible client et aux secteurs B2B
// ---------------------------------------------------------------------------

export function TargetExtras({ refs, draft, patch, shops }: { refs: References; draft: Draft; patch: Patch; shops: Shop[] }) {
  const social = useAsync(() => api.getSocialState().catch(() => null), [])
  const segments = refs.crmSegments ?? []
  const campaign = useMemo(
    () =>
      campaignShops(
        draft.scope,
        draft.shop_ids.map((id) => ({ shop_id: id })),
        shops.map((shop) => ({ ...shop, code: shop.code ?? '', city: shop.city, brand_id: null, brand_name: null })),
        social.data?.shops ?? [],
      ),
    [draft.scope, draft.shop_ids, shops, social.data],
  )

  return (
    <>
      {draft.client_target === 'b2b' ? null : (
        <>
      <h3 className="section-label">
        Particuliers — segments du CRM
        <span className="section-label__aside">sans segment : tous les clients</span>
      </h3>
      {segments.length === 0 ? (
        <p className="muted">Aucun segment défini dans le CRM.</p>
      ) : (
        <div className="filters__row">
          {segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              className={`filter${draft.segment_ids.includes(segment.id) ? ' is-on' : ''}`}
              onClick={() =>
                patch({
                  segment_ids: draft.segment_ids.includes(segment.id)
                    ? draft.segment_ids.filter((id) => id !== segment.id)
                    : [...draft.segment_ids, segment.id],
                })
              }
            >
              {segment.label}
            </button>
          ))}
        </div>
      )}
      <p className="muted wizard__hint">La newsletter et les SMS visent ces segments ; sans segment, tous les clients qui ont accepté.</p>
        </>
      )}

      <h3 className="section-label">Langue, boutique par boutique</h3>
      {social.loading ? (
        <p className="muted">Lecture des boutiques du module Social…</p>
      ) : campaign.length === 0 ? (
        <p className="muted">Aucune boutique dans le périmètre.</p>
      ) : (
        <div className="target__shops">
          {campaign.map((shop) => (
            <div key={shop.id}>
              <b>{shop.name}</b>
              <span>{shop.langs.map((lang) => lang.toUpperCase()).join(' · ')}</span>
              <small>{shop.unknown ? 'inconnue du module Social' : shop.address || 'adresse à renseigner dans Social'}</small>
            </div>
          ))}
        </div>
      )}
      <p className="muted wizard__hint">
        La langue vient du réglage de chaque boutique dans le module Social : une boutique réglée en néerlandais reçoit ses
        supports en néerlandais.
      </p>

      <h3 className="section-label">Ce que la cible donne aux supports</h3>
      <div className="table-scroll">
        <table className="target__usage">
          <tbody>
            <tr>
              <td>Publicité Meta</td>
              <td>Rayon autour de chaque boutique, langue de la boutique — la portée est estimée par Meta à la création.</td>
            </tr>
            <tr>
              <td>Newsletter, SMS</td>
              <td>Segments du CRM ci-dessus, clients ayant accepté — le nombre se compte à l’envoi.</td>
            </tr>
            <tr>
              <td>Toutes-boîtes, bâches, affiches</td>
              <td>Le quartier de chaque boutique — sans ciblage individuel.</td>
            </tr>
            <tr>
              <td>Prospection B2B</td>
              <td>Secteurs et comptes du vivier ci-dessus.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Étape « Contenus » — un message, décliné sur chaque support retenu
// ---------------------------------------------------------------------------

const FIELDS: Array<{ key: keyof MessageDraft; label: string; max: number; hint: string }> = [
  { key: 'title', label: 'Titre', max: 80, hint: '6 mots au plus : il se lit de loin sur une bâche' },
  { key: 'hook', label: 'Accroche', max: 160, hint: 'la phrase manuscrite' },
  { key: 'offer_line', label: 'Offre', max: 160, hint: 'telle qu’elle s’imprime, conditions comprises' },
  { key: 'cta', label: 'Appel à l’action', max: 80, hint: 'Commander, Je précommande…' },
]

export function ContentStep({ refs, draft, patch, shops }: { refs: References; draft: Draft; patch: Patch; shops: Shop[] }) {
  const [lang, setLang] = useState<'fr' | 'nl'>('fr')
  const [proposals, setProposals] = useState<TextProposal[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const social = useAsync(() => api.getSocialState().catch(() => null), [])

  const campaign = useMemo(
    () =>
      campaignShops(
        draft.scope,
        draft.shop_ids.map((id) => ({ shop_id: id })),
        shops.map((shop) => ({ ...shop, code: shop.code ?? '', city: shop.city, brand_id: null, brand_name: null })),
        social.data?.shops ?? [],
      ),
    [draft.scope, draft.shop_ids, shops, social.data],
  )
  const nlShops = campaign.filter((shop) => shop.langs.includes('nl'))
  const message = draft.messages[lang]
  const setField = (key: keyof MessageDraft, value: string) =>
    patch({ messages: { ...draft.messages, [lang]: { ...message, [key]: value } } })

  const chosen = refs.channels.filter((channel) => draft.channels[channel.id] !== undefined)
  const products = draft.offer_items.map((item) => item.label).filter(Boolean)
  const type = refs.campaignTypes.find((t) => t.id === draft.type_id)
  const words = message.title.trim() === '' ? 0 : message.title.trim().split(/\s+/).length
  const colors = {
    primary: draft.color_primary_hex || refs.campaignColors.color_primary_hex,
    secondary: draft.color_secondary_hex || refs.campaignColors.color_secondary_hex,
    ink: draft.color_ink_hex || refs.campaignColors.color_ink_hex,
  }

  async function propose() {
    setBusy(true)
    setFailure(null)
    try {
      const result = await api.proposeTexts({
        produit: products.slice(0, 4).join(', '),
        promo: [draft.offer_title, draft.offer_mechanic].filter(Boolean).join(' — '),
        mention: draft.messages[lang].offer_line || draft.messages.fr.offer_line,
        operation: draft.name,
        objectif: type?.label ?? '',
        boutiques: campaign.map((shop) => shop.name),
        langues: [lang],
      })
      setProposals(result.variantes)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function use(proposal: TextProposal) {
    patch({
      messages: {
        ...draft.messages,
        [lang]: {
          ...message,
          title: (lang === 'nl' ? proposal.titreNl || proposal.titre : proposal.titre).slice(0, 80),
          hook: proposal.phrase.slice(0, 160),
        },
      },
    })
  }

  return (
    <>
      {/* Les polices de la marque (Vank, Playwrite) pour les aperçus, comme les brochures. */}
      <style>{fontFaces()}</style>
      <h2>Le message — un seul, décliné sur tous les supports</h2>
      <p className="muted">
        Titre, accroche, offre et appel à l’action : écrits une fois, repris par chaque support retenu à l’étape
        précédente, à son format.
      </p>

      <div className="content__langs">
        {(['fr', 'nl'] as const).map((code) => (
          <button key={code} type="button" className={`choice-pill${lang === code ? ' is-on' : ''}`} onClick={() => setLang(code)}>
            {code === 'fr' ? 'Français' : 'Néerlandais'}
            {code === 'nl' ? ` · ${nlShops.length === 0 ? 'aucune boutique en NL' : nlShops.map((s) => s.name).join(', ')}` : ''}
          </button>
        ))}
        <span className="content__spacer" />
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void propose()}>
          {busy ? 'Rédaction…' : '✦ Proposer avec Claude'}
        </button>
      </div>

      <div className="content__fields">
        {FIELDS.map((field) => (
          <label key={field.key} className="field field--block">
            {field.label}
            <input
              value={message[field.key]}
              maxLength={field.max}
              placeholder={field.hint}
              onChange={(e) => setField(field.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      {words > 6 ? <p className="muted wizard__hint">Titre de {words} mots : au-delà de 6, il se lit mal sur une bâche.</p> : null}

      {failure ? <p className="error">Propositions indisponibles : {failure}</p> : null}
      {proposals ? (
        <div className="content__proposals">
          {proposals.map((proposal, i) => (
            <button key={i} type="button" className="content__proposal" onClick={() => use(proposal)}>
              <small>{proposal.angle}</small>
              <b>{lang === 'nl' ? proposal.titreNl || proposal.titre : proposal.titre}</b>
              <span>{proposal.phrase}</span>
              <em>Utiliser</em>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted wizard__hint">
          Les propositions viennent du module Social, selon sa charte éditoriale ; aucun prix ni aucune date n’y est inventé.
        </p>
      )}

      <h3 className="section-label">
        Déclinaisons
        <span className="section-label__aside">chaque support se produit ensuite dans son écran</span>
      </h3>
      {chosen.length === 0 && !draft.show_web_shop ? (
        <p className="muted">Aucun support retenu : choisissez-les à l’étape « Supports ».</p>
      ) : (
        <div className="content__decl">
          {chosen.map((channel) => (
            <Declination key={channel.id} channel={channel} message={message} colors={colors} entry={draft.channels[channel.id]} />
          ))}
        </div>
      )}
    </>
  )
}

/** La forme du support, pour son aperçu. */
function shapeOf(code: string): 'poster' | 'banner' | 'square' | 'story' | 'gpost' | 'screen' | 'leaflet' | 'mail' | 'note' {
  if (code === 'affiches' || code === 'plv') return 'poster'
  if (code === 'affichage') return 'banner'
  if (code === 'posts_meta' || code === 'meta_ads') return 'square'
  if (code === 'stories') return 'story'
  if (code === 'gbp_post' || code === 'google_local') return 'gpost'
  if (code === 'ecrans') return 'screen'
  if (code === 'leaflet' || code === 'depliant' || code === 'flyer') return 'leaflet'
  if (code === 'email' || code === 'sms' || code === 'pwa_push') return 'mail'
  return 'note'
}

function Declination({
  channel,
  message,
  colors,
  entry,
}: {
  channel: Channel
  message: MessageDraft
  colors: { primary: string; secondary: string; ink: string }
  entry: ChannelEntry | undefined
}) {
  const shape = shapeOf(channel.code)
  const title = message.title.trim() || 'Titre à écrire'
  const ready = message.title.trim() !== ''
  const style = { background: colors.primary, color: colors.secondary }

  return (
    <div className="decl">
      <div className="decl__stage">
        <div className={`decl__pv decl__pv--${shape}`} style={shape === 'poster' || shape === 'leaflet' ? { background: colors.secondary, color: colors.primary } : style}>
          <span className="decl__title">{title}</span>
          {message.hook ? <span className="decl__hook">{message.hook}</span> : null}
          {message.offer_line && shape !== 'story' && shape !== 'banner' ? <span className="decl__offer">{message.offer_line}</span> : null}
          {message.cta && (shape === 'story' || shape === 'square' || shape === 'mail' || shape === 'gpost') ? (
            <span className="decl__cta" style={{ background: colors.secondary, color: colors.primary }}>
              {message.cta}
            </span>
          ) : null}
        </div>
      </div>
      <div className="decl__foot">
        <b>{channel.label}</b>
        <span className={ready ? 'decl__ok' : 'decl__todo'}>{ready ? 'à produire' : 'message à écrire'}</span>
      </div>
      <small className="muted">
        {[entry?.quantity ? `${entry.quantity} ex.` : '', entry?.details ?? '', channel.editor && EDITORS[channel.editor] ? `→ ${EDITORS[channel.editor]}` : '']
          .filter(Boolean)
          .join(' · ') || '—'}
      </small>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Étape « Planning » — les jalons que les supports apportent
// ---------------------------------------------------------------------------

export function SupportsMilestones({
  refs,
  draft,
  patch,
}: {
  refs: References
  draft: Draft
  patch: Patch
}) {
  const chosen = refs.channels.filter((channel) => draft.channels[channel.id] !== undefined && channel.lead_days !== null)
  const missing = chosen.filter((channel) => !draft.retro.some((step) => step.label.startsWith(channel.label)))

  return (
    <div className="plan-sup">
      <h3 className="section-label">
        Jalons des supports
        <span className="section-label__aside">délais types : impression J-21, pose J-7, newsletter J-10…</span>
      </h3>
      {chosen.length === 0 ? (
        <p className="muted">Aucun support retenu : leurs jalons se proposent ici une fois choisis.</p>
      ) : (
        <>
          <ul className="plan-sup__list">
            {chosen.map((channel) => (
              <li key={channel.id} className={missing.includes(channel) ? '' : 'is-in'}>
                <span>{channel.label}</span>
                <b>J-{channel.lead_days}</b>
                <small>{missing.includes(channel) ? 'à ajouter' : 'dans le rétroplanning'}</small>
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                patch({
                  retro: [
                    ...draft.retro,
                    ...missing.map((channel) => ({
                      label: `${channel.label} — prêt`,
                      days_before_launch: Number(channel.lead_days),
                      position_id: null,
                    })),
                  ],
                })
              }
            >
              Ajouter {missing.length} jalon{missing.length > 1 ? 's' : ''} au rétroplanning
            </button>
          ) : null}
        </>
      )}
      <Timeline draft={draft} />
    </div>
  )
}

/** La frise : chaque jalon à sa date, la campagne en plein. */
function Timeline({ draft }: { draft: Draft }) {
  if (draft.starts_on === '' || draft.retro.length === 0) return null
  const launch = new Date(`${draft.starts_on}T00:00:00`)
  const end = draft.ends_on !== '' ? new Date(`${draft.ends_on}T00:00:00`) : launch
  const lead = Math.max(7, ...draft.retro.map((step) => Number(step.days_before_launch) || 0))
  const span = lead + Math.max(1, Math.round((end.getTime() - launch.getTime()) / 86400000)) + 3
  const at = (offset: number) => `${((offset + lead) / span) * 100}%`
  const length = Math.round((end.getTime() - launch.getTime()) / 86400000)
  const date = (offset: number) => {
    const d = new Date(launch)
    d.setDate(d.getDate() + offset)
    return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="timeline">
      {[...draft.retro]
        .sort((a, b) => Number(b.days_before_launch) - Number(a.days_before_launch))
        .map((step, i) => (
          <div key={i} className="timeline__row">
            <span>{step.label || 'Jalon'}</span>
            <div className="timeline__track">
              <i className="timeline__dot" style={{ left: at(-Number(step.days_before_launch) || 0) }} />
              <small style={{ left: `calc(${at(-Number(step.days_before_launch) || 0)} + 10px)` }}>
                J-{step.days_before_launch} · {date(-Number(step.days_before_launch) || 0)}
              </small>
            </div>
          </div>
        ))}
      <div className="timeline__row">
        <span>Campagne</span>
        <div className="timeline__track">
          <i className="timeline__bar" style={{ left: at(0), width: `${(Math.max(1, length) / span) * 100}%` }} />
          <small style={{ right: `calc(100% - ${at(0)} + 8px)` }}>
            {date(0)} → {date(length)}
          </small>
        </div>
      </div>
    </div>
  )
}
