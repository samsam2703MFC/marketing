import { useCallback, useEffect, useRef, useState } from 'react'
import '../social/social.css'
import '../social/google.css'
import './googlefranchise.css'
import { ROOTS } from '../../lib/api/module'
import { qrPath } from '../../lib/qr'
import { avisRepondu, commentaireProposer, commentaireRepondre, commentaireTraiter, dateHeure, google, maintenant, texteErreur, useFranchise } from './_donnees'
import type { Commentaire, Couleur, MagasinGoogle, Totaux, VueGoogleFranchise } from './_donnees'

/**
 * Avis Google — la page « Avis Google » de l'espace franchisé (social/franchisee/Google.dc.html), réécrite dans le
 * Marketing. La note Google de la boutique, la cible du réseau, les avis 5★ à obtenir, la répartition des avis lus et
 * la moyenne du réseau (la Réputation digitale du BO) ; le QR code et les affiches pour faire venir des avis ; ses
 * avis classés vert / orange / rouge, à traiter (social/src/google.php). La lecture chez Google et le classement
 * restent au réseau (toutes les heures).
 *
 * Adresse : `?jours=30|90|365|3650` (période, 365 par défaut) et `?couleur=rouge|orange|vert` (filtre de départ).
 */

type Jours = 30 | 90 | 365 | 3650
type Ton = 'ok' | 'warn' | 'err'
const PERIODES: [Jours, string][] = [
  [30, '30 j'],
  [90, '90 j'],
  [365, '1 an'],
  [3650, 'Tout'],
]
const C: Record<string, [string, string]> = { rouge: ['is-rouge', 'Rouge'], orange: ['is-orange', 'Orange'], vert: ['is-vert', 'Vert'], '': ['is-classer', 'À classer'] }
const COUL: Record<number, string> = { 5: '#C9A227', 4: '#2d7a3e', 3: '#D97706', 2: '#C0182B', 1: '#8D1D2C' }
const ORDRE: Record<string, number> = { rouge: 0, orange: 1, '': 2, vert: 3 }
const VIDE: Totaux = { rouge: 0, orange: 0, vert: 0, aClasser: 0, rougeOuverts: 0, orangeOuverts: 0, total: 0 }
const fN = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','))
const fI = (v: number | null | undefined) => Number(v || 0).toLocaleString('fr-BE')
const pluriel = (n: number | null | undefined) => ((n ?? 0) > 1 ? 's' : '')

function Etoiles({ note, taille }: { note: number | null | undefined; taille: number }) {
  const p = note == null ? 0 : Math.round(note)
  return (
    <span className="gg__etoiles" style={{ fontSize: taille }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= p ? 'is-pleine' : ''}>
          ★
        </span>
      ))}
    </span>
  )
}

function parametresDeDepart() {
  const p = new URLSearchParams(window.location.search)
  const j = Number(p.get('jours'))
  const c = p.get('couleur') ?? ''
  const couleur = (['rouge', 'orange', 'vert'].includes(c) ? c : '') as Couleur
  return { jours: ([30, 90, 365, 3650].includes(j) ? j : 365) as Jours, couleur, nonTraites: couleur !== '' && couleur !== 'vert' }
}

export default function GoogleFranchiseView() {
  const { etat, erreur } = useFranchise()
  const [depart] = useState(parametresDeDepart)
  const [jours, setJours] = useState<Jours>(depart.jours)
  const [couleur, setCouleur] = useState<Couleur>(depart.couleur)
  const [nonTraites, setNonTraites] = useState(depart.nonTraites)
  const [retard, setRetard] = useState(false)
  const [data, setData] = useState<VueGoogleFranchise | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState<{ t: string; k: Ton } | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, string>>({})
  const [busyRep, setBusyRep] = useState('')
  const [busyProp, setBusyProp] = useState('')
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const cle = useRef(0)

  const charger = useCallback((j: Jours) => {
    const k = ++cle.current
    setJours(j)
    setLoading(true)
    setErr('')
    google(j)
      .then((r) => {
        if (k !== cle.current) return
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (k !== cle.current) return
        setLoading(false)
        setErr(texteErreur(e))
      })
  }, [])
  const pret = !!etat
  useEffect(() => {
    if (pret) charger(depart.jours)
  }, [pret, charger, depart.jours])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const dire = (t: string, k: Ton) => setMsg({ t, k })
  const masque = !!data?.hidden || etat.rules?.voirAvisGoogle === false

  const changer = (c: Commentaire, traite: boolean, autres: Partial<Commentaire> = {}) =>
    setData((d) => {
      if (!d) return d
      const le = maintenant()
      const avis = d.avis.map((x) => (x.id === c.id ? { ...x, ...autres, traite, traiteLe: traite ? x.traiteLe || le : null, traitePar: traite ? x.traitePar || 'vous' : '' } : x))
      const totaux = { ...d.totaux }
      if (c.traite !== traite) {
        if (c.couleur === 'rouge') totaux.rougeOuverts += traite ? -1 : 1
        if (c.couleur === 'orange') totaux.orangeOuverts += traite ? -1 : 1
      }
      return { ...d, avis, totaux }
    })
  const marquer = (c: Commentaire, t: string, source: string) =>
    changer(c, true, { reponseEnvoyee: t, reponseSource: source, reponseLe: maintenant(), reponsePar: 'vous', enRetard: false })
  const texte = (c: Commentaire) => String(brouillons[c.id] ?? c.reponse ?? '').trim()

  const traiter = (c: Commentaire) => {
    commentaireTraiter(c.id, !c.traite)
      .then(() => changer(c, !c.traite))
      .catch((e: unknown) => dire(`Non enregistré : ${texteErreur(e)}`, 'err'))
  }
  const proposer = (c: Commentaire) => {
    if (busyProp) return
    setBusyProp(c.id)
    commentaireProposer(c.id)
      .then((r) => {
        setBusyProp('')
        setBrouillons((b) => ({ ...b, [c.id]: r.reponse }))
        dire(
          r.source === 'claude'
            ? 'Réponse proposée par Claude : relisez-la avant de la publier.'
            : 'Réponse proposée d’après la note et la langue de l’avis : relisez-la, personnalisez-la.',
          'ok',
        )
      })
      .catch((e: unknown) => {
        setBusyProp('')
        dire(`Proposition impossible : ${texteErreur(e)}`, 'err')
      })
  }
  const publier = (c: Commentaire) => {
    const t = texte(c)
    if (busyRep) return
    if (!t) {
      dire('Écrivez (ou faites proposer) la réponse d’abord.', 'warn')
      return
    }
    if (!window.confirm('Publier cette réponse sous l’avis, sur la fiche Google de votre boutique ? Elle sera visible de tous.')) return
    setBusyRep(c.id)
    commentaireRepondre(c.id, t)
      .then(() => {
        setBusyRep('')
        dire('Réponse publiée sur Google, sous l’avis.', 'ok')
        marquer(c, t, 'gbp')
      })
      .catch((e: unknown) => {
        setBusyRep('')
        dire(texteErreur(e) || 'Publication impossible.', 'err')
      })
  }
  const copierOuvrir = (c: Commentaire) => {
    const t = texte(c)
    const ok = () => dire('Réponse copiée : collez-la sous l’avis sur votre fiche Google, publiez, puis « J’ai répondu sur la fiche ».', 'ok')
    try {
      if (t) navigator.clipboard.writeText(t).then(ok, ok)
      else ok()
    } catch {
      ok()
    }
    if (c.lien) window.open(c.lien, '_blank', 'noopener')
  }
  const repondu = (c: Commentaire) => {
    const t = texte(c)
    if (busyRep) return
    if (!t) {
      dire('Collez ici la réponse publiée sur la fiche.', 'warn')
      return
    }
    setBusyRep(c.id)
    avisRepondu(c.id, t)
      .then(() => {
        setBusyRep('')
        dire('Réponse notée : l’avis est traité.', 'ok')
        marquer(c, t, 'manuel')
      })
      .catch((e: unknown) => {
        setBusyRep('')
        dire(texteErreur(e) || 'Non enregistré.', 'err')
      })
  }
  const copierLien = (t: string) => {
    try {
      void navigator.clipboard.writeText(t).then(() => dire('Lien copié : à mettre sur le ticket, dans un message ou un e-mail à vos clients.', 'ok'))
    } catch {
      /* rien */
    }
  }

  const rp = (!masque && data?.reputation) || null
  const ok = !!rp && !rp.indispo
  const cible = ok ? rp.cible : 4.5
  const res = (ok && rp.reseau) || null
  const co = (ok && rp.connecteur) || {}
  const m: MagasinGoogle | null = (ok && rp.magasins?.[0]) || null
  const sans = !m || m.note == null || !m.avis
  const atteint = !sans && (m.note ?? 0) >= cible
  const ton = sans ? 'is-sans' : atteint ? 'is-atteint' : 'is-sous'

  const t = data?.totaux ?? VIDE
  const choisirKpi = (k: Couleur) => {
    setCouleur(couleur === k ? '' : k)
    setNonTraites(couleur === k ? nonTraites : k !== 'vert' && k !== '')
  }
  const liste = (data?.avis ?? [])
    .filter((c) => (!couleur || c.couleur === couleur) && (!nonTraites || !c.traite) && (!retard || c.enRetard))
    .sort((a, b) => Number(!!a.traite) - Number(!!b.traite) || ORDRE[a.couleur || ''] - ORDRE[b.couleur || ''] || String(b.le).localeCompare(String(a.le)))
  const an = String(etat.today || '').slice(0, 4)
  const dl = (x: string | undefined) => (x ? `${x.slice(8, 10)}/${x.slice(5, 7)}${x.slice(0, 4) !== an ? `/${x.slice(2, 4)}` : ''}` : '')
  const rep = data?.reponses ?? null
  const direct = !!rep?.peutPublier
  const repTxt = !rep
    ? ''
    : rep.active
      ? `Réponse directe sur Google : branchée. « Publier sur Google » publie la réponse sous l’avis, sur la fiche${rep.fiches ? ` (${rep.fiches} fiche${pluriel(rep.fiches)} rattachée${pluriel(rep.fiches)})` : ''}.`
      : `Réponse directe sur Google : pas encore branchée. ${rep.raison ?? ''} En attendant : « Proposer une réponse », relisez, « Copier et ouvrir la fiche », publiez-la sous l’avis, puis « J’ai répondu sur la fiche ».`

  // Le QR code et les affiches mènent directement à la fenêtre d'avis Google (un papier imprimé ne dépend pas du serveur).
  const qr = ok && m?.lienAvis ? qrPath(m.lienAvis) : null
  const affiche = (f: string) =>
    m?.lienAvis
      ? `${ROOTS.social}${encodeURI('Affiche avis.html')}?u=${encodeURIComponent(m.lienAvis)}&nom=${encodeURIComponent(etat.shop.name)}&langues=${encodeURIComponent(
          (etat.shop.langs?.length ? etat.shop.langs : ['fr']).join(','),
        )}&format=${f}`
      : '#'
  const lienSuivi = m?.lienCourt ? `${m.lienCourt}?s=lien` : (m?.lienAvis ?? '')
  const lus = m?.repartition?.lus ?? 0

  return (
    <div className="social-native gg fgg">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">{`Ce que Google dit de L’Atelier By ${etat.shop.name} · note, cible du réseau et avis lus dans leur contexte`}</span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période">
            {PERIODES.map(([j, label]) => (
              <button key={j} type="button" className={jours === j ? 'is-on' : ''} aria-pressed={jours === j} onClick={() => charger(j)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {masque ? <div className="card gg__indispo">Le réseau ne partage pas les avis Google dans l’espace boutique.</div> : null}
      {msg ? <div className={`gg__msg is-${msg.k}`}>{msg.t}</div> : null}
      {loading && !data ? <p className="muted">Lecture des avis…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!masque && rp?.indispo ? <div className="card gg__indispo">Les notes Google ne sont pas disponibles pour l’instant : le réseau doit raccorder les fiches.</div> : null}

      {/* Ma boutique : la carte de la Réputation digitale du BO, et le réseau pour se situer. */}
      {ok && m ? (
        <section className={`card gg__reseau fgg__rep ${ton}`}>
          <div className="gg__bloc">
            <span className="fgg__ligne">
              <span className="gg__kicker">Ma note Google</span>
              <span className="gg__badge">{sans ? 'Sans note' : atteint ? 'À la cible' : `${(m.ecart ?? 0) > 0 ? '+' : ''}${fN(m.ecart)}`}</span>
            </span>
            <div className="gg__moyenne">
              <span className={`gg__moyenne-n ${sans ? 'is-neutre' : atteint ? 'is-bon' : 'is-alerte'}`}>{sans ? '—' : fN(m.note)}</span>
              <Etoiles note={m.note} taille={17} />
            </div>
            <span className="muted gg__sous">
              {sans ? 'Fiche Google pas encore suivie par le réseau' : `${fI(m.avis)} avis sur Google`}
              {m.url ? (
                <>
                  {' · '}
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    ma fiche Google ↗
                  </a>
                </>
              ) : null}
            </span>
            {lus > 0 ? (
              <div className="gg__jauges">
                {(m.repartition?.niveaux ?? []).map((l) => (
                  <div key={l.note} className="gg__jauge">
                    <span className="gg__jauge-note">
                      {l.note}
                      <span style={{ color: COUL[l.note] }}>★</span>
                    </span>
                    <span className="gg__jauge-piste">
                      <span style={{ background: COUL[l.note], width: `${l.n === 0 ? 0 : Math.max(2, (l.n / lus) * 100)}%` }} />
                    </span>
                    <span className="gg__jauge-n">{fI(l.n)}</span>
                    <span className="gg__jauge-pct">{`${Math.round((l.n / lus) * 100)} %`}</span>
                  </div>
                ))}
                <span className="gg__echantillon">{`${fI(lus)} avis lus sur ${fI(m.avis)} — Google ne publie pas la répartition complète d’une fiche.`}</span>
              </div>
            ) : null}
          </div>
          <div className="gg__bloc gg__bloc--filet" title="Chaque avis 5★ rapproche la note de la cible : proposez aux clients contents de laisser un avis sur votre fiche Google.">
            <span className="gg__kicker">Cible du réseau {fN(cible)}</span>
            <span className="fgg__effort">
              {m.avis5Requis == null
                ? sans
                  ? 'Le réseau suivra votre note dès que la fiche est raccordée.'
                  : 'Cible inatteignable par ajout d’avis.'
                : m.avis5Requis === 0
                  ? 'À la cible — bravo, rien à rattraper.'
                  : `${m.avis5Requis} avis 5★ pour atteindre ${fN(cible)}`}
            </span>
          </div>
          <div className="gg__bloc gg__bloc--filet">
            <span className="gg__kicker">Le réseau</span>
            <div className="gg__moyenne">
              <span className="fgg__reseau-n">{fN(res?.moyenne)}</span>
              <Etoiles note={res?.moyenne} taille={13} />
            </div>
            <span className="muted gg__sous">{`Moyenne du réseau · ${fI(res?.avis)} avis sur ${fI(res?.notes)} boutique${pluriel(res?.notes)}`}</span>
            {co.derniereSynchro ? <span className="gg__aide">{`Notes relues chez Google le ${dateHeure(co.derniereSynchro).replace(' ', ' à ')} par le réseau.`}</span> : null}
          </div>
        </section>
      ) : null}

      {/* Faire venir des avis : le QR code de la boutique, son lien, ses affiches ; les avis gagnés. */}
      {m && qr ? (
        <section className="card fgg__qr">
          <svg
            className="gg__qr-code fgg__qr-code"
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            role="img"
            aria-label="QR code vers votre fiche Google"
            shapeRendering="crispEdges"
          >
            <title>Le client scanne le QR code avec son téléphone : la fenêtre « Donner un avis » de votre fiche s’ouvre.</title>
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#1c1a17" />
          </svg>
          <div className="fgg__qr-corps">
            <span
              className="gg__kicker"
              title="Demandez-le aux clients contents, au moment où ils vous remercient. Le lien ci-dessous sert pour vos messages et e-mails."
            >
              Faire venir des avis
            </span>
            <span className="fgg__objectif">
              {m.avis5Requis ? `Objectif : ${m.avis5Requis} avis 5★ pour atteindre ${fN(cible)}` : 'Votre note est à la cible : gardez le rythme des avis.'}
            </span>
            <span className={`fgg__gagnes ${(m.gagnes7 ?? 0) > 0 ? 'is-bon' : 'muted'}`}>
              {m.gagnes7 == null
                ? 'Avis gagnés : suivi à partir d’aujourd’hui.'
                : `Avis gagnés : ${m.gagnes7 > 0 ? '+' : ''}${m.gagnes7} en 7 jours · ${(m.gagnes30 ?? 0) > 0 ? '+' : ''}${m.gagnes30 ?? 0} en 30 jours`}
            </span>
            <div className="gg__qr-lien">
              <input readOnly value={lienSuivi} aria-label="Lien vers la fenêtre d’avis" />
              <button type="button" className="btn btn--sm" onClick={() => copierLien(lienSuivi)}>
                Copier
              </button>
            </div>
            <div className="fgg__qr-actions">
              <a className="btn btn--primary" href={affiche('a5')} target="_blank" rel="noopener noreferrer">
                Imprimer l’affiche A5
              </a>
              <a className="btn" href={affiche('a6')} target="_blank" rel="noopener noreferrer">
                Chevalet de comptoir A6
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {data && !masque ? (
        <>
          <div className="gg__kpis">
            {(
              [
                ['rouge', 'À traiter vite', t.rougeOuverts, `${t.rouge} rouge${pluriel(t.rouge)} sur la période`],
                ['orange', 'À répondre', t.orangeOuverts, `${t.orange} orange${pluriel(t.orange)} sur la période`],
                ['vert', 'Positifs', t.vert, 'un merci sous l’avis suffit'],
                ['', 'Avis lus', t.total, t.aClasser ? `${t.aClasser} en cours de classement` : 'tous classés'],
              ] as [Couleur, string, number, string][]
            ).map(([k, label, value, sub]) => (
              <button key={label} type="button" className={`gg__kpi ${C[k][0]}${couleur === k && k ? ' is-on' : ''}`} onClick={() => choisirKpi(k)}>
                <span className="gg__kpi-label">
                  <span className="gg__point" />
                  {label}
                </span>
                <span className={`gg__kpi-n${k === 'rouge' && value ? ' is-alerte' : ''}`}>{fI(value)}</span>
                <span className="muted gg__kpi-sub">{sub}</span>
              </button>
            ))}
            <button
              type="button"
              className={`gg__kpi is-retard${retard ? ' is-on' : ''}`}
              onClick={() => {
                setRetard(!retard)
                setNonTraites(!retard ? true : nonTraites)
              }}
            >
              <span className="gg__kpi-label">
                <span className="gg__point" />
                En retard
              </span>
              <span className={`gg__kpi-n${t.enRetard ? ' is-alerte' : ''}`}>{String(t.enRetard ?? 0)}</span>
              <span className="muted gg__kpi-sub">
                {`au-delà du délai de réponse${t.delaiMedianH != null ? ` · délai médian ${String(t.delaiMedianH).replace('.', ',')} h` : ''}`}
              </span>
            </button>
          </div>

          <div className="filters__row">
            {(
              [
                ['', 'Tous'],
                ['rouge', 'Rouge'],
                ['orange', 'Orange'],
                ['vert', 'Vert'],
              ] as [Couleur, string][]
            ).map(([k, label]) => (
              <button key={label} type="button" className={`filter gg__filtre ${C[k][0]}${couleur === k ? ' is-on' : ''}`} onClick={() => setCouleur(k)}>
                <span className="gg__point" />
                {label}
              </button>
            ))}
            <label className="gg__case">
              <input type="checkbox" checked={nonTraites} onChange={() => setNonTraites(!nonTraites)} />
              Non traités seulement
            </label>
            <span className="muted gg__etat">
              {(data.relu?.le ? `Relu le ${dateHeure(data.relu.le)} · ` : '') +
                'relu par le réseau toutes les heures' +
                (data.ia?.configure ? ' · classé par Claude' : ' · classé par des règles simples')}
            </span>
          </div>

          {rep ? <div className={`gg__bandeau ${rep.active ? 'is-ok' : 'is-warn'}`}>{repTxt}</div> : null}

          <section className="card table-card gg__table">
            <div className="gg__grille fgg__grille">
              {['Analyse', 'Avis', 'Action conseillée · réponse', 'Suivi'].map((h) => (
                <span key={h} className="gg__th">
                  {h}
                </span>
              ))}
              {liste.map((c) => (
                <LigneAvis
                  key={c.id}
                  c={c}
                  meta={[c.auteur || 'Client Google', dl(c.le)].filter(Boolean).join(' · ')}
                  ouvert={!!ouverts[c.id]}
                  basculer={() => setOuverts((o) => ({ ...o, [c.id]: !o[c.id] }))}
                  direct={!!c.peutRepondre && direct}
                  brouillon={String(brouillons[c.id] ?? c.reponse ?? '')}
                  setBrouillon={(v) => setBrouillons((b) => ({ ...b, [c.id]: v }))}
                  proposant={busyProp === c.id}
                  publiant={busyRep === c.id}
                  proposer={() => proposer(c)}
                  publier={() => publier(c)}
                  copierOuvrir={() => copierOuvrir(c)}
                  repondu={() => repondu(c)}
                  traiter={() => traiter(c)}
                />
              ))}
              {!liste.length ? <div className="gg__vide">{t.total ? 'Aucun avis pour ce filtre.' : 'Aucun avis Google pendant cette période.'}</div> : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function LigneAvis({
  c,
  meta,
  ouvert,
  basculer,
  direct,
  brouillon,
  setBrouillon,
  proposant,
  publiant,
  proposer,
  publier,
  copierOuvrir,
  repondu,
  traiter,
}: {
  c: Commentaire
  meta: string
  ouvert: boolean
  basculer: () => void
  direct: boolean
  brouillon: string
  setBrouillon: (v: string) => void
  proposant: boolean
  publiant: boolean
  proposer: () => void
  publier: () => void
  copierOuvrir: () => void
  repondu: () => void
  traiter: () => void
}) {
  const [classe, label] = C[c.couleur || '']
  const long = (c.message ?? '').length > 280
  const message = !c.message ? 'Note sans commentaire.' : long && !ouvert ? `${c.message.slice(0, 260).replace(/\s+\S*$/, '')} …` : c.message
  const peutRepondre = c.canal === 'gg' && !c.reponseEnvoyee && c.responsable !== 'reseau'
  const envoyee =
    ({ gbp: 'Publiée sur Google', fiche: 'Réponse sur la fiche Google', manuel: 'Répondu sur la fiche (noté ici)' } as Record<string, string>)[c.reponseSource ?? ''] ??
    'Réponse publiée'
  const fond = c.traite ? ' is-traite' : ''
  return (
    <div className="gg__ligne">
      <span className={`gg__cellule gg__analyse fgg__c1${fond}`}>
        <span className={`gg__couleur ${classe}`}>
          <span className="gg__point" />
          {label}
        </span>
        <span className="gg__sujet">{c.sujet || '—'}</span>
        <span className="gg__source">{c.analyse === 'ia' ? 'analyse Claude' : c.analyse === 'regles' ? 'règles simples' : 'pas encore classé'}</span>
        {c.enRetard ? <span className="gg__retard">{`En retard · ${c.ageH ?? 0} h${c.escalade ? ' · remonté au réseau' : ''}`}</span> : null}
      </span>
      <span className={`gg__cellule${fond}`}>
        <span className="gg__avis-tete">
          <Etoiles note={c.note} taille={12} />
          <span className="muted gg__meta">{meta}</span>
        </span>
        <span className={`gg__message${c.message ? '' : ' is-vide'}`}>{message}</span>
        {long ? (
          <button type="button" className="gg__lien-bouton" onClick={basculer}>
            {ouvert ? 'Réduire' : 'Lire tout'}
          </button>
        ) : null}
        {c.resume ? <span className="muted gg__resume">{c.resume}</span> : null}
      </span>
      <span className={`gg__cellule${fond}`}>
        {c.action ? <span className="gg__action">{c.action}</span> : null}
        {peutRepondre ? (
          <>
            <textarea className="gg__brouillon" rows={3} value={brouillon} placeholder="Votre réponse…" onChange={(e) => setBrouillon(e.target.value)} />
            <div className="gg__boutons">
              <button type="button" className="btn btn--sm" onClick={proposer}>
                {proposant ? 'Proposition…' : 'Proposer une réponse'}
              </button>
              {direct ? (
                <button type="button" className={`btn btn--sm gg__publier${publiant ? ' is-busy' : ''}`} onClick={publier}>
                  {publiant ? 'Publication…' : 'Publier sur Google'}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--sm gg__publier" onClick={copierOuvrir}>
                    Copier et ouvrir la fiche
                  </button>
                  <button type="button" className={`btn btn--sm${publiant ? ' is-busy' : ''}`} onClick={repondu}>
                    J’ai répondu sur la fiche
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
        {c.reponseEnvoyee ? (
          <span className="gg__envoyee">
            {envoyee +
              (c.reponseLe ? ` le ${String(c.reponseLe).slice(8, 10)}/${String(c.reponseLe).slice(5, 7)} à ${String(c.reponseLe).slice(11, 16)}` : '') +
              (c.reponsePar ? ` par ${c.reponsePar}` : '') +
              ` : « ${c.reponseEnvoyee} »`}
          </span>
        ) : null}
      </span>
      <span className={`gg__cellule fgg__cz${fond}`}>
        {c.responsable !== 'reseau' ? (
          <label className="gg__case">
            <input type="checkbox" checked={!!c.traite} onChange={traiter} />
            Traité
          </label>
        ) : (
          <span className="muted fgg__reseau">{c.traite ? 'Traité par le réseau' : 'Pris en charge par le réseau'}</span>
        )}
        <span className="gg__source">{c.traite ? `le ${dateHeure(c.traiteLe)}${c.traitePar ? ` · ${c.traitePar}` : ''}` : ''}</span>
        {c.lien ? (
          <a href={c.lien} target="_blank" rel="noopener noreferrer" className="gg__fiche">
            Fiche Google ↗
          </a>
        ) : null}
      </span>
    </div>
  )
}
