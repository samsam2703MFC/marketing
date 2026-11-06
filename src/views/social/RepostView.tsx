import { useCallback, useEffect, useRef, useState } from 'react'
import './social.css'
import './repost.css'
import { ROOTS } from '../../lib/api/module'
import { useSocial } from '../../lib/social/store'
import { dShort } from '../../lib/social/format'
import { gesteRepost, lireRepost } from '../../lib/social/api-repost'
import type { CaseRepost, GesteRepost, ReglageRepost, StatutCase, VueRepost } from '../../lib/social/api-repost'

/**
 * Repost automatique — l'écran « Repost » du module Social (SA Repost.dc.html), réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Le repost (social/src/repost.php) : chaque nouveau post de la Page de la marque
 * repris sur les Pages des boutiques. Suivi : en tête, les posts programmés de la marque (à venir) et leur repost
 * prévu ; puis une ligne par publication de la marque, une colonne par boutique ; Réglage ; Côté franchisé.
 */

const ST: Record<StatutCase, [string, string]> = {
  ok: ['is-ok', '✓'],
  prog: ['is-prog', '🕒'],
  val: ['is-val', '⏳'],
  ref: ['is-ref', '✗'],
  err: ['is-err', '⚠'],
  exp: ['is-gris', '—'],
  ret: ['is-gris', '—'],
  hors: ['is-hors', '·'],
  excl: ['is-gris', '—'],
  // La boutique était visée par le post de la marque lui-même (programmé dans le module) : pas de repost.
  direct: ['is-direct', '✓'],
}
const stDe = (s: string | undefined) => ST[(s as StatutCase) ?? 'hors'] ?? ST.hors

type Onglet = 'suivi' | 'reglage' | 'franchise'

/** Un autre écran du Marketing (`?ecran=…`), en gardant les paramètres de l'adresse (l'enseigne). */
function lienEcran(ecran: string, q?: Record<string, string>): string {
  const p = new URLSearchParams(window.location.search)
  p.set('ecran', ecran)
  for (const [k, v] of Object.entries(q ?? {})) p.set(k, v)
  return `?${p.toString()}`
}

const dt = (x: string | null | undefined) => (x ? `${dShort(String(x).slice(0, 10))} ${String(x).slice(11, 16)}` : '—')
const heure = (x: string | null | undefined, ref?: string | null) =>
  !x ? '' : ref && String(x).slice(0, 10) === String(ref).slice(0, 10) ? String(x).slice(11, 16) : dt(x)
const fI = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('fr-BE'))
const copie = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const extrait = (t: string | undefined) => String(t || '').replace(/\s+/g, ' ').slice(0, 140)

export default function RepostView() {
  const { etat } = useSocial()
  const [data, setData] = useState<VueRepost | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [jours, setJours] = useState(14)
  const [onglet, setOnglet] = useState<Onglet>('suivi')
  const [draft, setDraft] = useState<ReglageRepost | null>(null)
  const [sel, setSel] = useState<{ src: string; shop: string } | null>(null)
  const [retrait, setRetrait] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const tt = useRef<number | undefined>(undefined)
  const busyRef = useRef(false)

  const annoncer = useCallback((m: string) => {
    window.clearTimeout(tt.current)
    setToast(m)
    tt.current = window.setTimeout(() => setToast(''), 4200)
  }, [])
  useEffect(() => () => window.clearTimeout(tt.current), [])

  const charger = useCallback((j: number) => {
    lireRepost(j)
      .then((d) => {
        setData(d)
        setLoading(false)
        setErr('')
      })
      .catch((e: unknown) => {
        setLoading(false)
        setErr(e instanceof Error ? e.message : 'erreur')
      })
  }, [])
  useEffect(() => {
    charger(14)
  }, [charger])

  // Un geste du réseau : le serveur rend l'écran à jour.
  const agir = (quoi: GesteRepost, corps: Record<string, unknown>, ok: string | ((d: VueRepost) => string)) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    gesteRepost(quoi, { jours, ...corps })
      .then((d) => {
        setData(d)
        setSel(null)
        setRetrait(null)
        setDraft(null)
        const m = typeof ok === 'function' ? ok(d) : ok
        if (m) annoncer(m)
      })
      .catch((e: unknown) => annoncer(e instanceof Error ? e.message : 'erreur'))
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  const reglage = (patch: Record<string, unknown>, ok: string) => agir('reglage', patch, ok)

  const d = data
  const r = d?.reglage ?? null
  const shops = d?.shops ?? []
  const c = d?.chiffres
  const brouillon = draft ?? (r ? copie(r) : null)
  const setD = (f: (x: ReglageRepost) => void) =>
    setDraft((st) => {
      const x = copie((st ?? r) as ReglageRepost)
      f(x)
      return x
    })
  const conn = lienEcran('social-set-conn')
  const espace = (sid: string) => `${(d?.franchiseUrl || ROOTS.socialFranchise).replace(/\/?$/, '/')}calendrier?shop=${encodeURIComponent(sid)}`

  // --- le guet ---
  let guet = ''
  let guetTon = ''
  if (d && r) {
    const g = d.guet
    const page = `Page « ${d.marque.name} »`
    if (!d.metaConfigure) {
      guet = 'Token Meta absent : à saisir dans Paramètres → API Meta → Clés d’accès Meta.'
      guetTon = 'is-erreur'
    } else if (!d.marque.pageId) {
      guet = 'La Page de la marque n’est pas renseignée : Paramètres → API Meta → Identifiants Meta, ligne « marque ».'
      guetTon = 'is-erreur'
    } else if (!r.actif) {
      guet = `En pause : la ${page} n’est pas relue. Activez le repost pour reprendre ses prochaines publications (jamais l’historique).`
      guetTon = 'is-pause'
    } else if (g?.erreur) {
      guet = `Dernière lecture de la ${page} en échec (${dt(g.le)}) : ${g.erreur}`
      guetTon = 'is-erreur'
    } else if (g?.le) {
      guet = `${page} relue le ${dt(g.le)} · ${g.lus ?? 0} publication${(g.lus ?? 0) > 1 ? 's' : ''} depuis l’activation (${dt(r.depuis)}) · relue toutes les 5 minutes.`
    } else guet = `Activé le ${dt(r.depuis)} : la ${page} sera relue dans les 5 minutes.`
  }

  const n = Math.max(1, shops.length)
  const span = `2 / span ${n}`
  const av = d?.aVenir ?? { posts: [], erreur: null }
  const nAv = av.posts.length
  const nAvRepris = av.posts.filter((v) => !v.exclu).length
  // Meta ne donne pas à l'API les posts du planificateur de Business Suite : seuls ceux programmés dans le module
  // (« Créer un post », Page de la marque cochée) ou par l'API sont connus avant leur sortie.
  const bs = 'Meta ne transmet pas les posts programmés dans Business Suite : ils n’apparaissent qu’à leur sortie.'
  const avVideTxt = !d
    ? ''
    : (av.erreur ? `Posts programmés par l’API illisibles chez Meta (${av.erreur}). ` : '') +
      (!d.metaConfigure || !d.marque.pageId
        ? 'Renseignez le token Meta et la Page de la marque pour publier sur sa Page. '
        : 'Aucun post de la marque programmé. Programmez-le ici, Page de la marque cochée : il s’affiche aussitôt avec l’heure de son repost dans chaque boutique. ') +
      bs
  const avNouveau = lienEcran('social-post', { marque: '1' })

  // --- la case ouverte : ce que la boutique a fait de la publication, et ce que le réseau peut y faire ---
  let ouverte: null | {
    titre: string
    post: string
    label: string
    classe: string
    quote: string
    lignes: string[]
    lien: string
    action: [string, () => void] | null
  } = null
  if (d && r && sel) {
    const l = d.lignes.find((x) => x.source === sel.src)
    const x = shops.find((y) => y.id === sel.shop)
    const k: CaseRepost | null = l && x ? (l.cases[x.id] ?? { statut: 'hors' }) : null
    if (l && x && k) {
      const lab =
        (
          {
            ok: 'Publié',
            prog: 'Programmé',
            val: 'À valider par le franchisé',
            ref: 'Refusé par le franchisé',
            err: 'Échec chez Meta',
            exp: 'Sans réponse : rien publié',
            ret: 'Retiré',
            hors: 'Boutique pas visée',
            direct: 'Visée par le post de la marque',
          } as Partial<Record<StatutCase, string>>
        )[k.statut] ?? ''
      const lignes: string[] = []
      if (k.statut === 'ok') lignes.push(`Publié le ${dt(k.le)}${k.etat && k.etat !== 'auto' ? ` · ${k.etatNom ?? ''}${k.par ? ` par ${k.par}` : ''}` : ''}`)
      if (k.statut === 'prog') lignes.push(`Part le ${dt(k.le)} (${k.etatNom ?? ''})`)
      if (k.statut === 'val')
        lignes.push(
          `Proposé à la boutique · réponse attendue avant le ${dt(k.limite)} ; ${r.sansReponse === 'publier' ? 'sans réponse, il part quand même.' : 'sans réponse, rien ne part.'}`,
        )
      if (k.statut === 'ref' && k.reponduLe) lignes.push(`Refusé le ${dt(k.reponduLe)}${k.par ? ` par ${k.par}` : ''}`)
      ;(k.canaux ?? []).filter((z) => z.statut === 'echec').forEach((z) => lignes.push(`${z.canal} : ${z.erreur ?? ''}`))
      if (k.statut === 'hors' || k.statut === 'exp' || k.statut === 'ret' || k.statut === 'direct') lignes.push(k.detail ?? '')
      const action: [string, () => void] | null =
        k.statut === 'err'
          ? [`Relancer ${x.name}`, () => agir('relancer', { source: l.source, shop: x.id }, (y) => (y.relances ? 'Relancé' : 'Rien à relancer'))]
          : ['ref', 'exp', 'hors'].includes(k.statut) && l.statut === 'reposte'
            ? ['Reposter quand même', () => agir('forcer', { source: l.source, shop: x.id }, `Reposté sur la Page de ${x.name}`)]
            : k.statut === 'val'
              ? ['Publier sans attendre', () => agir('forcer', { source: l.source, shop: x.id }, `Publié sur la Page de ${x.name}`)]
              : null
      ouverte = {
        titre: x.name,
        post: `${l.titre} · ${dt(l.publieLe)}`,
        label: lab,
        classe: stDe(k.statut)[0],
        quote: k.statut === 'ref' && k.motif ? k.motif : '',
        lignes: lignes.filter(Boolean),
        lien: k.lien ?? '',
        action,
      }
    }
  }

  // --- réglage ---
  const tousShops = etat ? [...etat.shops.filter((x) => !x.test), ...etat.shops.filter((x) => x.test)] : []
  const cibles =
    d && brouillon
      ? tousShops
          .filter((x) => brouillon.boutiques[x.id])
          .map((x) => {
            const b = brouillon.boutiques[x.id]
            const ds = shops.find((y) => y.id === x.id)
            const page = x.page || `Page de ${x.name}`
            const pid = etat?.meta.ids?.[x.id]?.page_id || ds?.pageId || ''
            const tag = x.test
              ? 'Page test'
              : !pid
                ? 'Page non renseignée'
                : x.fb === 'connected'
                  ? 'Page connectée'
                  : x.fb === 'expired'
                    ? 'Page à reconnecter'
                    : ''
            return { id: x.id, b, name: x.name, page, tag, ton: x.test ? 'is-val' : tag === 'Page connectée' ? 'is-ok' : 'is-ref' }
          })
      : []
  const modifie = !!draft && JSON.stringify(draft) !== JSON.stringify(r)
  const igU = d ? d.instagramUnique : true
  const nAtt = d ? d.attente.length : 0

  const relire = () =>
    agir('relire', {}, (x) =>
      x.guet?.erreur ? `Lecture en échec : ${x.guet.erreur}` : x.guet?.pause ? 'En pause : rien n’est relu' : `${x.guet?.nouveaux ?? 0} nouvelle(s) publication(s) de la marque`,
    )

  return (
    <div className="social-native rp">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">{d ? `Page « ${d.marque.name} » → Pages des boutiques` : 'Page de la marque → Pages des boutiques'}</span>
          <span className="media__spacer" />
          {d && r ? (
            <>
              <button
                type="button"
                className={`btn rp__actif${r.actif ? ' is-on' : ''}`}
                aria-pressed={r.actif}
                onClick={() => reglage({ actif: !r.actif }, r.actif ? 'Repost en pause' : 'Repost activé : les prochaines publications de la marque seront reprises')}
              >
                <span className="rp__sw" />
                {r.actif ? 'Activé' : 'En pause'}
              </button>
              <select
                className="rp__select"
                value={String(jours)}
                aria-label="Période"
                onChange={(e) => {
                  const j = +e.target.value || 14
                  setJours(j)
                  setSel(null)
                  charger(j)
                }}
              >
                <option value="7">7 derniers jours</option>
                <option value="14">14 derniers jours</option>
                <option value="30">30 derniers jours</option>
                <option value="90">90 derniers jours</option>
              </select>
              <button type="button" className={`btn${onglet === 'suivi' ? ' btn--primary' : ''}${busy ? ' is-busy' : ''}`} onClick={relire}>
                {busy ? 'Un instant…' : 'Relire la Page de la marque'}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {loading && !d ? <p className="muted">Lecture du repost automatique…</p> : null}
      {err ? <p className="error">{err}</p> : null}

      {d && r && brouillon && c ? (
        <>
          <div className={`rp__guet ${guetTon}`}>{guet}</div>

          <div className="page-tabs" role="tablist">
            {(
              [
                ['suivi', 'Suivi'],
                ['reglage', 'Réglage'],
                ['franchise', `Côté franchisé${nAtt ? ` · ${nAtt}` : ''}`],
              ] as [Onglet, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={onglet === k}
                className={`page-tabs__tab${onglet === k ? ' is-on' : ''}`}
                onClick={() => {
                  setOnglet(k)
                  setSel(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ===== Suivi ===== */}
          {onglet === 'suivi' ? (
            <>
              <div className="kpi-row rp__tuiles">
                {(
                  [
                    [
                      'Posts à venir',
                      fI(nAv),
                      nAv
                        ? `prochain le ${dt(av.posts[0].prevuLe)}${nAvRepris < nAv ? ` · ${nAv - nAvRepris} exclu${nAv - nAvRepris > 1 ? 's' : ''}` : ''}`
                        : 'rien de programmé',
                      'is-prog',
                    ],
                    ['Publications de la marque', fI(c.posts), c.exclus ? `${c.exclus} exclue${c.exclus > 1 ? 's' : ''} par le réglage` : `sur ${jours} jours`, ''],
                    [
                      'Reposts publiés',
                      fI(c.publies) + (c.attendus ? ` / ${fI(c.attendus)}` : ''),
                      c.attendus ? `${Math.round((100 * c.publies) / c.attendus)} % des reposts attendus` : 'rien d’attendu',
                      'is-bon',
                    ],
                    ['Programmés', fI(c.programmes), 'partent à leur heure', 'is-prog'],
                    ['À valider', fI(c.aValider), 'en attente du franchisé', c.aValider ? 'is-moyen' : ''],
                    ['Refusés', fI(c.refuses), c.sansReponse ? `${c.sansReponse} sans réponse, rien publié` : 'par le franchisé', c.refuses ? 'is-alerte' : ''],
                    ['Échecs', fI(c.echecs), c.echecs ? 'refusés par Meta : à relancer' : 'aucun', c.echecs ? 'is-alerte' : ''],
                  ] as [string, string, string, string][]
                ).map(([label, value, sub, ton]) => (
                  <div key={label} className="kpi">
                    <div className="kpi__label">{label}</div>
                    <div className={`kpi__value ${ton}`}>{value}</div>
                    <div className="kpi__note">{sub}</div>
                  </div>
                ))}
              </div>

              {d.alertes.map((a) => (
                <div key={`${a.shop}-${a.canal}`} className="rp__alerte">
                  <span className="rp__alerte-signe">!</span>
                  <span className="rp__alerte-corps">
                    <span>
                      {a.canal} de {a.name} : {a.n} repost{a.n > 1 ? 's' : ''} en échec
                    </span>
                    <span className="rp__alerte-detail">{a.motif + (a.code === 190 ? ' — reconnecter la Page (Paramètres & connexions), puis relancer.' : '')}</span>
                  </span>
                  <a className="btn btn--sm" href={conn}>
                    Paramètres & connexions
                  </a>
                  <button type="button" className="btn btn--sm" onClick={() => agir('relancer', {}, (x) => `${x.relances ?? 0} repost(s) relancé(s)`)}>
                    Relancer les échecs
                  </button>
                </div>
              ))}

              <section className="card table-card rp__table">
                <div className="rp__grille" style={{ gridTemplateColumns: `minmax(320px,2.6fr) repeat(${n}, minmax(112px,1fr)) 150px`, minWidth: `${320 + 112 * n + 150}px` }}>
                  {/* en-tête : la publication, puis une colonne par boutique */}
                  <span className="rp__th">Publication de la marque</span>
                  {shops.map((x) => {
                    const sw = !x.validation && x.on
                    return (
                      <span key={x.id} className="rp__th rp__th--shop">
                        <span className="rp__th-nom">
                          {x.name}
                          {x.test ? <span className="muted"> (test)</span> : null}
                        </span>
                        <button
                          type="button"
                          className={`rp__mode${x.validation ? ' is-val' : ''}`}
                          title={!x.on ? 'Décochée dans Réglage' : x.validation ? 'Cliquer : passer en automatique' : 'Cliquer : le franchisé valide avant publication'}
                          onClick={() =>
                            x.on && reglage({ boutiques: { [x.id]: { validation: !x.validation } } }, x.name + (x.validation ? ' : automatique' : ' : le franchisé valide'))
                          }
                        >
                          <span className={`rp__sw rp__sw--petit${sw ? ' is-on' : ''}`} />
                          {!x.on ? 'ne reprend plus' : x.validation ? 'le franchisé valide' : 'automatique'}
                        </button>
                        <span className="muted rp__th-sous">{x.repris == null ? 'rien sur la période' : `${x.repris} % repris`}</span>
                      </span>
                    )
                  })}
                  <span className="rp__th" />

                  {/* à venir : les posts programmés sur la Page de la marque, et le repost prévu dans chaque boutique */}
                  <div className="rp__section is-avenir">
                    À venir · {nAv ? `${nAv} post${nAv > 1 ? 's' : ''} programmé${nAv > 1 ? 's' : ''}` : 'posts programmés'} sur la Page de la marque
                  </div>
                  {av.posts.map((v) => {
                    const pause = !r.actif
                    const bandeau = pause || !!v.exclu
                    const module = v.origine === 'module'
                    return (
                      <div key={v.source} className="rp__ligne">
                        <span className="rp__pub">
                          <Vignette img={v.img} type={v.type} pale={bandeau} />
                          <span className="rp__pub-corps">
                            <span className="muted rp__pub-meta">
                              {`Sort le ${dt(v.prevuLe)}${module ? ' · programmé dans le module' : ''}`} · {v.type} ·{' '}
                              <span className={bandeau ? 'is-neutre' : 'rp__bleu'}>{v.exclu ? 'exclu' : v.mode === 'copie' ? 'sera copié' : 'sera partagé'}</span>
                            </span>
                            <span className="rp__pub-titre" title={v.texte}>
                              {v.titre}
                            </span>
                            <span className="muted rp__pub-extrait">{extrait(v.texte)}</span>
                          </span>
                        </span>
                        {bandeau ? (
                          <span className="rp__case-cell" style={{ gridColumn: span }}>
                            <span className="rp__case is-gris">{pause ? '— Repost en pause : ne sera pas repris' : `— Sera exclu : ${v.exclu}`}</span>
                          </span>
                        ) : (
                          shops.map((x) => {
                            const k = v.cases[x.id] ?? { statut: 'hors' as const }
                            const [classe, ic] = stDe(k.statut)
                            const label = `${ic} ${({ prog: heure(k.le, v.prevuLe), val: 'à valider', hors: 'pas visée', direct: 'par le post' } as Record<string, string>)[k.statut] ?? ''}`
                            const sub =
                              ({ prog: 'repost prévu', val: `jusqu’à ${heure(k.limite, v.prevuLe)}`, hors: '', direct: 'visée par le post' } as Record<string, string>)[k.statut] ?? ''
                            const tip =
                              x.name +
                              ' : ' +
                              ((
                                {
                                  prog: `repost prévu le ${dt(k.le)}`,
                                  val: `proposé au franchisé à la sortie du post, réponse attendue avant le ${dt(k.limite)}`,
                                  hors: 'boutique pas visée',
                                  direct: 'le post de la marque vise déjà la boutique : publié chez elle à la même heure, pas reposté',
                                } as Record<string, string>
                              )[k.statut] ?? '')
                            return (
                              <span key={x.id} className="rp__case-cell" title={tip}>
                                <span className={`rp__case ${classe === 'is-hors' ? 'is-hors-blanc' : classe}`}>{label}</span>
                                <span className="muted rp__case-sous">{sub}</span>
                              </span>
                            )
                          })
                        )}
                        <span className="rp__fin">
                          {module ? (
                            <a className="btn btn--sm" href={lienEcran('social-post', { id: v.source })}>
                              Modifier
                            </a>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                  {!nAv ? (
                    <div className={`rp__plein rp__avvide${av.erreur ? ' is-erreur' : ''}`}>
                      <span>{avVideTxt}</span>
                      <a className="btn btn--sm" href={avNouveau}>
                        Programmer un post de la marque
                      </a>
                    </div>
                  ) : (
                    <div className="rp__plein rp__avplus">
                      <span>{(av.erreur ? `Posts programmés par l’API illisibles chez Meta (${av.erreur}). ` : '') + bs}</span>
                      <a href={avNouveau}>+ Programmer un post de la marque</a>
                    </div>
                  )}

                  {/* publiées : les publications de la marque sur la période, et leur sort dans chaque boutique */}
                  <div className="rp__section">Publiées · {jours} derniers jours</div>
                  {d.lignes.map((l) => {
                    const exclu = l.statut === 'exclu'
                    const retire = l.statut === 'retire'
                    const pale = exclu || retire
                    const echecs = Object.values(l.cases).some((k) => k.statut === 'err')
                    const publie = Object.values(l.cases).some((k) => k.statut === 'ok' || k.statut === 'prog')
                    const confirmer = retrait === l.source
                    const act: [string, () => void] | null = exclu
                      ? ['Reposter', () => agir('forcer', { source: l.source }, 'Reposté sur les Pages cochées')]
                      : echecs
                        ? ['Relancer', () => agir('relancer', { source: l.source }, (x) => `${x.relances ?? 0} repost(s) relancé(s)`)]
                        : publie && !retire
                          ? [
                              confirmer ? 'Confirmer le retrait' : 'Retirer',
                              () =>
                                confirmer
                                  ? agir('retirer', { source: l.source }, (x) =>
                                      x.retrait?.ok
                                        ? 'Retiré des Pages des boutiques'
                                        : `Meta refuse : ${(x.retrait?.erreurs ?? []).map((e) => `${e.shopName} (${e.reason})`).join(' · ')}`,
                                    )
                                  : setRetrait(l.source),
                            ]
                          : null
                    return (
                      <div key={l.source} className={`rp__ligne${pale ? ' is-pale' : ''}`}>
                        <span className="rp__pub">
                          <Vignette img={l.img} type={l.type} pale={pale} />
                          <span className="rp__pub-corps">
                            <span className="muted rp__pub-meta">
                              {dt(l.publieLe)} · {l.type} ·{' '}
                              <span className={pale ? 'is-neutre' : 'is-alerte'}>
                                {retire ? 'retiré' : exclu ? 'exclu' : l.mode === 'copie' ? 'copié' : `partagé${l.modeDemande === 'copie' ? ' (copie impossible)' : ''}`}
                              </span>
                            </span>
                            <a className="rp__pub-titre" href={l.permalink || '#'} target="_blank" rel="noopener noreferrer" title={l.texte}>
                              {l.titre}
                            </a>
                            <span className="muted rp__pub-extrait">{extrait(l.texte)}</span>
                          </span>
                        </span>
                        {exclu ? (
                          <span className="rp__case-cell" style={{ gridColumn: span }}>
                            <span className="rp__case is-gris">— Exclue : {l.motif || 'réglage'}</span>
                          </span>
                        ) : (
                          shops.map((x) => {
                            const k = l.cases[x.id] ?? { statut: 'hors' as const }
                            const [classe, ic] = stDe(k.statut)
                            const label = `${ic} ${
                              (
                                {
                                  ok: heure(k.le, l.publieLe),
                                  prog: heure(k.le, l.publieLe),
                                  val: 'à valider',
                                  ref: 'refusé',
                                  err: 'échec',
                                  exp: 'sans réponse',
                                  ret: 'retiré',
                                  hors: 'pas visée',
                                  direct: 'par le post',
                                } as Record<string, string>
                              )[k.statut] ?? ''
                            }`
                            const sub =
                              (
                                {
                                  ok: k.etat === 'auto' ? 'publié' : (k.etatNom ?? ''),
                                  prog: 'programmé',
                                  val: k.limite ? `jusqu’à ${heure(k.limite, l.publieLe)}` : '',
                                  ref: k.motif || 'sans motif',
                                  err: (k.canaux ?? [])
                                    .filter((z) => z.statut === 'echec')
                                    .map((z) => z.canal)
                                    .join(', '),
                                  exp: 'rien publié',
                                  ret: '',
                                  hors: '',
                                  direct: 'pas reposté',
                                } as Record<string, string>
                              )[k.statut] ?? ''
                            const choisie = sel?.src === l.source && sel.shop === x.id
                            return (
                              <button
                                key={x.id}
                                type="button"
                                className={`rp__case-cell rp__case-btn${choisie ? ' is-choisie' : ''}`}
                                title={`${x.name} : ${k.detail ?? ''}`}
                                onClick={() => setSel(choisie ? null : { src: l.source, shop: x.id })}
                              >
                                <span className={`rp__case ${classe}`}>{label}</span>
                                <span className="muted rp__case-sous">{sub}</span>
                              </button>
                            )
                          })
                        )}
                        <span className="rp__fin">
                          {act ? (
                            <button type="button" className={`btn btn--sm${confirmer ? ' btn--primary' : ''}`} onClick={act[1]}>
                              {act[0]}
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                  {!d.lignes.length ? (
                    <div className="rp__plein rp__vide">
                      {r.actif
                        ? `Aucune publication de la Page de la marque sur les ${jours} derniers jours depuis l’activation.`
                        : 'Le repost est en pause. Activez-le (en haut à droite) : les prochaines publications de la Page de la marque seront reprises.'}
                    </div>
                  ) : null}
                </div>
              </section>
              <div className="rp__legende">
                {(
                  [
                    ['ok', '✓ publié'],
                    ['prog', '🕒 programmé'],
                    ['val', '⏳ à valider'],
                    ['ref', '✗ refusé'],
                    ['err', '⚠ échec'],
                    ['exp', '— sans réponse'],
                  ] as [StatutCase, string][]
                ).map(([k, label]) => (
                  <span key={k} className={`rp__case ${ST[k][0]}`}>
                    {label}
                  </span>
                ))}
                <span>
                  Un clic sur une case : le détail, et ce que le réseau peut y faire. L’en-tête d’une colonne passe la boutique en automatique ou en validation. « Retirer »
                  supprime le repost des Pages des boutiques.
                </span>
              </div>
            </>
          ) : null}

          {/* ===== Réglage ===== */}
          {onglet === 'reglage' ? (
            <div className="rp__deux">
              <section className="card rp__reglage">
                <span className="rp__intro">Chaque nouveau post de la Page « {d.marque.name} » est repris sur les Pages des boutiques cochées.</span>

                <div className="rp__groupe">
                  <span className="muted">Sur Facebook</span>
                  <div className="seg" role="group" aria-label="Mode Facebook">
                    {(
                      [
                        ['partage', 'Partager le post'],
                        ['copie', 'Copier le post'],
                      ] as ['partage' | 'copie', string][]
                    ).map(([k, label]) => (
                      <button key={k} type="button" className={brouillon.mode === k ? 'is-on' : ''} onClick={() => setD((y) => void (y.mode = k))}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="muted rp__aide">
                    {brouillon.mode === 'copie'
                      ? 'La Page de la boutique publie le même visuel et le même texte, comme son propre post. Une vidéo ou un lien sont partagés.'
                      : 'La Page de la boutique partage le post de la marque : un lien vers lui, avec le texte de la boutique au-dessus.'}
                  </span>
                </div>

                <label className={`rp__case-a-cocher${igU ? ' is-off' : ''}`}>
                  <input type="checkbox" checked={!!brouillon.instagram} disabled={igU} onChange={() => !igU && setD((y) => void (y.instagram = !y.instagram))} />
                  <span>
                    <span>Aussi une copie sur l’Instagram de chaque boutique</span>
                    <span className="muted rp__aide">
                      {igU
                        ? 'Instagram unique au réseau : le compte du réseau est celui de la marque, il n’y a rien à reposter.'
                        : 'Instagram n’a pas de repost : la boutique publie une copie (même visuel, même texte). Seulement les boutiques qui ont leur compte.'}
                    </span>
                  </span>
                </label>

                <div className="rp__champs">
                  <label className="rp__champ">
                    Quand
                    <select value={String(brouillon.delaiMin ?? 30)} onChange={(e) => setD((y) => void (y.delaiMin = +e.target.value))}>
                      <option value="0">dès que la marque publie</option>
                      <option value="15">15 min après</option>
                      <option value="30">30 min après</option>
                      <option value="60">1 h après</option>
                      <option value="120">2 h après</option>
                      <option value="240">4 h après</option>
                    </select>
                  </label>
                  <div className="rp__champ">
                    Entre
                    <span className="rp__plage">
                      <input type="time" value={brouillon.de ?? '07:00'} aria-label="Début de la plage" onChange={(e) => setD((y) => void (y.de = e.target.value))} />
                      et
                      <input type="time" value={brouillon.a ?? '21:00'} aria-label="Fin de la plage" onChange={(e) => setD((y) => void (y.a = e.target.value))} />
                    </span>
                  </div>
                </div>
                <span className="muted rp__aide rp__aide--serre">
                  Hors de la plage, le repost attend son ouverture suivante. Une même publication ne part jamais deux fois sur une Page.
                </span>

                <label className="rp__champ">
                  {brouillon.mode === 'copie' ? 'Texte de la boutique, ajouté sous celui de la marque (facultatif)' : 'Texte de la boutique, au-dessus du partage (facultatif)'}
                  <textarea
                    rows={2}
                    value={brouillon.texte ?? ''}
                    placeholder="ex. Chez nous à {ville}, {adresse} — ouvert {horaires}"
                    onChange={(e) => setD((y) => void (y.texte = e.target.value))}
                  />
                  <span className="rp__vars">
                    {(
                      [
                        ['{ville}', 'Nom de la boutique'],
                        ['{adresse}', 'Adresse de la boutique'],
                        ['{horaires}', 'Horaires de la boutique'],
                        ['{webshop}', 'Le webshop de la boutique'],
                      ] as [string, string][]
                    ).map(([code, tip]) => (
                      <button
                        key={code}
                        type="button"
                        className="rp__var"
                        title={tip}
                        onClick={() => setD((y) => void (y.texte = (y.texte ? `${y.texte.replace(/\s+$/, '')} ` : '') + code))}
                      >
                        {code}
                      </button>
                    ))}
                  </span>
                </label>

                <label className="rp__champ">
                  Jamais les posts qui contiennent (séparés par des virgules)
                  <input
                    type="text"
                    value={(brouillon.exclure ?? []).join(', ')}
                    placeholder="recrute, franchise, concours"
                    onChange={(e) =>
                      setD(
                        (y) =>
                          void (y.exclure = e.target.value
                            .split(',')
                            .map((z) => z.trim())
                            .filter(Boolean)),
                      )
                    }
                  />
                </label>

                <div className="rp__groupe rp__filet">
                  <span>Quand le franchisé valide</span>
                  <span className="rp__ligne-champs">
                    Sans réponse sous
                    <select value={String(brouillon.delaiValidationH ?? 4)} onChange={(e) => setD((y) => void (y.delaiValidationH = +e.target.value))}>
                      <option value="1">1 heure</option>
                      <option value="2">2 heures</option>
                      <option value="4">4 heures</option>
                      <option value="8">8 heures</option>
                      <option value="12">12 heures</option>
                      <option value="24">24 heures</option>
                    </select>
                    <span className="seg" role="group" aria-label="Sans réponse">
                      {(
                        [
                          ['publier', 'publié quand même'],
                          ['rien', 'rien ne part'],
                        ] as ['publier' | 'rien', string][]
                      ).map(([k, label]) => (
                        <button key={k} type="button" className={brouillon.sansReponse === k ? 'is-on' : ''} onClick={() => setD((y) => void (y.sansReponse = k))}>
                          {label}
                        </button>
                      ))}
                    </span>
                  </span>
                </div>

                <div className="rp__cibles rp__filet">
                  <span>Les Pages des boutiques</span>
                  {cibles.map((x) => (
                    <div key={x.id} className="rp__cible">
                      <input
                        type="checkbox"
                        checked={x.b.on}
                        aria-label={`Reprendre sur la Page de ${x.name}`}
                        onChange={() => setD((y) => void (y.boutiques[x.id].on = !y.boutiques[x.id].on))}
                      />
                      <span className="rp__cible-nom">
                        <span>{x.name}</span>
                        <span className="muted">{x.page}</span>
                      </span>
                      {x.tag ? <span className={`rp__case ${x.ton}`}>{x.tag}</span> : null}
                      <span className={`seg${x.b.on ? '' : ' is-pale'}`} role="group" aria-label={`Validation pour ${x.name}`}>
                        {(
                          [
                            [false, 'Automatique'],
                            [true, 'Le franchisé valide'],
                          ] as [boolean, string][]
                        ).map(([val, label]) => (
                          <button
                            key={label}
                            type="button"
                            className={x.b.validation === val ? 'is-on' : ''}
                            onClick={() => setD((y) => void (y.boutiques[x.id].validation = val))}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="rp__enregistrer rp__filet">
                  <span className="muted">{modifie ? 'Modifications non enregistrées' : r.actif ? `Activé depuis le ${dt(r.depuis)}` : 'En pause'}</span>
                  <span className="rp__boutons">
                    {modifie ? (
                      <button type="button" className="btn" onClick={() => setDraft(null)}>
                        Annuler
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={!modifie || busy}
                      onClick={() =>
                        modifie && reglage({ ...draft, depuis: undefined }, 'Réglage enregistré : il vaut pour les prochaines publications de la marque')
                      }
                    >
                      Enregistrer
                    </button>
                  </span>
                </div>
              </section>
              <aside className="card rp__encart">
                <span className="rp__encart-titre">Ce que fait Meta</span>
                <span>
                  <span className="rp__fort">Partager</span> publie sur la Page de la boutique un lien vers le post de la marque : les réactions restent sur le post de la
                  marque. Rendu à vérifier une fois sur la Page test.
                </span>
                <span>
                  <span className="rp__fort">Copier</span> publie le même visuel et le même texte comme post de la boutique. Une vidéo ou un lien ne se copient pas : ils
                  sont partagés.
                </span>
                <span>
                  <span className="rp__fort">Instagram</span> n’a pas de repost par l’API : c’est toujours une copie, et seulement si la boutique a son propre compte.
                </span>
                <span>La Page de la marque est relue toutes les 5 minutes. Seules les publications faites après l’activation sont reprises, jamais l’historique.</span>
              </aside>
            </div>
          ) : null}

          {/* ===== Côté franchisé ===== */}
          {onglet === 'franchise' ? (
            <div className="rp__deux">
              <section className="card rp__attente">
                <span className="rp__intro">En attente des franchisés</span>
                {d.attente.map((w) => (
                  <div key={`${w.source}-${w.shop}`} className="rp__attente-ligne">
                    <span className="rp__attente-corps">
                      <span>
                        {w.name} — {w.titre}
                      </span>
                      <span className="muted">{w.limite ? `réponse attendue avant le ${dt(w.limite)}` : ''}</span>
                    </span>
                    <a href={espace(w.shop)} target="_blank" rel="noopener noreferrer">
                      Voir son espace ↗
                    </a>
                    <button type="button" className="btn btn--sm" onClick={() => agir('forcer', { source: w.source, shop: w.shop }, `Publié sur la Page de ${w.name}`)}>
                      Publier sans attendre
                    </button>
                  </div>
                ))}
                {!nAtt ? <span className="muted rp__aide">Aucun repost n’attend la réponse d’un franchisé.</span> : null}
              </section>
              <aside className="card rp__encart">
                <span className="rp__encart-titre">Ce que voit le franchisé</span>
                <span>
                  En haut de son Calendrier, la carte « Le réseau vous propose » : la publication de la marque, le texte ajouté pour sa boutique, et deux boutons,{' '}
                  <span className="rp__fort">Publier sur ma Page</span> et <span className="rp__fort">Refuser</span> (avec un motif, que vous lisez ici dans la case de sa
                  boutique).
                </span>
                <span>
                  {`Sans réponse sous ${r.delaiValidationH} h : ${r.sansReponse === 'publier' ? 'le repost part quand même.' : 'rien ne part, la case le dit (« sans réponse »).'}`}
                </span>
                <span>Une boutique en « automatique » ne voit rien à valider : le repost arrive sur sa Page et dans son calendrier.</span>
              </aside>
            </div>
          ) : null}
        </>
      ) : null}

      {/* La case ouverte : ce que la boutique a fait de la publication, et ce que le réseau peut y faire. */}
      {ouverte ? (
        <div className="card rp__detail" role="dialog" aria-label={ouverte.titre}>
          <div className="rp__detail-tete">
            <span className="rp__detail-titre">
              <span>{ouverte.titre}</span>
              <span className="muted">{ouverte.post}</span>
            </span>
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Fermer" onClick={() => setSel(null)}>
              ×
            </button>
          </div>
          <span className={`rp__case ${ouverte.classe === 'is-hors' ? 'is-gris' : ouverte.classe}`}>{ouverte.label}</span>
          {ouverte.quote ? <div className="rp__quote">« {ouverte.quote} »</div> : null}
          {ouverte.lignes.map((x) => (
            <span key={x} className="rp__detail-ligne">
              {x}
            </span>
          ))}
          {ouverte.lien ? (
            <a href={ouverte.lien} target="_blank" rel="noopener noreferrer">
              Voir sur la Page de la boutique ↗
            </a>
          ) : null}
          {ouverte.action ? (
            <button type="button" className="btn btn--primary btn--sm rp__detail-action" onClick={ouverte.action[1]}>
              {ouverte.action[0]}
            </button>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className="rp__toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

function Vignette({ img, type, pale }: { img?: string | null; type: string; pale: boolean }) {
  return <span className={`rp__vignette${pale ? ' is-pale' : ''}`}>{img ? <img src={img} alt="" /> : type}</span>
}
