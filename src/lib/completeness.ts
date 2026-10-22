import type { CampaignDetail } from './api/module'

/**
 * Ce qu'il faut à une campagne pour que son retour se mesure.
 *
 * Le Retour sur opération (module Social & Ads) relit la campagne par l'API :
 * ses dates bornent la période de ventes comparée, les produits de l'offre sont
 * les ventes comptées (sans eux : « Aucun produit rattaché à la campagne »),
 * l'objectif par levier donne l'atteinte, le budget le ROAS. Le type range la
 * campagne dans les analyses. Une donnée absente ne fait pas d'erreur : elle
 * laisse un « — » là où l'on attendait un chiffre. On la nomme donc ici.
 */

export type GapKey = 'type' | 'period' | 'shops' | 'products' | 'objective' | 'budget'

export interface Check {
  key: GapKey
  label: string
  ok: boolean
  /** Ce qui est en base, en clair. */
  value: string
  /** Ce que l'absence empêche. */
  why: string
  /** L'étape de l'assistant où la donnée se saisit. */
  step: 'framing' | 'offer' | 'budget'
}

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function campaignChecks(c: CampaignDetail): Check[] {
  const items = c.offer?.items ?? []
  const targets = c.levers.filter((l) => (l.target_value ?? 0) > 0)

  return [
    {
      key: 'type',
      label: 'Type de campagne',
      ok: c.type_id !== null && c.type_id !== undefined,
      value: c.type_label ?? '—',
      why: 'Le type donne le levier et le KPI attendus : sans lui, la campagne ne se range dans aucune analyse.',
      step: 'framing',
    },
    {
      key: 'period',
      label: 'Période',
      ok: c.starts_on !== null,
      value: c.starts_on ? `${day(c.starts_on)} → ${c.ends_on ? day(c.ends_on) : 'sans fin'}` : '—',
      why: 'Sans date de début, aucune période de ventes à comparer : le retour ne se calcule pas.',
      step: 'framing',
    },
    {
      key: 'shops',
      label: 'Boutiques',
      ok: c.scope !== 'LOCALE' || c.shops.length > 0,
      value: c.scope === 'RESEAU' && c.shops.length === 0 ? 'tout le réseau' : c.shops.map((s) => s.shop_name).join(', ') || '—',
      why: 'Une campagne locale sans boutique ne vise personne : aucune vente ne lui revient.',
      step: 'framing',
    },
    {
      key: 'products',
      label: 'Produits de l’offre',
      ok: items.length > 0,
      value: items.length ? items.map((i) => i.label).join(', ') : '—',
      why: 'Le retour compte les ventes des produits de l’offre ; sans produit, il répond « aucun produit rattaché » et ne mesure rien.',
      step: 'offer',
    },
    {
      key: 'objective',
      label: 'Objectif chiffré',
      ok: targets.length > 0,
      value: targets.length ? targets.map((l) => `${l.label} ${eur(l.target_value ?? 0)}`).join(', ') : '—',
      why: 'Sans montant visé par levier, l’atteinte de l’objectif ne se calcule pas.',
      step: 'budget',
    },
    {
      key: 'budget',
      label: 'Budget',
      ok: c.budget_amount > 0,
      value: c.budget_amount > 0 ? eur(c.budget_amount) : '—',
      why: 'Sans budget, ni ROAS ni coût par client gagné.',
      step: 'budget',
    },
  ]
}

export const campaignGaps = (c: CampaignDetail): Check[] => campaignChecks(c).filter((check) => !check.ok)
