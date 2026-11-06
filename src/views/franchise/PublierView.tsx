import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import '../social/social.css'
import './publier.css'
import {
  DAYS,
  addDays,
  aValider,
  check,
  creerPost,
  d2,
  dLabel,
  dShort,
  iso,
  langues,
  lienFranchise,
  media,
  pad,
  remplir,
  serieDates,
  useFranchise,
  webshopUrl,
} from '../../lib/franchise/store'
import type { EtatFranchise, Modele, Produit, SaisiePost } from '../../lib/franchise/store'
import { lireCalendrier, lireKit, lireOffres, photoLocale } from '../../lib/franchise/api'
import { FORMATS, STYLES, control, fill, vars } from '../../lib/franchise/visuel'
import type { ChampsVisuel, ReglagesVisuel } from '../../lib/franchise/visuel'
import VisuelPost from './VisuelPost'
import type { VisuelHandle } from './VisuelPost'

export interface PublierViewProps {
  /**
   * Après la programmation : le calendrier de l'espace, sur le post créé (`post=<id>&ok=valider|prog[&n=N][&f=story|post_story]`).
   * Sans elle, l'écran ouvre `?ecran=sf-cal&…`.
   */
  onCalendrier?: (query: string) => void
}

interface Promo {
  id: number | string
  type?: string
  nom: string
  libelle: string
  court?: string
  du?: string | null
  au?: string | null
  portee?: string
  mention?: string
  mentionNl?: string
}
interface Formule {
  nom: string
  court?: string
  libelle: string
  choix?: string[]
  mention?: string
  mentionNl?: string
}
interface Offres {
  promotions?: Promo[]
  formules?: Formule[]
  erreur?: string
}
type OffreActive = ((Promo & { genre: 'promotion' }) | (Formule & { genre: 'formule'; id?: undefined; du?: undefined; au?: undefined })) & { produit: string }
interface KitItem {
  id: string
  modele: string
  nom: string
  date: string
  note?: string
  fait: boolean
  faitLe?: string | null
  passe: boolean
}
interface PubliMeta {
  time: string
  channel: string
  title?: string
  type?: string
}

type Etape = 'modele' | 'offre' | 'texte' | 'visuel' | 'pub'
type Format = 'post' | 'story' | 'post_story'
type Langue = string

interface Saisie {
  tpl: string | null
  filter: 'promo' | 'all'
  q: string
  product: string | null
  discount: number
  offer: string
  promoPrice: string
  from: string
  to: string
  free: string
  photo: string | null
  fb: boolean
  ig: boolean
  date: string
  time: string
  lang: Langue
  link: string
  pmode: 'mine' | 'illus' | null
  pv: 'fb' | 'ig' | 'story'
  tel: boolean
  format: Format
  rec: string
  recN: number
  wz: Etape
  apiOffre: OffreActive | null
  /** Réglages du visuel par-dessus celui du modèle ; textes par langue ; zoom et cadrage de la photo. */
  vo: Partial<ReglagesVisuel>
  vt: Record<string, Partial<ReglagesVisuel>>
  adj: { zoom?: number; x?: number; y?: number }
}

const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const norm = (x: string) =>
  String(x || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'erreur'
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const estFixe = (t: Modele | null | undefined) => t?.visual?.style === 'fixe'
const aPromo = (t: Modele) => (t.promo?.kind || 'aucune') !== 'aucune'

/** Le premier créneau permis par les règles du réseau. */
function premierCreneau(e: EtatFranchise): { date: string; time: string } {
  const r = e.rules
  const start = new Date(Date.now() + r.delaiMinHeures * 3600000 + 5 * 60000)
  for (let i = 0; i <= r.horizonJours; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (!(r.jours || []).includes(d.getDay())) continue
    let t = i === 0 ? `${pad(d.getHours())}:${pad((Math.ceil(d.getMinutes() / 15) * 15) % 60)}` : ''
    if (i === 0 && d.getMinutes() > 45) t = `${pad(d.getHours() + 1)}:00`
    if (!t || t < r.heureMin) t = r.heureMin < '09:00' && r.heureMax >= '09:00' ? '09:00' : r.heureMin
    if (t > r.heureMax) continue
    return { date: iso(d), time: t }
  }
  return { date: iso(start), time: r.heureMin }
}

/** Un jour choisi (calendrier « + », kit du mois) : ce jour-là, s'il est dans les règles du réseau. */
function creneauDuJour(e: EtatFranchise, jour: string | null) {
  const r = e.rules
  const slot = premierCreneau(e)
  if (/^\d{4}-\d{2}-\d{2}$/.test(jour || '') && String(jour) > slot.date && String(jour) <= addDays(e.today, r.horizonJours) && (r.jours || []).includes(d2(String(jour)).getDay()))
    return { date: String(jour), time: r.heureMin < '09:00' && r.heureMax >= '09:00' ? '09:00' : r.heureMin }
  return slot
}

/** Les champs d'un modèle choisi (changer de modèle repart de lui). */
function pourModele(t: Modele, e: EtatFranchise): Partial<Saisie> {
  const p = t.promo || {}
  const r = e.rules
  return {
    tpl: t.id,
    product: null,
    apiOffre: null,
    format: 'post',
    rec: 'une',
    discount: p.kind === 'remise' ? Math.min(Number(p.max), Number(r.remiseMax), Math.max(Number(p.min), 20)) : 0,
    offer: p.kind === 'offre' ? (p.offres || [])[0] || '' : '',
    promoPrice: '',
    free: '',
    photo: null,
    pmode: null,
    vo: {},
    vt: {},
    adj: {},
    link: t.link ? 'modele' : 'aucun',
    fb: !!(t.fb && r.fb && e.shop.fb === 'connected'),
    ig: !!(t.ig && r.ig && e.shop.igs === 'connected'),
  }
}

function initiale(e: EtatFranchise): Saisie {
  const filtre = param('promo') ? 'promo' : 'all'
  const slot = creneauDuJour(e, param('date'))
  const base: Saisie = {
    tpl: null,
    filter: filtre,
    q: '',
    product: null,
    discount: 0,
    offer: '',
    promoPrice: '',
    from: slot.date,
    to: addDays(slot.date, Math.min(6, e.rules.promoDureeMax - 1)),
    free: '',
    photo: null,
    fb: true,
    ig: true,
    date: slot.date,
    time: slot.time,
    lang: langues(e)[0],
    link: 'aucun',
    pmode: null,
    pv: 'fb',
    tel: false,
    format: 'post',
    rec: 'une',
    recN: 4,
    wz: 'modele',
    apiOffre: null,
    vo: {},
    vt: {},
    adj: {},
  }
  const voulu = param('template')
  const t = (voulu && e.templates.find((x) => x.id === voulu)) || (filtre === 'promo' && e.templates.find(aPromo)) || e.templates[0]
  return t ? { ...base, ...pourModele(t, e) } : base
}

/** Un bloc de l'assistant : son titre en capitales (l'explication en info-bulle), puis ses champs. */
function Section({ titre, children, aide }: { titre: string; children: ReactNode; aide?: string }) {
  return (
    <section className="card fpub__bloc">
      <span className="fpub__etiquette" title={aide}>
        {titre}
      </span>
      {children}
    </section>
  )
}

/** Une photo importée, réduite à 2048 px (JPEG). */
function lirePhoto(file: File | undefined): Promise<string | null> {
  return new Promise((res) => {
    if (!file || !/^image\//.test(file.type)) return res(null)
    const rd = new FileReader()
    rd.onerror = () => res(null)
    rd.onload = () => {
      const img = new Image()
      img.onerror = () => res(null)
      img.onload = () => {
        const big = Math.max(img.width, img.height)
        const k = big > 2048 ? 2048 / big : 1
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k)
        c.height = Math.round(img.height * k)
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
        res(c.toDataURL('image/jpeg', 0.88))
      }
      img.src = String(rd.result)
    }
    rd.readAsDataURL(file)
  })
}

/**
 * « Créer un post » de l'espace franchisé — Publier.dc.html, réécrit dans le Marketing. Un assistant horizontal :
 * le modèle ouvert par le réseau, le produit et l'offre (promotions, bundles et formules TFBuddy), le texte et le
 * lien, le visuel (photo et réglages si le réseau les ouvre), puis la date, le format et la répétition ; l'aperçu
 * Facebook / Instagram / story à droite. Le serveur revérifie toutes les règles du réseau.
 */
export default function PublierView(props: PublierViewProps = {}) {
  const { etat, erreur, chargement } = useFranchise()
  if (chargement === 'attente') return <p className="muted">Lecture de votre espace…</p>
  if (!etat) return <p className="error">{erreur || 'Chargement impossible.'}</p>
  return <Publier etat={etat} props={props} />
}

function Publier({ etat, props }: { etat: EtatFranchise; props: PublierViewProps }) {
  const r = etat.rules
  const [s, setS] = useState<Saisie>(() => initiale(etat))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [kit, setKit] = useState<KitItem[]>([])
  const [offres, setOffres] = useState<Record<string, Offres>>({})
  const [offresLoading, setOffresLoading] = useState(false)
  const [ws, setWs] = useState<Record<string, string>>({})
  const [wsErr, setWsErr] = useState('')
  const [jour, setJour] = useState<{ date: string; posts: PubliMeta[]; err?: boolean } | null>(null)
  const visuel = useRef<VisuelHandle>(null)

  const S = (patch: Partial<Saisie>) => {
    setErrors([])
    setS((x) => ({ ...x, ...patch }))
  }

  const t = s.tpl ? (etat.templates.find((x) => x.id === s.tpl) ?? null) : null
  const prod: Produit | null = s.product ? (etat.catalogue.find((p) => p.id === s.product) ?? null) : null
  const q = etat.quota || { used: 0, max: r.quotaSemaine }
  const quotaFull = q.used >= q.max

  // Le kit du mois.
  useEffect(() => {
    lireKit<{ items?: KitItem[] }>()
      .then((x) => setKit(x?.items || []))
      .catch(() => {})
  }, [])

  // Ce qui est déjà prévu le jour choisi (publications de la Page lues chez Meta).
  useEffect(() => {
    const d = s.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    let vivant = true
    lireCalendrier<{ posts?: PubliMeta[] }>(d, d)
      .then((x) => vivant && setJour({ date: d, posts: x?.posts || [] }))
      .catch(() => vivant && setJour({ date: d, posts: [], err: true }))
    return () => {
      vivant = false
    }
  }, [s.date])

  // La photo du produit sur le webshop, rapatriée par le module (sinon le visuel ne s'exporte pas).
  const wsSrc = prod?.photo || ''
  useEffect(() => {
    if (!wsSrc || ws[wsSrc]) return
    let vivant = true
    photoLocale(wsSrc)
      .then((d) => {
        if (!vivant) return
        setWs((x) => ({ ...x, [wsSrc]: d }))
        setWsErr('')
      })
      .catch((e) => vivant && setWsErr(message(e)))
    return () => {
      vivant = false
    }
  }, [wsSrc, ws])

  // Les promotions, bundles et formules du produit choisi (TFBuddy), une fois par produit.
  useEffect(() => {
    const k = s.product
    if (!t || !k || offres[k]) return
    let vivant = true
    setOffresLoading(true)
    lireOffres<Offres>(k)
      .then((x) => vivant && setOffres((o) => ({ ...o, [k]: x || {} })))
      .catch((e) => vivant && setOffres((o) => ({ ...o, [k]: { promotions: [], formules: [], erreur: message(e) } })))
      .finally(() => vivant && setOffresLoading(false))
    return () => {
      vivant = false
    }
  }, [s.product, t, offres])

  const ao = s.apiOffre && s.apiOffre.produit === s.product ? s.apiOffre : null
  const aoDates = !!(ao && ao.du && ao.au)
  const p = t?.promo || {}
  const kind = p.kind || 'aucune'
  const langs = langues(etat)
  const L = s.lang

  const fields: ChampsVisuel = {
    product: prod,
    discount: s.discount,
    offer: kind === 'offre' && ao ? ao.court || ao.nom : s.offer,
    promoPrice: s.promoPrice,
    from: t?.period ? (aoDates ? String(ao?.du) : s.from) : '',
    to: t?.period ? (aoDates ? String(ao?.au) : s.to) : '',
    free: s.free,
    photo: s.photo,
  }

  /** La façon dont la photo du post est prise : la sienne, celle du webshop, ou l'illustration du catalogue. */
  const photoMode = (): 'mine' | 'webshop' | 'illus' => {
    if (!t) return 'illus'
    if (t.photo === 'upload' || (t.photo === 'choix' && s.pmode === 'mine')) return 'mine'
    if (s.pmode !== 'illus' && prod?.photo) return 'webshop'
    return 'illus'
  }
  const mode = photoMode()
  const persoOn = !!t && r.persoVisuel !== false && !estFixe(t)
  const vueStory = s.format === 'story' || (s.format === 'post_story' && s.pv === 'story')

  /** Le visuel : celui du modèle (avec les champs saisis), l'offre du réseau, puis les réglages du franchisé. */
  const reglages = useMemo<ReglagesVisuel | null>(() => {
    if (!t) return null
    const photoSrc = mode === 'webshop' ? ws[wsSrc] || '' : mode === 'illus' ? media(prod?.img) : s.photo || ''
    let c = control(t, { ...fields, photo: mode === 'mine' ? s.photo : null }, L)
    c = { ...c, photos: photoSrc ? [{ src: photoSrc, cut: mode === 'illus', name: prod?.name || 'Photo de la boutique', ...s.adj }] : [] }
    if (ao) c = { ...c, showPromo: true, promo: ao.court || ao.nom, promoSub: ao.court ? ao.nom : '' }
    const v: ReglagesVisuel = { format: 'carre', fondu: 60, ...c, ...(persoOn ? s.vo : {}), ...(persoOn ? s.vt[L] || {} : {}) }
    if (vueStory) v.format = 'story'
    return {
      ...v,
      showPrice: v.showPrice && !!String(v.price || '').trim(),
      showPromo: v.showPromo && !!String(v.promo || '').trim(),
      showTitle: v.showTitle && !!String(v.title || '').trim(),
      showPhrase: v.showPhrase && !!String(v.phrase || '').trim(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, JSON.stringify(fields), L, mode, ws, wsSrc, s.photo, JSON.stringify(s.adj), JSON.stringify(s.vo), JSON.stringify(s.vt), persoOn, vueStory, ao])

  const corps = (): SaisiePost => ({
    template: s.tpl,
    product: s.product,
    discount: s.discount,
    offer: s.offer,
    promoPrice: s.promoPrice,
    from: s.from,
    to: s.to,
    free: s.free.trim(),
    photo: mode === 'mine' ? s.photo : null,
    link: s.link || 'aucun',
    fb: s.fb,
    ig: s.ig,
    date: s.date,
    time: s.time,
    // Promotion ou formule de TFBuddy : le serveur la relit (jamais prise telle quelle).
    offre: ao ? (ao.genre === 'formule' ? { genre: 'formule', nom: ao.nom } : { genre: 'promotion', id: ao.id, nom: ao.nom, du: ao.du, au: ao.au }) : null,
    format: s.format || 'post',
    recurrence: s.rec && s.rec !== 'une' ? { freq: s.rec, n: Number(s.recN) || 2 } : null,
  })

  async function programmer() {
    if (busy || !t) return
    const b = corps()
    const errs = check(etat, b)
    if (errs.length) {
      setErrors(errs)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      // Modèle à visuel fixe (post du réseau) : le visuel est celui du réseau, rien à dessiner.
      if (!estFixe(t)) {
        const h = visuel.current
        if (!h) throw new Error('Le visuel n’est pas prêt : patientez une seconde et recommencez.')
        // La photo du webshop doit être rapatriée avant l'export (sinon le visuel ne se dessine pas).
        if (mode === 'webshop' && prod?.photo && !ws[prod.photo]) {
          const d = await photoLocale(prod.photo)
          setWs((x) => ({ ...x, [String(prod.photo)]: d }))
          await new Promise((ok) => setTimeout(ok, 400))
        }
        if (s.format === 'post_story') {
          // Post + story : le visuel du fil, puis le même en story (9:16).
          b.visual = await h.toImage({ jpeg: true, quality: 0.9, format: s.vo.format && s.vo.format !== 'story' ? s.vo.format : 'carre' })
          b.visualStory = await h.toImage({ jpeg: true, quality: 0.9, format: 'story' })
        } else {
          b.visual = await h.toImage({ jpeg: true, quality: 0.9, format: s.format === 'story' ? 'story' : undefined })
        }
      }
      const post = await creerPost(b)
      const n = b.recurrence ? Number(b.recurrence.n) : 1
      const query = `post=${encodeURIComponent(post?.id ?? '')}&ok=${post?.status === 'À valider' ? 'valider' : 'prog'}${n > 1 ? `&n=${n}` : ''}${b.format !== 'post' ? `&f=${b.format}` : ''}`
      if (props.onCalendrier) props.onCalendrier(query)
      else window.location.assign(lienFranchise('cal', query))
    } catch (e) {
      setBusy(false)
      setErrors([message(e)])
    }
  }

  // ----- Le kit du mois -----
  const aFaire = kit.filter((k) => !k.fait).length
  const kitBloc = kit.length ? (
    <section className="card fpub__kit">
      <div className="fpub__kit-tete">
        <span className="fpub__etiquette is-accent">À publier ce mois-ci · demandé par le réseau</span>
        <span className="muted">{aFaire ? `${aFaire} à préparer sur ${kit.length}` : 'Tout est programmé : merci !'}</span>
      </div>
      {kit.map((k) => (
        <div key={k.id} className="fpub__kit-ligne">
          <span className="fpub__kit-date">
            <span>{String(Number(k.date.slice(8, 10)))}</span>
            <span>{MOIS_COURTS[Number(k.date.slice(5, 7)) - 1]}</span>
          </span>
          <span className="fpub__kit-nom">
            <span>{k.nom}</span>
            {k.note ? <span className="muted">{k.note}</span> : null}
          </span>
          <span className={`fpub__statut ${k.fait ? 'is-ok' : k.passe ? 'is-ko' : 'is-or'}`}>{k.fait ? `Programmé le ${dShort(k.faitLe)}` : k.passe ? 'En retard' : 'À faire'}</span>
          {!k.fait ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                const tk = etat.templates.find((x) => x.id === k.modele)
                if (!tk) return
                const slot = creneauDuJour(etat, k.passe ? null : k.date)
                S({ ...pourModele(tk, etat), ...slot, from: slot.date, to: addDays(slot.date, Math.min(6, r.promoDureeMax - 1)), wz: 'modele' })
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Préparer
            </button>
          ) : null}
        </div>
      ))}
    </section>
  ) : null

  const eyebrow = `Publier · L’Atelier By ${etat.shop.name}`
  const titre = s.filter === 'promo' ? 'Nouvelle promotion' : 'Créer un post'
  const tete = (
    <header className="fpub__tete">
      <span className="fpub__etiquette">{eyebrow}</span>
      <h1>{titre}</h1>
    </header>
  )
  const alerteQuota = quotaFull ? (
    <p className="warning">Vous avez atteint le quota de la semaine ({q.max} posts). Vous pourrez de nouveau publier la semaine prochaine — ou annuler un post prévu.</p>
  ) : null

  if (!t) {
    return (
      <div className="social-native fpub">
        {tete}
        {alerteQuota}
        {kitBloc}
        <p className="card muted fpub__vide">Aucun modèle ouvert pour l’instant : le réseau n’a pas encore ouvert de modèle de ce type.</p>
      </div>
    )
  }

  // ----- Le texte du post (celui du modèle, puis l'offre du réseau avant la ligne du lien, comme le serveur) -----
  const ajoute = (txt: string, bloc?: string) => {
    const x = String(txt || '')
    const b = String(bloc || '').trim()
    if (!b || x.includes(b)) return x
    const i = x.search(/\n\{lien\}\s*$/)
    return i >= 0 ? `${x.slice(0, i)}\n${b}${x.slice(i)}` : `${x.trim() ? `${x.replace(/\s+$/, '')}\n` : ''}${b}`
  }
  const texteDe = (l: string) => {
    const brut = l === 'nl' ? t.textNl || t.text : t.text
    const x = fill(brut, vars(t, fields, l))
    if (!ao) return x
    return l === 'nl' ? (t.textNl ? ajoute(x, ao.mentionNl) : x) : ajoute(ajoute(x, ao.libelle), ao.mention)
  }
  const texte = langs
    .map((l) => remplir(etat, texteDe(l), l))
    .filter((x) => x.trim())
    .join('\n\n— — —\n\n')

  const val = aValider(r, t)
  const dMax = Math.min(Number(p.max) || 0, Number(r.remiseMax) || 0)
  const minDate = iso(new Date(Date.now() + r.delaiMinHeures * 3600000))
  const maxDate = addDays(etat.today, r.horizonJours)
  const joursOuv = [1, 2, 3, 4, 5, 6, 0].filter((j) => (r.jours || []).includes(j)).map((j) => DAYS[j])

  // Canaux (Instagram unique du réseau : réservé au franchiseur, le serveur rend alors rules.ig = false).
  const canaux = (
    [
      ['fb', 'Facebook', !!(t.fb && r.fb), etat.shop.fb === 'connected'],
      ['ig', 'Instagram', !!(t.ig && r.ig), etat.shop.igs === 'connected'],
    ] as ['fb' | 'ig', string, boolean, boolean][]
  )
    .filter(([, , ok]) => ok)
    .map(([k, label, , conn]) => ({ k, label: label + (conn ? '' : ' (non connecté)'), on: !!s[k] && conn, dis: !conn }))
  const igOn = canaux.some((c) => c.k === 'ig' && c.on)
  const vaSurIg = canaux.some((c) => c.k === 'ig')

  // ----- Le lien : celui du modèle, ou le webshop de la boutique -----
  const linkCur = s.link || (t.link ? 'modele' : 'aucun')
  const wsP = !!(prod && prod.apiId && prod.webshop !== false)
  const wsC = !!(prod && prod.categoryId)
  const tplUrl = String(t.link || '')
    .replace(/\{webshop_produit:liste\}/g, webshopUrl(etat, prod, 'produit', false))
    .replace(/\{webshop_produit:(\d+)(:liste)?\}/g, (_m, id: string, liste?: string) => webshopUrl(etat, { apiId: Number(id) }, 'produit', !liste))
    .replace(/\{webshop_categorie:(\d+)\}/g, (_m, id: string) => webshopUrl(etat, { categoryId: Number(id) }, 'categorie'))
    .replace(/\{webshop_groupe:(\d+)\}/g, (_m, id: string) => webshopUrl(etat, { groupId: Number(id) }, 'groupe'))
    .replace(/\{webshop_produit\}/g, webshopUrl(etat, prod, 'produit'))
    .replace(/\{webshop_categorie\}/g, webshopUrl(etat, prod, 'categorie'))
    .replace(/\{webshop\}/g, webshopUrl(etat))
  const lienUrl =
    ({
      aucun: '',
      modele: tplUrl,
      webshop: webshopUrl(etat),
      produit: wsP ? webshopUrl(etat, prod, 'produit') : webshopUrl(etat),
      categorie: wsC ? webshopUrl(etat, prod, 'categorie') : webshopUrl(etat),
    } as Record<string, string>)[linkCur] || ''
  const liens: [string, string, boolean, string][] = [['aucun', 'Aucun lien', false, '']]
  if (t.link) liens.push(['modele', 'Lien du réseau', false, tplUrl])
  liens.push(
    ['webshop', 'Mon webshop', false, ''],
    ['produit', 'Ce produit sur mon webshop', !wsP, wsP ? '' : 'Choisissez un produit vendu sur le webshop'],
    ['categorie', 'Sa catégorie sur mon webshop', !wsC, wsC ? '' : 'Choisissez d’abord un produit'],
  )

  // ----- Les offres du produit (TFBuddy) -----
  const O = prod ? offres[prod.id] : null
  const remiseTpl = kind === 'remise' || kind === 'prix'
  const TAG: Record<string, string> = { bundle: 'Bundle', offre: 'Offre', remise: 'Remise', quantite: 'Quantité', formule: 'Formule' }
  const lignesOffres = O
    ? [
        ...(O.promotions || []).map((o) => ({ ...o, genre: 'promotion' as const })),
        ...(O.formules || []).map((f) => ({ ...f, genre: 'formule' as const, id: undefined, du: undefined, au: undefined, type: 'formule', portee: '' })),
      ]
    : []
  const noteOffres =
    remiseTpl && lignesOffres.length
      ? 'Ce modèle a sa propre remise : pour publier une de ces promotions, prenez « Produit du jour » ou un modèle sans remise.'
      : ao
        ? `Dans le post : « ${ao.court || ao.nom} » sur le visuel ; « ${ao.libelle} »${ao.mention ? ` et « ${ao.mention} »` : ''} dans le texte. Revérifiée dans TFBuddy à la publication.`
        : ''
  const showOffres = t.product === 'choix' && !!prod && !estFixe(t)

  // ----- Format et répétition -----
  const storyOff = r.story === false
  const max = Number(r.recurrenceMax) || 0
  const recOn = max >= 2 && s.rec && s.rec !== 'une'
  const recN = Math.max(2, Math.min(max || 2, Number(s.recN) || 2))
  const D = recOn ? serieDates(etat, { ...corps(), recurrence: { freq: s.rec, n: recN } }) : []
  const ko = D.filter((x) => !x.ok)
  const formatNote = {
    post: `Le post part dans le fil de votre Page${vaSurIg ? ' et d’Instagram' : ''}, avec son texte et son lien.`,
    story: `Une story reste 24 h en haut de votre Page${vaSurIg ? ' et d’Instagram' : ''} : ni texte ni lien, tout est sur le visuel, au format story (9:16).`,
    post_story: 'Le post part dans le fil, et la même création en story (9:16, 24 h, ni texte ni lien) à la même heure.',
  }[s.format || 'post']

  // ----- Le jour choisi -----
  const mins = (h: string) => {
    const [a, b] = String(h || '0:0').split(':').map(Number)
    return a * 60 + (b || 0)
  }
  const J = jour && jour.date === s.date ? jour : null
  const itemsJour = etat.posts
    .filter((x) => x.date === s.date && x.status !== 'Refusé')
    .map((x) => ({ time: x.time, who: x.own ? 'mon post' : 'réseau', title: x.title, dot: x.own ? '#8D1D2C' : '#B8B2A8', fb: !!x.fb }))
    .concat(
      J
        ? J.posts.map((x) => ({
            time: x.time,
            who: x.channel === 'Instagram' ? 'Instagram' : 'ma Page (Meta)',
            title: x.title || x.type || '',
            dot: x.channel === 'Instagram' ? '#C13584' : '#1877F2',
            fb: x.channel === 'Facebook',
          }))
        : [],
    )
    .sort((a, b) => a.time.localeCompare(b.time))
  const proche = s.time ? itemsJour.filter((x) => x.fb && Math.abs(mins(x.time) - mins(s.time)) < 120) : []

  // ----- L'assistant -----
  const etapes = (
    [
      ['modele', 'Modèle', true],
      ['offre', 'Produit & offre', t.product === 'choix' || kind !== 'aucune' || !!t.period || showOffres],
      ['texte', 'Texte & lien', true],
      ['visuel', 'Visuel', !estFixe(t) && (t.photo === 'upload' || t.photo === 'choix' || t.product === 'choix' || persoOn)],
      ['pub', 'Date & publication', true],
    ] as [Etape, string, boolean][]
  ).filter((x) => x[2])
  const cur = Math.max(0, etapes.findIndex((x) => x[0] === s.wz))
  const k = etapes[cur][0]
  const aller = (i: number) => {
    setS((x) => ({ ...x, wz: etapes[i][0] }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ----- Photo -----
  const up = t.photo === 'upload'
  const ch = t.photo === 'choix'
  const vignette = mode === 'mine' ? s.photo : mode === 'webshop' ? ws[wsSrc] || wsSrc : prod ? media(prod.img) : ''
  const notePhoto =
    mode === 'mine'
      ? s.photo
        ? 'Votre photo, posée dans la mise en page du modèle.'
        : up
          ? 'Ce modèle demande votre photo.'
          : 'Importez votre photo.'
      : mode === 'webshop'
        ? ws[wsSrc]
          ? 'La photo du produit sur votre webshop.'
          : wsErr
            ? `Photo du webshop illisible (${wsErr}) : prenez l’illustration.`
            : 'Photo du webshop en chargement…'
        : prod
          ? 'L’illustration du produit (design system de la marque).'
          : 'Choisissez un produit : sa photo suit.'
  const onPhoto = async (f: File | undefined) => {
    const d = await lirePhoto(f)
    if (d) S({ photo: d, pmode: 'mine' })
  }

  // ----- Aperçu -----
  const pv = s.format === 'story' ? 'story' : s.format === 'post_story' && s.pv === 'story' ? 'story' : igOn && s.pv === 'ig' ? 'ig' : 'fb'
  const onglets = s.format === 'story' ? [] : [['fb', 'Facebook'], ...(igOn ? [['ig', 'Instagram']] : []), ...(s.format === 'post_story' ? [['story', 'Story']] : [])]
  const pageName = etat.shop.page || `L’Atelier By ${etat.shop.name}`
  const whenLabel = s.date ? `${dLabel(s.date)} à ${s.time}` : ''
  const igHandle = String(etat.shop.ig || '').replace(/^@?/, '') || 'latelierby'
  const fixeMedia = ((t.visual?.media || []).filter((m) => m.kind !== 'video').map((m) => media(m.src)) as string[]).filter(Boolean).slice(0, 4)
  const VM = (etat.visuelsModeles || []).filter((m) => m && m.id && m.nom && m.v)

  const puce = (on: boolean, label: string, pick: () => void, dis = false, tip = '') => (
    <button key={label} type="button" className={`fpub__puce${on ? ' is-on' : ''}`} disabled={dis} title={tip || undefined} onClick={pick}>
      {label}
    </button>
  )

  const v = reglages
  const VT = (key: keyof ReglagesVisuel, val: string) => setS((x) => ({ ...x, vt: { ...x.vt, [L]: { ...(x.vt[L] || {}), [key]: val } } }))
  const V = (patch: Partial<ReglagesVisuel>) => setS((x) => ({ ...x, vo: { ...x.vo, ...patch } }))
  const champsTexte: [string, keyof ReglagesVisuel, keyof ReglagesVisuel, keyof ReglagesVisuel | null, string][] = [
    ['Mention', 'eyebrow', 'showEyebrow', null, ''],
    ['Nom du produit', 'title', 'showTitle', null, ''],
    ['Phrase d’accroche', 'phrase', 'showPhrase', null, ''],
    ['Prix', 'price', 'showPrice', 'unit', 'Unité'],
    ['Offre (4+1)', 'promo', 'showPromo', 'promoSub', 'Sous-texte de l’offre'],
    ['Site web', 'site', 'showSite', null, ''],
  ]
  const bil = langs.length > 1

  return (
    <div className="social-native fpub">
      {tete}
      {alerteQuota}
      {kitBloc}

      <nav className="card fpub__etapes" aria-label="Étapes">
        {etapes.map(([key, label], i) => (
          <span key={key} className="fpub__etape-bloc">
            <button type="button" className={`fpub__etape${i === cur ? ' is-cur' : i < cur ? ' is-fait' : ''}`} onClick={() => aller(i)}>
              <span className="fpub__rond">{i < cur ? '✓' : i + 1}</span>
              <span>{label}</span>
            </button>
            {i < etapes.length - 1 ? <span className={`fpub__trait${i < cur ? ' is-fait' : ''}`} /> : null}
          </span>
        ))}
      </nav>

      <div className="fpub__corps">
        <div className="fpub__gauche">
          {k === 'modele' ? (
            <Section titre="Le modèle du réseau">
              <div className="seg fpub__seg-large">
                {etat.templates.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={x.id === t.id ? 'is-on' : ''}
                    title={x.description || undefined}
                    onClick={() => {
                      // Changer de modèle garde le produit choisi s'il en demande un.
                      if (x.id !== t.id) S({ ...pourModele(x, etat), ...(x.product === 'choix' ? { product: s.product } : {}) })
                    }}
                  >
                    {x.name}
                  </button>
                ))}
              </div>
              <span className="fpub__desc">
                {t.description || ''}
                {estFixe(t) ? <span className="fpub__badge is-noir">visuel du réseau</span> : null}
                {val ? <span className="fpub__badge is-or">validé par le réseau</span> : <span className="fpub__badge is-ok">publication directe</span>}
              </span>
            </Section>
          ) : null}

          {k === 'offre' ? (
            <>
              {t.product === 'choix' ? (
                <Section titre="Produit · votre catalogue">
                  <input type="search" className="fpub__champ" value={s.q} onChange={(e) => setS((x) => ({ ...x, q: e.target.value }))} placeholder={`Rechercher parmi vos ${etat.catalogue.length} produits…`} />
                  <div className="fpub__produits">
                    {etat.catalogue
                      .filter((c) => !s.q || norm(`${c.name} ${c.gamme || ''}`).includes(norm(s.q)))
                      .slice(0, 60)
                      .map((c) => (
                        <button key={c.id} type="button" className={`fpub__produit${s.product === c.id ? ' is-on' : ''}`} onClick={() => S({ product: c.id, apiOffre: null })}>
                          <span className="fpub__produit-img">
                            <img src={c.photo || media(c.img)} alt="" loading="lazy" style={{ objectFit: c.photo ? 'cover' : 'contain' }} />
                          </span>
                          <span className="fpub__produit-nom">
                            <span>{c.name}</span>
                            <span className="muted">{c.price ? `${c.price} €` : ''}</span>
                          </span>
                        </button>
                      ))}
                  </div>
                </Section>
              ) : null}

              {showOffres ? (
                <section className="card fpub__bloc">
                  <div className="fpub__ligne-tete">
                    <span className="fpub__etiquette">Promotions, bundles et formules de ce produit</span>
                    <span className="muted fpub__petit">lus dans TFBuddy · valables dans votre boutique</span>
                  </div>
                  {offresLoading && !O ? <span className="muted fpub__petit">Lecture des promotions…</span> : null}
                  {O && !lignesOffres.length ? (
                    <span className="muted fpub__petit">{O.erreur ? `Promotions illisibles pour l’instant : ${O.erreur}` : 'Aucune promotion, aucun bundle ni formule pour ce produit dans votre boutique.'}</span>
                  ) : null}
                  {lignesOffres.map((o, i) => {
                    const on = !!ao && ao.genre === o.genre && (o.genre === 'formule' ? ao.nom === o.nom : ao.id === o.id)
                    const tard = o.du && s.date && o.du > s.date
                    const fini = o.au && s.date && o.au < s.date
                    const note =
                      o.genre === 'formule'
                        ? `${o.court || 'prix de la boutique'}${'choix' in o && o.choix?.length ? ` · au choix : ${o.choix.join(', ')}` : ''}`
                        : `${o.portee || ''}${o.du && o.au ? ` · du ${dShort(o.du)} au ${dShort(o.au)}` : o.au ? ` · jusqu’au ${dShort(o.au)}` : o.du ? ` · à partir du ${dShort(o.du)}` : ''}${tard ? ' · commence après votre date' : fini ? ' · finie avant votre date' : ''}`
                    return (
                      <div key={`${o.genre}-${o.id ?? o.nom}-${i}`} className={`fpub__offre${on ? ' is-on' : ''}`}>
                        <span className="fpub__tag">{TAG[o.genre === 'formule' ? 'formule' : String(o.type)] || 'Offre'}</span>
                        <span className="fpub__offre-texte">
                          <span>{o.libelle}</span>
                          <span className="muted">{note}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={remiseTpl}
                          title={remiseTpl ? 'Ce modèle a sa propre remise : prenez un modèle sans remise (ex. « Produit du jour »).' : on ? 'Retirer du post' : 'Sur le visuel, et dans le texte avec sa mention (dates, boutiques)'}
                          onClick={() => {
                            if (!remiseTpl && prod) S({ apiOffre: on ? null : ({ ...o, produit: prod.id } as OffreActive) })
                          }}
                        >
                          {on ? 'Dans le post ✓' : 'Utiliser'}
                        </button>
                      </div>
                    )
                  })}
                  {noteOffres ? <span className={`fpub__petit${remiseTpl ? ' is-or' : ' is-ok'}`}>{noteOffres}</span> : null}
                </section>
              ) : null}

              {kind !== 'aucune' || t.period ? (
                <Section titre="Votre promotion">
                  {kind === 'remise' ? (
                    <div className="fpub__remise">
                      <span className="fpub__remise-val">-{s.discount} %</span>
                      <input type="range" min={p.min || 1} max={dMax} step={1} value={s.discount} onChange={(e) => S({ discount: Number(e.target.value) })} />
                      <span className="muted fpub__petit">
                        de {p.min || 1} à {dMax} % (fixé par le réseau)
                      </span>
                    </div>
                  ) : null}
                  {ao && kind !== 'aucune' ? (
                    <span className="fpub__petit">
                      <span className="is-accent">{ao.court || ao.nom}</span> · promotion du réseau (TFBuddy){aoDates ? `, du ${dShort(ao.du)} au ${dShort(ao.au)}` : ''}
                    </span>
                  ) : null}
                  {kind === 'offre' && !ao ? <div className="fpub__puces">{(p.offres || []).map((o) => puce(s.offer === o, o, () => S({ offer: o })))}</div> : null}
                  {kind === 'prix' ? (
                    <label className="fpub__inline">
                      Prix promotionnel
                      <input type="text" inputMode="decimal" className="fpub__champ fpub__champ--court" value={s.promoPrice} placeholder="0,00" onChange={(e) => S({ promoPrice: e.target.value.replace(/[^\d,.]/g, '') })} /> €
                      <span className="muted">au lieu de {prod?.price ? `${prod.price} €` : '— (choisissez un produit)'}</span>
                    </label>
                  ) : null}
                  {t.period && !aoDates ? (
                    <div className="fpub__inline">
                      Du <input type="date" className="fpub__champ" value={s.from} min={minDate} onChange={(e) => S({ from: e.target.value })} /> au{' '}
                      <input type="date" className="fpub__champ" value={s.to} min={s.from} max={s.from ? addDays(s.from, r.promoDureeMax - 1) : ''} onChange={(e) => S({ to: e.target.value })} />
                      <span className="muted fpub__petit">au plus {r.promoDureeMax} jours</span>
                    </div>
                  ) : null}
                </Section>
              ) : null}
            </>
          ) : null}

          {k === 'texte' ? (
            <>
              {Number(t.free) > 0 ? (
                <Section titre="Votre phrase" aide="Sans lien, sans @ ni # : le réseau gère les liens et les comptes.">
                  <input
                    type="text"
                    className="fpub__champ"
                    value={s.free}
                    maxLength={Number(t.free)}
                    placeholder="Ex. : dégustation de brioche samedi de 10 h à 12 h"
                    onChange={(e) => S({ free: e.target.value.slice(0, Number(t.free)) })}
                  />
                  <span className="muted fpub__petit">
                    {s.free.length} / {t.free} caractères
                  </span>
                </Section>
              ) : null}
              <Section titre="Lien du post" aide="Celui du modèle ou votre webshop : jamais un lien libre.">
                <div className="fpub__puces">{liens.map(([kk, label, dis, tip]) => puce(linkCur === kk, label, () => !dis && S({ link: kk }), dis, tip))}</div>
                <span className="muted fpub__petit fpub__url">{lienUrl ? `Le post renverra vers : ${lienUrl}` : 'Pas de lien dans le post.'}</span>
              </Section>
            </>
          ) : null}

          {k === 'visuel' ? (
            <>
              {!estFixe(t) && (up || ch || t.product === 'choix') ? (
                <Section titre={up ? 'Votre photo (obligatoire)' : 'Photo du post'}>
                  {!up ? (
                    <div className="fpub__puces">
                      {puce(mode === 'webshop', 'Photo du webshop', () => wsSrc && S({ pmode: null }), !wsSrc, wsSrc ? '' : prod ? 'Pas de photo de ce produit sur le webshop' : 'Choisissez d’abord un produit')}
                      {puce(mode === 'illus', 'Illustration du catalogue', () => S({ pmode: 'illus' }))}
                      {ch ? puce(mode === 'mine', 'Ma photo', () => S({ pmode: 'mine' })) : null}
                    </div>
                  ) : null}
                  <div className="fpub__photo">
                    {vignette ? <img src={vignette} alt="" className="fpub__vignette" /> : null}
                    {mode === 'mine' ? (
                      <>
                        <label className="btn btn--sm fpub__mobile">
                          Prendre une photo
                          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
                        </label>
                        <label className="btn btn--sm">
                          {s.photo ? 'Changer de photo' : 'Importer une photo'}
                          <input type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
                        </label>
                      </>
                    ) : null}
                    <span className={`fpub__petit${mode === 'webshop' && wsErr ? ' is-or' : ' muted'}`}>{notePhoto}</span>
                  </div>
                </Section>
              ) : null}

              {persoOn && v ? (
                <section className="card fpub__bloc">
                  <div className="fpub__ligne-tete">
                    <span className="fpub__etiquette">Visuel · réglages</span>
                    <button type="button" className="btn btn--ghost btn--sm" title="Annule vos réglages : le visuel redevient celui du modèle" onClick={() => S({ vo: {}, vt: {}, adj: {} })}>
                      Revenir au visuel du modèle
                    </button>
                  </div>
                  <div className="fpub__reglage">
                    <span className="muted">Style</span>
                    <div className="seg">
                      {STYLES.map(([kk, label]) => (
                        <button key={kk} type="button" className={v.style === kk ? 'is-on' : ''} onClick={() => V({ style: kk })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fpub__reglage">
                    <span className="muted">Format</span>
                    <div className="seg">
                      {FORMATS.map((f) => (
                        <button
                          key={f.k}
                          type="button"
                          className={(s.vo.format || 'carre') === f.k ? 'is-on' : ''}
                          title={f.tip}
                          disabled={vueStory && f.k !== 'story'}
                          onClick={() => V({ format: f.k })}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fpub__reglage">
                    <span className="muted">Photo</span>
                    <div className="seg">
                      {(
                        [
                          ['auto', 'Auto'],
                          ['cut', 'Détourée'],
                          ['full', 'Pleine'],
                        ] as [string, string][]
                      ).map(([kk, label]) => (
                        <button key={kk} type="button" className={(v.cutMode || 'auto') === kk ? 'is-on' : ''} onClick={() => V({ cutMode: kk })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {v.photos.length ? (
                    <div className="fpub__reglage fpub__cadrage">
                      <span className="muted" title="Zoom 50 – 300 % · cadrage horizontal et vertical">
                        Cadrage
                      </span>
                      <label>
                        Zoom
                        <input type="range" min={50} max={300} step={5} value={Math.round((s.adj.zoom || 1) * 100)} onChange={(e) => S({ adj: { ...s.adj, zoom: Number(e.target.value) / 100 } })} />
                        <span>{Math.round((s.adj.zoom || 1) * 100)} %</span>
                      </label>
                      <label>
                        ↔
                        <input type="range" min={0} max={100} value={s.adj.x ?? 50} onChange={(e) => S({ adj: { ...s.adj, x: Number(e.target.value) } })} />
                      </label>
                      <label>
                        ↕
                        <input type="range" min={0} max={100} value={s.adj.y ?? 50} onChange={(e) => S({ adj: { ...s.adj, y: Number(e.target.value) } })} />
                      </label>
                      <button type="button" className="btn btn--ghost btn--sm" title="Revenir à 100 %, centré" onClick={() => S({ adj: {} })}>
                        Recentrer
                      </button>
                    </div>
                  ) : null}
                  {v.style === 'plein' ? (
                    <div className="fpub__reglage fpub__cadrage">
                      <span className="muted" title="0 % : photo sans dégradé · 100 % : dégradé le plus sombre (texte le plus lisible)">
                        Fondu
                      </span>
                      <label>
                        <input type="range" min={0} max={100} step={5} value={v.fondu ?? 60} onChange={(e) => V({ fondu: Number(e.target.value) })} />
                        <span>{v.fondu ?? 60} %</span>
                      </label>
                    </div>
                  ) : null}
                  <div className="fpub__textes">
                    <span className="muted" title={`Cochez pour afficher · visuel en ${L.toUpperCase()}${bil ? ' — changez la langue au-dessus de l’aperçu' : ''}`}>
                      Textes sur le visuel{bil ? ` (${L.toUpperCase()})` : ''}
                    </span>
                    <label className="fpub__texte">
                      <input type="checkbox" checked={v.showLogo} onChange={() => V({ showLogo: !v.showLogo })} />
                      <span>Logo L’Atelier By</span>
                    </label>
                    {champsTexte.map(([label, key, show, second, label2]) => (
                      <label key={key} className="fpub__texte">
                        <input type="checkbox" checked={!!v[show]} onChange={() => V({ [show]: !v[show] } as Partial<ReglagesVisuel>)} />
                        <input type="text" className="fpub__champ" placeholder={label} value={String(v[key] ?? '')} onChange={(e) => VT(key, e.target.value)} />
                        {second ? <input type="text" className="fpub__champ" placeholder={label2} value={String(v[second] ?? '')} onChange={(e) => VT(second, e.target.value)} /> : null}
                      </label>
                    ))}
                    <div className="fpub__reglage">
                      <span className="muted">Phrase</span>
                      <div className="seg">
                        {(
                          [
                            ['script', 'Script'],
                            ['display', 'Display'],
                            ['sans', 'Sans'],
                          ] as [string, string][]
                        ).map(([kk, label]) => (
                          <button key={kk} type="button" className={(v.phraseFont || 'script') === kk ? 'is-on' : ''} onClick={() => V({ phraseFont: kk })}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="fpub__reglage">
                    <span className="muted">Modèles de visuel du réseau</span>
                    {VM.length ? (
                      <div className="fpub__puces">
                        {VM.map((m) =>
                          puce(false, m.nom, () => {
                            const w = { ...m.v } as Record<string, unknown>
                            const tx: Record<string, unknown> = {}
                            for (const kk of ['eyebrow', 'phrase', 'unit', 'site']) {
                              if (w[kk] !== undefined) {
                                tx[kk] = w[kk]
                                delete w[kk]
                              }
                            }
                            delete w.nl
                            setS((x) => ({ ...x, vo: { ...x.vo, ...(w as Partial<ReglagesVisuel>) }, vt: { ...x.vt, [L]: { ...(x.vt[L] || {}), ...(tx as Partial<ReglagesVisuel>) } } }))
                          }, false, 'Appliquer ce modèle (le produit, le prix et la photo restent ceux du post)'),
                        )}
                      </div>
                    ) : (
                      <span className="muted fpub__petit">aucun pour l’instant</span>
                    )}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {k === 'pub' ? (
            <>
              <Section titre="Quand et où">
                <div className="fpub__inline">
                  <input type="date" className="fpub__champ" value={s.date} min={minDate} max={maxDate} onChange={(e) => S({ date: e.target.value })} />
                  <input type="time" className="fpub__champ" value={s.time} min={r.heureMin} max={r.heureMax} step={900} onChange={(e) => S({ time: e.target.value })} />
                  {canaux.map((c) => (
                    <label key={c.k} className={`fpub__canal${c.dis ? ' is-off' : ''}`}>
                      <input type="checkbox" checked={c.on} disabled={c.dis} onChange={() => S({ [c.k]: !s[c.k] } as Partial<Saisie>)} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <span className="muted fpub__petit">
                  Règles du réseau : {joursOuv.length === 7 ? 'tous les jours' : joursOuv.join(', ')}, entre {r.heureMin} et {r.heureMax}, au moins {r.delaiMinHeures} h à l’avance et au plus {r.horizonJours} jours · {q.used} / {q.max} posts cette semaine.
                </span>
                <div className="fpub__jour">
                  <span>{s.date ? `Le ${dLabel(s.date)} sur votre Page${J ? '' : ' · lecture chez Meta…'}` : 'Choisissez une date'}</span>
                  {itemsJour.map((x, i) => (
                    <span key={i} className="fpub__jour-ligne">
                      <span className="fpub__point" style={{ background: x.dot }} />
                      {x.time} · {x.who} · {x.title}
                    </span>
                  ))}
                  {s.date && !itemsJour.length ? (
                    <span className="muted">{J?.err ? 'Rien de prévu dans l’espace (publications Meta illisibles pour l’instant).' : 'Rien de prévu ce jour-là : votre post aura la place.'}</span>
                  ) : null}
                  {proche.length ? (
                    <span className="is-or">
                      À moins de 2 h de « {proche[0].title} » ({proche[0].time}) : espacez-les pour qu’ils ne se fassent pas de l’ombre.
                    </span>
                  ) : null}
                </div>
              </Section>

              <Section titre="Format et répétition">
                <div className="fpub__puces">
                  {(
                    [
                      ['post', 'Post (fil)'],
                      ['story', 'Story seule'],
                      ['post_story', 'Post + story'],
                    ] as [Format, string][]
                  ).map(([kk, label]) => {
                    const dis = kk !== 'post' && (storyOff || estFixe(t))
                    return puce(
                      (s.format || 'post') === kk,
                      label,
                      () => !dis && S({ format: kk, pv: kk === 'story' ? 'story' : s.pv === 'story' ? 'fb' : s.pv }),
                      dis,
                      dis ? (estFixe(t) ? 'Ce modèle a un visuel du réseau : il ne part qu’en post.' : 'Le réseau n’ouvre pas les stories.') : '',
                    )
                  })}
                </div>
                <span className="muted fpub__petit">{formatNote}</span>
                {max >= 2 ? (
                  <>
                    <div className="fpub__inline">
                      <span className="muted">Répéter</span>
                      {(
                        [
                          ['une', 'Une fois'],
                          ['jour', 'Chaque jour'],
                          ['semaine', 'Chaque semaine'],
                          ['2semaines', 'Toutes les 2 semaines'],
                          ['mois', 'Chaque mois'],
                        ] as [string, string][]
                      ).map(([kk, label]) => {
                        const dis = kk !== 'une' && !!t.period
                        return puce((s.rec || 'une') === kk, label, () => !dis && S({ rec: kk, recN }), dis, dis ? 'Une promotion datée ne se répète pas.' : '')
                      })}
                      {recOn ? (
                        <label className="fpub__inline">
                          <input type="number" className="fpub__champ fpub__champ--court" min={2} max={max} value={recN} onChange={(e) => S({ recN: Math.max(2, Math.min(max, Number(e.target.value) || 2)) })} />
                          fois · au plus {max}
                        </label>
                      ) : null}
                    </div>
                    {recOn ? (
                      <>
                        <div className="fpub__puces">
                          {D.map((x) => (
                            <span key={x.date} className={`fpub__statut ${x.ok ? 'is-ok' : 'is-ko'}`} title={`${dLabel(x.date)}${x.ok ? '' : ` : ${x.motif}`}`}>
                              {dShort(x.date)}
                              {x.ok ? '' : ' ✕'}
                            </span>
                          ))}
                        </div>
                        <span className={`fpub__petit${ko.length ? ' is-ko' : ' muted'}`}>
                          {ko.length
                            ? `${ko.length} date(s) hors des règles du réseau (survolez-les) : changez la date, la répétition ou le nombre de fois.`
                            : `${D.length} posts, du ${dShort(D[0]?.date ?? s.date)} au ${dShort(D[D.length - 1]?.date ?? s.date)} à ${s.time}. Chaque date est un post à part : vous pourrez en annuler une, ou toute la série, depuis le calendrier.${val ? ' Le réseau valide chaque date.' : ''}`}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : null}
              </Section>

              {errors.length ? (
                <div className="fpub__erreurs" role="alert">
                  {errors.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
              ) : null}
              <div className="fpub__cta">
                <span className="muted fpub__petit">{val ? 'Le réseau valide avant publication.' : 'Publication à l’heure prévue.'}</span>
                <button type="button" className={`btn btn--primary${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => void programmer()}>
                  {busy ? 'Préparation du visuel…' : val ? 'Envoyer au réseau' : 'Programmer'}
                </button>
              </div>
            </>
          ) : null}

          <div className="fpub__nav">
            <span className="muted fpub__petit">
              Étape {cur + 1} sur {etapes.length}
              {k === 'offre' && t.product === 'choix' && !prod ? ' · choisissez un produit' : ''}
            </span>
            <span className="fpub__nav-boutons">
              {cur > 0 ? (
                <button type="button" className="btn btn--sm" onClick={() => aller(cur - 1)}>
                  ← {etapes[cur - 1][1]}
                </button>
              ) : null}
              {cur < etapes.length - 1 ? (
                <button type="button" className="btn btn--sm" onClick={() => aller(cur + 1)}>
                  Suivant : {etapes[cur + 1][1]} →
                </button>
              ) : null}
            </span>
          </div>
        </div>

        <aside className="fpub__apercu">
          <div className="fpub__ligne-tete">
            <span
              className="fpub__etiquette"
              title={
                persoOn
                  ? 'Le texte du post est celui du modèle du réseau ; le visuel part du modèle et se règle à l’étape « Visuel ».'
                  : 'Le texte, le titre et la mise en page sont ceux du réseau ; seuls vos choix changent.'
              }
            >
              Aperçu · charte du réseau
            </span>
            <span className="fpub__puces">
              {onglets.length > 1 ? (
                <span className="seg">
                  {onglets.map(([kk, label]) => (
                    <button key={kk} type="button" className={pv === kk ? 'is-on' : ''} onClick={() => setS((x) => ({ ...x, pv: kk as Saisie['pv'] }))}>
                      {label}
                    </button>
                  ))}
                </span>
              ) : null}
              <button type="button" className={`fpub__puce${s.tel ? ' is-on' : ''}`} title="L’aperçu dans un téléphone" onClick={() => setS((x) => ({ ...x, tel: !x.tel }))}>
                Sur téléphone
              </button>
            </span>
          </div>
          {bil ? (
            <div className="seg fpub__langues" title={`Boutique bilingue : la légende part en ${langs.map((x) => x.toUpperCase()).join(' et ')} ; le visuel est dans la langue choisie.`}>
              {langs.map((l) => (
                <button key={l} type="button" className={L === l ? 'is-on' : ''} onClick={() => setS((x) => ({ ...x, lang: l }))}>
                  Visuel {l.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          <div className={`fpub__ecran${s.tel ? ' is-tel' : ''}`}>
            {s.tel ? (
              <div className="fpub__barre-tel">
                <span>9:41</span>
                <span>5G</span>
              </div>
            ) : null}
            <div className="fpub__post">
              {pv === 'fb' ? (
                <>
                  <div className="fpub__post-tete">
                    <span className="fpub__avatar">
                      <img src={`${import.meta.env.BASE_URL}img/logo-white.png`} alt="" />
                    </span>
                    <span>
                      <span>{pageName}</span>
                      <span className="muted">{whenLabel} · Public</span>
                    </span>
                  </div>
                  <p className="fpub__post-texte">{texte || '—'}</p>
                  {lienUrl ? <p className="fpub__post-lien">{lienUrl}</p> : null}
                </>
              ) : pv === 'ig' ? (
                <div className="fpub__post-tete">
                  <span className="fpub__avatar">
                    <img src={`${import.meta.env.BASE_URL}img/logo-white.png`} alt="" />
                  </span>
                  <span>
                    <span>{igHandle}</span>
                    <span className="muted">L’Atelier By {etat.shop.name}</span>
                  </span>
                </div>
              ) : (
                <div className="fpub__post-tete">
                  <span className="fpub__avatar">
                    <img src={`${import.meta.env.BASE_URL}img/logo-white.png`} alt="" />
                  </span>
                  <span>
                    <span>{pageName}</span>
                    <span className="muted">Story · {whenLabel} · 24 h</span>
                  </span>
                  <span className="muted fpub__petit">ni texte ni lien</span>
                </div>
              )}
              {estFixe(t) ? (
                <div className="fpub__fixe" style={{ gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, fixeMedia.length))}, 1fr)` }}>
                  {fixeMedia.map((m) => (
                    <img key={m} src={m} alt="" />
                  ))}
                </div>
              ) : v ? (
                <VisuelPost ref={visuel} reglages={v} />
              ) : null}
              {pv === 'fb' ? (
                <div className="fpub__post-actions muted">
                  <span>J’aime</span>
                  <span>Commenter</span>
                  <span>Partager</span>
                </div>
              ) : null}
              {pv === 'ig' ? (
                <p className="fpub__post-texte">
                  <span className="fpub__fort">{igHandle}</span> {texte || '—'}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
