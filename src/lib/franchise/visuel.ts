/**
 * Le visuel figé d'un modèle franchisé (repris de social/public/franchise-visuel.js) : le style, la mention et
 * la mise en page viennent du modèle ; seuls les champs que le modèle ouvre (produit, prix, remise, offre,
 * période, phrase, photo) changent. Le franchisé ne touche jamais au modèle lui-même.
 */

export const STYLES: [string, string][] = [
  ['epure', 'Épuré'],
  ['abricot', 'Abricot'],
  ['ruby', 'Ruby'],
  ['noir', 'Noir'],
  ['plein', 'Plein cadre'],
  ['duo', 'Duo'],
]
export const PROMOS: [string, string][] = [
  ['aucune', 'Aucune'],
  ['remise', 'Remise en %'],
  ['offre', 'Offre (4+1…)'],
  ['prix', 'Prix promotionnel'],
]

export interface ProduitVisuel {
  name?: string
  nameNl?: string
  price?: string
  img?: string
}

export interface ModeleVisuel {
  name?: string
  title?: string
  free?: number
  product?: string
  photo?: string
  period?: boolean
  promo?: { kind?: string; min?: number; max?: number; offres?: string[] }
  visual?: { style?: string; eyebrow?: string; eyebrowNl?: string; src?: string; media?: { kind?: string; src: string }[] }
}

export interface ChampsVisuel {
  product?: ProduitVisuel | null
  discount?: number | string
  offer?: string
  promoPrice?: string
  from?: string
  to?: string
  free?: string
  photo?: string | null
}

export interface PhotoVisuel {
  src: string
  cut?: boolean
  name?: string
  zoom?: number
  x?: number
  y?: number
}

/** Les réglages du visuel (les mêmes clés que le studio « Posts Facebook »). */
export interface ReglagesVisuel {
  style: string
  format?: string
  cutMode?: string
  showLogo: boolean
  showEyebrow: boolean
  eyebrow: string
  showTitle: boolean
  title: string
  showPhrase: boolean
  phrase: string
  phraseFont: string
  phraseColor?: string
  showPrice: boolean
  price: string
  unit: string
  showPromo: boolean
  promo: string
  promoSub: string
  showSite: boolean
  site: string
  photos: PhotoVisuel[]
  fondu?: number
}

const jm = (iso: string | undefined) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : ''
}
export { jm as d2 }

/** Les variables d'un modèle, à partir de ce que le franchisé a saisi. */
export function vars(tpl: ModeleVisuel, f: ChampsVisuel, lang: string): Record<string, string> {
  const p = f.product || null
  const promo = tpl.promo?.kind || 'aucune'
  return {
    produit: p ? (lang === 'nl' && p.nameNl ? p.nameNl : p.name || '') : '',
    prix: p ? String(p.price ?? '') : '',
    remise: promo === 'remise' && f.discount ? String(f.discount) : '',
    offre: promo === 'offre' ? f.offer || '' : '',
    prix_promo: promo === 'prix' ? f.promoPrice || '' : '',
    du: jm(f.from),
    au: jm(f.to),
    libre: f.free || '',
  }
}

export function fill(t: string | undefined, v: Record<string, string>): string {
  return String(t || '').replace(/\{(produit|prix|remise|offre|prix_promo|du|au|libre)\}/g, (_m, k: string) => v[k] || '')
}

/** Les réglages du visuel pour un modèle et des valeurs. `photo` : celle du post, déjà résolue (adresse absolue). */
export function control(tpl: ModeleVisuel, f: ChampsVisuel, lang: string, photoProduit?: string): ReglagesVisuel {
  const L = lang === 'nl' ? 'nl' : 'fr'
  const v = vars(tpl, f || {}, L)
  const vis = tpl.visual || {}
  const promo = tpl.promo?.kind || 'aucune'
  const per = v.du && v.au ? (L === 'nl' ? `van ${v.du} tot ${v.au}` : `du ${v.du} au ${v.au}`) : ''
  const promoTxt = promo === 'remise' && v.remise ? `-${v.remise}%` : promo === 'offre' ? v.offre : ''
  const price = promo === 'prix' && v.prix_promo ? v.prix_promo : v.prix
  const title = v.produit || fill(tpl.title, v) || tpl.name || ''
  const photo: PhotoVisuel | null = f?.photo
    ? { src: f.photo, cut: false, name: 'Photo de la boutique' }
    : f?.product && (photoProduit || f.product.img)
      ? { src: photoProduit || String(f.product.img), cut: true, name: f.product.name }
      : null
  const eyebrow = [L === 'nl' ? vis.eyebrowNl || vis.eyebrow || '' : vis.eyebrow || '', promo !== 'aucune' ? per : ''].filter(Boolean).join(' · ')
  return {
    style: vis.style || 'epure',
    cutMode: 'auto',
    showLogo: true,
    showEyebrow: !!(vis.eyebrow || per),
    eyebrow,
    showTitle: !!title,
    title,
    showPhrase: !!v.libre,
    phrase: v.libre,
    phraseFont: 'script',
    phraseColor: 'auto',
    // Le prix reste avec une offre (4+1…) : le visuel pose l'offre à côté du prix.
    showPrice: !!price,
    price: price || '',
    unit: L === 'nl' ? 'Per stuk' : 'La pièce',
    showPromo: !!promoTxt,
    promo: promoTxt,
    promoSub: promo === 'offre' ? (L === 'nl' ? 'actie' : 'offre') : promo === 'remise' ? (L === 'nl' ? 'korting' : 'de remise') : '',
    showSite: true,
    site: 'www.latelierby.be',
    photos: photo ? [photo] : [],
  }
}

/** Ce que le modèle ouvre au franchisé, en clair. */
export function resume(tpl: ModeleVisuel): string {
  const p = tpl.promo || {}
  const out: string[] = []
  if (tpl.visual?.style === 'fixe') return ['visuel du réseau', Number(tpl.free) > 0 ? `phrase de ${tpl.free} car. max` : 'date et heure seulement'].join(' · ')
  if (tpl.product === 'choix') out.push('produit de son catalogue')
  if (p.kind === 'remise') out.push(`remise ${p.min || 0}–${p.max || 0} %`)
  if (p.kind === 'offre') out.push(`offre : ${(p.offres || []).join(', ')}`)
  if (p.kind === 'prix') out.push('prix promotionnel')
  if (tpl.period) out.push('période')
  if (Number(tpl.free) > 0) out.push(`phrase de ${tpl.free} car. max`)
  out.push(tpl.photo === 'upload' ? 'sa photo (obligatoire)' : tpl.photo === 'choix' ? 'sa photo ou celle du catalogue' : 'photo du catalogue')
  return out.join(' · ')
}

/** Les formats d'image du visuel (largeur × hauteur en px) et ce qu'ils donnent chez Meta. */
export const FORMATS: { k: string; label: string; w: number; h: number; tip: string }[] = [
  { k: 'carre', label: 'Carré 1:1', w: 1080, h: 1080, tip: '1080 × 1080 · entier dans le fil Facebook et Instagram, sur mobile comme sur ordinateur.' },
  { k: 'portrait', label: 'Portrait 4:5', w: 1080, h: 1350, tip: '1080 × 1350 · le plus grand sur mobile (Facebook et Instagram). Sur ordinateur, Facebook le réduit : bandes de couleur sur les côtés.' },
  { k: 'story', label: 'Story 9:16', w: 1080, h: 1920, tip: '1080 × 1920 · plein écran sur téléphone. Le haut et le bas sont couverts par l’interface.' },
  { k: 'paysage', label: 'Paysage 1,91:1', w: 1200, h: 630, tip: '1200 × 630 · toute la largeur du fil sur ordinateur ; plus petit sur mobile.' },
]
export const formatDe = (k: string | undefined) => FORMATS.find((f) => f.k === k) ?? FORMATS[0]
