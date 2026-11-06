import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import '../social/social.css'
import '../social/grille.css'
import './instagram.css'
import { addDays, dLabel, dShort } from '../../lib/social/format'
import { Barres, C, Courbe, court, fmtG, incomplets, lg, plages, signe } from '../social/GrilleGraphes'
import type { Survol } from '../social/GrilleGraphes'
import { instagram, instagramAbonnes, lien, media, texteErreur, useFranchise } from './_donnees'
import type { AbonnesFranchise, MediaGrille, Naviguer, ProgrammeGrille, VueInstagram } from './_donnees'

/**
 * Grille Instagram — la page « Grille Instagram » de l'espace franchisé (social/franchisee/Instagram.dc.html),
 * réécrite dans le Marketing. Le profil tel qu'il sera : les posts programmés au-dessus de ceux déjà en ligne (lus en
 * direct chez Meta), sur le compte de la boutique ou, en Instagram unique, celui du réseau (lecture seule). À droite :
 * les abonnés jour par jour (30 jours), les comptes touchés et les interactions des dernières publications.
 */

interface Props {
  /** Suivre un lien vers une autre page de l'espace (le calendrier, un post). Sans elle, le lien change l'adresse. */
  onNaviguer?: Naviguer
}

type Selection = { p: string } | { m: string } | null

const INI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#C13584"/><text x="32" y="41" font-family="Arial" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">AB</text></svg>',
  )

interface Case {
  sched: boolean
  p?: ProgrammeGrille
  m?: MediaGrille
  src?: string
  tile: number
}

export default function InstagramView({ onNaviguer }: Props) {
  const { etat, erreur } = useFranchise()
  const [data, setData] = useState<VueInstagram | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<Selection>(null)
  const [ab, setAb] = useState<AbonnesFranchise | null>(null)
  const [abLoading, setAbLoading] = useState(false)
  const [abErr, setAbErr] = useState('')
  const [hovJ, setHovJ] = useState<Survol | null>(null)
  const [hovP, setHovP] = useState<Survol | null>(null)

  const voirAnalyse = etat?.rules?.voirAnalyse !== false
  const charger = useCallback(() => {
    setLoading(true)
    setErr('')
    instagram()
      .then((r) => {
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setLoading(false)
        setErr(texteErreur(e))
      })
    // À droite : les abonnés jour par jour, lus à part (la grille s'affiche sans les attendre).
    if (!voirAnalyse) return
    setAbLoading(true)
    setAbErr('')
    instagramAbonnes()
      .then((a) => {
        setAb(a)
        setAbLoading(false)
      })
      .catch((e: unknown) => {
        setAbLoading(false)
        setAbErr(texteErreur(e))
      })
  }, [voirAnalyse])
  const pret = !!etat
  useEffect(() => {
    if (pret) charger()
  }, [pret, charger])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const r = data ?? {}
  const reseau = r.reseau != null ? !!r.reseau : !!etat.instagramUnique
  const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fr-BE'))
  const when = (p: ProgrammeGrille) => `${dShort(p.date)} · ${p.time}`
  const programmes = r.programmes ?? []
  const medias = r.media ?? []

  // Les cases, du plus récent au plus ancien : les programmés (une frise = 3 cases), puis les publications en ligne.
  const raw: Case[] = []
  programmes.forEach((p) => {
    if (Array.isArray(p.frise) && p.frise.length === 3) p.frise.forEach((s, j) => raw.push({ sched: true, p, src: s, tile: j }))
    else raw.push({ sched: true, p, src: p.src, tile: -1 })
  })
  medias.forEach((m) => raw.push({ sched: false, m, src: m.src, tile: -1 }))
  const estSel = (c: Case) => !!sel && (('p' in sel && c.sched && sel.p === c.p?.id) || ('m' in sel && !c.sched && sel.m === c.m?.id))

  let carte: { kind: string; title: string; when: string; stats?: string; help: string; ouvrir?: { href: string; onClick?: (e: MouseEvent) => void; target?: string; label: string } } | null = null
  if (sel && 'p' in sel) {
    const p = programmes.find((x) => x.id === sel.p)
    if (p) {
      const l = lien(onNaviguer, 'cal', `post=${encodeURIComponent(p.id)}`)
      carte = {
        kind: `${p.frise ? 'Frise programmée · 3 posts' : 'Post programmé'}${p.own ? ' · votre post' : ' · réseau'}`,
        title: p.title,
        when: `${dLabel(p.date)} à ${p.time}${p.status === 'À valider' ? ' · à valider par le réseau' : ''}`,
        help: p.own
          ? 'Votre post : il apparaîtra ici à sa publication.'
          : `Programmé par le réseau sur le compte Instagram${reseau ? ' commun' : ' de la boutique'}. Il prendra cette place à sa publication.`,
        ouvrir: p.own ? { href: l.href, onClick: l.onClick, label: 'Voir au calendrier' } : undefined,
      }
    }
  } else if (sel && 'm' in sel) {
    const m = medias.find((x) => x.id === sel.m)
    if (m) {
      carte = {
        kind: `${m.frise ? 'Frise · ' : ''}${m.type || 'Publication'} en ligne`,
        title: m.caption || 'Publication Instagram',
        when: `Publié le ${dLabel(String(m.at).slice(0, 10))} à ${String(m.at).slice(11, 16)}`,
        stats: m.likes != null || m.comments != null ? `♥ ${fmt(m.likes)} j’aime · ${fmt(m.comments)} commentaire(s)` : undefined,
        help: 'Les publications en ligne ne se déplacent pas : la grille suit l’ordre de publication.',
        ouvrir: m.permalink ? { href: m.permalink, target: '_blank', label: 'Voir sur Instagram ↗' } : undefined,
      }
    }
  }
  const bientot = programmes.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const lu = r.le ? String(r.le) : ''
  const cal = lien(onNaviguer, 'cal')
  const comment = reseau
    ? 'L’Instagram de L’Atelier By est un compte unique pour tout le réseau. Seul le franchiseur y publie. Vos posts partent sur la Page Facebook de votre boutique (« Créer un post »). Vous voyez ici ce qui est en ligne et, encadré, ce que le réseau a programmé. Une idée pour l’Instagram du réseau ? Proposez-la au franchiseur.'
    : 'Le compte Instagram de votre boutique, lu en direct chez Meta : les 30 dernières publications. Au-dessus, encadrés, vos posts et ceux du réseau programmés sur ce compte : ils prendront ces places à leur publication. Une frise (3 posts qui forment une ligne) part en bloc : programmez vos posts à plus de 30 minutes d’elle.'

  return (
    <div className="social-native grille fig">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode" title={comment}>
            {reseau ? 'Compte unique du réseau · géré par le franchiseur · lecture seule' : 'L’Instagram de votre boutique · lu en direct chez Meta'}
          </span>
          <span className="grille__espace" />
          <a className="btn" href={cal.href} onClick={cal.onClick}>
            Voir le calendrier
          </a>
        </div>
      </div>
      {err ? <p className="error">{`Lecture impossible : ${err}`}</p> : null}

      <div className="grille__corps">
        <section className="card grille__profil">
          <div className="fig__profil">
            <img className="fig__photo" src={r.picture || INI} alt="" />
            <div className="fig__profil-nom">
              <span className="fig__handle">{`@${r.username || 'instagram'}`}</span>
              {r.name ? <span className="fig__nom">{r.name}</span> : null}
              <span className="muted fig__compte">
                <span className="fig__fort">{fmt(r.followers)}</span> abonnés · <span className="fig__fort">{medias.length}</span> en ligne ·{' '}
                <span className="fig__fort is-accent">{programmes.length}</span> programmé(s)
              </span>
            </div>
          </div>
          <div className="grille__profil-tete">
            <span className="muted grille__lu">{lu ? `Lu chez Instagram le ${dShort(lu.slice(0, 10))} à ${lu.slice(11, 16)}` : ''}</span>
            <span className="fig__liens">
              <a href={r.username ? `https://www.instagram.com/${r.username}/` : 'https://www.instagram.com/'} target="_blank" rel="noopener noreferrer">
                Ouvrir Instagram ↗
              </a>
              <button type="button" className="btn btn--sm" disabled={loading} onClick={charger}>
                {loading ? 'Lecture…' : 'Relire chez Instagram'}
              </button>
            </span>
          </div>
          {r.erreur ? <span className="grille__alerte">{r.erreur}</span> : null}
          {loading && !data ? <div className="muted grille__vide">Lecture du compte Instagram chez Meta…</div> : null}
          <div className="grille__cases">
            {raw.map((c, i) => {
              const p = c.p
              const first = c.sched && c.tile <= 0
              const pending = c.sched && p?.status === 'À valider'
              const badge = c.sched ? (first && p ? `${p.frise ? 'Frise · ' : ''}${when(p)}` : '') : c.m?.frise && c.m.frise.tile === 0 ? 'Frise publiée' : ''
              const alt = c.sched ? (p?.title ?? '') : c.m?.caption || 'Publication'
              const cls = ['grille__case', 'fig__case', c.sched ? 'is-prog' : 'is-ligne', pending ? 'is-attente' : '', estSel(c) ? 'is-sel' : ''].filter(Boolean).join(' ')
              const pied = !c.sched && (c.m?.likes != null || c.m?.comments != null) ? `${c.m?.likes != null ? `♥ ${fmt(c.m.likes)}` : ''}${c.m?.comments != null ? ` · ${fmt(c.m.comments)} comm.` : ''}` : ''
              return (
                <div
                  key={`${p?.id ?? c.m?.id ?? i}-${c.tile}`}
                  className={cls}
                  title={
                    c.sched && p
                      ? `${p.title} — programmé le ${dLabel(p.date)} à ${p.time}${p.frise ? ` · frise, case ${c.tile + 1}/3` : ''}`
                      : `${c.m?.caption || ''} — ${dLabel(String(c.m?.at ?? '').slice(0, 10))}`
                  }
                  onClick={() => setSel(c.sched && p ? { p: p.id } : c.m ? { m: c.m.id } : null)}
                >
                  {c.src ? <img src={media(c.src)} alt={alt} loading="lazy" /> : <span className="grille__texte">{alt}</span>}
                  {!c.sched && c.m?.video ? <span className="grille__video">▶</span> : null}
                  {badge ? <span className={`grille__badge${c.sched ? (p?.frise ? ' is-frise' : ' is-prog') : ''}`}>{badge}</span> : null}
                  {pending && first ? <span className="grille__drapeau">à valider</span> : null}
                  {pied ? <span className="fig__pied">{pied}</span> : null}
                </div>
              )
            })}
          </div>
          {!loading && !raw.length ? (
            <span className="muted grille__vide">{r.erreur ? 'Grille illisible pour l’instant.' : 'Rien de programmé, rien en ligne : la grille est vide.'}</span>
          ) : null}
        </section>

        <section className="grille__droite">
          {carte ? (
            <div className="card grille__sel">
              <span className="grille__sel-genre">{carte.kind}</span>
              <span className="grille__sel-titre">{carte.title}</span>
              <span>{carte.when}</span>
              {carte.stats ? <span>{carte.stats}</span> : null}
              <span className="muted grille__petit">{carte.help}</span>
              <div className="grille__actions">
                {carte.ouvrir ? (
                  <a
                    className="btn btn--sm btn--primary"
                    href={carte.ouvrir.href}
                    onClick={carte.ouvrir.onClick}
                    target={carte.ouvrir.target}
                    rel={carte.ouvrir.target ? 'noopener noreferrer' : undefined}
                  >
                    {carte.ouvrir.label}
                  </a>
                ) : null}
                <button type="button" className="btn btn--sm" onClick={() => setSel(null)}>
                  Fermer
                </button>
              </div>
            </div>
          ) : null}

          <Abonnes
              analyse={voirAnalyse}
              a={ab}
              loading={abLoading}
              err={abErr}
              reseau={reseau}
              medias={medias}
              followers={r.followers}
              hovJ={hovJ}
              setHovJ={setHovJ}
              hovP={hovP}
              setHovP={setHovP}
              choisir={(id) => {
                setSel({ m: id })
                setHovP(null)
              }}
            />

          <div className="card grille__bloc">
            <span className="grille__bloc-titre">Bientôt sur le profil</span>
            {!bientot.length ? <span className="muted grille__petit">Rien de programmé pour l’instant.</span> : null}
            {bientot.map((p) => (
              <button key={p.id} type="button" className="fig__bientot" onClick={() => setSel({ p: p.id })}>
                {(Array.isArray(p.frise) ? p.frise[0] : p.src) ? (
                  <img src={media(Array.isArray(p.frise) ? p.frise[0] : p.src)} alt="" />
                ) : (
                  <span className="fig__bientot-vide" />
                )}
                <span className="fig__bientot-corps">
                  <span className="fig__bientot-titre">{p.title}</span>
                  <span className="muted">{`${when(p)} · ${p.own ? 'votre post' : 'réseau'}${p.frise ? ' · frise' : ''}${p.status === 'À valider' ? ' · à valider' : ''}`}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="card grille__bloc">
            <span className="grille__bloc-titre">Légende</span>
            <div className="grille__legende-cases">
              <span>
                <span className="grille__ech is-prog" />
                Programmé
              </span>
              <span>
                <span className="grille__ech" />
                Déjà en ligne (lu chez Instagram)
              </span>
              <span>
                <span className="fig__legende-frise">Frise</span>3 posts qui forment une ligne
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * À droite de la grille : l'évolution des abonnés (le total d'aujourd'hui moins ce qui a changé ensuite), les gagnés /
 * perdus de chaque jour, les comptes touchés (30 jours, lus chez Meta) et les interactions des dernières publications de
 * la grille. Les jours de publication sont marqués d'un point noir.
 */
function Abonnes({
  analyse,
  a,
  loading,
  err,
  reseau,
  medias,
  followers,
  hovJ,
  setHovJ,
  hovP,
  setHovP,
  choisir,
}: {
  analyse: boolean
  a: AbonnesFranchise | null
  loading: boolean
  err: string
  reseau: boolean
  medias: MediaGrille[]
  followers?: number | null
  hovJ: Survol | null
  setHovJ: (h: Survol | null) => void
  hovP: Survol | null
  setHovP: (h: Survol | null) => void
  choisir: (id: string) => void
}) {
  const pubs: Record<string, MediaGrille[]> = {}
  medias.forEach((m) => {
    const d = String(m.at || '').slice(0, 10)
    ;(pubs[d] = pubs[d] ?? []).push(m)
  })
  const pubL = (d: string) => (pubs[d] ?? []).slice(0, 1).map((m) => `Publié : « ${String(m.caption || m.type || 'publication').replace(/\s+/g, ' ').slice(0, 50)} »`)
  const lu = String(a?.le ?? '')
  const tete = (
    <div className="grille__ab-tete">
      <span className="grille__bloc-titre">Abonnés · 30 derniers jours</span>
      <span className="muted grille__lu">{lu ? `lu chez Meta le ${dShort(lu.slice(0, 10))} à ${lu.slice(11, 16)}` : ''}</span>
    </div>
  )

  // Interactions (j'aime + commentaires) des 12 dernières publications, de la plus ancienne à la plus récente.
  const inter = medias.filter((m) => m.likes != null || m.comments != null).slice(0, 12).reverse()
  const interVals = inter.map((m) => (m.likes || 0) + (m.comments || 0))
  const moy = interVals.length ? interVals.reduce((t, v) => t + v, 0) / interVals.length : 0
  const abonnes = a?.followers || followers
  const interactions = inter.length ? (
    <div
      className="fig__clic"
      onClick={() => {
        if (hovP && hovP.k === 'int' && inter[hovP.i]) choisir(inter[hovP.i].id)
      }}
    >
      <Barres
        n={inter.length}
        titre={(i) => `${dLabel(String(inter[i].at).slice(0, 10))} · ${inter[i].type || 'Publication'}`}
        court={(i) => court(String(inter[i].at).slice(0, 10))}
        etiquettes={4}
        hov={hovP}
        setHov={setHovP}
        k="int"
        title="Interactions par publication"
        H={150}
        sub={`les ${inter.length} dernières · ${fmtG(moy)} en moyenne${abonnes ? ` (${fmtG((moy / abonnes) * 100, 1)} % des abonnés)` : ''} · un clic la montre dans la grille`}
        legend={[]}
        vide=""
        hauts={interVals}
        bas={null}
        lignes={(i) => [`♥ ${fmtG(inter[i].likes)} j’aime · ${fmtG(inter[i].comments)} commentaire(s)`, String(inter[i].caption || '').replace(/\s+/g, ' ').slice(0, 60)]}
      />
    </div>
  ) : null

  if (!analyse) return interactions
  let bloc: ReactNode = null
  if (err) bloc = <span className="grille__alerte">{`Abonnés illisibles pour l’instant : ${err}`}</span>
  else if (a?.message) bloc = <span className="grille__alerte">{a.message}</span>
  else if (loading && !a) bloc = <span className="muted grille__petit">Lecture des abonnés chez Meta…</span>
  if (bloc || !a || !a.du || !a.au) {
    return (
      <>
        <div className="card grille__bloc">
          {tete}
          {bloc}
        </div>
        {interactions}
      </>
    )
  }

  const days: string[] = []
  for (let d = a.du; d <= a.au && days.length < 400; d = addDays(d, 1)) days.push(d)
  const n = days.length
  const serie = a.serie ?? {}
  const perdus = a.perdus != null
  const gagnes = a.gagnes ?? 0
  const nPerdus = a.perdus ?? 0
  const marque = (i: number) => !!pubs[days[i]]
  const axe = { n, titre: (i: number) => dLabel(days[i]), court: (i: number) => court(days[i]), etiquettes: 4, hov: hovJ, setHov: setHovJ }
  const net = (d: string) => (serie[d] ? (+(serie[d].gagnes ?? 0) || 0) - (perdus ? +(serie[d].perdus ?? 0) || 0 : 0) : 0)
  // Le total jour par jour : seulement si Meta donne aussi les désabonnements (sinon la courbe serait fausse).
  const tot: (number | null)[] = days.map(() => null)
  if (a.followers != null && perdus) {
    tot[n - 1] = a.followers
    for (let i = n - 1; i > 0; i--) tot[i - 1] = (tot[i] as number) - net(days[i])
  }
  // Comptes touchés : les jours que Meta n'a pas encore comptés restent en blanc.
  const brut = days.map((d) => (a.reach && a.reach[d] != null ? +(a.reach[d] as number) : null))
  const bad = incomplets(brut)
  const vals = brut.map((v, i) => (bad[i] ? null : v))
  const ok = vals.filter((v): v is number => v != null)
  const kpis = [
    { label: 'Abonnés', value: fmtG(a.followers), sub: reseau ? 'compte du réseau' : 'compte de la boutique' },
    { label: 'Gagnés', value: a.gagnes != null ? `+${fmtG(a.gagnes)}` : '—', sub: 'nouveaux abonnés' },
    { label: perdus ? 'Net' : 'Perdus', value: perdus ? signe(gagnes - nPerdus) : '—', sub: perdus ? `−${fmtG(nPerdus)} désabonnements` : 'non donnés par Meta' },
  ]
  return (
    <>
      <div className="card grille__bloc">
        {tete}
        <div className="grille__kpis">
          {kpis.map((k) => (
            <div key={k.label} className="grille__kpi">
              <span className="grille__kpi-nom">{k.label}</span>
              <span className="grille__kpi-val">{k.value}</span>
              <span className="muted grille__kpi-sous" title={k.sub}>
                {k.sub}
              </span>
            </div>
          ))}
        </div>
        {reseau ? <span className="muted grille__petit">Compte commun à tout le réseau : ses abonnés ne sont pas ceux de votre seule boutique.</span> : null}
      </div>
      <Courbe
        {...axe}
        k="tot"
        title="Abonnés : évolution"
        serie="abonnés"
        zero={false}
        H={180}
        sub={`${fmtG(a.followers)} aujourd’hui${perdus ? ` · ${signe(gagnes - nPerdus)} en ${n} jours` : ''}`}
        vide={`${a.followers != null ? `${fmtG(a.followers)} abonnés aujourd’hui. ` : ''}${
          a.motif || 'Meta ne donne pas les désabonnements de ce compte : l’évolution du total ne peut pas être tracée.'
        }`}
        vals={tot}
        color={C.ig}
        marque={marque}
        lignes={(i) =>
          [
            `${fmtG(tot[i])} abonnés`,
            serie[days[i]]
              ? `+${fmtG(serie[days[i]].gagnes)}${perdus ? ` / −${fmtG(serie[days[i]].perdus)}` : ''} ce jour-là`
              : 'pas de chiffre ce jour-là',
          ].concat(pubL(days[i]))
        }
      />
      <Barres
        {...axe}
        k="gp"
        title={perdus ? 'Gagnés et perdus, jour par jour' : 'Nouveaux abonnés, jour par jour'}
        H={140}
        sub={`+${fmtG(a.gagnes)} gagnés${perdus ? `, −${fmtG(nPerdus)} perdus` : ''} sur ${n} jours`}
        legend={perdus ? [lg.barre(C.up, 'gagnés'), lg.barre(C.down, 'perdus')] : []}
        note={perdus ? '' : a.motif || ''}
        vide={a.motif || 'Meta ne partage pas encore l’historique des abonnés de ce compte.'}
        hauts={days.map((d) => (serie[d] ? +(serie[d].gagnes ?? 0) || 0 : null))}
        bas={perdus ? days.map((d) => (serie[d] ? +(serie[d].perdus ?? 0) || 0 : 0)) : null}
        lignes={(i) => {
          const x = serie[days[i]]
          if (!x) return ['pas de chiffre ce jour-là']
          const g = x.gagnes ?? 0
          const p = x.perdus ?? 0
          return [`+${fmtG(g)} gagnés`].concat(perdus ? [`${signe(-(+p || 0))} perdus`, `net ${signe(g - p)}`] : []).concat(pubL(days[i]))
        }}
      />
      <Courbe
        {...axe}
        k="reach"
        title="Comptes touchés, jour par jour"
        serie="comptes touchés"
        H={160}
        sub={ok.length ? `${fmtG(ok.reduce((t, v) => t + v, 0) / ok.length)} par jour en moyenne` : ''}
        note={plages(bad, days)}
        vide="Meta ne partage pas encore les comptes touchés de ce compte."
        vals={vals}
        color={C.ig}
        marque={marque}
        lignes={(i) => [`${fmtG(brut[i])} comptes touchés${bad[i] ? ' — chiffre incomplet chez Meta' : ''}`].concat(pubL(days[i]))}
      />
      {interactions}
    </>
  )
}
