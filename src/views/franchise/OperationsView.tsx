import { useEffect, useState } from 'react'
import '../social/social.css'
import './operations.css'
import { dLabel, dShort, eur } from '../../lib/social/format'
import { boost, lien, media, operations, publicites, texteErreur, useFranchise } from './_donnees'
import type { DemandeBoost, Naviguer, OperationFranchise, PubliciteFranchise, VuePublicites } from './_donnees'

/**
 * Publicités et opérations — la page « Publicités et opérations » de l'espace franchisé
 * (social/franchisee/Campagnes.dc.html), réécrite dans le Marketing. En lecture seule : les publicités Meta qui
 * passent autour de la boutique (celles du réseau et celles de la boutique seule), ses propositions de boost et la
 * réponse du réseau, puis les opérations du réseau où figure la boutique, avec ce qui y est rattaché (posts,
 * publications de la Page, publicités) et ses résultats (Meta + ventes de la caisse).
 */

interface Props {
  /** Suivre un lien vers une autre page de l'espace (le calendrier sur un post). Sans elle, le lien change l'adresse. */
  onNaviguer?: Naviguer
}

const ST: Record<string, [string, string]> = { 'en cours': ['is-ok', 'En cours'], 'à venir': ['is-avenir', 'À venir'], terminée: ['is-fini', 'Terminée'] }
const PH: Record<string, string> = { encours: 'is-ok', avenir: 'is-avenir', terminee: 'is-fini' }
const STB: Record<string, [string, string]> = { attente: ['En attente', 'is-attente'], boostee: ['Boosté', 'is-ok'], refusee: ['Non retenu', 'is-fini'] }
const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('fr-BE'))
const vs = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)} % vs habituel` : 'référence indisponible'
const argent = (v: number | null | undefined, dev?: string) => (!dev || dev === 'EUR' ? eur(v) : `${Math.round(v || 0).toLocaleString('fr-BE')} ${dev}`)
const pluriel = (n: number) => (n > 1 ? 's' : '')

function Vignette({ src, taille }: { src?: string | null; taille: number }) {
  return src ? (
    <img className="fop__vignette" src={media(src)} alt="" style={{ width: taille, height: taille }} />
  ) : (
    <span className="fop__vignette" style={{ width: taille, height: taille }} />
  )
}

export default function OperationsView({ onNaviguer }: Props) {
  const { etat, erreur } = useFranchise()
  const [data, setData] = useState<{ hidden?: boolean; operations: OperationFranchise[] } | null>(null)
  const [err, setErr] = useState('')
  const [pubs, setPubs] = useState<(VuePublicites & { erreur?: boolean }) | null>(null)
  const [boostL, setBoostL] = useState<{ demandes: DemandeBoost[]; attente?: number; max?: number; permis?: boolean } | null>(null)

  const pret = !!etat
  useEffect(() => {
    if (!pret) return
    operations()
      .then(setData)
      .catch((e: unknown) => {
        setData({ operations: [] })
        setErr(texteErreur(e))
      })
    boost()
      .then(setBoostL)
      .catch(() => undefined)
    publicites()
      .then(setPubs)
      .catch(() => setPubs({ reseau: [], boutique: [], erreur: true }))
  }, [pret])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const regles = etat.rules ?? {}
  const voirRes = regles.voirResultats !== false
  const hidden = !!data?.hidden || regles.voirCampagnes === false
  const pubHidden = !!pubs?.hidden || regles.voirPublicites === false
  const ops = data?.operations ?? []
  const bst = boostL?.demandes ?? []
  const bstShow = !!boostL && (boostL.permis !== false || bst.length > 0)

  const carte = (p: PubliciteFranchise) => {
    const x = p.stats
    const meta = [
      p.objective,
      p.start ? (p.end ? `du ${dLabel(p.start)} au ${dLabel(p.end)}` : `depuis le ${dLabel(p.start)}`) : '',
      p.radius ? `${p.radius} km autour ${p.reseau ? 'de chaque boutique' : 'de la boutique'}` : '',
      p.operation ? `opération « ${p.operation} »` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const stats = x ? [x.reach ? `${fmt(x.reach)} personnes touchées` : '', x.impressions ? `${fmt(x.impressions)} affichages` : ''].filter(Boolean).join(' · ') : ''
    return (
      <div key={p.id} className="fop__piece">
        <Vignette src={p.img} taille={48} />
        <span className="fop__piece-corps">
          <span className="fop__piece-tete">
            <span className="fop__piece-nom">{p.name}</span>
            <span className={`fop__statut ${PH[p.phase ?? 'encours'] ?? 'is-ok'}`}>{p.status}</span>
          </span>
          <span className="muted fop__piece-meta">{meta}</span>
          {p.reseau && p.shops?.length ? <span className="muted fop__piece-meta">{`Boutiques : ${p.shops.join(', ')}`}</span> : null}
          {stats ? <span className="fop__piece-chiffres">{stats}</span> : null}
          {p.budget != null ? (
            <span className="fop__piece-chiffres">
              {`Budget ${argent(p.budget, p.devise)}${p.budgetType === 'quotidien' ? ' par jour' : ' au total'} · dépensé ${argent(p.spent, p.devise)} · payé par le réseau`}
            </span>
          ) : null}
        </span>
      </div>
    )
  }
  const colonnes: [string, PubliciteFranchise[], string][] = [
    ['Pour tout le réseau', pubs?.reseau ?? [], 'Aucune publicité du réseau ne passe en ce moment autour de votre boutique.'],
    ['Pour votre boutique', pubs?.boutique ?? [], 'Aucune publicité propre à votre boutique pour le moment.'],
  ]

  return (
    <div className="social-native fop">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">{`Publicités et opérations du réseau pour L’Atelier By ${etat.shop.name}`}</span>
        </div>
      </div>

      {!pubHidden ? (
        <section className="card fop__bloc">
          <h2
            className="fop__titre"
            title={`Les publicités Meta qui passent autour de ${etat.shop.name}, décidées et payées par le réseau · en cours, à venir et terminées depuis moins d’un mois · lecture seule`}
          >
            Publicités en cours
          </h2>
          {!pubs ? <span className="muted fop__petit">Lecture des publicités…</span> : null}
          {pubs?.erreur ? <span className="error fop__petit">Les publicités n’ont pas pu être lues : rechargez la page.</span> : null}
          <div className="fop__colonnes">
            {colonnes.map(([titre, liste, vide]) => (
              <div key={titre} className="fop__colonne">
                <span className="fop__kicker">{titre}</span>
                {pubs && !pubs.erreur && !liste.length ? <span className="fop__vide">{vide}</span> : null}
                {liste.map(carte)}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {bstShow ? (
        <section className="card fop__bloc">
          <h2
            className="fop__titre"
            title="Une de vos publications marche bien ? Proposez au réseau de la sponsoriser autour de votre boutique, depuis sa fiche dans le calendrier. Le réseau décide et paie."
          >
            Mes propositions de boost
          </h2>
          {boostL?.attente ? <span className="muted fop__petit">{`${boostL.attente} en attente (${boostL.max} au plus).`}</span> : null}
          {!bst.length ? (
            <span className="fop__vide" title="Ouvrez une de vos publications dans le calendrier : « Proposer au réseau de booster ce post ».">
              Aucune proposition pour l’instant.
            </span>
          ) : null}
          {bst.map((d) => {
            const [lab, cls] = STB[d.statut] ?? STB.attente
            return (
              <div key={String(d.id)} className="fop__piece fop__piece--ligne">
                <Vignette src={d.img} taille={48} />
                <span className="fop__piece-corps">
                  <span className="fop__piece-nom">{d.titre || 'Publication'}</span>
                  <span className="muted fop__piece-meta">
                    {`${d.canal ?? ''}${d.datePost ? ` · publié le ${dShort(d.datePost)}` : ''} · proposé le ${dShort(String(d.le).slice(0, 10))}${
                      d.traiteLe ? ` · traité le ${dShort(String(d.traiteLe).slice(0, 10))}` : ''
                    }`}
                  </span>
                  {d.statut === 'refusee' && d.reponse ? <span className="fop__piece-chiffres">{`Réponse du réseau : « ${d.reponse} »`}</span> : null}
                </span>
                <span className={`fop__statut ${cls}`}>{lab}</span>
                {d.permalink ? (
                  <a href={d.permalink} target="_blank" rel="noopener noreferrer" className="fop__lien">
                    Voir ↗
                  </a>
                ) : null}
              </div>
            )
          })}
        </section>
      ) : null}

      {hidden ? <div className="card fop__info">Le réseau ne partage pas les opérations dans l’espace boutique.</div> : null}
      {err ? <p className="error">{err}</p> : null}
      {!data ? <p className="muted">Lecture des opérations du réseau…</p> : null}
      {data && !hidden && !ops.length && !err ? <div className="card fop__info">Aucune opération du réseau ne concerne votre boutique pour l’instant.</div> : null}

      {!hidden
        ? ops.map((c) => <Operation key={c.id} c={c} voirRes={voirRes} onNaviguer={onNaviguer} />)
        : null}
    </div>
  )
}

function Operation({ c, voirRes, onNaviguer }: { c: OperationFranchise; voirRes: boolean; onNaviguer?: Naviguer }) {
  const r = c.result
  const [cls, lab] = ST[c.status ?? ''] ?? ST['à venir']
  const caAdd = r && r.caCamp != null && r.caRef != null ? r.caCamp - r.caRef : null
  const kpis =
    r && voirRes
      ? [
          { label: 'Budget dépensé', value: eur(r.spend), sub: 'publicités pour votre boutique' },
          { label: 'Personnes touchées', value: fmt(r.reach), sub: 'par les publicités' },
          { label: 'Impressions', value: fmt(r.impr), sub: 'affichages des publicités' },
          { label: 'Interactions', value: fmt(r.eng), sub: 'réactions, commentaires, partages' },
          { label: 'Vues vidéo', value: fmt(r.vv), sub: 'vidéos des publicités' },
          {
            label: 'Ventes des produits',
            value: r.caCamp != null ? eur(r.caCamp) : '—',
            sub: vs(r.caCamp, r.caRef),
            ton: r.caCamp != null && r.caRef != null && r.caCamp >= r.caRef ? 'is-bon' : '',
          },
          {
            label: 'CA additionnel (estimation)',
            value: caAdd != null ? `${caAdd >= 0 ? '+' : ''}${eur(caAdd)}` : '—',
            sub: c.goalShop
              ? `objectif ${eur(c.goalShop)}${caAdd != null ? ` · ${Math.round((caAdd / c.goalShop) * 100)} % atteint` : ''}`
              : 'vs mêmes jours des 6 semaines avant',
            ton: caAdd != null && caAdd >= 0 ? 'is-bon' : 'is-moyen',
          },
          { label: 'Tickets', value: fmt(r.tCamp), sub: vs(r.tCamp, r.tRef) },
          { label: 'Quantités vendues', value: fmt(r.qCamp), sub: vs(r.qCamp, r.qRef) },
          {
            label: 'Coût par ticket gagné',
            value:
              r.tCamp != null && r.tRef != null && r.tCamp > r.tRef && r.spend ? `${(r.spend / (r.tCamp - r.tRef)).toFixed(2).replace('.', ',')} €` : '—',
            sub: 'budget ÷ tickets en plus',
          },
        ]
      : []
  const posts = c.posts ?? []
  const metaPosts = c.metaPosts ?? []
  const ads = c.ads ?? []
  const nP = posts.length + metaPosts.length
  const nA = ads.length
  const tags = (c.channels ?? []).concat(c.levers ?? [])
  return (
    <section className="card fop__bloc">
      <div className="fop__op-tete">
        <div className="fop__op-nom">
          {c.image ? <Vignette src={c.image} taille={56} /> : null}
          <span className="fop__op-titre">
            <span>{c.name}</span>
            <span className="muted">
              {`${!c.start ? 'Dates à venir' : c.end ? `Du ${dLabel(c.start)} au ${dLabel(c.end)}` : `Depuis le ${dLabel(c.start)}`} · ${c.type || 'opération'}`}
            </span>
          </span>
        </div>
        <span className={`fop__statut ${cls}`}>{lab}</span>
      </div>
      {c.description ? <span className="fop__desc">{c.description}</span> : null}
      {(c.products ?? []).length || tags.length ? (
        <div className="fop__tags">
          {(c.products ?? []).map((p) => (
            <span key={`p-${p}`} className="fop__tag is-produit">
              {p}
            </span>
          ))}
          {tags.map((t) => (
            <span key={`t-${t}`} className="fop__tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {c.budget || c.goalShop ? (
        <div className="fop__budget">
          {c.budget ? (
            <span>
              Budget publicitaire pour votre boutique : <span className="fop__fort">{eur(c.budget)}</span> (financé et piloté par le réseau)
            </span>
          ) : null}
          {c.goalShop ? (
            <span>
              Objectif pour votre boutique : <span className="fop__fort">{`${eur(c.goalShop)} ${(c.goal?.metric ?? '').toLowerCase()}`}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {kpis.length ? (
        <div className="fop__resultats">
          <span className="fop__kicker">{`Résultats pour votre boutique · ${r?.source ? `ventes : ${r.source}` : 'Meta + ventes de la caisse'}`}</span>
          <div className="fop__kpis">
            {kpis.map((k) => (
              <div key={k.label} className="fop__kpi">
                <span className="muted fop__kpi-nom">{k.label}</span>
                <span className={`fop__kpi-val ${k.ton ?? ''}`}>{k.value}</span>
                <span className="muted fop__kpi-sous">{k.sub}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <span className="muted fop__petit">
          {!voirRes
            ? 'Le réseau ne partage pas les résultats dans l’espace boutique.'
            : c.status === 'à venir'
              ? 'Les résultats arriveront quand l’opération aura commencé.'
              : 'Pas encore de résultats pour votre boutique (relus chaque heure).'}
        </span>
      )}

      <div className="fop__rattache">
        <span className="fop__kicker">{`Rattaché à l’opération · ${nP} post${pluriel(nP)} · ${nA} publicité${pluriel(nA)} · lecture seule`}</span>
        {!nP && !nA ? <span className="muted fop__petit">Le réseau n’a encore rattaché ni post ni publicité à cette opération pour votre boutique.</span> : null}
        {posts.map((p) => (
          <div key={`post-${p.id}`} className="fop__item">
            <Vignette src={p.img} taille={40} />
            <span className="fop__item-corps">
              <span className="fop__item-titre">{p.title}</span>
              <span className="muted fop__piece-meta">
                {`${dLabel(p.date)}${p.time ? ` · ${p.time}` : ''} · ${[p.fb ? 'Facebook' : '', p.ig ? 'Instagram' : ''].filter(Boolean).join(' + ')} · ${p.status}`}
              </span>
            </span>
            <span className="fop__statut is-fini">{p.own ? 'Votre post' : 'Post du réseau'}</span>
            <a className="fop__lien" {...lien(onNaviguer, 'cal', `post=${encodeURIComponent(p.id)}`)}>
              Calendrier →
            </a>
          </div>
        ))}
        {metaPosts.map((m) => (
          <div key={`meta-${m.id}`} className="fop__item">
            <Vignette src={m.img} taille={40} />
            <span className="fop__item-corps">
              <span className="fop__item-titre">{(m.text || 'Publication').split('\n')[0].slice(0, 90)}</span>
              <span className="muted fop__piece-meta">{`${m.date ? `${dLabel(m.date)} · ` : ''}${m.channel === 'Instagram' ? 'Instagram du réseau' : 'votre Page Facebook'}`}</span>
            </span>
            <span className="fop__statut is-meta">{`Publié sur ${m.channel === 'Instagram' ? 'Instagram' : 'la Page'}`}</span>
            {m.link ? (
              <a href={m.link} target="_blank" rel="noopener noreferrer" className="fop__lien">
                Voir ↗
              </a>
            ) : null}
          </div>
        ))}
        {ads.map((a, i) => (
          <div key={`ad-${i}`} className="fop__item">
            <Vignette taille={40} />
            <span className="fop__item-corps">
              <span className="fop__item-titre">{a.name}</span>
              <span className="muted fop__piece-meta">
                {`${a.objective ? `${a.objective} · ` : ''}${a.start ? `du ${dLabel(a.start)}${a.end ? ` au ${dLabel(a.end)}` : ''}` : ''}${a.reseau ? ' · tout le réseau' : ''}`}
              </span>
            </span>
            <span className={`fop__statut ${a.status === 'Active' ? 'is-ok' : 'is-fini'}`}>{`Publicité · ${a.status ?? ''}`}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
