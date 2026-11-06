import type { EtatSocial, Serveur } from './store'

/**
 * Règles du texte d'un post, reprises de social/public/social-data.js (mêmes règles que le serveur,
 * socMessage) : le texte qui introduit le lien, la place du lien, la charte éditoriale et sa relecture,
 * la mention d'une promotion. Aucun appel au serveur ici.
 */

/** Le texte qui introduit le lien d'un post, par défaut. */
export const LIEN_DEF: Record<string, string> = { fr: 'Commandez ici 👉', nl: 'Bestel hier 👉' }

/**
 * Le texte qui introduit le lien (« Commandez ici 👉 ») : celui du post, sinon le réglage `lien_texte`
 * (Paramètres), sinon le texte d'origine. Meta n'accepte pas de lien caché sous un mot : l'adresse suit ce texte.
 */
export function lienTexte(etat: EtatSocial, L: string, post?: { linkText?: Record<string, string> | null } | null): string {
  const p = post?.linkText ? String(post.linkText[L] || '').trim() : ''
  if (p) return p
  const d = etat.params.lien_texte as Record<string, string> | undefined
  return (d && String(d[L] || '').trim()) || LIEN_DEF[L] || LIEN_DEF.fr
}

/** Place {lien} dans un texte (« Commandez ici 👉 https://… ») ; sans lien (ou sur Instagram), la variable disparaît. */
export function placerLien(txt: string, lien: string): string {
  const t = lien ? String(txt || '').split('{lien}').join(lien) : String(txt || '').replace(/[ \t]*\{lien\}[ \t]*/g, ' ')
  return t.replace(/[ \t]+(\n|$)/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

export interface Charte {
  ton: string
  vouvoiement: boolean
  emojisMax: number
  motsInterdits: string[]
  hashtags: string[]
  hashtagVille: boolean
  longueur: number
  signature: string
}

/** La charte éditoriale par défaut du module (complétée par celle enregistrée, Paramètres → Rédaction IA). */
export const CHARTE_DEF: Charte = {
  ton: 'Chaleureux, gourmand, simple et artisanal.',
  vouvoiement: true,
  emojisMax: 2,
  motsInterdits: [],
  hashtags: ['#latelierby'],
  hashtagVille: true,
  longueur: 125,
  signature: '',
}

export const charte = (serveur: Serveur): Charte => ({ ...CHARTE_DEF, ...((serveur.charte as Partial<Charte> | undefined) ?? {}) })

export interface Remarque {
  niveau: 'erreur' | 'attention' | 'conseil'
  msg: string
}

/** Relecture d'un texte selon la charte (prix de vente connu, lien, langue). */
export function relire(c: Charte, texte: string, ctx: { prix?: number | null; lien?: boolean; langue?: string }): Remarque[] {
  const t = String(texte || '')
  const out: Remarque[] = []
  const L = ctx.langue || 'fr'
  if (!t.trim()) return out
  const nn = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const emojis = (t.match(/\p{Extended_Pictographic}/gu) || []).length
  if (emojis > c.emojisMax) out.push({ niveau: 'attention', msg: `${emojis} emojis (la charte en permet ${c.emojisMax})` })
  for (const m of c.motsInterdits || []) {
    if (m && new RegExp(`(^|[^\\p{L}])${nn(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(nn(t))) out.push({ niveau: 'erreur', msg: `« ${m} » : mot à éviter (charte)` })
  }
  if (L === 'fr' && c.vouvoiement && /(^|[^\p{L}])(tu|toi|ton|ta|tes|te|t’|t')([^\p{L}]|$)/iu.test(t.replace(/\{[^}]*\}/g, ''))) out.push({ niveau: 'attention', msg: 'tutoiement : la charte vouvoie' })
  if (L === 'nl' && c.vouvoiement && /(^|[^\p{L}])(je|jij|jou|jouw)([^\p{L}]|$)/iu.test(t)) out.push({ niveau: 'conseil', msg: 'néerlandais : « je/jij » — la charte vouvoie (« u »)' })
  const premiere = (t.split(/(?<=[.!?…])\s|\n/)[0] || '').trim()
  if (premiere.length > c.longueur) out.push({ niveau: 'conseil', msg: `accroche de ${premiere.length} caractères : seuls ~${c.longueur} s’affichent avant « Voir plus »` })
  if ((t.match(/!/g) || []).length > 2 || /!!|\?\?/.test(t)) out.push({ niveau: 'conseil', msg: 'trop de points d’exclamation' })
  const cris = (t.replace(/\{[^}]*\}/g, '').match(/\b[\p{Lu}]{5,}\b/gu) || []).filter((w) => !/^(CLICK|COLLECT)$/.test(w))
  if (cris.length) out.push({ niveau: 'conseil', msg: `mots en capitales (${cris.slice(0, 3).join(', ')}) : à réserver au visuel` })
  if (ctx.prix != null) {
    const vus = (t.match(/(\d+[.,]\d{2})\s?€/g) || []).map((x) => +x.replace(/[^\d,.]/g, '').replace(',', '.'))
    const prix = ctx.prix
    const faux = vus.filter((x) => Math.abs(x - prix) > 0.004)
    if (faux.length && !vus.some((x) => Math.abs(x - prix) <= 0.004))
      out.push({ niveau: 'erreur', msg: `prix ${faux.map((x) => `${x.toFixed(2).replace('.', ',')} €`).join(', ')} dans le texte ≠ prix de vente ${prix.toFixed(2).replace('.', ',')} €` })
  }
  if (ctx.lien && !/\{lien\}/.test(t)) out.push({ niveau: 'conseil', msg: 'le lien est ajouté en fin de post (placez {lien} pour le mettre ailleurs)' })
  return out
}

/** Une offre liée au post (promotion, bundle ou formule), telle que le post la garde. */
export interface OffrePost {
  genre: 'promotion' | 'formule'
  id?: number | string
  type?: string
  nom?: string
  court?: string
  libelle?: string
  du?: string | null
  au?: string | null
  tous?: boolean
  shops?: string[]
  portee?: string
  prix?: number | null
  shop?: string | null
}

/** La mention d'une promotion, tirée de l'API (dates, boutiques), en français ou en néerlandais. */
export function mentionOffre(x: OffrePost, L: string): string {
  const d = (s?: string | null) => (s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '')
  const et = (txt: string | undefined, mot: string) => String(txt || '').replace(/, ([^,]*)$/, ` ${mot} $1`)
  // Seulement ce que l'API dit : les dates si elle en a, les boutiques (toutes, ou lesquelles).
  if (L === 'nl') {
    const q = x.du && x.au ? `van ${d(x.du)} tot ${d(x.au)}` : x.au ? `tot ${d(x.au)}` : x.du ? `vanaf ${d(x.du)}` : ''
    const w = x.tous ? 'in alle winkels' : x.portee ? `in ${et(x.portee, 'en')}` : ''
    return `Aanbod geldig ${[q, w].filter(Boolean).join(', ')}.`
  }
  const q = x.du && x.au ? `du ${d(x.du)} au ${d(x.au)}` : x.au ? `jusqu’au ${d(x.au)}` : x.du ? `à partir du ${d(x.du)}` : ''
  const w = x.tous ? 'dans toutes les boutiques' : x.portee ? `à ${et(x.portee, 'et')}` : ''
  return `Offre valable ${[q, w].filter(Boolean).join(', ')}.`
}
