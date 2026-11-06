import { useEffect, useRef, useState } from 'react'
import './social.css'
import './franchise.css'
import { addDays, dShort } from '../../lib/social/format'
import { POST_TYPES, imageSocial } from '../../lib/social/refs'
import { ROOTS } from '../../lib/api/module'
import { apercuBoutique, enregistrerKit, enregistrerRegles, lireKit } from '../../lib/social/api-franchise'
import type { KitLigne, KitVue, Regles } from '../../lib/social/api-franchise'
import { boutiquesReseau, effacerAvis, enregistrer, journaliser, parId, useSocial } from '../../lib/social/store'
import type { Boutique, EtatSocial, Objet, Serveur } from '../../lib/social/store'

// ---------------------------------------------------------------------------
// Le visuel figé d'un modèle (repris de social/public/franchise-visuel.js)
// ---------------------------------------------------------------------------

const STYLES: [string, string][] = [
  ['epure', 'Épuré'],
  ['abricot', 'Abricot'],
  ['ruby', 'Ruby'],
  ['noir', 'Noir'],
  ['plein', 'Plein cadre'],
  ['duo', 'Duo'],
]
const PROMOS: [string, string][] = [
  ['aucune', 'Aucune'],
  ['remise', 'Remise en %'],
  ['offre', 'Offre (4+1…)'],
  ['prix', 'Prix promotionnel'],
]

interface Produit {
  name: string
  nameNl?: string
  price?: string
  img?: string
  kind?: string
  apiId?: number
  categoryId?: number
}
interface Promo {
  kind: string
  min?: number
  max?: number
  offres?: string[]
}
interface Modele {
  id: string
  order?: number
  name: string
  description?: string
  active?: boolean
  type?: string
  fb?: boolean
  ig?: boolean
  validation?: boolean
  title?: string
  text?: string
  textNl?: string
  product?: string
  promo?: Promo
  period?: boolean
  free?: number
  photo?: string
  visual?: { style?: string; eyebrow?: string; eyebrowNl?: string; media?: { kind?: string; src: string }[] }
  campaign?: string | null
  link?: string
}
interface Exemple {
  product: Produit | null
  discount: number | ''
  offer: string
  promoPrice: string
  from: string
  to: string
  free: string
  photo: string | null
}

const jm = (iso: string) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : ''
}

/** Les variables d'un modèle, à partir de ce que le franchisé a saisi. */
function vars(tpl: Modele, f: Exemple, lang: string): Record<string, string> {
  const p = f.product
  const promo = tpl.promo?.kind ?? 'aucune'
  return {
    produit: p ? (lang === 'nl' && p.nameNl ? p.nameNl : p.name) : '',
    prix: p ? p.price ?? '' : '',
    remise: promo === 'remise' && f.discount ? String(f.discount) : '',
    offre: promo === 'offre' ? f.offer || '' : '',
    prix_promo: promo === 'prix' ? f.promoPrice || '' : '',
    du: jm(f.from),
    au: jm(f.to),
    libre: f.free || '',
  }
}
const remplir = (t: string | undefined, v: Record<string, string>) =>
  String(t || '').replace(/\{(produit|prix|remise|offre|prix_promo|du|au|libre)\}/g, (_, k: string) => v[k] || '')

/** Les réglages du visuel pour un modèle et des valeurs (ce que le studio dessinerait). */
function controle(tpl: Modele, f: Exemple, lang: string) {
  const L = lang === 'nl' ? 'nl' : 'fr'
  const v = vars(tpl, f, L)
  const vis = tpl.visual ?? {}
  const promo = tpl.promo?.kind ?? 'aucune'
  const per = v.du && v.au ? (L === 'nl' ? `van ${v.du} tot ${v.au}` : `du ${v.du} au ${v.au}`) : ''
  const promoTxt = promo === 'remise' && v.remise ? `-${v.remise}%` : promo === 'offre' ? v.offre : ''
  const price = promo === 'prix' && v.prix_promo ? v.prix_promo : v.prix
  const title = v.produit || remplir(tpl.title, v) || tpl.name || ''
  const photo = f.photo ? f.photo : f.product?.img ?? null
  return {
    style: vis.style || 'epure',
    eyebrow: [L === 'nl' ? vis.eyebrowNl || vis.eyebrow || '' : vis.eyebrow || '', promo !== 'aucune' ? per : ''].filter(Boolean).join(' · '),
    title,
    phrase: v.libre,
    price: price || '',
    unit: L === 'nl' ? 'Per stuk' : 'La pièce',
    promo: promoTxt,
    promoSub: promo === 'offre' ? (L === 'nl' ? 'actie' : 'offre') : promo === 'remise' ? (L === 'nl' ? 'korting' : 'de remise') : '',
    site: 'www.latelierby.be',
    photo,
  }
}

/** Ce que le modèle ouvre au franchisé, en clair. */
function resume(tpl: Modele): string {
  const p = tpl.promo ?? { kind: 'aucune' }
  const out: string[] = []
  // Modèle créé depuis un post du réseau : visuel et texte figés, seule la date (et une phrase, si ouverte) change.
  if (tpl.visual?.style === 'fixe') return ['visuel du réseau', +(tpl.free ?? 0) > 0 ? `phrase de ${tpl.free} car. max` : 'date et heure seulement'].join(' · ')
  if (tpl.product === 'choix') out.push('produit de son catalogue')
  if (p.kind === 'remise') out.push(`remise ${p.min || 0}–${p.max || 0} %`)
  if (p.kind === 'offre') out.push(`offre : ${(p.offres ?? []).join(', ')}`)
  if (p.kind === 'prix') out.push('prix promotionnel')
  if (tpl.period) out.push('période')
  if (+(tpl.free ?? 0) > 0) out.push(`phrase de ${tpl.free} car. max`)
  out.push(tpl.photo === 'upload' ? 'sa photo (obligatoire)' : tpl.photo === 'choix' ? 'sa photo ou celle du catalogue' : 'photo du catalogue')
  return out.join(' · ')
}

// ---------------------------------------------------------------------------
// Les variables d'une boutique (repris de social-data.js : fill, webshopUrl)
// ---------------------------------------------------------------------------

interface Plan {
  cats: Record<string, number>
  prods: Record<string, number>
}
function planDe(serveur: Serveur): Plan {
  const plan: Plan = { cats: {}, prods: {} }
  const nav = serveur.webshopPlan as
    | { categories?: { id: number; groupe?: number }[]; produits?: { id: number; cat?: number }[]; cats?: Record<string, number>; prods?: Record<string, number> }
    | undefined
  if (!nav) return plan
  ;(nav.categories ?? []).forEach((c) => {
    if (c && c.id) plan.cats[c.id] = Math.max(+(c.groupe ?? 0) || 0, plan.cats[c.id] || 0)
  })
  ;(nav.produits ?? []).forEach((p) => {
    if (p && p.id && p.cat) plan.prods[p.id] = p.cat
  })
  Object.entries(nav.cats ?? {}).forEach(([k, v]) => (plan.cats[k] = Math.max(+v || 0, plan.cats[k] || 0)))
  Object.entries(nav.prods ?? {}).forEach(([k, v]) => {
    if (v) plan.prods[k] = +v
  })
  return plan
}

/** Le webshop d'une boutique, ou une page de ce webshop (comme le serveur, src/publish.php). */
function webshopUrl(serveur: Serveur, etat: EtatSocial, plan: Plan, shopId: string, product: Produit | null, categoryId = 0, groupId = 0, fiche = true): string {
  const base = (serveur.webshopUrl as string | undefined) || 'https://webshop.atelierby.be/'
  const sh = shopId ? parId(etat.shops, shopId) : undefined
  const q: [string, string][] = []
  if (shopId && !sh?.test && /^\d+$/.test(shopId)) q.push(['shop', shopId])
  const pid = product && product.apiId && product.kind !== 'gamme' ? +product.apiId : 0
  let cat = +categoryId || 0
  let grp = +groupId || 0
  if (pid && !cat) cat = +(product?.categoryId ?? 0) || plan.prods[pid] || 0
  if (cat) {
    grp = grp || plan.cats[cat] || 0
    if (grp) q.push(['category', `group:${grp}`], ['sub', `category:${cat}`])
    else q.push(['category', `category:${cat}`])
  } else if (grp) q.push(['category', `group:${grp}`])
  if (pid) {
    q.push(['product', String(pid)])
    if (fiche) q.push(['open', 'product'])
  }
  return q.length ? `${base}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%3A/g, ':')}`).join('&')}` : base
}

/** Sans horaires (magasin test), la phrase qui cite {horaires} disparaît plutôt que « Ouvert . » (comme le serveur). */
const sansHoraires = (t: string) =>
  t
    .replace(/[ \t]*[^.!?\n]*\{horaires\}[^.!?\n]*[.!?]?/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+(\n|$)/g, '$1')

/** Les variables d'une boutique dans un texte : {ville}, {adresse}, {horaires}, {webshop}… */
function remplirBoutique(serveur: Serveur, etat: EtatSocial, plan: Plan, text: string, s: Boutique | undefined, lang: string): string {
  const L = lang
  const h = s ? (L === 'nl' && s.hoursNl ? s.hoursNl : s.hours) : '{horaires}'
  const ws = (p: Produit | null, c = 0, g = 0, fiche = true) => webshopUrl(serveur, etat, plan, s ? s.id : '', p, c, g, fiche)
  return (s && !String(h || '').trim() ? sansHoraires(String(text || '')) : String(text || ''))
    .replace(/\{horaires\}/g, s ? h ?? '' : '{horaires}')
    .replace(/\{produit_du_jour\}/g, L === 'nl' ? 'Krokante brioche' : 'Brioche croustillante')
    .replace(/\{ville\}/g, s ? s.name : '{ville}')
    .replace(/\{adresse\}/g, s ? s.address ?? '' : '{adresse}')
    .replace(/\{prix\}/g, '{prix}')
    .replace(/\{webshop_produit:liste\}/g, ws(null, 0, 0, false))
    .replace(/\{webshop_(produit|categorie|groupe):(\d+)(:liste)?\}/g, (_m, k: string, id: string, liste?: string) =>
      k === 'produit' ? ws({ name: '', apiId: +id, kind: 'produit' }, 0, 0, !liste) : k === 'categorie' ? ws(null, +id) : ws(null, 0, +id),
    )
    .replace(/\{webshop_produit\}/g, ws(null))
    .replace(/\{webshop_categorie\}/g, ws(null))
    .replace(/\{webshop\}/g, ws(null))
    .replace(/\{hashtag_ville\}/g, s ? `#${String(s.name || '').replace(/[^\p{L}\p{N}]/gu, '')}` : '{hashtag_ville}')
}

const langsDe = (etat: EtatSocial, id: string) => {
  const s = parId(etat.shops, id)
  return s?.langs?.length ? s.langs : ['fr']
}
const copie = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const versKit = (v: KitVue): KitLigne[] => (v.tous ?? []).map((k) => ({ id: k.id, modele: k.modele, date: k.date, note: k.note || '' }))

const REGLES_NUM: [string, string, number, number][] = [
  ['quotaSemaine', 'Posts par semaine (par boutique)', 0, 50],
  ['delaiMinHeures', 'Délai minimum (heures)', 1, 336],
  ['horizonJours', 'Au plus tard dans (jours)', 1, 90],
  ['recurrenceMax', 'Post récurrent : au plus (fois, 0 = non)', 0, 26],
  ['remiseMax', 'Remise maximale (%)', 0, 90],
  ['promoDureeMax', 'Durée max d’une promotion (jours)', 1, 90],
  ['delaiReponseHeures', 'Répondre aux commentaires et avis dans les (heures) — au-delà, signalés en retard', 1, 168],
]
const JOURS: [number, string][] = [
  [1, 'lun.'],
  [2, 'mar.'],
  [3, 'mer.'],
  [4, 'jeu.'],
  [5, 'ven.'],
  [6, 'sam.'],
  [0, 'dim.'],
]

/**
 * Espace franchisé — l'écran « Franchise » du module Social, réécrit dans le Marketing (docs/PORTAILS.md,
 * étape 2f). Ce que chaque boutique peut publier dans son espace (/social_franchisee) : les modèles
 * (textes et visuels figés, champs ouverts), le kit du mois, les règles du réseau et l'accès des boutiques.
 * Le visuel est montré en aperçu statique : le studio (« Posts Facebook ») n'est pas réécrit ici.
 */
export default function FranchiseView() {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  const [sel, setSel] = useState<string | null>(null)
  const [ed, setEd] = useState<Modele | null>(null)
  const [rules, setRules] = useState<Regles | null>(null)
  const [asShop, setAsShop] = useState('')
  const [pvLang, setPvLang] = useState<'fr' | 'nl'>('fr')
  const [err, setErr] = useState('')
  const [kit, setKit] = useState<KitLigne[] | null>(null)
  const [kitVue, setKitVue] = useState<KitVue | null>(null)
  const [kitBusy, setKitBusy] = useState(false)
  const [toast, setToast] = useState('')
  const tt = useRef<number | undefined>(undefined)
  const montrer = (m: string) => {
    window.clearTimeout(tt.current)
    setToast(m)
    tt.current = window.setTimeout(() => setToast(''), 4500)
  }
  useEffect(() => () => window.clearTimeout(tt.current), [])

  const pick = (t: Modele) => {
    setSel(t.id)
    setEd(copie(t))
    setErr('')
  }

  const pret = !!etat
  useEffect(() => {
    if (!etat) return
    const first = (etat.ftemplates as unknown as Modele[])[0]
    setRules({ ...(etat.franchise?.rules ?? {}) })
    setAsShop(boutiquesReseau(etat)[0]?.id ?? '')
    if (first) pick(first)
    lireKit()
      .then((v) => {
        setKitVue(v)
        setKit(versKit(v))
      })
      .catch(() => setKit([]))
    // Une fois, à l'arrivée de l'état.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pret])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const boutiques = boutiquesReseau(etat)
  const franchise = { ...(etat.franchise ?? { rules: {} }) }
  const url = String(franchise.url || ROOTS.socialFranchise || '/social_franchisee/').replace(/\/?$/, '/')
  const r: Regles = rules ?? franchise.rules ?? {}
  const R = (k: string, v: unknown) => setRules({ ...r, [k]: v })
  const tpls = etat.ftemplates as unknown as Modele[]
  const e = ed
  const E = (patch: Partial<Modele>) => {
    if (!ed) return
    setEd({ ...ed, ...patch })
    setErr('')
  }
  const num = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : Number(r[k] ?? 0))
  const igUnique = !!serveur.instagramUnique

  // Chiffres en tête
  const pending = etat.posts.filter((p) => p.origin === 'franchise' && p.status === 'À valider')
  const libre = (Array.isArray(r.accesLibre) ? (r.accesLibre as unknown[]) : String(r.accesLibre || '').split(',')).map(String).filter(Boolean)
  const nomsLibres = boutiques.filter((x) => libre.includes(String(x.id))).map((x) => x.name)
  const kpis = [
    {
      label: 'Espace',
      value: r.actif === false ? 'Fermé' : 'Ouvert',
      sub: r.validation === 'toujours' ? 'tout est validé par vous' : r.validation === 'jamais' ? 'publication directe' : 'validation selon le modèle',
      ton: r.actif === false ? 'is-alerte' : 'is-bon',
      href: '#regles',
    },
    { label: 'Modèles ouverts', value: `${tpls.filter((t) => t.active).length} / ${tpls.length}`, sub: 'textes et visuels figés', ton: '', href: '#modeles' },
    {
      label: 'À valider',
      value: String(pending.length),
      sub: 'propositions des boutiques',
      ton: pending.length ? 'is-moyen' : '',
      // Le calendrier n'est pas encore réécrit : il s'ouvre dans le rail (le filtre « À valider » ne suit pas).
      href: `?ecran=social-cal&status=${encodeURIComponent('À valider')}`,
    },
    {
      label: 'Accès des boutiques',
      value: libre.length ? `Ouvert · ${nomsLibres.join(', ')}` : 'Par l’ERP',
      sub: r.accesLibre && libre.length ? 'sans connexion, en attendant l’ERP' : 'session de l’ERP, boutique dans le lien',
      ton: '',
      href: '#acces',
    },
  ]

  const liste = tpls.slice().sort((a, b) => (+(a.order ?? 0) || 99) - (+(b.order ?? 0) || 99))

  const sauverModele = () => {
    if (!e) return
    const errs: string[] = []
    const remiseMax = num('remiseMax') || 90
    if (!String(e.name || '').trim()) errs.push('Nommez le modèle.')
    if (!String(e.text || '').trim()) errs.push('Le texte FR est obligatoire.')
    if (e.product === 'choix' && !/\{produit\}/.test(`${e.text ?? ''}${e.title ?? ''}`)) errs.push('Le modèle ouvre un produit : utilisez {produit} dans le titre ou le texte.')
    if (+(e.free ?? 0) > 0 && !/\{libre\}/.test(e.text ?? '')) errs.push('Le modèle ouvre une phrase libre : placez {libre} dans le texte.')
    if (e.period && !/\{du\}/.test(e.text ?? '')) errs.push('Le modèle a une période : placez {du} et {au} dans le texte.')
    const p = e.promo ?? { kind: 'aucune' }
    if (p.kind === 'remise' && (+(p.min ?? 0) < 1 || +(p.max ?? 0) < +(p.min ?? 0) || +(p.max ?? 0) > remiseMax))
      errs.push(`Remise : minimum ≥ 1, maximum ≥ minimum et ≤ ${num('remiseMax') || 90} % (plafond du réseau).`)
    if (p.kind === 'offre' && !(p.offres ?? []).length) errs.push('Indiquez au moins une offre.')
    if (!e.fb && !e.ig) errs.push('Ouvrez au moins un canal.')
    if (errs.length) {
      setErr(errs.join(' '))
      return
    }
    const out = tpls.some((x) => x.id === e.id) ? tpls.map((x) => (x.id === e.id ? e : x)) : tpls.concat(e)
    enregistrer({ ftemplates: out as unknown as Objet[] })
    journaliser('Espace franchisé', `Modèle « ${e.name} » enregistré${e.active ? '' : ' (fermé)'}`)
    setSel(e.id)
    montrer(`Modèle enregistré : les boutiques le voient ${e.active ? 'dès maintenant.' : 'quand il sera ouvert.'}`)
  }

  const sauverRegles = async () => {
    if (!((r.jours as number[] | undefined) ?? []).length) {
      montrer('Ouvrez au moins un jour de publication.')
      return
    }
    if (String(r.heureMax ?? '') <= String(r.heureMin ?? '')) {
      montrer('L’heure de fin doit suivre l’heure de début.')
      return
    }
    try {
      const res = (await enregistrerRegles(r)).rules
      enregistrer({ franchise: { ...franchise, url, rules: res } })
      setRules({ ...res })
      montrer('Règles enregistrées : elles s’appliquent aux prochaines publications des boutiques.')
    } catch (x) {
      montrer(`Enregistrement impossible : ${message(x)}`)
    }
  }

  const voirComme = async (shopId: string | undefined) => {
    if (!shopId) return
    // Le navigateur bloque une fenêtre ouverte après un appel réseau : on l'ouvre d'abord.
    const w = window.open('about:blank', '_blank')
    try {
      await apercuBoutique(shopId)
      if (w) w.location.href = `${url}calendrier?shop=${encodeURIComponent(shopId)}`
    } catch (x) {
      if (w) w.close()
      montrer(`Aperçu impossible : ${message(x)}`)
    }
  }

  const kitEnregistrer = () => {
    if (kitBusy) return
    setKitBusy(true)
    enregistrerKit(kit ?? [])
      .then((v) => {
        setKitBusy(false)
        setKitVue(v)
        setKit(versKit(v))
        montrer('Kit enregistré : les boutiques le voient dans « Créer un post ».')
      })
      .catch((x: unknown) => {
        setKitBusy(false)
        montrer(`Kit non enregistré : ${message(x) || 'erreur'}`)
      })
  }
  const kitPatch = (i: number, patch: Partial<KitLigne>) => setKit((kit ?? []).map((k, j) => (j === i ? { ...k, ...patch } : k)))
  const kitParId: Record<string, NonNullable<KitVue['items']>[number]> = {}
  ;(kitVue?.items ?? []).forEach((k) => (kitParId[k.id] = k))
  const kitModeles = (kitVue?.modeles ?? tpls.map((t) => ({ id: t.id, nom: t.name, actif: t.active !== false }))).map((m) => ({
    id: m.id,
    nom: m.nom + (m.actif ? '' : ' (fermé)'),
  }))

  const valMode = String(r.validation ?? '')
  const valLocked = valMode !== 'modele'

  return (
    <div className="social-native franchise">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode franchise__intro">
            Chaque boutique y voit son calendrier, les opérations du réseau et publie ses posts et ses promotions — uniquement avec les modèles, les champs et
            les règles que vous fixez ici · <code>/social_franchisee</code>
          </span>
          <span className="franchise__espace" />
          <select className="franchise__select" value={asShop} onChange={(ev) => setAsShop(ev.target.value)} aria-label="Boutique">
            {boutiques.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => void voirComme(asShop || boutiques[0]?.id)}>
            Voir comme cette boutique ↗
          </button>
        </div>
      </div>

      {avis ? (
        <p className="warning franchise__avis">
          {avis}{' '}
          <button type="button" className="linklike" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      <div className="franchise__kpis">
        {kpis.map((k) => (
          <a key={k.label} href={k.href} className={`card franchise__kpi${k.label === 'À valider' && pending.length ? ' is-attente' : ''}`}>
            <span className="kpi__label">{k.label}</span>
            <span className={`franchise__kpi-val ${k.ton}`}>{k.value}</span>
            <span className="muted franchise__petit">{k.sub}</span>
          </a>
        ))}
      </div>

      {/* ============ MODÈLES ============ */}
      <section id="modeles" className="card franchise__section">
        <div className="franchise__tete">
          <div className="franchise__tete-txt">
            <span className="franchise__etiquette">1 · Modèles ouverts aux boutiques</span>
            <span className="muted franchise__petit">Le texte, le titre et le visuel sont figés ; la boutique ne remplit que les champs que vous ouvrez.</span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSel(null)
              setErr('')
              setEd({
                id: `ft${Date.now()}`,
                order: tpls.length + 1,
                name: 'Nouveau modèle',
                description: '',
                active: false,
                type: 'Produit',
                fb: true,
                ig: true,
                validation: true,
                title: '{produit}',
                text: '{produit} chez L’Atelier By {ville}.',
                textNl: '{produit} bij L’Atelier By {ville}.',
                product: 'choix',
                promo: { kind: 'aucune' },
                period: false,
                free: 0,
                photo: 'choix',
                visual: { style: 'epure', eyebrow: '', eyebrowNl: '' },
              })
            }}
          >
            Nouveau modèle
          </button>
        </div>
        <div className="franchise__modeles">
          <div className="franchise__liste">
            {liste.map((t) => (
              <button key={t.id} type="button" className={`franchise__modele${sel === t.id ? ' is-on' : ''}`} onClick={() => pick(t)}>
                <span className="franchise__modele-tete">
                  <span>{t.name}</span>
                  <span className="franchise__tags">
                    <span className={`franchise__tag${t.active ? ' is-ouvert' : ''}`}>{t.active ? 'ouvert' : 'fermé'}</span>
                    {r.validation === 'toujours' || (r.validation === 'modele' && !!t.validation) ? <span className="franchise__tag is-valider">à valider</span> : null}
                  </span>
                </span>
                <span className="muted franchise__resume">
                  {t.description ? `${t.description} — ` : ''}
                  {resume(t)}
                </span>
              </button>
            ))}
          </div>

          {e ? (
            <Editeur
              e={e}
              E={E}
              etat={etat}
              serveur={serveur}
              tpls={tpls}
              r={r}
              num={num}
              pvLang={pvLang}
              setPvLang={setPvLang}
              valLocked={valLocked}
              err={err}
              onSave={sauverModele}
              onDup={() => {
                setEd({ ...copie(e), id: `ft${Date.now()}`, name: `${e.name} (copie)`, order: tpls.length + 1 })
                setSel(null)
              }}
              onDel={() => {
                if (!tpls.some((x) => x.id === e.id)) {
                  setEd(null)
                  setSel(null)
                  return
                }
                if (!window.confirm(`Supprimer le modèle « ${e.name} » ? Les posts déjà créés restent.`)) return
                enregistrer({ ftemplates: tpls.filter((x) => x.id !== e.id) as unknown as Objet[] })
                journaliser('Espace franchisé', `Modèle « ${e.name} » supprimé`)
                setEd(null)
                setSel(null)
                montrer('Modèle supprimé.')
              }}
            />
          ) : null}
        </div>
      </section>

      {/* ============ KIT DU MOIS ============ */}
      <section id="kit" className="card franchise__section">
        <div className="franchise__tete">
          <div className="franchise__tete-txt">
            <span className="franchise__titre">Kit du mois</span>
            <span className="muted franchise__petit">
              Les posts que chaque boutique publie ce mois-ci : un modèle, une date conseillée, un mot. La boutique les retrouve en tête de « Créer un post »,
              préremplis ; vous voyez qui les a programmés.
            </span>
          </div>
          <div className="franchise__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setKit((kit ?? []).concat({ id: '', modele: kitModeles[0]?.id ?? '', date: addDays(serveur.today, 7), note: '' }))}
            >
              + Ajouter un post
            </button>
            <button type="button" className={`btn${kitBusy ? ' is-busy' : ''}`} onClick={kitEnregistrer}>
              {kitBusy ? 'Enregistrement…' : 'Enregistrer le kit'}
            </button>
          </div>
        </div>
        {kit && !kit.length ? (
          <span className="muted franchise__vide">Aucun post dans le kit : « Ajouter un post » pour donner le rythme du mois aux boutiques.</span>
        ) : null}
        {(kit ?? []).map((k, i) => {
          const v = k.id ? kitParId[k.id] : undefined
          const faits = v ? v.boutiques.filter((b) => b.fait) : []
          return (
            <div key={`${k.id}-${i}`} className="franchise__kit">
              <input type="date" value={k.date} onChange={(ev) => kitPatch(i, { date: ev.target.value })} />
              <select value={k.modele} onChange={(ev) => kitPatch(i, { modele: ev.target.value })}>
                {kitModeles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={k.note ?? ''}
                maxLength={200}
                placeholder="Pourquoi ce post (ex. lancement de la gamme d’automne)"
                onChange={(ev) => kitPatch(i, { note: ev.target.value })}
              />
              <span
                className={`franchise__fait${v && faits.length === v.boutiques.length ? ' is-bon' : ''}`}
                title={
                  v
                    ? `Fait : ${faits.map((b) => b.nom).join(', ') || 'aucune'} · À faire : ${
                        v.boutiques
                          .filter((b) => !b.fait)
                          .map((b) => b.nom)
                          .join(', ') || 'aucune'
                      }`
                    : ''
                }
              >
                {v ? `${faits.length} / ${v.boutiques.length} boutiques l’ont programmé` : 'nouveau — enregistrez'}
              </span>
              <button type="button" className="btn btn--icon btn--danger" title="Retirer" aria-label="Retirer" onClick={() => setKit((kit ?? []).filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          )
        })}
      </section>

      <div className="franchise__deux">
        {/* ============ RÈGLES ============ */}
        <section id="regles" className="card franchise__section">
          <span className="franchise__etiquette">
            2 · Règles du réseau <code>vérifiées par le serveur</code>
          </span>
          <label className="franchise__case">
            <input type="checkbox" checked={r.actif !== false} onChange={() => R('actif', r.actif === false)} />
            Espace franchisé ouvert
          </label>
          <div className="franchise__bloc">
            <span className="franchise__libelle">Validation par le franchiseur</span>
            <div className="seg" role="group" aria-label="Validation par le franchiseur">
              {(
                [
                  ['toujours', 'Toujours'],
                  ['modele', 'Selon le modèle'],
                  ['jamais', 'Jamais'],
                ] as [string, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" className={valMode === k ? 'is-on' : ''} aria-pressed={valMode === k} onClick={() => R('validation', k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="franchise__bloc">
            <span className="franchise__libelle">Avis Google rouges d’une boutique (plainte, hygiène, santé) traités par</span>
            {/* Les commentaires Facebook et Instagram sont à la boutique. */}
            <div className="seg" role="group" aria-label="Avis Google rouges">
              {(
                [
                  ['reseau', 'Le réseau'],
                  ['franchise', 'La boutique'],
                ] as [string, string][]
              ).map(([k, label]) => {
                const on = String(r.rouges || 'reseau') === k
                return (
                  <button key={k} type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => R('rouges', k)}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="franchise__nums">
            {REGLES_NUM.map(([k, label, min, max]) => (
              <label key={k} className="franchise__champ">
                {label}
                <input type="number" min={min} max={max} value={r[k] == null ? '' : String(r[k])} onChange={(ev) => R(k, +ev.target.value)} />
              </label>
            ))}
          </div>
          <div className="franchise__bloc">
            <span className="franchise__libelle">Jours de publication</span>
            <div className="franchise__puces">
              {JOURS.map(([j, label]) => {
                const jours = (r.jours as number[] | undefined) ?? []
                const on = jours.includes(j)
                return (
                  <button key={j} type="button" className={`filter${on ? ' is-on' : ''}`} onClick={() => R('jours', on ? jours.filter((x) => x !== j) : jours.concat(j))}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="franchise__heures">
            Heures de publication de <input type="time" value={String(r.heureMin ?? '')} onChange={(ev) => R('heureMin', ev.target.value)} /> à{' '}
            <input type="time" value={String(r.heureMax ?? '')} onChange={(ev) => R('heureMax', ev.target.value)} />
          </div>
          <div className="franchise__cases">
            {(
              [
                ['fb', 'Facebook autorisé'],
                ['ig', igUnique ? 'Instagram : réservé au franchiseur (compte unique du réseau) — le franchisé n’en a qu’une vue' : 'Instagram autorisé'],
                ['voirReseau', 'Voir les posts du réseau'],
                ['voirCampagnes', 'Voir les opérations'],
                ['voirPublicites', 'Voir les publicités Meta qui passent autour de sa boutique (celles du réseau et les siennes)'],
                ['voirBudgetPub', 'Voir le budget et la dépense de ces publicités'],
                ['proposerBoost', 'Proposer au réseau de booster une de ses publications (la marque décide et paie)'],
                ['voirMessages', 'Voir les messages privés Instagram qui citent sa boutique (confiés automatiquement) et ceux de son propre Instagram'],
                ['repondreMessages', 'Répondre à ces messages depuis son espace (au nom du compte Instagram de la conversation)'],
                ['voirCommentaires', 'Voir les commentaires de sa Page (et ceux du réseau qui citent sa boutique), classés vert / orange / rouge, et les marquer traités'],
                ['voirAvisGoogle', 'Voir ses avis Google : note, cible, avis 5★ à obtenir, avis classés vert / orange / rouge à marquer traités'],
                ['repondreCommentaires', 'Répondre lui-même aux commentaires de sa Page depuis l’espace (la réponse part au nom de sa Page)'],
                ['voirClassement', 'Voir son rang dans le réseau (« Ma semaine » : régularité, réactivité, avis gagnés)'],
                ['voirResultats', 'Voir les résultats de sa boutique'],
                ['voirSuivi', 'Voir le suivi de sa boutique (abonnés, budget)'],
                ['voirAnalyse', 'Voir les vues et les abonnés de sa Page et de son Instagram (graphiques, sans le budget)'],
                ['story', 'Publier en story (story seule, ou post + story : 9:16, 24 h)'],
                [
                  'persoVisuel',
                  'Personnaliser le visuel : tous les réglages de « Créer un post » (style, modèles de visuel, format, fond, logo, illustration, textes et leurs couleurs, textes posés, photos), dans la charte de la marque',
                ],
              ] as [string, string][]
            ).map(([k, label]) => (
              <label key={k} className="franchise__case">
                <input type="checkbox" checked={r[k] !== false} onChange={() => R(k, r[k] === false)} />
                {label}
              </label>
            ))}
          </div>
          <label className="franchise__champ">
            Message d’accueil des boutiques
            <textarea rows={3} value={String(r.message ?? '')} onChange={(ev) => R('message', ev.target.value)} />
          </label>
          <div className="franchise__fin">
            <button type="button" className="btn" onClick={() => void sauverRegles()}>
              Enregistrer les règles
            </button>
          </div>
        </section>

        {/* ============ ACCÈS ============ */}
        <section id="acces" className="card franchise__section">
          <span className="franchise__etiquette">3 · Accès des boutiques · par l’ERP</span>
          <span className="franchise__prose">
            Les gérants entrent dans leur espace <span className="franchise__encre">depuis l’ERP</span>, où ils sont déjà connectés : pas de compte ni de code
            à gérer ici. L’ERP dit leurs boutiques ; le lien de l’espace porte la boutique (<code>?shop=</code>) et n’ouvre que l’une des leurs.
          </span>
          <div className="franchise__libre">
            <span className="franchise__encre">En attendant l’ERP, ouvrir l’espace sans connexion sur :</span>
            <div className="franchise__cases franchise__cases--ligne">
              {boutiques.map((x) => {
                const on = libre.includes(String(x.id))
                return (
                  <label key={x.id} className="franchise__case">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => R('accesLibre', on ? libre.filter((i) => i !== String(x.id)) : libre.concat(String(x.id)))}
                    />
                    {x.name} ({x.id})
                  </label>
                )
              })}
            </div>
            <span className="muted franchise__petit">
              {nomsLibres.length
                ? `Les liens ci-dessous ouvrent directement l’espace de ${nomsLibres.join(', ')}, sans connexion${
                    nomsLibres.length < boutiques.length ? ' — les autres boutiques restent fermées.' : '.'
                  }`
                : 'Sans l’ERP, l’espace reste fermé (seul l’aperçu « Voir comme cette boutique » l’ouvre).'}{' '}
              À enregistrer avec les règles. Une fois l’ERP branché, c’est lui qui ouvre l’espace : ce réglage ne joue plus.
            </span>
          </div>
          <div className="franchise__acces">
            {boutiques.map((sh) => (
              <div key={sh.id} className="franchise__acces-ligne">
                <span className="franchise__acces-nom">
                  <span>{sh.name}</span>
                  <code>{`${url}calendrier?shop=${encodeURIComponent(sh.id)}`}</code>
                </span>
                <button
                  type="button"
                  className="linklike"
                  title="Ouvrir l’espace de cette boutique comme son gérant le voit (aperçu, sans l’ERP)"
                  onClick={() => void voirComme(sh.id)}
                >
                  Voir comme cette boutique ↗
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {toast ? <div className="franchise__toast">{toast}</div> : null}
    </div>
  )
}

/** L'éditeur d'un modèle et son aperçu (« Ce que la boutique obtient »). */
function Editeur({
  e,
  E,
  etat,
  serveur,
  tpls,
  r,
  num,
  pvLang,
  setPvLang,
  valLocked,
  err,
  onSave,
  onDup,
  onDel,
}: {
  e: Modele
  E: (p: Partial<Modele>) => void
  etat: EtatSocial
  serveur: Serveur
  tpls: Modele[]
  r: Regles
  num: (k: string) => number
  pvLang: 'fr' | 'nl'
  setPvLang: (l: 'fr' | 'nl') => void
  valLocked: boolean
  err: string
  onSave: () => void
  onDup: () => void
  onDel: () => void
}) {
  const boutiques = boutiquesReseau(etat)
  const promo = e.promo ?? { kind: 'aucune' }
  // Aperçu : un produit du catalogue, des valeurs d'exemple.
  const catalogue = (serveur.catalogue ?? []) as unknown as Produit[]
  const prod = catalogue.find((c) => c.kind === 'produit' && c.price) ?? null
  const sample: Exemple = {
    product: e.product === 'choix' ? prod : null,
    discount: promo.kind === 'remise' ? Math.round(((+(promo.min ?? 0) || 10) + (+(promo.max ?? 0) || 30)) / 2) : '',
    offer: promo.kind === 'offre' ? (promo.offres ?? [])[0] ?? '' : '',
    promoPrice:
      promo.kind === 'prix' && prod
        ? (Math.round(parseFloat(String(prod.price).replace(',', '.')) * 80) / 100).toFixed(2).replace('.', ',')
        : '',
    from: e.period ? addDays(serveur.today, 3) : '',
    to: e.period ? addDays(serveur.today, 8) : '',
    free: +(e.free ?? 0) > 0 ? 'Dégustation de brioche samedi de 10 h à 12 h'.slice(0, +(e.free ?? 0)) : '',
    photo: null,
  }
  const L = pvLang
  const v = vars(e, sample, L)
  const shop0 = boutiques.find((x) => langsDe(etat, x.id).includes(L)) ?? boutiques[0]
  const plan = planDe(serveur)
  const texte = remplirBoutique(serveur, etat, plan, remplir(L === 'nl' ? e.textNl || e.text : e.text, v), shop0, L)
  const ctl = controle(e, sample, L)
  const fixe = e.visual?.style === 'fixe'
  const fixeMedia = (e.visual?.media ?? []).filter((m) => m.kind !== 'video').map((m) => m.src)
  const ops = etat.campaigns.filter((c) => c.status !== 'terminée')
  const liens: [string, string][] = [
    ['', 'Aucun lien'],
    ['{webshop}', 'Webshop de la boutique'],
    ['{webshop_produit}', 'Produit choisi, sur le webshop de la boutique'],
    ['{webshop_categorie}', 'Catégorie du produit, sur le webshop de la boutique'],
    ['https://www.latelierby.be', 'Site L’Atelier By'],
  ]
  if (e.link && !/^(\{webshop(_produit|_categorie)?\}|https:\/\/www\.latelierby\.be)?$/.test(e.link)) liens.push([e.link, `Lien actuel : ${e.link}`])
  const valNote =
    r.validation === 'toujours'
      ? 'Règle du réseau : tout post de boutique est validé par vous.'
      : r.validation === 'jamais'
        ? 'Règle du réseau : publication directe, sans validation.'
        : e.validation
          ? 'Les posts de ce modèle vous sont soumis avant publication.'
          : 'Les posts de ce modèle partent directement, dans les règles du réseau.'
  const pvSample =
    [
      sample.product ? `${sample.product.name} (${sample.product.price} €)` : '',
      sample.discount ? `-${sample.discount} %` : '',
      sample.offer || '',
      sample.from ? `du ${dShort(sample.from)} au ${dShort(sample.to)}` : '',
      sample.free ? `« ${sample.free} »` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'les textes du modèle'

  return (
    <div className="franchise__editeur">
      <div className="franchise__form">
        <div className="franchise__ligne">
          <label className="franchise__champ franchise__champ--2">
            Nom du modèle
            <input type="text" value={e.name} onChange={(ev) => E({ name: ev.target.value })} />
          </label>
          <label className="franchise__champ">
            Type
            <select value={e.type ?? ''} onChange={(ev) => E({ type: ev.target.value })}>
              {POST_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="franchise__champ">
          Description (vue par la boutique)
          <input type="text" value={e.description ?? ''} onChange={(ev) => E({ description: ev.target.value })} />
        </label>
        <div className="franchise__ligne">
          <label className="franchise__champ">
            Opération du réseau (campagne du Marketing)
            <select value={e.campaign ?? ''} onChange={(ev) => E({ campaign: ev.target.value || null })}>
              <option value="">Aucune</option>
              {ops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.boStatusCode === 'draft' ? ' (brouillon)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="franchise__champ">
            Lien proposé à la boutique
            <select value={e.link ?? ''} onChange={(ev) => E({ link: ev.target.value })}>
              {liens.map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="muted franchise__aide">
          Le post de la boutique est rattaché à l’opération choisie et renvoie vers son propre webshop ({'{webshop}'} → webshop.atelierby.be/?shop=n° de la
          boutique). La boutique peut retirer le lien, jamais en mettre un autre.
        </span>
        <div className="franchise__cases franchise__cases--ligne">
          <label className="franchise__case">
            <input type="checkbox" checked={!!e.active} onChange={() => E({ active: !e.active })} />
            Ouvert aux boutiques
          </label>
          <label className="franchise__case">
            <input type="checkbox" checked={!!e.validation} disabled={valLocked} onChange={() => !valLocked && E({ validation: !e.validation })} />
            À valider par le franchiseur
          </label>
          <label className="franchise__case">
            <input type="checkbox" checked={!!e.fb} onChange={() => E({ fb: !e.fb })} />
            Facebook
          </label>
          <label className="franchise__case">
            <input type="checkbox" checked={!!e.ig} onChange={() => E({ ig: !e.ig })} />
            Instagram
          </label>
        </div>
        <span className="muted franchise__aide">{valNote}</span>

        <div className="franchise__bloc franchise__bloc--filet">
          <span className="franchise__libelle">
            Texte figé · variables : <code className="franchise__vars">{'{produit} {prix} {remise} {offre} {prix_promo} {du} {au} {libre} · {ville} {adresse} {horaires}'}</code>
          </span>
          <label className="franchise__champ">
            Titre (calendrier)
            <input type="text" value={e.title ?? ''} onChange={(ev) => E({ title: ev.target.value })} />
          </label>
          <label className="franchise__champ">
            Texte FR
            <textarea rows={3} value={e.text ?? ''} onChange={(ev) => E({ text: ev.target.value })} />
          </label>
          <label className="franchise__champ">
            Texte NL (boutiques néerlandophones)
            <textarea rows={3} value={e.textNl ?? ''} onChange={(ev) => E({ textNl: ev.target.value })} />
          </label>
        </div>

        <div className="franchise__bloc franchise__bloc--filet">
          <span className="franchise__libelle">Ce que la boutique peut remplir</span>
          <div className="franchise__ligne">
            <label className="franchise__champ">
              Produit
              <select value={e.product ?? 'aucun'} onChange={(ev) => E({ product: ev.target.value })}>
                <option value="aucun">Aucun</option>
                <option value="choix">Un produit de son catalogue</option>
              </select>
            </label>
            <label className="franchise__champ">
              Promotion
              <select
                value={promo.kind || 'aucune'}
                onChange={(ev) => {
                  const k = ev.target.value
                  E({
                    promo: k === 'remise' ? { kind: k, min: 10, max: Math.min(30, num('remiseMax') || 30) } : k === 'offre' ? { kind: k, offres: ['4+1', '2+1'] } : { kind: k },
                  })
                }}
              >
                {PROMOS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!fixe ? (
              <label className="franchise__champ">
                Photo
                <select value={e.photo ?? 'choix'} onChange={(ev) => E({ photo: ev.target.value })}>
                  <option value="catalogue">Celle du catalogue</option>
                  <option value="choix">Sa photo ou celle du catalogue</option>
                  <option value="upload">Sa photo (obligatoire)</option>
                </select>
              </label>
            ) : null}
          </div>
          {promo.kind === 'remise' ? (
            <div className="franchise__heures">
              Remise de{' '}
              <input type="number" min={1} max={90} value={promo.min || 10} onChange={(ev) => E({ promo: { ...promo, min: +ev.target.value } })} /> à{' '}
              <input type="number" min={1} max={90} value={promo.max || 30} onChange={(ev) => E({ promo: { ...promo, max: +ev.target.value } })} /> %{' '}
              <span className="muted">(plafond du réseau : {num('remiseMax') || 30} %)</span>
            </div>
          ) : null}
          {promo.kind === 'offre' ? (
            <label className="franchise__champ">
              Offres proposées (séparées par des virgules)
              <input
                type="text"
                value={(promo.offres ?? []).join(', ')}
                onChange={(ev) =>
                  E({
                    promo: {
                      ...promo,
                      offres: ev.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .slice(0, 8),
                    },
                  })
                }
              />
            </label>
          ) : null}
          <div className="franchise__heures">
            <label className="franchise__case">
              <input type="checkbox" checked={!!e.period} onChange={() => E({ period: !e.period })} />
              Période (du … au …)
            </label>
            <span>
              Phrase libre{' '}
              <input type="number" min={0} max={200} value={e.free ?? 0} onChange={(ev) => E({ free: Math.max(0, Math.min(200, +ev.target.value || 0)) })} />{' '}
              caractères max <span className="muted">(0 = aucune · ni lien, ni @, ni #)</span>
            </span>
          </div>
        </div>

        <div className="franchise__bloc franchise__bloc--filet">
          <span className="franchise__libelle">Visuel figé</span>
          {fixe ? (
            <span className="franchise__encart">
              Visuel du réseau, repris tel quel d’un post (« Créer un post » → « Enregistrer comme modèle franchisé ») : la boutique ne le modifie pas. Pour le
              changer, recréez le modèle depuis le post.
            </span>
          ) : (
            <>
              <div className="franchise__puces">
                {STYLES.map(([k, label]) => (
                  <button key={k} type="button" className={`filter${e.visual?.style === k ? ' is-on' : ''}`} onClick={() => E({ visual: { ...e.visual, style: k } })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="franchise__ligne">
                <label className="franchise__champ">
                  Mention FR
                  <input type="text" value={e.visual?.eyebrow ?? ''} onChange={(ev) => E({ visual: { ...e.visual, eyebrow: ev.target.value } })} />
                </label>
                <label className="franchise__champ">
                  Mention NL
                  <input type="text" value={e.visual?.eyebrowNl ?? ''} onChange={(ev) => E({ visual: { ...e.visual, eyebrowNl: ev.target.value } })} />
                </label>
              </div>
            </>
          )}
        </div>

        {err ? <div className="franchise__erreur">{err}</div> : null}
        <div className="franchise__pied">
          <button type="button" className="btn btn--danger franchise__suppr" onClick={onDel}>
            Supprimer
          </button>
          <button type="button" className="btn" onClick={onDup}>
            Dupliquer
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave}>
            {tpls.some((x) => x.id === e.id) ? 'Enregistrer le modèle' : 'Créer le modèle'}
          </button>
        </div>
      </div>

      <div className="franchise__apercu">
        <div className="franchise__apercu-tete">
          <span className="franchise__etiquette">Ce que la boutique obtient</span>
          <div className="seg" role="group" aria-label="Langue de l’aperçu">
            {(['fr', 'nl'] as const).map((k) => (
              <button key={k} type="button" className={pvLang === k ? 'is-on' : ''} aria-pressed={pvLang === k} onClick={() => setPvLang(k)}>
                {k.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="franchise__post">
          {fixe ? (
            <div className="franchise__fixe" style={{ gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, fixeMedia.length))}, minmax(0, 1fr))` }}>
              {fixeMedia.slice(0, 4).map((m, i) => (
                <img key={i} src={imageSocial(m)} alt="" />
              ))}
            </div>
          ) : (
            <Visuel c={ctl} />
          )}
          <p className="franchise__post-texte">{texte || '—'}</p>
        </div>
        <span className="muted franchise__aide">
          Exemple avec {pvSample}. Les variables de la boutique ({'{ville}'}, {'{horaires}'}…) sont remplies à la publication.
        </span>
      </div>
    </div>
  )
}

/**
 * L'aperçu statique du visuel : le style, la mention, le titre, le prix, l'offre et la photo du produit
 * d'exemple, tels que le modèle les fige. Le rendu exact est celui du studio (« Posts Facebook »), qui n'est
 * pas réécrit dans le Marketing : ici, une maquette fidèle aux réglages, pas le visuel publié.
 */
function Visuel({ c }: { c: ReturnType<typeof controle> }) {
  const photo = c.photo ? imageSocial(c.photo) : ''
  return (
    <div className={`franchise__visuel is-${c.style}`}>
      {photo ? <img className="franchise__visuel-photo" src={photo} alt="" /> : <span className="franchise__visuel-photo franchise__visuel-sans" />}
      <div className="franchise__visuel-textes">
        <span className="franchise__visuel-logo">L’Atelier By</span>
        {c.eyebrow ? <span className="franchise__visuel-mention">{c.eyebrow}</span> : null}
        {c.title ? <span className="franchise__visuel-titre">{c.title}</span> : null}
        {c.phrase ? <span className="franchise__visuel-phrase">{c.phrase}</span> : null}
        <span className="franchise__visuel-prix">
          {c.price ? (
            <span>
              {c.price} € <span className="franchise__visuel-unite">{c.unit}</span>
            </span>
          ) : null}
          {c.promo ? (
            <span className="franchise__visuel-promo">
              {c.promo} <span className="franchise__visuel-unite">{c.promoSub}</span>
            </span>
          ) : null}
        </span>
        <span className="franchise__visuel-site">{c.site}</span>
      </div>
      <span className="franchise__visuel-note">Aperçu indicatif · rendu final par le studio</span>
    </div>
  )
}
