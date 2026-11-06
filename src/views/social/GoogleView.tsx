import { useCallback, useEffect, useRef, useState } from 'react'
import './social.css'
import './google.css'
import { ROOTS } from '../../lib/api/module'
import { qrPath } from '../../lib/qr'
import { useSocial } from '../../lib/social/store'
import { dShort, iso } from '../../lib/social/format'
import {
  lireGoogle,
  noterReponduSurFiche,
  proposerReponse,
  publierReponse,
  reglerGoogle,
  relireGoogle,
  synchroniserGoogle,
  traiterAvis,
} from '../../lib/social/api-google'
import type { AvisGoogle, Couleur, MagasinReputation, Repartition, VueGoogle } from '../../lib/social/api-google'

/**
 * Avis Google — l'écran « Google » du module Social (SA Google.dc.html), réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Ce que Google dit de chaque boutique : la Réputation digitale du BO (note, cible,
 * avis 5★ à obtenir, répartition des avis lus) et les avis, classés vert / orange / rouge comme les commentaires
 * (social/src/google.php). « Synchroniser chez Google » demande au BO de relire les fiches (appel facturé par Google).
 */

type Jours = 30 | 90 | 365 | 3650
const PERIODES: [Jours, string][] = [
  [30, '30 j'],
  [90, '90 j'],
  [365, '1 an'],
  [3650, 'Tout'],
]
type Ton = 'ok' | 'warn' | 'err'
const C: Record<string, [string, string]> = { rouge: ['is-rouge', 'Rouge'], orange: ['is-orange', 'Orange'], vert: ['is-vert', 'Vert'], '': ['is-classer', 'À classer'] }
const COUL: Record<number, string> = { 5: '#C9A227', 4: '#2d7a3e', 3: '#D97706', 2: '#C0182B', 1: '#8D1D2C' }
const ORDRE: Record<string, number> = { rouge: 0, orange: 1, '': 2, vert: 3 }

const fN = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','))
const fI = (v: number | null | undefined) => Number(v || 0).toLocaleString('fr-BE')
const pluriel = (n: number | null | undefined, s = 's') => ((n ?? 0) > 1 ? s : '')

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

function Jauges({ rep, avisGoogle }: { rep: Repartition | undefined; avisGoogle: number | null | undefined }) {
  const lus = rep?.lus ?? 0
  return (
    <div className="gg__jauges">
      {(rep?.niveaux ?? []).map((l) => (
        <div key={l.note} className="gg__jauge">
          <span className="gg__jauge-note">
            {l.note}
            <span style={{ color: COUL[l.note] }}>★</span>
          </span>
          <span className="gg__jauge-piste">
            <span style={{ background: COUL[l.note], width: `${l.n === 0 ? 0 : Math.max(2, (l.n / lus) * 100)}%` }} />
          </span>
          <span className="gg__jauge-n">{fI(l.n)}</span>
          <span className="gg__jauge-pct">{lus ? `${Math.round((l.n / lus) * 100)} %` : ''}</span>
        </div>
      ))}
      <span className="gg__echantillon">
        {!lus ? 'Aucun avis rapatrié pour l’instant.' : `${fI(lus)} avis lus sur ${fI(avisGoogle)} — Google ne publie pas la répartition complète d’une fiche.`}
      </span>
    </div>
  )
}

function parametresDeDepart() {
  const p = new URLSearchParams(window.location.search)
  const j = Number(p.get('jours'))
  const c = p.get('couleur') ?? ''
  const sh = p.get('shop') ?? ''
  const couleur = (['rouge', 'orange', 'vert'].includes(c) ? c : '') as Couleur
  return {
    jours: ([30, 90, 365, 3650].includes(j) ? j : 365) as Jours,
    couleur,
    nonTraites: couleur !== '' && couleur !== 'vert',
    shop: sh,
  }
}

export default function GoogleView() {
  const { serveur } = useSocial()
  const today = serveur?.today ?? iso(new Date())
  const [depart] = useState(parametresDeDepart)
  const [jours, setJours] = useState<Jours>(depart.jours)
  const [couleur, setCouleur] = useState<Couleur>(depart.couleur)
  const [shop, setShop] = useState(depart.shop)
  const [nonTraites, setNonTraites] = useState(depart.nonTraites)
  const [retard, setRetard] = useState(false)
  const [data, setData] = useState<VueGoogle | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'' | 'relire' | 'sync'>('')
  const [msg, setMsgTexte] = useState('')
  const [msgKind, setMsgKind] = useState<Ton>('ok')
  const [qrShop, setQrShop] = useState('')
  const [brouillons, setBrouillons] = useState<Record<string, string>>({})
  const [busyRep, setBusyRep] = useState('')
  const [busyProp, setBusyProp] = useState('')
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const cle = useRef(0)
  const haut = useRef<HTMLDivElement>(null)

  const dire = (m: string, k: Ton) => {
    setMsgTexte(m)
    setMsgKind(k)
  }

  const charger = useCallback((j: Jours) => {
    const k = ++cle.current
    setJours(j)
    setLoading(true)
    setErr('')
    lireGoogle(j)
      .then((r) => {
        if (k === cle.current) {
          setData(r)
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (k === cle.current) {
          setLoading(false)
          setErr(e instanceof Error ? e.message : 'erreur')
        }
      })
  }, [])
  useEffect(() => {
    charger(depart.jours)
  }, [charger, depart.jours])

  const maintenant = () => {
    const now = new Date()
    return `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }

  const geste = (quoi: 'sync' | 'relire') => {
    if (busy) return
    setBusy(quoi)
    setMsgTexte('')
    ;(quoi === 'sync' ? synchroniserGoogle(jours) : relireGoogle(jours))
      .then((r) => {
        const a = r.analyse ?? {}
        const b = r.bo
        const sy = r.sync ?? {}
        const cl = `${a.classes ?? 0} avis classé${pluriel(a.classes)}${a.classes ? (a.ia && !a.erreur ? ' par Claude' : ' par les règles simples') : ''}`
        const txt =
          (b
            ? `${b.magasins} fiche${pluriel(b.magasins)} relue${pluriel(b.magasins)} chez Google, ${b.nouveaux} nouvel${pluriel(b.nouveaux)} avis` +
              (b.erreurs?.length ? ` — en échec : ${b.erreurs.join(' · ')}` : '') +
              (b.aucuneFiche ? ' — aucune fiche raccordée : raccordez-les dans le BO (Réputation digitale).' : '') +
              ' · '
            : `${sy.lus ?? 0} avis relus dans le BO · `) +
          cl +
          (a.erreur ? ` — Claude n’a pas répondu (${a.erreur}) : classés par les règles.` : '.')
        setData(r)
        setBusy('')
        dire(txt, a.erreur || b?.erreurs?.length ? 'warn' : 'ok')
      })
      .catch((e: unknown) => {
        setBusy('')
        dire(`${quoi === 'sync' ? 'Synchronisation impossible : ' : 'Relecture impossible : '}${e instanceof Error ? e.message : 'erreur'}`, 'err')
      })
  }

  const traiter = (c: AvisGoogle) => {
    traiterAvis(c.id, !c.traite)
      .then(() => {
        setData((d) => {
          if (!d) return d
          const le = maintenant()
          const avis = d.avis.map((x) =>
            x.id === c.id ? { ...x, traite: !c.traite, traiteLe: !c.traite ? le : null, traitePar: !c.traite ? 'vous' : '' } : x,
          )
          const totaux = { ...d.totaux }
          if (c.couleur === 'rouge') totaux.rougeOuverts += c.traite ? 1 : -1
          if (c.couleur === 'orange') totaux.orangeOuverts += c.traite ? 1 : -1
          return { ...d, avis, totaux }
        })
      })
      .catch((e: unknown) => dire(`Non enregistré : ${e instanceof Error ? e.message : 'erreur'}`, 'err'))
  }

  const reglages = (r: { actif: boolean; heure: number }) => {
    reglerGoogle(r)
      .then((x) => setData((d) => (d ? { ...d, reglages: x.reglages } : d)))
      .catch((e: unknown) => dire(`Réglage non enregistré : ${e instanceof Error ? e.message : 'erreur'}`, 'err'))
  }

  const texte = (c: AvisGoogle) => String(brouillons[c.id] ?? c.reponse ?? '').trim()
  const marquer = (c: AvisGoogle, t: string, source: string) => {
    setData((d) => {
      if (!d) return d
      const le = maintenant()
      const avis = d.avis.map((x) =>
        x.id === c.id
          ? {
              ...x,
              reponseEnvoyee: t,
              reponseSource: source,
              reponseLe: le,
              reponsePar: 'vous',
              traite: true,
              traiteLe: x.traiteLe || le,
              traitePar: x.traitePar || 'vous',
              enRetard: false,
            }
          : x,
      )
      const totaux = { ...d.totaux }
      if (!c.traite && c.couleur === 'rouge') totaux.rougeOuverts -= 1
      if (!c.traite && c.couleur === 'orange') totaux.orangeOuverts -= 1
      return { ...d, avis, totaux }
    })
  }
  const proposer = (c: AvisGoogle) => {
    if (busyProp) return
    setBusyProp(c.id)
    proposerReponse(c.id)
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
        dire(`Proposition impossible : ${e instanceof Error ? e.message : 'erreur'}`, 'err')
      })
  }
  const publier = (c: AvisGoogle) => {
    const t = texte(c)
    if (busyRep) return
    if (!t) {
      dire('Écrivez (ou faites proposer) la réponse d’abord.', 'warn')
      return
    }
    if (!window.confirm('Publier cette réponse sous l’avis, sur la fiche Google de la boutique ? Elle sera visible de tous.')) return
    setBusyRep(c.id)
    publierReponse(c.id, t)
      .then(() => {
        setBusyRep('')
        dire('Réponse publiée sur Google, sous l’avis.', 'ok')
        marquer(c, t, 'gbp')
      })
      .catch((e: unknown) => {
        setBusyRep('')
        dire(e instanceof Error ? e.message : 'Publication impossible.', 'err')
      })
  }
  const copierOuvrir = (c: AvisGoogle) => {
    const t = texte(c)
    const ok = () => dire('Réponse copiée : collez-la sous l’avis sur la fiche Google, publiez, puis « J’ai répondu sur la fiche ».', 'ok')
    try {
      if (t) navigator.clipboard.writeText(t).then(ok, ok)
      else ok()
    } catch {
      ok()
    }
    if (c.lien) window.open(c.lien, '_blank', 'noopener')
  }
  const repondu = (c: AvisGoogle) => {
    const t = texte(c)
    if (busyRep) return
    if (!t) {
      dire('Collez ici la réponse publiée sur la fiche.', 'warn')
      return
    }
    setBusyRep(c.id)
    noterReponduSurFiche(c.id, t)
      .then(() => {
        setBusyRep('')
        dire('Réponse notée : l’avis est traité.', 'ok')
        marquer(c, t, 'manuel')
      })
      .catch((e: unknown) => {
        setBusyRep('')
        dire(e instanceof Error ? e.message : 'Non enregistré.', 'err')
      })
  }
  const copierLien = (t: string) => {
    try {
      void navigator.clipboard.writeText(t).then(() => dire('Lien copié : à coller sur le ticket, dans un e-mail ou un message.', 'ok'))
    } catch {
      /* rien */
    }
  }

  const d = data
  const rp = d?.reputation ?? null
  const ok = !!rp && !rp.indispo
  const cible = ok ? rp.cible : 4.5
  const res = (ok && rp.reseau) || null
  const co = (ok && rp.connecteur) || {}
  const effort =
    res?.avis5Requis == null
      ? res?.moyenne == null
        ? 'Aucune note connue.'
        : 'Cible inatteignable par ajout d’avis.'
      : res.avis5Requis > 0
        ? `${fI(res.avis5Requis)} avis 5★ pour ramener le réseau à ${fN(cible)}`
        : (res.sousCible ?? 0) > 0
          ? `Réseau à la cible en moyenne pondérée — l’effort porte sur les ${res.sousCible} boutiques en dessous.`
          : 'Aucun avis à obtenir : toutes les boutiques sont à la cible.'
  // Les plus loin de la cible d'abord ; sans note à la fin (fiche à raccorder dans le BO).
  const mags = ((ok && rp.magasins) || [])
    .slice()
    .sort((a, b) => Number(a.note == null) - Number(b.note == null) || (a.note == null || b.note == null ? a.nom.localeCompare(b.nom) : a.note - b.note))
  const avisTous = d?.avis ?? []
  const gagnes = (m: MagasinReputation) =>
    m.gagnes7 == null
      ? 'Avis gagnés : suivi à partir d’aujourd’hui'
      : `Avis gagnés : ${m.gagnes7 > 0 ? '+' : ''}${m.gagnes7} en 7 j · ${(m.gagnes30 ?? 0) > 0 ? '+' : ''}${m.gagnes30 ?? 0} en 30 j` +
        (rp?.suiviDepuis ? ` (suivi depuis le ${dShort(rp.suiviDepuis)})` : '') +
        (m.scans30 ? ` · ${m.scans30} clic${pluriel(m.scans30)} sur le lien suivi en 30 j` : '')

  const t = d?.totaux ?? { rouge: 0, orange: 0, vert: 0, aClasser: 0, rougeOuverts: 0, orangeOuverts: 0, total: 0 }
  const choisirKpi = (k: Couleur) => {
    setCouleur(couleur === k ? '' : k)
    setNonTraites(couleur === k ? nonTraites : k !== 'vert' && k !== '')
  }
  const liste = avisTous
    .filter((c) => (!couleur || c.couleur === couleur) && (!shop || c.shopId === shop) && (!nonTraites || !c.traite) && (!retard || c.enRetard))
    .sort(
      (a, b) =>
        (a.traite ? 1 : 0) - (b.traite ? 1 : 0) || ORDRE[a.couleur || ''] - ORDRE[b.couleur || ''] || String(b.le).localeCompare(String(a.le)),
    )
  const dl = (x: string | undefined) => (x ? dShort(x.slice(0, 10)) + (x.slice(0, 4) !== today.slice(0, 4) ? `/${x.slice(2, 4)}` : '') : '')
  const rg = d?.reglages ?? { actif: true, heure: 6, dernier: null }
  const dern = rg.dernier
  const mq = mags.find((m) => m.id === qrShop)
  const rep = d?.reponses ?? null
  const repTxt = !rep
    ? ''
    : rep.active
      ? `Réponse directe sur Google : branchée. « Publier sur Google » publie la réponse sous l’avis, sur la fiche${rep.fiches ? ` (${rep.fiches} fiche${pluriel(rep.fiches)} rattachée${pluriel(rep.fiches)})` : ''}.`
      : `Réponse directe sur Google : pas encore branchée. ${rep.raison ?? ''} En attendant : « Proposer une réponse », relisez, « Copier et ouvrir la fiche », publiez-la sous l’avis, puis « J’ai répondu sur la fiche ».`

  // Le QR code et les affiches mènent DIRECTEMENT à la fenêtre d'avis Google : un papier imprimé ne doit dépendre ni du
  // serveur du module ni de son adresse. Le lien court (qui compte les clics) sert aux messages et aux e-mails.
  const qr = mq?.lienAvis ? qrPath(mq.lienAvis) : null
  const affiche = (f: string) =>
    mq?.lienAvis
      ? `${ROOTS.social}${encodeURI('Affiche avis.html')}?u=${encodeURIComponent(mq.lienAvis)}&nom=${encodeURIComponent(mq.nom)}&langues=${encodeURIComponent(
          (mq.langs ?? ['fr']).join(','),
        )}&format=${f}`
      : '#'
  const lienSuivi = `${mq?.lienCourt ?? ''}?s=lien`

  useEffect(() => {
    if (!qrShop) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setQrShop('')
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [qrShop])

  return (
    <div className="social-native gg" ref={haut}>
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">Ce que Google dit de chaque boutique · la Réputation digitale du BO, avis lus dans leur contexte</span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période">
            {PERIODES.map(([j, label]) => (
              <button key={j} type="button" className={jours === j ? 'is-on' : ''} aria-pressed={jours === j} onClick={() => charger(j)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={`btn${busy ? ' is-busy' : ''}`} onClick={() => geste('relire')}>
            {busy === 'relire' ? 'Relecture…' : 'Relire et classer'}
          </button>
          <button type="button" className={`btn btn--primary${busy ? ' is-busy' : ''}`} onClick={() => geste('sync')}>
            {busy === 'sync' ? 'Synchronisation…' : 'Synchroniser chez Google'}
          </button>
        </div>
      </div>

      {msg ? <div className={`gg__msg is-${msgKind}`}>{msg}</div> : null}
      {loading && !d ? <p className="muted">Lecture des avis…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {rp?.indispo ? (
        <div className="card gg__indispo">{`${rp.raison || 'Réputation indisponible.'} Les avis Google viennent de l’écran Réputation digitale du BO.`}</div>
      ) : null}

      {/* La réputation du réseau : les trois blocs de l'écran Réputation digitale du BO. */}
      {ok && res ? (
        <section className="card gg__reseau">
          <div className="gg__bloc">
            <span className="gg__kicker">Moyenne réseau</span>
            <div className="gg__moyenne">
              <span className={`gg__moyenne-n ${res.moyenne == null ? 'is-neutre' : res.moyenne >= cible ? 'is-bon' : 'is-alerte'}`}>{fN(res.moyenne)}</span>
              <Etoiles note={res.moyenne} taille={17} />
            </div>
            <span className="muted gg__sous">
              {`${fI(res.avis)} avis Google · ${fI(res.notes)} boutique${pluriel(res.notes)} notée${pluriel(res.notes)}${res.magasins > res.notes ? ` sur ${fI(res.magasins)}` : ''}`}
            </span>
            {res.gagnes7 != null ? (
              <span className={`gg__sous ${(res.gagnes7 ?? 0) > 0 ? 'is-bon' : 'muted'}`}>
                {`Avis gagnés : ${res.gagnes7 > 0 ? '+' : ''}${fI(res.gagnes7)} en 7 j · ${(res.gagnes30 ?? 0) > 0 ? '+' : ''}${fI(res.gagnes30)} en 30 j${
                  res.scans30 ? ` · ${fI(res.scans30)} clics sur les liens suivis` : ''
                }`}
              </span>
            ) : null}
            <Jauges rep={res.repartition} avisGoogle={res.avis} />
          </div>
          <div className="gg__bloc gg__bloc--filet">
            <span className="gg__kicker">Cible {fN(cible)}</span>
            <span className="gg__titre">
              {(res.sousCible ?? 0) === 0
                ? 'Toutes les boutiques notées sont à la cible.'
                : `${res.sousCible} boutique${pluriel(res.sousCible)} sous ${fN(cible)}`}
            </span>
            <span className={`gg__effort ${(res.avis5Requis ?? 0) > 0 ? 'is-alerte' : 'muted'}`}>{effort}</span>
            <span className="gg__aide">La cible se règle dans les Paramètres du BO ; les mêmes chiffres que l’écran Réputation digitale.</span>
          </div>
          <div className="gg__bloc gg__bloc--filet">
            <span className="gg__kicker">Connecteur Google (BO)</span>
            <span className={`gg__co ${co.configure ? '' : 'is-alerte'}`}>
              {co.configure
                ? `${co.raccordes ?? 0} fiche${pluriel(co.raccordes)} raccordée${pluriel(co.raccordes)} · ` +
                  (co.derniereSynchro
                    ? `dernière synchronisation le ${dShort(co.derniereSynchro.slice(0, 10))} à ${co.derniereSynchro.slice(11, 16)}`
                    : 'jamais synchronisé')
                : 'Aucune clé Google dans le BO'}
            </span>
            <span className="gg__aide">
              {co.configure
                ? 'Google ne rend que 5 avis par fiche et par lecture : le BO les accumule à chaque synchronisation (appel facturé par Google). La clé et le raccordement des fiches se règlent dans le BO.'
                : 'Renseignez la clé Google Places dans les Paramètres du BO, puis raccordez chaque fiche dans Réputation digitale.'}
            </span>
            <label className="gg__auto">
              <input type="checkbox" checked={!!rg.actif} onChange={() => reglages({ actif: !rg.actif, heure: rg.heure })} />
              Synchroniser chaque jour à
              <select value={String(rg.heure)} onChange={(e) => reglages({ actif: rg.actif, heure: +e.target.value })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {h} h
                  </option>
                ))}
              </select>
            </label>
            <span className={`gg__aide ${dern && dern.ok === false ? 'is-alerte' : ''}`}>
              {!rg.actif
                ? 'Synchronisation automatique coupée : seulement au clic.'
                : dern
                  ? `Dernière synchronisation automatique le ${dShort(String(dern.le).slice(0, 10))} à ${String(dern.le).slice(11, 16)} : ${dern.message ?? ''}`
                  : `Une lecture par fiche et par jour (facturée par Google), à partir de ${rg.heure} h.`}
            </span>
          </div>
        </section>
      ) : null}

      {d ? (
        <>
          <div className="gg__kpis">
            {(
              [
                ['rouge', 'À traiter vite', t.rougeOuverts, `${t.rouge} rouge${pluriel(t.rouge)} sur la période`],
                ['orange', 'À répondre', t.orangeOuverts, `${t.orange} orange${pluriel(t.orange)} sur la période`],
                ['vert', 'Positifs', t.vert, 'un merci sous l’avis suffit'],
                ['', 'Avis lus', t.total, t.aClasser ? `${t.aClasser} à classer (relire)` : 'tous classés'],
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
            <select className="gg__select" value={shop} onChange={(e) => setShop(e.target.value)}>
              <option value="">Toutes les boutiques</option>
              {mags.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </select>
            <label className="gg__case">
              <input type="checkbox" checked={nonTraites} onChange={() => setNonTraites(!nonTraites)} />
              Non traités seulement
            </label>
            <span className="muted gg__etat">
              {(d.relu?.le ? `Relu dans le BO le ${dShort(d.relu.le.slice(0, 10))} ${d.relu.le.slice(11, 16)} · ` : '') +
                (d.ia?.configure ? 'analyse par Claude' : 'analyse par règles simples (clé Claude : Paramètres → Rédaction IA)') +
                ' · relu toutes les heures'}
            </span>
          </div>

          {rep && !d.hidden ? <div className={`gg__bandeau ${rep.active ? 'is-ok' : 'is-warn'}`}>{repTxt}</div> : null}

          <section className="card table-card gg__table">
            <div className="gg__grille">
              {['Analyse', 'Avis', 'Action conseillée · réponse', 'Suivi'].map((h) => (
                <span key={h} className="gg__th">
                  {h}
                </span>
              ))}
              {liste.map((c) => (
                <Ligne
                  key={c.id}
                  c={c}
                  ouvert={!!ouverts[c.id]}
                  basculer={() => setOuverts((o) => ({ ...o, [c.id]: !o[c.id] }))}
                  meta={[c.auteur || 'Client Google', dl(c.le), c.boutique].filter(Boolean).join(' · ')}
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
              {!liste.length ? (
                <div className="gg__vide">
                  {t.total
                    ? 'Aucun avis pour ce filtre.'
                    : 'Aucun avis sur la période. Les avis viennent des fiches Google raccordées dans le BO : « Synchroniser chez Google » les relit.'}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {/* Par boutique : les cartes de la Réputation digitale, la plus loin de la cible d'abord. */}
      {ok ? (
        <>
          <span className="section-label">Par boutique · la plus loin de la cible d’abord</span>
          <div className="gg__cartes">
            {mags.map((m) => {
              const sans = m.note == null || !m.avis
              const atteint = !sans && (m.note ?? 0) >= cible
              const nAvis = avisTous.filter((a) => a.shopId === m.id).length
              const ton = sans ? 'is-sans' : atteint ? 'is-atteint' : 'is-sous'
              return (
                <div key={m.id} className={`card gg__carte ${ton}`}>
                  <div className="gg__carte-tete">
                    <div className="gg__carte-nom">
                      <span className="gg__carte-ligne">
                        <span>{m.nom}</span>
                        <span className="gg__badge">{sans ? 'Sans note' : atteint ? 'À la cible' : `${(m.ecart ?? 0) > 0 ? '+' : ''}${fN(m.ecart)}`}</span>
                      </span>
                      <span className="muted gg__carte-sous">
                        {sans
                          ? m.raccorde
                            ? 'Fiche raccordée, pas encore de note'
                            : 'Fiche Google non raccordée (BO → Réputation digitale)'
                          : `${fI(m.avis)} avis${m.synchro ? ` · maj ${dShort(m.synchro.slice(0, 10))}` : ''}`}
                        {m.url ? (
                          <>
                            {' · '}
                            <a href={m.url} target="_blank" rel="noopener noreferrer">
                              fiche Google ↗
                            </a>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="gg__carte-note">
                      <span className="gg__carte-n">{sans ? '—' : fN(m.note)}</span>
                      <Etoiles note={m.note} taille={14} />
                    </div>
                  </div>
                  <span className="gg__carte-effort">
                    {m.avis5Requis == null
                      ? sans
                        ? 'Raccordez la fiche dans le BO pour suivre la note.'
                        : 'Cible inatteignable par ajout d’avis.'
                      : m.avis5Requis === 0
                        ? 'À la cible — rien à rattraper.'
                        : `${m.avis5Requis} avis 5★ pour atteindre ${fN(cible)}`}
                  </span>
                  {(m.repartition?.lus ?? 0) > 0 ? <Jauges rep={m.repartition} avisGoogle={m.avis} /> : null}
                  <span className="gg__carte-gagnes">{sans ? '' : gagnes(m)}</span>
                  <div className="gg__carte-actions">
                    {m.lienAvis ? (
                      <button type="button" className="btn btn--sm" onClick={() => setQrShop(m.id)}>
                        Faire venir des avis (QR)
                      </button>
                    ) : null}
                    {nAvis > 0 ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => {
                          setShop(m.id)
                          haut.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                      >
                        Voir ses {nAvis} avis
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {/* Faire venir des avis : le QR code de la boutique, son lien et ses affiches. */}
      {mq && mq.lienAvis && qr ? (
        <div className="confirm" onClick={() => setQrShop('')}>
          <div className="card gg__qr" onClick={(e) => e.stopPropagation()}>
            <span className="gg__kicker">Faire venir des avis · L’Atelier By {mq.nom}</span>
            <svg className="gg__qr-code" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code vers la fiche Google" shapeRendering="crispEdges">
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.d} fill="#1c1a17" />
            </svg>
            <span className="gg__qr-texte">
              Le client scanne avec l’appareil photo de son téléphone : la fenêtre « Donner un avis » de la fiche Google s’ouvre directement.
            </span>
            <div className="gg__qr-lien">
              <input readOnly value={mq.lienAvis} />
              <button type="button" className="btn btn--sm" onClick={() => copierLien(mq.lienAvis ?? '')}>
                Copier
              </button>
            </div>
            {mq.lienCourt ? (
              <span className="muted gg__qr-suivi">
                Pour un message ou un e-mail : le{' '}
                <button type="button" className="gg__lien-bouton" onClick={() => copierLien(lienSuivi)}>
                  lien suivi
                </button>{' '}
                compte les clics ({`${mq.scans30 ?? 0} clic${pluriel(mq.scans30)} en 30 jours`}).
              </span>
            ) : null}
            <div className="gg__qr-actions">
              <a className="btn btn--primary" href={affiche('a5')} target="_blank" rel="noopener noreferrer">
                Affiche A5
              </a>
              <a className="btn" href={affiche('a6')} target="_blank" rel="noopener noreferrer">
                Chevalet de comptoir A6
              </a>
              <a className="btn" href={mq.lienAvis} target="_blank" rel="noopener noreferrer">
                Voir la fenêtre d’avis ↗
              </a>
            </div>
            <span className="gg__aide">
              Idées : l’affiche près de la caisse, le chevalet sur le comptoir, le lien sur le ticket et dans l’e-mail de commande du webshop. Seuls les clients contents à
              qui on le demande donnent un avis : demandez-le au moment où ils vous remercient.
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQrShop('')}>
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Ligne({
  c,
  ouvert,
  basculer,
  meta,
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
  c: AvisGoogle
  ouvert: boolean
  basculer: () => void
  meta: string
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
  const peutRepondre = c.canal === 'gg' && !c.reponseEnvoyee
  const envoyee =
    ({ gbp: 'Publiée sur Google', fiche: 'Réponse sur la fiche Google', manuel: 'Répondu sur la fiche (noté ici)' } as Record<string, string>)[c.reponseSource ?? ''] ??
    'Réponse publiée'
  const fond = c.traite ? ' is-traite' : ''
  return (
    <div className="gg__ligne">
      <span className={`gg__cellule gg__analyse${fond}`}>
        <span className={`gg__couleur ${classe}`}>
          <span className="gg__point" />
          {label}
        </span>
        <span className="gg__sujet">{c.sujet || '—'}</span>
        <span className="gg__source">{c.analyse === 'ia' ? 'analyse Claude' : c.analyse === 'regles' ? 'règles simples' : 'pas encore classé'}</span>
        {c.enRetard ? <span className="gg__retard">{`En retard · ${c.ageH ?? 0} h${c.escalade ? ' · remonté au réseau' : ''}`}</span> : null}
        <span className="muted gg__resp">
          {c.responsable === 'reseau' ? 'À traiter par le réseau' : `À traiter par la boutique${c.escalade ? ' (en retard : le réseau peut répondre)' : ''}`}
        </span>
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
              {c.peutRepondre ? (
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
      <span className={`gg__cellule${fond}`}>
        <label className="gg__case">
          <input type="checkbox" checked={!!c.traite} onChange={traiter} />
          Traité
        </label>
        <span className="gg__source">{c.traite ? `le ${c.traiteLe ? `${dShort(c.traiteLe.slice(0, 10))} ${c.traiteLe.slice(11, 16)}` : ''}${c.traitePar ? ` · ${c.traitePar}` : ''}` : ''}</span>
        {c.lien ? (
          <a href={c.lien} target="_blank" rel="noopener noreferrer" className="gg__fiche">
            Fiche Google ↗
          </a>
        ) : null}
      </span>
    </div>
  )
}
