import * as api from '../../lib/api/module'
import type { BrochureFormat, Catalogue, CatalogueBrochureTexts, CatalogueLang } from '../../lib/api/module'
import { FORMAT_TEXTS, brandLangsOf, defaultTexts, formatPrice, normalizeSettings, productKey, savedFor, splitLabel, webshopHost } from '../../lib/brochure'
import { SUPPORT_NOUNS } from './leaflet'
import type { LeafletSupport } from './leaflet'

/**
 * Reprendre une brochure du générateur d'avant en leaflet ou dépliant des Imprimés (21/11/2026, fusion des imprimés,
 * étape 3). Les réglages enregistrés de la campagne passent dans le modèle du catalogue :
 *   - le modèle d'impression, tel quel ;
 *   - les textes : ceux saisis, et ceux que le dossier d'impression donnait sans saisie (titre de l'offre, accroche,
 *     période et conditions), figés pour que le leaflet s'imprime comme avant ; l'appel et l'adresse du webshop restent
 *     ceux de la dernière page ;
 *   - les produits (`erp-N` : le produit N du webshop), leur ordre et leur choix ;
 *   - les boutiques de la campagne, sans celles qu'on avait écartées.
 * Ce qui ne passe pas est dit (`notes`) : un prix saisi à la main (le leaflet prend le prix du webshop de chaque
 * boutique), un produit sans fiche au webshop, un QR vers une catégorie. L'ancienne brochure ne change pas : ses
 * réglages et ses routes restent lisibles.
 */

export interface BrochureImport {
  catalogue: Catalogue
  /** La brochure avait déjà été reprise : c'est ce leaflet-là (rien de nouveau n'a été créé). */
  existing: boolean
  notes: string[]
}

export const BROCHURE_SUPPORT: Record<BrochureFormat, LeafletSupport> = { 'leaflet-a5': 'leaflet', 'depliant-a4': 'depliant' }

export async function importBrochure(campaignId: number, format: BrochureFormat): Promise<BrochureImport> {
  const [file, saved, detail, social, listed] = await Promise.all([
    api.getPrintFile(campaignId),
    api.listBrochures(campaignId),
    api.getCampaign(campaignId),
    // Le module Social donne l'adresse du webshop (l'ancien sous-titre de l'appel) et les langues de la marque.
    api.getSocialState().catch(() => null),
    api.listCatalogueBrochures(),
  ])
  const before = listed.find((row) => row.campaignId === campaignId && row.format === format)?.catalogueId ?? null
  const settings = normalizeSettings(savedFor(saved, format), file)
  const support = BROCHURE_SUPPORT[format]
  const notes: string[] = []

  const byKey = new Map(file.products.map((product) => [productKey(product), product]))
  const products: Array<{ id: number; on: boolean }> = []
  for (const row of settings.products) {
    const name = splitLabel(byKey.get(row.key)?.label ?? row.key).name
    const match = /^erp-(\d+)$/.exec(row.key)
    if (!match) {
      if (row.on) notes.push(`« ${name} » n’a pas de fiche au webshop : il n’est pas repris.`)
      continue
    }
    products.push({ id: Number(match[1]), on: row.on })
    if (row.on && row.price !== null) {
      notes.push(`« ${name} » : le prix saisi à la main (${formatPrice(row.price, 'fr')}) n’est pas repris, le leaflet prend le prix du webshop de chaque boutique.`)
    }
  }
  if (settings.qr.mode === 'category') {
    notes.push('Le QR code menait à une catégorie du webshop : il mène maintenant au webshop de la boutique (celui de la dernière page).')
  }

  const targeted = detail.shops.map((shop) => shop.shop_id)
  const shopIds = targeted.filter((id) => !settings.excludedShops.includes(id))
  if (targeted.length === 0) {
    notes.push('Campagne de tout le réseau : seule la version générale est reprise. Cochez les boutiques à l’étape 1 (une version chacune).')
  }

  const host = webshopHost(social?.webshopUrl ?? '')
  const keys = FORMAT_TEXTS[format].filter((key) => key !== 'ctaSub')
  const texts: CatalogueBrochureTexts = {}
  for (const lang of ['fr', 'nl'] as CatalogueLang[]) {
    const defaults = defaultTexts(file, lang, host)
    const own = settings.texts[lang] ?? {}
    const out: Record<string, string> = {}
    for (const key of keys) {
      // L'appel garde celui du leaflet (le libellé du QR de la dernière page), sauf s'il avait été récrit ; un texte que le
      // dossier ne donnait pas (vide) laisse celui du document (la disponibilité des produits, par exemple).
      const value = own[key] ?? (key === 'cta' ? undefined : defaults[key] || undefined)
      if (typeof value === 'string') out[key] = value.slice(0, 400)
    }
    if (Object.keys(out).length) texts[lang] = out
  }

  const catalogue = await api.createCatalogue({
    title: `${file.campaign.name} — ${SUPPORT_NOUNS[support]}`.slice(0, 160),
    support,
    brochureTemplate: settings.template,
    source: { kind: 'campagne', ref: campaignId },
    langs: brandLangsOf(social?.brand?.langs),
    shopIds,
    products,
    brochureTexts: texts,
    fromBrochure: { campaignId, format },
  })

  return { catalogue, existing: before !== null, notes: before !== null ? [] : notes }
}
