import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as PointerEventReact } from 'react'
import './social.css'
import './controle.css'
import { useSocial, boutiquesReseau, parId } from '../../lib/social/store'
import { addDays, dLabel, dShort, iso } from '../../lib/social/format'
import { avatarSocial, lireCalendriers } from '../../lib/social/api-controle'

/**
 * Contrôle des posts — l'écran « Contrôle » du module Social (SA Controle.dc.html), réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Maquette à valider : les posts sont les vrais, déjà publiés sur les Pages des
 * boutiques (lus en direct chez Meta, comme le Calendrier) ; le verdict, les annotations et le « mail » restent
 * dans l'onglet (sessionStorage, rien n'est envoyé ni enregistré).
 */

type Point = [number, number]
type Marque =
  | { kind: 'pen'; pts: Point[]; note: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; note: string }
type EnCours =
  | { kind: 'pen'; pts: Point[]; note: string }
  | { kind: 'rect'; x0: number; y0: number; x: number; y: number; w: number; h: number; note: string }

type Statut = 'À contrôler' | 'Non conforme' | 'Conforme'
interface Tache {
  at: string
  seen: string | null
  fixed: string | null
  sev: string
  to: string
}
interface Verdict {
  status?: Statut
  marks?: Marque[]
  rules?: Record<string, boolean | undefined>
  task?: Tache
}

interface Pub {
  id: string
  shop: string
  title: string
  img: string
  date: string
  time: string
  channel: string
  text: string
  link: string
  account: string
  origin: string
}

type Onglet = 'todo' | 'ko' | 'ok'
type Outil = 'pen' | 'rect'
type Gravite = 'mineure' | 'majeure' | 'bloquante'
type Action = 'corriger' | 'supprimer' | 'info'

const ONGLET: Record<Onglet, Statut> = { todo: 'À contrôler', ko: 'Non conforme', ok: 'Conforme' }
const LIBELLE_ONGLET: Record<Onglet, string> = { todo: 'À contrôler', ko: 'Non conformes', ok: 'Conformes' }
const CLASSE_STATUT: Record<Statut, string> = { 'À contrôler': 'is-todo', 'Non conforme': 'is-ko', Conforme: 'is-ok' }
const REGLES: [string, string][] = [
  ['logo', 'Logo et couleurs de la marque'],
  ['typo', 'Typographies de la charte'],
  ['prix', 'Prix et promotions dans les règles du réseau'],
  ['photo', 'Photo nette et bien cadrée'],
  ['ton', 'Ton et orthographe'],
  ['liens', 'Pas de lien ni de mention externe'],
]
const GRAVITE: Record<Gravite, string> = { mineure: 'Mineure', majeure: 'Majeure', bloquante: 'Bloquante' }
const ACTION: Record<Action, string> = { corriger: 'corriger', supprimer: 'supprimer', info: 'lire' }
const ROUGE = '#E0151B'
const CLE_VERDICTS = 'sa.ctrl.v'

function lireVerdicts(): Record<string, Verdict> {
  try {
    return (JSON.parse(sessionStorage.getItem(CLE_VERDICTS) || '{}') as Record<string, Verdict>) || {}
  } catch {
    return {}
  }
}

/** Venu du Calendrier (« Contrôler → » dans la fiche d'un post publié) : ce post s'ouvre directement. */
function lireVenuDuCalendrier(): Pub | null {
  try {
    const x = JSON.parse(sessionStorage.getItem('sa.ctrl') || 'null') as Pub | null
    if (x && x.id) {
      sessionStorage.removeItem('sa.ctrl')
      return x
    }
  } catch {
    /* rien */
  }
  return null
}

/** Dessin : traits rouges (stylo), carrés rouges, numéro de chaque annotation dans une pastille. */
function peindre(ctx: CanvasRenderingContext2D, W: number, H: number, marques: Marque[] | undefined, cur: EnCours | null) {
  const k = W / 520
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const toutes: [Marque | EnCours, number][] = (marques ?? []).map((m, i) => [m, i + 1] as [Marque, number])
  if (cur) toutes.push([cur, (marques ?? []).length + 1])
  for (const [m, n] of toutes) {
    ctx.strokeStyle = ROUGE
    ctx.lineWidth = Math.max(2, 3.5 * k)
    let ax: number
    let ay: number
    if (m.kind === 'pen') {
      const p = m.pts
      if (!p.length) continue
      ctx.beginPath()
      p.forEach(([x, y], j) => {
        const X = (x / 100) * W
        const Y = (y / 100) * H
        if (j) ctx.lineTo(X, Y)
        else ctx.moveTo(X, Y)
      })
      ctx.stroke()
      ax = (p[0][0] / 100) * W
      ay = (p[0][1] / 100) * H
    } else {
      const X = (m.x / 100) * W
      const Y = (m.y / 100) * H
      const w = (m.w / 100) * W
      const h = (m.h / 100) * H
      ctx.fillStyle = 'rgba(224,21,27,0.08)'
      ctx.fillRect(X, Y, w, h)
      ctx.strokeRect(X, Y, w, h)
      ax = X
      ay = Y
    }
    const r = Math.max(9, 12 * k)
    ax = Math.min(Math.max(ax, r + 2), W - r - 2)
    ay = Math.min(Math.max(ay, r + 2), H - r - 2)
    ctx.beginPath()
    ctx.arc(ax, ay, r, 0, Math.PI * 2)
    ctx.fillStyle = ROUGE
    ctx.fill()
    ctx.lineWidth = Math.max(1.5, 2 * k)
    ctx.strokeStyle = '#FFFFFF'
    ctx.stroke()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(n), ax, ay + 0.5)
  }
}

export default function ControleView() {
  const { chargement, erreur, serveur, etat } = useSocial()
  const today = serveur?.today ?? iso(new Date())
  const pret = chargement === 'pret' && !!etat

  const [jours, setJours] = useState<7 | 30 | 90>(30)
  const [posts, setPosts] = useState<Pub[] | null>(null)
  const [err, setErr] = useState('')
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(lireVerdicts)
  const venu = useRef<Pub | null | undefined>(undefined)
  const [selId, setSelId] = useState<string | null>(() => {
    if (venu.current === undefined) venu.current = lireVenuDuCalendrier()
    return venu.current?.id ?? null
  })
  const [outil, setOutil] = useState<Outil>('rect')
  const [onglet, setOnglet] = useState<Onglet>('todo')
  const [fShops, setFShops] = useState<string[]>([])
  const [pics, setPics] = useState<Record<string, string>>({})
  const [sev, setSev] = useState<Gravite>('majeure')
  const [due, setDue] = useState('')
  const [action, setAction] = useState<Action>('corriger')
  const [msgSaisi, setMsg] = useState('')
  const [to, setTo] = useState('')
  const [toast, setToast] = useState('')
  const [pvOpen, setPvOpen] = useState(false)
  const [annotated, setAnnotated] = useState('')

  const cv = useRef<HTMLCanvasElement | null>(null)
  const cur = useRef<EnCours | null>(null)
  const cle = useRef(0)
  const tt = useRef<number | undefined>(undefined)
  const etatRef = useRef(etat)
  etatRef.current = etat

  // À corriger avant : trois jours après la journée du serveur.
  useEffect(() => {
    if (serveur?.today) setDue((d) => d || addDays(serveur.today, 3))
  }, [serveur?.today])

  const annoncer = useCallback((m: string) => {
    window.clearTimeout(tt.current)
    setToast(m)
    tt.current = window.setTimeout(() => setToast(''), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(tt.current), [])

  /** Les publications des boutiques sur la période : Pages lues chez Meta + posts publiés depuis l'espace franchisé. */
  useEffect(() => {
    if (!pret) return
    const au = today
    const du = addDays(au, -(jours - 1))
    const k = ++cle.current
    setPosts(null)
    setErr('')
    lireCalendriers(du, au)
      .then((r) => {
        if (k !== cle.current) return
        const meta: Pub[] = (r.posts ?? [])
          .filter((p) => p.status === 'Publié' && !p.marque && (p.shops ?? []).length === 1)
          .map((p) => ({
            id: p.id,
            shop: (p.shops ?? [])[0],
            title: p.title,
            img: p.img ?? '',
            date: p.date,
            time: p.time ?? '',
            channel: p.channel,
            text: p.text ?? '',
            link: p.permalink ?? '',
            account: p.accountName ?? '',
            origin: 'Publié sur la Page',
          }))
        const fr: Pub[] = (etatRef.current?.posts ?? [])
          .filter((p) => p.origin === 'franchise' && p.status === 'Publié' && String(p.date) >= du && String(p.date) <= au)
          .map((p) => ({
            id: p.id,
            shop: String((p.shops === 'all' ? [] : ((p.shops as string[] | undefined) ?? []))[0] ?? ''),
            title: String(p.title ?? ''),
            img: String(p.img ?? ''),
            date: String(p.date ?? ''),
            time: String(p.time ?? ''),
            channel: p.fb ? 'Facebook' : 'Instagram',
            text: String(p.text ?? ''),
            link: '',
            account: '',
            origin: 'Espace franchisé',
          }))
          .filter((p) => p.shop)
        const tous = meta.concat(fr).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
        const v = venu.current
        if (v && !tous.some((p) => p.id === v.id)) tous.unshift(v)
        // Photo de profil de la Page de chaque boutique (pastilles).
        const p2: Record<string, string> = {}
        for (const c of r.comptes ?? []) {
          if (c.type === 'facebook' && c.shop && c.shop !== 'marque' && c.picture && !p2[c.shop]) p2[c.shop] = c.picture
        }
        const errs = (r.erreurs ?? [])
          .map(String)
          .filter((e) => !/programmés/.test(e))
          .map((e) => `Illisible : ${e}`)
          .join(' · ')
        setPosts(tous)
        setPics(p2)
        setErr(errs)
        setSelId((s) => {
          if (s && tous.some((p) => p.id === s)) return s
          const vs = lireVerdicts()
          return (tous.find((p) => !vs[p.id]?.status) ?? tous[0])?.id ?? null
        })
      })
      .catch((e: unknown) => {
        if (k !== cle.current) return
        setPosts([])
        setErr(`Publications illisibles : ${e instanceof Error ? e.message : 'erreur'}`)
      })
  }, [pret, jours, today])

  const liste = posts ?? []
  const sel = liste.find((x) => x.id === selId) ?? null
  const ver = (id: string): Verdict => verdicts[id] ?? {}
  const v = sel ? ver(sel.id) : {}
  const stOf = (p: Pub): Statut => ver(p.id).status ?? 'À contrôler'

  const upd = useCallback(
    (patch: Partial<Verdict>) => {
      if (!selId) return
      setVerdicts((s) => {
        const suite = { ...s, [selId]: { ...(s[selId] ?? {}), ...patch } }
        try {
          sessionStorage.setItem(CLE_VERDICTS, JSON.stringify(suite))
        } catch {
          /* rien */
        }
        return suite
      })
    },
    [selId],
  )

  const marquesSel = v.marks
  const redraw = useCallback(() => {
    const c = cv.current
    if (!c || !sel) return
    const r = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (!r.width) return
    const W = Math.round(r.width * dpr)
    const H = Math.round(r.height * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    peindre(ctx, W, H, marquesSel, cur.current)
  }, [sel, marquesSel])

  useLayoutEffect(() => {
    redraw()
  })
  useEffect(() => {
    window.addEventListener('resize', redraw)
    return () => window.removeEventListener('resize', redraw)
  }, [redraw])

  const pos = (e: PointerEventReact<HTMLCanvasElement>): Point => {
    const r = cv.current!.getBoundingClientRect()
    const c = (x: number) => Math.round(Math.min(100, Math.max(0, x)) * 10) / 10
    return [c(((e.clientX - r.left) / r.width) * 100), c(((e.clientY - r.top) / r.height) * 100)]
  }
  const tache = v.task

  const down = (e: PointerEventReact<HTMLCanvasElement>) => {
    if (tache || !sel) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const [x, y] = pos(e)
    cur.current = outil === 'pen' ? { kind: 'pen', pts: [[x, y]], note: '' } : { kind: 'rect', x0: x, y0: y, x, y, w: 0, h: 0, note: '' }
    redraw()
  }
  const move = (e: PointerEventReact<HTMLCanvasElement>) => {
    const c = cur.current
    if (!c) return
    const [x, y] = pos(e)
    if (c.kind === 'pen') {
      const l = c.pts[c.pts.length - 1]
      if (Math.abs(l[0] - x) + Math.abs(l[1] - y) >= 0.4) c.pts.push([x, y])
    } else {
      c.x = Math.min(c.x0, x)
      c.y = Math.min(c.y0, y)
      c.w = Math.abs(x - c.x0)
      c.h = Math.abs(y - c.y0)
    }
    redraw()
  }
  const up = () => {
    const c = cur.current
    if (!c) return
    cur.current = null
    const ok = c.kind === 'pen' ? c.pts.length > 2 : c.w > 2 && c.h > 2
    if (!ok) {
      redraw()
      return
    }
    const m: Marque = c.kind === 'pen' ? { kind: 'pen', pts: c.pts, note: '' } : { kind: 'rect', x: c.x, y: c.y, w: c.w, h: c.h, note: '' }
    upd({ marks: (v.marks ?? []).concat(m) })
  }

  // Calque des annotations pour l'aperçu du mail, posé sur la photo. Les photos Meta (CDN sans CORS) ne peuvent pas
  // être aplaties dans le navigateur : à l'envoi réel, le serveur incruste les annotations (GD, comme les rapports du BO).
  const aplatir = () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 1000
    const ctx = c.getContext('2d')
    if (ctx) peindre(ctx, 800, 1000, v.marks, null)
    return c.toDataURL('image/png')
  }

  const shops = etat?.shops ?? []
  const reseau = etat ? boutiquesReseau(etat) : []
  const nomBoutique = (id: string) => parId(shops, id)?.name ?? (id || '?')
  const inShops = (x: Pub) => !fShops.length || fShops.includes(x.shop)
  const visibles = liste.filter((x) => inShops(x) && stOf(x) === ONGLET[onglet])
  const compte = (st: Statut) => liste.filter((x) => inShops(x) && stOf(x) === st).length

  // Par boutique, sur la période : publiés, contrôlés, non conformes (verdicts de la maquette).
  const historique = (() => {
    const st = stOf
    const par = reseau
      .map((sh) => {
        const ps = liste.filter((p) => p.shop === sh.id)
        const ko = ps.filter((p) => st(p) === 'Non conforme').length
        const ok = ps.filter((p) => st(p) === 'Conforme').length
        return { id: sh.id, name: sh.name, total: ps.length, ko, ok, todo: ps.length - ko - ok }
      })
      .filter((h) => h.total)
    const maxT = Math.max(1, ...par.map((h) => h.total))
    return par.sort((a, b) => b.total - a.total).map((h) => ({ ...h, maxT }))
  })()

  const shopsIn = [...new Set(liste.map((p) => p.shop))]
  const boutique = sel ? nomBoutique(sel.shop) : ''
  const msg = !sel
    ? ''
    : msgSaisi ||
      `Bonjour,\n\nVotre publication du ${dShort(sel.date)} sur ${sel.channel} ne respecte pas la charte du réseau. Les points à revoir sont entourés en rouge sur le visuel ci-dessous.\n\nMerci de ${
        action === 'supprimer' ? 'la supprimer' : action === 'info' ? 'en tenir compte pour vos prochaines publications' : 'la corriger'
      } avant le ${dShort(due)}.\n\nL’équipe communication du réseau`
  const marques = v.marks ?? []
  const lignesRegles = REGLES.filter(([k]) => v.rules?.[k] === false).map(([, l]) => `✕ ${l}`)

  const choisir = (id: string) => {
    cur.current = null
    setSelId(id)
    setMsg('')
    setPvOpen(false)
  }
  const apercu = () => {
    if (!marques.length) {
      annoncer('Annotez au moins un point (stylo ou carré rouge) avant de valider.')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to || '')) {
      annoncer('Renseignez l’adresse mail de la boutique.')
      return
    }
    setAnnotated(aplatir())
    setPvOpen(true)
  }
  const envoyer = () => {
    const now = new Date()
    upd({
      status: 'Non conforme',
      task: {
        at: `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        seen: null,
        fixed: null,
        sev: GRAVITE[sev].toLowerCase(),
        to,
      },
    })
    setPvOpen(false)
    annoncer(`Maquette : mail prêt à partir vers ${to} (rien n’est envoyé).`)
  }

  const imgDe = (x: Pub) => x.img || avatarSocial(nomBoutique(x.shop), 'facebook')

  if (chargement === 'erreur') return <p className="error">Le module Social ne répond pas : {erreur}</p>

  return (
    <div className="social-native ctrl">
      <div className="ctrl__maquette">
        Maquette à valider : rien n’est envoyé ni enregistré. Les posts sont les vrais, déjà publiés sur les Pages des boutiques (lus en direct chez
        Meta) : ouvrez-en un, annotez au stylo ou au carré rouge, puis validez et envoyez la non-conformité par mail.
      </div>

      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">Communication des boutiques · respect de la charte du réseau</span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période">
            {([7, 30, 90] as const).map((j) => (
              <button key={j} type="button" className={jours === j ? 'is-on' : ''} aria-pressed={jours === j} onClick={() => jours !== j && setJours(j)}>
                {j} j
              </button>
            ))}
          </div>
          {(Object.keys(ONGLET) as Onglet[]).map((k) => (
            <button key={k} type="button" className={`filter ctrl__onglet ctrl__onglet--${k}${onglet === k ? ' is-on' : ''}`} onClick={() => setOnglet(k)}>
              <span className="dot" />
              {LIBELLE_ONGLET[k]} ({compte(ONGLET[k])})
            </button>
          ))}
        </div>
      </div>

      {/* Boutiques : une pastille par boutique (photo de sa Page), filtre à sélection multiple */}
      <div className="card ctrl__boutiques">
        <span className="ctrl__kicker">Boutiques</span>
        <button type="button" className={`ctrl__chip${!fShops.length ? ' is-on' : ''}`} onClick={() => setFShops([])}>
          Toutes <span className="ctrl__chip-n">{liste.filter((x) => stOf(x) === ONGLET[onglet]).length}</span>
        </button>
        {reseau
          .filter((x) => shopsIn.includes(x.id))
          .map((sh) => {
            const on = fShops.includes(sh.id)
            const mine = liste.filter((p) => p.shop === sh.id)
            const ko = mine.filter((p) => stOf(p) === 'Non conforme').length
            return (
              <button
                key={sh.id}
                type="button"
                className={`ctrl__chip ctrl__chip--avatar${on ? ' is-on' : ''}${fShops.length && !on ? ' is-pale' : ''}`}
                title={`${sh.name} · ${mine.length} publication(s) sur la période${ko ? `, ${ko} non conforme(s)` : ''} — cliquer pour filtrer (plusieurs possibles)`}
                onClick={() => setFShops(on ? fShops.filter((x) => x !== sh.id) : fShops.concat(sh.id))}
              >
                <span className="ctrl__avatar">
                  <img src={pics[sh.id] || avatarSocial(sh.name, 'facebook')} alt="" />
                  {ko > 0 ? <span className="ctrl__avatar-ko">{ko}</span> : null}
                </span>
                <span className="ctrl__chip-nom">{sh.name}</span>
                <span className="ctrl__chip-n">{mine.filter((p) => stOf(p) === ONGLET[onglet]).length}</span>
              </button>
            )
          })}
      </div>

      <div className="ctrl__corps">
        {/* File des posts à contrôler */}
        <aside className="ctrl__file">
          {posts === null ? <span className="ctrl__note">Lecture des publications des boutiques chez Meta…</span> : null}
          {err ? <span className="ctrl__note is-erreur">{err}</span> : null}
          {posts !== null && !visibles.length ? (
            <span className="ctrl__note">{liste.length ? 'Rien dans cet onglet.' : `Aucune publication des boutiques sur les ${jours} derniers jours.`}</span>
          ) : null}
          {visibles.map((x) => {
            const st = stOf(x)
            const choisi = sel?.id === x.id
            return (
              <button key={x.id} type="button" className={`ctrl__item${choisi ? ' is-on' : ''}`} onClick={() => choisir(x.id)}>
                <img src={imgDe(x)} alt="" />
                <span className="ctrl__item-corps">
                  <span className="ctrl__item-titre">{x.title}</span>
                  <span className="muted ctrl__item-meta">
                    {nomBoutique(x.shop)} · {dShort(x.date)} {x.time} · {x.channel}
                  </span>
                  <span className="ctrl__tags">
                    <span className={`ctrl__st ${CLASSE_STATUT[st]}`}>{st}</span>
                    <span className="ctrl__st">{x.origin}</span>
                  </span>
                </span>
              </button>
            )
          })}
          <span className="muted ctrl__source">
            Publications déjà en ligne sur les Pages Facebook des boutiques, lues en direct chez Meta ({liste.length} sur {jours} jours), et posts publiés
            depuis l’espace franchisé. Aussi depuis le Calendrier : « Contrôler → » dans la fiche d’un post publié.
          </span>
        </aside>

        {posts !== null && !sel ? <div className="card ctrl__vide">Choisissez une publication à gauche.</div> : null}

        {sel ? (
          <>
            {/* Post et annotations */}
            <section className="card ctrl__post">
              <div className="ctrl__post-tete">
                <div className="ctrl__post-titre">
                  <span>{sel.title}</span>
                  <span className="muted">
                    {boutique}
                    {sel.account ? ` · Page « ${sel.account} »` : ''} · {sel.channel} · {dLabel(sel.date)} à {sel.time} · {sel.origin}
                  </span>
                </div>
                <div className="seg" role="group" aria-label="Outils d’annotation">
                  <button type="button" className={outil === 'pen' ? 'is-on' : ''} title="Dessinez à main levée sur le visuel" onClick={() => setOutil('pen')}>
                    ✎ Stylo
                  </button>
                  <button type="button" className={outil === 'rect' ? 'is-on' : ''} title="Glissez pour encadrer une zone" onClick={() => setOutil('rect')}>
                    ▢ Carré rouge
                  </button>
                  <button type="button" title="Retire la dernière annotation" onClick={() => upd({ marks: marques.slice(0, -1) })}>
                    ↶ Annuler
                  </button>
                  <button type="button" title="Retire toutes les annotations" onClick={() => upd({ marks: [] })}>
                    Effacer
                  </button>
                </div>
              </div>
              <div className="ctrl__visuel">
                <img src={imgDe(sel)} alt="" onLoad={redraw} />
                <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
              </div>
              <div className="ctrl__texte">
                <span className="ctrl__kicker">Texte publié</span>
                <p>{sel.text || '(publication sans texte)'}</p>
                <a href={sel.link || '#'} target="_blank" rel="noopener noreferrer">
                  Voir la publication ↗
                </a>
              </div>
            </section>

            {/* Verdict */}
            <aside className="ctrl__verdict">
              <div className="card ctrl__bloc">
                <span className="ctrl__bloc-titre">Annotations · {marques.length}</span>
                {!marques.length ? (
                  <span className="muted ctrl__aide">
                    Dessinez sur le visuel : stylo à main levée ou carré rouge. Chaque annotation est numérotée ; décrivez ici le problème.
                  </span>
                ) : null}
                {marques.map((m, i) => (
                  <div key={i} className="ctrl__marque">
                    <span className="ctrl__marque-n" title={m.kind === 'pen' ? 'Stylo' : 'Carré rouge'}>
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={m.note}
                      placeholder="Ce qui ne va pas…"
                      onChange={(e) => upd({ marks: marques.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })}
                    />
                    <button type="button" className="btn btn--danger btn--icon" title="Retirer" onClick={() => upd({ marks: marques.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="card ctrl__bloc">
                <span className="ctrl__bloc-titre">Charte du réseau</span>
                {REGLES.map(([k, l]) => {
                  const x = v.rules?.[k]
                  return (
                    <button
                      key={k}
                      type="button"
                      className="ctrl__regle"
                      onClick={() => upd({ rules: { ...v.rules, [k]: x === undefined ? false : x === false ? true : undefined } })}
                    >
                      <span className={`ctrl__case${x === true ? ' is-ok' : x === false ? ' is-ko' : ''}`}>{x === true ? '✓' : x === false ? '✕' : ''}</span>
                      {l}
                    </button>
                  )
                })}
              </div>

              <div className="card ctrl__bloc">
                <span className="ctrl__bloc-titre">Non-conformité · envoi par mail</span>
                <label className="ctrl__champ">
                  Destinataire
                  <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse de la boutique ou du gérant" />
                </label>
                <div className="ctrl__champ">
                  Gravité
                  <div className="seg" role="group" aria-label="Gravité">
                    {(Object.keys(GRAVITE) as Gravite[]).map((k) => (
                      <button key={k} type="button" className={sev === k ? 'is-on' : ''} onClick={() => setSev(k)}>
                        {GRAVITE[k]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ctrl__deux">
                  <label className="ctrl__champ">
                    À corriger avant le
                    <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                  </label>
                  <label className="ctrl__champ">
                    Action demandée
                    <select value={action} onChange={(e) => setAction(e.target.value as Action)}>
                      <option value="corriger">Corriger le post</option>
                      <option value="supprimer">Supprimer le post</option>
                      <option value="info">Pour information</option>
                    </select>
                  </label>
                </div>
                <label className="ctrl__champ">
                  Message à la boutique
                  <textarea value={msg} rows={6} onChange={(e) => setMsg(e.target.value)} />
                </label>
                <span className="muted ctrl__aide">Le mail contient le visuel annoté, la liste numérotée des points, la grille de la charte et le lien vers la publication.</span>
                {!tache ? (
                  <div className="ctrl__actions">
                    <button
                      type="button"
                      className="btn ctrl__conforme"
                      onClick={() => {
                        upd({ status: 'Conforme', marks: [] })
                        annoncer('Marqué conforme (maquette : rien n’est enregistré).')
                      }}
                    >
                      Conforme ✓
                    </button>
                    <button type="button" className="btn btn--primary ctrl__valider" onClick={apercu}>
                      Valider et envoyer par mail →
                    </button>
                  </div>
                ) : (
                  <div className="ctrl__suivi">
                    {(
                      [
                        [`Mail envoyé à ${tache.to} le ${dShort(tache.at.slice(0, 10))} à ${tache.at.slice(11, 16)} · ${tache.sev}`, true],
                        [tache.seen ? `Ouvert par la boutique le ${dShort(tache.seen.slice(0, 10))}` : 'Pas encore ouvert', !!tache.seen],
                        [tache.fixed ? `Corrigé le ${dShort(tache.fixed)}` : 'En attente de correction', !!tache.fixed],
                      ] as [string, boolean][]
                    ).map(([label, on]) => (
                      <div key={label} className={`ctrl__etape${on ? ' is-on' : ''}`}>
                        <span className="ctrl__etape-point" />
                        {label}
                      </div>
                    ))}
                    <div className="ctrl__actions">
                      <button type="button" className="btn btn--sm" onClick={() => annoncer('Maquette : relance envoyée à la boutique.')}>
                        Relancer la boutique
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm ctrl__corrige"
                        onClick={() => {
                          upd({ task: { ...tache, fixed: today } })
                          annoncer('Marquée corrigée.')
                        }}
                      >
                        Marquer corrigé
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </>
        ) : null}
      </div>

      {/* Historique */}
      <section className="card ctrl__histo">
        <div className="ctrl__histo-tete">
          <span>Par boutique · {jours} derniers jours</span>
          <span className="muted">barre = posts publiés · vert = conformes · rouge = non conformes · gris = à contrôler</span>
        </div>
        {historique.map((h) => (
          <div key={h.id} className="ctrl__histo-ligne">
            <span>{h.name}</span>
            <span className="ctrl__barre">
              <span className="is-ok" style={{ width: `${(h.ok / h.maxT) * 100}%` }} />
              <span className="is-ko" style={{ width: `${(h.ko / h.maxT) * 100}%` }} />
              <span className="is-todo" style={{ width: `${(h.todo / h.maxT) * 100}%` }} />
            </span>
            <span className="num">
              {h.ok + h.ko} / {h.total} contrôlés
            </span>
            <span className={`num ${h.ko ? 'is-alerte' : 'is-bon'}`}>{h.ko} non conf.</span>
            <span className="num muted">{h.todo ? `${h.todo} à contrôler` : 'à jour'}</span>
          </div>
        ))}
      </section>

      {pvOpen && sel ? (
        <div className="confirm">
          <div className="card ctrl__apercu">
            <div className="ctrl__apercu-tete">
              <span className="ctrl__apercu-titre">Aperçu du mail</span>
              <span>À : {to}</span>
              <span>Objet : {`Publication non conforme — ${boutique} · ${dShort(sel.date)}`}</span>
            </div>
            <div className="ctrl__apercu-corps">
              <p className="ctrl__apercu-msg">{msg}</p>
              <div className="ctrl__apercu-visuel">
                <img src={imgDe(sel)} alt="Visuel annoté" />
                <img src={annotated} alt="" className="ctrl__apercu-calque" />
              </div>
              <div className="ctrl__apercu-points">
                {marques.map((m, i) => (
                  <span key={i}>
                    <span className="ctrl__apercu-n">{i + 1}.</span> {m.note || '(sans commentaire)'}
                  </span>
                ))}
              </div>
              <div className="ctrl__apercu-regles">
                {lignesRegles.map((rl) => (
                  <span key={rl}>{rl}</span>
                ))}
              </div>
              <span className="ctrl__apercu-pied">
                Gravité : {GRAVITE[sev]} · à {ACTION[action]} avant le {due ? dShort(due) : ''} ·{' '}
                <a href={sel.link || '#'} target="_blank" rel="noopener noreferrer">
                  voir la publication
                </a>
              </span>
            </div>
            <div className="confirm__actions ctrl__apercu-actions">
              <button type="button" className="btn" onClick={() => setPvOpen(false)}>
                Modifier
              </button>
              <button type="button" className="btn btn--primary" onClick={envoyer}>
                Envoyer le mail
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="ctrl__toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
