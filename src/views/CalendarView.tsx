import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { module as api } from '../lib/api'
import type { Campaign, CockpitNewsletter, GoogleOverview, MetaPost, SocialState } from '../lib/api/module'
import type { Role } from '../lib/navigation'
import { useAsync } from '../lib/useAsync'

/**
 * Calendrier marketing : tout ce qui est prévu ou en cours, au même endroit.
 *
 * Par défaut, une frise de deux mois, une ligne par canal — les campagnes du
 * Marketing en tête, puis les publicités Meta, les posts Facebook et Instagram,
 * les avis Google et les newsletters. Un clic sur un jour ouvre, dessous,
 * l'agenda de sa semaine avec les visuels.
 *
 * Chaque ligne lit sa source et se remplit dès qu'elle répond : la lecture des
 * Pages Meta prend une dizaine de secondes, elle ne doit pas retenir le reste.
 * Vue franchisé : les campagnes seules — les autres sources couvrent tout le réseau.
 */

type Lane = 'campagnes' | 'pubs' | 'facebook' | 'instagram' | 'google' | 'newsletter'
type Channel = 'Facebook' | 'Instagram'

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** Une publicité figure si elle tourne ou va tourner, ou si elle s'est terminée dans la fenêtre. */
const ADS_LIVE = ['Active', 'Programmée', 'En revue', 'En attente']
const ADS_DONE = ['Terminée', 'Arrêtée']

// --- dates locales (jamais toISOString : le fuseau décalerait d'un jour) -------
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)

  return new Date(y, m - 1, d, 12)
}
const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setDate(d.getDate() + n)

  return iso(d)
}
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5)
const monday = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7))
const short = (s: string) => {
  const d = parse(s)

  return `${d.getDate()} ${MOIS[d.getMonth()].slice(0, 4)}.`
}

/** Un même contenu publié le même jour sur plusieurs pages = une seule carte. */
interface PostGroup {
  key: string
  date: string
  time: string
  title: string
  type: string
  img: string | null
  channels: Channel[]
  pages: number
  accounts: string[]
  reactions: number
  planned: boolean
  link: string | null
}

interface CalAd {
  id: string
  name: string
  status: string
  start: string
  end: string | null
  campaign: string | null
  spent: number | null
  devise: string | null
  lienMeta: string | null
  done: boolean
}

type CalCampaign = Campaign & { start: string; end: string }

/** Range des intervalles sur le moins de rangées possible, sans chevauchement. */
function stack<T extends { start: string; end: string | null }>(items: T[], to: string): Array<T & { row: number }> {
  const ends: string[] = []

  return [...items]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((item) => {
      const end = item.end ?? to
      let row = ends.findIndex((last) => last < item.start)
      if (row === -1) {
        row = ends.length
        ends.push(end)
      } else {
        ends[row] = end
      }

      return { ...item, row }
    })
}

// Les lectures lentes sont gardées le temps de la page : changer de mois et
// revenir ne relit pas Meta. « Relire » les vide.
let socialCache: Promise<SocialState> | null = null
let googleCache: Promise<GoogleOverview> | null = null
let newsCache: Promise<CockpitNewsletter[]> | null = null
const metaCache = new Map<string, Promise<{ posts: MetaPost[]; erreurs: string[] }>>()

export default function CalendarView({
  onOpen,
  role,
  brandId,
}: {
  onOpen: (campaignId: number) => void
  role: Role
  brandId: number | 'all'
}) {
  const network = role === 'BRAND_ADMIN'
  const today = iso(new Date())
  const thisMonth = today.slice(0, 8) + '01'
  const [anchor, setAnchor] = useState(thisMonth)
  const [hidden, setHidden] = useState<Lane[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<{ lane: Lane; date: string } | null>(null)
  const [version, setVersion] = useState(0)
  const agendaRef = useRef<HTMLDivElement>(null)

  const from = anchor
  const to = iso(new Date(parse(anchor).getFullYear(), parse(anchor).getMonth() + 2, 0, 12))
  const span = daysBetween(from, to) + 1

  const campaigns = useAsync(
    () => api.listCampaigns(brandId === 'all' ? {} : { brand_id: brandId }),
    [brandId, version],
  )
  const social = useAsync<SocialState | null>(
    () => (network ? (socialCache ??= api.getSocialState()) : Promise.resolve(null)),
    [network, version],
  )
  const meta = useAsync(() => {
    if (!network) return Promise.resolve(null)
    const key = `${from}|${to}`
    let load = metaCache.get(key)
    if (load === undefined) {
      load = api.getMetaCalendar(from, to)
      metaCache.set(key, load)
    }

    return load
  }, [network, from, to, version])
  const google = useAsync<GoogleOverview | null>(
    () => (network ? (googleCache ??= api.getGoogleOverview()) : Promise.resolve(null)),
    [network, version],
  )
  const news = useAsync<CockpitNewsletter[] | null>(
    () => (network ? (newsCache ??= api.getCockpitNewsletters()) : Promise.resolve(null)),
    [network, version],
  )

  // Une campagne sans dates n'a pas de place sur une frise.
  const camps = useMemo<CalCampaign[]>(
    () =>
      (campaigns.data ?? []).flatMap((c) =>
        c.starts_on && c.ends_on ? [{ ...c, start: c.starts_on, end: c.ends_on }] : [],
      ),
    [campaigns.data],
  )
  const campByKey = useMemo(() => new Map(camps.map((c) => [`bo-${c.id}`, c])), [camps])

  const ads = useMemo<CalAd[]>(
    () =>
      (social.data?.ads ?? []).flatMap((a) =>
        !a.gone && a.start && (ADS_LIVE.includes(a.status) || (ADS_DONE.includes(a.status) && a.end !== null))
          ? [{ ...a, start: a.start, done: ADS_DONE.includes(a.status) }]
          : [],
      ),
    [social.data],
  )

  const posts = useMemo(() => {
    const groups = new Map<string, PostGroup>()
    // Les posts du module : déjà un par contenu, quel que soit le nombre de pages.
    for (const p of social.data?.posts ?? []) {
      if (p.status === 'Brouillon' || !p.date) continue
      const channels: Channel[] = []
      if (p.fb) channels.push('Facebook')
      if (p.ig) channels.push('Instagram')
      if (!channels.length) continue
      groups.set(`m:${p.id}`, {
        key: `m:${p.id}`,
        date: p.date,
        time: p.time,
        title: p.title,
        type: p.type,
        img: api.socialAsset(p.img),
        channels,
        pages: Object.keys(p.ch ?? {}).length || (p.shops ?? []).length || 1,
        accounts: ['module Social'],
        reactions: 0,
        planned: p.status !== 'Publié',
        link: api.socialScreen('SA Calendrier.dc.html', null),
      })
    }
    // Les publications lues chez Meta : le même texte le même jour sur plusieurs pages ne fait qu'une carte.
    for (const p of meta.data?.posts ?? []) {
      const key = `${p.date}|${p.title.slice(0, 45)}`
      const g = groups.get(key)
      if (g) {
        g.pages += 1
        if (!g.channels.includes(p.channel)) g.channels.push(p.channel)
        if (!g.accounts.includes(p.accountName)) g.accounts.push(p.accountName)
        g.reactions += p.stats?.reactions ?? 0
        continue
      }
      groups.set(key, {
        key,
        date: p.date,
        time: p.time,
        title: p.title,
        type: p.type,
        img: p.img,
        channels: [p.channel],
        pages: 1,
        accounts: [p.accountName],
        reactions: p.stats?.reactions ?? 0,
        planned: p.status !== 'Publié',
        link: p.permalink,
      })
    }

    return [...groups.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  }, [social.data, meta.data])

  const reviews = useMemo(() => (google.data?.avis ?? []).map((r) => ({ ...r, date: r.le.slice(0, 10) })), [google.data])
  // Les modèles de démonstration (`exemple`) et les brouillons ne sont pas des envois.
  const letters = useMemo(
    () =>
      (news.data ?? []).flatMap((n) =>
        !n.exemple && n.envoiLe && n.statut !== 'draft' ? [{ ...n, date: n.envoiLe.slice(0, 10) }] : [],
      ),
    [news.data],
  )

  // --- ce qui tombe dans la fenêtre ------------------------------------------
  const inWindow = (start: string, end: string | null) => start <= to && (end === null || end >= from)
  const wCamps = stack(camps.filter((c) => inWindow(c.start, c.end)), to)
  const wAds = stack(ads.filter((a) => inWindow(a.start, a.end)), to)
  const wPosts = posts.filter((p) => p.date >= from && p.date <= to)
  const wReviews = reviews.filter((r) => r.date >= from && r.date <= to)
  const wLetters = letters.filter((n) => n.date >= from && n.date <= to)
  const onChannel = (ch: Channel) => wPosts.filter((p) => p.channels.includes(ch))

  // --- géométrie : une position en % de la fenêtre -------------------------------
  const pct = (s: string) => (Math.max(0, Math.min(span, daysBetween(from, s))) / span) * 100
  const left = (s: string) => pct(s < from ? from : s)
  const width = (s: string, e: string | null) => pct(e === null || e > to ? addDays(to, 1) : addDays(e, 1)) - left(s)
  const ROW = 30
  const laneHeight = (bars: Array<{ row: number }>) =>
    Math.max(56, 14 + (bars.length ? Math.max(...bars.map((b) => b.row)) + 1 : 0) * ROW)

  const days = Array.from({ length: span }, (_, i) => addDays(from, i))
  const months: Array<{ label: string; size: number }> = []
  for (const d of days) {
    const label = `${MOIS[parse(d).getMonth()]} ${parse(d).getFullYear()}`
    const last = months[months.length - 1]
    if (last && last.label === label) last.size += 1
    else months.push({ label, size: 1 })
  }

  const shift = (n: number) => {
    const d = parse(anchor)
    setAnchor(iso(new Date(d.getFullYear(), d.getMonth() + n, 1, 12)))
    setHover(null)
  }

  useEffect(() => {
    if (picked !== null) agendaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [picked])

  /** Un clic n'importe où sur la frise ouvre l'agenda du jour visé. */
  function pickFromTrack(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const index = Math.floor(((event.clientX - box.left) / box.width) * span)
    if (index >= 0 && index < span) setPicked(days[index])
  }

  const money = (v: number | null, devise: string | null) =>
    v === null ? '' : `${Math.round(v).toLocaleString('fr-BE')} ${devise ?? ''}`.trim()

  const reading = (state: { loading: boolean; error: string | null }, what: string) =>
    state.error ? (
      <span className="mc-msg is-error">
        Lecture {what} impossible : {state.error}
      </span>
    ) : state.loading ? (
      <span className="mc-msg">Lecture {what}…</span>
    ) : null

  /** Une pastille par jour de publication, avec la vignette du premier visuel. */
  function dots(lane: Lane, channel: Channel) {
    const byDay = new Map<string, PostGroup[]>()
    for (const p of onChannel(channel)) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p])

    return [...byDay.entries()].map(([date, list]) => {
      // La vignette : le premier post du jour qui a un visuel (un texte seul n'en a pas).
      const first = list.find((p) => p.img) ?? list[0]

      return (
        <div
          key={date}
          className={`mc-dot${list.some((p) => p.planned) ? ' is-planned' : ''}`}
          style={{ left: `calc(${pct(date) + 50 / span}% - 13px)`, backgroundImage: first.img ? `url("${first.img}")` : undefined }}
          onMouseEnter={() => setHover({ lane, date })}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            setPicked(date)
          }}
        >
          {list.length > 1 ? <i>{list.length}</i> : null}
          {hover?.lane === lane && hover.date === date ? (
            <div className="mc-pop">
              {first.img ? <img src={first.img} alt="" /> : null}
              <div>
                <b>{first.pages > 1 ? `${first.pages} pages · ${first.accounts[0]}` : first.accounts[0]}</b>
                <p>{first.title || 'Sans texte'}</p>
                <span>
                  {short(date)} · {first.time}
                  {list.length > 1 ? ` · et ${list.length - 1} autre${list.length > 2 ? 's' : ''}` : ''} — cliquez pour la semaine
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )
    })
  }

  const runningAds = wAds.filter((a) => !a.done)
  const devises = [...new Set(runningAds.map((a) => a.devise).filter((d): d is string => !!d))]
  const spent = runningAds.reduce((s, a) => s + (a.spent ?? 0), 0)
  const planned = (ch: Channel) => onChannel(ch).filter((p) => p.planned).length
  const note = google.data?.reputation.reseau?.moyenne ?? null
  const cible = google.data?.reputation.cible ?? null

  const lanes: Array<{ key: Lane; label: string; icon: string; count: number; sub: string; height: number; body: ReactNode }> = [
    {
      key: 'campagnes',
      label: 'Campagnes',
      icon: 'C',
      count: wCamps.length,
      sub: campaigns.loading ? 'lecture…' : `${wCamps.length} sur la période`,
      height: laneHeight(wCamps),
      body: (
        <>
          {reading(campaigns, 'des campagnes')}
          {!campaigns.loading && !campaigns.error && !wCamps.length ? <span className="mc-msg">Aucune campagne sur la période</span> : null}
          {wCamps.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mc-bar mc-bar--camp"
              style={{
                top: 8 + c.row * ROW,
                left: `${left(c.start)}%`,
                width: `${width(c.start, c.end)}%`,
                color: c.status_text_hex,
                background: c.status_bg_rgba,
                borderColor: c.status_text_hex,
              }}
              onClick={(e) => {
                e.stopPropagation()
                onOpen(c.id)
              }}
              title={`${c.name} · ${short(c.start)} → ${short(c.end)} · ${c.status_label}`}
            >
              {c.start < from ? '← ' : ''}
              {c.name}
              <small>
                {c.type_label ? `${c.type_label} · ` : ''}
                {c.status_label}
              </small>
            </button>
          ))}
        </>
      ),
    },
  ]

  if (network) {
    lanes.push(
      {
        key: 'pubs',
        label: 'Publicités Meta',
        icon: 'M',
        count: wAds.length,
        sub: social.loading
          ? 'lecture…'
          : `${runningAds.length} en cours${devises.length === 1 ? ` · ${money(spent, devises[0])} dépensés` : ''}`,
        height: laneHeight(wAds),
        body: (
          <>
            {reading(social, 'du module Social')}
            {!social.loading && !social.error && !wAds.length ? <span className="mc-msg">Aucune publicité sur la période</span> : null}
            {wAds.map((a) => {
              const linked = a.campaign ? campByKey.get(a.campaign) : undefined

              return (
                <a
                  key={a.id}
                  className={`mc-bar mc-bar--ad${a.end === null ? ' is-open' : ''}${a.done ? ' is-done' : ''}`}
                  style={{ top: 10 + a.row * ROW, left: `${left(a.start)}%`, width: `${width(a.start, a.end)}%` }}
                  href={a.lienMeta ?? undefined}
                  target="_blank"
                  rel="noopener"
                  onClick={(e) => e.stopPropagation()}
                  title={`${a.name} · ${a.status} · depuis le ${short(a.start)}${a.end ? ` jusqu’au ${short(a.end)}` : ', sans date de fin'}`}
                >
                  {a.start < from ? '← ' : ''}
                  {a.name}
                  {a.spent !== null ? ` · ${money(a.spent, a.devise)}` : ''}
                  {linked ? <span className="mc-link">↳ {linked.name}</span> : null}
                  {a.end === null ? ' · sans fin →' : ''}
                </a>
              )
            })}
          </>
        ),
      },
      {
        key: 'facebook',
        label: 'Facebook',
        icon: 'f',
        count: onChannel('Facebook').length,
        sub: meta.loading ? 'lecture des Pages…' : `${onChannel('Facebook').length - planned('Facebook')} publiés · ${planned('Facebook')} prévus`,
        height: 56,
        body: (
          <>
            {reading(meta, 'des Pages Facebook')}
            {dots('facebook', 'Facebook')}
          </>
        ),
      },
      {
        key: 'instagram',
        label: 'Instagram',
        icon: 'ig',
        count: onChannel('Instagram').length,
        sub: meta.loading ? 'lecture des comptes…' : `${onChannel('Instagram').length - planned('Instagram')} publiés · ${planned('Instagram')} prévus`,
        height: 56,
        body: (
          <>
            {reading(meta, 'des comptes Instagram')}
            {dots('instagram', 'Instagram')}
          </>
        ),
      },
      {
        key: 'google',
        label: 'Avis Google',
        icon: 'G',
        count: wReviews.length,
        sub: note !== null ? `note ${note.toLocaleString('fr-BE')} ★${cible !== null ? ` · cible ${cible.toLocaleString('fr-BE')}` : ''}` : google.loading ? 'lecture…' : '',
        height: 56,
        body: (
          <>
            {reading(google, 'des avis Google')}
            {!google.loading && !google.error && !wReviews.length ? <span className="mc-msg">Aucun avis reçu sur la période</span> : null}
            {wReviews.map((r) => (
              <span
                key={r.id}
                className={`mc-star${(r.note ?? 5) <= 2 ? ' is-low' : (r.note ?? 5) === 3 ? ' is-mid' : ''}`}
                style={{ left: `calc(${pct(r.date) + 50 / span}% - 13px)` }}
                title={`${r.boutique} · ${r.note ?? '?'}★ · ${short(r.date)} — ${r.message}`}
              >
                {r.note ?? '?'}★
              </span>
            ))}
          </>
        ),
      },
      {
        key: 'newsletter',
        label: 'Newsletter & SMS',
        icon: '@',
        count: wLetters.length,
        sub: news.loading ? 'lecture…' : `${wLetters.length} sur la période`,
        height: 56,
        body: (
          <>
            {reading(news, 'des newsletters')}
            {!news.loading && !news.error && !wLetters.length ? <span className="mc-msg">Aucune newsletter ni SMS programmé</span> : null}
            {wLetters.map((n) => (
              <span key={n.id} className="mc-nl" style={{ left: `${pct(n.date)}%` }} title={`${n.nom} · ${n.envoiLe ?? ''}`}>
                {n.canal === 'sms' ? 'SMS' : '@'} {n.nom}
              </span>
            ))}
          </>
        ),
      },
    )
  }

  const shown = lanes.filter((l) => !hidden.includes(l.key))
  const toggle = (key: Lane) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]))
  const todayIn = today >= from && today <= to
  const periodLabel = months.map((m) => m.label).join(' – ').replace(/ (\d{4}) – (.+ \1)$/, ' – $2')

  return (
    <div className="mc">
      <div className="mc-toolbar">
        <button type="button" className="btn btn--sm" onClick={() => shift(-1)} aria-label="Mois précédent">
          ‹
        </button>
        <span className="mc-period">{periodLabel}</span>
        <button type="button" className="btn btn--sm" onClick={() => shift(1)} aria-label="Mois suivant">
          ›
        </button>
        <button type="button" className="btn btn--sm" onClick={() => setAnchor(thisMonth)} disabled={anchor === thisMonth}>
          Aujourd’hui
        </button>
        <span className="mc-spacer" />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            socialCache = null
            googleCache = null
            newsCache = null
            metaCache.clear()
            setVersion((v) => v + 1)
          }}
        >
          ↻ Relire
        </button>
      </div>

      {lanes.length > 1 ? (
        <div className="mc-filters">
          {lanes.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`filter mc-filter${hidden.includes(l.key) ? '' : ' is-on'}`}
              aria-pressed={!hidden.includes(l.key)}
              onClick={() => toggle(l.key)}
            >
              <span className={`mc-ico mc-ico--${l.key}`}>{l.icon}</span>
              {l.label} <b>{l.count}</b>
            </button>
          ))}
        </div>
      ) : null}

      <section className="card mc-frise">
        <div className="mc-grid">
          <div className="mc-labels">
            <div className="mc-head" />
            {shown.map((l) => (
              <div key={l.key} className="mc-label" style={{ height: l.height }}>
                <span className={`mc-ico mc-ico--${l.key}`}>{l.icon}</span>
                <div>
                  <strong>{l.label}</strong>
                  <span>{l.sub}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mc-tracks">
            <div className="mc-head">
              <div className="mc-months">
                {months.map((m) => (
                  <div key={m.label} style={{ width: `${(m.size / span) * 100}%` }}>
                    {m.size > 4 ? m.label : ''}
                  </div>
                ))}
              </div>
              <div className="mc-days">
                {days.map((d) => {
                  const wd = parse(d).getDay()

                  return (
                    <button
                      key={d}
                      type="button"
                      className={`mc-day${wd === 0 || wd === 6 ? ' is-we' : ''}${wd === 1 ? ' is-mon' : ''}${d === today ? ' is-today' : ''}`}
                      onClick={() => setPicked(d)}
                      title={`${JOURS[wd]} ${short(d)} — voir la semaine`}
                    >
                      {wd === 1 ? parse(d).getDate() : ''}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mc-lanes" onClick={pickFromTrack}>
              {todayIn ? (
                <>
                  <div className="mc-future" style={{ left: `${pct(today)}%` }} />
                  <div className="mc-today" style={{ left: `${pct(today)}%` }}>
                    <span>aujourd’hui</span>
                  </div>
                </>
              ) : null}
              {picked !== null && monday(picked) <= to && addDays(monday(picked), 6) >= from ? (
                <div
                  className="mc-week"
                  style={{ left: `${left(monday(picked))}%`, width: `${width(monday(picked), addDays(monday(picked), 6))}%` }}
                />
              ) : null}
              {shown.map((l) => (
                <div key={l.key} className="mc-lane" style={{ height: l.height }}>
                  {l.body}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mc-legend">
          <span>Cliquez un jour pour voir sa semaine en visuels</span>
          <span>Vignette = premier visuel du jour · chiffre = publications du jour</span>
          {network ? <span>→ = publicité sans date de fin · ↳ = rattachée à une campagne</span> : null}
          <span>Une campagne s’ouvre d’un clic sur sa barre</span>
        </div>
      </section>

      {picked !== null ? (
        <div ref={agendaRef} className="mc-anchor">
          <Agenda
            date={picked}
            today={today}
            onWeek={(n) => {
              // La semaine suivie sort de la frise : la frise la suit, pour que ses posts soient lus.
              const next = addDays(monday(picked), n * 7)
              if (next > to || addDays(next, 6) < from) setAnchor(next.slice(0, 8) + '01')
              setPicked(next)
            }}
            onClose={() => setPicked(null)}
            camps={camps}
            ads={network ? ads : []}
            posts={posts}
            reviews={network ? reviews : []}
            letters={network ? letters : []}
            campByKey={campByKey}
            onOpen={onOpen}
            loading={network && (meta.loading || social.loading)}
          />
        </div>
      ) : null}
    </div>
  )
}

/** La semaine du jour cliqué, jour par jour, avec les visuels. */
function Agenda({
  date,
  today,
  onWeek,
  onClose,
  camps,
  ads,
  posts,
  reviews,
  letters,
  campByKey,
  onOpen,
  loading,
}: {
  date: string
  today: string
  onWeek: (n: number) => void
  onClose: () => void
  camps: CalCampaign[]
  ads: CalAd[]
  posts: PostGroup[]
  reviews: Array<{ id: string; date: string; boutique: string; note: number | null; message: string }>
  letters: Array<CockpitNewsletter & { date: string }>
  campByKey: Map<string, CalCampaign>
  onOpen: (campaignId: number) => void
  loading: boolean
}) {
  const start = monday(date)
  const end = addDays(start, 6)
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const live = camps.filter((c) => c.start <= end && c.end >= start)
  const liveAds = ads.filter((a) => a.start <= end && (a.end === null || a.end >= start))
  const MAX = 8

  return (
    <section className="card mc-agenda">
      <header className="mc-agenda__head">
        <h2>
          Semaine du {short(start)} au {short(end)} {parse(end).getFullYear()}
        </h2>
        <span className="mc-spacer" />
        <button type="button" className="btn btn--sm" onClick={() => onWeek(-1)}>
          ← Semaine précédente
        </button>
        <button type="button" className="btn btn--sm" onClick={() => onWeek(1)}>
          Semaine suivante →
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Fermer
        </button>
      </header>

      {live.length || liveAds.length ? (
        <div className="mc-agenda__strip">
          <span className="mc-kicker">En cours</span>
          {live.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mc-pill"
              style={{ color: c.status_text_hex, background: c.status_bg_rgba, borderColor: c.status_text_hex }}
              onClick={() => onOpen(c.id)}
            >
              {c.name}{' '}
              <small>
                {short(c.start)} → {short(c.end)}
              </small>
            </button>
          ))}
          {liveAds.map((a) => (
            <span key={a.id} className={`mc-pill mc-pill--ad${a.done ? ' is-done' : ''}`}>
              {a.name} <small>{a.end ? `→ ${short(a.end)}` : 'sans fin'}</small>
            </span>
          ))}
        </div>
      ) : null}

      {week.map((d) => {
        const wd = parse(d).getDay()
        const day = posts.filter((p) => p.date === d)
        const future = d > today
        const tags: Array<{ key: string; text: string; tone: string; open?: () => void }> = []
        for (const c of camps) {
          if (c.start === d) tags.push({ key: `cs${c.id}`, text: `▶ début · ${c.name}`, tone: 'camp', open: () => onOpen(c.id) })
          if (c.end === d) tags.push({ key: `ce${c.id}`, text: `■ fin · ${c.name}`, tone: 'camp', open: () => onOpen(c.id) })
        }
        for (const a of ads) {
          const linked = a.campaign ? campByKey.get(a.campaign) : undefined
          if (a.start === d) tags.push({ key: `as${a.id}`, text: `▶ pub lancée · ${a.name}${linked ? ` ↳ ${linked.name}` : ''}`, tone: 'ad' })
          if (a.end === d) tags.push({ key: `ae${a.id}`, text: `■ fin de pub · ${a.name}`, tone: 'ad' })
        }
        for (const n of letters.filter((l) => l.date === d)) {
          tags.push({ key: `n${n.id}`, text: `@ ${n.nom}${n.statut === 'sent' ? ' · envoyée' : ' · programmée'}`, tone: 'nl' })
        }
        for (const r of reviews.filter((v) => v.date === d)) {
          tags.push({ key: `r${r.id}`, text: `${r.note ?? '?'}★ · ${r.boutique} — ${r.message.slice(0, 60)}`, tone: (r.note ?? 5) <= 2 ? 'low' : 'gg' })
        }

        return (
          <div key={d} className={`mc-agday${d === today ? ' is-today' : ''}${d === date ? ' is-picked' : ''}${future ? ' is-future' : ''}`}>
            <div className="mc-agday__date">
              <span>{JOURS[wd]}</span>
              <b>{parse(d).getDate()}</b>
              <span>
                {MOIS[parse(d).getMonth()].slice(0, 4)}.{d === today ? ' · auj.' : ''}
              </span>
            </div>
            <div className="mc-agday__body">
              {tags.length ? (
                <div className="mc-agday__tags">
                  {tags.map((t) =>
                    t.open ? (
                      <button key={t.key} type="button" className={`mc-tag mc-tag--${t.tone}`} onClick={t.open}>
                        {t.text}
                      </button>
                    ) : (
                      <span key={t.key} className={`mc-tag mc-tag--${t.tone}`}>
                        {t.text}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
              {day.length ? (
                <div className="mc-cards">
                  {day.slice(0, MAX).map((p) => (
                    <a key={p.key} className="mc-card" href={p.link ?? undefined} target="_blank" rel="noopener">
                      <div className="mc-card__img" style={{ backgroundImage: p.img ? `url("${p.img}")` : undefined }}>
                        <span className="mc-card__ch">
                          {p.channels.map((c) => (
                            <span key={c} className={`mc-ico mc-ico--${c === 'Facebook' ? 'facebook' : 'instagram'}`}>
                              {c === 'Facebook' ? 'f' : 'ig'}
                            </span>
                          ))}
                        </span>
                        <em>{p.planned ? 'prévu' : p.type.split(' ·')[0]}</em>
                      </div>
                      <div className="mc-card__tx">
                        <b>
                          {p.pages > 1
                            ? `${p.pages} pages · ${p.accounts.slice(0, 2).join(', ')}${p.accounts.length > 2 ? '…' : ''}`
                            : p.accounts[0]}
                        </b>
                        <span>{p.title || 'Sans texte'}</span>
                        <i>
                          {p.time} · ♥ {p.reactions}
                        </i>
                      </div>
                    </a>
                  ))}
                  {day.length > MAX ? <span className="mc-more">+{day.length - MAX}</span> : null}
                </div>
              ) : (
                <p className="mc-none">
                  {loading ? 'Lecture des publications…' : future ? 'Rien de programmé ce jour-là' : 'Aucune publication'}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
