import { Fragment, useCallback, useEffect, useReducer, useRef } from 'react'
import type { CSSProperties, ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { ROOTS } from '../../lib/api/module'
import './social.css'
import './post.css'
import { addDays, dLabel, dShort, eur } from '../../lib/social/format'
import { CONN, POST_TYPES, imageSocial } from '../../lib/social/refs'
import { lienSocial } from '../../lib/social/liens'
import { effacerAvis, enregistrer, journaliser, libelleBoutiques, parId, useSocial } from '../../lib/social/store'
import type { Boutique, EtatSocial, Objet, Serveur } from '../../lib/social/store'
import { languesDe, remplir } from '../../lib/social/ecrans'
import { enregistrerParametres } from '../../lib/social/api-parametres'
import { charte, lienTexte, mentionOffre, placerLien, relire } from '../../lib/social/post-outils'
import type { OffrePost } from '../../lib/social/post-outils'
import {
  corrigerTextes,
  deposerContenu,
  deposerFichier,
  detourer,
  lireCatalogue,
  lireClassements,
  lireGrilleInstagram,
  lireIdees,
  lireMediatheque,
  lireOffres,
  lirePrixBoutiques,
  lireRecommandations,
  photoLocale,
  poserCouverture,
  proposerTextes,
  reclasserMedia,
  retirerMedia,
  verifierCatalogue,
} from '../../lib/social/api-post'
import type { Classements, Correction, Idee, MediaCommun, NavCatalogue, NavProduit, OffresCatalogue, Reco, Variante } from '../../lib/social/api-post'
import { designImages } from '../media/sources'
import StudioVisuel from './StudioVisuel'
import type { ControleStudio, StudioApi } from './StudioVisuel'
import { ASSET, ETIQUETTES, FONDS, FORMES, LOGOS, POLICES, TRAITS, tonDe } from './studio-ds'
import type { ModeleEtiquette, PhotoVisuel, Qc, TextePose, Visuel } from './studio-ds'
import * as Montages from './montage'
import type { Montage } from './montage'

/**
 * « Créer un post » — l'écran du module Social & Ads (social/public/SA Post.dc.html et son studio
 * Posts Facebook.dc.html), réécrit dans le Marketing (docs/PORTAILS.md, étape 2f). Un seul formulaire :
 * type, produit / catégorie / gamme du catalogue du webshop et ses offres, visuel (composé dans le studio,
 * montage Instagram ou photos telles quelles), ciblage par boutique et canal, texte FR / NL avec l'assistant
 * de rédaction et la relecture de la charte, publication (immédiate, programmée ou dark post), aperçu
 * Facebook / Instagram / story / grille, médiathèque commune du marketing. Le post s'écrit dans l'état du
 * module (`/state`) ; le serveur du module publie chez Meta.
 */
export interface PostViewProps {
  /** « ← Calendrier » : le retour au calendrier éditorial. */
  onRetour?: () => void
  /** « Voir le calendrier » du message qui suit un enregistrement (le retour, à défaut). */
  onCalendrier?: () => void
  /** Après chaque enregistrement (brouillon, programmation, publication, dark post) : le post tel qu'enregistré. */
  onApresEnregistrement?: (post: { id: string; status: string }) => void
  /** « Enregistrer et créer la publicité → » d'un dark post : l'assistant des Publicités sur ce post. */
  onCreerPub?: (postId: string) => void
  /** « Voir les publicités et les commentaires → » d'un dark post déjà diffusé. */
  onVoirPubs?: (adId?: string) => void
  /** « Paramètres → Rédaction IA » quand la clé API Anthropic manque. */
  onParametresIa?: () => void
  /** L'opération liée présélectionnée (l'identifiant de la campagne dans le Marketing, ou « bo-… »). */
  operation?: number | string | null
}

// ── Types ───────────────────────────────────────────────────────────────────

type Mode = 'studio' | 'pano' | 'collage' | 'frise' | 'brut'
type Canaux = Record<string, { fb?: boolean; ig?: boolean }>
interface PhotoPost extends PhotoVisuel {
  origine?: string
}
interface VideoPost {
  src: string
  name: string
  poster?: string | null
}
/** Un élément du catalogue choisi pour le post (produit, sous-catégorie, catégorie ou gamme). */
interface Choix {
  kind: 'produit' | 'categorie' | 'groupe' | 'gamme'
  id: number
  name: string
  nameNl?: string
  image?: string
  prix?: number | null
  shop?: string | null
  cat?: number
}
interface VisuelLib {
  id: string
  mid?: string
  shared?: boolean
  ds?: boolean
  src: string
  orig?: string
  thumb?: string | null
  name: string
  cat: string
  sub: string
  season: string
  cut: boolean
  kind?: 'video'
  poster?: string | null
}
interface PrixBoutiques {
  key: string
  loading: boolean
  prix: Record<string, number | null> | null
  err: string
}
interface VideoAnimee {
  src: string
  type: string
  h264: boolean
  taille: number
  publier: boolean
}
interface ModeleVisuel {
  id: string
  nom: string
  v: Partial<Visuel>
}
interface FormModele {
  name: string
  description: string
  validation: boolean
  free: boolean
}
type CorrectionPost = Correction & { avant: { fr: string; nl: string } }
type Groupe = Objet & { name: string; shops: string[] }

/** Un post de l'état du module, tel que l'écran le lit et l'écrit. */
interface PostSocial extends Objet {
  date: string
  time: string
  type: string
  title: string
  img: string
  media?: { src: string; kind: string; cut?: boolean; name?: string }[]
  visual?: { v: Partial<Visuel>; photos: PhotoPost[] } | null
  montage?: { kind: Mode; m: Partial<Montage>; photos: PhotoPost[] } | null
  frise?: { tiles: string[] } | null
  shops: string[] | 'all'
  ch?: Canaux
  marque?: boolean
  fb?: boolean
  ig?: boolean
  status: string
  campaign?: string | null
  text?: string
  textNl?: string
  link?: string
  linkText?: { fr: string; nl: string } | null
  offre?: OffrePost | null
  spread?: number
  product?: string | null
  catalogue?: Choix | null
  dark?: boolean
}

interface ProduitCatalogue {
  id: string
  apiId?: number | string
  kind?: string
  name: string
  nameNl?: string
  price?: string | number
  categoryId?: number | string
  gamme?: string
  webshop?: boolean
}

interface St {
  id: string | null
  type: string
  product: string | null
  scope: 'all' | 'group' | 'shop'
  group: string | null
  sel: string[]
  marque: boolean
  ch: Canaux
  text: string
  textNl: string
  edLang: 'fr' | 'nl'
  pvLang: string | null
  link: string
  linkText: { fr: string; nl: string }
  campaign: string
  mode: Mode
  photos: PhotoPost[]
  video: VideoPost | null
  videoFormat: 'video' | 'reel'
  v: Visuel
  m: Montage
  mPrev: { key: string; slices: string[]; full?: string }
  mIdx: number
  dark: boolean
  when: 'now' | 'later'
  date: string
  time: string
  spread: number
  pv: 'fb' | 'ig'
  pvShop: string | null
  pvVue: 'post' | 'story' | 'grille'
  tel: boolean
  status: string | null
  txtSel: string | null
  txtTplNom: string
  qc: Qc[]
  visNom: string
  kitBusy: boolean
  offre: OffrePost | null
  mentionAuto: boolean
  iaBusy: boolean
  iaRes: { variantes?: Variante[]; hashtags?: string[] } | null
  iaErr: string
  iaConsigne: string
  cor: CorrectionPost | null
  objectif: string
  inspi: boolean | null
  cutBusy: string | null
  couleurRole: string | null
  couleurNom: string
  grilleData: Record<string, { src: string }[]>
  grilleSnap: string | null
  vidBusy: boolean
  vidAnim: VideoAnimee | null
  idees: { idees?: Idee[]; muettes?: string[] } | null
  ideesTout: boolean
  ideesBusy: boolean
  ideesErr: string
  reco: Reco | null
  recoLu: boolean
  recoBusy: boolean
  recoErr: string
  ideeId: string
  ideeCat: { kind: string; id: number } | null
  ideeOffre: number | string | null
  nav: NavCatalogue | null
  navKey: string | null
  navLoading: boolean
  navErr: string
  navMode: 'cat' | 'gamme'
  navG: number | null
  navC: number | null
  navGam: number | null
  navQ: string
  navSel: Choix | null
  offres: OffresCatalogue | null
  offresKey: string
  offresLoading: boolean
  offreUsed: string
  pb: PrixBoutiques | null
  pbApercu: string | null
  libOpen: boolean
  lib: VisuelLib[]
  query: string
  fCat: string
  fSeason: string
  mQuery: string
  mCat: string
  mSub: string
  mSeason: string
  mOnlyPost: boolean
  editId: string | null
  toast: string
  errors: string[]
  saving: boolean
  partage: boolean
  partageErr: string
  versement: { fait: number; total: number } | null
  illusOpen: boolean
  illusCat: string | null
  tplOpen: boolean
  tplForm: FormModele
  tplErr: string
  tplBusy: boolean
  wsQ: string
  dsIllus: VisuelLib[]
}

// ── Constantes de l'écran (reprises de SA Post.dc.html) ─────────────────────

const FORMATS_V: [string, string, string][] = [
  ['carre', 'Carré 1:1', '1080 × 1080 · entier dans le fil Facebook et Instagram, sur mobile comme sur ordinateur. Sur un écran d’ordinateur peu haut, Facebook peut le réduire et ajouter des bandes de couleur sur les côtés.'],
  ['portrait', 'Portrait 4:5', '1080 × 1350 · le plus grand sur mobile (Facebook et Instagram). Sur ordinateur, Facebook le réduit davantage : bandes de couleur sur les côtés.'],
  ['story', 'Story 9:16', '1080 × 1920 · stories Facebook et Instagram, plein écran sur téléphone. Le haut et le bas sont couverts par l’interface d’Instagram : le contrôle signale ce qui y tombe.'],
  ['paysage', 'Paysage 1,91:1', '1200 × 630 · toute la largeur du fil sur ordinateur, sans bandes sur les côtés. Plus petit sur mobile ; Instagram l’accepte tel quel.'],
]
const STYLES1: [string, string][] = [
  ['epure', 'Épuré'], ['abricot', 'Abricot'], ['ruby', 'Ruby'], ['noir', 'Noir'], ['plein', 'Plein cadre'],
  ['pleinbandeau', 'Plein · bandeau'], ['pleinencart', 'Plein · encart'], ['pleinhaut', 'Plein · titre haut'], ['pleinfilet', 'Plein · filet'], ['duo', 'Duo'],
]
const STYLES2: [string, string, number][] = [
  ['mosaique', 'Mosaïque', 12], ['grille', 'Grille 2×2', 4], ['trio', 'Trio', 3], ['collage', 'Collage', 5], ['bandes', 'Bandes', 3], ['galerie', 'Galerie 3×3', 9],
  ['frise', 'Frise', 4], ['puzzle', 'Puzzle', 5], ['pastilles', 'Pastilles', 4], ['epinglees', 'Épinglées', 3], ['etagere', 'Étagère', 6], ['diagonale', 'Diagonale', 3],
  ['vedette', 'Vedette', 5], ['damier', 'Damier', 8], ['encadre', 'Encadré', 4], ['nuit', 'Nuit', 3],
]
const CATS: Record<string, string[]> = {
  Viennoiseries: ['Croissants', 'Pains au chocolat', 'Brioches', 'Chaussons'],
  Pains: ['Baguettes', 'Pains spéciaux', 'Pains de mie', 'Petits pains'],
  Pâtisseries: ['Gâteaux', 'Entremets', 'Cupcakes', 'Biscuits & cookies'],
  Tartes: ['Tartes sucrées', 'Tartes salées', 'Quiches'],
  'Sandwichs & salés': ['Sandwichs', 'Salades', 'Plateaux'],
  Boissons: ['Chaudes', 'Froides', 'Limonades'],
  'Ambiance & boutique': ['Vitrine', 'Équipe', 'Atelier'],
  Illustrations: ['Produits', 'Fruits', 'Légumes', 'Saisonnier', 'Pictos', 'Services', 'Décoratif'],
}
const SAISONS = ["Toute l'année", 'Printemps', 'Été', 'Automne', 'Hiver', 'Noël & Nouvel An', 'Épiphanie', 'Saint-Valentin', 'Pâques', 'Fête des mères', 'Saint-Nicolas']
const NOMS_TEXTE: Record<string, string> = { eyebrow: 'Mention saison', title: 'Nom du produit', phrase: 'Phrase d’accroche', price: 'Prix', unit: 'Unité', promo: 'Offre', promoSub: 'Sous-texte de l’offre', site: 'Site web' }
const LOC = ['eyebrow', 'title', 'phrase', 'unit', 'promoSub'] as const
const CLES_MODELE = ['style', 'format', 'fond', 'logo', 'fondu', 'cutMode', 'illus', 'textes', 'showLogo', 'showEyebrow', 'showTitle', 'showPhrase', 'showPrice', 'showPromo', 'showSite', 'eyebrow', 'phrase', 'unit', 'site', 'phraseFont', 'phraseColor', 'couleurs'] as const
const PLEINS_FONDU = ['plein', 'pleinbandeau', 'pleinhaut', 'pleinfilet']
const KIND: Record<string, string> = { produit: 'Produit', categorie: 'Sous-catégorie', groupe: 'Catégorie', gamme: 'Gamme' }
const TAG: Record<string, [string, string]> = { bundle: ['Bundle', 'is-noir'], offre: ['Offre', 'is-ruby'], remise: ['Remise', 'is-or'], quantite: ['Quantité', 'is-ruby'], formule: ['Formule', 'is-vert'] }
const TAGI: Record<string, [string, string]> = { promo: ['Promotion', 'is-ruby'], operation: ['Opération', 'is-noir'], gamme: ['Gamme', 'is-or'], creux: ['Heures creuses', 'is-vert'] }
const POS_TXT: [string, number, number][] = [['↖', 18, 18], ['↑', 50, 14], ['↗', 82, 18], ['←', 18, 50], ['●', 50, 50], ['→', 82, 50], ['↙', 18, 82], ['↓', 50, 86], ['↘', 82, 82]]
const POS_ILL: [string, number, number][] = [['↖', 16, 16], ['↑', 50, 14], ['↗', 84, 16], ['←', 14, 50], ['●', 50, 50], ['→', 86, 50], ['↙', 16, 84], ['↓', 50, 86], ['↘', 84, 84]]
const VARS: [string, string][] = [
  ['{lien}', 'Le lien du post, précédé de son texte (« Commandez ici 👉 https://… »)'], ['{webshop}', 'Lien du webshop de la boutique'], ['{webshop_produit}', 'Lien du produit dans le webshop de la boutique'],
  ['{ville}', 'Nom de la boutique'], ['{adresse}', 'Adresse de la boutique'], ['{horaires}', "Horaires d'ouverture"], ['{prix}', 'Prix du produit choisi'], ['{produit_du_jour}', 'Produit du jour (catalogue)'],
]
const PHRASES: [string, string, string][] = [['script', 'Script', "'Studio Playwrite'"], ['display', 'DISPLAY', "'Studio Vank'"], ['sans', 'Sans', "'Studio Gotham'"]]

const visuelDefaut = (): Visuel => ({
  style: 'epure', format: 'carre', textes: [], fondu: 60, logo: 'auto', cutMode: 'auto',
  showLogo: true, showEyebrow: true, showTitle: true, showPhrase: true, showPrice: true, showPromo: false, showSite: true,
  nl: { eyebrow: 'Seizoenseditie · Herfst 2026', title: '', phrase: '', unit: 'Per stuk', promoSub: 'de 5de gratis' },
  eyebrow: 'Édition saisonnière · Automne 2026', title: '', phrase: '', price: '', unit: 'La pièce', promo: '4+1', promoSub: 'la 5ᵉ offerte', site: 'www.latelierby.be', phraseFont: 'script', phraseColor: 'auto',
})
const montageDefaut = (): Montage => ({ n: 3, tpl: 'trio', title: '', band: '', price: '', sign: "L'Atelier By" })
const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'erreur'
const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const virgule = (n: number) => String(n.toFixed(2)).replace('.', ',')
const estMontage = (mode: Mode) => mode === 'pano' || mode === 'collage' || mode === 'frise'
const nomFichier = (t: string) => String(t || 'visuel').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'visuel'
const hexFond = (k: string | null | undefined) => FONDS.find((f) => f.id === k)?.hex ?? ''
const PALETTE_TEXTE = [{ id: 'auto', nom: 'Automatique (couleur du style)', hex: '#FFFFFF' }, ...FONDS.map((f) => ({ id: f.id, nom: f.nom, hex: f.hex })), { id: 'gris', nom: 'Gris', hex: '#8A847C' }]

function correspond(it: VisuelLib, q: string, cat: string, sub: string, season: string) {
  if (cat === '—') {
    if (it.cat) return false
  } else if (cat && it.cat !== cat) return false
  if (sub && it.sub !== sub) return false
  if (season && it.season !== season) return false
  if (q) {
    const hay = norm([it.name, it.cat, it.sub, it.season].join(' '))
    for (const w of norm(q).split(/\s+/).filter(Boolean)) if (!hay.includes(w)) return false
  }
  return true
}

// ── Médiathèque du navigateur (IndexedDB « latelier-fbpost », la même que l'ancien écran) ──

function idbLire(): Promise<VisuelLib[] | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('latelier-fbpost', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('kv')
      r.onerror = () => res(null)
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('kv', 'readonly')
        const q = tx.objectStore('kv').get('library')
        tx.oncomplete = () => {
          res(Array.isArray(q.result) ? (q.result as VisuelLib[]) : null)
          db.close()
        }
        tx.onerror = () => {
          res(null)
          db.close()
        }
      }
    } catch {
      res(null)
    }
  })
}
/** Ce qui est dans la médiathèque commune vit sur le serveur : le navigateur ne garde que le reste. */
function idbGarder(list: VisuelLib[]) {
  const reste = list.filter((x) => !x.shared)
  try {
    const r = indexedDB.open('latelier-fbpost', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => {
      const db = r.result
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(reste, 'library')
      tx.oncomplete = () => db.close()
      tx.onerror = () => db.close()
    }
  } catch {
    /* stockage indisponible */
  }
}
const lireRetires = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('latelier.fbpost.dsRemoved') || '[]') as string[]
  } catch {
    return []
  }
}

/** Les illustrations du design system (servies avec le module Social), à la forme des visuels de la médiathèque. */
async function illustrationsDs(): Promise<VisuelLib[]> {
  await designImages()
  return (window.DS_ILLUS ?? []).map((r) => {
    const x = r as Record<string, unknown>
    return { id: String(x.id), src: String(x.src), name: String(x.name ?? ''), cat: String(x.cat ?? ''), sub: String(x.sub ?? ''), season: String(x.season ?? "Toute l'année"), cut: x.cut !== false, ds: true }
  })
}

/** Une fiche de la médiathèque commune, à la forme des visuels de l'écran (le post prend la version web, 2 048 px). */
const depuisPartage = (m: MediaCommun): VisuelLib => ({
  id: `m${m.id}`,
  mid: String(m.id),
  shared: true,
  src: m.kind === 'video' ? m.url : m.webUrl || m.url,
  orig: m.url,
  thumb: m.thumbnailUrl || null,
  name: m.name,
  cat: m.category ? m.category.label : '',
  sub: m.subcategory ? m.subcategory.label : '',
  season: m.season ? m.season.label : "Toute l'année",
  cut: !!m.cutout,
  kind: m.kind === 'video' ? 'video' : undefined,
  poster: m.thumbnailUrl || null,
})

/** Une photo du téléphone ou de l'ordinateur : détourée ou non (bords transparents), réduite à 2 048 px. */
function lirePhoto(file: File): Promise<{ src: string; cut: boolean; name: string } | null> {
  return new Promise((res) => {
    if (!file || !/^image\//.test(file.type)) {
      res(null)
      return
    }
    const rd = new FileReader()
    rd.onerror = () => res(null)
    rd.onload = () => {
      const url = String(rd.result)
      const img = new Image()
      img.onerror = () => res({ src: url, cut: false, name: file.name })
      img.onload = () => {
        let cut = false
        try {
          const c = document.createElement('canvas')
          c.width = 32
          c.height = 32
          const x = c.getContext('2d')
          if (x) {
            x.drawImage(img, 0, 0, 32, 32)
            const d = x.getImageData(0, 0, 32, 32).data
            let clear = 0
            let tot = 0
            for (let y = 0; y < 32; y++)
              for (let k = 0; k < 32; k++) {
                if (k > 1 && k < 30 && y > 1 && y < 30) continue
                tot++
                if (d[(y * 32 + k) * 4 + 3] < 16) clear++
              }
            cut = clear / tot > 0.35
          }
        } catch {
          /* image illisible par le canvas */
        }
        // Photo de téléphone : réduite à 2048 px (Meta n'en garde pas plus) pour que l'envoi reste léger.
        let src = url
        try {
          const big = Math.max(img.width, img.height)
          const r = big > 2048 ? 2048 / big : 1
          if (r < 1 || (!cut && file.size > 1500000)) {
            const c = document.createElement('canvas')
            c.width = Math.round(img.width * r)
            c.height = Math.round(img.height * r)
            c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
            src = cut ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9)
          }
        } catch {
          src = url
        }
        res({ src, cut, name: file.name })
      }
      img.src = url
    }
    rd.readAsDataURL(file)
  })
}

/** L'état de départ : un post neuf, ou le post de l'adresse (`?id=`) ; `?marque=1`, `?date=`, `?op=`, `?shop=`. */
function etatInitial(etat: EtatSocial, serveur: Serveur, operation: PostViewProps['operation']): St {
  const SHOPS = etat.shops.filter((x) => !x.test)
  const TESTS = etat.shops.filter((x) => x.test)
  const v = visuelDefaut()
  const ch: Canaux = {}
  SHOPS.forEach((x) => (ch[x.id] = { fb: x.fb === 'connected', ig: x.igs === 'connected' }))
  // Magasins test : hors du réseau, jamais cochés d'office ; jamais sur l'Instagram du réseau.
  TESTS.forEach((x) => (ch[x.id] = { fb: x.fb === 'connected', ig: false }))
  // La Page de la marque : sa Page Facebook d'office, son Instagram (celui du réseau) à cocher.
  const br = (serveur.brand ?? {}) as Record<string, unknown>
  ch.marque = { fb: br.fb === 'connected', ig: false }
  let inspi: boolean | null = null
  try {
    const x = localStorage.getItem('sa.inspi')
    inspi = x === null ? null : x === '1'
  } catch {
    inspi = null
  }
  const base: St = {
    id: null, type: 'Produit', product: null, scope: 'all', group: null, sel: SHOPS.map((x) => x.id), marque: false, ch, text: '', textNl: '', edLang: 'fr', pvLang: null,
    link: '', linkText: { fr: '', nl: '' }, campaign: '', mode: 'studio', photos: [], video: null, videoFormat: 'video', v, m: montageDefaut(), mPrev: { key: '', slices: [] }, mIdx: 0,
    dark: false, when: 'later', date: addDays(serveur.today, 1), time: '08:00', spread: 10, pv: 'fb', pvShop: null, pvVue: 'post', tel: false, status: null,
    txtSel: null, txtTplNom: '', qc: [], visNom: '', kitBusy: false, offre: null, mentionAuto: true, iaBusy: false, iaRes: null, iaErr: '', iaConsigne: '', cor: null,
    objectif: '', inspi, cutBusy: null, couleurRole: null, couleurNom: '', grilleData: {}, grilleSnap: null, vidBusy: false, vidAnim: null,
    idees: null, ideesTout: false, ideesBusy: false, ideesErr: '', reco: null, recoLu: false, recoBusy: false, recoErr: '', ideeId: '', ideeCat: null, ideeOffre: null,
    nav: null, navKey: null, navLoading: false, navErr: '', navMode: 'cat', navG: null, navC: null, navGam: null, navQ: '', navSel: null, offres: null, offresKey: '', offresLoading: false, offreUsed: '',
    pb: null, pbApercu: null, libOpen: false, lib: [], query: '', fCat: '', fSeason: '', mQuery: '', mCat: '', mSub: '', mSeason: '', mOnlyPost: false, editId: null,
    toast: '', errors: [], saving: false, partage: false, partageErr: '', versement: null, illusOpen: false, illusCat: null,
    tplOpen: false, tplForm: { name: '', description: '', validation: false, free: false }, tplErr: '', tplBusy: false, wsQ: '', dsIllus: [],
  }
  const id = param('id')
  const p = id ? (etat.posts.find((x) => x.id === id) as PostSocial | undefined) : undefined
  if (p) {
    const shops = p.shops === 'all' ? SHOPS.map((x) => x.id) : p.shops.slice()
    Object.assign(base, {
      id: p.id, type: p.type, text: p.text || '', textNl: p.textNl || '', link: p.link || '', linkText: { fr: '', nl: '', ...(p.linkText || {}) }, campaign: p.campaign || '',
      date: p.date, time: p.time, sel: shops, scope: shops.length === SHOPS.length ? 'all' : 'shop', status: p.status, spread: p.spread || 10, product: p.product || null,
      dark: !!p.dark, marque: !!p.marque,
    })
    if (p.ch) base.ch = { marque: base.ch.marque, ...p.ch }
    if (p.catalogue) base.navSel = p.catalogue
    if (p.offre) base.offre = p.offre
    if (p.montage) {
      base.mode = p.montage.kind === 'collage' || p.montage.kind === 'frise' ? p.montage.kind : 'pano'
      base.m = { ...montageDefaut(), ...p.montage.m }
      base.photos = p.montage.photos || []
    } else if (p.visual) {
      base.mode = 'studio'
      base.v = { ...v, ...p.visual.v, nl: { ...v.nl, ...(p.visual.v?.nl || {}) } }
      base.photos = p.visual.photos || []
    } else {
      base.mode = 'brut'
      base.photos = (p.media || (p.img ? [{ src: p.img, kind: 'img', cut: true }] : []))
        .filter((x) => x.kind !== 'video')
        .map((x) => ({ src: x.src, cut: x.cut !== false, name: x.name || '' }))
      base.v.title = p.title
      // La vidéo du post revient avec lui.
      const vd = (p.media || []).find((x) => x.kind === 'video')
      if (vd) base.video = { src: vd.src, name: vd.name || 'Vidéo' }
    }
  }
  const shop = param('shop')
  if (shop && !p) {
    base.scope = 'shop'
    base.sel = [shop]
  }
  // `?marque=1` (Repost automatique → À venir) : un post de la marque seule, sur sa Page.
  if (param('marque') === '1' && !p) {
    base.marque = true
    base.scope = 'shop'
    base.sel = []
  }
  const date = param('date')
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !p) base.date = date
  // Opération présélectionnée (`?op=bo-19`, ou `?op=19` : l'identifiant de la campagne dans le Marketing).
  const op = param('op') || (operation != null && operation !== '' ? String(operation) : '')
  if (op && !p) base.campaign = /^\d+$/.test(op) ? `bo-${op}` : op
  return base
}

export default function PostView(props: PostViewProps) {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>
  return <Post etat={etat} serveur={serveur} avis={avis} props={props} />
}

function Post({ etat, serveur, avis, props }: { etat: EtatSocial; serveur: Serveur; avis: string | null; props: PostViewProps }) {
  // L'état de l'écran, lu et écrit comme celui de l'ancien composant (un objet, des changements fusionnés) :
  // la référence est toujours à jour, les gestes asynchrones lisent l'état courant.
  const sRef = useRef<St | null>(null)
  if (!sRef.current) sRef.current = etatInitial(etat, serveur, props.operation)
  const [, rendre] = useReducer((x: number) => x + 1, 0)
  const s = sRef.current
  const cur = () => sRef.current as St
  const put = useCallback((p: Partial<St> | ((st: St) => Partial<St>)) => {
    const st = sRef.current as St
    sRef.current = { ...st, ...(typeof p === 'function' ? p(st) : p) }
    rendre()
  }, [])
  // Attendre que l'écran ait suivi (changer de format, puis exporter le visuel).
  const rendus = useRef<(() => void)[]>([])
  const putAttendre = (p: Partial<St>) =>
    new Promise<void>((r) => {
      rendus.current.push(r)
      put(p)
    })
  useEffect(() => {
    const l = rendus.current
    rendus.current = []
    l.forEach((f) => f())
  })
  const V = (patch: Partial<Visuel>) => put((st) => ({ v: { ...st.v, ...patch } }))

  const api = useRef<StudioApi | null>(null)
  const mort = useRef(false)
  const toastT = useRef<number | undefined>(undefined)
  const autoFr = useRef<string | null>('')
  const autoNl = useRef<string | null>('')
  const etqDernier = useRef<string | null>(null)
  const refs = useRef<Classements | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const txtIn = useRef<HTMLInputElement | null>(null)
  const srcIn = useRef<HTMLTextAreaElement | null>(null)
  const edT = useRef<number | undefined>(undefined)
  const mKey = useRef('')
  const mT = useRef<number | undefined>(undefined)
  const snapCle = useRef('')
  const snapT = useRef<number | undefined>(undefined)
  const grilleLu = useRef(false)
  const inspiLu = useRef(false)
  const ideeWait = useRef(false)

  const TODAY = serveur.today
  const SHOPS = etat.shops.filter((x) => !x.test)
  const TESTS = etat.shops.filter((x) => x.test)
  const GROUPS = etat.groups as Groupe[]
  const CATALOGUE = (serveur.catalogue ?? []) as unknown as ProduitCatalogue[]
  const nomDe = (id: string) => parId(etat.shops, id)?.name ?? id
  const langsOf = (id: string | Boutique) => languesDe(etat, id)
  const igUnique = !!serveur.instagramUnique
  const brand = (serveur.brand ?? {}) as Record<string, unknown>
  const igHandle = String(brand.ig || 'le compte de la marque')
  const ia = (serveur.ia as { configure?: boolean; modele?: string; detourage?: boolean } | undefined) ?? { configure: false }
  const locked = s.status === 'Publié'
  const retour = () => (props.onRetour ? props.onRetour() : (window.location.href = lienSocial('cal')))
  const voirCalendrier = () => (props.onCalendrier ?? props.onRetour ?? (() => (window.location.href = lienSocial('cal'))))()

  // Le plan du webshop complété par le catalogue lu : les liens {webshop_produit:…} se résolvent comme sur le serveur.
  const serveurPv: Serveur = (() => {
    const nav = s.nav
    if (!nav) return serveur
    const plan = (serveur.webshopPlan ?? {}) as { cats?: Record<string, number>; prods?: Record<string, number> }
    const cats: Record<string, number> = { ...(plan.cats ?? {}) }
    const prods: Record<string, number> = { ...(plan.prods ?? {}) }
    for (const c of nav.categories) if (c.id) cats[c.id] = Math.max(Number(c.groupe) || 0, cats[c.id] || 0)
    for (const p of nav.produits) if (p.id && p.cat) prods[p.id] = p.cat
    return { ...serveur, webshopPlan: { ...plan, cats, prods } }
  })()
  const fill = (txt: string, shop: string | Boutique | null | undefined, produit?: ProduitCatalogue | null, L?: string) =>
    remplir(etat, serveurPv, txt, shop, produit ? { ...produit, price: produit.price } : null, L)

  const toast = (msg: string) => {
    window.clearTimeout(toastT.current)
    put({ toast: msg })
    toastT.current = window.setTimeout(() => put({ toast: '' }), 4000)
  }
  useEffect(() => {
    mort.current = false
    return () => {
      mort.current = true
      window.clearTimeout(toastT.current)
      window.clearTimeout(mT.current)
      window.clearTimeout(snapT.current)
      window.clearTimeout(edT.current)
    }
  }, [])

  /** Les boutiques visées : celles du réseau et les magasins test cochés (jamais un identifiant inconnu). */
  const targets = (st: St = cur()) => st.sel.filter((id) => !!parId(SHOPS, id) || !!parId(TESTS, id))
  const ficheDefaut = () => (etat.params as { lien_fiche?: boolean }).lien_fiche !== false

  // ── Médiathèque : commune au marketing (serveur), plus ce que ce navigateur garde et le design system ──
  const partageOk = () => cur().partage
  useEffect(() => {
    let vivant = true
    ;(async () => {
      let lib = (await idbLire()) ?? []
      try {
        const ds = await illustrationsDs()
        if (vivant) put({ dsIllus: ds })
        const rm = new Set(lireRetires())
        const have = new Set(lib.map((x) => x.id))
        const fresh = ds.filter((x) => !have.has(x.id) && !rm.has(x.id))
        if (fresh.length) {
          lib = lib.concat(fresh)
          idbGarder(lib)
        }
      } catch {
        /* design system indisponible : la médiathèque garde le reste */
      }
      if (!vivant) return
      put((st) => ({ lib: st.lib.filter((x) => x.shared).concat(lib.filter((x) => !x.shared)) }))
      try {
        const r = await lireClassements()
        refs.current = r?.data ?? null
        let items: MediaCommun[] = []
        let page = 1
        let pages = 1
        do {
          const q = await lireMediatheque(page)
          items = items.concat(q?.data ?? [])
          pages = q?.meta?.pagination?.totalPages || 1
          page++
        } while (page <= pages && page <= 30)
        if (!vivant) return
        const shared = items.map(depuisPartage)
        put((st) => ({ lib: st.lib.filter((x) => !x.shared).concat(shared), partage: true, partageErr: '' }))
      } catch (e) {
        if (vivant) put({ partage: false, partageErr: message(e) })
      }
    })()
    return () => {
      vivant = false
    }
  }, [put])

  const updateLib = (fn: (l: VisuelLib[]) => VisuelLib[]) => {
    const lib = fn(cur().lib.slice())
    put({ lib })
    idbGarder(lib)
  }
  /** Les classements de l'écran (libellés) en codes de la médiathèque commune. */
  const versCodes = (x: VisuelLib) => {
    const R = refs.current ?? { categories: [], seasons: [] }
    const c = (R.categories ?? []).find((k) => k.label === x.cat) ?? null
    const sb = c ? (c.subcategories ?? []).find((k) => k.label === x.sub) ?? null : null
    const se = (R.seasons ?? []).find((k) => k.label === x.season) ?? null
    return { category: c ? c.code : null, subcategory: sb ? sb.code : null, season: se ? se.code : null }
  }
  /** Verse un visuel dans la médiathèque commune (le fichier d'origine s'il est là) ; rend sa fiche partagée, ou null. */
  const verser = async (x: VisuelLib, file: File | null): Promise<VisuelLib | null> => {
    const k = versCodes(x)
    const champs = { name: String(x.name || '').trim() || (x.kind === 'video' ? 'Vidéo' : 'Photo'), cutout: !!x.cut, ...k }
    try {
      const r = file ? await deposerFichier(file, champs) : await deposerContenu(x.src, x.poster || undefined, champs)
      let m = r?.data
      if (!m || !m.id) return null
      if (file && m.kind === 'video' && !m.thumbnailUrl && x.poster && /^data:image\//.test(x.poster)) {
        try {
          const blob = await (await fetch(x.poster)).blob()
          const c = await poserCouverture(m.id, blob)
          if (c?.data) m = c.data
        } catch {
          /* la vidéo reste sans couverture */
        }
      }
      return depuisPartage(m)
    } catch (e) {
      toast(`Médiathèque commune : ${message(e)} — gardé dans ce navigateur.`)
      return null
    }
  }
  const reclasser = async (x: VisuelLib) => {
    if (!String(x.name || '').trim() || !x.mid) return
    try {
      await reclasserMedia(x.mid, { name: String(x.name).trim(), cutout: !!x.cut, ...versCodes(x) })
    } catch (e) {
      toast(`Classement non enregistré dans la médiathèque commune : ${message(e)}`)
    }
  }
  const editItem = (patch: Partial<VisuelLib>) => {
    const id = cur().editId
    const it = cur().lib.find((x) => x.id === id)
    updateLib((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    if (it?.shared && partageOk()) {
      // Le nom se tape lettre à lettre : il n'est enregistré qu'une fois la frappe finie.
      window.clearTimeout(edT.current)
      const fiche = { ...it, ...patch }
      edT.current = window.setTimeout(() => void reclasser(fiche), patch.name !== undefined ? 700 : 0)
    }
  }
  /** Ce navigateur avait sa propre médiathèque : ses visuels rejoignent la médiathèque commune. */
  const verserLocaux = async () => {
    if (!partageOk() || cur().versement) return
    const locaux = cur().lib.filter((x) => !x.shared && !x.ds)
    if (!locaux.length) return
    put({ versement: { fait: 0, total: locaux.length } })
    let ok = 0
    for (const x of locaux) {
      const m = await verser(x, null)
      if (m) {
        ok++
        updateLib((l) => l.filter((y) => y.id !== x.id && y.id !== m.id).concat(m))
      }
      put((st) => ({ versement: { fait: (st.versement?.fait || 0) + 1, total: locaux.length } }))
    }
    put({ versement: null })
    toast(ok === locaux.length ? `${ok}${ok > 1 ? ' visuels versés' : ' visuel versé'} dans la médiathèque commune.` : `${ok} sur ${locaux.length} versés ; les autres restent dans ce navigateur.`)
  }

  /** Une vidéo du téléphone ou de l'ordinateur : lue en data: (45 Mo au plus), avec une vignette tirée de sa première seconde. */
  const lireVideo = (file: File): Promise<VideoPost | null> => {
    if (!file || !/^video\//.test(file.type)) return Promise.resolve(null)
    if (file.size > 45 * 1048576) {
      toast('Vidéo trop lourde : 45 Mo au plus.')
      return Promise.resolve(null)
    }
    const nom = String(file.name || 'Vidéo').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    const vignette = () =>
      new Promise<string | null>((ok) => {
        const url = URL.createObjectURL(file)
        const vd = document.createElement('video')
        let fini = false
        const fin = (x: string | null) => {
          if (fini) return
          fini = true
          try {
            URL.revokeObjectURL(url)
          } catch {
            /* déjà libérée */
          }
          ok(x)
        }
        vd.muted = true
        vd.preload = 'metadata'
        vd.playsInline = true
        vd.onloadeddata = () => {
          try {
            vd.currentTime = Math.min(0.5, (vd.duration || 1) / 2)
          } catch {
            fin(null)
          }
        }
        vd.onseeked = () => {
          try {
            const k = Math.min(1, 480 / Math.max(vd.videoWidth || 1, vd.videoHeight || 1))
            const c = document.createElement('canvas')
            c.width = Math.max(1, Math.round((vd.videoWidth || 480) * k))
            c.height = Math.max(1, Math.round((vd.videoHeight || 480) * k))
            c.getContext('2d')?.drawImage(vd, 0, 0, c.width, c.height)
            fin(c.toDataURL('image/jpeg', 0.8))
          } catch {
            fin(null)
          }
        }
        vd.onerror = () => fin(null)
        window.setTimeout(() => fin(null), 5000)
        vd.src = url
      })
    return Promise.all([
      new Promise<string | null>((ok) => {
        const rd = new FileReader()
        rd.onload = () => ok(String(rd.result))
        rd.onerror = () => ok(null)
        rd.readAsDataURL(file)
      }),
      vignette(),
    ]).then(([src, poster]) => {
      if (!src) {
        toast('Vidéo illisible.')
        return null
      }
      return { src, poster, name: nom }
    })
  }
  /** Met la vidéo dans le post. Une vidéo ne se compose pas dans un visuel : le post passe en « Photos telles quelles ». */
  const choisirVideo = (vd: VideoPost | VisuelLib | null) => {
    if (!vd || cur().status === 'Publié') return
    const st = cur()
    const versBrut = st.mode !== 'brut'
    put({ video: { src: vd.src, name: String(vd.name || 'Vidéo').slice(0, 40), poster: vd.poster || null }, mode: 'brut', type: st.type === 'Libre' ? 'Vidéo / film' : st.type })
    if (versBrut) toast('Vidéo ajoutée : le post passe en « Photos telles quelles » (une vidéo ne se compose pas dans un visuel). Une photo ajoutée sert de couverture.')
  }
  /** Des fichiers → la médiathèque (et le post, si demandé) : photos et vidéos. */
  const addFilesLib = async (files: FileList | File[] | null, toPost: boolean) => {
    const tous = Array.from(files || [])
    const arr = tous.filter((f) => /^image\//.test(f.type)).slice(0, 30)
    const vids = tous.filter((f) => /^video\//.test(f.type)).slice(0, 3)
    if (!arr.length && !vids.length) return
    const lusP = await Promise.all(arr.map(lirePhoto))
    const lusV = await Promise.all(vids.map(lireVideo))
    const id = (i: string | number) => `u${Date.now()}-${i}${Math.random().toString(36).slice(2, 6)}`
    const paires: [VisuelLib, File][] = []
    arr.forEach((f, i) => {
      const x = lusP[i]
      if (x) paires.push([{ id: id(i), src: x.src, name: String(x.name || 'Photo').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), cat: '', sub: '', season: "Toute l'année", cut: !!x.cut }, f])
    })
    vids.forEach((f, i) => {
      const x = lusV[i]
      if (x) paires.push([{ id: id(`v${i}`), kind: 'video', src: x.src, poster: x.poster, name: x.name, cat: '', sub: '', season: "Toute l'année", cut: false }, f])
    })
    if (!paires.length) return
    let added = paires.map((p) => p[0])
    // Chaque fichier rejoint la médiathèque commune, en original : une affiche ou une bâche en a besoin.
    if (partageOk()) {
      toast(paires.length > 1 ? `Envoi de ${paires.length} fichiers à la médiathèque commune…` : 'Envoi à la médiathèque commune…')
      const faits: VisuelLib[] = []
      for (const [x, f] of paires) faits.push((await verser(x, f)) || x)
      added = faits
    }
    const lib = cur().lib.filter((y) => !added.some((a) => a.id === y.id)).concat(added)
    idbGarder(lib)
    const photos = added.filter((x) => x.kind !== 'video')
    const vid = added.find((x) => x.kind === 'video')
    put((st) => ({ lib, photos: toPost ? st.photos.concat(photos.map((x) => ({ src: x.src, cut: x.cut, name: x.name }))) : st.photos, editId: toPost ? st.editId : added[0].id }))
    if (toPost && vid) choisirVideo(vid)
  }

  // ── Montages Instagram : l'aperçu basse définition, recalculé (avec un court délai) quand un réglage change ──
  const montageInput = (st: St = cur()) => ({ ...st.m, photos: st.photos })
  useEffect(() => {
    const st = cur()
    if (!estMontage(st.mode)) return
    const key = JSON.stringify([st.mode, st.m, st.photos.map((p) => `${p.src.length}:${p.src.slice(0, 48)}${p.src.slice(-48)}${p.cut ? 'c' : ''}`)])
    if (key === mKey.current) return
    mKey.current = key
    window.clearTimeout(mT.current)
    mT.current = window.setTimeout(async () => {
      try {
        const c = cur()
        const r = c.mode === 'pano' ? await Montages.panorama(montageInput(c), 0.4) : c.mode === 'frise' ? await Montages.frise(montageInput(c), 0.4) : await Montages.collage(montageInput(c), 0.4)
        if (mort.current || mKey.current !== key) return
        const slices = 'slices' in r ? r.slices : 'tiles' in r ? r.tiles : [r.image]
        put((x) => ({ mPrev: { key, slices, full: 'full' in r ? r.full : '' }, mIdx: Math.min(x.mIdx, slices.length - 1) }))
      } catch (e) {
        console.error(e)
      }
    }, 200)
  })

  // ── Idées de posts et ce qui marche (pour un nouveau post) ──
  useEffect(() => {
    if (cur().id || inspiLu.current) return
    inspiLu.current = true
    put({ ideesBusy: true })
    lireIdees()
      .then((r) => !mort.current && put({ idees: r, ideesBusy: false }))
      .catch((e: unknown) => !mort.current && put({ ideesBusy: false, ideesErr: message(e) }))
    lireRecommandations('cache')
      .then((r) => !mort.current && put({ reco: r?.reco ?? null, recoLu: true }))
      .catch(() => !mort.current && put({ recoLu: true }))
  }, [put])
  const analyserReco = (forcer: boolean) => {
    if (cur().recoBusy) return
    put({ recoBusy: true, recoErr: '' })
    lireRecommandations(forcer ? 'forcer' : '')
      .then((r) => !mort.current && put({ reco: r?.reco ?? null, recoBusy: false }))
      .catch((e: unknown) => !mort.current && put({ recoBusy: false, recoErr: message(e) }))
  }
  /**
   * Une idée → le post : boutiques, date et heure, opération, offre, objectif pour l'assistant ;
   * l'élément du catalogue (et l'offre dans le texte) suivent dès que le catalogue de la boutique est lu.
   */
  const appliquerIdee = (x: Idee) => {
    const p = x.prefill || {}
    const st = cur()
    const plein = st.text.trim() || st.textNl.trim() || st.photos.length || st.navSel
    if (plein && !window.confirm('Repartir de cette idée ? Le texte, la photo, le produit et l’offre du post en cours seront remplacés.')) return
    const ok = (p.shops || []).filter((id) => !!parId(SHOPS, id) || TESTS.some((t) => t.id === id))
    const patch: Partial<St> = {
      ideeId: x.id, objectif: p.objectif || '', ideeCat: p.catalogue || null, ideeOffre: p.offre ? p.offre.id ?? null : null, offre: p.offre || null, offreUsed: '',
      text: '', textNl: '', photos: [], navSel: null, product: null, link: '', campaign: p.campaign || '', time: p.time || '08:00', iaRes: null, iaErr: '',
      type: x.genre === 'gamme' ? 'Gamme saisonnière' : 'Produit',
      v: { ...st.v, title: '', price: '', showPromo: false, promo: '4+1', promoSub: 'la 5ᵉ offerte', textes: [], nl: { ...st.v.nl, title: '' } },
    }
    autoFr.current = ''
    autoNl.current = ''
    Object.assign(patch, ok.length ? { scope: ok.length === SHOPS.length ? 'all' : 'shop', group: null, sel: ok } : { scope: 'all', group: null, sel: SHOPS.map((z) => z.id) })
    if (p.date) Object.assign(patch, { when: 'later', date: p.date })
    if (p.time) patch.time = p.time
    put(patch)
    toast(
      `Idée appliquée : ${[ok.length ? ok.map(nomDe).join(', ') : 'tout le réseau', p.date ? `${dLabel(p.date)}${p.time ? ` à ${p.time}` : ''}` : '', p.campaign ? 'opération rattachée' : '', p.catalogue ? 'catalogue choisi' : '']
        .filter(Boolean)
        .join(' · ')}. Ajoutez la photo, puis « Proposer 3 textes ».`,
    )
  }

  // ── Textes posés sur le visuel ──
  /** Les modèles d'étiquette : ceux du design system, puis ceux enregistrés (réglage etiquettes_modeles). */
  const etqModeles = (): ModeleEtiquette[] => {
    const mes = (etat.params.etiquettes_modeles as ModeleEtiquette[] | undefined) ?? []
    return ETIQUETTES.map((m): ModeleEtiquette => ({ ...m, ds: true })).concat((Array.isArray(mes) ? mes : []).filter((m) => m && m.id && m.nom))
  }
  const editerTexte = () =>
    window.setTimeout(() => {
      const el = txtIn.current
      if (!el) return
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.focus({ preventScroll: true })
        el.select()
      } catch {
        /* champ disparu */
      }
    }, 80)
  /** Pose un texte sur le visuel (promotion, formule ou texte libre), dans le style du dernier modèle utilisé. */
  const poserTexte = (txt: string, sous: string, source?: string) => {
    const v = cur().v
    const ts = v.textes || []
    const M = etqModeles()
    const m = M.find((x) => x.id === etqDernier.current) || M[0]
    const t: TextePose = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, txt: String(txt || 'Texte'), sous: String(sous || ''), source: String(source || ''),
      forme: m?.forme, police: m?.police, couleur: m?.couleur, fond: m?.fond, taille: m?.taille, rot: m?.rot, x: m?.x, y: m?.y,
    }
    if (ts.length) {
      t.x = Math.min(90, (+(t.x ?? 0) || 50) + 6 * ts.length)
      t.y = Math.min(90, (+(t.y ?? 0) || 50) + 6 * ts.length)
    }
    put({ v: { ...v, textes: ts.concat(t) }, txtSel: t.id, mode: 'studio' })
    editerTexte()
  }
  const effacerTexte = (id: string) => {
    const st = cur()
    put({ v: { ...st.v, textes: (st.v.textes || []).filter((t) => t.id !== id) }, txtSel: st.txtSel === id ? null : st.txtSel })
  }
  /** Le passage sélectionné dans « Texte de l'offre » (sinon tout le texte). */
  const passageOffre = (sel: TextePose | null) => {
    const v = String(sel?.source || '')
    const el = srcIn.current
    if (el && el.selectionEnd > el.selectionStart && el.value === v) return v.slice(el.selectionStart, el.selectionEnd).trim()
    return v.trim()
  }
  /** Relit le contrôle qualité du visuel ; ne met l'état à jour que s'il a changé. */
  const qcLire = () => {
    const st = cur()
    if (!api.current || st.mode !== 'studio') {
      if (st.qc.length) put({ qc: [] })
      return
    }
    let q: Qc[] = []
    try {
      q = api.current.controle() || []
    } catch (e) {
      console.error(e)
    }
    if (JSON.stringify(q) !== JSON.stringify(st.qc)) put({ qc: q })
  }
  useEffect(() => {
    const t = window.setTimeout(qcLire, 600)
    return () => window.clearTimeout(t)
  })

  /** Les modèles de visuel enregistrés (réglage visuels_modeles). */
  const visModeles = (): ModeleVisuel[] => {
    const l = (etat.params.visuels_modeles as ModeleVisuel[] | undefined) ?? []
    return (Array.isArray(l) ? l : []).filter((m) => m && m.id && m.nom && m.v)
  }
  const garderParametre = (cle: string, valeur: unknown, msg: string, apres?: () => void) =>
    enregistrerParametres({ [cle]: valeur })
      .then((r) => {
        const params = (r as { params?: Record<string, unknown> } | null)?.params ?? { ...etat.params, [cle]: valeur }
        enregistrer({ params })
        apres?.()
        toast(msg)
      })
      .catch((e: unknown) => toast(`${cle === 'lien_texte' ? 'Texte du lien' : cle === 'lien_fiche' ? 'Réglage' : 'Modèle'} non enregistré : ${message(e)}`))

  // ── Photos ──
  /** Une photo du webshop (sans CORS) remplacée dans le post par sa copie locale : sans elle, le visuel ne s'exporte pas. */
  const localiser = (src: string) =>
    photoLocale(src).then((loc) => {
      if (loc === src) return
      return new Promise<void>((r) => {
        rendus.current.push(r)
        put((st) => ({ photos: st.photos.map((x) => (x.src === src ? { ...x, src: loc, origine: src } : x)) }))
      })
    })
  const photosLocales = () => {
    const loin = cur().photos.filter((p) => {
      try {
        return /^https?:\/\//i.test(p.src) && new URL(p.src, window.location.href).origin !== window.location.origin
      } catch {
        return false
      }
    })
    return Promise.all(loin.map((p) => localiser(p.src)))
  }
  /** Détoure une photo du post (remove.bg, côté serveur) ; elle est remplacée par le PNG détouré. */
  const detourerPhoto = async (src: string) => {
    if (cur().cutBusy) return
    put({ cutBusy: src })
    try {
      const r = await detourer(src)
      put((st) => ({ cutBusy: null, photos: st.photos.map((x) => (x.src === src ? { ...x, src: r.src, cut: true, origine: x.origine || src, name: `${x.name || 'Photo'} (détourée)` } : x)) }))
      toast(`Photo détourée${r.credits != null ? ` (${String(r.credits).replace('.', ',')} crédit remove.bg)` : ''}.`)
    } catch (e) {
      put({ cutBusy: null })
      toast(`Détourage impossible : ${message(e)}`)
    }
  }

  // ── Catalogue du webshop : catégorie → sous-catégorie → produit, ou gamme ; prix d'UNE boutique ──
  const loadNav = (shop: string) => {
    put({ navLoading: true, navErr: '', navKey: shop })
    lireCatalogue(shop)
      .then((nav) => {
        const st = cur()
        if (st.navKey !== shop) return
        const patch: Partial<St> = { nav, navLoading: false }
        const sel = st.navSel
        // Un produit choisi suit la boutique : son prix, ou plus de prix si plusieurs boutiques (sauf prix déjà lus).
        const pbLu = !nav.prix && st.pb?.prix && sel && String(st.pb.key).split('|')[0] === String(sel.id)
        if (sel && sel.kind === 'produit' && !pbLu) {
          const p = nav.produits.find((x) => x.id === sel.id)
          const prix = nav.prix && p && p.prix != null ? p.prix : null
          patch.navSel = { ...sel, prix, shop: nav.prix ? shop : null }
          patch.v = { ...st.v, price: prix != null ? virgule(prix) : '', showPrice: prix != null }
        }
        put(patch)
      })
      .catch((e: unknown) => put({ navLoading: false, navErr: `Catalogue illisible : ${message(e)}` }))
  }
  /**
   * Plusieurs boutiques et un produit : le prix de vente de chacune (TFBuddy). Le même prix partout : le visuel
   * le porte. Des prix différents : un visuel par prix à la publication (groupesPrix).
   */
  const loadPrix = (key: string) => {
    const st = cur()
    if (!key) {
      if (st.pb) put({ pb: null, pbApercu: null })
      return
    }
    if (st.pb && st.pb.key === key) return
    const [pid, liste] = key.split('|')
    const shops = liste.split(',')
    put({ pb: { key, loading: true, prix: null, err: '' } })
    lirePrixBoutiques(pid, shops)
      .then((r) => {
        const st0 = cur()
        if (!st0.pb || st0.pb.key !== key) return
        const prix = r?.prix ?? {}
        const connus = shops.map((id) => prix[id]).filter((x): x is number => x != null)
        const f2 = (n: number) => virgule(Number(n))
        const memes = connus.length === shops.length && new Set(connus.map(f2)).size === 1
        const patch: Partial<St> = { pb: { key, loading: false, prix, err: '' }, pbApercu: shops.find((id) => prix[id] != null) || shops[0] }
        if (connus.length) patch.v = { ...st0.v, price: memes ? f2(connus[0]) : st0.v.price, showPrice: true }
        // Le texte proposé (pas retouché à la main) cite le prix de chaque boutique : {prix}, rempli boutique par boutique.
        const sel = st0.navSel
        if (connus.length === shops.length && sel && sel.kind === 'produit') {
          if (st0.text && st0.text === autoFr.current && !/\{prix\}/.test(st0.text)) {
            patch.text = st0.text.replace(`${sel.name} chez`, `${sel.name} : {prix} € chez`)
            autoFr.current = patch.text
          }
          const nomNl = sel.nameNl || sel.name
          if (st0.textNl && st0.textNl === autoNl.current && !/\{prix\}/.test(st0.textNl)) {
            patch.textNl = st0.textNl.replace(`${nomNl} bij`, `${nomNl}: {prix} € bij`)
            autoNl.current = patch.textNl
          }
        }
        put(patch)
      })
      .catch((e: unknown) => {
        const p = cur().pb
        if (p && p.key === key) put({ pb: { key, loading: false, prix: null, err: message(e) } })
      })
  }
  /** Le prix de chaque boutique visée (lu dans TFBuddy) : {prix} du texte, vérification à la publication. */
  const prixParBoutique = (): Record<string, number> | null => {
    const st = cur()
    const prix = st.pb && !st.pb.loading ? st.pb.prix : null
    const t = targets()
    if (!prix || t.length < 2 || !st.navSel || st.navSel.kind !== 'produit') return null
    const out: Record<string, number> = {}
    t.forEach((id) => {
      if (prix[id] != null) out[id] = Number(prix[id])
    })
    return Object.keys(out).length ? out : null
  }
  /** Les boutiques visées regroupées par prix (visuel composé, prix affiché) ; vide si un seul visuel suffit. */
  const groupesPrix = (st: St = cur()) => {
    const prix = st.pb?.prix
    if (!prix || st.mode !== 'studio' || !st.v.showPrice) return []
    const g: Record<string, { prix: number | null; shops: string[] }> = {}
    targets(st).forEach((id) => {
      const p = prix[id]
      const k = p == null ? '-' : Number(p).toFixed(2)
      ;(g[k] = g[k] || { prix: p == null ? null : Number(p), shops: [] }).shops.push(id)
    })
    const l = Object.values(g)
    return l.length > 1 ? l : []
  }
  /** Les promotions, bundles et formules liés à la sélection. */
  const loadOffres = (key: string, q: Record<string, string | number>) => {
    put({ offresKey: key, offresLoading: true, offres: null })
    lireOffres(q)
      .then((r) => cur().offresKey === key && put({ offres: r, offresLoading: false }))
      .catch((e: unknown) => cur().offresKey === key && put({ offres: { promotions: [], formules: [], erreur: message(e) }, offresLoading: false }))
  }

  // ── Rédaction assistée (Claude, côté serveur) et relecture ──
  const iaDemander = async (consigne: string) => {
    const st = cur()
    const t = targets()
    const sel = st.navSel
    const cat = st.product ? CATALOGUE.find((x) => x.id === st.product) ?? null : null
    const langues = [...new Set(t.flatMap((id) => langsOf(id)))]
    const prix = sel && sel.kind === 'produit' && sel.prix != null ? eur(sel.prix, 2) : ''
    const o = st.campaign ? etat.campaigns.find((c) => c.id === st.campaign) : null
    const b = {
      produit: sel && sel.kind === 'produit' ? sel.name : cat ? cat.name : '',
      produitNl: sel && sel.nameNl ? sel.nameNl : cat ? cat.nameNl || '' : '',
      categorie: sel && sel.kind !== 'produit' && sel.kind !== 'gamme' ? sel.name : '',
      gamme: sel && sel.kind === 'gamme' ? sel.name : '',
      prix,
      promo: st.offre ? st.offre.libelle || '' : st.v.showPromo && st.v.promo ? `${st.v.promo} ${st.v.promoSub || ''}` : '',
      mention: st.offre && st.offre.genre === 'promotion' ? mentionOffre(st.offre, 'fr') : '',
      type: st.type,
      boutiques: t.map(nomDe),
      langues: langues.length ? langues : ['fr'],
      lien: !!String(st.link || '').trim(),
      consigne: consigne || '',
      texte: consigne ? st.text || st.textNl || '' : '',
      objectif: st.objectif || '',
      operation: o ? `${o.name}${o.description ? ` — ${String(o.description)}` : ''}` : '',
    }
    put({ iaBusy: true, iaErr: '', iaConsigne: consigne || '' })
    try {
      const r = await proposerTextes(b)
      put({ iaBusy: false, iaRes: r })
    } catch (e) {
      put({ iaBusy: false, iaErr: message(e) })
    }
  }
  /** Le relecteur : corrige le texte FR et NL sans le réécrire ; rien n'est remplacé avant « Appliquer ». */
  const iaCorriger = async () => {
    const st = cur()
    const textes = (
      [
        ['fr', st.text],
        ['nl', st.textNl],
      ] as [string, string][]
    )
      .filter(([, t]) => String(t || '').trim())
      .map(([L, t]) => ({ cle: L, langue: L, texte: t }))
    if (!textes.length) return
    put({ iaBusy: true, iaErr: '', iaConsigne: 'corriger', cor: null })
    try {
      const r = await corrigerTextes({ contexte: `un post Facebook et Instagram (${st.type || 'post'})`, textes })
      put({ iaBusy: false, cor: { avant: { fr: st.text, nl: st.textNl }, ...r } })
    } catch (e) {
      put({ iaBusy: false, iaErr: message(e) })
    }
  }

  // ── Kit multi-format et vidéo animée (exportés depuis le studio) ──
  const kitTelecharger = async () => {
    const st = cur()
    if (!api.current || st.kitBusy) return
    put({ kitBusy: true })
    const av = st.v.format || 'carre'
    const fichiers: [string, string][] = []
    const nom = nomFichier(st.v.title)
    const DIM: Record<string, string> = { carre: '1080x1080', portrait: '1080x1350', story: '1080x1920', paysage: '1200x630' }
    try {
      await photosLocales()
      const JSZip = await moteurZip()
      for (const f of ['carre', 'portrait', 'story', 'paysage']) {
        await putAttendre({ v: { ...cur().v, format: f } })
        await new Promise((r) => setTimeout(r, 700))
        const img = await api.current.toImage({ jpeg: true, pixelRatio: 1, quality: 0.92 })
        fichiers.push([`${nom}-${f}-${DIM[f]}.jpg`, img.split(',')[1]])
      }
      const zip = new JSZip()
      fichiers.forEach(([n, b64]) => zip.file(n, b64, { base64: true }))
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${nom}-kit.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast('Kit téléchargé : carré, portrait, story et paysage.')
    } catch (e) {
      console.error(e)
      toast(`Kit impossible : ${message(e)}`)
    }
    put({ kitBusy: false, v: { ...cur().v, format: av } })
  }
  /**
   * La vidéo animée : le visuel rendu en story 9:16, avec un fondu d'entrée et un léger zoom (6 s), enregistrée
   * par le navigateur (MediaRecorder) ; MP4 quand il le sait, sinon WebM (téléchargement seulement).
   */
  const videoAnimee = async () => {
    const st = cur()
    if (!api.current || st.vidBusy) return
    // H.264 d'abord (le codec que Meta exige pour un reel) ; « video/mp4 » sans codec peut cacher du VP9 : en dernier.
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4']
    const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported ? types.find((x) => MediaRecorder.isTypeSupported(x)) : undefined
    if (!mime) {
      toast('Ce navigateur ne sait pas enregistrer de vidéo : essayez avec Chrome ou Edge.')
      return
    }
    const av = st.v.format || 'carre'
    const DUREE = 6
    const W = 1080
    const H = 1920
    put({ vidBusy: true })
    try {
      await photosLocales()
      await putAttendre({ v: { ...cur().v, format: 'story' } })
      await new Promise((r) => setTimeout(r, 700))
      const url = await api.current.toImage({ jpeg: true, pixelRatio: 1, quality: 0.92 })
      await putAttendre({ v: { ...cur().v, format: av } })
      const img = await new Promise<HTMLImageElement>((ok, ko) => {
        const i = new Image()
        i.onload = () => ok(i)
        i.onerror = () => ko(new Error('visuel illisible'))
        i.src = url
      })
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')
      if (!g) throw new Error('canvas indisponible')
      const dessiner = (t: number) => {
        const z = 1 + 0.06 * t
        const w = W * z
        const h = H * z
        g.globalAlpha = 1
        g.fillStyle = '#000000'
        g.fillRect(0, 0, W, H)
        g.globalAlpha = Math.min(1, (t * DUREE) / 0.6)
        g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        g.globalAlpha = 1
      }
      dessiner(0)
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6000000 })
      const morceaux: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data?.size) morceaux.push(e.data)
      }
      const fini = new Promise((r) => (rec.onstop = r))
      rec.start(250)
      const t0 = performance.now()
      await new Promise<void>((r) => {
        const pas = () => {
          const t = (performance.now() - t0) / 1000 / DUREE
          dessiner(Math.min(1, t))
          if (t >= 1) r()
          else requestAnimationFrame(pas)
        }
        requestAnimationFrame(pas)
      })
      rec.stop()
      await fini
      const type = mime.split(';')[0]
      const blob = new Blob(morceaux, { type })
      const src = await new Promise<string>((ok, ko) => {
        const rd = new FileReader()
        rd.onload = () => ok(String(rd.result))
        rd.onerror = () => ko(new Error('vidéo illisible'))
        rd.readAsDataURL(blob)
      })
      const h264 = /avc1/.test(mime)
      put({ vidBusy: false, vidAnim: { src, type, h264, taille: blob.size, publier: false } })
      toast(`Vidéo animée prête (${h264 ? 'MP4 H.264' : type === 'video/mp4' ? 'MP4' : 'WebM'}, ${(blob.size / 1048576).toFixed(1).replace('.', ',')} Mo).`)
    } catch (e) {
      console.error(e)
      put({ vidBusy: false, v: { ...cur().v, format: av } })
      toast(`Vidéo impossible : ${message(e)}`)
    }
  }

  // ── Contrôles avant l'enregistrement ──
  const schedMinutes = (st: St = cur()) => {
    const now = new Date()
    const [y, mo, d] = TODAY.split('-').map(Number)
    const nowD = new Date(y, mo - 1, d, now.getHours(), now.getMinutes())
    const [Y, M, D] = st.date.split('-').map(Number)
    const [hh, mm] = st.time.split(':').map(Number)
    return (new Date(Y, M - 1, D, hh, mm).getTime() - nowD.getTime()) / 60000
  }
  /** Le verrou de la frise (le serveur le vérifie aussi) : 30 minutes sans autre post Instagram avant et après. */
  const friseLock = (): string | null => {
    const st = cur()
    const igShops = targets().filter((id) => st.ch[id]?.ig)
    if (!igShops.length) return null
    const at = (d: string, h: string) => {
      const [Y, M, D] = String(d).split('-').map(Number)
      const [hh, mm] = String(h || '00:00').split(':').map(Number)
      return new Date(Y, M - 1, D, hh, mm).getTime()
    }
    const now = new Date()
    const nowT = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const me = st.when === 'now' ? at(TODAY, nowT) : at(st.date, st.time)
    const isFrise = st.mode === 'frise'
    const igOf = (q: PostSocial) => (Array.isArray(q.shops) ? q.shops : SHOPS.map((x) => x.id)).filter((id) => (q.ch?.[id] ? q.ch[id].ig : q.ig))
    for (const q of etat.posts as PostSocial[]) {
      if (q.id === st.id || q.status !== 'Programmé' || (!isFrise && !q.frise)) continue
      const common = igOf(q).filter((id) => igShops.includes(id))
      if (!common.length || Math.abs(at(q.date, q.time) - me) >= 30 * 60000) continue
      return `Instagram ${common.map(nomDe).join(', ')} : « ${q.title} » est programmé le ${dShort(q.date)} à ${q.time}${q.frise ? ' (frise)' : ''} — une frise demande 30 minutes sans autre post Instagram avant et après.`
    }
    return null
  }
  const validate = (final: boolean, status: string): string[] => {
    const st = cur()
    const errs: string[] = []
    const t = targets()
    if (st.dark) {
      // Dark post : ni date ni canal (la pub les fixe) — il lui faut un visuel.
      if (st.mode === 'brut' && !st.photos.length && !st.video) errs.push('Un dark post a besoin d’un visuel : ajoutez une photo ou une vidéo.')
      if (estMontage(st.mode) && !st.photos.length) errs.push('Ajoutez au moins une photo pour le montage.')
      if (!st.text.trim() && !st.textNl.trim() && !(st.v.title || '').trim() && !(st.m.title || '').trim()) errs.push('Donnez au moins un texte ou un titre : il pré-remplit le texte de la publicité.')
      return errs
    }
    const cm = st.marque ? st.ch.marque || {} : {}
    if (!t.length && !st.marque) errs.push('Choisissez au moins une boutique, ou la Page de la marque.')
    if ((t.length || st.marque) && !t.some((id) => st.ch[id] && (st.ch[id].fb || st.ch[id].ig)) && !cm.fb && !cm.ig) errs.push('Cochez au moins un canal (Facebook ou Instagram).')
    if (final && !st.text.trim() && st.mode === 'brut' && !st.photos.length && !st.video) errs.push('Ajoutez un texte ou un média.')
    const nlShops = t.filter((id) => langsOf(id).includes('nl')).map(nomDe)
    const frShops = t.filter((id) => langsOf(id).includes('fr')).map(nomDe)
    if (final && nlShops.length && !st.textNl.trim() && st.text.trim()) errs.push(`Texte néerlandais manquant pour ${nlShops.join(', ')}.`)
    if (final && frShops.length && !st.text.trim() && st.textNl.trim()) errs.push(`Texte français manquant pour ${frShops.join(', ')}.`)
    if (final && st.mode === 'studio' && nlShops.length && st.v.showTitle && st.v.title.trim() && !(st.v.nl.title || '').trim()) errs.push(`Nom du produit en néerlandais manquant sur le visuel (${nlShops.join(', ')}).`)
    if (final && st.when === 'later') {
      const m = schedMinutes()
      if (m < 10) errs.push('Meta exige une programmation au moins 10 minutes à l’avance (scheduled_publish_time).')
      else if (m > 30 * 24 * 60) errs.push('Meta n’accepte pas de programmation au-delà de 30 jours (scheduled_publish_time).')
    }
    if (final && st.mode === 'brut' && (t.some((id) => st.ch[id]?.ig) || cm.ig) && !st.photos.length && !st.video) errs.push('Instagram exige au moins une image ou une vidéo.')
    if (final && estMontage(st.mode) && !st.photos.length) errs.push('Ajoutez au moins une photo pour le montage.')
    if (final && st.mode === 'frise' && !t.some((id) => st.ch[id]?.ig)) errs.push('Une frise se publie sur Instagram : cochez Instagram pour au moins une boutique.')
    if (final && status !== 'Brouillon') {
      const lock = friseLock()
      if (lock) errs.push(lock)
    }
    return errs
  }

  /** Le visuel du post tel qu'il partira : studio exporté, montage dessiné, ou photos et vidéo déposées. */
  const renderMedia = async () => {
    try {
      await photosLocales()
    } catch (e) {
      console.error(e)
      put({ saving: false, errors: [`La photo du webshop n’a pas pu être préparée (${message(e)}). Rien n’a été enregistré : réessayez.`] })
      return null
    }
    const st = cur()
    let img: string | null = null
    let media: { src: string; kind: string; cut?: boolean; name?: string }[]
    let friseTiles: string[] | null = null
    let parBoutique: Record<string, { img: string; media: { src: string; kind: string; cut: boolean; name: string }[] }> | null = null
    if (st.mode === 'studio') {
      let err: unknown = null
      try {
        if (api.current) img = await api.current.toImage({ jpeg: true, pixelRatio: 1, quality: 0.9 })
      } catch (e) {
        console.error(e)
        err = e
      }
      // Jamais la photo brute à la place du visuel composé (logo, titre, prix) : on s'arrête et on le dit.
      if (!img) {
        put({ saving: false, errors: [`Le visuel composé n’a pas pu être exporté${err ? ` (${message(err)})` : ''}. Rien n’a été enregistré : réessayez, ou passez en mode « Photos telles quelles ».`] })
        return null
      }
      media = [{ src: img, kind: 'img', cut: false, name: 'Visuel composé' }]
      // Un prix par boutique : le même visuel, exporté une fois par prix ; chaque boutique publie le sien.
      const groupes = groupesPrix()
      if (groupes.length && api.current) {
        parBoutique = {}
        const avant = cur().pbApercu
        try {
          for (const g of groupes) {
            await putAttendre({ pbApercu: g.shops[0] })
            await new Promise((r) => setTimeout(r, 200))
            const im = await api.current.toImage({ jpeg: true, pixelRatio: 1, quality: 0.9 })
            const nom = `Visuel composé · ${g.prix == null ? 'sans prix' : `${virgule(g.prix)} €`}`
            g.shops.forEach((id) => {
              if (parBoutique) parBoutique[id] = { img: im, media: [{ src: im, kind: 'img', cut: false, name: nom }] }
            })
          }
        } catch (e) {
          console.error(e)
          put({ saving: false, pbApercu: avant, errors: [`Les visuels par boutique n’ont pas pu être exportés (${message(e)}). Rien n’a été enregistré : réessayez.`] })
          return null
        }
        await putAttendre({ pbApercu: avant })
        const premier = parBoutique[targets()[0]]
        if (premier) {
          img = premier.img
          media = premier.media.slice()
        }
      }
      if (st.vidAnim?.publier && st.vidAnim.h264) media.push({ src: st.vidAnim.src, kind: 'video', name: 'Vidéo animée' })
    } else if (estMontage(st.mode)) {
      // Montage rendu en pleine définition (1080 × 1350 par image).
      let slices: string[] = []
      try {
        if (st.mode === 'pano') slices = (await Montages.panorama(montageInput(st), 1)).slices
        else if (st.mode === 'frise') {
          const r = await Montages.frise(montageInput(st), 1)
          friseTiles = r.tiles
          slices = [r.full]
        } else slices = [(await Montages.collage(montageInput(st), 1)).image]
      } catch (e) {
        console.error(e)
        put({ saving: false, errors: [`Le montage n’a pas pu être dessiné : ${message(e)}.`] })
        return null
      }
      media = slices.map((src, i) => ({
        src,
        kind: 'img',
        cut: false,
        name: st.mode === 'pano' ? `Carrousel ${i + 1}/${slices.length}` : st.mode === 'frise' ? 'Frise · visuel entier (Facebook)' : `Collage ${st.m.tpl}`,
      }))
      img = slices[0]
    } else {
      media = st.photos.map((p) => ({ src: p.src, kind: 'img', cut: p.cut, name: p.name })).concat(st.video ? [{ src: st.video.src, kind: 'video', cut: undefined, name: st.video.name }] : [])
      // Sans photo, le post n'a pas d'image (l'ancien écran posait une illustration de pain, publiée par le serveur).
      img = st.photos[0] ? st.photos[0].src : ''
    }
    return { img: img ?? '', media, friseTiles, parBoutique }
  }

  /**
   * « Enregistrer comme modèle franchisé » : le visuel de ce post (figé) et son texte deviennent un modèle de
   * l'espace franchisé. {ville}, {adresse} et {horaires} restent des variables ; le produit est écrit en clair.
   */
  const saveAsTemplate = async () => {
    const st = cur()
    const f = st.tplForm
    if (!String(f.name || '').trim()) {
      put({ tplErr: 'Donnez un nom au modèle.' })
      return
    }
    if (!String(st.text || st.textNl || '').trim()) {
      put({ tplErr: 'Écrivez d’abord le texte du post.' })
      return
    }
    put({ tplBusy: true, tplErr: '' })
    const rendu = await renderMedia()
    if (!rendu) {
      put({ tplBusy: false, tplErr: 'Le visuel n’a pas pu être préparé.' })
      return
    }
    const cat = st.product ? CATALOGUE.find((x) => x.id === st.product) ?? null : null
    const fixe = (txt: string, nl: boolean) =>
      String(txt || '')
        .replace(/\{produit_du_jour\}/g, cat ? (nl && cat.nameNl ? cat.nameNl : cat.name) : '')
        .replace(/\{prix\}/g, cat?.price ? String(cat.price) : '')
    const libre = f.free ? '\n\n{libre}' : ''
    const tpls = etat.ftemplates
    const tpl = {
      id: `ft${Date.now()}`, order: tpls.length + 1, name: String(f.name).trim(),
      description: String(f.description || '').trim() || 'Post du réseau, prêt à publier sur la Page de votre boutique.',
      active: true, type: st.type, fb: true, ig: false, validation: !!f.validation, title: String(f.name).trim(),
      text: fixe(st.text, false) + (st.text ? libre : ''), textNl: fixe(st.textNl, true) + (st.textNl ? libre : ''),
      product: 'aucun', promo: { kind: 'aucune' }, period: false, free: f.free ? 90 : 0, photo: 'aucune',
      visual: { style: 'fixe', src: rendu.img, media: rendu.media.map((m) => ({ src: m.src, kind: m.kind === 'video' ? 'video' : 'img' })) }, source: st.id || null,
    }
    enregistrer({ ftemplates: tpls.concat(tpl) })
    journaliser('Espace franchisé', `Modèle « ${tpl.name} » créé depuis un post`)
    put({ tplBusy: false, tplOpen: false })
    toast(`Modèle « ${tpl.name} » ajouté à l’espace franchisé (réglable dans Espace franchisé → Modèles).`)
  }

  const persist = async (status0: string, goAds?: boolean) => {
    const st = cur()
    const status = st.dark ? 'Dark post' : status0
    const errs = validate(status !== 'Brouillon', status)
    if (errs.length) {
      put({ errors: errs })
      return
    }
    // Contrôle du visuel : un texte qui dépasse du visuel ne part pas.
    if (st.mode === 'studio' && status !== 'Brouillon') {
      qcLire()
      const bloquants = (cur().qc || []).filter((q) => q.niveau === 'erreur')
      if (bloquants.length) {
        put({ errors: bloquants.map((q) => `Visuel : ${q.msg}.`) })
        return
      }
    }
    put({ saving: true, errors: [] })
    // Avant de publier ou programmer : le prix et la promotion du post sont-ils encore ceux de TFBuddy ?
    const ppb = prixParBoutique()
    if ((status === 'Publié' || status === 'Programmé') && ((st.navSel && st.navSel.kind === 'produit' && (st.navSel.prix != null || ppb)) || st.offre?.id)) {
      try {
        const r = await verifierCatalogue({ catalogue: st.navSel, offre: st.offre, shops: targets(), date: st.when === 'now' ? TODAY : st.date, prixParBoutique: ppb })
        if (r?.ecarts?.length) {
          put({ saving: false, errors: r.ecarts.map((e) => `Offre à revoir : ${e}.`).concat(['Rien n’a été publié : rechoisissez le produit ou l’offre pour reprendre les données actuelles de TFBuddy.']) })
          return
        }
      } catch (e) {
        console.error(e)
      }
    }
    const t = targets()
    const cat = st.product ? CATALOGUE.find((x) => x.id === st.product) ?? null : null
    const rendu = await renderMedia()
    if (!rendu) return
    const { img, media, friseTiles, parBoutique } = rendu
    const s2 = cur()
    const title =
      (estMontage(s2.mode) ? (s2.m.title || '').trim() : '') || (s2.v.title || '').trim() || (cat ? cat.name : (s2.text.split(/[.\n]/)[0] || 'Post sans titre').slice(0, 60))
    const now = new Date()
    const nowT = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const post: PostSocial = {
      id: s2.id || `p${Date.now()}`,
      date: s2.when === 'now' ? TODAY : s2.date,
      time: s2.when === 'now' ? nowT : s2.time,
      type: s2.type,
      title,
      img,
      media,
      visual: s2.mode === 'studio' ? { v: s2.v, photos: s2.photos } : null,
      frise: friseTiles ? { tiles: friseTiles } : null,
      montage: estMontage(s2.mode) ? { kind: s2.mode, m: s2.m, photos: s2.photos } : null,
      shops: t,
      ch: s2.ch,
      marque: !!s2.marque,
      fb: t.some((id) => s2.ch[id]?.fb) || (!!s2.marque && !!s2.ch.marque?.fb),
      ig: t.some((id) => s2.ch[id]?.ig) || (!!s2.marque && !!s2.ch.marque?.ig),
      status,
      campaign: s2.campaign || null,
      text: s2.text,
      textNl: s2.textNl,
      langs: [...new Set(t.flatMap((id) => langsOf(id)).concat(s2.marque ? ['fr', 'nl'] : []))],
      link: s2.link,
      linkText: s2.linkText.fr || s2.linkText.nl ? s2.linkText : null,
      offre: s2.offre || null,
      spread: s2.spread,
      product: s2.product,
      catalogue: s2.navSel || null,
      prixParBoutique: ppb,
      parBoutique: parBoutique || null,
    }
    if (s2.dark) {
      post.dark = true
      post.fb = false
      post.ig = false
      if (!s2.id) {
        post.date = TODAY
        post.time = nowT
      }
    }
    enregistrer({ posts: (etat.posts as PostSocial[]).filter((p) => p.id !== post.id).concat(post) })
    if (s2.dark) {
      journaliser('Dark post', `« ${title} » enregistré, réservé à la publicité`)
      put({ id: post.id, status, saving: false })
      props.onApresEnregistrement?.({ id: post.id, status })
      if (goAds) {
        toast('Dark post enregistré : ouverture de l’assistant des publicités…')
        if (props.onCreerPub) props.onCreerPub(post.id)
        else window.location.href = lienSocial('ads', `new=1&post=${encodeURIComponent(post.id)}`)
        return
      }
      toast('Dark post enregistré : il ne sera jamais publié sur la Page. Créez la publicité pour le diffuser.')
      return
    }
    journaliser(
      status === 'Brouillon' ? 'Brouillon' : status === 'Publié' ? 'Publication' : 'Programmation',
      `« ${title} » — ${libelleBoutiques(etat, t)}${status === 'Programmé' ? ` le ${dShort(post.date)} à ${post.time}` : ''}`,
    )
    put({ id: post.id, status, saving: false })
    props.onApresEnregistrement?.({ id: post.id, status })
    toast(status === 'Brouillon' ? 'Brouillon enregistré.' : status === 'Publié' ? `Publication envoyée sur ${t.length} Page${t.length > 1 ? 's' : ''}.` : `Programmé le ${dLabel(post.date)} à ${post.time}.`)
  }
  const insertVar = (code: string) => {
    const ta = taRef.current
    const st = cur()
    const key = st.edLang === 'nl' ? 'textNl' : 'text'
    const txt = st[key]
    let pos = ta ? ta.selectionStart : txt.length
    if (pos == null) pos = txt.length
    put({ [key]: txt.slice(0, pos) + code + txt.slice(pos) } as Partial<St>)
    window.setTimeout(() => {
      if (ta) {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = pos + code.length
      }
    }, 0)
  }

  // ════════════════════════════════════════════════════════════════════════
  // Valeurs de l'écran (renderVals de l'ancien écran)
  // ════════════════════════════════════════════════════════════════════════
  const v = s.v
  const t = targets()
  const estTest = (id: string) => TESTS.some((x) => x.id === id)
  const tRes = t.filter((id) => !estTest(id))
  const tTest = t.filter(estTest)
  const cat = s.product ? CATALOGUE.find((x) => x.id === s.product) ?? null : null

  // Ciblage : une boutique en plus ou en moins ; toutes cochées = « Tout le réseau ».
  const setScope = (scope: St['scope']) => {
    if (locked) return
    if (scope === 'all') put({ scope, sel: SHOPS.map((x) => x.id), group: null })
    else if (scope === 'group') {
      const g = GROUPS[0]
      if (g) put({ scope, group: g.id, sel: g.shops.slice() })
      else put({ scope, group: null })
    } else put({ scope, group: null })
  }
  const toggleShop = (id: string) => {
    if (locked) return
    const next = t.includes(id) ? t.filter((x) => x !== id) : t.concat(id)
    put({ scope: next.filter((x) => !estTest(x)).length === SHOPS.length ? 'all' : 'shop', group: null, sel: next })
  }
  const setCanal = (id: string, k: 'fb' | 'ig') => put((st) => ({ ch: { ...st.ch, [id]: { ...(st.ch[id] || {}), [k]: !(st.ch[id] || {})[k] } } }))
  const brFbOk = brand.fb === 'connected'
  const brIgOk = brand.igs === 'connected'

  // ── Catalogue ──
  const prixShop = tRes.length === 1 ? tRes[0] : ''
  useEffect(() => {
    if (cur().navKey !== prixShop) loadNav(prixShop)
  })
  const nav = s.nav
  const P = nav ? nav.produits : []
  const G = nav ? nav.groupes : []
  const C = nav ? nav.categories : []
  const GA = nav ? nav.gammes : []
  const grpById: Record<number, (typeof G)[number]> = {}
  const catById: Record<number, (typeof C)[number]> = {}
  G.forEach((g) => (grpById[g.id] = g))
  C.forEach((c) => (catById[c.id] = c))
  const shopNom = prixShop ? nomDe(prixShop) : ''
  const illus = (p: NavProduit) => p.image || catById[p.cat ?? -1]?.image || grpById[p.groupe ?? -1]?.image || ''
  const sel = s.navSel
  const pbKey = tRes.length > 1 && sel && sel.kind === 'produit' ? `${sel.id}|${tRes.join(',')}` : ''
  useEffect(() => {
    if ((cur().pb?.key ?? '') !== pbKey) loadPrix(pbKey)
  })

  const choose = (it: Choix) => {
    if (locked) return
    const st = cur()
    const sl = st.navSel
    if (sl && sl.kind === it.kind && sl.id === it.id) {
      put({ navSel: null })
      return
    }
    const patch: Partial<St> = { navSel: it, offreUsed: '' }
    const nomNl = it.nameNl || it.name
    // Le texte proposé suit le choix tant qu'il n'a pas été retouché à la main.
    const libreFr = !st.text.trim() || st.text === autoFr.current
    const libreNl = !st.textNl.trim() || st.textNl === autoNl.current
    const auto = (fr: string, nl: string) => {
      if (libreFr && fr) {
        patch.text = fr
        autoFr.current = fr
      }
      if (libreNl && nl) {
        patch.textNl = nl
        autoNl.current = nl
      }
    }
    if (it.image) patch.photos = ([{ src: it.image, cut: false, name: it.name }] as PhotoPost[]).concat(st.photos.filter((p) => p.src !== it.image && p.origine !== it.image))
    // Le lien du post suit le choix : la page du webshop du produit, de la sous-catégorie ou de la catégorie (un lien saisi à la main reste).
    const lienLibre = !st.link.trim() || /^\{webshop[a-z_]*(:\d+)?(:liste)?\}$/.test(st.link.trim())
    if (lienLibre)
      patch.link =
        it.kind === 'produit' ? `{webshop_produit:${it.id}${ficheDefaut() ? '' : ':liste'}}` : it.kind === 'categorie' ? `{webshop_categorie:${it.id}}` : it.kind === 'groupe' ? `{webshop_groupe:${it.id}}` : '{webshop}'
    if (it.kind === 'produit') {
      const ref = CATALOGUE.find((c) => String(c.apiId) === String(it.id) && c.kind === 'produit')
      patch.product = ref ? ref.id : `p${it.id}`
      patch.type = 'Produit'
      patch.v = { ...st.v, title: it.name, showTitle: true, price: it.prix != null ? virgule(it.prix) : '', showPrice: it.prix != null, nl: { ...st.v.nl, title: nomNl } }
      auto(
        `${it.name}${it.prix != null ? ` : ${eur(it.prix, 2)}` : ''} chez L’Atelier By {ville}. Ouvert {horaires}.\n{lien}`,
        `${nomNl}${it.prix != null ? `: ${eur(it.prix, 2)}` : ''} bij L’Atelier By {ville}. Open {horaires}.\n{lien}`,
      )
    } else if (it.kind === 'gamme') {
      const ref = CATALOGUE.find((c) => String(c.apiId) === String(it.id) && c.kind === 'gamme')
      patch.product = ref ? ref.id : `g${it.id}`
      patch.type = 'Gamme saisonnière'
      patch.v = { ...st.v, title: it.name, showTitle: true, price: '', showPrice: false, nl: { ...st.v.nl, title: it.name } }
      auto(`La ${it.name} est arrivée chez L’Atelier By {ville}. À découvrir {horaires}.\n{lien}`, `Het ${it.name} is er bij L’Atelier By {ville}. Ontdek het {horaires}.\n{lien}`)
    } else {
      // Une catégorie ou une sous-catégorie entière : son illustration, pas de prix ; le lien du webshop vers elle.
      patch.product = null
      patch.type = 'Produit'
      patch.v = { ...st.v, title: it.name, showTitle: true, price: '', showPrice: false, nl: { ...st.v.nl, title: it.name } }
      auto(`Nos ${it.name.toLowerCase()} vous attendent chez L’Atelier By {ville}. Ouvert {horaires}.\n{lien}`, `Onze ${it.name.toLowerCase()} wachten op u bij L’Atelier By {ville}. Open {horaires}.\n{lien}`)
    }
    put(patch)
    if (it.image) localiser(it.image).catch((e: unknown) => console.error(e))
  }
  const prodItem = (p: NavProduit): Choix => ({ kind: 'produit', id: p.id, name: p.name, nameNl: p.nameNl, image: illus(p), prix: nav?.prix ? p.prix : null, shop: nav?.prix ? prixShop : null, cat: p.cat })
  const isSel = (kind: string, id: number) => !!sel && sel.kind === kind && sel.id === id
  interface Tuile {
    kind: string
    name: string
    image?: string
    meta: string
    prix?: boolean
    badge?: string
    tip?: string
    on: boolean
    pale?: boolean
    open: () => void
  }
  const prodTile = (p: NavProduit): Tuile => {
    const c = catById[p.cat ?? -1]
    return {
      kind: 'Produit', name: p.name, image: illus(p), pale: !p.image, badge: p.formules ? 'Formules' : '',
      meta: nav?.prix ? (p.prix != null ? eur(p.prix, 2) : 'prix non renseigné') : c?.name || '', prix: !!nav?.prix && p.prix != null,
      tip: p.image ? '' : 'Pas de photo sur le webshop : illustration de la catégorie', on: isSel('produit', p.id), open: () => choose(prodItem(p)),
    }
  }
  let tiles: Tuile[] = []
  let pick: { label: string; fn: () => void } | null = null
  const crumbs: { label: string; go?: () => void }[] = [{ label: s.navMode === 'gamme' ? 'Gammes' : 'Catégories', go: () => put({ navG: null, navC: null, navGam: null, navQ: '' }) }]
  const q = norm(s.navQ)
  if (nav && q) {
    const hit = (x: string) => norm(x).includes(q)
    tiles = G.filter((g) => hit(g.name))
      .map((g): Tuile => ({ kind: 'Catégorie', name: g.name, image: g.image, meta: `${g.n} produits`, on: false, open: () => put({ navMode: 'cat', navG: g.id, navC: null, navQ: '' }) }))
      .concat(C.filter((c) => hit(c.name)).map((c): Tuile => ({ kind: 'Sous-catégorie', name: c.name, image: c.image || grpById[c.groupe ?? -1]?.image, meta: `${c.n} produits`, on: false, open: () => put({ navMode: 'cat', navG: c.groupe ?? null, navC: c.id, navQ: '' }) })))
      .concat(GA.filter((g) => hit(g.name)).map((g): Tuile => ({ kind: 'Gamme', name: g.name, image: g.image, meta: `${g.n} produits`, on: false, open: () => put({ navMode: 'gamme', navGam: g.id, navQ: '' }) })))
      .concat(P.filter((p) => hit(`${p.name} ${p.nameNl ?? ''}`)).slice(0, 40).map(prodTile))
    crumbs.push({ label: `Recherche « ${s.navQ} »` })
  } else if (nav && s.navMode === 'cat') {
    const g = s.navG != null ? grpById[s.navG] : undefined
    const c = s.navC != null ? catById[s.navC] : undefined
    if (!g)
      tiles = G.map((x) => ({ kind: 'Catégorie', name: x.name, image: x.image, meta: `${x.n} produit${x.n > 1 ? 's' : ''} · ${x.cats.length} sous-cat.`, on: isSel('groupe', x.id), open: () => put({ navG: x.id, navC: null }) }))
    else if (!c) {
      crumbs.push({ label: g.name })
      tiles = g.cats
        .map((id) => catById[id])
        .filter(Boolean)
        .map((x) => ({ kind: 'Sous-catégorie', name: x.name, image: x.image || g.image, pale: !x.image, meta: `${x.n} produit${x.n > 1 ? 's' : ''}`, on: isSel('categorie', x.id), open: () => put({ navC: x.id }) }))
      pick = { label: `Choisir toute la catégorie « ${g.name} »`, fn: () => choose({ kind: 'groupe', id: g.id, name: g.name, image: g.image }) }
    } else {
      crumbs.push({ label: g.name, go: () => put({ navC: null }) }, { label: c.name })
      tiles = P.filter((p) => p.cat === c.id).map(prodTile)
      pick = { label: `Choisir toute la sous-catégorie « ${c.name} »`, fn: () => choose({ kind: 'categorie', id: c.id, name: c.name, image: c.image || g.image }) }
    }
  } else if (nav) {
    const ga = GA.find((x) => x.id === s.navGam)
    if (!ga)
      tiles = GA.slice()
        .sort((a, b) => Number(b.n > 0) - Number(a.n > 0) || Number(b.webshop || 0) - Number(a.webshop || 0))
        .map((x) => ({
          kind: 'Gamme', name: x.name, image: x.image, meta: `${x.du && x.au ? `du ${x.du} au ${x.au} · ` : ''}${x.n} produit${x.n > 1 ? 's' : ''}`, tip: x.description,
          on: isSel('gamme', x.id), open: () => put({ navGam: x.id }),
        }))
    else {
      crumbs.push({ label: ga.name })
      tiles = P.filter((p) => (p.gammes || []).includes(ga.id)).map(prodTile)
      pick = { label: `Choisir toute la gamme « ${ga.name} »`, fn: () => choose({ kind: 'gamme', id: ga.id, name: ga.name, image: ga.image }) }
    }
  }
  // Les offres de la sélection : promotions et bundles (API), formules (webshop).
  const offresKey = sel ? `${sel.kind}:${sel.id}@${prixShop}` : ''
  useEffect(() => {
    const st = cur()
    if (st.navSel && st.offresKey !== offresKey) loadOffres(offresKey, { shop: prixShop, [st.navSel.kind]: st.navSel.id })
  })
  const O: OffresCatalogue = s.offres || { promotions: [], formules: [] }
  const usePromo = (key: string, court: string | undefined, sous: string, libelle: string | undefined, offre: OffrePost | null) => {
    if (locked) return
    const st = cur()
    // Le libellé de l'offre dans le texte, suivi de sa mention (dates, boutiques). Avant la ligne {lien}, sinon à la fin.
    const ajoute = (txt: string, bloc: string) => {
      const tx = String(txt || '')
      if (!bloc || tx.includes(bloc)) return tx
      const i = tx.search(/\n\{lien\}\s*$/)
      return i >= 0 ? `${tx.slice(0, i)}\n${bloc}${tx.slice(i)}` : `${tx.trim() ? `${tx.trim()}\n` : ''}${bloc}`
    }
    const promo = offre?.genre === 'promotion'
    const avecMention = promo && st.mentionAuto !== false
    const mFr = avecMention && offre ? mentionOffre(offre, 'fr') : ''
    const mNl = avecMention && offre ? mentionOffre(offre, 'nl') : ''
    put({
      offreUsed: key, offre: offre || null, v: { ...st.v, promo: court || sous, promoSub: sous, showPromo: true },
      text: ajoute(ajoute(st.text, libelle || ''), mFr), textNl: st.textNl.trim() && mNl ? ajoute(st.textNl, mNl) : st.textNl,
    })
  }
  const offrePromo = (x: (typeof O.promotions)[number]): OffrePost => ({
    genre: 'promotion', id: x.id, type: x.type, nom: x.nom, court: x.court, libelle: x.libelle, du: x.du, au: x.au, tous: !!x.tous, shops: x.shops || [], portee: x.portee,
  })
  const offres = O.promotions
    .map((x) => {
      const k = `p${x.id}`
      const [tag, cls] = TAG[x.type ?? ''] || TAG.offre
      return {
        k, tag, cls, libelle: x.libelle, pale: !x.ici,
        note: `${x.ici ? '' : `Pas dans ${shopNom || 'la boutique choisie'} · `}${x.portee ?? ''}${x.au ? ` · jusqu’au ${dShort(x.au)}` : ''}`, alerte: !x.ici,
        used: s.offreUsed === k,
        use: () => usePromo(k, x.court, x.nom, x.libelle, offrePromo(x)),
        poser: () => !locked && poserTexte(x.court || x.nom, x.court ? x.nom : '', x.libelle),
      }
    })
    .concat(
      O.formules.map((f, i) => {
        const k = `f${i}`
        return {
          k, tag: 'Formule', cls: 'is-vert', libelle: f.libelle, pale: false,
          note: `${f.prix != null ? `${eur(f.prix, 2)}${shopNom ? ` à ${shopNom}` : ''}` : 'prix selon la boutique'}${f.choix?.length ? ` · au choix : ${f.choix.join(', ')}` : ''}`, alerte: false,
          used: s.offreUsed === k,
          use: () => usePromo(k, f.court, `Formule ${f.nom}`, f.libelle, { genre: 'formule', nom: f.nom, libelle: f.libelle, prix: f.prix, shop: prixShop || null }),
          poser: () => !locked && poserTexte(f.prix != null ? eur(f.prix, 2) : f.court || f.nom, `Formule ${f.nom}`, f.libelle),
        }
      }),
    )
  // Une idée appliquée : son élément du catalogue dès que le catalogue de la boutique est lu, puis son offre.
  useEffect(() => {
    const st = cur()
    if (st.ideeCat && st.nav && st.navKey === prixShop && !st.navLoading && !ideeWait.current) {
      const ic = st.ideeCat
      let it: Choix | null = null
      if (ic.kind === 'produit') {
        const p = st.nav.produits.find((x) => x.id === ic.id)
        if (p) it = prodItem(p)
      } else if (ic.kind === 'gamme') {
        const g = st.nav.gammes.find((x) => x.id === ic.id)
        if (g) it = { kind: 'gamme', id: g.id, name: g.name, image: g.image }
      } else if (ic.kind === 'categorie') {
        const c = st.nav.categories.find((x) => x.id === ic.id)
        if (c) it = { kind: 'categorie', id: c.id, name: c.name, image: c.image || grpById[c.groupe ?? -1]?.image }
      }
      ideeWait.current = true
      window.setTimeout(() => {
        ideeWait.current = false
        const n = cur().navSel
        if (it && !(n && n.kind === it.kind && n.id === it.id)) choose(it)
        put({ ideeCat: null })
      }, 0)
      return
    }
    if (st.ideeOffre != null && !st.ideeCat && !ideeWait.current) {
      const pret = !st.navSel || (st.offresKey === offresKey && st.offres && !st.offresLoading)
      if (!pret) return
      const x = (st.offres?.promotions || []).find((z) => z.id === st.ideeOffre)
      const o = st.offre
      ideeWait.current = true
      window.setTimeout(() => {
        ideeWait.current = false
        const want = cur().ideeOffre
        put({ ideeOffre: null })
        if (x) usePromo(`p${x.id}`, x.court, x.nom, x.libelle, offrePromo(x))
        else if (o && o.id === want) usePromo('', o.court, o.nom || '', o.libelle, o)
      }, 0)
    }
  })

  // Le prix de chaque boutique (TFBuddy) : le panneau sous « Prix », l'aperçu d'une boutique, un visuel par prix.
  const pbLus = pbKey && s.pb && s.pb.key === pbKey && !s.pb.loading ? s.pb.prix : null
  const gPrix = groupesPrix(s)
  const pbShow = !!pbKey && !!s.pb && s.pb.key === pbKey && s.mode === 'studio'
  const pbTitre = !s.pb || s.pb.loading
    ? 'Prix de chaque boutique : lecture dans TFBuddy…'
    : s.pb.err
      ? `Prix de chaque boutique illisible : ${s.pb.err}`
      : gPrix.length
        ? 'Prix de chaque boutique (TFBuddy) · un clic montre son visuel'
        : 'Prix de chaque boutique (TFBuddy)'
  const pbNote = !pbLus
    ? ''
    : gPrix.length
      ? `Prix différents : ${gPrix.length} visuels à la publication, chaque boutique publie le sien. Dans le texte, {prix} est le prix de la boutique.`
      : !v.showPrice
        ? 'Prix masqué sur le visuel (case « Prix »). Dans le texte, {prix} reste le prix de chaque boutique.'
        : 'Même prix dans toutes les boutiques : un seul visuel. Dans le texte, {prix} est ce prix.'
  const selPrix = !sel
    ? ''
    : sel.kind !== 'produit'
      ? `Pas de prix : ${(KIND[sel.kind] || '').toLowerCase()} entière${sel.kind === 'categorie' || sel.kind === 'groupe' ? ' · lien vers sa page du webshop' : ''}`
      : nav?.prix
        ? sel.prix != null
          ? `Prix de vente à ${shopNom} : ${eur(sel.prix, 2)}`
          : `Prix non renseigné à ${shopNom}`
        : tRes.length > 1
          ? pbLus
            ? `Prix de chaque boutique : ${tRes.map((id) => `${nomDe(id)} ${pbLus[id] != null ? eur(pbLus[id], 2) : '—'}`).join(' · ')}`
            : s.pb?.loading
              ? 'Lecture du prix de chaque boutique…'
              : 'Plusieurs boutiques : le prix dépend de la boutique'
          : 'Choisissez une boutique pour afficher son prix de vente'
  const selPrixFort = !!sel && sel.kind === 'produit' && ((!!nav?.prix && sel.prix != null) || !!pbLus)

  // ── Aperçu ──
  const pvId = s.pvShop && t.includes(s.pvShop) ? s.pvShop : t[0]
  const pvShop = pvId ? parId(etat.shops, pvId) ?? null : null
  const shopLangs = pvShop ? langsOf(pvShop) : ['fr']
  const pvLang = s.pvLang && shopLangs.includes(s.pvLang) ? s.pvLang : shopLangs[0]
  // {prix} de l'aperçu : le prix de la boutique montrée quand chaque boutique a le sien (TFBuddy).
  const catPv = cat && pbLus && pvId && pbLus[pvId] != null ? { ...cat, price: virgule(Number(pbLus[pvId])) } : cat
  const txt = (L: string) => (L === 'nl' ? s.textNl : s.text)
  // Le lien résolu pour la boutique de l'aperçu, précédé de son texte (« Commandez ici 👉 ») ; comme le serveur.
  const lienUrl = s.link && pvShop ? fill(s.link, pvShop, cat) : ''
  const aMedia = s.photos.length > 0 || !!s.video
  const lienDe = (L: string) => (lienUrl ? `${lienTexte(etat, L, s)} ${lienUrl}` : '')
  const avecLien = shopLangs.some((L) => String(txt(L) || '').includes('{lien}'))
  const remplirPv = (ig: boolean) => {
    const parts = pvShop ? shopLangs.map((L) => placerLien(fill(txt(L), pvShop, catPv, L), ig ? '' : lienDe(L))).filter((x) => x.trim()) : [s.text]
    const out = parts.join('\n\n— — —\n\n')
    return !ig && !avecLien && aMedia && lienUrl ? `${out}\n\n${lienDe(shopLangs[0])}`.trim() : out
  }
  const filled = remplirPv(false)
  const filledIg = remplirPv(true)
  const vL: Visuel = pvLang === 'nl' ? { ...v, ...Object.fromEntries(LOC.map((k) => [k, v.nl?.[k] || ''])) } : v
  const needed = [...new Set(t.flatMap((id) => langsOf(id)))]
  const shopsFor = (L: string) => t.filter((id) => langsOf(id).includes(L)).map(nomDe)
  const rawMedia = s.photos.map((p) => ({ src: imageSocial(p.src), isVideo: false, fit: p.cut ? 'contain' : 'cover' })).concat(s.video ? [{ src: '', isVideo: true, fit: 'cover' }] : [])
  const shown = rawMedia.slice(0, 4).map((m, i) => ({ ...m, more: i === 3 && rawMedia.length > 4 }))
  const pv = {
    page: pvShop ? String(pvShop.page || pvShop.name) : 'L’Atelier By',
    city: pvShop ? pvShop.name : '—',
    handle: String(igUnique ? igHandle : pvShop?.ig || igHandle).replace('@', ''),
    when: s.dark ? 'Sponsorisé' : s.when === 'now' ? 'À l’instant' : `${dLabel(s.date)} à ${s.time}`,
    text: filled || 'Votre texte apparaîtra ici.',
    textIg: filledIg || 'Votre texte apparaîtra ici.',
    resolved: pvShop ? [`{ville} → ${pvShop.name}`, `{horaires} → ${pvShop.hours ?? ''}`, `{prix} → ${catPv?.price ? `${catPv.price} €` : 'non défini'}`].join(' · ') : '—',
  }
  const igBroken = t.filter((id) => (parId(etat.shops, id)?.igs ?? '') !== 'connected')
  const pages = t.filter((id) => s.ch[id] && (s.ch[id].fb || s.ch[id].ig))
  const [hh, mm] = (s.when === 'now' ? '12:00' : s.time).split(':').map(Number)
  const schedule = pages.map((id, i) => {
    const off = pages.length > 1 ? Math.round((s.spread * i) / (pages.length - 1)) : 0
    const tot = hh * 60 + mm + off
    return { name: nomDe(id), t: s.when === 'now' ? `+${off} min` : `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}` }
  })
  const isNlEd = s.edLang === 'nl'
  const gv = (key: keyof Visuel): string => (isNlEd && (LOC as readonly string[]).includes(key) ? (v.nl as Record<string, string>)[key] || '' : String(v[key] ?? ''))
  const sv = (key: keyof Visuel, val: string) => (isNlEd && (LOC as readonly string[]).includes(key) ? V({ nl: { ...v.nl, [key]: val } }) : V({ [key]: val } as Partial<Visuel>))
  const pageTitle = s.dark ? (s.id ? 'Modifier le dark post' : 'Nouveau dark post') : s.id ? (locked ? 'Post publié' : 'Modifier le post') : 'Nouveau post'
  const nImg = s.mode === 'pano' ? s.m.n : s.mode === 'frise' ? 3 : s.mode === 'brut' ? s.photos.length : 1
  const darkFormat =
    s.mode === 'brut' && s.video
      ? `vidéo${s.photos.length ? ' (la photo n°1 sert de couverture)' : ' (vignette choisie par Meta)'}`
      : s.mode === 'pano' || s.mode === 'frise'
        ? `carrousel de ${nImg} images, ordre verrouillé — la continuité du visuel est gardée`
        : nImg > 1
          ? `carrousel de ${Math.min(10, nImg)} images`
          : 'image'
  const DARK = ((serveur.darkPosts ?? []) as unknown as { post: string; lang: string; ad: string; shop: string; variant: string; link?: string; linkIg?: string; comments: number; hidden?: number }[]).filter(
    (x) => !!s.id && x.post === s.id,
  )
  const darkMulti = new Set(DARK.map((x) => x.lang)).size > 1
  const darkAds = [...new Set(DARK.map((x) => x.ad))]
  const modes: [Mode, string, string][] = (
    [
      ['studio', 'Visuel composé', 'Un visuel carré aux couleurs de la marque (studio)'],
      ['pano', 'Carrousel panoramique', 'Un seul post : la photo continue d’une image à l’autre en glissant'],
      ['collage', 'Collage 4:5', 'Plusieurs photos réunies en une image 1080 × 1350'],
      ['frise', 'Frise de grille', '3 posts Instagram qui forment une ligne du profil (franchiseur)'],
      ['brut', 'Photos telles quelles', 'Les photos et la vidéo partent sans retouche'],
    ] as [Mode, string, string][]
  ).filter(([k]) => k !== 'frise' || serveur.user.role === 'Franchiseur' || s.mode === 'frise')

  // Montages Instagram
  const mTpl = Montages.TEMPLATES.find((x) => x[0] === s.m.tpl) || Montages.TEMPLATES[1]
  const setM = (patch: Partial<Montage>) => !locked && put((st) => ({ m: { ...st.m, ...patch } }))
  const isPano = s.mode === 'pano'
  const isCollage = s.mode === 'collage'
  const isFrise = s.mode === 'frise'
  const slices = s.mPrev.slices || []
  const nS = slices.length
  const iS = Math.min(s.mIdx, Math.max(0, nS - 1))
  const mFresh = !!mKey.current && s.mPrev.key === mKey.current
  const mAlbum = isPano && s.pv === 'fb' && nS > 1
  const mWide = isFrise && s.pv === 'fb'
  const mHints = isFrise
    ? [
        '3 posts Instagram publiés à la suite, de droite à gauche : ils forment une ligne du profil (le plus récent s’affiche en haut à gauche).',
        'Le profil recadre chaque post en 3:4 : la découpe en tient compte, la ligne reste continue dans la grille.',
        'Facebook reçoit le visuel entier, en une photo.',
        'Aucun autre post Instagram de la boutique dans la demi-heure avant et après. Ensuite, publiez par 3 pour que la ligne reste alignée — voir Grille Instagram.',
      ]
    : isPano
      ? [
          `Publié en un seul post : carrousel de ${s.m.n} images sur Instagram, album de ${s.m.n} photos sur Facebook.`,
          'Sur le profil Instagram, seule la 1re image apparaît : le titre et la pastille prix y restent entiers.',
          'Bandeau : séparez les éléments par « · » — ils sont répartis un par image, aucun mot n’est coupé entre deux images.',
          'Une photo couvre toute la largeur ; plusieurs photos se partagent la largeur, dans l’ordre (cliquez une photo pour la mettre en n°1).',
          'Textes incrustés : une seule langue pour toutes les boutiques ciblées — pour une boutique néerlandophone, faites un post à part.',
        ]
      : [
          'Une image 1080 × 1350 (4:5), le format le plus grand dans le fil Instagram.',
          `Gabarit ${mTpl[1]} : ${mTpl[2]} cases, remplies dans l’ordre des photos ; elles se répètent s’il en manque.`,
          'Textes incrustés : une seule langue pour toutes les boutiques ciblées.',
        ]
  const curSlots = (STYLES2.find((x) => x[0] === v.style) || [0, 0, 1])[2] as number
  const photosLabel =
    s.mode === 'frise'
      ? [`Photos de la frise · ${s.photos.length}`, 'Une seule photo couvre la ligne ; plusieurs se partagent la largeur.']
      : s.mode === 'pano'
        ? [`Photos du panorama · ${s.photos.length}`, `Une seule photo couvre les ${s.m.n} images ; plusieurs se partagent la largeur.`]
        : s.mode === 'collage'
          ? [`Photos du collage · ${s.photos.length}`, 'La n°1 prend la plus grande case.']
          : s.mode === 'studio'
            ? [`Photos du visuel · ${s.photos.length}`, curSlots > 1 ? `Ce montage a ${curSlots} cases, les photos se répètent s’il en manque.` : 'La n°1 est utilisée.']
            : [`Photos publiées · ${s.photos.length}`, 'La n°1 apparaît en premier.']

  // Contrôle qualité, modèles, fonds, textes posés, illustration
  const QC: Record<string, string> = { erreur: 'is-erreur', attention: 'is-attention', conseil: 'is-conseil' }
  const QCI: Record<string, string> = { erreur: '✕', attention: '!', conseil: 'i' }
  const VM = visModeles()
  const ton = tonDe(v.style)
  const fondsTon = ton ? FONDS.filter((f) => f.ton === ton) : []
  const fondCur = fondsTon.some((f) => f.id === v.fond) ? v.fond : null
  const ts = v.textes || []
  const txtSel = ts.find((x) => x.id === s.txtSel) || null
  const updTxt = (patch: Partial<TextePose>) => {
    if (!locked && txtSel) V({ textes: ts.map((x) => (x.id === txtSel.id ? { ...x, ...patch } : x)) })
  }
  const EM = etqModeles()
  const garderEtq = (mes: ModeleEtiquette[], msg: string) => garderParametre('etiquettes_modeles', mes, msg, () => put({ txtTplNom: '' }))
  const pickEtq = (o: ModeleEtiquette): Partial<TextePose> => ({ forme: o.forme, police: o.police, couleur: o.couleur, fond: o.fond, taille: o.taille, rot: o.rot, x: o.x, y: o.y })
  const canTplSave = !!txtSel && !locked && !!String(s.txtTplNom || '').trim()
  const illusAll = s.dsIllus.filter((x) => x.cat === 'Illustrations')
  const illusSubs = [...new Set(illusAll.map((x) => x.sub))]
  const illusSub = s.illusCat && illusSubs.includes(s.illusCat) ? s.illusCat : illusSubs[0]
  const il = v.illus?.src ? v.illus : null
  const putIllus = (patch: Partial<NonNullable<Visuel['illus']>>) => {
    if (!locked) V({ illus: { x: 82, y: 18, taille: 28, trait: 'auto', ...(il || { src: '' }), ...patch } as NonNullable<Visuel['illus']> })
  }
  const couleurDe = (role: string) => (role === 'phrase' ? v.phraseColor || 'auto' : (v.couleurs || {})[role] || 'auto')
  const couleurTexte = (role: string, id: string) => {
    if (role === 'phrase') {
      V({ phraseColor: id })
      return
    }
    const c = { ...(cur().v.couleurs || {}) }
    if (id === 'auto') delete c[role]
    else c[role] = id
    V({ couleurs: c })
  }
  /** La pastille de couleur d'un texte : sa couleur actuelle ; un clic ouvre la palette de ce texte. */
  const pastille = (role: string, nom: string) => {
    const id = couleurDe(role)
    const c = PALETTE_TEXTE.find((x) => x.id === id) || PALETTE_TEXTE[0]
    const ouvert = s.couleurRole === role
    return (
      <button
        type="button"
        className={`pst__pastille${ouvert ? ' is-on' : ''}`}
        disabled={locked}
        title={`Couleur · ${nom} : ${c.nom}`}
        style={{ background: c.hex }}
        onClick={() => put({ couleurRole: ouvert ? null : role, couleurNom: nom })}
      >
        {id === 'auto' ? 'A' : ''}
      </button>
    )
  }
  const prixApercu = gPrix.length && s.pb?.prix && s.pbApercu ? (s.pb.prix[s.pbApercu] == null ? '' : virgule(Number(s.pb.prix[s.pbApercu]))) : null
  const studioControl: ControleStudio = {
    ...vL,
    ...(prixApercu != null ? { price: prixApercu } : {}),
    noEdit: locked ? Object.keys(NOMS_TEXTE) : prixApercu != null ? ['price'] : [],
    txtSel: s.txtSel,
    texteSel: s.couleurRole || null,
    photos: s.photos,
    showPrice: v.showPrice && !!String(prixApercu != null ? prixApercu : v.price || '').trim(),
    showPromo: v.showPromo && !!String(v.promo || '').trim(),
    showTitle: v.showTitle && !!String(v.title || '').trim(),
    showPhrase: v.showPhrase && !!String(v.phrase || '').trim(),
  }
  const surApi = useCallback((a: StudioApi) => {
    api.current = a
  }, [])

  // Assistant de rédaction et relecture de la charte
  const ch = charte(serveur)
  const prixV = sel && sel.kind === 'produit' && sel.prix != null ? sel.prix : null
  const rel = (tx: string, L: string) => relire(ch, tx, { prix: prixV, lien: !!String(s.link || '').trim(), langue: L })
  const remarques = rel(s.text, 'fr').map((r) => ({ L: 'FR', ...r })).concat(needed.includes('nl') ? rel(s.textNl, 'nl').map((r) => ({ L: 'NL', ...r })) : [])
  const R = s.iaRes
  const tags = (R?.hashtags?.length ? R.hashtags : ch.hashtags || []).concat(ch.hashtagVille ? ['{hashtag_ville}'] : [])
  const iaOff = locked || s.iaBusy || !ia.configure
  const vide = !String(s.text || s.textNl || '').trim()
  const LBL: Record<string, string> = { court: 'plus courte', gourmand: 'plus gourmande', urgent: 'plus urgente' }
  const Cor = s.cor
  const corChange = !!Cor?.textes?.some((x) => x.change)
  const corAppliquer = () => {
    if (locked || !Cor) return
    const st = cur()
    const patch: Partial<St> = { cor: null }
    const c0: Record<string, string> = { fr: st.text, nl: st.textNl }
    const garde: string[] = []
    ;(Cor.textes || []).forEach((x) => {
      if (!x.change) return
      if (c0[x.cle] !== (Cor.avant as Record<string, string>)[x.cle]) {
        garde.push(x.cle.toUpperCase())
        return
      }
      if (x.cle === 'nl') patch.textNl = x.texte
      else patch.text = x.texte
    })
    autoFr.current = null
    autoNl.current = null
    put(patch)
    toast(garde.length ? `Texte ${garde.join(' et ')} modifié depuis la relecture : relancez « Corriger ».` : 'Corrections appliquées.')
  }

  // Liens du webshop : celui de la boutique, ou la page du produit choisi, résolus boutique par boutique.
  const wsAll = CATALOGUE.filter((c) => c.kind !== 'gamme' && c.apiId && c.webshop)
  const wsProd = !!(cat && cat.kind !== 'gamme' && cat.apiId && cat.webshop !== false)
  const wsCat = !!cat?.categoryId
  const why = !cat
    ? `Pour le lien d’un produit : choisissez-le à l’étape 2, ou cherchez-le ci-dessous parmi les ${wsAll.length} produits du webshop.`
    : cat.kind === 'gamme'
      ? `« ${cat.name} » est une gamme : le webshop n’a pas de page de gamme. Cherchez ci-dessous un produit ou une catégorie de la gamme.`
      : !cat.apiId || cat.webshop === false
        ? `« ${cat.name} » n’est pas vendu sur le webshop${wsCat ? ' : sa catégorie l’est peut-être (bouton « Catégorie sur le webshop »).' : '. Cherchez un autre produit ci-dessous.'}`
        : ''
  const wq = norm(s.wsQ).trim()
  const words = wq.split(/\s+/).filter(Boolean)
  const hitW = (x: string) => words.every((w) => norm(x).includes(w))
  const wsCats: Record<string, { id: string; name: string; n: number }> = {}
  wsAll.forEach((c) => {
    if (c.categoryId) {
      const k = String(c.categoryId)
      wsCats[k] = wsCats[k] || { id: k, name: c.gamme || `Catégorie ${k}`, n: 0 }
      wsCats[k].n++
    }
  })
  const prodHits = wq.length >= 2 ? wsAll.filter((c) => hitW(`${c.name} ${c.gamme || ''}`)).slice(0, 8) : []
  const catHits = wq.length >= 2 ? Object.values(wsCats).filter((c) => hitW(c.name)).slice(0, 4) : []
  const wsResults = catHits
    .map((c) => ({ label: c.name, sub: `Catégorie · ${c.n} produit${c.n > 1 ? 's' : ''}`, cat: true, val: `{webshop_categorie:${c.id}}` }))
    .concat(prodHits.map((c) => ({ label: c.name, sub: `Produit${c.price ? ` · ${c.price} €` : ''}`, cat: false, val: `{webshop_produit:${c.apiId}${ficheDefaut() ? '' : ':liste'}}` })))
  const mP = /\{webshop_produit:(\d+)(:liste)?\}/.exec(s.link || '')
  const mC = /\{webshop_categorie:(\d+)\}/.exec(s.link || '')
  const chosen = mP ? wsAll.find((c) => String(c.apiId) === mP[1])?.name ?? '' : mC ? wsCats[mC[1]]?.name ?? '' : ''
  const res = s.link && /\{webshop/.test(s.link) && pvShop ? fill(s.link, pvShop, cat) : ''
  const lienChip = (val: string, label: string, tip: string, dis: boolean) => {
    const on = s.link === val || (val.startsWith('{webshop_produit') && /^\{webshop_produit(:liste)?\}$/.test(s.link || ''))
    return { val, label, tip, dis: locked || dis, on }
  }
  const linkChips = [
    lienChip('{webshop}', 'Webshop de la boutique', 'Le webshop de chaque boutique visée (https://webshop.atelierby.be/?shop=…)', false),
    lienChip(ficheDefaut() ? '{webshop_produit}' : '{webshop_produit:liste}', 'Produit sur le webshop', wsProd && cat ? `La page de « ${cat.name} » dans le webshop de chaque boutique` : why, !wsProd),
    lienChip('{webshop_categorie}', 'Catégorie sur le webshop', wsCat && cat ? `La catégorie de « ${cat.name} » (${cat.gamme || ''}) dans le webshop de chaque boutique` : 'Choisissez d’abord un produit à l’étape 2', !wsCat),
    lienChip('https://www.latelierby.be', 'Site L’Atelier By', 'www.latelierby.be', false),
  ]
  const mFiche = /^\{webshop_produit(:\d+)?(:liste)?\}$/.exec(String(s.link || '').trim())
  const fiche = !!mFiche && !mFiche[2]
  const sc = (serveur.metaStatus as { jeton?: { scopes?: string[] } } | undefined)?.jeton?.scopes
  const permWarn: string[] = []
  if (Array.isArray(sc) && !s.dark) {
    if (t.some((id) => s.ch[id]?.fb) && !sc.includes('pages_manage_posts')) permWarn.push('pages_manage_posts — publier sur les Pages Facebook des boutiques')
    if (t.some((id) => s.ch[id]?.ig) && !sc.includes('instagram_content_publish')) permWarn.push('instagram_content_publish — publier sur Instagram')
  }

  // Publication : l'appel à Meta tel qu'il partira (indicatif).
  const later = s.when === 'later'
  const mins = later ? schedMinutes(s) : 0
  const nPano = s.mode === 'pano' ? (s.mPrev.slices || []).length || s.m.n : 0
  const ep = s.mode === 'studio' || s.mode === 'collage' || s.mode === 'frise' ? 'photos' : s.mode === 'pano' ? 'feed' : s.video ? (s.videoFormat === 'reel' ? 'video_reels' : 'videos') : s.photos.length === 1 ? 'photos' : 'feed'
  const msg60 = `${(filled || '').slice(0, 60)}${(filled || '').length > 60 ? '…' : ''}`
  const tsPub = later ? Math.round(new Date(`${s.date}T${s.time}:00`).getTime() / 1000) : null
  const apiParams: [string, string][] = (
    (ep === 'photos'
      ? [
          ['url', s.mode === 'studio' ? '{visuel rendu 1080×1080, stocké sur R2}' : s.mode === 'collage' ? '{collage rendu 1080×1350}' : s.mode === 'frise' ? '{frise : visuel entier 3038×1350}' : '{photo n°1 sur R2}'],
          ['caption', `"${msg60}"`],
        ]
      : nPano
        ? [
            ['message', `"${msg60}"`],
            ['attached_media', `[${Array.from({ length: nPano }, (_, i) => `{media_fbid: ${i + 1}}`).join(', ')}] · ${nPano} photos 1080×1350 envoyées avec published=false`],
          ]
        : ep === 'feed'
          ? ([['message', `"${msg60}"`]] as [string, string][])
              .concat(s.link ? [['link', s.link]] : [])
              .concat(s.photos.length > 1 ? [['attached_media', `[${s.photos.map((_, i) => `{media_fbid: ${i + 1}}`).join(', ')}]`]] : [])
          : ep === 'videos'
            ? [
                ['file_url', '{vidéo sur R2}'],
                ['description', `"${msg60}"`],
              ]
            : [
                ['upload_phase', 'start → finish'],
                ['description', `"${msg60}"`],
                ['video_state', 'PUBLISHED'],
              ]
  ) as [string, string][]).concat(later ? [['published', 'false'], ['scheduled_publish_time', `${tsPub} (${dShort(s.date)} ${s.time})`]] : [['published', 'true']])
  const igCall =
    s.mode === 'frise'
      ? 'Instagram : 3 × POST /{ig_user_id}/media (tuiles 3, 2, 1 · 1080×1350) → 3 × POST /{ig_user_id}/media_publish à la suite'
      : nPano
        ? `Instagram : ${nPano} × POST /{ig_user_id}/media (is_carousel_item=true) → POST /{ig_user_id}/media (media_type=CAROUSEL, children) → media_publish`
        : 'Instagram : POST /{ig_user_id}/media → POST /{ig_user_id}/media_publish'
  const schedRule = !later ? 'Publication immédiate : published=true.' : mins < 10 ? 'Trop tôt : Meta exige au moins 10 minutes d’avance.' : mins > 43200 ? 'Trop tard : 30 jours maximum.' : 'Fenêtre Meta respectée : entre 10 minutes et 30 jours.'
  const schedClass = !later ? 'muted' : mins < 10 || mins > 43200 ? 'is-alerte' : 'is-bon'
  const publishLabel = s.saving
    ? 'Préparation du visuel…'
    : s.dark
      ? 'Enregistrer et créer la publicité →'
      : `${s.when === 'now' ? 'Publier maintenant sur ' : 'Programmer sur '}${pages.length} Page${pages.length > 1 ? 's' : ''}`

  // Vues de l'aperçu : téléphone, story (l'interface d'Instagram par-dessus le visuel 9:16), grille du profil.
  const vue = s.pvVue || 'post'
  const story = vue === 'story'
  const studio = s.mode === 'studio'
  const fmt = v.format || 'carre'
  const isStoryUi = story && studio && fmt === 'story'
  const storyPasFormat = story && !(studio && fmt === 'story')
  const storyMsg = studio
    ? `Le visuel est en ${(FORMATS_V.find((f) => f[0] === fmt) || [0, fmt])[1]} : en story, Instagram le pose réduit au milieu d’un fond uni. Une story n’a pas de légende.`
    : 'La vue Story montre le visuel composé (mode « Visuel composé »).'
  const compte = igUnique ? 'marque' : pvId
  const Gr = compte ? s.grilleData[compte] : undefined
  useEffect(() => {
    if (cur().pvVue !== 'grille' || !compte || cur().grilleData[compte] !== undefined || grilleLu.current) return
    grilleLu.current = true
    lireGrilleInstagram(compte)
      .then((r) => {
        grilleLu.current = false
        put((st) => ({ grilleData: { ...st.grilleData, [compte]: r?.media ?? [] } }))
      })
      .catch(() => {
        grilleLu.current = false
        put((st) => ({ grilleData: { ...st.grilleData, [compte]: [] } }))
      })
  })
  // Ce post dans la grille : un instantané du visuel composé (refait quand le visuel change), sinon sa première photo.
  useEffect(() => {
    const st = cur()
    if (st.pvVue !== 'grille' || st.mode !== 'studio' || !api.current) return
    const cle = JSON.stringify(st.v) + st.photos.map((p) => p.src.length + p.src.slice(-32)).join('|')
    if (cle === snapCle.current) return
    snapCle.current = cle
    window.clearTimeout(snapT.current)
    snapT.current = window.setTimeout(async () => {
      try {
        await photosLocales()
        const src = await api.current?.toImage({ jpeg: true, pixelRatio: 0.32, quality: 0.75 })
        if (!mort.current && src) put({ grilleSnap: src })
      } catch (e) {
        console.error(e)
      }
    }, 900)
  })
  const moi = { src: studio ? s.grilleSnap || '' : s.photos[0] ? imageSocial(s.photos[0].src) : '', quand: `${s.when === 'now' ? TODAY : s.date} ${s.time || ''}`, tag: 'Ce post', moi: true }
  const prog = (etat.posts as PostSocial[])
    .filter((p) => p.ig && p.status === 'Programmé' && p.id !== s.id && (igUnique || (Array.isArray(p.shops) ? !!compte && p.shops.includes(compte) : p.shops === 'all')))
    .map((p) => ({ src: p.img ? imageSocial(p.img) : '', quand: `${p.date} ${p.time || ''}`, tag: `Programmé ${dShort(p.date)}`, moi: false }))
  const grilleTiles = [moi as { src: string; quand: string; tag: string; moi: boolean }]
    .concat(prog)
    .sort((a, b) => b.quand.localeCompare(a.quand))
    .concat((Gr || []).map((m) => ({ src: m.src, quand: '', tag: '', moi: false })))
    .slice(0, 12)
  const grilleNom = igUnique ? igHandle : pvId ? nomDe(pvId) : ''

  // Médiathèque
  const estVid = (it: VisuelLib) => it.kind === 'video'
  const inPost = (it: VisuelLib) => (estVid(it) ? !!s.video && s.video.src === it.src : s.photos.some((p) => p.src === it.src))
  // Une vidéo de la médiathèque devient LA vidéo du post (une seule par post) ; une photo s'ajoute ou se retire.
  const togglePost = (it: VisuelLib) => {
    if (locked) return
    if (estVid(it)) {
      if (inPost(it)) put({ video: null })
      else choisirVideo(it)
      return
    }
    put((st) => ({ photos: st.photos.some((p) => p.src === it.src) ? st.photos.filter((p) => p.src !== it.src) : st.photos.concat({ src: it.src, cut: it.cut !== false, name: it.name }) }))
  }
  const vign = (it: VisuelLib) => imageSocial(estVid(it) ? it.poster || '' : it.thumb || it.src)
  const tagsLib = (it: VisuelLib) => [it.cat || 'Non classée', it.sub, it.season].filter(Boolean).join(' · ')
  const found = s.lib.filter((it) => correspond(it, s.query, s.fCat, '', s.fSeason))
  const mFound = s.lib.filter((it) => correspond(it, s.mQuery, s.mCat, s.mSub, s.mSeason) && (!s.mOnlyPost || inPost(it)))
  const allActive = !s.mCat && !s.mOnlyPost
  const uncActive = s.mCat === '—' && !s.mOnlyPost
  const ctx = s.mOnlyPost ? 'dans le post' : s.mCat === '—' ? 'non classés' : s.mSub ? `${s.mCat} › ${s.mSub}` : s.mCat ? s.mCat : 'au total'
  const ed = s.lib.find((x) => x.id === s.editId) || null
  const locaux = s.lib.filter((it) => !it.shared && !it.ds).length
  const editDelete = () => {
    if (!ed) return
    const id = ed.id
    if (ed.shared) {
      if (!partageOk() || !ed.mid) {
        toast('Médiathèque commune indisponible : rien n’a été retiré.')
        return
      }
      retirerMedia(ed.mid)
        .then(() => {
          put({ editId: null })
          updateLib((l) => l.filter((x) => x.id !== id))
          toast('Retiré de la médiathèque commune — un post qui l’utilise le garde.')
        })
        .catch((e: unknown) => toast(`Retrait refusé : ${message(e)}`))
      return
    }
    if (ed.ds) {
      try {
        const r = lireRetires()
        if (!r.includes(id)) r.push(id)
        localStorage.setItem('latelier.fbpost.dsRemoved', JSON.stringify(r))
      } catch {
        /* stockage indisponible */
      }
    }
    put({ editId: null })
    updateLib((l) => l.filter((x) => x.id !== id))
  }
  const restaurerDs = async () => {
    try {
      localStorage.removeItem('latelier.fbpost.dsRemoved')
    } catch {
      /* stockage indisponible */
    }
    try {
      const ds = await illustrationsDs()
      const have = new Set(cur().lib.map((x) => x.id))
      const fresh = ds.filter((x) => !have.has(x.id))
      if (fresh.length) updateLib((l) => l.concat(fresh))
    } catch (e) {
      toast(`Illustrations du design system indisponibles : ${message(e)}`)
    }
  }

  // Idées de posts et ce qui marche
  const inspiOpen = s.inspi != null ? s.inspi : !s.id
  const recoC = s.reco?.conseil ?? null
  const x1 = (n: number | undefined) => `×${Number(n || 0).toFixed(1).replace('.', ',')}`
  const idees = s.idees?.idees ?? []
  const nI = idees.length
  const court = nI > 5 && !s.ideesTout

  const len = filled.length
  const bilingue = shopLangs.length > 1

  // Les vignettes des styles : bordure du style choisi, choix d'un style.
  const VS: Cartes = { sel: {}, pick: {} }
  STYLES1.map((x) => x[0])
    .concat(STYLES2.map((x) => x[0]))
    .forEach((k) => {
      const Cp = k.charAt(0).toUpperCase() + k.slice(1)
      VS.sel[Cp] = v.style === k ? '#8D1D2C' : 'transparent'
      VS.pick[Cp] = () => !locked && V({ style: k })
    })

  const seg = <K extends string>(items: [K, ReactNode, string?][], actif: K, onPick: (k: K) => void, dis = false) => (
    <div className="seg">
      {items.map(([k, l, tip]) => (
        <button key={k} type="button" title={tip} className={actif === k ? 'is-on' : ''} aria-pressed={actif === k} disabled={dis} onClick={() => onPick(k)}>
          {l}
        </button>
      ))}
    </div>
  )
  const langTabs = seg(
    (['fr', 'nl'] as const).map((L) => {
      const req = needed.includes(L)
      const done = L === 'nl' ? !!s.textNl.trim() : !!s.text.trim()
      return [L, <span key={L} className="pst__langue">{L.toUpperCase()}{req ? '' : ' · non requis'}<i className={`pst__point${!req ? '' : done ? ' is-bon' : ' is-or'}`} /></span>, req ? (done ? 'Texte saisi' : 'Texte à écrire') : 'Aucune boutique visée ne parle cette langue'] as ['fr' | 'nl', ReactNode, string]
    }),
    s.edLang,
    (L) => put({ edLang: L }),
  )
  const rangee = (range: { min: number; max: number; step?: number; value: number; onChange: (n: number) => void; title?: string; dis?: boolean }) => (
    <input type="range" min={range.min} max={range.max} step={range.step ?? 1} value={range.value} title={range.title} disabled={range.dis ?? locked} onChange={(e) => range.onChange(+e.target.value)} />
  )
  const champ = (value: string, onChange: (x: string) => void, placeholder: string, extra?: { className?: string; dis?: boolean }) => (
    <input type="text" className={extra?.className ?? 'pst__champ'} value={value} placeholder={placeholder} disabled={extra?.dis ?? locked} onChange={(e) => onChange(e.target.value)} />
  )
  const fichiers = (accept: string, multiple: boolean, onFiles: (l: File[]) => void) => (
    <input type="file" accept={accept} multiple={multiple} hidden onChange={(e: ChangeEvent<HTMLInputElement>) => {
      const l = Array.from(e.target.files || [])
      e.target.value = ''
      onFiles(l)
    }} />
  )
  const vFields: { label: string; key: keyof Visuel; show: keyof Visuel; isLabel?: boolean; c1?: ReactNode; second?: { label: string; key: keyof Visuel; c2: ReactNode } }[] = [
    { label: "Logo L'Atelier By", key: 'title', show: 'showLogo', isLabel: true },
    { label: 'Mention saison · date', key: 'eyebrow', show: 'showEyebrow', c1: pastille('eyebrow', 'Mention saison') },
    { label: 'Nom du produit', key: 'title', show: 'showTitle', c1: pastille('title', 'Nom du produit') },
    { label: "Phrase d'accroche", key: 'phrase', show: 'showPhrase', c1: pastille('phrase', 'Phrase d’accroche') },
    { label: 'Prix', key: 'price', show: 'showPrice', c1: pastille('price', 'Prix'), second: { label: isNlEd ? 'Unité (NL)' : 'Unité', key: 'unit', c2: pastille('unit', 'Unité') } },
    { label: 'Offre (4+1)', key: 'promo', show: 'showPromo', c1: pastille('promo', 'Offre'), second: { label: isNlEd ? 'de 5de gratis' : 'la 5ᵉ offerte', key: 'promoSub', c2: pastille('promoSub', 'Sous-texte de l’offre') } },
    { label: 'Site web', key: 'site', show: 'showSite', c1: pastille('site', 'Site web') },
  ]
  const palette = (bord: boolean) =>
    s.couleurRole && !locked ? (
      <div className={`pst__palette${bord ? ' is-bord' : ''}`}>
        <span className="pst__palette-nom">Couleur · {s.couleurNom}</span>
        {PALETTE_TEXTE.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.nom}
            className={`pst__pastille${c.id === couleurDe(s.couleurRole as string) ? ' is-on' : ''}`}
            style={{ background: c.hex }}
            onClick={() => couleurTexte(s.couleurRole as string, c.id)}
          >
            {c.id === 'auto' ? 'A' : ''}
          </button>
        ))}
        {!bord ? (
          <button type="button" className="btn btn--ghost btn--sm" title="Remettre toutes les couleurs des textes à celles du style" onClick={() => !locked && (V({ couleurs: {}, phraseColor: 'auto' }), toast('Couleurs des textes : celles du style.'))}>
            Tout en automatique
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost btn--sm btn--icon" title="Fermer" onClick={() => put({ couleurRole: null })}>
          ✕
        </button>
      </div>
    ) : null

  return (
    <div className="social-native pst">
      {avis ? (
        <p className="warning pst__avis">
          {avis}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      <div className="pst__tete">
        <button type="button" className="btn btn--ghost btn--sm" onClick={retour}>
          ← Calendrier
        </button>
        <span className="pst__titre">{pageTitle}</span>
        {locked ? <span className="chip pst__publie">Publié · lecture seule</span> : null}
      </div>

      {/* Idées de posts (promotions, opérations, gammes, heures creuses) et ce qui marche (90 derniers jours) */}
      {!locked && !s.id ? (
        <section className="card pst__carte">
          <div className="pst__ligne">
            <span className="pst__etiquette">Idées de posts · ce qui marche</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                put({ inspi: !inspiOpen })
                try {
                  localStorage.setItem('sa.inspi', inspiOpen ? '0' : '1')
                } catch {
                  /* stockage indisponible */
                }
              }}
            >
              {inspiOpen ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          {inspiOpen ? (
            <div className="pst__inspi">
              <div className="pst__inspi-col">
                <span className="pst__sous-titre">Idées de posts</span>
                {s.ideesBusy ? <span className="muted pst__petit">Recherche des promotions, opérations, gammes et heures creuses…</span> : null}
                {s.ideesErr ? <span className="pst__petit is-alerte">Idées indisponibles : {s.ideesErr}</span> : null}
                {s.idees && !idees.length ? <span className="muted pst__petit">Rien d’urgent : chaque promotion active, opération proche et gamme qui commence a déjà son post.</span> : null}
                {(court ? idees.slice(0, 5) : idees).map((x) => {
                  const [tag, cls] = TAGI[x.genre] || TAGI.promo
                  const on = s.ideeId === x.id
                  return (
                    <div key={x.id} className={`pst__idee${on ? ' is-on' : ''}`}>
                      <span className={`pst__tag ${cls}`}>{tag}</span>
                      <div className="pst__idee-texte">
                        <span>{x.titre}</span>
                        <span className="muted">{x.detail}</span>
                      </div>
                      <button type="button" className="btn btn--sm" disabled={locked} onClick={() => !locked && appliquerIdee(x)}>
                        {on ? 'Appliquée ✓' : 'Créer ce post'}
                      </button>
                    </div>
                  )
                })}
                {nI > 5 ? (
                  <button type="button" className="btn btn--ghost btn--sm pst__gauche" onClick={() => put({ ideesTout: !s.ideesTout })}>
                    {court ? `Voir les ${nI - 5} autres idées` : 'Moins d’idées'}
                  </button>
                ) : null}
                {s.idees?.muettes?.length ? <span className="pst__petit is-moyen">Sans réponse pour l’instant : {s.idees.muettes.join(', ')}.</span> : null}
              </div>
              <div className="pst__inspi-col">
                <span className="pst__sous-titre">Ce qui marche · 90 derniers jours</span>
                {s.recoLu && !s.reco && !s.recoBusy ? (
                  <button
                    type="button"
                    className="btn btn--sm pst__gauche"
                    title="Compare les publications de toutes les Pages et de tous les comptes Instagram, chacune à l’habitude de son propre compte (lecture chez Meta, une vingtaine de secondes)."
                    onClick={() => analyserReco(false)}
                  >
                    Analyser les publications
                  </button>
                ) : null}
                {s.recoBusy ? <span className="muted pst__petit">Lecture des publications chez Meta…</span> : null}
                {s.recoErr ? <span className="pst__petit is-alerte">Analyse impossible : {s.recoErr}</span> : null}
                {recoC && !s.recoBusy ? (
                  <div className="pst__conseil">
                    <span>
                      Meilleur moment : {recoC.jour.toLowerCase()}, {recoC.creneau.charAt(0).toLowerCase() + recoC.creneau.slice(1)} (jour {x1(recoC.indiceJour)}, heure {x1(recoC.indiceCreneau)} l’habitude)
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm pst__gauche"
                      disabled={locked}
                      onClick={() => {
                        if (!locked && recoC) {
                          put({ when: 'later', date: recoC.date, time: recoC.heure })
                          toast(`Programmé ${dLabel(recoC.date)} à ${recoC.heure} : le moment où vos publications marchent le mieux.`)
                        }
                      }}
                    >
                      Programmer {dLabel(recoC.date)} à {recoC.heure}
                    </button>
                  </div>
                ) : null}
                {s.reco && !s.recoBusy
                  ? (s.reco.constats || []).map((c, i) => (
                      <span key={i} className="pst__constat">
                        <span className="pst__fleche">↗</span>
                        <span>{c.texte}</span>
                      </span>
                    ))
                  : null}
                {s.reco && !s.recoBusy && !(s.reco.constats || []).length ? <span className="muted pst__petit">Pas encore assez de publications comparables pour conclure (au moins {s.reco.min ?? 4} par groupe).</span> : null}
                {s.reco && !s.recoBusy ? (
                  <span
                    className="muted pst__mini"
                    title="Interactions = réactions + commentaires + partages, rapportées à l’habitude de chaque compte · des tendances, pas des preuves."
                  >
                    D’après {s.reco.comparees} publications comparées sur {s.reco.publications} ({s.reco.comptesCompares} comptes, {dShort(s.reco.du)} → {dShort(s.reco.au)}) · analyse du {s.reco.le}.{' '}
                    <button type="button" className="pst__lien" onClick={() => analyserReco(true)}>
                      Relire maintenant
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="pst__corps">
        {/* ================= FORMULAIRE ================= */}
        <div className="pst__form">
          {/* 1 · Type */}
          <section className="card pst__carte">
            <span className="pst__etiquette">1 · Type de post</span>
            <div className="pst__puces">
              {POST_TYPES.map((n) => (
                <button key={n} type="button" className={`pst__puce${s.type === n ? ' is-on' : ''}`} aria-pressed={s.type === n} disabled={locked} onClick={() => put({ type: n })}>
                  {n}
                </button>
              ))}
            </div>
          </section>

          {/* 2 · Catalogue */}
          <section className="card pst__carte">
            <div className="pst__ligne">
              <span className="pst__etiquette">2 · Produit, catégorie ou gamme du catalogue</span>
              {seg(
                [
                  ['cat', 'Par catégorie'],
                  ['gamme', 'Par gamme'],
                ],
                s.navMode,
                (k) => put({ navMode: k, navQ: '' }),
              )}
            </div>
            <div className="pst__ligne pst__ligne--gauche">
              <input
                type="search"
                className="pst__champ pst__grow"
                value={s.navQ}
                onChange={(e) => put({ navQ: e.target.value })}
                placeholder={nav ? `Rechercher parmi ${P.length} produits, ${C.length} sous-catégories et ${GA.length} gammes…` : 'Rechercher dans le catalogue…'}
              />
              <span className={`chip pst__chip${prixShop || pbLus ? ' is-ruby' : ''}`}>
                {prixShop ? `Prix de vente : ${shopNom}` : tRes.length > 1 ? 'Plusieurs boutiques : le prix de chacune' : 'Aucune boutique : pas de prix'}
              </span>
            </div>
            <div className="pst__fil">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1
                return (
                  <Fragment key={i}>
                    <button type="button" className={`pst__fil-pas${last ? ' is-fin' : ''}`} onClick={() => c.go?.()}>
                      {c.label}
                    </button>
                    {last ? null : <span className="pst__fil-sep">›</span>}
                  </Fragment>
                )
              })}
              {pick && !locked ? (
                <button type="button" className="btn btn--sm pst__droite" onClick={pick.fn}>
                  {pick.label}
                </button>
              ) : null}
            </div>
            {s.navLoading && !nav ? <span className="muted pst__petit">Lecture du catalogue du webshop…</span> : null}
            {s.navErr ? <span className="pst__petit is-alerte">{s.navErr}</span> : null}
            <div className="pst__tuiles">
              {tiles.map((tl, i) => (
                <button key={i} type="button" className={`pst__tuile${tl.on ? ' is-on' : ''}`} title={tl.tip} onClick={tl.open}>
                  <span className="pst__tuile-img">
                    {tl.image ? (
                      <img src={imageSocial(tl.image)} alt="" loading="lazy" style={{ opacity: tl.pale ? 0.55 : 1 }} />
                    ) : (
                      <span className="pst__tuile-ini">{(tl.name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="pst__tuile-kind">{tl.kind}</span>
                    {tl.badge ? <span className="pst__tuile-badge">{tl.badge}</span> : null}
                  </span>
                  <span className="pst__tuile-texte">
                    <span>{tl.name}</span>
                    <span className={tl.prix ? 'is-ruby' : 'muted'}>{tl.meta}</span>
                  </span>
                </button>
              ))}
            </div>
            {sel ? (
              <div className="pst__choisi">
                <div className="pst__choisi-tete">
                  <span className="pst__vignette">{sel.image ? <img src={imageSocial(sel.image)} alt="" /> : null}</span>
                  <span className="pst__choisi-nom">
                    <span className="pst__kind">{KIND[sel.kind] || ''}</span>
                    <span>{sel.name}</span>
                    <span className={selPrixFort ? 'is-ruby' : 'muted'}>{selPrix}</span>
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => !locked && put({ navSel: null })}>
                    Retirer
                  </button>
                </div>
                <div className="pst__ligne">
                  <span className="pst__etiquette">Promotions, bundles et formules liés</span>
                  <label className="pst__case" title="« Utiliser » ajoute au texte la mention tirée de l'API : dates et boutiques de l'offre">
                    <input type="checkbox" checked={s.mentionAuto !== false} disabled={locked} onChange={(e) => put({ mentionAuto: e.target.checked })} />
                    Ajouter la mention (dates, boutiques)
                  </label>
                </div>
                {s.offresLoading ? <span className="muted pst__petit">Lecture des promotions…</span> : null}
                {!s.offresLoading && !offres.length ? (
                  <span className="muted pst__petit">{O.erreur ? `Promotions illisibles : ${O.erreur}` : `Aucune promotion, aucun bundle ni formule lié${shopNom ? ` à ${shopNom}` : ''}.`}</span>
                ) : null}
                {offres.map((of) => (
                  <div key={of.k} className={`pst__offre${of.pale ? ' is-pale' : ''}`}>
                    <span className={`pst__tag ${of.cls}`}>{of.tag}</span>
                    <span className="pst__offre-texte">
                      <span>{of.libelle}</span>
                      <span className={of.alerte ? 'is-moyen' : 'muted'}>{of.note}</span>
                    </span>
                    <button type="button" className="btn btn--sm" title="Poser ce prix ou cette promotion sur la photo, en texte (typo et couleurs de la marque)" onClick={of.poser}>
                      Sur le visuel
                    </button>
                    <button type="button" className={`btn btn--sm${of.used ? ' pst__fait' : ''}`} onClick={of.use}>
                      {of.used ? 'Dans le post ✓' : 'Utiliser'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* 3 · Visuel */}
          <section className="card pst__carte">
            <div className="pst__ligne">
              <span className="pst__etiquette">3 · Visuel</span>
              {seg(
                modes.map(([k, l, tip]) => [k, l, tip] as [Mode, string, string]),
                s.mode,
                (k) => !locked && put({ mode: k }),
              )}
            </div>

            {/* Photos */}
            <div className="pst__bloc">
              <span className="pst__libelle" title={photosLabel[1]}>
                {photosLabel[0]}
              </span>
              <div className="pst__photos">
                {s.photos.map((p, i) => (
                  <div
                    key={`${i}-${p.src.slice(-24)}`}
                    className={`pst__photo${i === 0 ? ' is-premiere' : ''}`}
                    title="Cliquer pour la mettre en n°1"
                    onClick={() => {
                      if (locked || i === 0) return
                      const l = s.photos.slice()
                      const [x] = l.splice(i, 1)
                      l.unshift(x)
                      put({ photos: l })
                    }}
                  >
                    <img src={imageSocial(p.src)} alt="" />
                    <span className="pst__photo-n">{i + 1}</span>
                    {!locked ? (
                      <button
                        type="button"
                        className="pst__photo-x"
                        title="Retirer"
                        onClick={(e) => {
                          e.stopPropagation()
                          put({ photos: s.photos.filter((_, j) => j !== i) })
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                    {!locked && ia.detourage ? (
                      <button
                        type="button"
                        className="pst__photo-cut"
                        title={p.cut && /^data:image\/png/.test(p.src) ? 'Photo détourée · cliquer pour la détourer à nouveau' : 'Détourer cette photo (fond retiré)'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void detourerPhoto(p.src)
                        }}
                      >
                        {s.cutBusy === p.src ? '…' : '✂'}
                      </button>
                    ) : null}
                  </div>
                ))}
                {s.video ? (
                  <>
                    <div className="pst__photo pst__photo--video">
                      ▶<span>{s.video.name}</span>
                      <button type="button" className="pst__photo-x is-clair" title="Retirer la vidéo" onClick={() => put({ video: null })}>
                        ×
                      </button>
                    </div>
                    <div className="pst__video-format">
                      {seg(
                        [
                          ['video', 'Vidéo'],
                          ['reel', 'Reel'],
                        ],
                        s.videoFormat,
                        (k) => put({ videoFormat: k }),
                      )}
                      <span className="pst__tech">{s.videoFormat === 'reel' ? 'POST /{page_id}/video_reels · upload_phase=start → upload → finish (video_state=PUBLISHED)' : 'POST /{page_id}/videos · file_url, title, description'}</span>
                    </div>
                  </>
                ) : null}
                {!locked ? (
                  <>
                    <button type="button" className="pst__depot" onClick={() => put({ libOpen: true })}>
                      Médiathèque<span className="muted">{s.lib.length} visuels</span>
                    </button>
                    <label className="pst__depot">
                      Importer<span className="muted">photos ou vidéo</span>
                      {fichiers('image/*,video/*', true, async (fl) => {
                        const vid = fl.find((f) => /^video\//.test(f.type))
                        const add = (await Promise.all(fl.filter((f) => /^image\//.test(f.type)).slice(0, 12).map(lirePhoto))).filter((x): x is NonNullable<typeof x> => !!x)
                        if (add.length) put((st) => ({ photos: st.photos.concat(add) }))
                        if (vid) choisirVideo(await lireVideo(vid))
                      })}
                    </label>
                    <button type="button" className="pst__depot pst__depot--plein" title="Retirer toutes les photos du post" onClick={() => put({ photos: [] })}>
                      Vider
                    </button>
                    {/* Une vidéo s'ajoute dans tous les modes : le post passe alors en « Photos telles quelles ». */}
                    <label className="pst__depot" title={s.mode === 'brut' ? 'Ajouter une vidéo (MP4, 45 Mo au plus)' : 'Ajouter une vidéo : le post passera en « Photos telles quelles »'}>
                      Vidéo<span className="muted">MP4 · 60 s</span>
                      {fichiers('video/*', false, async (fl) => {
                        if (fl[0]) choisirVideo(await lireVideo(fl[0]))
                      })}
                    </label>
                  </>
                ) : null}
              </div>
            </div>

            {/* Zoom et cadrage de chaque photo dans sa case du gabarit */}
            {s.mode === 'studio' && !locked && s.photos.length ? (
              <div className="pst__panneau">
                <span className="pst__etiquette" title="Zoom 50 – 300 % · ↔ ↕ cadrage · photo par photo">
                  Ajuster les photos dans le gabarit
                </span>
                {s.photos.map((ph, i) => {
                  const z = Math.round((ph.zoom || 1) * 100)
                  const x = ph.x != null ? ph.x : 50
                  const y = ph.y != null ? ph.y : 50
                  const putP = (patch: Partial<PhotoPost>) => put((st) => ({ photos: st.photos.map((qq, j) => (j === i ? { ...qq, ...patch } : qq)) }))
                  const zoomTo = (pc: number) => putP({ zoom: Math.min(300, Math.max(50, pc)) / 100 })
                  return (
                    <div key={i} className="pst__ajuste">
                      <span>{i + 1}</span>
                      <img src={imageSocial(ph.src)} alt="" />
                      <span className="pst__ajuste-zoom">
                        <button type="button" className="btn btn--sm btn--icon" title="Dézoomer" onClick={() => zoomTo(z - 10)}>
                          −
                        </button>
                        {rangee({ min: 50, max: 300, step: 5, value: z, onChange: zoomTo, title: 'Zoom' })}
                        <button type="button" className="btn btn--sm btn--icon" title="Zoomer" onClick={() => zoomTo(z + 10)}>
                          +
                        </button>
                        <span className="pst__num">{z} %</span>
                      </span>
                      <label title="Cadrage horizontal">↔{rangee({ min: 0, max: 100, value: x, onChange: (n) => putP({ x: n }) })}</label>
                      <label title="Cadrage vertical">↕{rangee({ min: 0, max: 100, value: y, onChange: (n) => putP({ y: n }) })}</label>
                      <button type="button" className="btn btn--ghost btn--sm btn--icon" title="Revenir à 100 %, centré" onClick={() => putP({ zoom: 1, x: 50, y: 50 })}>
                        ⟲
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* Recherche dans la médiathèque */}
            {!locked ? (
              <div className="pst__panneau">
                <div className="pst__ligne">
                  <span className="pst__etiquette">Rechercher dans la médiathèque</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => put({ libOpen: true })}>
                    Gérer
                  </button>
                </div>
                <input type="search" className="pst__champ" value={s.query} onChange={(e) => put({ query: e.target.value })} placeholder="Nom, catégorie, saison…" />
                <div className="pst__ligne pst__ligne--gauche">
                  <select className="pst__grow" value={s.fCat} onChange={(e) => put({ fCat: e.target.value })} aria-label="Catégorie">
                    <option value="">Toutes catégories</option>
                    {Object.keys(CATS).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select className="pst__grow" value={s.fSeason} onChange={(e) => put({ fSeason: e.target.value })} aria-label="Saison">
                    <option value="">Toutes saisons</option>
                    {SAISONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pst__resultats">
                  {found.slice(0, 40).map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className={`pst__resultat${inPost(it) ? ' is-on' : ''}`}
                      title={`${estVid(it) ? 'Vidéo · ' : ''}${it.name} · ${tagsLib(it)} — cliquer pour l’ajouter ou le retirer du post`}
                      onClick={() => togglePost(it)}
                    >
                      <img src={vign(it)} alt="" />
                      {estVid(it) ? <span className="pst__resultat-video">▶ vidéo</span> : null}
                      {inPost(it) ? <span className="pst__coche">✓</span> : null}
                    </button>
                  ))}
                </div>
                <span className="muted pst__petit">
                  {found.length}
                  {found.length > 1 ? ' visuels' : ' visuel'}
                </span>
              </div>
            ) : null}

            {s.mode === 'studio' ? (
              <>
                {/* Modèles de visuel complets (style, format, fond, logo, illustration, textes posés) */}
                <div className="pst__bloc">
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle">Modèles de visuel</span>
                    {VM.map((m) => (
                      <span key={m.id} className="pst__jeton">
                        <button
                          type="button"
                          title="Appliquer ce modèle (le produit, le prix et la photo restent ceux du post)"
                          onClick={() => {
                            if (locked) return
                            V({ ...m.v })
                            toast(`Modèle « ${m.nom} » appliqué : le produit, le prix et la photo restent ceux du post.`)
                          }}
                        >
                          {m.nom}
                        </button>
                        <button type="button" title="Supprimer ce modèle" onClick={() => !locked && garderParametre('visuels_modeles', VM.filter((x) => x.id !== m.id), `Modèle « ${m.nom} » supprimé.`)}>
                          ×
                        </button>
                      </span>
                    ))}
                    {!VM.length ? <span className="muted pst__petit">aucun pour l’instant</span> : null}
                  </div>
                  <div className="pst__ligne pst__ligne--gauche">
                    {champ(s.visNom, (x) => put({ visNom: x }), 'Nom du modèle (ex. Promo du mois)', { className: 'pst__champ pst__grow' })}
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={locked || !String(s.visNom || '').trim()}
                      onClick={() => {
                        const nom = String(s.visNom || '').trim()
                        if (!nom || locked) return
                        const w: Record<string, unknown> = {}
                        CLES_MODELE.forEach((k) => {
                          if (v[k] !== undefined) w[k] = v[k]
                        })
                        garderParametre('visuels_modeles', VM.concat({ id: `v${Date.now().toString(36)}`, nom, v: w as Partial<Visuel> }), `Visuel enregistré comme modèle « ${nom} » : réutilisable pour les prochains posts.`, () =>
                          put({ visNom: '' }),
                        )
                      }}
                    >
                      Enregistrer ce visuel comme modèle
                    </button>
                    <button type="button" className={`btn btn--sm pst__droite${s.kitBusy ? ' is-busy' : ''}`} onClick={() => void kitTelecharger()}>
                      {s.kitBusy ? 'Préparation du kit…' : 'Télécharger le kit (4 formats)'}
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${s.vidBusy ? ' is-busy' : ''}`}
                      disabled={locked}
                      title="Le visuel en story 9:16, animé (fondu et léger zoom, 6 s) : vidéo pour un reel ou une story"
                      onClick={() => !locked && void videoAnimee()}
                    >
                      {s.vidBusy ? 'Vidéo en cours (6 s)…' : s.vidAnim ? 'Refaire la vidéo animée' : 'Vidéo animée (9:16)'}
                    </button>
                  </div>
                  {s.vidAnim ? (
                    <div className="pst__vidanim">
                      <video src={s.vidAnim.src} controls muted loop playsInline />
                      <div className="pst__vidanim-texte">
                        <span>
                          Vidéo animée · {s.vidAnim.h264 ? 'MP4 H.264' : s.vidAnim.type === 'video/mp4' ? 'MP4 (VP9)' : 'WebM'} · 1080 × 1920 · 6 s · {(s.vidAnim.taille / 1048576).toFixed(1).replace('.', ',')} Mo
                        </span>
                        <label
                          className="pst__case"
                          title="Le post garde l’image comme vignette. Instagram la publie en reel (vidéo sans son), Facebook en vidéo ; si Instagram refuse le fichier, le post le signale."
                        >
                          <input
                            type="checkbox"
                            checked={!!s.vidAnim.publier}
                            disabled={locked || !s.vidAnim.h264}
                            onChange={(e) => put((st) => ({ vidAnim: st.vidAnim ? { ...st.vidAnim, publier: e.target.checked } : null }))}
                          />
                          Publier la vidéo à la place de l’image (reel Instagram, vidéo Facebook)
                        </label>
                        {!s.vidAnim.h264 ? (
                          <span className="pst__petit is-moyen">
                            Ce navigateur n’enregistre pas en H.264, le codec que Meta exige pour un reel : téléchargez-la (story déposée à la main), ou refaites-la depuis Chrome ou Edge à jour.
                          </span>
                        ) : null}
                        <div className="pst__ligne pst__ligne--gauche">
                          <a className="btn btn--sm" href={s.vidAnim.src} download={`${nomFichier(v.title)}-anime.${s.vidAnim.type === 'video/mp4' ? 'mp4' : 'webm'}`}>
                            Télécharger
                          </a>
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => put({ vidAnim: null })}>
                            Retirer
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Recadrage : le format du visuel, fixé ici plutôt que par Facebook */}
                <div className="pst__ligne pst__ligne--gauche">
                  <span className="pst__libelle">Recadrage · format du visuel</span>
                  {seg(
                    FORMATS_V.map(([k, l, tip]) => [k, l, tip] as [string, string, string]),
                    v.format || 'carre',
                    (k) => !locked && V({ format: k }),
                  )}
                </div>

                {/* Contrôle qualité du visuel */}
                <div className="pst__controle">
                  <span className="pst__sous-titre">Contrôle du visuel</span>
                  {!s.qc.length ? <span className="pst__petit is-bon">✓ Rien à signaler : textes lisibles, dans le cadre et hors des zones recadrées.</span> : null}
                  {s.qc.map((qq, i) => (
                    <span key={i} className={`pst__qc ${QC[qq.niveau]}`}>
                      <span>{QCI[qq.niveau]}</span>
                      <span>{qq.msg}</span>
                    </span>
                  ))}
                </div>

                {/* Fond : palette du design system de la marque */}
                <div className="pst__bloc">
                  <span
                    className="pst__libelle"
                    title={ton === 'fonce' ? 'Style foncé : fonds foncés de la marque (texte clair).' : 'Style clair : fonds clairs de la marque (texte foncé). Pour un fond foncé, prenez Ruby, Noir, Encadré ou Nuit.'}
                  >
                    Fond · palette de la marque
                  </span>
                  {ton && fondsTon.length ? (
                    <div className="pst__fonds">
                      {[{ id: null as string | null, nom: 'Fond du style', hex: 'transparent' }].concat(fondsTon).map((f) => (
                        <button key={f.id ?? 'style'} type="button" className={`pst__fond${(fondCur || null) === f.id ? ' is-on' : ''}`} title={f.nom} onClick={() => !locked && V({ fond: f.id })}>
                          <span className={f.id ? '' : 'is-style'} style={{ background: f.hex }}>
                            {f.id ? '' : 'Style'}
                          </span>
                          <span>{f.nom}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!ton ? <span className="muted pst__petit">Plein cadre : le fond est la photo.</span> : null}
                  {PLEINS_FONDU.includes(v.style) ? (
                    <label className="pst__curseur" title="0 % : photo sans dégradé · 100 % : dégradé le plus sombre (texte le plus lisible).">
                      Fondu sur la photo
                      {rangee({ min: 0, max: 100, step: 5, value: v.fondu != null ? v.fondu : 60, onChange: (n) => V({ fondu: n }) })}
                      <span className="pst__num">{v.fondu != null ? v.fondu : 60} %</span>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={locked} title="Revenir au fondu d’origine (60 %)" onClick={() => V({ fondu: 60 })}>
                        60 %
                      </button>
                    </label>
                  ) : null}
                </div>

                {/* Logo : version d'origine (foncé, clair) ou recolorée dans la palette */}
                <div className="pst__bloc">
                  <span className="pst__libelle">Logo</span>
                  <div className="pst__logos">
                    {LOGOS.map((L) => (
                      <button key={L.id} type="button" className={`pst__logo${(v.logo || 'auto') === L.id ? ' is-on' : ''}`} title={L.nom} onClick={() => !locked && V({ logo: L.id })}>
                        <span style={{ background: L.apercu || '#FFFFFF' }}>
                          {L.src ? <img src={L.src} alt="" /> : null}
                          {L.hex ? <i style={{ background: L.hex, WebkitMask: `url('${ASSET}img/logo-white.png') center/contain no-repeat`, mask: `url('${ASSET}img/logo-white.png') center/contain no-repeat` }} /> : null}
                          {L.id === 'auto' ? <em>auto</em> : null}
                        </span>
                        <span>{L.nom}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Illustration : un dessin du design system posé sur le visuel */}
                <div className="pst__bloc">
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle">Illustration · design system</span>
                    <button type="button" className="btn btn--sm" disabled={locked} onClick={() => !locked && put({ illusOpen: !s.illusOpen })}>
                      {s.illusOpen ? 'Fermer le choix' : il ? 'Changer d’illustration' : 'Ajouter une illustration'}
                    </button>
                    {il ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={locked} onClick={() => !locked && V({ illus: null })}>
                        Retirer
                      </button>
                    ) : null}
                  </div>
                  {s.illusOpen && !locked ? (
                    <div className="pst__panneau">
                      {seg(
                        illusSubs.map((x) => [x, x] as [string, string]),
                        illusSub,
                        (k) => put({ illusCat: k }),
                      )}
                      <div className="pst__illus">
                        {illusAll
                          .filter((x) => x.sub === illusSub)
                          .map((x) => (
                            <button key={x.id} type="button" className={`pst__illu${il && il.src === x.src ? ' is-on' : ''}`} title={x.name} onClick={() => putIllus({ src: x.src, name: x.name })}>
                              <img src={imageSocial(x.src)} alt={x.name} />
                            </button>
                          ))}
                        {!illusAll.length ? <span className="muted pst__petit">Illustrations du design system indisponibles.</span> : null}
                      </div>
                    </div>
                  ) : null}
                  {il ? (
                    <>
                      <div className="pst__ligne pst__ligne--gauche pst__ligne--haut">
                        <span className="pst__vignette" title={il.name || 'Illustration'}>
                          <img src={imageSocial(il.src)} alt="" />
                        </span>
                        <div className="pst__positions" title="Position">
                          {POS_ILL.map(([lab, x, y]) => (
                            <button key={lab} type="button" className={+(il.x ?? -1) === x && +(il.y ?? -1) === y ? 'is-on' : ''} disabled={locked} onClick={() => putIllus({ x, y })}>
                              {lab}
                            </button>
                          ))}
                        </div>
                        <div className="pst__curseurs">
                          <label>↔{rangee({ min: 0, max: 100, value: il.x != null ? il.x : 82, onChange: (n) => putIllus({ x: n }) })}</label>
                          <label>↕{rangee({ min: 0, max: 100, value: il.y != null ? il.y : 18, onChange: (n) => putIllus({ y: n }) })}</label>
                          <label>
                            Taille{rangee({ min: 5, max: 80, value: il.taille != null ? il.taille : 28, onChange: (n) => putIllus({ taille: n }) })}
                            <span className="pst__num">{il.taille != null ? il.taille : 28} %</span>
                          </label>
                        </div>
                      </div>
                      <div className="pst__ligne pst__ligne--gauche">
                        <span className="muted pst__petit">Trait :</span>
                        {[{ id: 'auto', nom: 'Auto', hex: null as string | null }].concat(TRAITS).map((tr) => (
                          <button key={tr.id} type="button" className={`pst__puce pst__puce--sm${(il.trait || 'auto') === tr.id ? ' is-on' : ''}`} title={tr.nom} disabled={locked} onClick={() => putIllus({ trait: tr.id })}>
                            {tr.hex ? <i className="pst__rond" style={{ background: tr.hex }} /> : null}
                            {tr.nom}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Textes posés sur le visuel : promotion, formule ou prix, dans la typo et les couleurs de la marque */}
                <div className="pst__bloc">
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle" title="Chaque texte se réécrit : champ ci-dessous, ou double-clic sur le texte dans l'aperçu ; il se glisse aussi directement sur l'aperçu.">
                      Textes sur le visuel
                    </span>
                    {ts.map((x) => {
                      const on = x.id === s.txtSel
                      return (
                        <span key={x.id} className={`pst__jeton${on ? ' is-on' : ''}`}>
                          <button type="button" onClick={() => put({ txtSel: on ? null : x.id })}>
                            {String(x.txt || x.sous || 'Texte').slice(0, 26)}
                          </button>
                          <button type="button" title="Effacer ce texte du visuel" disabled={locked} onClick={() => !locked && effacerTexte(x.id)}>
                            ×
                          </button>
                        </span>
                      )
                    })}
                    <button type="button" className="btn btn--sm" disabled={locked} onClick={() => !locked && poserTexte(String(v.promo || '').trim() || 'Nouveau', '')}>
                      + Texte
                    </button>
                  </div>
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="muted pst__petit">Modèles :</span>
                    {EM.map((m) => {
                      const Pm = POLICES.find((p) => p.id === m.police)
                      return (
                        <span key={m.id} className="pst__modele-etq">
                          <button
                            type="button"
                            title="Appliquer ce modèle"
                            style={{
                              background: hexFond(m.forme === 'texte' ? null : m.fond) || '#FFFFFF',
                              color: hexFond(m.couleur) || '#1c1a17',
                              fontFamily: Pm?.font || "'Studio Gotham'",
                              textTransform: (Pm?.tt || 'none') as 'none',
                              borderRadius: m.forme === 'bandeau' ? '2px' : '6px',
                              border: m.forme === 'texte' || m.fond === 'blanc' || m.fond === 'creme' ? '1px solid #e6e0d8' : '1px solid transparent',
                            }}
                            onClick={() => {
                              if (locked) return
                              etqDernier.current = m.id
                              if (txtSel) updTxt(pickEtq(m))
                              else poserTexte(String(v.promo || '').trim() || m.nom, '')
                            }}
                          >
                            {m.nom}
                          </button>
                          {!m.ds && !locked ? (
                            <button type="button" className="pst__x" title="Supprimer ce modèle" onClick={() => garderEtq(EM.filter((x) => !x.ds && x.id !== m.id), `Modèle « ${m.nom} » supprimé.`)}>
                              ×
                            </button>
                          ) : null}
                        </span>
                      )
                    })}
                  </div>
                  {txtSel ? (
                    <div className="pst__panneau">
                      <div className="pst__ligne pst__ligne--gauche">
                        <input
                          ref={txtIn}
                          type="text"
                          className="pst__champ pst__grow"
                          value={txtSel.txt || ''}
                          disabled={locked}
                          placeholder="Texte (ex. −1,40 €, 13,00 €, 2+1)"
                          onChange={(e) => updTxt({ txt: e.target.value })}
                        />
                        {champ(txtSel.sous || '', (x) => updTxt({ sous: x }), 'Sous-texte (facultatif)', { className: 'pst__champ pst__grow' })}
                      </div>
                      <div className="pst__bloc">
                        <span className="pst__libelle" title="Modifiable ; sélectionnez un passage puis « → Texte » ou « → Sous-texte » pour le badge.">
                          Texte de l’offre
                        </span>
                        {O.promotions.length || O.formules.length ? (
                          <div className="pst__puces">
                            {O.promotions
                              .map((x) => ({ tag: (TAG[x.type ?? ''] || TAG.offre)[0], txt: x.libelle }))
                              .concat(O.formules.map((f) => ({ tag: 'Formule', txt: f.libelle })))
                              .filter((o) => o.txt)
                              .map((o, i) => (
                                <button key={i} type="button" title={o.txt} className={`pst__puce pst__puce--sm pst__coupe${txtSel.source === o.txt ? ' is-on' : ''}`} onClick={() => updTxt({ source: o.txt })}>
                                  {o.tag} · {o.txt.length > 46 ? `${o.txt.slice(0, 45)}…` : o.txt}
                                </button>
                              ))}
                          </div>
                        ) : null}
                        <div className="pst__ligne pst__ligne--gauche pst__ligne--haut">
                          <textarea
                            ref={srcIn}
                            rows={2}
                            className="pst__champ pst__grow"
                            value={txtSel.source || ''}
                            disabled={locked}
                            placeholder="Le libellé de la promotion, du bundle ou de la formule (choisissez une offre ci-dessus, ou écrivez)"
                            onChange={(e) => updTxt({ source: e.target.value })}
                          />
                          <div className="pst__colonne">
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={locked}
                              onClick={() => {
                                const x = passageOffre(txtSel)
                                if (x) updTxt({ txt: x })
                              }}
                            >
                              → Texte
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={locked}
                              onClick={() => {
                                const x = passageOffre(txtSel)
                                if (x) updTxt({ sous: x })
                              }}
                            >
                              → Sous-texte
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="pst__reglage">
                        <span className="muted">Forme</span>
                        {seg(
                          FORMES.map((f) => [f.id, f.nom] as [string, string]),
                          txtSel.forme || 'etiquette',
                          (k) => updTxt({ forme: k }),
                          locked,
                        )}
                      </div>
                      <div className="pst__reglage">
                        <span className="muted">Police</span>
                        {POLICES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            title={p.detail}
                            className={`pst__police${txtSel.police === p.id ? ' is-on' : ''}`}
                            style={{ fontFamily: p.font, fontWeight: p.weight, textTransform: p.tt as 'none' }}
                            disabled={locked}
                            onClick={() => updTxt({ police: p.id })}
                          >
                            {p.nom}
                          </button>
                        ))}
                      </div>
                      <div className="pst__reglage">
                        <span className="muted">Texte</span>
                        {FONDS.map((f) => (
                          <button key={f.id} type="button" title={f.nom} className={`pst__pastille${txtSel.couleur === f.id ? ' is-on' : ''}`} style={{ background: f.hex }} disabled={locked} onClick={() => updTxt({ couleur: f.id })} />
                        ))}
                      </div>
                      <div className="pst__reglage">
                        <span className="muted">Fond</span>
                        {[{ id: null as string | null, nom: 'Aucun', hex: 'transparent' }].concat(FONDS).map((f) => (
                          <button
                            key={f.id ?? 'aucun'}
                            type="button"
                            title={f.nom}
                            className={`pst__pastille${(txtSel.fond || null) === f.id ? ' is-on' : ''}`}
                            style={{ background: f.hex }}
                            disabled={locked}
                            onClick={() => updTxt({ fond: f.id })}
                          >
                            {f.id ? '' : '∅'}
                          </button>
                        ))}
                        {txtSel.forme === 'texte' ? <span className="pst__petit is-moyen">Texte seul : pas de fond (choisissez Étiquette, Pastille ou Bandeau pour un fond).</span> : null}
                      </div>
                      <div className="pst__ligne pst__ligne--gauche pst__ligne--haut">
                        <div className="pst__positions" title="Position">
                          {POS_TXT.map(([lab, x, y]) => (
                            <button key={lab} type="button" className={+(txtSel.x ?? -1) === x && +(txtSel.y ?? -1) === y ? 'is-on' : ''} disabled={locked} onClick={() => updTxt({ x, y })}>
                              {lab}
                            </button>
                          ))}
                        </div>
                        <div className="pst__curseurs" title="Le texte se glisse aussi directement sur l’aperçu.">
                          <label>
                            Taille{rangee({ min: 20, max: 200, value: +(txtSel.taille ?? 0) || 56, onChange: (n) => updTxt({ taille: n }) })}
                            <span className="pst__num">{+(txtSel.taille ?? 0) || 56} px</span>
                          </label>
                          <label>
                            Rotation{rangee({ min: -30, max: 30, value: +(txtSel.rot ?? 0) || 0, onChange: (n) => updTxt({ rot: n }) })}
                            <span className="pst__num">{+(txtSel.rot ?? 0) || 0}°</span>
                          </label>
                        </div>
                      </div>
                      <div className="pst__ligne pst__ligne--gauche pst__ligne--filet">
                        {champ(s.txtTplNom, (x) => put({ txtTplNom: x }), 'Nom du modèle (ex. Promo cookies)', { className: 'pst__champ pst__grow' })}
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={!canTplSave}
                          onClick={() => {
                            const nom = String(s.txtTplNom || '').trim()
                            if (!txtSel || !nom) return
                            const m: ModeleEtiquette = { ...pickEtq({ ...txtSel, nom }), id: `m${Date.now().toString(36)}`, nom }
                            etqDernier.current = m.id
                            garderEtq(EM.filter((x) => !x.ds).concat(m), `Modèle d’étiquette « ${nom} » enregistré : il est proposé pour les prochains posts.`)
                          }}
                        >
                          Enregistrer comme modèle
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm pst__droite"
                          disabled={locked}
                          onClick={() => {
                            if (!locked && txtSel) {
                              V({ textes: ts.filter((x) => x.id !== txtSel.id) })
                              put({ txtSel: null })
                            }
                          }}
                        >
                          Supprimer ce texte
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Style */}
                <div className="pst__bloc">
                  <div className="pst__ligne">
                    <span className="pst__libelle">Style · photo unique</span>
                    {seg(
                      [
                        ['auto', 'Auto'],
                        ['cut', 'Détourées'],
                        ['full', 'Pleines'],
                      ],
                      v.cutMode,
                      (k) => V({ cutMode: k }),
                    )}
                  </div>
                  {vignettesStyles1(VS)}
                  <span className="pst__libelle" title="Photo 1 → case 1, photo 2 → case 2…">
                    Style · montage
                  </span>
                  {vignettesStyles2(VS)}
                </div>

                {/* Textes du visuel */}
                <div className="pst__bloc pst__bloc--filet">
                  <div className="pst__ligne">
                    <span className="pst__libelle" title="Cochez un texte pour l’afficher sur le visuel.">
                      Textes sur le visuel · {isNlEd ? 'version néerlandaise' : 'version française'}
                    </span>
                    {langTabs}
                  </div>
                  {isNlEd && !locked ? (
                    <button
                      type="button"
                      className="btn btn--sm pst__gauche"
                      onClick={() => V({ nl: { ...v.nl, ...Object.fromEntries(LOC.map((k) => [k, v.nl?.[k] || String(v[k] ?? '')])) } })}
                    >
                      Partir des textes FR
                    </button>
                  ) : null}
                  <div className="pst__champs-visuel">
                    {vFields.map((f) => (
                      <div key={f.label} className="pst__champ-visuel">
                        <input type="checkbox" checked={!!v[f.show]} disabled={locked} aria-label={f.label} onChange={() => V({ [f.show]: !v[f.show] } as Partial<Visuel>)} />
                        {f.isLabel ? (
                          <span>{f.label}</span>
                        ) : (
                          champ(gv(f.key), (x) => sv(f.key, x), isNlEd && (LOC as readonly string[]).includes(f.key) ? `${f.label} (NL)` : f.label, { className: 'pst__champ pst__grow' })
                        )}
                        {f.c1 ?? null}
                        {f.second ? (
                          <>
                            {champ(gv(f.second.key), (x) => sv(f.second!.key, x), f.second.label, { className: 'pst__champ pst__grow' })}
                            {f.second.c2}
                          </>
                        ) : null}
                      </div>
                    ))}
                    {/* Plusieurs boutiques : le prix de chacune, lu dans TFBuddy ; un visuel par prix à la publication. */}
                    {pbShow ? (
                      <div className="pst__panneau">
                        <span className="pst__sous-titre">{pbTitre}</span>
                        <div className="pst__puces">
                          {pbLus
                            ? tRes.map((id) => {
                                const on = gPrix.length > 0 && s.pbApercu === id
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    className={`pst__puce pst__puce--sm${on ? ' is-on' : ''}${pbLus[id] == null ? ' is-pale' : ''}`}
                                    title={pbLus[id] != null ? `Voir le visuel de ${nomDe(id)}` : `Prix non renseigné dans TFBuddy : le visuel de ${nomDe(id)} part sans prix`}
                                    onClick={() => gPrix.length && put({ pbApercu: id, pvShop: id })}
                                  >
                                    {nomDe(id)} · {pbLus[id] != null ? eur(pbLus[id], 2) : 'sans prix'}
                                  </button>
                                )
                              })
                            : null}
                        </div>
                        {pbNote ? <span className="muted pst__petit">{pbNote}</span> : null}
                      </div>
                    ) : null}
                  </div>
                  {palette(false)}
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle">Phrase</span>
                    {seg(
                      PHRASES.map(([k, l, fam]) => [k, <span key={k} style={{ fontFamily: fam }}>{l}</span>] as [string, ReactNode]),
                      v.phraseFont,
                      (k) => V({ phraseFont: k }),
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {/* Montages Instagram : carrousel panoramique, collage 4:5, frise */}
            {estMontage(s.mode) ? (
              <div className="pst__bloc pst__bloc--filet">
                {isPano ? (
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle">Nombre d’images à faire glisser</span>
                    {seg(
                      [2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => [String(k), String(k)] as [string, string]),
                      String(s.m.n),
                      (k) => setM({ n: Number(k) }),
                    )}
                  </div>
                ) : null}
                {isCollage ? (
                  <div className="pst__ligne pst__ligne--gauche">
                    <span className="pst__libelle">Gabarit</span>
                    <div className="pst__puces">
                      {Montages.TEMPLATES.map(([k, name, slots]) => (
                        <button key={k} type="button" className={`pst__puce${s.m.tpl === k ? ' is-on' : ''}`} onClick={() => setM({ tpl: k })}>
                          {name} <span className="muted">· {slots} photos</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <span className="pst__libelle" title={mHints.join('\n')}>
                  Textes incrustés dans l’image
                </span>
                <div className="pst__champs-montage">
                  {(
                    [
                      ['title', 'Titre', 'Ex. : Gamme automne'],
                      ...(isPano || isFrise ? [['band', 'Bandeau', 'Ex. : Brioche · tarte aux pommes · tartelette poire']] : []),
                      ['price', 'Prix (pastille)', 'Ex. : dès 3,60 €'],
                      ['sign', 'Signature', "L'Atelier By"],
                    ] as [keyof Montage, string, string][]
                  ).map(([key, label, ph]) => (
                    <label key={key} className="pst__champ-titre">
                      {label}
                      {champ(String(s.m[key] || ''), (x) => setM({ [key]: x } as Partial<Montage>), ph)}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* 4 · Ciblage */}
          <section className="card pst__carte">
            <div className="pst__ligne">
              <span className="pst__etiquette">4 · Ciblage et canaux</span>
              {seg(
                [
                  ['all', 'Tout le réseau'],
                  ['group', 'Groupe'],
                  ['shop', 'Boutique(s)'],
                ],
                s.scope,
                setScope,
                locked,
              )}
            </div>
            {/* Boutiques : une pastille on/off par boutique */}
            <div className="pst__puces">
              <span className="pst__etiquette">Boutiques</span>
              <button type="button" className={`pst__puce${tRes.length === SHOPS.length ? ' is-on' : ''}`} disabled={locked} onClick={() => setScope('all')}>
                Toutes
              </button>
              {SHOPS.concat(TESTS).map((sh) => {
                const on = t.includes(sh.id)
                const test = !!sh.test
                return (
                  <button
                    key={sh.id}
                    type="button"
                    className={`pst__boutique${on ? ' is-on' : ''}${test ? ' is-test' : ''}`}
                    disabled={locked}
                    aria-pressed={on}
                    title={
                      test
                        ? `Magasin test, hors du réseau : jamais compris dans « Toutes » — cliquer pour ${on ? 'le retirer' : 'publier aussi dessus'}`
                        : `${on ? 'Publié sur ' : 'Pas publié sur '}${sh.name} — cliquer pour ${on ? 'retirer' : 'ajouter'}`
                    }
                    onClick={() => toggleShop(sh.id)}
                  >
                    <span className="pst__boutique-rond">{on ? '✓' : ''}</span>
                    <span className={on ? '' : 'is-barre'}>
                      {sh.name}
                      {test ? ' (test)' : ''}
                    </span>
                  </button>
                )
              })}
              <span className="muted pst__petit">
                {tRes.length} / {SHOPS.length} boutique{SHOPS.length > 1 ? 's' : ''}
                {tTest.length ? ` + ${tTest.length} magasin${tTest.length > 1 ? 's' : ''} test` : ''}
              </span>
            </div>
            {s.scope === 'group' ? (
              <div className="pst__puces">
                {GROUPS.map((g) => (
                  <button key={g.id} type="button" className={`pst__puce${s.group === g.id ? ' is-on' : ''}`} onClick={() => put({ group: g.id, sel: g.shops.slice() })}>
                    {g.name} · {g.shops.length}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="pst__canaux">
              <div className="pst__canaux-tete">
                <span>Boutique</span>
                <span>Facebook</span>
                <span>Instagram</span>
                <span>État</span>
              </div>
              {/* La Page de la marque, cochée comme une boutique : le post part chez elle, puis le repost automatique le reprend */}
              <div className={`pst__canaux-ligne${s.marque ? ' is-on' : ''}`}>
                <label>
                  <input type="checkbox" checked={!!s.marque} disabled={locked} onChange={() => !locked && put({ marque: !s.marque })} />
                  Page de la marque · {String(brand.name || 'L’Atelier By')}
                </label>
                <label>
                  <input type="checkbox" checked={!!s.marque && !!s.ch.marque?.fb} disabled={locked || !s.marque || !brFbOk} onChange={() => setCanal('marque', 'fb')} />
                  Page
                </label>
                <label className={brIgOk ? '' : 'is-pale'}>
                  <input type="checkbox" checked={!!s.marque && !!s.ch.marque?.ig && brIgOk} disabled={locked || !s.marque || !brIgOk} onChange={() => setCanal('marque', 'ig')} />
                  Compte
                </label>
                <span className={brFbOk ? 'is-bon' : 'is-moyen'}>
                  {!brFbOk ? 'Page de la marque non connectée' : igUnique ? 'Puis repris par les boutiques · Compte = Instagram du réseau' : 'Puis repris par les boutiques (repost automatique)'}
                </span>
              </div>
              {SHOPS.concat(TESTS).map((sh) => {
                const live = parId(etat.shops, sh.id) || sh
                const on = t.includes(sh.id)
                const c = s.ch[sh.id] || {}
                const fbOk = live.fb === 'connected'
                const test = !!sh.test
                const igOk = live.igs === 'connected' && !(test && igUnique)
                const note = test
                  ? fbOk
                    ? `Magasin test · Page connectée${igUnique ? ' · pas l’Instagram du réseau' : ''}`
                    : 'Magasin test · Page non connectée'
                  : !fbOk
                    ? 'Page non connectée'
                    : !igOk
                      ? `Instagram : ${(CONN[String(live.igs ?? 'none')] ?? CONN.none).label?.toLowerCase() ?? ''}`
                      : 'Connecté'
                return (
                  <div key={sh.id} className={`pst__canaux-ligne${on ? ' is-on' : ''}${test ? ' is-test' : ''}`}>
                    <label>
                      <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleShop(sh.id)} />
                      {sh.name}
                      {test ? ' · magasin test' : ''}
                    </label>
                    <label>
                      <input type="checkbox" checked={on && !!c.fb} disabled={locked || !on || !fbOk} onChange={() => setCanal(sh.id, 'fb')} />
                      Page
                    </label>
                    <label className={igOk ? '' : 'is-pale'}>
                      <input type="checkbox" checked={on && !!c.ig && igOk} disabled={locked || !on || !igOk} onChange={() => setCanal(sh.id, 'ig')} />
                      Compte
                    </label>
                    <span className={!test && fbOk && igOk ? 'is-bon' : 'is-moyen'}>{note}</span>
                  </div>
                )
              })}
            </div>
            {igUnique ? (
              <span
                className="pst__note"
                title="Cocher Instagram pour une ou plusieurs boutiques publie le post une seule fois sur ce compte ; {ville} y devient la liste des boutiques visées."
              >
                Instagram : un seul compte pour tout le réseau ({igHandle}).
              </span>
            ) : null}
          </section>

          {/* 5 · Texte du post */}
          <section className="card pst__carte">
            <div className="pst__ligne">
              <span className="pst__etiquette">
                5 · Texte du post <span className="pst__tech">message / caption</span>
              </span>
              <div className="pst__puces">
                {VARS.map(([code, tip]) => (
                  <button key={code} type="button" className="pst__variable" title={tip} disabled={locked} onClick={() => !locked && insertVar(code)}>
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <div className="pst__ligne">
              {langTabs}
              <span className="muted pst__petit">{needed.map((L) => `${L.toUpperCase()} : ${shopsFor(L).join(', ')}`).join(' · ')}</span>
            </div>
            {isNlEd && !locked ? (
              <button type="button" className="btn btn--sm pst__gauche" onClick={() => put({ textNl: s.textNl.trim() ? s.textNl : s.text })}>
                Partir du texte FR
              </button>
            ) : null}
            <textarea
              ref={taRef}
              className="pst__champ pst__texte"
              rows={4}
              value={isNlEd ? s.textNl : s.text}
              disabled={locked}
              placeholder="Légende du post. Les variables sont remplacées boutique par boutique."
              onChange={(e) => put(isNlEd ? { textNl: e.target.value } : { text: e.target.value })}
            />
            <div className="pst__ligne">
              <div className="pst__puces">
                {(etat.templates as (Objet & { name: string; text: string; textNl?: string; type: string })[]).map((tp) => (
                  <button key={tp.id} type="button" className="btn btn--sm" disabled={locked} onClick={() => !locked && put({ text: tp.text, textNl: tp.textNl || s.textNl, type: tp.type })}>
                    Modèle · {tp.name}
                  </button>
                ))}
              </div>
              <span className={`pst__petit${len > 125 ? ' is-moyen' : ' muted'}`}>
                {len} caractères{len > 125 ? ' · tronqué après 125 dans le fil' : ''}
              </span>
            </div>
            {/* Assistant de rédaction (Claude) et relecture de marque */}
            <div className="pst__assistant">
              <div className="pst__ligne pst__ligne--gauche">
                <span className="pst__sous-titre">Assistant de rédaction</span>
                <button type="button" className="btn btn--sm" disabled={iaOff} onClick={() => !iaOff && void iaDemander('')}>
                  Proposer 3 textes
                </button>
                {(['court', 'gourmand', 'urgent'] as const).map((k) => (
                  <button key={k} type="button" className="btn btn--sm" disabled={iaOff || vide} onClick={() => !(iaOff || vide) && void iaDemander(k)}>
                    {k === 'court' ? 'Plus court' : k === 'gourmand' ? 'Plus gourmand' : 'Plus urgent'}
                  </button>
                ))}
                <button type="button" className="btn btn--sm" disabled={iaOff || vide} title="Orthographe, grammaire, typographie et charte, sans réécrire le texte (FR et NL)" onClick={() => !(iaOff || vide) && void iaCorriger()}>
                  ✓ Corriger
                </button>
                {tags.length ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    title={tags.join(' ')}
                    disabled={locked}
                    onClick={() => {
                      if (locked) return
                      const k = isNlEd ? 'textNl' : 'text'
                      const tx = String(cur()[k] || '')
                      const manque = tags.filter((h) => !tx.includes(h))
                      if (manque.length) put({ [k]: `${tx.trim() ? `${tx.replace(/\s+$/, '')}\n\n` : ''}${manque.join(' ')}` } as Partial<St>)
                    }}
                  >
                    # Hashtags
                  </button>
                ) : null}
                {s.iaBusy ? (
                  <span className="muted pst__petit">{s.iaConsigne === 'corriger' ? 'Relecture du texte…' : s.iaConsigne ? `Réécriture ${LBL[s.iaConsigne]}…` : 'Rédaction de 3 propositions…'}</span>
                ) : null}
              </div>
              {champ(s.objectif, (x) => put({ objectif: x }), 'Objectif du post pour l’assistant (facultatif) — ex. faire venir l’après-midi en semaine')}
              {!ia.configure ? (
                <span className="pst__petit is-moyen">
                  La rédaction assistée demande une clé API Anthropic :{' '}
                  {props.onParametresIa ? (
                    <button type="button" className="pst__lien" onClick={props.onParametresIa}>
                      Paramètres → Rédaction IA
                    </button>
                  ) : (
                    <a href={lienSocial('set-conn')}>Paramètres → Rédaction IA</a>
                  )}
                  .
                </span>
              ) : null}
              {s.iaErr ? <span className="pst__petit is-alerte">{s.iaErr}</span> : null}
              {/* Le relecteur : les corrections une à une, appliquées seulement sur demande. */}
              {Cor ? (
                <div className="pst__proposition">
                  <span className="pst__kind">{corChange ? `Relecture · ${(Cor.corrections || []).length} correction${(Cor.corrections || []).length > 1 ? 's' : ''}` : 'Relecture · rien à corriger'}</span>
                  {(Cor.corrections || []).map((x, i) => (
                    <span key={i} className="pst__correction">
                      <span className="muted">{x.cle.toUpperCase()}</span> <s>{x.avant}</s> → <span className="is-bon">{x.apres}</span> <span className="muted">· {x.raison}</span>
                    </span>
                  ))}
                  {(Cor.remarques || []).map((rq, i) => (
                    <span key={i} className="pst__petit is-moyen">
                      {rq}
                    </span>
                  ))}
                  <div className="pst__ligne pst__ligne--gauche">
                    {corChange ? (
                      <button type="button" className="btn btn--sm" disabled={locked} onClick={corAppliquer}>
                        Appliquer les corrections
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => put({ cor: null })}>
                      {corChange ? 'Ignorer' : 'Fermer'}
                    </button>
                  </div>
                </div>
              ) : null}
              {R?.variantes?.length ? (
                <div className="pst__propositions">
                  {R.variantes.map((x, i) => (
                    <div key={i} className="pst__proposition">
                      <span className="pst__kind">{x.angle || `Proposition ${i + 1}`}</span>
                      {x.fr ? <p className="pst__prose">{x.fr}</p> : null}
                      {x.nl ? <p className="pst__prose is-nl">{x.nl}</p> : null}
                      {x.titre || x.surtitre || x.phrase ? <span className="muted pst__petit">Visuel : {[x.surtitre, x.titre, x.phrase].filter(Boolean).join(' · ')}</span> : null}
                      <div className="pst__ligne pst__ligne--gauche">
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={locked}
                          onClick={() => {
                            if (locked) return
                            const patch: Partial<St> = {}
                            if (x.fr) patch.text = x.fr
                            if (x.nl) patch.textNl = x.nl
                            autoFr.current = null
                            autoNl.current = null
                            put(patch)
                            toast('Texte repris : relisez-le avant de publier.')
                          }}
                        >
                          Utiliser ce texte
                        </button>
                        {x.titre || x.surtitre || x.phrase ? (
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={locked}
                            onClick={() =>
                              !locked &&
                              V({
                                title: x.titre || v.title, eyebrow: x.surtitre || v.eyebrow, phrase: x.phrase || v.phrase, showTitle: v.showTitle || !!x.titre, showPhrase: v.showPhrase || !!x.phrase,
                                nl: { ...v.nl, ...(x.titreNl ? { title: x.titreNl } : {}) },
                              })
                            }
                          >
                            Titres pour le visuel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn btn--ghost btn--sm pst__gauche" onClick={() => put({ iaRes: null })}>
                    Fermer les propositions
                  </button>
                </div>
              ) : null}
              <div className="pst__ligne pst__ligne--gauche">
                <span className="muted pst__petit">Relecture (charte) :</span>
                {!remarques.length && !vide ? <span className="pst__petit is-bon">✓ conforme</span> : null}
                {remarques.map((r, i) => (
                  <span key={i} className={`pst__qc ${QC[r.niveau]}`}>
                    {r.L} · {r.msg}
                  </span>
                ))}
              </div>
            </div>
            <div className="pst__lien-bloc">
              <label className="pst__champ-titre">
                <span>
                  Lien (optionnel) <span className="pst__tech">link</span>
                </span>
                {champ(s.link, (x) => put({ link: x }), 'https://www.latelierby.be/…  ou  {webshop} / {webshop_produit}')}
              </label>
              <div className="pst__puces">
                <span className="muted pst__petit">Lien rapide :</span>
                {linkChips.map((lk) => (
                  <button key={lk.label} type="button" className={`pst__puce pst__puce--sm${lk.on ? ' is-on' : ''}`} title={lk.tip} disabled={lk.dis} onClick={() => !lk.dis && put({ link: lk.on ? '' : lk.val })}>
                    {lk.label}
                  </button>
                ))}
              </div>
              <input type="search" className="pst__champ" value={s.wsQ} disabled={locked} placeholder="Chercher un produit ou une catégorie du webshop…" onChange={(e) => put({ wsQ: e.target.value })} />
              {wsResults.length ? (
                <div className="pst__ws">
                  {wsResults.map((w, i) => (
                    <button key={i} type="button" className={w.cat ? 'is-cat' : ''} onClick={() => !locked && put({ link: w.val, wsQ: '' })}>
                      <span>{w.label}</span>
                      <span className="muted">{w.sub}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {wq.length >= 2 && !wsResults.length ? <span className="muted pst__petit">Aucun produit ni catégorie du webshop ne correspond.</span> : null}
              {why && !wsProd && !mP && !mC ? <span className="pst__petit is-moyen">{why}</span> : null}
              {res && pvShop ? (
                <span className="pst__petit pst__coupe-mot">
                  {chosen ? `${chosen} · ` : ''}→ {pvShop.name} : {res}
                  {t.length > 1 ? ` (et l’équivalent pour chacune des ${t.length} boutiques)` : ''}
                </span>
              ) : null}
              {mFiche ? (
                <div className="pst__ligne pst__ligne--gauche">
                  <label
                    className="pst__case"
                    title={fiche ? 'Le lien ouvre directement sa fiche (&open=product).' : 'Le lien arrive sur sa sous-catégorie, le produit dans la liste, fiche fermée.'}
                  >
                    <input
                      type="checkbox"
                      checked={fiche}
                      disabled={locked}
                      onChange={(e) => !locked && put({ link: `{webshop_produit${mFiche[1] || ''}${e.target.checked ? '' : ':liste'}}` })}
                    />
                    Ouvrir la fiche du produit
                  </label>
                  {fiche !== ficheDefaut() ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={locked}
                      onClick={() =>
                        garderParametre(
                          'lien_fiche',
                          fiche,
                          fiche ? 'Par défaut, les liens produit ouvriront la fiche.' : 'Par défaut, les liens produit arriveront sur la liste, fiche fermée.',
                        )
                      }
                    >
                      Garder par défaut
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="pst__bloc pst__bloc--filet">
                <span
                  className="pst__libelle"
                  title={`Placé là où le texte dit {lien}, sinon à la fin : « ${lienTexte(etat, pvLang, s)} ${lienUrl || 'https://webshop.atelierby.be/…'} ». Facebook n’accepte pas de lien caché sous un mot : l’adresse reste visible juste après ce texte. Instagram ne rend pas les liens cliquables, il n’est pas repris.`}
                >
                  Texte du lien
                </span>
                <div className="pst__ligne pst__ligne--gauche">
                  {(
                    [
                      ['fr', 'FR'],
                      ['nl', 'NL'],
                    ] as const
                  )
                    .filter(([L]) => needed.includes(L) || L === 'fr')
                    .map(([L, lang]) => (
                      <label key={L} className="pst__lien-texte">
                        {lang}
                        {champ(s.linkText[L] || '', (x) => put((st) => ({ linkText: { ...st.linkText, [L]: x } })), lienTexte(etat, L))}
                      </label>
                    ))}
                  {!locked && (String(s.linkText.fr || '').trim() || String(s.linkText.nl || '').trim()) ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      title="Ce texte sera proposé pour les prochains posts"
                      onClick={() => {
                        const d = { fr: String(s.linkText.fr || '').trim() || lienTexte(etat, 'fr'), nl: String(s.linkText.nl || '').trim() || lienTexte(etat, 'nl') }
                        garderParametre('lien_texte', d, `Texte du lien gardé par défaut : « ${d.fr} » / « ${d.nl} ».`)
                      }}
                    >
                      Garder par défaut
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <label className="pst__champ-titre">
              Opération liée
              <select value={s.campaign} disabled={locked} onChange={(e) => put({ campaign: e.target.value })}>
                <option value="">Aucune</option>
                {etat.campaigns
                  .filter((c) => c.status !== 'terminée' || c.id === s.campaign)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </section>

          {/* 6 · Publication */}
          <section className="card pst__carte">
            <div className="pst__ligne">
              <span className="pst__etiquette">
                6 · Publication <span className="pst__tech">{s.dark ? 'object_story_spec · dark post' : 'published · scheduled_publish_time'}</span>
              </span>
              {seg(
                [
                  ['page', 'Publier sur la Page'],
                  ['dark', 'Réservé à la publicité (dark post)', 'Le post ne paraît ni sur le mur de la Page ni sur la grille Instagram : il n’existe qu’en publicité.'],
                ],
                s.dark ? 'dark' : 'page',
                (k) => !locked && put({ dark: k === 'dark' }),
              )}
            </div>
            {s.dark ? (
              <>
                <div
                  className="pst__dark"
                  title="Ce post ne sera jamais publié sur la Page ni sur Instagram. Il sert de visuel et de texte à une publicité : Meta crée alors un post visible seulement en sponsorisé, auprès de l’audience choisie. Les boutiques cochées servent à l’aperçu et aux variables ; la diffusion (boutiques, rayon, budget) se règle dans la publicité."
                >
                  <span>Dark post · pub uniquement</span>
                  <span>Format de la publicité : {darkFormat}.</span>
                </div>
                {DARK.length ? (
                  <div className="pst__panneau">
                    <span className="pst__sous-titre">
                      Déjà diffusé · {darkAds.length} publicité{darkAds.length > 1 ? 's' : ''}, {DARK.length} dark post{DARK.length > 1 ? 's' : ''}
                    </span>
                    {DARK.map((x, i) => (
                      <div key={i} className="pst__ligne pst__ligne--gauche">
                        <span className="pst__dark-nom">
                          {nomDe(x.shop)}
                          {darkMulti || x.lang === 'nl' ? ` · ${String(x.lang).toUpperCase()}` : ''} · variante {x.variant}
                        </span>
                        {x.link ? (
                          <a href={x.link} target="_blank" rel="noopener noreferrer">
                            Facebook ↗
                          </a>
                        ) : null}
                        {x.linkIg ? (
                          <a href={x.linkIg} target="_blank" rel="noopener noreferrer">
                            Instagram ↗
                          </a>
                        ) : null}
                        <span className="muted">
                          {x.comments} commentaire{x.comments > 1 ? 's' : ''}
                          {x.hidden ? ` · ${x.hidden} masqué${x.hidden > 1 ? 's' : ''}` : ''}
                        </span>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm pst__gauche"
                      onClick={() => (props.onVoirPubs ? props.onVoirPubs(darkAds[0]) : (window.location.href = lienSocial('ads', darkAds[0] ? `ad=${encodeURIComponent(darkAds[0])}` : '')))}
                    >
                      Voir les publicités et les commentaires →
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="pst__ligne pst__ligne--gauche">
                  {seg(
                    [
                      ['now', 'Immédiate'],
                      ['later', 'Programmée'],
                    ],
                    s.when,
                    (k) => put({ when: k }),
                  )}
                  {later ? (
                    <>
                      <input type="date" className="pst__champ" value={s.date} disabled={locked} onChange={(e) => put({ date: e.target.value })} />
                      <input type="time" className="pst__champ" value={s.time} disabled={locked} onChange={(e) => put({ time: e.target.value })} />
                    </>
                  ) : null}
                </div>
                <label className="pst__curseur">
                  <span>Étaler sur {s.spread} min</span>
                  {rangee({ min: 0, max: 60, step: 5, value: s.spread, onChange: (n) => put({ spread: n }) })}
                </label>
                <span className={`pst__petit ${schedClass}`}>{schedRule}</span>
                <div className="pst__puces">
                  {schedule.map((x, i) => (
                    <span key={i} className="chip chip--lever">
                      {x.name} · {x.t}
                    </span>
                  ))}
                </div>
                <div className="pst__appel">
                  <div className="pst__appel-tete">
                    <span>POST /{'{page_id}'}/{ep}</span>
                    <span>× {pages.length} Pages · Page token</span>
                  </div>
                  <div className="pst__appel-corps">
                    {apiParams.map(([k, val], i) => (
                      <span key={i}>
                        <span className="is-ruby">{k}</span> = {val}
                      </span>
                    ))}
                  </div>
                  {t.some((id) => s.ch[id]?.ig) ? <div className="pst__appel-pied">{igCall}</div> : null}
                </div>
              </>
            )}
            {/* Permissions du token Meta : la publication serait refusée, on le dit avant */}
            {permWarn.length ? (
              <div className="warning pst__alerte">
                <span>Meta refusera cette publication : il manque des permissions au token</span>
                {permWarn.map((w) => (
                  <span key={w}>• {w}</span>
                ))}
                <span>À ajouter dans le Business Manager (utilisateur système → Générer un nouveau token), puis à coller dans Paramètres → API Meta.</span>
              </div>
            ) : null}
            {s.errors.length ? (
              <div className="pst__erreurs">
                {s.errors.map((er, i) => (
                  <span key={i}>{er}</span>
                ))}
              </div>
            ) : null}
            {!locked ? (
              <div className="pst__actions">
                {!s.dark ? (
                  <button
                    type="button"
                    className="btn pst__gauche-auto"
                    title="Le visuel et le texte de ce post deviennent un modèle de l’espace franchisé : chaque boutique pourra le publier sur sa Page, à la date de son choix."
                    onClick={() =>
                      put({
                        tplOpen: true,
                        tplErr: '',
                        tplForm: { name: s.m?.title || s.v?.title || (s.text || '').split(/[.\n]/)[0].slice(0, 60) || 'Modèle du réseau', description: '', validation: false, free: false },
                      })
                    }
                  >
                    Enregistrer comme modèle franchisé
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => !s.saving && void persist('Brouillon')}>
                  {s.dark ? 'Enregistrer le dark post' : 'Enregistrer le brouillon'}
                </button>
                <button
                  type="button"
                  className={`btn btn--primary${s.saving ? ' is-busy' : ''}`}
                  onClick={() => !s.saving && void (s.dark ? persist('Dark post', true) : persist(s.when === 'now' ? 'Publié' : 'Programmé'))}
                >
                  {publishLabel}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {/* ================= APERÇU ================= */}
        <aside className="pst__apercu">
          <div className="pst__ligne">
            <span className="pst__etiquette">Aperçu en direct</span>
            {seg(
              [
                ['fb', 'Facebook'],
                ['ig', 'Instagram'],
                ['story', 'Story', 'La story Instagram : le visuel en plein écran, sous l’interface d’Instagram'],
                ['grille', 'Grille', 'Le profil Instagram : ce post parmi les posts programmés et ceux déjà en ligne'],
              ],
              s.pvVue === 'story' ? 'story' : s.pvVue === 'grille' ? 'grille' : s.pv,
              (k) => put(k === 'fb' ? { pv: 'fb', pvVue: 'post' } : k === 'ig' ? { pv: 'ig', pvVue: 'post' } : { pv: 'ig', pvVue: k as St['pvVue'] }),
            )}
            <button type="button" className={`pst__puce pst__puce--sm${s.tel ? ' is-on' : ''}`} aria-pressed={s.tel} title="Aperçu dans un téléphone, à la taille réelle de son écran" onClick={() => put({ tel: !s.tel })}>
              Téléphone
            </button>
          </div>
          {t.length > 1 ? (
            <div className="pst__puces">
              {t.map((id) => (
                <button key={id} type="button" className={`pst__puce pst__puce--sm${id === pvId ? ' is-on' : ''}`} onClick={() => put({ pvShop: id, pbApercu: id })}>
                  {nomDe(id)}
                </button>
              ))}
            </div>
          ) : null}
          {bilingue ? (
            <div className="pst__ligne pst__ligne--gauche" title="Boutique bilingue : la légende part dans les deux langues.">
              <span className="muted pst__petit">Boutique bilingue · visuel en</span>
              {shopLangs.map((L) => (
                <button key={L} type="button" className={`pst__puce pst__puce--sm${L === pvLang ? ' is-on' : ''}`} onClick={() => put({ pvLang: L })}>
                  {L.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          {vue === 'grille' ? (
            <div className="pst__grille">
              <div className="pst__ligne">
                <span>Profil Instagram · {grilleNom}</span>
                <span className="muted pst__petit">
                  {prog.length} programmé{prog.length > 1 ? 's' : ''} · {Gr === undefined ? 'lecture…' : `${Gr.length} en ligne`} · recadrage 3:4
                </span>
              </div>
              <div className="pst__grille-tuiles">
                {grilleTiles.map((x, i) => (
                  <div key={i} className={`pst__grille-tuile${x.moi ? ' is-moi' : ''}`}>
                    {x.src ? <img src={x.src} alt="" /> : null}
                    {x.tag ? <span className={x.moi ? 'is-moi' : ''}>{x.tag}</span> : null}
                  </div>
                ))}
              </div>
              {Gr !== undefined && !Gr.length ? <span className="muted pst__petit">Aucune publication en ligne relue pour ce compte (Grille Instagram → Relire).</span> : null}
            </div>
          ) : null}
          {storyPasFormat ? (
            <div className="warning pst__ligne pst__ligne--gauche">
              {storyMsg}
              {studio ? (
                <button type="button" className="btn btn--sm" disabled={locked} onClick={() => !locked && V({ format: 'story' })}>
                  Passer le visuel en Story 9:16
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={`pst__cadre${s.tel ? ' is-tel' : ''}${s.tel && story ? ' is-sombre' : ''}`}>
            {s.tel ? (
              <div className="pst__tel-barre">
                <span>9:41</span>
                <span className="pst__tel-ilot" />
                <span>5G ▮</span>
              </div>
            ) : null}
            <div className="pst__mock" title={!locked && studio ? 'Cliquez sur un texte du visuel pour le modifier ou changer sa couleur.' : undefined}>
              {s.pv === 'fb' ? (
                <>
                  <div className="pst__fb-tete">
                    <span className="pst__avatar">
                      <img src={`${ASSET}img/logo-white.png`} alt="" />
                    </span>
                    <span className="pst__fb-nom">
                      <span>{pv.page}</span>
                      <span>{pv.when} · Public</span>
                    </span>
                  </div>
                  <p className="pst__fb-texte">{pv.text}</p>
                  {lienUrl && !aMedia ? <p className="pst__fb-lien">{lienUrl}</p> : null}
                </>
              ) : null}
              {s.pv === 'ig' && s.pvVue !== 'story' ? (
                <div className="pst__ig-tete">
                  <span className="pst__avatar is-ig">
                    <img src={`${ASSET}img/logo-white.png`} alt="" />
                  </span>
                  <span className="pst__fb-nom">
                    <span>{pv.handle}</span>
                    <span>{pv.city}</span>
                  </span>
                </div>
              ) : null}

              {/* visuel : instance unique du studio */}
              {studio ? (
                <div className="pst__studio">
                  <StudioVisuel
                    control={studioControl}
                    onApi={surApi}
                    onLabelMove={(id, x, y) => !locked && put((st) => ({ v: { ...st.v, textes: (st.v.textes || []).map((tt) => (tt.id === id ? { ...tt, x, y } : tt)) } }))}
                    onLabelSelect={(id) => put({ txtSel: id })}
                    onLabelEdit={(id) => {
                      if (!locked) {
                        put({ txtSel: id })
                        editerTexte()
                      }
                    }}
                    onLabelDelete={(id) => !locked && effacerTexte(id)}
                    onTextPick={(role) => !locked && put({ couleurRole: role, couleurNom: NOMS_TEXTE[role] || role })}
                    onTextEdit={(role, val) => {
                      if (locked) return
                      const c0 = cur().v
                      const nl = pvLang === 'nl' && (LOC as readonly string[]).includes(role)
                      const show = ({ eyebrow: 'showEyebrow', title: 'showTitle', phrase: 'showPhrase', price: 'showPrice', promo: 'showPromo', site: 'showSite' } as Record<string, keyof Visuel>)[role]
                      V({
                        ...(nl ? { nl: { ...c0.nl, [role]: val } } : ({ [role]: val } as Partial<Visuel>)),
                        ...(show && !c0[show] && String(val).trim() ? ({ [show]: true } as Partial<Visuel>) : {}),
                      })
                    }}
                  />
                  {isStoryUi ? (
                    <div className="pst__story">
                      <div className="pst__story-haut" />
                      <div className="pst__story-barre">
                        <span />
                      </div>
                      <div className="pst__story-compte">
                        <span className="pst__avatar is-petit">
                          <img src={`${ASSET}img/logo-white.png`} alt="" />
                        </span>
                        {pv.handle}
                        <span className="pst__story-age">2 h</span>
                        <span className="pst__story-x">✕</span>
                      </div>
                      <div className="pst__story-bas" />
                      <div className="pst__story-message">
                        <span>Envoyer un message</span>
                        <span>♡</span>
                        <span>➤</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {s.mode === 'brut' ? (
                shown.length ? (
                  <div className={`pst__medias${shown.length > 1 ? ' is-deux' : ''}`}>
                    {shown.map((m, i) => (
                      <div key={i} className="pst__media">
                        {m.isVideo ? <span className="pst__media-video">▶</span> : <img src={m.src} alt="" style={{ objectFit: m.fit as 'cover' }} />}
                        {m.more ? <span className="pst__media-plus">+{rawMedia.length - 4}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pst__vide">Aucune photo</div>
                )
              ) : null}
              {estMontage(s.mode) ? (
                <>
                  {isFrise && s.pv === 'ig' && nS > 0 ? (
                    <div className="pst__frise">
                      <span className="pst__mock-note">Sur le profil · une ligne de la grille (recadrage 3:4)</span>
                      <div className="pst__grille-tuiles">
                        {slices.map((src, j) => (
                          <div key={j} className="pst__grille-tuile">
                            <img src={src} alt={`Tuile ${j + 1} de la frise`} />
                          </div>
                        ))}
                      </div>
                      <span className="pst__mock-note">Dans le fil, chaque post est vu seul :</span>
                    </div>
                  ) : null}
                  {mWide ? nS > 0 ? <img className="pst__frise-entiere" src={s.mPrev.full || ''} alt="Frise : le visuel entier" /> : <div className="pst__vide">{s.photos.length ? 'Préparation de l’aperçu…' : 'Ajoutez une ou plusieurs photos : le montage se dessine ici.'}</div> : null}
                  {!mAlbum && !mWide ? (
                    <>
                      <div className="pst__diapo">
                        {nS ? (
                          <img src={slices[iS] || ''} alt={isPano ? `Image ${iS + 1} sur ${nS} du carrousel` : isFrise ? `Post ${iS + 1} sur 3 de la frise` : `Collage ${mTpl[1]}`} />
                        ) : (
                          <span className="pst__diapo-vide">{s.photos.length ? 'Préparation de l’aperçu…' : 'Ajoutez une ou plusieurs photos : le montage se dessine ici.'}</span>
                        )}
                        {nS > 1 ? (
                          <span className="pst__diapo-compte">
                            {isFrise ? 'Post ' : ''}
                            {iS + 1}/{nS}
                            {mFresh ? '' : ' · mise à jour…'}
                          </span>
                        ) : null}
                        {iS > 0 ? (
                          <button type="button" className="pst__diapo-fleche is-gauche" aria-label="Image précédente" onClick={() => put({ mIdx: Math.max(0, iS - 1) })}>
                            ‹
                          </button>
                        ) : null}
                        {iS < nS - 1 ? (
                          <button type="button" className="pst__diapo-fleche is-droite" aria-label="Image suivante" onClick={() => put({ mIdx: Math.min(nS - 1, iS + 1) })}>
                            ›
                          </button>
                        ) : null}
                      </div>
                      {nS > 1 ? (
                        <div className="pst__points">
                          {slices.map((_, j) => (
                            <span key={j} className={j === iS ? 'is-on' : ''} />
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {mAlbum ? (
                    <div className="pst__medias is-deux is-album">
                      {slices.slice(0, 4).map((src, j) => (
                        <div key={j} className="pst__media">
                          <img src={src} alt="" />
                          {j === 3 && nS > 4 ? <span className="pst__media-plus">+{nS - 4}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}

              {s.pv === 'fb' ? (
                <>
                  <div className="pst__fb-compte">
                    <span>J’aime · Commentaires</span>
                    <span>Partages</span>
                  </div>
                  <div className="pst__fb-gestes">
                    <span>J’aime</span>
                    <span>Commenter</span>
                    <span>Partager</span>
                  </div>
                </>
              ) : null}
              {s.pv === 'ig' && s.pvVue !== 'story' ? (
                <div className="pst__ig-pied">
                  <p>
                    <span className="pst__ig-handle">{pv.handle}</span> {pv.textIg}
                  </p>
                  {lienUrl ? (
                    <span className="pst__mock-note" title="Instagram : un lien de légende n’est pas cliquable, il n’est pas repris (« lien en bio »).">
                      Lien non repris sur Instagram.
                    </span>
                  ) : null}
                  <span className="pst__mock-quand">{pv.when}</span>
                </div>
              ) : null}
            </div>
            {s.tel ? (
              <div className="pst__tel-pied">
                <span />
              </div>
            ) : null}
          </div>
          {palette(true)}
          {igBroken.length ? (
            <span className="warning pst__petit">Instagram indisponible pour {igBroken.map(nomDe).join(', ')} : seule la Page Facebook sera publiée.</span>
          ) : null}
          <span className="muted pst__petit">
            Variables pour {pv.city} : {pv.resolved}
          </span>
        </aside>
      </div>

      {/* ================= MÉDIATHÈQUE (fenêtre) ================= */}
      {s.libOpen ? (
        <div className="pst__voile" onClick={() => put({ libOpen: false })}>
          <div
            className="card pst__lib"
            role="dialog"
            aria-modal="true"
            onClick={(e: ReactMouseEvent) => e.stopPropagation()}
            onDragOver={(e: DragEvent) => e.preventDefault()}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              e.stopPropagation()
              void addFilesLib(e.dataTransfer.files, false)
            }}
          >
            <div className="pst__lib-tete">
              <div className="pst__ligne pst__ligne--gauche">
                <span className="pst__lib-titre">Médiathèque</span>
                <span className="muted pst__petit">
                  {s.lib.length} visuels · {s.photos.length} dans le post
                </span>
              </div>
              <div className="pst__ligne pst__ligne--gauche">
                <label className="btn">
                  Importer photos ou vidéos
                  {fichiers('image/*,video/*', true, (fl) => void addFilesLib(fl, false))}
                </label>
                <button type="button" className="btn btn--primary" onClick={() => put({ libOpen: false })}>
                  Terminer
                </button>
              </div>
            </div>
            <div className={`pst__lib-bandeau${s.partageErr ? ' is-alerte' : ''}`}>
              <span title="Ce que vous déposez ici sert aussi aux campagnes, aux brochures et aux bâches (Marketing › Médiathèque).">
                {s.partage
                  ? `Médiathèque commune du marketing.${locaux ? ` ${locaux}${locaux > 1 ? ' visuels n’existent' : ' visuel n’existe'} encore que dans ce navigateur.` : ''}`
                  : s.partageErr
                    ? `Médiathèque commune indisponible (${s.partageErr}). Les fichiers déposés restent dans ce navigateur.`
                    : 'Chargement de la médiathèque commune…'}
              </span>
              {s.partage && locaux ? (
                <button type="button" className="btn btn--sm" onClick={() => void verserLocaux()}>
                  {s.versement ? `Versement… ${s.versement.fait} / ${s.versement.total}` : 'Les verser dans la médiathèque commune'}
                </button>
              ) : null}
            </div>
            <div className="pst__lib-corps">
              <nav className="pst__lib-nav">
                <button type="button" className={allActive ? 'is-on' : ''} onClick={() => put({ mCat: '', mSub: '', mOnlyPost: false })}>
                  <span>Tous les visuels</span>
                  <span className="muted">{s.lib.length}</span>
                </button>
                <button type="button" className={s.mOnlyPost ? 'is-on' : ''} onClick={() => put({ mOnlyPost: true, mCat: '', mSub: '' })}>
                  <span>Dans le post</span>
                  <span className="muted">{s.photos.length}</span>
                </button>
                <span className="pst__etiquette pst__lib-groupe">Catégories</span>
                {Object.keys(CATS).map((c) => {
                  const items = s.lib.filter((it) => it.cat === c)
                  const active = s.mCat === c && !s.mOnlyPost
                  return (
                    <Fragment key={c}>
                      <button type="button" className={active && !s.mSub ? 'is-on' : active ? 'is-ouvert' : ''} onClick={() => put({ mCat: c, mSub: '', mOnlyPost: false })}>
                        <span>{c}</span>
                        <span className="muted">{items.length}</span>
                      </button>
                      {active
                        ? (CATS[c] || [])
                            .map((sb) => ({ sb, n: items.filter((it) => it.sub === sb).length }))
                            .filter((x) => x.n > 0)
                            .map(({ sb, n }) => (
                              <button key={sb} type="button" className={`is-sous${s.mSub === sb ? ' is-on' : ''}`} onClick={() => put({ mCat: c, mSub: sb, mOnlyPost: false })}>
                                <span>{sb}</span>
                                <span className="muted">{n}</span>
                              </button>
                            ))
                        : null}
                    </Fragment>
                  )
                })}
                <button type="button" className={uncActive ? 'is-on' : ''} onClick={() => put({ mCat: '—', mSub: '', mOnlyPost: false })}>
                  <span>Non classés</span>
                  <span className="muted">{s.lib.filter((it) => !it.cat).length}</span>
                </button>
                <button type="button" className="btn btn--ghost btn--sm pst__lib-restaurer" title="Ré-importe les illustrations du design system supprimées" onClick={() => void restaurerDs()}>
                  Restaurer les illustrations
                </button>
              </nav>
              <div className="pst__lib-liste">
                <div className="pst__ligne pst__ligne--gauche">
                  <input type="search" className="pst__champ pst__grow" value={s.mQuery} onChange={(e) => put({ mQuery: e.target.value })} placeholder="Rechercher un visuel…" />
                  <select value={s.mSeason} onChange={(e) => put({ mSeason: e.target.value })} aria-label="Saison">
                    <option value="">Toutes saisons</option>
                    {SAISONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                  {s.mQuery || s.mCat || s.mSub || s.mSeason || s.mOnlyPost ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => put({ mQuery: '', mCat: '', mSub: '', mSeason: '', mOnlyPost: false })}>
                      Effacer les filtres
                    </button>
                  ) : null}
                </div>
                <div className="pst__ligne">
                  <span className="muted pst__petit">
                    {mFound.length}
                    {mFound.length > 1 ? ' visuels ' : ' visuel '}
                    {ctx}
                  </span>
                  {!locked && mFound.some((x) => !inPost(x)) ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        put((st) => ({ photos: st.photos.concat(mFound.filter((x) => !estVid(x) && !st.photos.some((p) => p.src === x.src)).map((x) => ({ src: x.src, cut: x.cut !== false, name: x.name }))) }))
                      }
                    >
                      Tout ajouter au post · {mFound.length}
                    </button>
                  ) : null}
                </div>
                <div className="pst__lib-grille">
                  {mFound.slice(0, 160).map((it) => (
                    <div key={it.id} className={`pst__lib-carte${s.editId === it.id ? ' is-on' : ''}`} onClick={() => put({ editId: it.id })}>
                      <div className="pst__lib-image">
                        <img src={vign(it)} alt="" />
                        {estVid(it) ? <span className="pst__lib-video">▶ Vidéo</span> : null}
                        {inPost(it) ? <span className="pst__lib-dans">Dans le post</span> : null}
                        <button
                          type="button"
                          className="btn btn--sm pst__lib-bouton"
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePost(it)
                          }}
                        >
                          {inPost(it) ? 'Retirer' : '+ Post'}
                        </button>
                      </div>
                      <div className="pst__lib-nom">
                        <span>{it.name}</span>
                        <span className="muted">
                          {estVid(it) ? 'Vidéo · ' : ''}
                          {tagsLib(it)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!mFound.length ? (
                    <div className="pst__lib-vide">
                      <span>Aucun visuel ne correspond à ces filtres.</span>
                      <button type="button" className="btn btn--sm" onClick={() => put({ mQuery: '', mCat: '', mSub: '', mSeason: '', mOnlyPost: false })}>
                        Effacer les filtres
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {ed ? (
                <div className="pst__lib-fiche">
                  <div className="pst__lib-image is-grande">
                    <img src={vign(ed)} alt="" />
                    {inPost(ed) ? <span className="pst__lib-dans">Dans le post</span> : null}
                  </div>
                  <label className="pst__champ-titre">
                    Nom
                    <input type="text" className="pst__champ" value={ed.name} onChange={(e) => editItem({ name: e.target.value })} />
                  </label>
                  <label className="pst__champ-titre">
                    Catégorie
                    <select value={ed.cat} onChange={(e) => editItem({ cat: e.target.value, sub: '' })}>
                      <option value="">Non classée</option>
                      {Object.keys(CATS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pst__champ-titre">
                    Sous-catégorie
                    <select value={ed.sub} onChange={(e) => editItem({ sub: e.target.value })}>
                      <option value="">—</option>
                      {(CATS[ed.cat] || []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pst__champ-titre">
                    Saisonnalité
                    <select value={ed.season} onChange={(e) => editItem({ season: e.target.value })}>
                      {SAISONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!estVid(ed) ? (
                    <div className="pst__champ-titre">
                      Rendu
                      {seg(
                        [
                          ['cut', 'Détourée'],
                          ['full', 'Pleine'],
                        ],
                        ed.cut ? 'cut' : 'full',
                        (k) => editItem({ cut: k === 'cut' }),
                      )}
                    </div>
                  ) : (
                    <span className="muted pst__petit" title="Elle part telle quelle (« Photos telles quelles »), en vidéo ou en reel. Une photo du post sert de couverture.">
                      Vidéo
                    </span>
                  )}
                  <button type="button" className="btn" onClick={() => togglePost(ed)}>
                    {inPost(ed) ? 'Retirer du post' : 'Ajouter au post'}
                  </button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={editDelete}>
                    Supprimer de la médiathèque
                  </button>
                </div>
              ) : (
                <div className="pst__lib-fiche is-vide" title="Cliquez un visuel pour le renommer, le classer et le mettre dans le post.">
                  Aucun visuel choisi.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Enregistrer comme modèle franchisé */}
      {s.tplOpen ? (
        <div className="pst__voile" onClick={() => put({ tplOpen: false })}>
          <div className="card pst__modale" role="dialog" aria-modal="true" onClick={(e: ReactMouseEvent) => e.stopPropagation()}>
            <span
              className="pst__modale-titre"
              title="Le visuel de ce post (figé) et son texte deviennent un modèle de l’espace franchisé. Chaque boutique le publie sur sa Page Facebook, à la date de son choix ; {ville}, {adresse} et {horaires} y sont remplis pour elle. Instagram reste au réseau."
            >
              Enregistrer comme modèle franchisé
            </span>
            <label className="pst__champ-titre">
              Nom du modèle
              <input type="text" className="pst__champ" value={s.tplForm.name} onChange={(e) => put((st) => ({ tplForm: { ...st.tplForm, name: e.target.value } }))} />
            </label>
            <label className="pst__champ-titre">
              Description pour la boutique
              <input
                type="text"
                className="pst__champ"
                value={s.tplForm.description}
                placeholder="Ex. : la gamme automne, à publier jusqu’au 25/10"
                onChange={(e) => put((st) => ({ tplForm: { ...st.tplForm, description: e.target.value } }))}
              />
            </label>
            <label className="pst__case">
              <input type="checkbox" checked={s.tplForm.validation} onChange={() => put((st) => ({ tplForm: { ...st.tplForm, validation: !st.tplForm.validation } }))} />
              Je valide chaque publication des boutiques
            </label>
            <label className="pst__case">
              <input type="checkbox" checked={s.tplForm.free} onChange={() => put((st) => ({ tplForm: { ...st.tplForm, free: !st.tplForm.free } }))} />
              La boutique peut ajouter une phrase (90 caractères, sans lien)
            </label>
            {s.tplErr ? <span className="error">{s.tplErr}</span> : null}
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => put({ tplOpen: false })}>
                Annuler
              </button>
              <button type="button" className={`btn btn--primary${s.tplBusy ? ' is-busy' : ''}`} onClick={() => !s.tplBusy && void saveAsTemplate()}>
                {s.tplBusy ? 'Préparation du visuel…' : 'Créer le modèle'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {s.toast ? (
        <div className="pst__toast">
          {s.toast}{' '}
          <button type="button" className="pst__lien is-clair" onClick={voirCalendrier}>
            Voir le calendrier
          </button>
        </div>
      ) : null}
    </div>
  )
}

const css = (o: Record<string, string | number | undefined>) => o as CSSProperties
interface Cartes {
  sel: Record<string, string>
  pick: Record<string, () => void>
}

interface Zip {
  file: (n: string, b64: string, o: { base64: boolean }) => void
  generateAsync: (o: { type: 'blob' }) => Promise<Blob>
}
declare global {
  interface Window {
    JSZip?: new () => Zip
  }
}
let zipP: Promise<new () => Zip> | null = null
/** JSZip, la bibliothèque du kit multi-format (servie avec le module Social). */
function moteurZip(): Promise<new () => Zip> {
  zipP ??= new Promise<new () => Zip>((ok, ko) => {
    if (window.JSZip) {
      ok(window.JSZip)
      return
    }
    const sc = document.createElement('script')
    sc.src = `${ROOTS.social}vendor/jszip.min.js`
    sc.onload = () => (window.JSZip ? ok(window.JSZip) : ko(new Error('bibliothèque zip introuvable')))
    sc.onerror = () => ko(new Error('bibliothèque zip introuvable'))
    document.head.appendChild(sc)
  }).catch((e: unknown) => {
    zipP = null
    throw e
  })
  return zipP
}

/** Les vignettes des styles « photo unique » (dessins repris tels quels de l'ancien écran). */
function vignettesStyles1({ sel, pick }: Cartes) {
  return (
    <>
 <div style={css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(86px,1fr))', gap: '10px' })}>
<button type="button" onClick={pick.Epure} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Epure}`, background: '#F5EFE4', padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '22px', height: '3px', background: '#8D1D2C' })}></div>
<div style={css({ width: '46px', height: '7px', background: '#1c1a17' })}></div>
<div style={css({ width: '30px', height: '30px', borderRadius: '50%', background: '#8A847C', opacity: '0.5', marginTop: '2px' })}></div>
<div style={css({ width: '20px', height: '6px', background: '#8D1D2C', marginTop: 'auto' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Épuré</span>
</button>
<button type="button" onClick={pick.Abricot} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Abricot}`, background: '#F2C9A0', padding: '12px', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' })}>
<div style={css({ width: '50px', height: '9px', background: '#1c1a17' })}></div>
<div style={css({ width: '34px', height: '9px', background: '#1c1a17', marginTop: '3px' })}></div>
<div style={css({ position: 'absolute', right: '8px', bottom: '8px', width: '40px', height: '40px', borderRadius: '50%', background: '#8A847C', opacity: '0.6' })}></div>
<div style={css({ position: 'absolute', left: '12px', bottom: '12px', width: '18px', height: '7px', background: '#8D1D2C' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Abricot</span>
</button>
<button type="button" onClick={pick.Ruby} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Ruby}`, background: '#8D1D2C', padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '32px', height: '32px', borderRadius: '50%', background: '#F2C9A0', opacity: '0.85' })}></div>
<div style={css({ width: '46px', height: '7px', background: '#FFFFFF', marginTop: '2px' })}></div>
<div style={css({ width: '20px', height: '6px', background: '#FFFFFF', marginTop: 'auto' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Ruby</span>
</button>
<button type="button" onClick={pick.Noir} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Noir}`, background: '#1c1a17', padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '22px', height: '3px', background: '#F2C9A0' })}></div>
<div style={css({ width: '46px', height: '7px', background: '#FFFFFF' })}></div>
<div style={css({ width: '30px', height: '30px', borderRadius: '50%', background: '#8A847C', opacity: '0.6', marginTop: '2px' })}></div>
<div style={css({ width: '20px', height: '6px', background: '#F2C9A0', marginTop: 'auto' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Noir</span>
</button>
<button type="button" onClick={pick.Plein} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Plein}`, background: 'linear-gradient(180deg,#A39D94 0%,#8A847C 45%,#2E2C2A 100%)', padding: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '48px', height: '8px', background: '#FFFFFF' })}></div>
<div style={css({ width: '20px', height: '6px', background: '#F2C9A0' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Plein cadre</span>
</button>
<button type="button" onClick={pick.Pleinbandeau} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Pleinbandeau}`, background: 'linear-gradient(180deg,#A39D94 0%,#8A847C 60%)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', boxSizing: 'border-box', overflow: 'hidden' })}>
<div style={css({ background: '#8D1D2C', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' })}><div style={css({ width: '36px', height: '7px', background: '#FFFFFF' })}></div><div style={css({ width: '14px', height: '6px', background: '#F2C9A0' })}></div></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Plein · bandeau</span>
</button>
<button type="button" onClick={pick.Pleinencart} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Pleinencart}`, background: 'linear-gradient(160deg,#B8B2A8 0%,#8A847C 100%)', padding: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', boxSizing: 'border-box' })}>
<div style={css({ width: '56%', background: '#F5EFE4', borderRadius: '5px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '3px' })}><div style={css({ width: '80%', height: '5px', background: '#1c1a17' })}></div><div style={css({ width: '40%', height: '4px', background: '#8D1D2C' })}></div></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Plein · encart</span>
</button>
<button type="button" onClick={pick.Pleinhaut} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Pleinhaut}`, background: 'linear-gradient(180deg,#2E2C2A 0%,#8A847C 50%,#A39D94 100%)', padding: '9px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', boxSizing: 'border-box', position: 'relative' })}>
<div style={css({ width: '44px', height: '7px', background: '#FFFFFF' })}></div><div style={css({ width: '28px', height: '4px', background: '#F2C9A0' })}></div>
<div style={css({ position: 'absolute', right: '7px', bottom: '7px', width: '20px', height: '20px', borderRadius: '50%', background: '#8D1D2C' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Plein · titre haut</span>
</button>
<button type="button" onClick={pick.Pleinfilet} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Pleinfilet}`, background: 'linear-gradient(180deg,#A39D94 0%,#8A847C 50%,#2E2C2A 100%)', padding: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '100%', height: '100%', border: '1.5px solid #F5EFE4', borderRadius: '3px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', padding: '6px' })}><div style={css({ width: '40px', height: '6px', background: '#FFFFFF' })}></div><div style={css({ width: '16px', height: '5px', background: '#F2C9A0' })}></div></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Plein · filet</span>
</button>
<button type="button" onClick={pick.Duo} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Duo}`, background: 'linear-gradient(90deg,#8A847C 0%,#8A847C 44%,#F5EFE4 44%,#F5EFE4 100%)', padding: '12px 10px 12px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: '5px', boxSizing: 'border-box' })}>
<div style={css({ width: '34px', height: '7px', background: '#1c1a17' })}></div>
<div style={css({ width: '24px', height: '7px', background: '#1c1a17' })}></div>
<div style={css({ width: '16px', height: '6px', background: '#8D1D2C', marginTop: '8px' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Duo</span>
</button>
</div>
    </>
  )
}

/** Les vignettes des styles « montage » (dessins repris tels quels de l'ancien écran). */
function vignettesStyles2({ sel, pick }: Cartes) {
  return (
    <>
 <div style={css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(86px,1fr))', gap: '10px' })}>
<button type="button" onClick={pick.Mosaique} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Mosaique}`, background: '#F5EFE4', padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px', boxSizing: 'border-box', overflow: 'hidden' })}>
<div style={css({ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '-6px' })}><div style={css({ height: '22px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '28px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '22px', borderRadius: '4px', background: '#D9D2C7' })}></div></div>
<div style={css({ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '-16px' })}><div style={css({ height: '28px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '22px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '28px', borderRadius: '4px', background: '#D9D2C7' })}></div></div>
<div style={css({ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '-10px' })}><div style={css({ height: '22px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '28px', borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ height: '22px', borderRadius: '4px', background: '#D9D2C7' })}></div></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Mosaïque</span>
</button>
<button type="button" onClick={pick.Grille} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Grille}`, background: '#F5EFE4', padding: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr auto', gap: '4px', boxSizing: 'border-box' })}>
<div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div>
<div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div>
<div style={css({ height: '6px', width: '70%', background: '#1c1a17', marginTop: '3px' })}></div><div style={css({ height: '6px', width: '40%', background: '#8D1D2C', marginTop: '3px', justifySelf: 'end' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Grille 2×2</span>
</button>
<button type="button" onClick={pick.Trio} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Trio}`, background: '#F5EFE4', padding: '10px', display: 'grid', gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr auto', gap: '4px', boxSizing: 'border-box' })}>
<div style={css({ borderRadius: '4px', background: '#D9D2C7', gridRow: '1 / span 2' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div>
<div style={css({ height: '6px', width: '70%', background: '#1c1a17', marginTop: '3px' })}></div><div style={css({ height: '6px', width: '60%', background: '#8D1D2C', marginTop: '3px', justifySelf: 'end' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Trio</span>
</button>
<button type="button" onClick={pick.Collage} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Collage}`, background: '#F5EFE4', padding: '6px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: '1fr 1fr', gap: '4px', boxSizing: 'border-box' })}>
<div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div>
<div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '4px', background: '#FFFFFF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px' })}><div style={css({ width: '60%', height: '4px', background: '#1c1a17' })}></div><div style={css({ width: '35%', height: '4px', background: '#8D1D2C' })}></div></div><div style={css({ borderRadius: '4px', background: '#D9D2C7' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Collage</span>
</button>
<button type="button" onClick={pick.Bandes} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Bandes}`, background: '#F5EFE4', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: '1fr auto', gap: '2px', boxSizing: 'border-box', overflow: 'hidden' })}>
<div style={css({ background: '#D9D2C7' })}></div><div style={css({ background: '#D9D2C7' })}></div><div style={css({ background: '#D9D2C7' })}></div>
<div style={css({ gridColumn: '1 / span 3', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' })}><div style={css({ height: '6px', width: '40%', background: '#1c1a17' })}></div><div style={css({ height: '6px', width: '22%', background: '#8D1D2C' })}></div></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Bandes</span>
</button>
<button type="button" onClick={pick.Galerie} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}>
<div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Galerie}`, background: '#F5EFE4', padding: '10px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)', gap: '3px', boxSizing: 'border-box' })}>
<div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div>
<div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div>
<div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div><div style={css({ borderRadius: '3px', background: '#D9D2C7' })}></div>
</div>
<span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Galerie 3×3</span>
</button>
<button type="button" onClick={pick.Frise} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Frise}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '25%', top: '14%', width: '50%', height: '8%', background: '#1c1a17', borderRadius: '1px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '36%', width: '19%', height: '19%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '29%', top: '36%', width: '19%', height: '19%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '52%', top: '36%', width: '19%', height: '19%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '75%', top: '36%', width: '19%', height: '19%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '38%', top: '72%', width: '24%', height: '6%', background: '#8D1D2C', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Frise</span></button>
<button type="button" onClick={pick.Puzzle} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Puzzle}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '6%', top: '6%', width: '56%', height: '56%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '6%', width: '28%', height: '26%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '36%', width: '28%', height: '26%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '66%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '37%', top: '66%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '66%', width: '28%', height: '28%', background: '#FFFFFF', borderRadius: '4px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Puzzle</span></button>
<button type="button" onClick={pick.Pastilles} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Pastilles}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '18%', top: '14%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '6px' })}></div><div style={css({ position: 'absolute', left: '54%', top: '14%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '6px' })}></div><div style={css({ position: 'absolute', left: '18%', top: '48%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '6px' })}></div><div style={css({ position: 'absolute', left: '54%', top: '48%', width: '28%', height: '28%', background: '#D9D2C7', borderRadius: '6px' })}></div><div style={css({ position: 'absolute', left: '10%', top: '84%', width: '40%', height: '6%', background: '#1c1a17', borderRadius: '1px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '84%', width: '24%', height: '6%', background: '#8D1D2C', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Pastilles</span></button>
<button type="button" onClick={pick.Epinglees} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Epinglees}`, background: '#EDE7DE', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '10%', top: '12%', width: '40%', height: '46%', background: '#FFFFFF', borderRadius: '3px', transform: 'rotate(-6deg)' })}></div><div style={css({ position: 'absolute', left: '50%', top: '8%', width: '40%', height: '48%', background: '#FFFFFF', borderRadius: '3px', transform: 'rotate(4deg)' })}></div><div style={css({ position: 'absolute', left: '28%', top: '46%', width: '44%', height: '40%', background: '#FFFFFF', borderRadius: '3px', transform: 'rotate(-2deg)' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Épinglées</span></button>
<button type="button" onClick={pick.Etagere} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Etagere}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '6%', top: '44%', width: '88%', height: '3%', background: '#8D1D2C', borderRadius: '0px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '84%', width: '88%', height: '3%', background: '#8D1D2C', borderRadius: '0px' })}></div><div style={css({ position: 'absolute', left: '10%', top: '22%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '38%', top: '22%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '22%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '10%', top: '62%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '38%', top: '62%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '62%', width: '22%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Étagère</span></button>
<button type="button" onClick={pick.Diagonale} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Diagonale}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '6%', top: '12%', width: '50%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '25%', top: '40%', width: '50%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '44%', top: '68%', width: '50%', height: '22%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '74%', width: '28%', height: '6%', background: '#1c1a17', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Diagonale</span></button>
<button type="button" onClick={pick.Vedette} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Vedette}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '6%', top: '14%', width: '88%', height: '40%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '60%', width: '46%', height: '6%', background: '#1c1a17', borderRadius: '1px' })}></div><div style={css({ position: 'absolute', left: '70%', top: '60%', width: '24%', height: '6%', background: '#8D1D2C', borderRadius: '1px' })}></div><div style={css({ position: 'absolute', left: '6%', top: '74%', width: '19%', height: '18%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '29%', top: '74%', width: '19%', height: '18%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '52%', top: '74%', width: '19%', height: '18%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '75%', top: '74%', width: '19%', height: '18%', background: '#D9D2C7', borderRadius: '4px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Vedette</span></button>
<button type="button" onClick={pick.Damier} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Damier}`, background: '#F5EFE4', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '8%', top: '8%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '29.5%', top: '8%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '51%', top: '8%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '72.5%', top: '8%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '8%', top: '25%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '29.5%', top: '25%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '51%', top: '25%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '72.5%', top: '25%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '8%', top: '42%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '29.5%', top: '42%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '51%', top: '42%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '72.5%', top: '42%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '8%', top: '59%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '29.5%', top: '59%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '51%', top: '59%', width: '19%', height: '15%', background: '#F2C9A0', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '72.5%', top: '59%', width: '19%', height: '15%', background: '#D9D2C7', borderRadius: '3px' })}></div><div style={css({ position: 'absolute', left: '8%', top: '80%', width: '50%', height: '6%', background: '#1c1a17', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Damier</span></button>
<button type="button" onClick={pick.Encadre} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Encadre}`, background: '#8D1D2C', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '8%', top: '16%', width: '40%', height: '32%', background: '#F5EFE4', borderRadius: '4px', border: '2px solid #FFFFFF', boxSizing: 'border-box' })}></div><div style={css({ position: 'absolute', left: '52%', top: '16%', width: '40%', height: '32%', background: '#F5EFE4', borderRadius: '4px', border: '2px solid #FFFFFF', boxSizing: 'border-box' })}></div><div style={css({ position: 'absolute', left: '8%', top: '52%', width: '40%', height: '32%', background: '#F5EFE4', borderRadius: '4px', border: '2px solid #FFFFFF', boxSizing: 'border-box' })}></div><div style={css({ position: 'absolute', left: '52%', top: '52%', width: '40%', height: '32%', background: '#F5EFE4', borderRadius: '4px', border: '2px solid #FFFFFF', boxSizing: 'border-box' })}></div><div style={css({ position: 'absolute', left: '8%', top: '88%', width: '50%', height: '5%', background: '#FFFFFF', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Encadré</span></button>
<button type="button" onClick={pick.Nuit} style={css({ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' })}><div style={css({ aspectRatio: '1/1', borderRadius: '8px', border: `2px solid ${sel.Nuit}`, background: '#1c1a17', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' })}><div style={css({ position: 'absolute', left: '8%', top: '16%', width: '26%', height: '50%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '37%', top: '16%', width: '26%', height: '50%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '16%', width: '26%', height: '50%', background: '#D9D2C7', borderRadius: '4px' })}></div><div style={css({ position: 'absolute', left: '8%', top: '76%', width: '50%', height: '8%', background: '#FFFFFF', borderRadius: '1px' })}></div><div style={css({ position: 'absolute', left: '66%', top: '76%', width: '26%', height: '8%', background: '#F2C9A0', borderRadius: '1px' })}></div></div><span style={css({ fontSize: '11px', color: '#1c1a17', textAlign: 'center' })}>Nuit</span></button>
</div>
    </>
  )
}
