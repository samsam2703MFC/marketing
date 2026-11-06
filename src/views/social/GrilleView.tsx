import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './social.css'
import './grille.css'
import { addDays, dLabel, dShort } from '../../lib/social/format'
import { CONN, imageSocial } from '../../lib/social/refs'
import { lireAbonnes, lireGrille, relireGrille } from '../../lib/social/api-grille'
import type { AbonnesInstagram, GrilleInstagram, MediaInstagram } from '../../lib/social/api-grille'
import { boutiquesReseau, effacerAvis, enregistrer, journaliser, parId, useSocial } from '../../lib/social/store'
import type { EtatSocial, Objet } from '../../lib/social/store'
import { Barres, C, Courbe, court, fmtG, incomplets, lg, plages, signe } from './GrilleGraphes'
import type { Survol } from './GrilleGraphes'

interface PostG {
  id: string
  date: string
  time: string
  status: string
  title: string
  shops?: string[] | 'all'
  ch?: Record<string, { ig?: boolean }>
  ig?: boolean
  frise?: { tiles?: string[]; ig?: Record<string, string[]> } | null
  media?: { kind?: string; src: string }[]
  img?: string
  publishedAt?: string
}

interface Case {
  sched: boolean
  post?: PostG
  media?: MediaInstagram
  src: string
  tile?: number
  video?: boolean
  frise?: { post: PostG; tile: number } | null
}

type Selection = { post: string; armed: boolean } | { media: MediaInstagram; frise: { post: PostG; tile: number } | null }
interface Compte {
  id: string
  name: string
  ig?: string
  igs?: string
}

const at = (d: string, t?: string) => {
  const [Y, M, D] = String(d || '').split('-').map(Number)
  const [hh, mm] = String(t || '00:00').split(':').map(Number)
  return new Date(Y, M - 1, D, hh, mm).getTime()
}
const hhmm = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}
const src = (s: string | undefined) => (s ? imageSocial(s) : '')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Les cases de la grille d'une boutique, du plus récent au plus ancien. */
function grille(etat: EtatSocial, today: string, id: string, ig: GrilleInstagram | undefined) {
  const posts = etat.posts as unknown as PostG[]
  const reseau = boutiquesReseau(etat).map((x) => x.id)
  const nowMs = at(today, hhmm())
  const igOn = (p: PostG) => {
    const shops = p.shops === 'all' ? reseau : p.shops ?? []
    // Instagram unique : tout post qui coche Instagram pour une de ses boutiques part sur le compte du réseau.
    if (id === 'marque') return shops.some((sid) => (p.ch?.[sid] ? !!p.ch[sid].ig : !!p.ig))
    if (!shops.includes(id)) return false
    return p.ch?.[id] ? !!p.ch[id].ig : !!p.ig
  }
  const sched = posts
    .filter((p) => ['Programmé', 'À valider'].includes(p.status) && igOn(p) && at(p.date, p.time) >= nowMs - 5 * 60000)
    .sort((a, b) => at(b.date, b.time) - at(a.date, a.time) || String(b.id).localeCompare(String(a.id)))
  const thumb = (p: PostG) => {
    const m = (p.media ?? []).find((x) => x.kind !== 'video')
    return m ? m.src : p.img ?? ''
  }
  const cells: Case[] = []
  sched.forEach((p) => {
    const tiles = p.frise && Array.isArray(p.frise.tiles) && p.frise.tiles.length === 3 ? p.frise.tiles : null
    if (tiles) tiles.forEach((s, j) => cells.push({ sched: true, post: p, src: s, tile: j }))
    else cells.push({ sched: true, post: p, src: thumb(p), tile: -1, video: (p.media ?? []).some((x) => x.kind === 'video') && !thumb(p) })
  })
  // Les frises déjà publiées par le module : leurs ids Instagram, tuile 3 → 1.
  const friseOf: Record<string, { post: PostG; tile: number }> = {}
  posts.forEach((p) => {
    const ids = p.frise?.ig?.[id]
    if (Array.isArray(ids)) ids.forEach((mid, j) => (friseOf[mid] = { post: p, tile: 2 - j }))
  })
  ;(ig?.media ?? []).forEach((m) => cells.push({ sched: false, media: m, src: m.src ?? '', video: m.type === 'VIDEO', frise: friseOf[m.id] ?? null }))
  return { cells, sched }
}

/** Le verrou de la frise après un déplacement (le serveur le vérifie aussi). */
function verrouFrise(posts: PostG[], moved: PostG[], reseau: string[], igUnique: boolean): string | null {
  const igOf = (p: PostG) => {
    const l = (p.shops === 'all' ? reseau : p.shops ?? []).filter((id) => (p.ch?.[id] ? p.ch[id].ig : p.ig))
    return l.length && igUnique ? ['marque'] : l
  }
  for (const m of moved)
    for (const q of posts) {
      if (q.id === m.id || q.status !== 'Programmé' || m.status !== 'Programmé' || (!m.frise && !q.frise)) continue
      if (!igOf(m).some((id) => igOf(q).includes(id)) || Math.abs(at(m.date, m.time) - at(q.date, q.time)) >= 30 * 60000) continue
      return `Déplacement refusé : « ${m.title} » tomberait à moins de 30 minutes de « ${q.title} » — une frise demande 30 minutes sans autre post Instagram avant et après.`
    }
  return null
}

/**
 * Grille Instagram — l'écran « Grille » du module Social, réécrit dans le Marketing (docs/PORTAILS.md,
 * étape 2f). Le profil tel qu'il sera : les posts programmés au-dessus de ceux déjà en ligne (lus chez
 * Instagram par le serveur), échange de créneaux par glisser-déposer, contrôles des frises, et à droite
 * les abonnés du compte (30 jours) lus en direct chez Meta.
 */
export default function GrilleView() {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  const [shop, setShop] = useState<string | null>(null)
  const [ig, setIg] = useState<Record<string, GrilleInstagram>>({})
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Selection | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [ab, setAb] = useState<Record<string, AbonnesInstagram>>({})
  const [abLoading, setAbLoading] = useState(false)
  const [hovJ, setHovJ] = useState<Survol | null>(null)
  const [toast, setToast] = useState('')
  const tt = useRef<number | undefined>(undefined)
  const abRef = useRef(ab)
  abRef.current = ab
  const igRef = useRef(ig)
  igRef.current = ig

  const montrer = (m: string) => {
    window.clearTimeout(tt.current)
    setToast(m)
    tt.current = window.setTimeout(() => setToast(''), 6000)
  }
  useEffect(() => () => window.clearTimeout(tt.current), [])

  /** Les publications déjà en ligne : lues chez Instagram par le serveur. */
  const charger = async (id: string, force: boolean) => {
    setLoading(true)
    try {
      const r = force ? await relireGrille(id) : await lireGrille(id)
      setIg((x) => ({ ...x, [id]: r }))
      if (force) montrer(typeof r.synchro === 'number' ? `${r.synchro} publication(s) relue(s) chez Instagram.` : `Instagram : ${r.synchro}`)
    } catch (e) {
      montrer(`Lecture de la grille impossible : ${message(e)}`)
    }
    setLoading(false)
  }
  /** À droite de la grille : les abonnés du compte jour par jour (30 jours) et les comptes touchés, lus chez Meta. */
  const chargerAb = async (id: string) => {
    if (abRef.current[id]) return
    setAbLoading(true)
    try {
      const r = await lireAbonnes(id)
      setAb((x) => ({ ...x, [id]: r }))
    } catch (e) {
      setAb((x) => ({ ...x, [id]: { message: `Abonnés illisibles pour l’instant : ${message(e)}` } }))
    }
    setAbLoading(false)
  }

  const pret = !!etat && !!serveur
  useEffect(() => {
    if (!pret || !etat || !serveur || shop) return
    const boutiques = boutiquesReseau(etat)
    const want = new URLSearchParams(window.location.search).get('shop')
    const first = boutiques.find((x) => x.igs === 'connected') ?? boutiques[0]
    const id = serveur.instagramUnique ? 'marque' : want && parId(boutiques, want) ? want : first ? first.id : null
    if (!id) return
    setShop(id)
    void charger(id, false)
    void chargerAb(id)
    // Une fois, à l'arrivée de l'état.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pret])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const igUnique = !!serveur.instagramUnique
  const boutiques = boutiquesReseau(etat)
  const reseauIds = boutiques.map((x) => x.id)
  const b = (serveur.brand ?? {}) as { ig?: string; igs?: string }
  const reseau: Compte = { id: 'marque', name: 'Instagram du réseau', ig: b.ig || '', igs: b.igs || 'none' }
  const id = shop
  const compte: Compte | null = id === 'marque' ? reseau : id ? parId(etat.shops, id) ?? null : null
  const igCur = id ? ig[id] : undefined
  const { cells: raw, sched } = id ? grille(etat, serveur.today, id, igCur) : { cells: [] as Case[], sched: [] as PostG[] }
  const posts = etat.posts as unknown as PostG[]
  const fmtWhen = (p: PostG) => `${dShort(p.date)} · ${p.time}`

  /** Échange la date et l'heure de deux posts programmés. */
  const echanger = (aId: string, bId: string) => {
    const a = posts.find((p) => p.id === aId)
    const bb = posts.find((p) => p.id === bId)
    if (!a || !bb || a.id === bb.id) return
    const na = { ...a, date: bb.date, time: bb.time }
    const nb = { ...bb, date: a.date, time: a.time }
    const suite = posts.map((p) => (p.id === a.id ? na : p.id === bb.id ? nb : p))
    const clash = verrouFrise(suite, [na, nb], reseauIds, igUnique)
    if (clash) {
      montrer(clash)
      return
    }
    enregistrer({ posts: suite as unknown as Objet[] })
    journaliser(
      'Programmation',
      `Grille Instagram : « ${a.title} » et « ${bb.title} » échangent leur créneau (${dShort(nb.date)} ${nb.time} ↔ ${dShort(na.date)} ${na.time})`,
    )
    setSel(null)
    setDrag(null)
    montrer(`« ${a.title} » passe le ${dShort(na.date)} à ${na.time}, « ${bb.title} » le ${dShort(nb.date)} à ${nb.time}.`)
  }

  const choisir = (c: Case) => {
    if (!c.sched || !c.post) {
      if (c.media) setSel({ media: c.media, frise: c.frise ?? null })
      return
    }
    const cur = sel && 'post' in sel ? sel : null
    if (cur && cur.post !== c.post.id && cur.armed) {
      echanger(cur.post, c.post.id)
      return
    }
    setSel(cur && cur.post === c.post.id && !cur.armed ? null : { post: c.post.id, armed: false })
  }

  // Contrôles
  type Controle = { t: string; ton: 'ok' | 'warn' | 'info' }
  const checks: Controle[] = []
  if (compte && compte.igs !== 'connected')
    checks.push({ t: `Pas de compte Instagram connecté pour ${compte.name} : rien ne partira sur Instagram (Paramètres → identifiants Meta).`, ton: 'warn' })
  const friseIdx: { i: number; post: PostG; published: boolean }[] = []
  raw.forEach((c, i) => {
    if (c.sched && c.post?.frise && c.tile === 0) friseIdx.push({ i, post: c.post, published: false })
    if (!c.sched && c.frise && c.frise.tile === 0) friseIdx.push({ i, post: c.frise.post, published: true })
  })
  friseIdx.forEach(({ i, post, published }) => {
    const r = i % 3
    const label = `« ${post.title} » du ${dShort(post.date)}`
    const newer = raw.slice(0, i).filter((c) => !(c.sched && c.post?.id === post.id)).length
    if (r === 0) checks.push({ t: `La frise ${label}${published ? ' (déjà en ligne)' : ''} reste alignée sur une ligne : ${newer} case(s) avant elle.`, ton: 'ok' })
    else
      checks.push({
        t: `La frise ${label}${published ? ' (déjà en ligne)' : ''} sera décalée de ${r} case(s) : ${newer} case(s) avant elle. Programmez ${3 - r} post(s) de plus ou ${r} de moins pour la remettre sur une ligne.`,
        ton: 'warn',
      })
    const pend = raw
      .slice(0, i)
      .filter((c) => c.sched && c.post?.status === 'À valider')
      .map((c) => c.post?.title ?? '')
    if (pend.length)
      checks.push({
        t: `Si ${pend.map((x) => `« ${x} »`).join(', ')} (à valider) ${pend.length > 1 ? 'sont refusés' : 'est refusé'}, la frise ${label} sera décalée : prévoyez un remplaçant.`,
        ton: 'warn',
      })
  })
  sched
    .filter((p) => p.frise && p.status === 'Programmé')
    .forEach((f) => {
      const near = sched.filter((q) => q.id !== f.id && q.status === 'Programmé' && Math.abs(at(q.date, q.time) - at(f.date, f.time)) < 30 * 60000)
      if (near.length)
        checks.push({
          t: `${near.map((q) => `« ${q.title} »`).join(', ')} tombe à moins de 30 minutes de la frise « ${f.title} » : la ligne serait coupée. Déplacez-le.`,
          ton: 'warn',
        })
      else checks.push({ t: `Aucun autre post Instagram dans la demi-heure qui entoure la frise « ${f.title} ».`, ton: 'ok' })
    })
  if (!friseIdx.length)
    checks.push({ t: 'Aucune frise dans la grille : pas de contrainte d’alignement. Une frise se crée dans « Créer un post » → Frise de grille.', ton: 'info' })
  const lu = igCur?.lu_le ? String(igCur.lu_le).slice(0, 16) : null
  const depuis = posts.filter(
    (p) => p.status === 'Publié' && Array.isArray(p.shops) && id && p.shops.includes(id) && p.publishedAt && lu && String(p.publishedAt).slice(0, 16) > lu,
  )
  if (depuis.length)
    checks.push({ t: `${depuis.length} post(s) publié(s) depuis la dernière lecture n’apparaissent pas encore : « Relire chez Instagram ».`, ton: 'info' })

  // Sélection
  let carteSel: { kind: string; title: string; when: string; help: string; canSwap: boolean; href: string; target: string; openLabel: string } | null = null
  if (sel && 'post' in sel) {
    const p = posts.find((x) => x.id === sel.post)
    if (p)
      carteSel = {
        kind: p.frise ? 'Frise programmée · 3 posts' : p.status === 'À valider' ? 'Proposé par la boutique · à valider' : 'Post programmé',
        title: p.title,
        when: `${dLabel(p.date)} à ${p.time}`,
        help: sel.armed
          ? 'Cliquez maintenant la case programmée avec laquelle échanger le créneau.'
          : 'Glissez la case sur une autre case programmée, ou « Échanger avec… » puis cliquez l’autre case.',
        canSwap: !sel.armed && sched.length > 1,
        // « Créer un post » n'est pas encore réécrit dans le Marketing : l'écran du module, seul, sur ce post.
        href: `${window.location.pathname}?ecran=social-post&id=${encodeURIComponent(p.id)}`,
        target: '_blank',
        openLabel: 'Ouvrir le post',
      }
  } else if (sel && 'media' in sel) {
    const m = sel.media
    carteSel = {
      kind: sel.frise ? 'Frise publiée par le module' : 'Déjà en ligne',
      title: m.caption || 'Publication Instagram',
      when: m.at ? `Publié le ${dShort(m.at.slice(0, 10))} à ${m.at.slice(11, 16)}` : '',
      help: 'Les publications en ligne ne se déplacent pas (l’API Instagram ne permet ni de les réordonner ni de les supprimer).',
      canSwap: false,
      href: m.permalink ?? '',
      target: '_blank',
      openLabel: 'Voir sur Instagram',
    }
  }

  const igConnecte = (x: Compte) => x.igs === 'connected'
  const comptes: Compte[] = igUnique ? [reseau] : boutiques
  const handle = compte && compte.ig ? (String(compte.ig).startsWith('@') ? compte.ig : `@${compte.ig}`) : compte ? compte.name : '—'

  return (
    <div className="social-native grille">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">
            Le profil tel qu’il sera : les posts programmés au-dessus de ceux déjà en ligne · <code>GET /{'{ig_user_id}'}/media</code>
          </span>
          <span className="grille__espace" />
          {comptes.map((x) => {
            const vivant: Compte = x.id === 'marque' ? reseau : parId(etat.shops, x.id) ?? x
            return (
              <button
                key={x.id}
                type="button"
                className={`filter${x.id === id ? ' is-on' : ''}`}
                title={igConnecte(vivant) ? vivant.ig ?? '' : `Instagram : ${CONN[vivant.igs ?? '']?.label ?? 'non connecté'}`}
                onClick={() => {
                  setShop(x.id)
                  setSel(null)
                  setHovJ(null)
                  if (!igRef.current[x.id]) void charger(x.id, false)
                  void chargerAb(x.id)
                }}
              >
                {x.name}
                {!igConnecte(vivant) ? <span className="grille__sans"> · sans Instagram</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      {avis ? (
        <p className="warning grille__avis">
          {avis}{' '}
          <button type="button" className="linklike" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      <div className="grille__corps">
        {/* La grille */}
        <section className="card grille__profil">
          <div className="grille__profil-tete">
            <span>{handle} · du plus récent au plus ancien</span>
            <button type="button" className="btn btn--sm" disabled={loading || !id} onClick={() => id && void charger(id, true)}>
              {loading ? 'Lecture…' : 'Relire chez Instagram'}
            </button>
          </div>
          <span className="muted grille__lu">
            {lu
              ? `Publications lues chez Instagram le ${dShort(lu.slice(0, 10))} à ${lu.slice(11, 16)} · ${sched.length} post(s) programmé(s)`
              : loading
                ? 'Lecture en cours…'
                : 'Pas encore lu chez Instagram — « Relire chez Instagram ».'}
          </span>
          <div className="grille__cases">
            {raw.map((c, i) => {
              const p = c.post
              const selOn = !!sel && (('post' in sel && p && sel.post === p.id) || ('media' in sel && c.media && sel.media.id === c.media.id))
              const first = c.sched && (c.tile ?? -1) <= 0
              const pending = p?.status === 'À valider'
              const badge = !c.sched ? (c.frise && c.frise.tile === 0 ? 'Frise publiée' : '') : first && p ? `${p.frise ? 'Frise · ' : ''}${fmtWhen(p)}` : ''
              const alt = p ? p.title : c.media?.caption || 'Publication'
              const cls = ['grille__case', c.sched ? 'is-prog' : 'is-ligne', pending ? 'is-attente' : '', selOn ? 'is-sel' : '', c.sched && p?.frise ? 'is-frise' : '']
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  key={`${p?.id ?? c.media?.id ?? i}-${c.tile ?? ''}`}
                  className={cls}
                  title={
                    c.sched && p
                      ? `${p.title} — ${fmtWhen(p)}${p.frise ? ` · frise, tuile ${(c.tile ?? 0) + 1}/3` : ''} · glisser pour échanger`
                      : c.media?.at ?? ''
                  }
                  draggable={c.sched}
                  onClick={() => choisir(c)}
                  onDragStart={(e) => {
                    if (!c.sched || !p) return
                    try {
                      e.dataTransfer.setData('text/plain', p.id)
                      e.dataTransfer.effectAllowed = 'move'
                    } catch {
                      /* certains navigateurs refusent */
                    }
                    setDrag(p.id)
                  }}
                  onDragOver={(e) => {
                    if (c.sched && p && drag && drag !== p.id) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = drag
                    setDrag(null)
                    if (c.sched && p && from && from !== p.id) echanger(from, p.id)
                  }}
                >
                  {c.src ? <img src={src(c.src)} alt={alt} loading="lazy" /> : null}
                  {c.video ? <span className="grille__video">▶</span> : null}
                  {!c.src && !c.video ? <span className="grille__texte">{alt}</span> : null}
                  {badge ? <span className={`grille__badge${c.sched ? (p?.frise ? ' is-frise' : ' is-prog') : ''}`}>{badge}</span> : null}
                  {pending && first ? <span className="grille__drapeau">à valider</span> : null}
                </div>
              )
            })}
          </div>
          {!raw.length ? (
            <span className="muted grille__vide">
              {compte && compte.igs !== 'connected' ? 'Aucun compte Instagram connecté pour cette boutique.' : 'Rien de programmé, rien de lu : la grille est vide.'}
            </span>
          ) : null}
        </section>

        <section className="grille__droite">
          {carteSel ? (
            <div className="card grille__sel">
              <span className="grille__sel-genre">{carteSel.kind}</span>
              <span className="grille__sel-titre">{carteSel.title}</span>
              <span>{carteSel.when}</span>
              <span className="muted grille__petit">{carteSel.help}</span>
              <div className="grille__actions">
                {carteSel.canSwap ? (
                  <button type="button" className="btn btn--sm" onClick={() => sel && 'post' in sel && setSel({ ...sel, armed: true })}>
                    Échanger avec…
                  </button>
                ) : null}
                {carteSel.href ? (
                  <a className="btn btn--sm btn--primary" href={carteSel.href} target={carteSel.target} rel="noreferrer">
                    {carteSel.openLabel}
                  </a>
                ) : null}
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSel(null)}>
                  Fermer
                </button>
              </div>
            </div>
          ) : null}

          {id ? <Abonnes id={id} a={ab[id]} loading={abLoading && !ab[id]} ig={igCur} hov={hovJ} setHov={setHovJ} /> : null}

          <div className="card grille__bloc">
            <span className="grille__bloc-titre">Contrôles avant validation</span>
            {checks.map((k, i) => (
              <div key={i} className="grille__controle">
                <span className={`grille__tag is-${k.ton}`}>{k.ton === 'ok' ? 'OK' : k.ton === 'warn' ? 'Attention' : 'Info'}</span>
                <span>{k.t}</span>
              </div>
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
                Déjà publié (lu chez Instagram)
              </span>
              <span>
                <span className="grille__drapeau grille__drapeau--libre">à valider</span>
                Proposé par la boutique
              </span>
            </div>
          </div>
          <div className="card grille__bloc">
            <span className="grille__bloc-titre">Réordonner</span>
            <span className="grille__prose">
              Glissez une case programmée sur une autre (ou cliquez-la, « Échanger avec… », puis l’autre case) : les deux posts échangent leur date et
              leur heure de publication. Une frise se déplace en bloc. Les posts déjà en ligne ne bougent pas.
            </span>
          </div>
          <div className="card grille__bloc">
            <span className="grille__bloc-titre">D’où viennent les cases</span>
            <span className="grille__prose">
              Les posts déjà publiés sont relus chez Instagram (les 30 dernières publications du compte de la boutique, toutes les heures, ou tout de suite
              avec « Relire chez Instagram ») ; les posts programmés viennent du calendrier du module. Le profil montre chaque post recadré en 3:4. Les posts
              épinglés ne sont pas lus par l’API : ils s’affichent en tête du profil et décalent la grille d’autant.
            </span>
          </div>
        </section>
      </div>

      {toast ? <div className="grille__toast">{toast}</div> : null}
    </div>
  )
}

/**
 * À droite de la grille : l'évolution des abonnés du compte (le total d'aujourd'hui moins ce qui a changé ensuite),
 * les gagnés / perdus de chaque jour et les comptes touchés ; les jours de publication marqués d'un point noir.
 */
function Abonnes({
  id,
  a,
  loading,
  ig,
  hov,
  setHov,
}: {
  id: string
  a: AbonnesInstagram | undefined
  loading: boolean
  ig: GrilleInstagram | undefined
  hov: Survol | null
  setHov: (h: Survol | null) => void
}) {
  const tete = (contenu: ReactNode, lu = '') => (
    <div className="card grille__bloc">
      <div className="grille__ab-tete">
        <span className="grille__bloc-titre">Abonnés · 30 derniers jours</span>
        <span className="muted grille__petit">{lu}</span>
      </div>
      {contenu}
    </div>
  )
  if (!a) return tete(loading ? <span className="muted grille__petit">Lecture des abonnés chez Meta…</span> : null)
  if (a.message) return tete(<span className="grille__alerte">{a.message}</span>)
  if (!a.du || !a.au) return tete(null)

  const pubs: Record<string, MediaInstagram[]> = {}
  ;(ig?.media ?? []).forEach((m) => {
    const d = String(m.at ?? '').slice(0, 10)
    ;(pubs[d] = pubs[d] ?? []).push(m)
  })
  const pubL = (d: string) => (pubs[d] ?? []).slice(0, 1).map((m) => `Publié : « ${String(m.caption || 'publication').replace(/\s+/g, ' ').slice(0, 50)} »`)
  const days: string[] = []
  for (let d = a.du; d <= a.au && days.length < 400; d = addDays(d, 1)) days.push(d)
  const n = days.length
  const serie = a.serie ?? {}
  const perdus = a.perdus != null
  const gagnes = a.gagnes ?? 0
  const nPerdus = a.perdus ?? 0
  const marque = (i: number) => !!pubs[days[i]]
  const axe = { n, titre: (i: number) => dLabel(days[i]), court: (i: number) => court(days[i]), etiquettes: 4, hov, setHov }
  const net = (d: string) => (serie[d] ? (+(serie[d].gagnes ?? 0) || 0) - (perdus ? +(serie[d].perdus ?? 0) || 0 : 0) : 0)
  const tot: (number | null)[] = days.map(() => null)
  if (a.followers != null && perdus) {
    tot[n - 1] = a.followers
    for (let i = n - 1; i > 0; i--) tot[i - 1] = (tot[i] as number) - net(days[i])
  }
  const brut = days.map((d) => (a.reach && a.reach[d] != null ? +(a.reach[d] as number) : null))
  const bad = incomplets(brut)
  const vals = brut.map((v, i) => (bad[i] ? null : v))
  const ok = vals.filter((v): v is number => v != null)
  const lu = String(a.le ?? '')
  const kpis = [
    { label: 'Abonnés', value: fmtG(a.followers), sub: id === 'marque' ? 'compte du réseau' : 'compte de la boutique' },
    { label: 'Gagnés', value: a.gagnes != null ? `+${fmtG(a.gagnes)}` : '—', sub: 'nouveaux abonnés' },
    {
      label: perdus ? 'Net' : 'Perdus',
      value: perdus ? signe(gagnes - nPerdus) : '—',
      sub: perdus ? `−${fmtG(nPerdus)} désabonnements` : 'non donnés par Meta',
    },
  ]
  return (
    <>
      {tete(
        <>
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
          <span className="muted grille__petit">
            Lu en direct chez Meta (30 derniers jours, jusqu’à hier). Les points noirs marquent les jours de publication ; survolez un jour pour ses
            chiffres.
          </span>
        </>,
        lu ? `lu chez Meta le ${dShort(lu.slice(0, 10))} à ${lu.slice(11, 16)}` : '',
      )}
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
              ? `+${fmtG(serie[days[i]].gagnes)}${perdus ? ` / ${signe(-(+(serie[days[i]].perdus ?? 0) || 0))}` : ''} ce jour-là`
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
    </>
  )
}
