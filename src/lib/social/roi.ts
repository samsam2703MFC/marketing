import { daysBetween } from './format'
import { ragOf } from './refs'
import type { Rag } from './refs'
import type { EtatSocial, Operation, Resultat, Serveur } from './store'
import { parId } from './store'

/** Une boutique d'une opération : les résultats Meta et caisse, puis ce qu'on en tire. */
export interface RoiBoutique extends Partial<Resultat> {
  sid: string
  name: string
  empty?: boolean
  cpc?: number | null
  ctr?: number | null
  cpm?: number | null
  freq?: number | null
  caAdd?: number | null
  mAdd?: number | null
  tAdd?: number | null
  qAdd?: number | null
  roas?: number | null
  roi?: number | null
  cpt?: number | null
  goal?: number
  att?: number | null
  rag?: Rag
}

export interface RoiTotal {
  spend: number
  reach: number
  impr: number
  clicks: number
  eng: number
  vv: number
  caRef: number
  caCamp: number
  tAdd: number
  qAdd: number
  caAdd: number
  mAdd: number
  cpc: number | null
  ctr: number | null
  cpm: number | null
  freq: number | null
  roas: number | null
  roi: number | null
  cpt: number | null
  goal: number
  att: number | null
  rag: Rag
  elapsed: number
  missing: string[]
}

/**
 * Le retour d'une opération (repris de social-data.js) : CA additionnel = CA des produits de l'opération
 * pendant la période − la référence (mêmes jours des 6 semaines précédentes), marge, ROAS, ROI, coût par
 * ticket, et l'objectif atteint au prorata du temps écoulé. Une estimation, pas une attribution exacte.
 */
export function roi(etat: EtatSocial, serveur: Serveur, cid: string): { c: Operation; perShop: RoiBoutique[]; total: RoiTotal } | null {
  const c = parId(etat.campaigns, cid)
  if (!c) return null
  const res = serveur.results?.[cid] ?? {}
  const marge = serveur.margin
  const gv = c.goal?.value ?? 0
  const split = c.split ?? {}
  const elapsed =
    c.status === 'en cours' && c.start && c.end
      ? Math.min(1, (daysBetween(c.start, serveur.today) + 1) / (daysBetween(c.start, c.end) + 1))
      : 1
  const perShop: RoiBoutique[] = c.shops.map((sid) => {
    const r = res[sid] ?? null
    const nom = parId(etat.shops, sid)?.name ?? sid
    const goal = gv * (Object.keys(split).length ? (split[sid] ?? 0) / (c.budget || 1) : 1 / (c.shops.length || 1)) * elapsed
    if (!r) return { sid, name: nom, empty: true }
    const has = r.caRef != null
    const caAdd = has ? (r.caCamp ?? 0) - (r.caRef ?? 0) : null
    const mAdd = caAdd != null ? caAdd * marge : null
    const tAdd = has ? (r.tCamp ?? 0) - (r.tRef ?? 0) : null
    const o: RoiBoutique = {
      sid,
      name: nom,
      ...r,
      cpc: r.clicks ? r.spend / r.clicks : null,
      ctr: r.impr ? r.clicks / r.impr : null,
      cpm: r.impr ? (r.spend / r.impr) * 1000 : null,
      freq: r.reach ? r.impr / r.reach : null,
      caAdd,
      mAdd,
      tAdd,
      qAdd: has ? (r.qCamp ?? 0) - (r.qRef ?? 0) : null,
      roas: caAdd != null && r.spend ? caAdd / r.spend : null,
      roi: mAdd != null && r.spend ? (mAdd - r.spend) / r.spend : null,
      cpt: tAdd != null && tAdd > 0 ? r.spend / tAdd : null,
      goal,
      att: caAdd != null && goal ? caAdd / goal : null,
    }
    o.rag = ragOf(o.att)
    return o
  })
  const somme = (k: keyof RoiBoutique, lignes: RoiBoutique[]) => lignes.reduce((a, x) => a + (Number(x[k]) || 0), 0)
  const ventes = perShop.filter((x) => !x.empty && x.caRef != null)
  const caRef = somme('caRef', ventes)
  const caCamp = somme('caCamp', ventes)
  const spend = somme('spend', perShop)
  const reach = somme('reach', perShop)
  const impr = somme('impr', perShop)
  const clicks = somme('clicks', perShop)
  const tAdd = somme('tAdd', ventes)
  const caAdd = caCamp - caRef
  const mAdd = caAdd * marge
  const goal = gv * elapsed
  const att = goal ? caAdd / goal : null
  const total: RoiTotal = {
    spend,
    reach,
    impr,
    clicks,
    eng: somme('eng', perShop),
    vv: somme('vv', perShop),
    caRef,
    caCamp,
    tAdd,
    qAdd: somme('qAdd', ventes),
    caAdd,
    mAdd,
    cpc: clicks ? spend / clicks : null,
    ctr: impr ? clicks / impr : null,
    cpm: impr ? (spend / impr) * 1000 : null,
    freq: reach ? impr / reach : null,
    roas: spend ? caAdd / spend : null,
    roi: spend ? (mAdd - spend) / spend : null,
    cpt: tAdd > 0 ? spend / tAdd : null,
    goal,
    att,
    rag: ragOf(att),
    elapsed,
    missing: perShop.filter((x) => x.caRef == null).map((x) => x.name),
  }
  return { c, perShop, total }
}
