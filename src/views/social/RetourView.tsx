import { useMemo, useState } from 'react'
import './social.css'
import { dShort, eur, fmt, pct } from '../../lib/social/format'
import { CTYPES, RAG, imageSocial } from '../../lib/social/refs'
import type { TypeOperation } from '../../lib/social/refs'
import { roi } from '../../lib/social/roi'
import type { RoiBoutique, RoiTotal } from '../../lib/social/roi'
import { boutiquesReseau, useSocial } from '../../lib/social/store'
import type { Operation } from '../../lib/social/store'

type Metrique = 'caAdd' | 'roas' | 'roi' | 'att'
const METRIQUES: Record<Metrique, [string, (v: number) => string]> = {
  caAdd: ['CA additionnel', (v) => eur(v)],
  roas: ['ROAS', (v) => `${fmt(v, 1)} ×`],
  roi: ['ROI', (v) => `${v >= 0 ? '+' : ''}${pct(v)}`],
  att: ['Atteinte objectif', (v) => pct(v)],
}

/** Le type d'une opération : le référentiel s'il le connaît, sinon le libellé du Marketing. */
function typeDe(c: Operation): TypeOperation {
  return (
    CTYPES.find((t) => t.id === c.type) ?? {
      id: c.type,
      name: c.typeLabel || 'Opération',
      color: '#666666',
      icon: 'img/illus/decorative/circle-01.png',
      lev: 'trafic',
      kpi: c.goal?.metric || '—',
    }
  )
}

const tonRoi = (v: number | null | undefined) => (v == null ? 'muted' : v >= 1 ? 'is-bon' : v >= 0 ? 'is-moyen' : 'is-alerte')

/**
 * Retour sur opération — l'écran « Retour » du module Social, réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Pour chaque opération qui a des résultats : CA additionnel estimé
 * (ventes caisse de TFBuddy face aux 6 semaines précédentes), marge, ROAS, ROI, données Meta, ventes,
 * comparaison des boutiques, détail et classement. Données : l'état du module Social (`/state`).
 */
export default function RetourView() {
  const { etat, serveur, erreur, chargement } = useSocial()
  const [cid, setCid] = useState<string | null>(() => new URLSearchParams(window.location.search).get('c'))
  const [focus, setFocus] = useState('')
  const [metrique, setMetrique] = useState<Metrique>('caAdd')

  const toutes = useMemo(() => {
    if (!etat || !serveur) return []
    return Object.keys(serveur.results ?? {})
      .map((id) => roi(etat, serveur, id))
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [etat, serveur])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const nBoutiques = boutiquesReseau(etat).length
  const R = toutes.find((x) => x.c.id === cid) ?? toutes[0]

  if (!R) {
    return (
      <div className="social-native">
        <section className="card retour__vide">
          <h3>Aucune opération à mesurer pour l’instant</h3>
          <p className="muted">
            Créez une opération (dates, boutiques, produits), puis ses publicités. Les résultats Meta et les ventes des produits — lues dans
            l’API TFBuddy — sont recalculés chaque heure, pour les opérations en cours ou finies depuis moins de 60 jours.
          </p>
          <a className="btn btn--primary" href="?nouvelle=1">
            Créer une opération
          </a>
        </section>
      </div>
    )
  }

  const c = R.c
  const ligne = focus ? R.perShop.find((x) => x.sid === focus) ?? null : null
  const X: RoiBoutique | RoiTotal = ligne ?? R.total
  const aVentes = ligne ? ligne.caRef != null : true
  const rag = RAG[aVentes ? (ligne ? ligne.rag ?? 'grey' : R.total.rag) : 'grey']
  const enCours = c.status === 'en cours'
  const budget = ligne ? c.split?.[ligne.sid] : c.budget

  const sommeVentes = (k: 'caRef' | 'caCamp' | 'qRef' | 'qCamp' | 'tRef' | 'tCamp') =>
    R.perShop.filter((x) => x.caRef != null).reduce((a, x) => a + (Number(x[k]) || 0), 0)
  const src = ligne ?? {
    caRef: sommeVentes('caRef'),
    caCamp: sommeVentes('caCamp'),
    qRef: sommeVentes('qRef'),
    qCamp: sommeVentes('qCamp'),
    tRef: sommeVentes('tRef'),
    tCamp: sommeVentes('tCamp'),
  }

  return (
    <div className="social-native retour">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">Données Meta + ventes caisse (API Franchise Buddy)</span>
          <span className="media__spacer" />
          <select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Boutique">
            <option value="">
              Réseau · {nBoutiques} boutique{nBoutiques > 1 ? 's' : ''}
            </option>
            {R.perShop.map((x) => (
              <option key={x.sid} value={x.sid}>
                {x.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => exporterCsv(c, R.perShop, R.total)}>
            Exporter Excel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            Exporter PDF
          </button>
        </div>
      </div>

      <div className="retour__operations">
        {toutes.map((x) => {
          const t = typeDe(x.c)
          const r = RAG[x.total.rag]
          return (
            <button
              key={x.c.id}
              type="button"
              className={`retour__operation${x.c.id === c.id ? ' is-on' : ''}`}
              onClick={() => {
                setCid(x.c.id)
                setFocus('')
              }}
            >
              <span className="retour__icone" style={{ background: `${t.color}22` }}>
                <img src={imageSocial(t.icon)} alt="" />
              </span>
              <span className="retour__operation-nom">
                <span>{x.c.name}</span>
                <span className="muted">
                  {t.name} · {dShort(x.c.start)} → {dShort(x.c.end)} · {x.c.status === 'en cours' ? 'en cours' : 'terminée'}
                </span>
              </span>
              <span className="bilan__rang" style={{ background: r.bg, color: r.fg }}>
                {r.label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="warning">
        Le CA additionnel est une estimation, pas une attribution exacte. Il compare le CA des produits de l’opération pendant la période (
        {dShort(c.start)} → {enCours ? `${dShort(serveur.today)}, à date` : dShort(c.end)}) à la moyenne des mêmes jours sur les 6 semaines
        précédentes. D’autres facteurs (météo, vacances, travaux) peuvent l’influencer. Taux de marge appliqué : {pct(serveur.margin)}.
      </p>

      {!aVentes ? (
        <section className="card retour__vide">
          <h3>Pas de données de vente pour {ligne?.name}</h3>
          <p className="muted">
            {(ligne?.noSales as string | undefined) || 'Aucune vente remontée par la caisse'}. Les indicateurs Meta restent disponibles ci-dessous ;
            le CA additionnel, la marge, le ROAS et le ROI ne peuvent pas être calculés.
          </p>
        </section>
      ) : null}

      <div className="retour__heros">
        <section className="card retour__hero">
          <div className="kpi__label">CA additionnel estimé</div>
          <div className="retour__ca" style={{ color: aVentes ? rag.fg : undefined }}>
            ≈ {aVentes ? eur(X.caAdd) : '—'}
          </div>
          <div className="muted retour__sous">
            {aVentes ? `${eur(X.caCamp)} pendant l’opération vs ${eur(X.caRef)} en référence` : 'Ventes non remontées'}
          </div>
          <div className="retour__objectif muted">
            <span>
              {X.goal
                ? `Objectif ${eur(X.goal)}${enCours ? ` (prorata ${pct(R.total.elapsed)} de la période)` : ''}`
                : 'Pas d’objectif chiffré (levier) dans le Marketing'}
            </span>
            <span style={{ color: rag.fg }}>{aVentes && X.att != null ? pct(X.att) : '—'}</span>
          </div>
          <div className="suivi__jauge">
            <span style={{ width: `${aVentes && X.att != null ? Math.min(100, X.att * 100) : 0}%`, background: rag.bar }} />
          </div>
          <span className="bilan__rang" style={{ background: rag.bg, color: rag.fg }}>
            {rag.label}
          </span>
        </section>
        <Kpi label="Marge additionnelle" value={aVentes ? eur(X.mAdd) : '—'} note={`CA additionnel × ${pct(serveur.margin)}`} />
        <Kpi label="Dépense publicitaire" value={eur(X.spend)} note={`${enCours ? 'à date, ' : ''}sur ${eur(budget)} prévus`} />
        <Kpi
          label="ROAS"
          value={aVentes && X.roas != null ? `${fmt(X.roas, 1)} ×` : '—'}
          note="CA additionnel / dépense pub"
          ton={!aVentes || X.roas == null ? 'muted' : X.roas >= 3 ? 'is-bon' : X.roas >= 1.6 ? 'is-moyen' : 'is-alerte'}
        />
        <Kpi
          label="ROI"
          value={aVentes && X.roi != null ? `${X.roi >= 0 ? '+' : ''}${pct(X.roi)}` : '—'}
          note="(marge add. − dépense) / dépense"
          ton={aVentes ? tonRoi(X.roi) : 'muted'}
        />
        <Kpi
          label="Coût / ticket add."
          value={aVentes && X.cpt != null ? eur(X.cpt, 2) : '—'}
          note={aVentes ? `+${fmt(X.tAdd)} tickets avec produits de l’opération` : ''}
        />
      </div>

      <div className="retour__deux">
        <section className="card">
          <h3>Données Meta</h3>
          <div className="retour__meta">
            {(
              [
                ['Dépense', eur(X.spend)],
                ['Portée', fmt(X.reach)],
                ['Impressions', fmt(X.impr)],
                ['Fréquence', fmt(X.freq, 2)],
                ['Clics', fmt(X.clicks)],
                ['CTR', pct(X.ctr, 2)],
                ['Coût par clic', eur(X.cpc, 2)],
                ['CPM', eur(X.cpm, 2)],
                ['Engagement', fmt(X.eng)],
                ['Vues vidéo', fmt(X.vv)],
              ] as [string, string][]
            ).map(([l, v]) => (
              <div key={l} className="suivi__fait">
                <span className="muted">{l}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>
            Ventes des produits de l’opération <span className="muted retour__produits">{(c.products ?? []).join(' · ')}</span>
          </h3>
          {aVentes ? (
            <>
              <Ventes label="Chiffre d’affaires" ref_={src.caRef} camp={src.caCamp} f={(v) => eur(v)} />
              <Ventes label="Quantités vendues" ref_={src.qRef} camp={src.qCamp} f={(v) => fmt(v)} />
              <Ventes label="Tickets concernés" ref_={src.tRef} camp={src.tCamp} f={(v) => fmt(v)} />
            </>
          ) : (
            <p className="muted">Ventes indisponibles.</p>
          )}
        </section>
      </div>

      <Comparaison lignes={R.perShop} total={R.total} metrique={metrique} focus={focus} onMetrique={setMetrique} />

      <section className="card table-card">
        <div className="table-scroll">
          <table className="retour__tableau">
            <thead>
              <tr>
                <th>Boutique</th>
                {['Dépense', 'Portée', 'Clics', 'CPC', 'CA réf.', 'CA camp.', 'CA add.', 'Marge add.', 'ROAS', 'ROI'].map((h) => (
                  <th key={h} className="num">
                    {h}
                  </th>
                ))}
                <th>Objectif</th>
              </tr>
            </thead>
            <tbody>
              {R.perShop.map((x) => (
                <LigneDetail key={x.sid} x={x} focus={x.sid === focus} />
              ))}
              <LigneDetail x={R.total} total />
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Classement des opérations · par ROI</h3>
        <div className="retour__classement">
          {toutes
            .slice()
            .sort((a, b) => (b.total.roi ?? -1e9) - (a.total.roi ?? -1e9))
            .map((x, i) => {
              const r = RAG[x.total.rag]
              return (
                <button
                  key={x.c.id}
                  type="button"
                  className={`retour__rang${x.c.id === c.id ? ' is-on' : ''}`}
                  onClick={() => {
                    setCid(x.c.id)
                    setFocus('')
                  }}
                >
                  <span className="retour__rang-no">{i + 1}</span>
                  <span className="retour__operation-nom">
                    <span>{x.c.name}</span>
                    <span className="muted">
                      {typeDe(x.c).name} · {dShort(x.c.start)} → {x.c.end ? dShort(x.c.end) : 'sans fin'}
                      {x.c.status === 'en cours' ? ' · en cours' : ''}
                    </span>
                  </span>
                  <Chiffre l="Dépense" v={eur(x.total.spend)} />
                  <Chiffre l="CA add." v={eur(x.total.caAdd)} />
                  <Chiffre l="ROAS" v={`${fmt(x.total.roas, 1)} ×`} />
                  <Chiffre l="ROI" v={`${(x.total.roi ?? 0) >= 0 ? '+' : ''}${pct(x.total.roi)}`} ton={tonRoi(x.total.roi)} />
                  <span className="bilan__rang" style={{ background: r.bg, color: r.fg }}>
                    {r.label}
                  </span>
                </button>
              )
            })}
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, note, ton }: { label: string; value: string; note: string; ton?: string }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className={`kpi__value ${ton ?? ''}`}>{value}</div>
      <div className="kpi__note">{note}</div>
    </div>
  )
}

function Chiffre({ l, v, ton }: { l: string; v: string; ton?: string }) {
  return (
    <span className="retour__chiffre">
      <span className="muted">{l}</span>
      <span className={ton}>{v}</span>
    </span>
  )
}

function Ventes({ label, ref_, camp, f }: { label: string; ref_: number | null | undefined; camp: number | null | undefined; f: (v: number) => string }) {
  const mx = Math.max(ref_ ?? 0, camp ?? 0, 1)
  const d = ref_ ? ((camp ?? 0) - ref_) / ref_ : null
  return (
    <div className="retour__ventes">
      <div className="retour__ventes-tete">
        <span>{label}</span>
        <span className={d == null ? 'muted' : d >= 0 ? 'is-bon' : 'is-alerte'}>{d == null ? 'n.d.' : `${d >= 0 ? '+' : ''}${pct(d, 1)}`}</span>
      </div>
      <div className="retour__barre muted">
        <span>Référence</span>
        <span className="suivi__jauge">
          <span style={{ width: `${((ref_ ?? 0) / mx) * 100}%`, background: '#B8B2A8' }} />
        </span>
        <span className="num">{ref_ == null ? '—' : f(ref_)}</span>
      </div>
      <div className="retour__barre muted">
        <span>Opération</span>
        <span className="suivi__jauge">
          <span style={{ width: `${((camp ?? 0) / mx) * 100}%` }} />
        </span>
        <span className="num retour__fort">{camp == null ? '—' : f(camp)}</span>
      </div>
    </div>
  )
}

function Comparaison({
  lignes,
  total,
  metrique,
  focus,
  onMetrique,
}: {
  lignes: RoiBoutique[]
  total: RoiTotal
  metrique: Metrique
  focus: string
  onMetrique: (m: Metrique) => void
}) {
  const val = (x: RoiBoutique) => (x[metrique] ?? null) as number | null
  const vals = lignes.map(val).filter((v): v is number => v != null)
  const max = Math.max(...vals.map(Math.abs), metrique === 'att' ? 1.1 : 0.0001)
  const classes = lignes.slice().sort((a, b) => (val(b) ?? -1e9) - (val(a) ?? -1e9))
  return (
    <section className="card">
      <div className="retour__comparaison-tete">
        <h3>Comparaison entre boutiques</h3>
        <div className="seg" role="group" aria-label="Indicateur">
          {(Object.keys(METRIQUES) as Metrique[]).map((k) => (
            <button key={k} type="button" className={metrique === k ? 'is-on' : ''} onClick={() => onMetrique(k)}>
              {METRIQUES[k][0]}
            </button>
          ))}
        </div>
      </div>
      {classes.map((x, i) => {
        const v = val(x)
        const r = RAG[x.rag ?? 'grey']
        const avecObjectif = v != null && (metrique === 'caAdd' || metrique === 'att')
        const objectifX = metrique === 'caAdd' ? ((x.goal ?? 0) / max) * 100 : (1 / max) * 100
        return (
          <div key={x.sid} className="retour__comparaison">
            <span className={x.sid === focus ? 'retour__fort' : undefined}>
              {v == null ? '–' : i + 1}. {x.name}
            </span>
            <span className="retour__piste">
              {v == null ? (
                <span className="muted retour__nd">Données de vente indisponibles</span>
              ) : (
                <span
                  className="retour__plein"
                  style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`, background: metrique === 'roi' && v < 0 ? '#8D1D2C' : r.bar }}
                />
              )}
              {avecObjectif ? <span className="retour__objectif-trait" title="Objectif" style={{ left: `${Math.min(100, objectifX)}%` }} /> : null}
            </span>
            <span className="num" style={{ color: v == null ? undefined : r.fg }}>
              {v == null ? '—' : METRIQUES[metrique][1](v)}
            </span>
          </div>
        )
      })}
      <p className="muted bilan__legende">
        {metrique === 'caAdd' || metrique === 'att' ? 'Trait noir = objectif de la boutique (au prorata du budget alloué). ' : ''}
        {total.missing.length ? `Sans données de vente : ${total.missing.join(', ')} (exclue des totaux de vente).` : ''}
      </p>
    </section>
  )
}

function LigneDetail({ x, total, focus }: { x: RoiBoutique | RoiTotal; total?: boolean; focus?: boolean }) {
  const na = x.caRef == null
  const r = RAG[na ? 'grey' : (x.rag ?? 'grey')]
  const nom = total ? 'Réseau' : (x as RoiBoutique).name
  const mots = r.label.split(' ')
  return (
    <tr className={total ? 'retour__total' : focus ? 'is-focus' : na ? 'is-sans' : undefined}>
      <td>{nom}</td>
      <td className="num">{eur(x.spend)}</td>
      <td className="num">{fmt(x.reach)}</td>
      <td className="num">{fmt(x.clicks)}</td>
      <td className="num">{eur(x.cpc, 2)}</td>
      <td className="num">{na ? '—' : eur(x.caRef)}</td>
      <td className="num">{na ? '—' : eur(x.caCamp)}</td>
      <td className={`num ${na ? 'muted' : (x.caAdd ?? 0) >= 0 ? 'is-bon' : 'is-alerte'}`}>{na ? 'n.d.' : eur(x.caAdd)}</td>
      <td className="num">{na ? '—' : eur(x.mAdd)}</td>
      <td className="num">{na || x.roas == null ? '—' : `${fmt(x.roas, 1)} ×`}</td>
      <td className={`num ${tonRoi(na ? null : x.roi)}`}>{na || x.roi == null ? '—' : `${x.roi >= 0 ? '+' : ''}${pct(x.roi)}`}</td>
      <td style={{ color: r.fg }}>{na ? 'Ventes indisponibles' : `${pct(x.att)} · ${mots.slice(0, 2).join(' ')}`}</td>
    </tr>
  )
}

/** Export Excel (CSV, séparateur « ; », BOM) — les mêmes colonnes que l'écran du module Social. */
function exporterCsv(c: Operation, lignes: RoiBoutique[], total: RoiTotal) {
  const h = ['Boutique', 'Dépense', 'Portée', 'Impressions', 'Clics', 'CPC', 'Engagement', 'Vues vidéo', 'CA référence', 'CA opération', 'CA additionnel (estimé)', 'Marge additionnelle', 'ROAS', 'ROI', 'Coût par ticket add.', 'Objectif', 'Atteinte']
  const n2 = (v: unknown, d = 0) => {
    const n = Number(v)
    return v == null || !Number.isFinite(n) ? '' : String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ',')
  }
  const ligne = (x: RoiBoutique | RoiTotal, nom: string) => [
    nom, n2(x.spend), n2(x.reach), n2(x.impr), n2(x.clicks), n2(x.cpc, 2), n2(x.eng), n2(x.vv), n2(x.caRef), n2(x.caCamp), n2(x.caAdd), n2(x.mAdd),
    n2(x.roas, 2), n2(x.roi, 3), n2(x.cpt, 2), n2(x.goal), n2(x.att, 3),
  ]
  const rows: string[][] = [
    ['Opération', c.name],
    ['Période', `${c.start ?? ''} → ${c.end ?? ''}`],
    ['Note', 'CA additionnel estimé par comparaison à la moyenne des mêmes jours des 6 semaines précédentes'],
    [],
    h,
    ...lignes.map((x) => ligne(x, x.name)),
    ligne(total, 'Réseau'),
  ]
  // Une valeur qui commence par = + - @ est neutralisée : pas de formule exécutée par Excel.
  const cellule = (v: string) => {
    const s = /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = `﻿${rows.map((r) => r.map(cellule).join(';')).join('\n')}`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `retour-${c.id}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
}
