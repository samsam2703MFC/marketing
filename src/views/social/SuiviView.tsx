import { useEffect, useMemo, useState } from 'react'
import './social.css'
import * as api from '../../lib/api/module'
import type { SocialSuivi, SuiviLigne } from '../../lib/api/module'

type Jours = 7 | 28 | 90
const PERIODES: Jours[] = [7, 28, 90]

const nombre = (v: number, d = 0) => v.toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d })
const signe = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${nombre(n)}`)
const ton = (n: number | null | undefined) => (n == null ? 'is-neutre' : n > 0 ? 'is-bon' : n < 0 ? 'is-alerte' : '')
const jourCourt = (iso: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : '')
const jourLong = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })

function jours(du: string, au: string): string[] {
  const out: string[] = []
  const d = new Date(`${du}T12:00:00`)
  const fin = new Date(`${au}T12:00:00`)
  while (d <= fin && out.length < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function initiales(nom: string): string {
  return (
    nom
      .replace(/^l[’']atelier\s*by\s*[-–·]?\s*/i, '')
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || 'AB'
  )
}

/** Le motif court d'une série manquante (le détail de Meta en info-bulle). */
function motifCourt(m: string, reseau: string): string {
  if (/read_insights|séries vides/.test(m)) return `${reseau} : abonnés jour par jour indisponibles — permission « read_insights » à ajouter au token.`
  if (/instagram_manage_insights|permission/i.test(m))
    return `${reseau} : abonnés jour par jour indisponibles — permission « instagram_manage_insights » à ajouter au token.`
  if (/30 derniers jours/.test(m)) return 'Instagram : 30 derniers jours seulement.'
  return `${reseau} : ${m}`
}

/**
 * Suivi des boutiques (« Abonnés & budget ») — l'écran « Suivi » du module Social, réécrit dans le
 * Marketing (docs/PORTAILS.md, étape 2f). Abonnés Facebook + Instagram de chaque Page face au budget
 * publicitaire, lus en direct chez Meta (API de Social, /suivi/abonnes) : rien n'est copié en base.
 */
export default function SuiviView() {
  const [periode, setPeriode] = useState<Jours>(28)
  const [tour, setTour] = useState(0)
  const [data, setData] = useState<SocialSuivi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let annule = false
    setLoading(true)
    setError(null)
    api
      .getSocialSuivi(periode)
      .then((r) => !annule && setData(r))
      .catch((cause: unknown) => !annule && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !annule && setLoading(false))
    return () => {
      annule = true
    }
  }, [periode, tour])

  const r = data && data.jours === periode ? data : null
  const argent = (v: number, d = 0) =>
    r?.devise === 'EUR' || !r ? `${nombre(v, d)} €` : `${nombre(v, d)} ${r.devise}`

  const vue = useMemo(() => {
    if (!r) return null
    const L = r.lignes ?? []
    const somme = (f: (x: SuiviLigne) => number | null | undefined) => L.reduce((a, x) => a + (f(x) ?? 0), 0)
    const abonnes = somme((x) => x.facebook?.followers) + somme((x) => x.instagram?.followers)
    const connus = L.filter((x) => x.abonnesNet != null)
    const net = connus.reduce((a, x) => a + (x.abonnesNet ?? 0), 0)
    const budget = somme((x) => x.depense) + (r.nonAttribue ?? 0)
    const ds = jours(r.du, r.au)
    const maxBudget = Math.max(1, ...L.map((x) => Math.max(0, ...Object.values(x.depenseJours ?? {}))))
    const flux = (x: SuiviLigne, d: string) => {
      const f = x.facebook?.serie?.[d] ?? null
      const i = x.instagram?.serie?.[d] ?? null
      return f || i ? { g: (f?.gagnes ?? 0) + (i?.gagnes ?? 0), p: f?.perdus ?? 0 } : null
    }
    const maxFlux = Math.max(1, ...L.flatMap((x) => ds.map((d) => { const v = flux(x, d); return v ? Math.max(v.g, v.p) : 0 })))
    return { L, abonnes, connus, net, budget, ds, maxBudget, flux, maxFlux }
  }, [r])

  return (
    <div className="social-native">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">
            {r
              ? `${r.demo ? 'Démonstration · ' : `Lu chez Meta à ${String(r.le ?? '').slice(11, 16)} · `}du ${jourCourt(r.du)} au ${jourCourt(r.au)}`
              : 'Abonnés Facebook + Instagram face au budget publicitaire · lu en direct chez Meta'}
          </span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période">
            {PERIODES.map((j) => (
              <button key={j} type="button" className={periode === j ? 'is-on' : ''} aria-pressed={periode === j} onClick={() => setPeriode(j)}>
                {j} j
              </button>
            ))}
          </div>
          <button type="button" className="btn" disabled={loading} onClick={() => setTour((t) => t + 1)}>
            {loading ? 'Lecture…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {error ? <p className="error">Lecture chez Meta impossible : {error}</p> : null}
      {loading && !r ? <p className="muted">Lecture des Pages, des comptes Instagram et des comptes publicitaires chez Meta…</p> : null}

      {r && vue ? (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <div className="kpi__label">Abonnés aujourd’hui</div>
              <div className="kpi__value">{nombre(vue.abonnes)}</div>
              <div className="kpi__note">Facebook + Instagram, {vue.L.length} Page(s)</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Gagnés nets · {r.jours} j</div>
              <div className={`kpi__value ${ton(vue.connus.length ? vue.net : null)}`}>{vue.connus.length ? signe(vue.net) : '—'}</div>
              <div className="kpi__note">{vue.connus.length ? `${vue.connus.length} Page(s) mesurée(s)` : 'historique indisponible (permissions)'}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Budget dépensé · {r.jours} j</div>
              <div className="kpi__value">{argent(vue.budget)}</div>
              <div className="kpi__note">{r.nonAttribue ? `${argent(r.nonAttribue)} non rattachés à une Page` : 'toutes les pubs des comptes'}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Coût par abonné gagné</div>
              <div className="kpi__value">{vue.net > 0 && vue.budget > 0 ? argent(vue.budget / vue.net, 2) : '—'}</div>
              <div className="kpi__note">budget ÷ abonnés nets</div>
            </div>
          </div>

          <div className="suivi__cartes">
            {vue.L.map((x) => (
              <CartePage key={x.id ?? x.name} x={x} r={r} ds={vue.ds} maxBudget={vue.maxBudget} maxFlux={vue.maxFlux} flux={vue.flux} argent={argent} />
            ))}
          </div>

          <Classement L={vue.L} argent={argent} />

          <p className="muted bilan__legende">
            Abonnés : insights des Pages (gagnés et perdus par jour) et d’Instagram (nouveaux abonnés, 30 derniers jours au plus). Budget :
            dépense des pubs, rapportée à la Page qui les porte. Rien n’est copié en base : tout est relu chez Meta à chaque ouverture.
            {r.erreurs?.length ? ` Erreurs : ${r.erreurs.join(' · ')}` : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}

function Avatar({ x, taille }: { x: SuiviLigne; taille: number }) {
  return x.picture ? (
    <img className="suivi__avatar" src={x.picture} alt="" style={{ width: taille, height: taille }} />
  ) : (
    <span className="suivi__avatar suivi__avatar--ini" style={{ width: taille, height: taille, fontSize: taille * 0.38 }}>
      {initiales(x.name)}
    </span>
  )
}

function CartePage({
  x,
  r,
  ds,
  maxBudget,
  maxFlux,
  flux,
  argent,
}: {
  x: SuiviLigne
  r: SocialSuivi
  ds: string[]
  maxBudget: number
  maxFlux: number
  flux: (x: SuiviLigne, d: string) => { g: number; p: number } | null
  argent: (v: number, d?: number) => string
}) {
  const fb = x.facebook ?? {}
  const ig = x.instagram ?? null
  const dep = x.depenseJours ?? {}
  const jours = ds.map((d) => ({ d, v: dep[d] ?? 0, fl: flux(x, d) }))
  // Jours avec budget face aux jours sans : ce que la pub apporte en abonnés.
  const moy = (a: typeof jours) => (a.length ? a.reduce((t, j) => t + (j.fl ? j.fl.g - j.fl.p : 0), 0) / a.length : null)
  const mA = moy(jours.filter((j) => j.v > 0 && j.fl))
  const mS = moy(jours.filter((j) => j.v === 0 && j.fl))
  const s1 = (v: number) => `${v >= 0 ? '+' : ''}${nombre(v, 1)}`
  const constat =
    mA == null && mS == null
      ? null
      : `Jours avec pub : ${mA == null ? '—' : `${s1(mA)} abonnés/jour`} · sans pub : ${mS == null ? '—' : `${s1(mS)} abonnés/jour`}${
          mA != null && mS != null
            ? mA > mS
              ? ` — la pub fait gagner ${nombre(mA - mS, 1)} abonnés de plus par jour.`
              : ' — pas d’effet visible de la pub sur les abonnés.'
            : ''
        }`
  const motifs = [fb.motif ? motifCourt(fb.motif, 'Facebook') : '', ig?.motif ? motifCourt(ig.motif, 'Instagram') : ''].filter(Boolean)
  const graphique = jours.some((j) => j.v > 0 || j.fl)
  const faits = [
    { k: 'Facebook', v: fb.followers == null ? '—' : nombre(fb.followers), s: fb.net == null ? 'non mesuré' : `+${nombre(fb.gagnes ?? 0)} / −${nombre(fb.perdus ?? 0)}`, t: ton(fb.net) },
    // Instagram est unique au réseau : seule la carte de la Page qui le porte l'affiche.
    ig
      ? { k: 'Instagram du réseau', v: ig.followers == null ? '—' : nombre(ig.followers), s: ig.gagnes == null ? 'non mesuré' : `+${nombre(ig.gagnes)} nouveaux`, t: ton(ig.gagnes) }
      : null,
    { k: 'Budget', v: argent(x.depense), s: x.depense ? `${Object.keys(dep).length} jour(s) de diffusion` : 'aucune pub', t: '' },
    {
      k: 'Coût / abonné',
      v: x.coutParAbonne == null ? '—' : argent(x.coutParAbonne, 2),
      s: x.coutParAbonne == null ? (x.depense ? 'pas de gain net' : '—') : 'budget ÷ abonnés nets',
      t: '',
    },
  ].filter((f): f is { k: string; v: string; s: string; t: string } => f !== null)

  return (
    <section className="card suivi__carte">
      <div className="suivi__tete">
        <Avatar x={x} taille={38} />
        <div className="suivi__nom">
          <span>{x.name}</span>
          <span className="muted">{[x.shopName || 'Page non rattachée à une boutique', ig?.username ? `@${ig.username}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="suivi__net">
          <span className={ton(x.abonnesNet)}>{signe(x.abonnesNet)}</span>
          <span className="muted">abonnés nets</span>
        </div>
      </div>
      <div className="suivi__faits" style={{ gridTemplateColumns: `repeat(${faits.length}, minmax(0, 1fr))` }}>
        {faits.map((f) => (
          <div key={f.k} className="suivi__fait">
            <span className="muted">{f.k}</span>
            <span>{f.v}</span>
            <span className={f.t || 'muted'}>{f.s}</span>
          </div>
        ))}
      </div>
      {graphique ? (
        <div className="suivi__graphe" role="img" aria-label="Budget et abonnés jour par jour">
          <div className="suivi__barres suivi__barres--budget">
            {jours.map((j) => (
              <span
                key={j.d}
                title={`${jourLong(j.d)} · budget ${argent(j.v, 2)}${j.fl ? ` · +${j.fl.g} / −${j.fl.p} abonnés` : ' · abonnés non mesurés'}`}
                style={{ height: `${Math.round((j.v / maxBudget) * 42)}px` }}
              />
            ))}
          </div>
          <div className="suivi__axe" />
          <div className="suivi__barres suivi__barres--flux">
            {jours.map((j) => (
              <span key={j.d} title={`${jourLong(j.d)} · ${j.fl ? `+${j.fl.g} / −${j.fl.p} abonnés` : 'abonnés non mesurés'}`}>
                <i className="suivi__gagnes" style={{ height: j.fl ? `${Math.round((j.fl.g / maxFlux) * 11)}px` : 0 }} />
                <i className="suivi__perdus" style={{ height: j.fl ? `${Math.round((j.fl.p / maxFlux) * 10)}px` : 0 }} />
              </span>
            ))}
          </div>
          <div className="suivi__legende muted">
            <span>{jourCourt(r.du)}</span>
            <span>bordeaux = budget · vert = abonnés gagnés · rouge = perdus</span>
            <span>{jourCourt(r.au)}</span>
          </div>
        </div>
      ) : (
        <div className="suivi__vide">
          <span>
            Rien à tracer du {jourCourt(r.du)} au {jourCourt(r.au)}
          </span>
          <span className="muted">
            aucune publicité diffusée sur cette Page · abonnés jour par jour non fournis par Meta
            {/read_insights|séries vides/.test(fb.motif ?? '') ? ' (permission read_insights absente du token)' : ''}
          </span>
        </div>
      )}
      {constat ? <span className="suivi__constat">{constat}</span> : null}
      {motifs.length ? (
        <span className="warning" title={[fb.motif, ig?.motif].filter(Boolean).join('\n')}>
          {motifs.join(' ')}
        </span>
      ) : null}
    </section>
  )
}

function Classement({ L, argent }: { L: SuiviLigne[]; argent: (v: number, d?: number) => string }) {
  const maxDep = Math.max(1, ...L.map((x) => x.depense))
  const tri = L.slice().sort(
    (a, b) =>
      Number(a.coutParAbonne == null) - Number(b.coutParAbonne == null) ||
      (a.coutParAbonne ?? 0) - (b.coutParAbonne ?? 0) ||
      b.depense - a.depense,
  )
  return (
    <section className="card suivi__classement">
      <div className="suivi__classement-tete">
        <span>Classement · coût par abonné gagné</span>
        <span className="muted">Barre = budget de la période · le moins cher en haut</span>
      </div>
      {tri.map((x) => (
        <div key={x.id ?? x.name} className="suivi__rang">
          <Avatar x={x} taille={24} />
          <span className="suivi__rang-nom">{x.name}</span>
          <span className="suivi__jauge">
            <span style={{ width: `${Math.round((x.depense / maxDep) * 100)}%` }} />
          </span>
          <span className="num">{argent(x.depense)}</span>
          <span className={`num ${ton(x.abonnesNet)}`}>{signe(x.abonnesNet)}</span>
          <span className={`num${x.coutParAbonne == null ? ' muted' : ''}`}>{x.coutParAbonne == null ? '—' : `${argent(x.coutParAbonne, 2)} / ab.`}</span>
        </div>
      ))}
    </section>
  )
}
