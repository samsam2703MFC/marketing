import { useEffect, useRef, useState } from 'react'
import '../social/social.css'
import './suivifranchise.css'
import { addDays, dLabel, dShort } from '../../lib/social/format'
import { aller, calendrier, lien, suivi, texteErreur, useFranchise } from './_donnees'
import type { Naviguer, PostMetaFranchise, VueSuivi } from './_donnees'

/**
 * Suivi de ma boutique — l'onglet « Suivi » de « Mes réseaux » de l'espace franchisé (social/franchisee/Calendrier.dc.html,
 * `?vue=suivi` ; Suivi.dc.html n'y renvoyait plus que par une redirection), réécrit dans le Marketing comme une page à part.
 * Les abonnés gagnés et perdus de la Page de la boutique, jour par jour, face au budget publicitaire du réseau et à ses
 * publications (lues chez Meta et publiées depuis l'espace) sur la même période (social/src/suivi.php).
 *
 * Adresse : `?jours=7|28|90` (période, 28 par défaut).
 */

interface Props {
  /** Suivre un lien vers une autre page de l'espace (le calendrier sur un jour, « Publier un post »). Sans elle, le lien change l'adresse. */
  onNaviguer?: Naviguer
}

type Jours = 7 | 28 | 90
const PERIODES: Jours[] = [7, 28, 90]
const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`)

function joursDeDepart(): Jours {
  const j = Number(new URLSearchParams(window.location.search).get('jours'))
  return ([7, 28, 90].includes(j) ? j : 28) as Jours
}

export default function SuiviFranchiseView({ onNaviguer }: Props) {
  const { etat, erreur } = useFranchise()
  const [jours, setJours] = useState<Jours>(joursDeDepart)
  const [sv, setSv] = useState<VueSuivi | null>(null)
  const [svLoading, setSvLoading] = useState(false)
  const [svErr, setSvErr] = useState('')
  const [meta, setMeta] = useState<PostMetaFranchise[]>([])
  const cache = useRef<Record<number, VueSuivi>>({})
  const cacheMeta = useRef<Record<string, PostMetaFranchise[]>>({})

  const today = etat?.today ?? ''
  const au = today ? addDays(today, -1) : ''
  const du = au ? addDays(au, -(jours - 1)) : ''

  // L'adresse garde la période : un lien partagé rouvre le même suivi.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('jours', String(jours))
      if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u.toString())
    } catch {
      /* rien */
    }
  }, [jours])

  useEffect(() => {
    if (!today || etat?.rules?.voirSuivi === false) return
    let vivant = true
    if (cache.current[jours]) {
      setSv(cache.current[jours])
      setSvErr('')
    } else {
      setSvLoading(true)
      setSvErr('')
      suivi(jours)
        .then((r) => {
          cache.current[jours] = r
          if (!vivant) return
          setSv(r)
          setSvLoading(false)
        })
        .catch((e: unknown) => {
          if (!vivant) return
          setSvLoading(false)
          setSvErr(texteErreur(e))
        })
    }
    // Les publications de la Page sur la même période, lues chez Meta (comme le calendrier).
    const k = `${du}_${au}`
    if (cacheMeta.current[k]) setMeta(cacheMeta.current[k])
    else
      calendrier(du, au)
        .then((r) => {
          cacheMeta.current[k] = r.posts ?? []
          if (vivant) setMeta(r.posts ?? [])
        })
        .catch(() => {
          if (vivant) setMeta([])
        })
    return () => {
      vivant = false
    }
  }, [today, jours, du, au, etat?.rules?.voirSuivi])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const masque = etat.rules?.voirSuivi === false
  const publierLien = lien(onNaviguer, 'pub')
  const message = String(etat.rules?.message ?? '').trim()

  const entete = (
    <div className="filters">
      <div className="filters__row">
        <span className="muted social-native__periode">{`Suivi · L’Atelier By ${etat.shop.name} · vos abonnés, vos publications et les publicités du réseau`}</span>
        <span className="media__spacer" />
        {!masque ? (
          <>
            <span className="muted fsv__du">{du && au ? `du ${dShort(du)} au ${dShort(au)}` : ''}</span>
            <div className="seg" role="group" aria-label="Période">
              {PERIODES.map((j) => (
                <button key={j} type="button" className={jours === j ? 'is-on' : ''} aria-pressed={jours === j} onClick={() => setJours(j)}>
                  {`${j} j`}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <a className="btn btn--primary" href={publierLien.href} onClick={publierLien.onClick}>
          Publier un post
        </a>
      </div>
    </div>
  )

  if (masque)
    return (
      <div className="social-native fsv">
        {entete}
        <div className="card fsv__info">Le réseau ne partage pas le suivi de la boutique dans cet espace.</div>
      </div>
    )

  const x = sv?.lignes?.[0]
  let corps
  if (svErr) corps = <div className="card fsv__info">{`Suivi illisible pour l’instant : ${svErr}`}</div>
  else if (svLoading && !sv) corps = <div className="card fsv__info">Lecture de votre Page chez Meta…</div>
  else if (!sv || !x || !sv.du || !sv.au) corps = sv ? <div className="card fsv__info">{sv.message || 'Aucune donnée pour votre boutique.'}</div> : null
  else corps = <Graphe r={sv} ligne={x} meta={meta} posts={etat.posts ?? []} ouvrir={(d) => aller(onNaviguer, 'cal', `vue=semaine&date=${d}`)} />

  return (
    <div className="social-native fsv">
      {entete}
      {message ? <div className="fsv__message">{message}</div> : null}
      {corps}
    </div>
  )
}

function Graphe({
  r,
  ligne: x,
  meta,
  posts,
  ouvrir,
}: {
  r: VueSuivi
  ligne: NonNullable<VueSuivi['lignes']>[number]
  meta: PostMetaFranchise[]
  posts: { date: string; status: string; fb?: boolean; title?: string; type?: string }[]
  ouvrir: (d: string) => void
}) {
  const devise = r.devise || 'EUR'
  const money = (v: number | null | undefined, d = 0) => `${fmt(v, d)}${devise === 'EUR' ? ' €' : ` ${devise}`}`
  const col = (n: number | null | undefined) => (n == null ? 'is-neutre' : n > 0 ? 'is-bon' : n < 0 ? 'is-alerte' : '')
  const fb = x.facebook ?? {}
  const ig = x.instagram ?? null
  const dep = x.depenseJours ?? {}
  const du = r.du as string
  const au = r.au as string
  const days: string[] = []
  for (let d = du; d <= au && days.length < 400; d = addDays(d, 1)) days.push(d)

  // Les publications de la Page, par jour : lues chez Meta, et celles parties depuis l'espace (le module).
  const pubs: Record<string, string[]> = {}
  meta
    .filter((p) => p.channel === 'Facebook' && p.status === 'Publié')
    .map((p) => ({ date: p.date, t: p.title || p.type || 'Publication' }))
    .concat(posts.filter((p) => p.status === 'Publié' && p.fb).map((p) => ({ date: p.date, t: p.title || p.type || 'Publication' })))
    .forEach((p) => {
      if (p.date >= du && p.date <= au) (pubs[p.date] = pubs[p.date] ?? []).push(p.t)
    })
  const flow = (d: string) => {
    const f = fb.serie?.[d]
    const i = ig?.serie?.[d]
    return f || i ? { g: (f?.gagnes ?? 0) + (i?.gagnes ?? 0), p: f?.perdus ?? 0 } : null
  }
  const maxS = Math.max(1, ...Object.values(dep))
  const maxF = Math.max(
    1,
    ...days.map((d) => {
      const v = flow(d)
      return v ? Math.max(v.g, v.p) : 0
    }),
  )
  const ds = days.map((d) => {
    const v = dep[d] || 0
    const fl = flow(d)
    const n = (pubs[d] ?? []).length
    return {
      d,
      v,
      fl,
      n,
      spendH: Math.round((v / maxS) * 110),
      upH: fl ? Math.round((fl.g / maxF) * 34) : 0,
      downH: fl ? Math.round((fl.p / maxF) * 28) : 0,
      pubW: n ? Math.min(13, 5 + n * 2) : 0,
      tip:
        `${dLabel(d)} · budget ${money(v, 2)}` +
        (fl ? ` · +${fl.g} / −${fl.p} abonnés` : ' · abonnés non mesurés') +
        (n ? ` · ${n} publication(s) : ${(pubs[d] ?? []).join(' · ')}` : ' · aucune publication'),
    }
  })
  const moy = (a: typeof ds) => (a.length ? a.reduce((t, d) => t + (d.fl ? d.fl.g - d.fl.p : 0), 0) / a.length : null)
  const mA = moy(ds.filter((d) => d.v > 0 && d.fl))
  const mS = moy(ds.filter((d) => d.v === 0 && d.fl))
  const mP = moy(ds.filter((d) => d.n > 0 && d.fl))
  const mN = moy(ds.filter((d) => d.n === 0 && d.fl))
  const constats = [
    mA == null && mS == null
      ? 'Les abonnés jour par jour ne sont pas encore disponibles : le total actuel et le budget s’affichent.'
      : `Les jours avec publicité, votre boutique gagne ${mA == null ? '—' : fmt(mA, 1)} abonnés par jour ; sans publicité, ${mS == null ? '—' : fmt(mS, 1)}.` +
        (mA != null && mS != null && mA > mS ? ` La publicité vous apporte ${fmt(mA - mS, 1)} abonnés de plus par jour.` : ''),
  ].concat(
    mP != null && mN != null
      ? [
          `Les jours où votre Page publie : ${fmt(mP, 1)} abonnés nets en moyenne ; les autres jours : ${fmt(mN, 1)}.` +
            (mP > mN ? ` Publier vous fait gagner ${fmt(mP - mN, 1)} abonné(s) de plus par jour.` : ''),
        ]
      : [],
  )
  const nPubs = Object.values(pubs).reduce((t, l) => t + l.length, 0)
  const kpis = [
    {
      label: 'Facebook',
      value: fmt(fb.followers),
      sub: fb.net == null ? 'abonnés' : `abonnés · +${fmt(fb.gagnes)} / −${fmt(fb.perdus)} sur ${r.jours} j`,
      ton: '',
    },
    { label: `Gagnés nets · ${r.jours} j`, value: signed(x.abonnesNet), sub: ig ? 'Facebook + Instagram' : 'Page Facebook de la boutique', ton: col(x.abonnesNet) },
    { label: 'Publications de ma Page', value: fmt(nPubs), sub: `${Object.keys(pubs).length} jour(s) avec publication · ${r.jours} j`, ton: 'is-fb' },
    { label: 'Budget publicitaire', value: money(x.depense), sub: `${Object.keys(dep).length} jour(s) de diffusion`, ton: '' },
    { label: 'Coût par abonné', value: x.coutParAbonne == null ? '—' : money(x.coutParAbonne, 2), sub: 'budget ÷ abonnés nets', ton: '' },
  ]
  const motifs = [fb.motif, ig?.motif].filter(Boolean).concat(r.erreurs ?? [])

  return (
    <>
      <div className="fsv__kpis">
        {kpis.map((k) => (
          <div key={k.label} className="card fsv__kpi">
            <span className="fsv__kpi-nom">{k.label}</span>
            <span className={`fsv__kpi-val ${k.ton}`}>{k.value}</span>
            <span className="muted fsv__kpi-sous">{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="card fsv__graphe">
        <div className="fsv__graphe-tete">
          <span
            className="fsv__graphe-titre"
            title="Chiffres lus en direct chez Meta pour la Page Facebook de votre boutique ; les publications sont celles de votre calendrier (lues chez Meta et publiées depuis cet espace). Le budget est celui des publicités du réseau qui mettent votre boutique en avant. Un clic sur un jour l’ouvre au calendrier."
          >
            Jour par jour
          </span>
          <span className="fsv__legende">
            <span>
              <span className="fsv__carre is-budget" />
              budget publicitaire
            </span>
            <span>
              <span className="fsv__carre is-pub" />
              publications de la Page
            </span>
            <span>
              <span className="fsv__carre is-gagne" />
              abonnés gagnés
            </span>
            <span>
              <span className="fsv__carre is-perdu" />
              perdus
            </span>
          </span>
        </div>
        <div className="fsv__trace">
          <div className="fsv__rang fsv__rang--budget">
            {ds.map((d) => (
              <button key={d.d} type="button" className="fsv__col" title={d.tip} onClick={() => ouvrir(d.d)}>
                <span className="fsv__budget" style={{ height: d.spendH }} />
              </button>
            ))}
          </div>
          <div className="fsv__rang fsv__rang--pubs">
            {ds.map((d) => (
              <button key={d.d} type="button" className="fsv__col" title={d.tip} onClick={() => ouvrir(d.d)}>
                {d.pubW ? <span className="fsv__pub" style={{ width: d.pubW, height: d.pubW }} /> : null}
              </button>
            ))}
          </div>
          <div className="fsv__rang fsv__rang--flux">
            {ds.map((d) => (
              <button key={d.d} type="button" className="fsv__col" title={d.tip} onClick={() => ouvrir(d.d)}>
                <span className="fsv__gagne" style={{ height: d.upH }} />
                <span className="fsv__perdu" style={{ height: d.downH }} />
              </button>
            ))}
          </div>
          <div className="muted fsv__axe">
            <span>{dShort(du)}</span>
            <span>{dShort(au)}</span>
          </div>
        </div>
        {constats.map((t) => (
          <span key={t} className="fsv__constat">
            {t}
          </span>
        ))}
        {motifs.length ? <span className="fsv__motif">{motifs.join(' · ')}</span> : null}
      </div>
    </>
  )
}
