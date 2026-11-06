import { useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import './social.css'
import './parametres.css'
import { CONN, POST_TYPES } from '../../lib/social/refs'
import { charger, enregistrer, journaliser, parId, useSocial } from '../../lib/social/store'
import type { Boutique, EtatSocial, Objet, Serveur } from '../../lib/social/store'
import * as P from '../../lib/social/api-parametres'
import type { Audit, EcranGoogle, IdsAuto, MetaStatus, Portefeuille } from '../../lib/social/api-parametres'
import { lienSocial } from '../../lib/social/liens'

/** Les onglets de l'écran (le rail du Marketing est la navigation entre eux). */
export type OngletParametres = 'conn' | 'api' | 'google' | 'ia' | 'tpl' | 'grp' | 'rights' | 'log' | 'tfb'
const ONGLETS: OngletParametres[] = ['conn', 'api', 'google', 'ia', 'tpl', 'grp', 'rights', 'log', 'tfb']

interface ParametresViewProps {
  /** L'onglet affiché : `conn` (défaut), `api`, `google`, `ia`, `tpl`, `grp`, `rights`, `log`, `tfb`. */
  tab?: string
  /** Onglet `api` : la section où descendre (`cles`, `ids`, `pf`, `version`, `perms`, `dsa`). */
  section?: string
  /** Suivre un lien vers un autre écran du module dans le rail (`social-post`…). Sans elle, l'adresse change. */
  onNaviguer?: (ecran: string, query: string) => void
}

type Rec = Record<string, unknown>
const txt = (v: unknown) => (v == null ? '' : String(v))
const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** « jj/mm à hh:mm » d'un horodatage « AAAA-MM-JJ hh:mm ». */
const dd = (le: string | undefined | null) => (le ? `${le.slice(8, 10)}/${le.slice(5, 7)} à ${le.slice(11, 16)}` : '')

// Référentiels de l'API Meta (repris de social-data.js : ce sont des réglages de l'API, pas des données).
const META_VERSIONS = ['v25.0', 'v26.0']
const META_BASE = 'https://graph.facebook.com/'
const META_PERMISSIONS = [
  'business_management',
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'ads_management',
  'pages_manage_ads',
  'leads_retrieval',
  'pages_manage_engagement',
  'instagram_manage_comments',
]
const ROLES = [
  { id: 'franchiseur', name: 'Franchiseur (admin réseau)', rights: { create: 'Tout le réseau', validate: true, ads: true, reporting: 'Complet', sales: true, settings: true } },
  { id: 'franchise', name: 'Franchisé / manager boutique', rights: { create: 'Sa boutique (soumis à validation)', validate: false, ads: false, reporting: 'Sa boutique', sales: true, settings: false } },
  { id: 'agence', name: 'Agence partenaire', rights: { create: 'Tout le réseau', validate: false, ads: true, reporting: 'Meta uniquement', sales: false, settings: false } },
]
const LANGS: Record<string, string> = { fr: 'Français', nl: 'Nederlands' }
/** La charte par défaut du module (social-data.js, CHARTE_DEF) : complétée par celle enregistrée. */
const CHARTE_DEF = { ton: 'Chaleureux, gourmand, simple et artisanal.', vouvoiement: true, emojisMax: 2, motsInterdits: [] as string[], hashtags: ['#latelierby'], hashtagVille: true, longueur: 125, signature: '' }

/** Une puce de choix (filtres, versions, boutiques d'un groupe) : bordeaux plein quand elle est choisie. */
function Puce({ on, onClick, children, mono }: { on: boolean; onClick: () => void; children: ReactNode; mono?: boolean }) {
  return (
    <button type="button" className={`par__puce${on ? ' is-on' : ''}${mono ? ' par__mono' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

/** Un champ enregistré quand on le quitte (le module poussait chaque frappe au serveur). */
function Champ({ valeur, onValider, ...props }: { valeur: string; onValider: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(valeur)
  useEffect(() => setV(valeur), [valeur])
  return (
    <input
      {...props}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== valeur && onValider(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
function Zone({ valeur, onValider, ...props }: { valeur: string; onValider: (v: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(valeur)
  useEffect(() => setV(valeur), [valeur])
  return <textarea {...props} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== valeur && onValider(v)} />
}

/** Un réglage enregistré 700 ms après la dernière frappe (`POST /parametres`), comme dans le module. */
function useReglageDiffere(initial: string, cle: string, message: (v: string) => string, toast: (m: string) => void, delai = 700) {
  const [v, setV] = useState<string | null>(null)
  const t = useRef(0)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return [
    v ?? initial,
    (nv: string) => {
      setV(nv)
      window.clearTimeout(t.current)
      t.current = window.setTimeout(
        () =>
          P.enregistrerParametres({ [cle]: cle === 'ia_modele' ? nv.trim() : nv })
            .then(() => toast(message(nv)))
            .catch((e: unknown) => toast(erreurDe(e))),
        delai,
      )
    },
  ] as const
}

function useToast() {
  const [m, setM] = useState('')
  const t = useRef(0)
  useEffect(() => () => window.clearTimeout(t.current), [])
  const toast = (x: string) => {
    window.clearTimeout(t.current)
    setM(x)
    t.current = window.setTimeout(() => setM(''), 2800)
  }
  return [m, toast] as const
}

/** Ce qui est unique au réseau : Instagram (compte de la marque) et le compte publicitaire (comme SA.reseau). */
const reseauDe = (s: Serveur) => s.reseau ?? { instagram: !!s.instagramUnique, publicite: false }
/** La marque (connexions du réseau), telle que le serveur la rend. */
const marqueDe = (s: Serveur): Rec => (s.brand as Rec | null | undefined) ?? { id: 'marque' }

/** Les connexions en défaut (comme SA.alerts). */
function alertes(etat: EtatSocial, serveur: Serveur) {
  const out: { shop: string; what: string; st: string }[] = []
  const R = reseauDe(serveur)
  for (const s of etat.shops as (Boutique & Rec)[]) {
    if (s.fb !== 'connected') out.push({ shop: s.name, what: 'Page Facebook', st: txt(s.fb) || 'none' })
    if (!R.instagram && s.igs !== 'connected') out.push({ shop: s.name, what: 'Instagram', st: txt(s.igs) || 'none' })
    if (!R.publicite && s.ads !== 'connected') out.push({ shop: s.name, what: 'Compte publicitaire', st: txt(s.ads) || 'none' })
  }
  const b = marqueDe(serveur)
  if (R.instagram && b.igs !== 'connected') out.push({ shop: 'Réseau', what: 'Instagram', st: txt(b.igs) || 'none' })
  if (R.publicite && b.ads !== 'connected') out.push({ shop: 'Réseau', what: 'Compte publicitaire', st: txt(b.ads) || 'none' })
  return out
}

/** Les boutiques du réseau d'abord, puis les magasins test (comme SA.SHOPS.concat(SA.TEST_SHOPS)). */
const boutiquesEtTests = (etat: EtatSocial) => etat.shops.filter((x) => !x.test).concat(etat.shops.filter((x) => x.test))

/**
 * Paramètres et connexions — l'écran « Paramètres » du module Social, réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Un onglet par route du rail : connexions Meta des boutiques, API Meta
 * (clés, portefeuille, identifiants, version, DSA), Google, rédaction IA et charte, modèles de posts,
 * groupes de boutiques, droits, journal d'activité, API TFBuddy.
 */
export default function ParametresView({ tab, section, onNaviguer }: ParametresViewProps) {
  const { etat, serveur, erreur, chargement } = useSocial()
  const [toastMsg, toast] = useToast()
  const q = new URLSearchParams(window.location.search)
  const brut = tab ?? q.get('tab') ?? 'conn'
  const onglet: OngletParametres = (ONGLETS as string[]).includes(brut) ? (brut as OngletParametres) : 'conn'
  const sec = section ?? q.get('section') ?? ''

  // ?section=cles|pf|version|perms|dsa|ids : l'onglet s'ouvre sur cette section.
  useEffect(() => {
    if (!sec || !/^\w+$/.test(sec) || chargement !== 'pret') return
    const t = window.setTimeout(() => document.getElementById(`sec-${sec}`)?.scrollIntoView({ block: 'start' }), 100)
    return () => window.clearTimeout(t)
  }, [sec, onglet, chargement])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const props = { etat, serveur, toast }
  return (
    <div className="social-native par">
      {onglet === 'conn' && <Connexions {...props} />}
      {onglet === 'api' && <ApiMeta {...props} />}
      {onglet === 'google' && <Google {...props} />}
      {onglet === 'ia' && <Redaction {...props} />}
      {onglet === 'tpl' && <Modeles {...props} onNaviguer={onNaviguer} />}
      {onglet === 'grp' && <Groupes {...props} />}
      {onglet === 'rights' && <Droits {...props} />}
      {onglet === 'log' && <Journal {...props} />}
      {onglet === 'tfb' && <Tfbuddy {...props} />}
      {toastMsg && <div className="par__toast">{toastMsg}</div>}
    </div>
  )
}

interface OngletProps {
  etat: EtatSocial
  serveur: Serveur
  toast: (m: string) => void
}

// ---------------------------------------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------------------------------------

function Connexions({ etat, serveur, toast }: OngletProps) {
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const R = reseauDe(serveur)
  const B = marqueDe(serveur)
  const alerts = alertes(etat, serveur)
  // Instagram et compte publicitaire uniques au réseau : suivis une fois (encadré « Réseau »), pas boutique par boutique.
  const cols: [string, string][] = [['fb', 'Page Facebook'] as [string, string]]
    .concat(R.instagram ? [] : [['igs', 'Instagram']])
    .concat(R.publicite ? [] : [['ads', 'Compte publicitaire']])
  const netKeys: [string, string][] = [['fb', 'Page de la marque'] as [string, string]]
    .concat(R.instagram ? [['igs', 'Instagram du réseau']] : [])
    .concat(R.publicite ? [['ads', 'Compte publicitaire du réseau']] : [])

  // On ne « reconnecte » pas depuis l'écran : l'accès se donne dans le Business Manager (System User →
  // ressources). L'écran revérifie chez Meta.
  const fixConn = (shopId: string, key: string, label: string) => {
    const k = shopId + key
    setBusy((b) => ({ ...b, [k]: true }))
    const fini = () =>
      setBusy((b) => {
        const n = { ...b }
        delete n[k]
        return n
      })
    P.testerConnexions(shopId)
      .then((res) => {
        fini()
        const r = (res.resultats ?? [])[0] ?? ({} as Rec)
        toast(
          r[key] === 'connected'
            ? `${label} ${shopId === 'marque' ? '' : parId(etat.shops, shopId)?.name ?? ''} : connecté.`
            : `${label} : ${txt((r.detail as Rec | undefined)?.[key]) || 'toujours en défaut'}.`,
        )
        return charger()
      })
      .catch((e: unknown) => {
        fini()
        toast(`Test impossible : ${erreurDe(e)}`)
      })
  }
  const testAll = () => {
    setTesting(true)
    P.testerConnexions()
      .then((res) => {
        setTesting(false)
        const ko = (res.resultats ?? []).reduce(
          (a, r) => a + (r.shop === 'marque' ? netKeys.map(([k]) => k) : cols.map(([k]) => k)).filter((k) => r[k] !== 'connected').length,
          0,
        )
        toast(ko ? `${ko} connexion(s) toujours en défaut.` : 'Toutes les connexions répondent.')
        return charger()
      })
      .catch((e: unknown) => {
        setTesting(false)
        toast(`Test impossible : ${erreurDe(e)}`)
      })
  }

  const cellule = (v: string, detail: string, k: string, onFix: () => void, key: string) => {
    const c = CONN[v] ?? CONN.none
    const occ = !!busy[k]
    return (
      <div key={key} className={`par__conn${v === 'connected' ? '' : ' is-ko'}`}>
        <span className="par__conn-texte">
          <span className="par__tag" style={{ background: c.bg, color: c.fg }}>
            {c.label}
          </span>
          <span className="muted par__ellipse">{detail}</span>
        </span>
        {v !== 'connected' && !occ && (
          <button type="button" className="btn btn--sm" onClick={onFix}>
            Revérifier
          </button>
        )}
        {occ && <span className="muted par__petit">Vérification…</span>}
      </div>
    )
  }
  const jamais = 'Jamais vérifié — « Tester toutes les connexions »'
  const nOk =
    etat.shops.reduce((a, sh) => a + cols.filter(([k]) => (sh as Rec)[k] === 'connected').length, 0) + netKeys.filter(([k]) => B[k] === 'connected').length
  const nTot = etat.shops.length * cols.length + netKeys.length
  const last = etat.meta.lastCheck

  return (
    <>
      {alerts.length > 0 && (
        <p className="warning">
          {alerts.length} connexion(s) en défaut : {alerts.map((a) => `${a.shop} · ${a.what} (${(CONN[a.st] ?? CONN.none).label})`).join(' — ')}. Les
          publications concernées échoueront tant qu’elles ne sont pas rétablies.
        </p>
      )}
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">
            {nOk} connexions actives sur {nTot}
            {last ? ` · dernier contrôle ${dd(String(last))}` : ' · jamais contrôlées'}
          </span>
          <span className="media__spacer" />
          <button type="button" className="btn btn--primary" disabled={testing} onClick={testAll}>
            {testing ? 'Test en cours…' : 'Tester toutes les connexions'}
          </button>
        </div>
      </div>
      {netKeys.length > 0 && (
        <section className="card par__carte">
          <div className="par__tete">
            <span>Réseau · un seul compte pour toutes les boutiques</span>
            <span className="muted">
              {[R.instagram ? 'Instagram unique (compte de la marque)' : '', R.publicite ? 'compte publicitaire réseau' : ''].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="par__grille par__grille--240">
            {netKeys.map(([key, title]) => (
              <div key={key} className="par__reseau">
                <span className="par__label">{title}</span>
                {cellule(
                  txt(B[key]) || 'none',
                  txt((B.connDetail as Rec | undefined)?.[key]) || (B.checkedAt ? '—' : jamais),
                  `marque${key}`,
                  () => fixConn('marque', key, title),
                  key,
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card table-card par__table">
        <div className="table-scroll">
          <table style={{ minWidth: 180 + cols.length * 220 }}>
            <thead>
              <tr>
                <th>Boutique</th>
                {cols.map(([, l]) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(etat.shops as (Boutique & Rec)[]).map((sh) => (
                <tr key={sh.id}>
                  <td>
                    <span className="par__nom">
                      <span>
                        {sh.name}
                        {sh.test ? ' · magasin test' : ''}
                      </span>
                      <span className="muted">{sh.address}</span>
                    </span>
                  </td>
                  {cols.map(([key, label]) => (
                    <td key={key}>
                      {cellule(
                        txt(sh[key]) || 'none',
                        txt((sh.connDetail as Rec | undefined)?.[key]) || (sh.checkedAt ? '—' : jamais),
                        sh.id + key,
                        () => fixConn(sh.id, key, label),
                        key,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted par__note">
        Publication via Graph API (Pages API, permission pages_manage_posts) avec un Page access token par boutique. Publicités via Marketing API. Les
        tokens sont stockés côté serveur ; le navigateur n'y a jamais accès.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// API Meta : clés, portefeuille, version, permissions, DSA, conventions, identifiants
// ---------------------------------------------------------------------------------------------------------

const CLES_VIDES = { appId: '', systemToken: '', appSecret: '', verifyToken: '' }

function ApiMeta({ etat, serveur, toast }: OngletProps) {
  const [keys, setKeys] = useState<Record<string, string>>(CLES_VIDES)
  const [msLocal, setMsLocal] = useState<MetaStatus | null>(null)
  const [pf, setPf] = useState<Portefeuille | null>(null)
  const [pfBiz, setPfBiz] = useState<string | null>(null)
  const [pfBusy, setPfBusy] = useState(false)
  const [idsAuto, setIdsAuto] = useState<IdsAuto | null>(null)
  const [idsBusy, setIdsBusy] = useState(false)
  const params = etat.params
  const [publicUrl, setPublicUrl] = useReglageDiffere(txt(params.url_publique), 'url_publique', () => 'URL publique enregistrée.', toast)
  const [marketingApi, setMarketingApi] = useReglageDiffere(
    txt(params.marketing_api),
    'marketing_api',
    () => 'API Marketing enregistrée — rechargez pour relire les opérations.',
    toast,
  )

  useEffect(() => setMsLocal(null), [serveur])
  const ms: MetaStatus = msLocal ?? (serveur.metaStatus as MetaStatus | undefined) ?? {}

  // Portefeuille Business Manager (GET au premier affichage) et mise à jour automatique des identifiants.
  useEffect(() => {
    P.lirePortefeuille()
      .then((r) => {
        setPf(r.portefeuille ?? {})
        setPfBiz((b) => (b != null ? b : r.businessId ?? ''))
      })
      .catch(() => {})
    P.lireIdsAuto()
      .then(setIdsAuto)
      .catch(() => {})
  }, [])

  // Clés -----------------------------------------------------------------------------------------------
  const J = ms.jeton ?? null
  const src = ms.sources ?? {}
  // Le token : son état réel chez Meta (debug_token) quand l'App ID et la clé secrète sont connus.
  const etatJeton = !ms.tokenDefini
    ? 'absent'
    : !J
      ? 'enregistré · non vérifié (App ID + clé secrète requis)'
      : J.valide && !J.erreur
        ? `valide · expire : ${J.expire}`
        : `invalide : ${J.erreur || 'refusé par Meta'}`
  const champsCles: [string, string, keyof MetaStatus, string, string][] = [
    ['appId', "Identifiant de l'application (App ID)", 'appId', ms.appId || '1234567890', 'text'],
    ['systemToken', 'Token du System User', 'tokenDefini', 'EAAG…', 'password'],
    ['appSecret', "Clé secrète de l'app", 'secretDefini', 'app secret', 'password'],
    ['verifyToken', 'Jeton du webhook', 'verifyDefini', 'chaîne libre', 'password'],
  ]
  const crmReprise = !!ms.crm?.dispo && Object.values(src).includes('social')
  const saveKeys = () =>
    P.enregistrerCles(keys)
      .then((r) => {
        if (r.metaStatus) setMsLocal(r.metaStatus)
        setKeys(CLES_VIDES)
        const ids = r.ids?.ok
          ? r.ids.appliques?.length
            ? ` Identifiants des boutiques relus dans le portefeuille : ${r.ids.appliques.join(' · ')}.`
            : ' Portefeuille relu : identifiants déjà à jour.'
          : ''
        if (r.ids) {
          setIdsAuto((s) => ({ ...(s ?? {}), dernier: r.ids }))
          P.lirePortefeuille()
            .then((x) => setPf(x.portefeuille ?? {}))
            .catch(() => {})
        }
        toast((r.maj.length ? `${r.maj.length} clé(s) enregistrée(s) en base.` : 'Aucune clé saisie.') + ids)
        return charger()
      })
      .catch((e: unknown) => toast(`Enregistrement impossible : ${erreurDe(e)}`))
  const reprendre = () => {
    if (!window.confirm('Retirer les clés Meta saisies ici et reprendre la connexion du CRM candidat ?')) return
    P.reprendreCrm()
      .then((r) => {
        if (r.metaStatus) setMsLocal(r.metaStatus)
        toast('Connexion du CRM reprise.')
        return charger()
      })
      .catch((e: unknown) => toast(`Impossible : ${erreurDe(e)}`))
  }

  // Identifiants automatiques ---------------------------------------------------------------------------
  const IA = idsAuto?.config ?? { actif: true, ecraser: false, frequence: 1 }
  const D = idsAuto?.dernier
  const saveIds = (patch: Partial<typeof IA>) => {
    const c = { ...IA, ...patch }
    setIdsAuto((s) => ({ ...(s ?? {}), config: c }))
    P.enregistrerIdsAuto(c)
      .then((r) => {
        setIdsAuto(r)
        toast(
          c.actif
            ? `Mise à jour automatique : toutes les ${c.frequence} h${c.ecraser ? ', saisies manuelles comprises.' : ', champs vides seulement.'}`
            : 'Mise à jour automatique désactivée.',
        )
      })
      .catch((e: unknown) => toast(erreurDe(e)))
  }
  const idsLast = !D
    ? IA.actif
      ? 'Jamais lancée : elle part au prochain passage (à la 37e minute de chaque heure), ou tout de suite avec le bouton.'
      : 'Désactivée.'
    : D.ok
      ? `Dernière mise à jour le ${dd(D.le)} · ${D.appliques?.length ? `${D.appliques.length} boutique(s) complétée(s) : ${D.appliques.join(' · ')}` : 'rien de nouveau'}${
          (D.erreurs ?? []).length ? ` · ${(D.erreurs ?? []).length} lecture(s) refusée(s) par Meta` : ''
        }`
      : `Échec le ${dd(D.le)} : ${(D.erreurs ?? []).join(' · ')}`
  const idsLastCls = D && !D.ok ? 'is-alerte' : D && (D.erreurs ?? []).length ? 'is-moyen' : ''
  const idsRun = () => {
    if (idsBusy) return
    setIdsBusy(true)
    P.lancerIdsAuto()
      .then((r) => {
        void charger()
        setIdsBusy(false)
        setIdsAuto({ config: r.config, dernier: r.dernier })
        if (r.portefeuille) setPf(r.portefeuille)
        const d = r.dernier ?? {}
        toast(
          d.ok === false
            ? `Échec : ${(d.erreurs ?? []).join(' · ')}`
            : d.appliques?.length
              ? `Identifiants mis à jour : ${d.appliques.join(' · ')}`
              : 'Portefeuille relu : rien de nouveau à remplir.',
        )
      })
      .catch((e: unknown) => {
        setIdsBusy(false)
        toast(`Mise à jour impossible : ${erreurDe(e)}`)
      })
  }

  // Portefeuille ----------------------------------------------------------------------------------------
  const PF = pf ?? {}
  const nom = (id: string | null | undefined) => (id === 'marque' ? 'Marque' : id ? parId(etat.shops, id)?.name ?? id : 'non rapprochée')
  const row = (r: P.LignePf, note?: string) => ({ name: r.name || r.username || '—', id: r.id, note: note || '', shop: nom(r.boutique), on: !!r.boutique })
  const groupes: [string, ReturnType<typeof row>[]][] = [
    ['Pages Facebook', (PF.pages ?? []).map((r) => row(r, r.lien))],
    ['Comptes publicitaires', (PF.comptes ?? []).map((r) => row(r, `${r.actif ? '' : '· inactif '}${r.devise || ''}`))],
    ['Instagram', (PF.instagram ?? []).map((r) => row({ ...r, name: `@${r.username || r.id}` }))],
    ['Pixels', (PF.pixels ?? []).map((r) => row(r))],
  ]
  const appliquer = (ecraser: boolean) =>
    P.appliquerPortefeuille(ecraser)
      .then((r) => {
        void charger()
        toast(r.appliques.length ? `Identifiants remplis : ${r.appliques.join(' · ')}` : 'Rien à remplir.')
      })
      .catch((e: unknown) => toast(erreurDe(e)))
  const pfRefresh = () => {
    if (pfBusy) return
    setPfBusy(true)
    P.rafraichirPortefeuille(pfBiz || '')
      .then((r) => {
        setPf(r.portefeuille)
        setPfBusy(false)
        toast(`${(r.portefeuille.pages ?? []).length} Page(s), ${(r.portefeuille.comptes ?? []).length} compte(s) pub relus.`)
      })
      .catch((e: unknown) => {
        setPfBusy(false)
        toast(`Lecture impossible : ${erreurDe(e)}`)
      })
  }
  const manque = META_PERMISSIONS.filter((x) => !(J?.scopes ?? []).includes(x))
  // Le diagnostic d'abord : le type de token et les permissions qui manquent expliquent les refus.
  const pfErr =
    (J?.type && J.type !== 'SYSTEM_USER' ? `Le token enregistré est un token ${J.type} (personnel), pas celui d’un utilisateur système. ` : '') +
    (manque.length ? `Permissions absentes du token : ${manque.join(', ')}. ` : '') +
    `Lectures refusées par Meta : ${(PF.erreurs ?? []).join(' · ')}`

  // Version, DSA, identifiants (état du module, `meta`) --------------------------------------------------
  const meta = etat.meta
  const version = meta.version || META_VERSIONS[0]
  const versions = META_VERSIONS.includes(version) ? META_VERSIONS : META_VERSIONS.concat(version)
  const dsa = { beneficiary: '', payor: '', ...(meta.dsa ?? {}) }
  const ids = meta.ids ?? {}
  const setMeta = (p: Partial<EtatSocial['meta']>) => enregistrer({ meta: { ...etat.meta, ...p } })
  const lignesIds = [{ id: 'marque', name: `Marque · ${txt(marqueDe(serveur).name) || 'L’Atelier By'}`, test: false } as { id: string; name: string; test?: boolean }].concat(
    boutiquesEtTests(etat),
  )
  const COLS_IDS = ['page_id', 'ad_account_id', 'instagram_user_id', 'pixel_id']

  return (
    <>
      <section id="sec-cles" className="card par__carte">
        <div className="par__tete">
          <span>Clés d'accès Meta</span>
          <span className="muted">Chiffrées en base (mar_keys) · jamais réaffichées · un champ vide ne change rien</span>
        </div>
        <div className="par__grille par__grille--240">
          {champsCles.map(([k, label, flag, ph, type]) => {
            const ok = k === 'systemToken' ? !!(J && J.valide && !J.erreur) : !!ms[flag]
            // Un champ vide ici reprend la connexion partagée du CRM candidat (table meta_connexion).
            const etatK =
              (k === 'systemToken' ? etatJeton : k === 'appId' ? ms.appId || 'absent' : ms[flag] ? 'enregistré' : 'absent') + (src[k] === 'crm' ? ' · repris du CRM' : '')
            return (
              <label key={k} className="par__champ">
                <span>
                  {label} <span className={ok ? 'is-bon' : 'is-alerte'}>· {etatK}</span>
                </span>
                <input
                  className="par__mono"
                  type={type}
                  autoComplete="off"
                  value={keys[k]}
                  placeholder={ph}
                  onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
                />
              </label>
            )
          })}
        </div>
        <div className="par__ligne">
          <button type="button" className="btn btn--primary" onClick={saveKeys}>
            Enregistrer les clés
          </button>
          {crmReprise && (
            <button
              type="button"
              className="btn"
              onClick={reprendre}
              title={`Vide les clés saisies ici : celles du CRM candidat (application ${ms.crm?.appId || '?'}) sont utilisées — la même application que ses formulaires de candidature.`}
            >
              ↺ Reprendre la connexion du CRM
            </button>
          )}
          <label className="par__en-ligne">
            URL publique du module (Meta y télécharge les visuels)
            <input className="par__mono par__w260" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
          </label>
          <label className="par__en-ligne">
            API Marketing du BO (les opérations)
            <input
              className="par__mono par__w260"
              value={marketingApi}
              onChange={(e) => setMarketingApi(e.target.value)}
              title="Adresse appelée par le serveur pour lire les campagnes commerciales (GET …/campaigns)"
            />
          </label>
        </div>
      </section>

      <section id="sec-pf" className="card par__carte">
        <div className="par__tete par__tete--centre">
          <span className="par__titre">
            <span>Portefeuille Business Manager</span>
            <span className="muted">
              {PF.le
                ? `${PF.business?.id ? `Business ${PF.business.name || ''} (${PF.business.id}) · ` : 'Business non trouvé · '}relu le ${dd(PF.le)}`
                : 'Jamais relu — « Rafraîchir » lit chez Meta les Pages, comptes publicitaires, comptes Instagram et pixels visibles du System User.'}
            </span>
          </span>
          <span className="par__ligne">
            <input className="par__mono par__w190" value={pfBiz ?? ''} onChange={(e) => setPfBiz(e.target.value)} placeholder="Business ID (facultatif)" />
            <button type="button" className="btn" disabled={pfBusy} onClick={pfRefresh}>
              {pfBusy ? 'Lecture chez Meta…' : 'Rafraîchir'}
            </button>
          </span>
        </div>
        {(PF.erreurs ?? []).length > 0 && <p className="warning">{pfErr}</p>}
        <div className="par__grille par__grille--260">
          {groupes.map(([titre, rows]) => (
            <div key={titre} className="par__pf">
              <div className="par__pf-titre">
                {titre} · {rows.length}
              </div>
              {rows.map((r) => (
                <div key={r.id} className="par__pf-ligne">
                  <span className="par__pf-nom">
                    <span className="par__ellipse">{r.name}</span>
                    <span className="par__mono par__faint">
                      {r.id} {r.note}
                    </span>
                  </span>
                  <span className={`par__tag${r.on ? ' is-bon-fond' : ''}`}>{r.shop}</span>
                </div>
              ))}
              {rows.length === 0 && <div className="par__pf-vide">Rien de visible</div>}
            </div>
          ))}
        </div>
        <div className="par__ligne">
          <button type="button" className="btn btn--sm" onClick={() => appliquer(false)}>
            Remplir les identifiants vides
          </button>
          <button type="button" className="btn btn--sm" onClick={() => appliquer(true)}>
            Tout remplacer par le portefeuille
          </button>
          <span className="muted par__petit">
            Rapprochement par le nom de la ville dans le nom de la Page / du compte ; « L'Atelier By » seul → la marque. Vérifiez puis corrigez au
            besoin dans le tableau des identifiants.
          </span>
        </div>
      </section>

      <div className="par__grille par__grille--300">
        <section id="sec-version" className="card par__carte">
          <span>
            Version de l'API <span className="par__mono par__faint">{'{VERSION}'}</span>
          </span>
          <div className="par__ligne">
            {versions.map((v) => (
              <Puce
                key={v}
                mono
                on={version === v}
                onClick={() => {
                  setMeta({ version: v })
                  journaliser('Connexion', `Version API Meta : ${v}`)
                }}
              >
                {v}
              </Puce>
            ))}
          </div>
          <span className="par__code">
            {META_BASE}
            {version}/
          </span>
          <p className="warning">
            La doc Meta affiche v25.0 ; une v26.0 est signalée depuis le 29/07/2026. Vérifiez le changelog Marketing API avant de figer la version.
          </p>
          <span className="muted par__petit">
            Backend Franchise Buddy : <span className="par__mono">{'{API_BASE_URL}/api/v1/social/{domaine}/{ressource}'}</span> · session du cockpit
            (même connexion que le BO consultant). Le navigateur n'appelle jamais Meta directement.
          </span>
        </section>
        <section id="sec-perms" className="card par__carte">
          <span>Permissions et niveaux d'accès</span>
          <div>
            {META_PERMISSIONS.map((id) => {
              // Les permissions que le token a VRAIMENT (debug_token), pas la liste attendue.
              const ok = !!J && (J.scopes ?? []).includes(id)
              const level = !J ? 'Non vérifiée' : ok ? 'Accordée' : 'Manquante'
              return (
                <div key={id} className="par__perm">
                  <span className="par__mono">{id}</span>
                  <span className={`par__tag${ok ? ' is-bon-fond' : J ? ' is-alerte-fond' : ''}`}>{level}</span>
                </div>
              )
            })}
          </div>
          <span className="muted par__petit">
            Depuis mai 2026, « Standard » s'appelle « Limited access » et « Advanced » s'appelle « Full access » dans le dashboard Meta.
            leads_retrieval doit passer en Full access pour lire les leads de toutes les Pages.
          </span>
        </section>
        <section id="sec-dsa" className="card par__carte">
          <span>Transparence UE (DSA) · obligatoire pour cibler la Belgique</span>
          <label className="par__champ">
            <span>
              Bénéficiaire <span className="par__mono par__faint">dsa_beneficiary</span>
            </span>
            <Champ type="text" valeur={dsa.beneficiary} onValider={(v) => setMeta({ dsa: { ...dsa, beneficiary: v } })} />
          </label>
          <label className="par__champ">
            <span>
              Payeur <span className="par__mono par__faint">dsa_payor</span>
            </span>
            <Champ type="text" valeur={dsa.payor} onValider={(v) => setMeta({ dsa: { ...dsa, payor: v } })} />
          </label>
          <span className="muted par__petit">Pré-rempli dans chaque ad set créé par l'assistant Publicités.</span>
        </section>
        <section className="card par__carte">
          <span>Conventions</span>
          <span className="par__texte">
            Montants en centimes : 20 € → <span className="par__mono">2000</span>.
          </span>
          <span className="par__texte">
            Dates en ISO 8601 (<span className="par__mono">2026-10-18T08:00:00+0200</span>) ou timestamp Unix.
          </span>
          <span className="par__texte">
            Posts programmés : <span className="par__mono">published=false</span> + <span className="par__mono">scheduled_publish_time</span>, entre
            10 minutes et 30 jours.
          </span>
          <span className="par__texte">Tokens : System User (Business Manager) pour les pubs, Page token par boutique pour les posts.</span>
        </section>
      </div>

      <section id="sec-ids" className="card table-card par__table">
        <div className="par__tete par__tete--bord">
          <span>Identifiants Meta par boutique</span>
          <span className="muted par__en-ligne">
            Compte réseau :
            <Champ className="par__mono par__w150" valeur={meta.networkAccount || ''} placeholder="act_…" onValider={(v) => setMeta({ networkAccount: v.trim() })} />
          </span>
        </div>
        <div className="par__auto">
          <label className="par__case">
            <input type="checkbox" checked={IA.actif} onChange={() => saveIds({ actif: !IA.actif })} />
            Mise à jour automatique depuis le portefeuille Meta
          </label>
          <span className="par__en-ligne">
            toutes les
            <select value={String(IA.frequence || 1)} disabled={!IA.actif} onChange={(e) => saveIds({ frequence: Number(e.target.value) })}>
              <option value="1">heures</option>
              <option value="6">6 heures</option>
              <option value="24">24 heures</option>
            </select>
          </span>
          <label className="par__case">
            <input type="checkbox" checked={IA.ecraser} disabled={!IA.actif} onChange={() => saveIds({ ecraser: !IA.ecraser })} />
            Remplacer aussi les identifiants saisis à la main
          </label>
          <span className={`par__auto-etat ${idsLastCls}`}>{idsLast}</span>
          <button type="button" className="btn btn--sm" disabled={idsBusy} onClick={idsRun}>
            {idsBusy ? 'Lecture chez Meta…' : 'Mettre à jour maintenant'}
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Boutique</th>
                {COLS_IDS.map((k) => (
                  <th key={k} className="par__mono">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignesIds.map((sh) => (
                <tr key={sh.id}>
                  <td>
                    {sh.name}
                    {sh.test ? ' · magasin test' : ''}
                  </td>
                  {COLS_IDS.map((k) => {
                    const v = ids[sh.id]?.[k] ?? ''
                    return (
                      <td key={k} className={v ? '' : 'par__vide'}>
                        <Champ
                          className="par__mono par__plein"
                          type="text"
                          valeur={v}
                          placeholder={k === 'ad_account_id' ? 'act_… (non connecté)' : '—'}
                          onValider={(nv) => setMeta({ ids: { ...ids, [sh.id]: { ...(ids[sh.id] ?? {}), [k]: nv.trim() } } })}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Google : une connexion (fiches des boutiques, Google Ads, Analytics), les comptes trouvés, le rattachement
// ---------------------------------------------------------------------------------------------------------

const API_GOOGLE: [string, string][] = [
  ['fiches', 'Fiches Google des boutiques'],
  ['ads', 'Google Ads'],
  ['ga4', 'Google Analytics 4'],
]
const fmtAds = (id: unknown) => txt(id).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

function Google({ etat, toast }: OngletProps) {
  const [G, setG] = useState<EcranGoogle | null>(null)
  const [K, setK] = useState<{ clientId: string; clientSecret: string; refreshToken: string; mcc: string | null }>({ clientId: '', clientSecret: '', refreshToken: '', mcc: null })
  const [gIds, setGIds] = useState<NonNullable<EcranGoogle['ids']> | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    P.lireGoogle()
      .then(setG)
      .catch((e: unknown) => setG({ erreur: erreurDe(e) }))
  }, [])

  const St = G?.statut ?? {}
  const V = St.verification ?? null
  const D = G?.decouverte ?? null
  const I = G?.ids ?? { boutiques: {}, reseau: { ads: '', ga4: '' } }
  const Sg = G?.suggestions ?? {}
  const shops = boutiquesEtTests(etat)
  const appel = (cle: string, f: () => Promise<EcranGoogle>, ok?: (r: EcranGoogle) => string) => {
    setBusy(cle)
    return f()
      .then((r) => {
        setG(r)
        setBusy('')
        if (ok) toast(ok(r))
        return r
      })
      .catch((e: unknown) => {
        setBusy('')
        toast(erreurDe(e) || 'Erreur')
      })
  }
  // Le rattachement en cours d'édition : l'enregistré, complété des fiches proposées.
  const ids =
    gIds ??
    ({
      boutiques: Object.fromEntries(shops.map((x) => [x.id, { fiche: I.boutiques[x.id]?.fiche || Sg[x.id] || '', ads: I.boutiques[x.id]?.ads || '' }])),
      reseau: Object.assign({ ads: '', ga4: '' }, I.reseau),
    } as NonNullable<EcranGoogle['ids']>)
  const majIds = (f: (n: NonNullable<EcranGoogle['ids']>) => NonNullable<EcranGoogle['ids']>) => setGIds(f(JSON.parse(JSON.stringify(ids))))
  const fiches = D?.fiches ?? []
  const ads = D?.ads ?? []
  const ga4 = D?.ga4 ?? []
  const etatTexte = G?.erreur
    ? `Illisible : ${G.erreur}`
    : !St.configure
      ? 'Pas encore connecté'
      : V?.valide
        ? `Connecté${V.email ? ` · ${V.email}` : ''} · vérifié le ${V.le}`
        : V?.erreur
          ? 'Connexion refusée'
          : 'À vérifier'
  const etatCls = St.configure && V?.valide ? 'is-bon' : St.configure ? 'is-alerte' : 'muted'
  const erreurs = [V?.erreur ?? ''].concat(API_GOOGLE.map(([k, label]) => (V?.apis?.[k]?.erreur ? `${label} : ${V.apis[k].erreur}` : ''))).filter(Boolean)
  const decErreurs = D ? API_GOOGLE.map(([k, label]) => (D.erreurs?.[k] ? `${label} : ${D.erreurs[k]}` : '')).filter(Boolean) : []
  const ficheOpts = [{ v: '', l: '— aucune —' }].concat(fiches.map((f) => ({ v: f.id, l: f.nom + (f.adresse ? ` · ${f.adresse}` : '') })))
  const adsOpts = [{ v: '', l: '— aucun —' }].concat(
    ads.map((a) => ({ v: a.id, l: `${a.nom || 'Compte'} · ${fmtAds(a.id)}${a.devise ? ` · ${a.devise}` : ''}${a.administrateur ? ' · administrateur' : ''}` })),
  )
  const ga4Opts = [{ v: '', l: '— aucune —' }].concat(ga4.map((p) => ({ v: p.id, l: `${p.nom} · ${p.id}` })))
  const options = (o: { v: string; l: string }[]) =>
    o.map((x) => (
      <option key={x.v} value={x.v}>
        {x.l}
      </option>
    ))

  const gSave = () => {
    if (busy) return
    const corps: Record<string, string> = { clientId: K.clientId.trim(), clientSecret: K.clientSecret.trim(), refreshToken: K.refreshToken.trim() }
    if (K.mcc !== null) corps.mcc = K.mcc
    void appel('cles', () => P.enregistrerGoogle(corps), (r) => {
      setK({ clientId: '', clientSecret: '', refreshToken: '', mcc: null })
      const v = r.statut?.verification
      return v?.valide ? 'Google connecté.' : `Clés enregistrées — ${v?.erreur || 'à compléter'}`
    })
  }

  return (
    <>
      <section className="card par__carte">
        <div className="par__tete">
          <span>Connexion Google</span>
          <span className={etatCls}>{etatTexte}</span>
        </div>
        <span className="muted par__texte">
          Un seul compte Google pour les fiches des boutiques, Google Ads et Google Analytics. Les clés restent sur le serveur, jamais dans l’écran.
        </span>
        <div className="par__ligne">
          {API_GOOGLE.map(([k, label]) => {
            const a = V?.apis?.[k] ?? null
            const ok = !!a?.ok
            return (
              <span key={k} title={a?.erreur || ''} className={`par__tag${ok ? ' is-bon-fond' : a ? ' is-moyen-fond' : ''}`}>
                {ok ? '✓ ' : a ? '⏳ ' : ''}
                {label}
              </span>
            )
          })}
        </div>
        {erreurs.map((t) => (
          <p key={t} className="warning">
            {t}
          </p>
        ))}
        <div className="par__grille par__grille--260">
          <label className="par__champ">
            ID du client OAuth
            <input className="par__mono" value={K.clientId} onChange={(e) => setK({ ...K, clientId: e.target.value })} placeholder={St.clientId || '…apps.googleusercontent.com'} />
          </label>
          <label className="par__champ">
            Clé secrète du client
            <input
              className="par__mono"
              type="password"
              autoComplete="off"
              value={K.clientSecret}
              onChange={(e) => setK({ ...K, clientSecret: e.target.value })}
              placeholder={St.secretDefini ? 'définie — laisser vide pour la garder' : 'GOCSPX-…'}
            />
          </label>
          <label className="par__champ">
            Jeton de rafraîchissement
            <input
              className="par__mono"
              type="password"
              autoComplete="off"
              value={K.refreshToken}
              onChange={(e) => setK({ ...K, refreshToken: e.target.value })}
              placeholder={St.jetonDefini ? 'défini — laisser vide pour le garder' : '1//…'}
            />
          </label>
          <label className="par__champ">
            Compte administrateur Google Ads (facultatif)
            <input value={K.mcc !== null ? K.mcc : fmtAds(St.mcc)} onChange={(e) => setK({ ...K, mcc: e.target.value })} placeholder="123-456-7890" />
          </label>
        </div>
        <div className="par__ligne">
          <button type="button" className="btn btn--primary" disabled={!!busy} onClick={gSave}>
            {busy === 'cles' ? 'Vérification chez Google…' : 'Enregistrer et vérifier'}
          </button>
          {St.configure && (
            <>
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  void appel('verif', P.verifierGoogle, (r) =>
                    r.statut?.verification?.valide ? 'Connexion Google vérifiée.' : `Google refuse : ${r.statut?.verification?.erreur || ''}`,
                  )
                }
              >
                Vérifier
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm('Déconnecter Google ? Le jeton est révoqué chez Google ; il faudra en refaire un.'))
                    void appel('deco', P.deconnecterGoogle, () => 'Google déconnecté.')
                }}
              >
                Déconnecter
              </button>
            </>
          )}
        </div>
        <details className="par__details">
          <summary>Où trouver ces clés ?</summary>
          <ol>
            <li>
              Console Google Cloud : un projet, avec les API « My Business Account Management », « My Business Business Information », « Google Ads API »,
              « Google Analytics Admin » et « Google Analytics Data » activées.
            </li>
            <li>Écran de consentement OAuth : publié « En production » (en « Test », le jeton expire au bout de 7 jours).</li>
            <li>
              Identifiants → ID client OAuth de type « Application Web », avec l’URI de redirection https://developers.google.com/oauthplayground : l’ID et la
              clé secrète vont ici.
            </li>
            <li>
              OAuth Playground (réglages ⚙ → « Use your own OAuth credentials ») : autoriser les trois accès (business.manage, adwords, analytics.readonly)
              avec le compte Google qui gère les fiches, Ads et Analytics, puis « Exchange authorization code for tokens » : le Refresh token va ici.
            </li>
            <li>
              Les accès que Google doit accorder : fiches (formulaire « Business Profile API »), Google Ads (niveau « Explorer » dans la console Google Cloud).
              Le détail : docs/GOOGLE.md.
            </li>
          </ol>
        </details>
      </section>

      <section className="card par__carte">
        <div className="par__tete par__tete--centre">
          <span className="par__titre">
            <span>Vos comptes Google</span>
            <span className="muted">{D ? `Dernière recherche : ${D.le}` : St.configure ? 'Pas encore cherchés.' : 'Connectez Google d’abord.'}</span>
          </span>
          <button
            type="button"
            className="btn"
            disabled={!St.configure || !!busy}
            onClick={() =>
              void appel('dec', P.decouvrirGoogle, (r) => {
                setGIds(null)
                const t = r.trouves ?? { fiches: 0, ads: 0, ga4: 0 }
                return `Trouvés : ${t.fiches} fiche(s), ${t.ads} compte(s) Ads, ${t.ga4} propriété(s) GA4.`
              })
            }
          >
            {busy === 'dec' ? 'Recherche chez Google…' : 'Rechercher mes fiches, comptes Ads et propriétés GA4'}
          </button>
        </div>
        {D && (
          <div className="par__ligne">
            {(
              [
                [fiches.length, 'fiches Google'],
                [ads.length, 'comptes Google Ads'],
                [ga4.length, 'propriétés GA4'],
              ] as [number, string][]
            ).map(([n, label]) => (
              <span key={label} className="par__tag par__tag--grand">
                {n} {label}
              </span>
            ))}
          </div>
        )}
        {decErreurs.map((t) => (
          <p key={t} className="warning">
            {t}
          </p>
        ))}
      </section>

      <section className="card par__carte">
        <span>Rattachement par boutique</span>
        <span className="muted par__texte">
          La fiche Google de chaque boutique (avis, réponses, statistiques) et son compte Google Ads s’il en a un. « proposée » : la fiche dont l’identifiant
          Google est celui de la Réputation digitale du BO, ou dont le nom cite la boutique — à vérifier puis enregistrer.
        </span>
        <div className="table-scroll par__cadre">
          <table style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Fiche Google</th>
                <th>Compte Google Ads</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((x) => {
                const b = ids.boutiques[x.id] ?? { fiche: '', ads: '' }
                const enregistree = I.boutiques[x.id]?.fiche
                const prop = !enregistree && !!Sg[x.id] && b.fiche === Sg[x.id]
                const note = prop ? 'fiche proposée — à enregistrer' : enregistree ? 'rattachée' : x.test ? 'magasin test' : 'pas de fiche'
                return (
                  <tr key={x.id}>
                    <td>
                      <span className="par__nom">
                        <span>{x.name}</span>
                        <span className={prop ? 'is-moyen' : enregistree ? 'is-bon' : 'par__faint'}>{note}</span>
                      </span>
                    </td>
                    <td>
                      <select
                        className="par__plein"
                        value={b.fiche || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          majIds((n) => ({ ...n, boutiques: { ...n.boutiques, [x.id]: Object.assign({ fiche: '', ads: '' }, n.boutiques[x.id], { fiche: v }) } }))
                        }}
                      >
                        {options(ficheOpts)}
                      </select>
                    </td>
                    <td>
                      <select
                        className="par__plein"
                        value={b.ads || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          majIds((n) => ({ ...n, boutiques: { ...n.boutiques, [x.id]: Object.assign({ fiche: '', ads: '' }, n.boutiques[x.id], { ads: v }) } }))
                        }}
                      >
                        {options(adsOpts)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="par__grille par__grille--240">
          <label className="par__champ">
            Compte Google Ads du réseau
            <select
              value={ids.reseau.ads}
              onChange={(e) => {
                const v = e.target.value
                majIds((n) => ({ ...n, reseau: { ...n.reseau, ads: v } }))
              }}
            >
              {options(adsOpts)}
            </select>
          </label>
          <label className="par__champ">
            Propriété Google Analytics 4 du webshop
            <select
              value={ids.reseau.ga4}
              onChange={(e) => {
                const v = e.target.value
                majIds((n) => ({ ...n, reseau: { ...n.reseau, ga4: v } }))
              }}
            >
              {options(ga4Opts)}
            </select>
          </label>
        </div>
        <div>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() =>
              void appel('ids', () => P.enregistrerIdsGoogle(ids), () => {
                setGIds(null)
                return 'Rattachements Google enregistrés.'
              })
            }
          >
            Enregistrer les rattachements
          </button>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Rédaction IA & charte
// ---------------------------------------------------------------------------------------------------------

interface Charte {
  ton: string
  vouvoiement: boolean
  emojisMax: number | string
  motsInterdits: string[] | string
  hashtags: string[] | string
  hashtagVille: boolean
  longueur: number | string
  signature: string
}

function Redaction({ etat, serveur, toast }: OngletProps) {
  const ia = (serveur.ia as { configure?: boolean; modele?: string; detourage?: boolean } | undefined) ?? { configure: false, modele: '' }
  const [iaKey, setIaKey] = useState('')
  const [rbKey, setRbKey] = useState('')
  const [iaTesting, setIaTesting] = useState(false)
  const [brouillon, setBrouillon] = useState<Partial<Charte> | null>(null)
  const [iaModele, setIaModele] = useReglageDiffere(
    txt(etat.params.ia_modele),
    'ia_modele',
    (v) => (v.trim() ? `Modèle imposé : ${v.trim()}` : 'Modèle : le plus récent de la famille Opus.'),
    toast,
    800,
  )
  const ch: Charte = { ...CHARTE_DEF, ...((serveur.charte as Partial<Charte> | undefined) ?? {}), ...(brouillon ?? {}) }
  const put = <K extends keyof Charte>(k: K, v: Charte[K]) => setBrouillon({ ...(brouillon ?? {}), [k]: v })
  const liste = (v: string[] | string, sep: string) => (Array.isArray(v) ? v.join(sep) : v || '')

  const saveCle = (cle: 'anthropicKey' | 'removebgKey', v: string, vider: () => void, message: string) => {
    if (!v.trim()) {
      toast('Saisissez la clé.')
      return
    }
    P.enregistrerCles({ [cle]: v.trim() })
      .then(() => {
        vider()
        toast(message)
        return charger()
      })
      .catch((e: unknown) => toast(`Enregistrement impossible : ${erreurDe(e)}`))
  }
  const testIa = () => {
    setIaTesting(true)
    P.testerIa()
      .then((r) => {
        setIaTesting(false)
        toast(`Clé valide · modèle : ${r.modele}`)
        void charger()
      })
      .catch((e: unknown) => {
        setIaTesting(false)
        toast(`Test refusé : ${erreurDe(e)}`)
      })
  }
  const saveCharte = () => {
    const c = { ...ch, hashtags: liste(ch.hashtags, ' ').split(/[\s,;]+/).filter(Boolean) }
    P.enregistrerParametres({ charte_editoriale: c })
      .then(() => {
        setBrouillon(null)
        toast('Charte éditoriale enregistrée.')
        return charger()
      })
      .catch((e: unknown) => toast(`Enregistrement impossible : ${erreurDe(e)}`))
  }

  return (
    <>
      <section className="card par__carte">
        <span>Clé API Anthropic (rédaction assistée par Claude)</span>
        <span className="muted par__texte">
          La clé reste sur le serveur (jamais dans l’écran). Elle sert à « Proposer 3 textes », aux réécritures et aux titres du visuel dans Créer un post.
          Modèle : le plus récent de la famille Opus accessible à la clé, sauf réglage ci-dessous.{' '}
          {ia.configure ? `Clé enregistrée${ia.modele ? ` · modèle : ${ia.modele}` : ''}.` : 'Aucune clé enregistrée.'}
        </span>
        <div className="par__ligne">
          <input
            className="par__mono par__flex"
            type="password"
            autoComplete="off"
            value={iaKey}
            onChange={(e) => setIaKey(e.target.value)}
            placeholder={ia.configure ? '•••••• (clé enregistrée — saisir pour la remplacer)' : 'sk-ant-…'}
          />
          <button type="button" className="btn btn--primary" onClick={() => saveCle('anthropicKey', iaKey, () => setIaKey(''), 'Clé API Anthropic enregistrée sur le serveur.')}>
            Enregistrer la clé
          </button>
          <button type="button" className="btn" disabled={!ia.configure || iaTesting} onClick={testIa}>
            {iaTesting ? 'Test…' : 'Tester la clé'}
          </button>
        </div>
        <label className="par__en-ligne">
          Modèle imposé (facultatif)
          <input className="par__mono par__w300" value={iaModele} onChange={(e) => setIaModele(e.target.value)} placeholder="vide : le plus récent de la famille Opus" />
        </label>
      </section>
      <section className="card par__carte">
        <span>Détourage des photos (remove.bg)</span>
        <span className="muted par__texte">
          Le bouton ✂ des photos de Créer un post retire le fond (PNG transparent, idéal pour les styles « détourés »). La clé reste sur le serveur ;
          chaque détourage consomme un crédit remove.bg. {ia.detourage ? 'Clé enregistrée.' : 'Aucune clé enregistrée.'}
        </span>
        <div className="par__ligne">
          <input
            className="par__mono par__flex"
            type="password"
            autoComplete="off"
            value={rbKey}
            onChange={(e) => setRbKey(e.target.value)}
            placeholder={ia.detourage ? '•••••• (clé enregistrée — saisir pour la remplacer)' : 'clé API remove.bg'}
          />
          <button type="button" className="btn" onClick={() => saveCle('removebgKey', rbKey, () => setRbKey(''), 'Clé remove.bg enregistrée sur le serveur.')}>
            Enregistrer la clé
          </button>
        </div>
      </section>
      <section className="card par__carte">
        <span>Charte éditoriale de la marque</span>
        <span className="muted par__texte">
          Suivie par l’assistant de rédaction et vérifiée par la relecture de Créer un post (emojis, mots à éviter, vouvoiement, longueur de l’accroche,
          prix du texte face au prix de vente).
        </span>
        <label className="par__champ">
          Ton de la marque
          <textarea rows={3} value={ch.ton || ''} onChange={(e) => put('ton', e.target.value)} />
        </label>
        <div className="par__ligne">
          <label className="par__case">
            <input type="checkbox" checked={!!ch.vouvoiement} onChange={(e) => put('vouvoiement', e.target.checked)} />
            Vouvoiement
          </label>
          <label className="par__en-ligne">
            Emojis au plus
            <input type="number" min={0} max={10} className="par__w56" value={ch.emojisMax} onChange={(e) => put('emojisMax', e.target.value)} />
          </label>
          <label className="par__en-ligne">
            Accroche (caractères)
            <input type="number" min={60} max={400} className="par__w64" value={ch.longueur} onChange={(e) => put('longueur', e.target.value)} />
          </label>
          <label className="par__case">
            <input type="checkbox" checked={!!ch.hashtagVille} onChange={(e) => put('hashtagVille', e.target.checked)} />
            Hashtag de la boutique (#Halle…)
          </label>
        </div>
        <label className="par__champ">
          Mots et expressions à éviter (séparés par des virgules)
          <input value={liste(ch.motsInterdits, ', ')} onChange={(e) => put('motsInterdits', e.target.value)} placeholder="ex. pas cher, discount, meilleur de Belgique" />
        </label>
        <label className="par__champ">
          Hashtags de la marque
          <input value={liste(ch.hashtags, ' ')} onChange={(e) => put('hashtags', e.target.value)} placeholder="#latelierby" />
        </label>
        <label className="par__champ">
          Signature (facultatif, en fin de texte)
          <input value={ch.signature || ''} onChange={(e) => put('signature', e.target.value)} />
        </label>
        <div>
          <button type="button" className="btn" onClick={saveCharte}>
            Enregistrer la charte
          </button>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Modèles de posts
// ---------------------------------------------------------------------------------------------------------

interface Produit {
  name?: string
  nameNl?: string
  price?: string | number
  apiId?: number
  kind?: string
  categoryId?: number
}

/** Le webshop d'une boutique, ou une page de ce webshop (comme SA.webshopUrl et le serveur, src/publish.php). */
function webshopUrl(serveur: Serveur, etat: EtatSocial, shopId: string, product?: Produit | null, categoryId?: number, groupId?: number, fiche?: boolean) {
  const base = txt(serveur.webshopUrl) || 'https://webshop.atelierby.be/'
  const nav = (serveur.webshopPlan as { cats?: Record<string, number>; prods?: Record<string, number>; categories?: { id: number; groupe?: number }[]; produits?: { id: number; cat?: number }[] } | undefined) ?? {}
  const cats: Record<string, number> = { ...(nav.cats ?? {}) }
  for (const c of nav.categories ?? []) if (c?.id) cats[c.id] = Math.max(Number(c.groupe) || 0, cats[c.id] || 0)
  const prods: Record<string, number> = { ...(nav.prods ?? {}) }
  for (const p of nav.produits ?? []) if (p?.id && p.cat) prods[p.id] = p.cat
  const sh = shopId ? parId(etat.shops, shopId) : null
  const q: [string, string][] = []
  if (shopId && !sh?.test && /^\d+$/.test(shopId)) q.push(['shop', shopId])
  const pid = product?.apiId && product.kind !== 'gamme' ? Number(product.apiId) : 0
  let cat = Number(categoryId) || 0
  let grp = Number(groupId) || 0
  if (pid && !cat) cat = Number(product?.categoryId) || prods[pid] || 0
  if (cat) {
    grp = grp || cats[cat] || 0
    if (grp) q.push(['category', `group:${grp}`], ['sub', `category:${cat}`])
    else q.push(['category', `category:${cat}`])
  } else if (grp) q.push(['category', `group:${grp}`])
  if (pid) {
    q.push(['product', String(pid)])
    if (fiche !== false) q.push(['open', 'product'])
  }
  return q.length ? `${base}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%3A/g, ':')}`).join('&')}` : base
}

/** Sans horaires (magasin test), la phrase qui cite {horaires} disparaît plutôt que « Ouvert . » (comme le serveur). */
const sansHoraires = (t: string) =>
  t.replace(/[ \t]*[^.!?\n]*\{horaires\}[^.!?\n]*[.!?]?/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(\n|$)/g, '$1')

/** Un modèle rempli pour une boutique et un produit (comme SA.fill). */
function remplir(serveur: Serveur, etat: EtatSocial, text: string, s: Boutique | undefined, product: Produit | undefined, lang?: string) {
  const L = lang || (s?.langs?.length ? s.langs[0] : 'fr')
  const h = s ? (L === 'nl' && s.hoursNl ? s.hoursNl : s.hours) : '{horaires}'
  const pname = product ? (L === 'nl' && product.nameNl ? product.nameNl : product.name) : ''
  const sid = s?.id ?? ''
  return (s && !txt(h).trim() ? sansHoraires(txt(text)) : txt(text))
    .replace(/\{horaires\}/g, s ? txt(h) : '{horaires}')
    .replace(/\{produit_du_jour\}/g, product?.name ? txt(pname) : L === 'nl' ? 'Krokante brioche' : 'Brioche croustillante')
    .replace(/\{ville\}/g, s ? s.name : '{ville}')
    .replace(/\{adresse\}/g, s ? txt(s.address) : '{adresse}')
    .replace(/\{prix\}/g, product?.price ? String(product.price) : '{prix}')
    .replace(/\{webshop_produit:liste\}/g, webshopUrl(serveur, etat, sid, product, 0, 0, false))
    .replace(/\{webshop_(produit|categorie|groupe):(\d+)(:liste)?\}/g, (_m, k: string, id: string, l?: string) =>
      k === 'produit'
        ? webshopUrl(serveur, etat, sid, { apiId: Number(id), kind: 'produit' }, 0, 0, !l)
        : k === 'categorie'
          ? webshopUrl(serveur, etat, sid, null, Number(id))
          : webshopUrl(serveur, etat, sid, null, 0, Number(id)),
    )
    .replace(/\{webshop_produit\}/g, webshopUrl(serveur, etat, sid, product))
    .replace(/\{webshop_categorie\}/g, webshopUrl(serveur, etat, sid, null, product?.categoryId))
    .replace(/\{webshop\}/g, webshopUrl(serveur, etat, sid))
    .replace(/\{hashtag_ville\}/g, s ? `#${s.name.replace(/[^\p{L}\p{N}]/gu, '')}` : '{hashtag_ville}')
}

interface Modele extends Objet {
  name?: string
  type?: string
  text?: string
  textNl?: string
}

function Modeles({ etat, serveur, onNaviguer }: OngletProps & { onNaviguer?: (ecran: string, query: string) => void }) {
  const templates = etat.templates as Modele[]
  const reseau = etat.shops.filter((x) => !x.test)
  const fr = reseau[0]
  const nl = reseau.find((x) => (x.langs ?? []).includes('nl')) ?? reseau[0]
  const produit = ((serveur.catalogue as Produit[] | undefined) ?? [])[0]
  const upTpl = (id: string, patch: Partial<Modele>) => enregistrer({ templates: templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const lienPost = lienSocial('post')

  return (
    <>
      <div className="par__droite">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => enregistrer({ templates: [...templates, { id: `t${Date.now()}`, name: 'Nouveau modèle', type: 'Libre', text: 'Chez L’Atelier By {ville} : ' }] })}
        >
          Nouveau modèle
        </button>
      </div>
      <div className="par__grille par__grille--320">
        {templates.map((t) => (
          <div key={t.id} className="card par__carte">
            <div className="par__ligne par__ligne--serre">
              <Champ className="par__flex par__grand" type="text" valeur={txt(t.name)} onValider={(v) => upTpl(t.id, { name: v })} />
              <select value={txt(t.type)} onChange={(e) => upTpl(t.id, { type: e.target.value })}>
                {POST_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <span className="par__label">FR</span>
            <Zone rows={3} valeur={txt(t.text)} onValider={(v) => upTpl(t.id, { text: v })} />
            <span className="par__label">NL</span>
            <Zone rows={3} valeur={txt(t.textNl)} placeholder="Nederlandse versie" onValider={(v) => upTpl(t.id, { textNl: v })} />
            <span className="muted par__petit">
              Aperçu {fr?.name ?? ''} : {remplir(serveur, etat, txt(t.text), fr, produit)}
            </span>
            <span className="muted par__petit">
              Aperçu {nl?.name ?? ''} : {t.textNl ? remplir(serveur, etat, txt(t.textNl), nl, produit, 'nl') : 'à traduire'}
            </span>
            <div className="par__tete par__tete--centre">
              <a
                href={lienPost}
                onClick={
                  onNaviguer
                    ? (e) => {
                        e.preventDefault()
                        onNaviguer('social-post', '')
                      }
                    : undefined
                }
              >
                Créer un post avec ce modèle →
              </a>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => enregistrer({ templates: templates.filter((x) => x.id !== t.id) })}>
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Groupes de boutiques et langue de publication
// ---------------------------------------------------------------------------------------------------------

interface Groupe extends Objet {
  name?: string
  shops: string[]
  lang?: string
}

function Groupes({ etat, toast }: OngletProps) {
  const groups = etat.groups as Groupe[]
  const reseau = etat.shops.filter((x) => !x.test)
  const upGrp = (id: string, patch: Partial<Groupe>) => enregistrer({ groups: groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })
  const OPTS: [string, string][] = [
    ['fr', 'FR'],
    ['nl', 'NL'],
    ['nl,fr', 'NL + FR'],
    ['fr,nl', 'FR + NL'],
  ]

  return (
    <>
      <section className="card par__carte">
        <div className="par__tete">
          <span>Langue de publication par boutique</span>
          <span className="muted">Bilingue : la légende contient les deux langues, le visuel suit la première.</span>
        </div>
        {etat.shops.map((sh) => {
          const langs = sh.langs ?? ['fr']
          const cur = langs.join(',')
          const grp = groups.find((g) => g.lang && g.shops.includes(sh.id))
          return (
            <div key={sh.id} className="par__langue">
              <span>{sh.name}</span>
              <div className="seg">
                {OPTS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={cur === k ? 'is-on' : ''}
                    onClick={() => {
                      enregistrer({ shops: etat.shops.map((x) => (x.id === sh.id ? { ...x, langs: k.split(',') } : x)) })
                      journaliser('Langue', `${sh.name} : ${label}`)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="muted par__petit">
                {grp ? `Défini par le groupe « ${grp.name} » · ` : ''}
                {langs.map((L) => LANGS[L] ?? L).join(' puis ')}
              </span>
            </div>
          )
        })}
      </section>
      <div className="par__droite">
        <button type="button" className="btn btn--primary" onClick={() => enregistrer({ groups: [...groups, { id: `g${Date.now()}`, name: 'Nouveau groupe', shops: [] }] })}>
          Nouveau groupe
        </button>
      </div>
      <div className="par__colonne">
        {groups.map((g) => (
          <div key={g.id} className="card par__groupe">
            <Champ className="par__w220 par__grand" type="text" valeur={txt(g.name)} onValider={(v) => upGrp(g.id, { name: v })} />
            <div className="par__ligne par__flex">
              {reseau.map((sh) => (
                <Puce
                  key={sh.id}
                  on={g.shops.includes(sh.id)}
                  onClick={() => upGrp(g.id, { shops: g.shops.includes(sh.id) ? g.shops.filter((x) => x !== sh.id) : g.shops.concat(sh.id) })}
                >
                  {sh.name}
                </Puce>
              ))}
            </div>
            <select
              value={g.lang || ''}
              title="Langue du groupe"
              onChange={(e) => {
                const v = e.target.value
                enregistrer({
                  groups: groups.map((x) => (x.id === g.id ? { ...x, lang: v } : x)),
                  shops: v ? etat.shops.map((x) => (g.shops.includes(x.id) ? { ...x, langs: v.split(',') } : x)) : etat.shops,
                })
                if (v) {
                  journaliser('Langue', `Groupe ${g.name} : ${v.toUpperCase().replace(',', ' + ')}`)
                  toast(`Langue appliquée aux ${g.shops.length} boutiques du groupe.`)
                }
              }}
            >
              <option value="">Langue : par boutique</option>
              <option value="fr">Groupe en FR</option>
              <option value="nl">Groupe en NL</option>
              <option value="nl,fr">Groupe NL + FR</option>
              <option value="fr,nl">Groupe FR + NL</option>
            </select>
            <span className="muted par__petit">
              {g.shops.length}
              {g.shops.length > 1 ? ' boutiques' : ' boutique'}
            </span>
            <button type="button" className="btn btn--danger btn--sm" onClick={() => enregistrer({ groups: groups.filter((x) => x.id !== g.id) })}>
              Supprimer
            </button>
          </div>
        ))}
      </div>
      <p className="muted par__note">
        Les groupes servent au ciblage d'un post ou d'une publicité. Prévu pour 30 boutiques et plus : une boutique peut appartenir à plusieurs groupes.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Droits
// ---------------------------------------------------------------------------------------------------------

function Droits({ etat, serveur }: OngletProps) {
  const oui = <span className="is-bon">Oui</span>
  const non = <span className="par__faint">Non</span>
  const val = (t: string) => <span>{t}</span>
  const rights: [string, ReactNode[]][] = [
    ['Créer et planifier des posts', ROLES.map((r) => val(r.rights.create))],
    ['Valider les propositions des boutiques', ROLES.map((r) => (r.rights.validate ? oui : non))],
    ['Créer et piloter les publicités', ROLES.map((r) => (r.rights.ads ? oui : non))],
    ['Voir le reporting', ROLES.map((r) => val(r.rights.reporting))],
    ['Voir les données de vente', ROLES.map((r) => (r.rights.sales ? (r.id === 'franchise' ? val('Sa boutique uniquement') : oui) : non))],
    ['Paramètres et connexions', ROLES.map((r) => (r.rights.settings ? oui : non))],
  ]
  const reseau = etat.shops.filter((x) => !x.test)
  const users = [
    { name: serveur.user.name, role: 'Franchiseur (admin réseau)', scope: `Réseau · ${reseau.length} boutiques`, c: '#8D1D2C' },
    ...reseau.filter((sh) => (sh as Rec).franchisee).map((sh) => ({ name: txt((sh as Rec).franchisee), role: 'Franchisé / manager boutique', scope: sh.name, c: '#B0792A' })),
  ]

  return (
    <>
      <section className="card table-card par__table">
        <div className="table-scroll">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Droit</th>
                {ROLES.map((r) => (
                  <th key={r.id}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rights.map(([label, vals]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {vals.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card par__carte">
        <span>Utilisateurs</span>
        {users.map((u, i) => (
          <div key={`${u.name}-${i}`} className="par__user">
            <span className="par__avatar" style={{ background: u.c }}>
              {u.name
                .split(' ')
                .map((x) => x[0])
                .join('')
                .slice(0, 2)}
            </span>
            <span>{u.name}</span>
            <span className="par__petit">{u.role}</span>
            <span className="muted par__petit">{u.scope}</span>
          </div>
        ))}
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Journal d'activité
// ---------------------------------------------------------------------------------------------------------

const LOGC: Record<string, [string, string]> = {
  Publication: ['#E2F0E8', '#0F6B4A'],
  Échec: ['#8D1D2C', '#FFFFFF'],
  'Échec partiel': ['#F6DCDF', '#8D1D2C'],
  Connexion: ['#F6E7CE', '#7A5207'],
  Validation: ['#F2C9A0', '#6b4420'],
  Publicité: ['#EDE9F5', '#3B3468'],
}
const CATS = ['', 'Publication', 'Échec', 'Validation', 'Publicité', 'Connexion']

function Journal({ etat }: OngletProps) {
  const [logF, setLogF] = useState('')
  const rows = etat.activity.filter((l) => !logF || (logF === 'Échec' ? l.what.indexOf('Échec') === 0 : l.what === logF))
  return (
    <>
      <div className="par__ligne">
        {CATS.map((c) => (
          <Puce key={c} on={logF === c} onClick={() => setLogF(c)}>
            {c || 'Tout'}
          </Puce>
        ))}
      </div>
      <section className="card par__journal">
        {rows.map((l, i) => {
          const [bg, fg] = LOGC[l.what] ?? ['#EDE7DE', '#5c5852']
          return (
            <div key={`${l.at}-${i}`} className="par__log">
              <span className="muted">
                {l.at.slice(8, 10)}/{l.at.slice(5, 7)} {l.at.slice(11)}
              </span>
              <span>{l.who}</span>
              <span className="par__tag" style={{ background: bg, color: fg }}>
                {l.what}
              </span>
              <span className="par__log-detail">{l.detail}</span>
            </div>
          )
        })}
        {rows.length === 0 && <div className="par__vide-texte">Aucune entrée pour ce filtre.</div>}
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------
// API TFBuddy : compte, boutiques de l'API, audit des routes
// ---------------------------------------------------------------------------------------------------------

const ST_AUDIT: Record<string, [string, string, string]> = {
  ok: ['Fonctionne', '#E2F0E8', '#0F6B4A'],
  parametre: ['Paramètre', '#F6E7CE', '#7A5207'],
  refuse: ['Refusée', '#F6DCDF', '#8D1D2C'],
  erreur: ['Erreur', '#8D1D2C', '#FFFFFF'],
  injoignable: ['Injoignable', '#8D1D2C', '#FFFFFF'],
  absent: ['Absente (404)', '#EDE7DE', '#5c5852'],
  non_teste: ['Non testée', '#EDE7DE', '#7a736a'],
}
const KO = ['refuse', 'erreur', 'injoignable', 'absent', 'parametre']

interface Tfb {
  base?: string
  swagger?: string
  admin?: { phone?: string; configure?: boolean }
  consultant?: { phone?: string; configure?: boolean }
}

function Tfbuddy({ etat, serveur, toast }: OngletProps) {
  const T = (serveur.tfb as Tfb | undefined) ?? {}
  const [tfb, setTfb] = useState<Record<string, string>>({})
  const [tfbTest, setTfbTest] = useState('')
  const [audit, setAudit] = useState<Audit | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [auditF, setAuditF] = useState('ko')
  const [auditQ, setAuditQ] = useState('')
  const minuteur = useRef(0)
  useEffect(() => {
    P.lireAudit()
      .then(setAudit)
      .catch(() => {})
    return () => window.clearTimeout(minuteur.current)
  }, [])

  const A: Audit = audit ?? (serveur.tfbAudit as Audit | undefined) ?? { routes: [], resume: null }
  const R = A.resume ?? null
  const routes = A.routes ?? []
  const host = txt(T.base || 'https://atelierby.tfbuddy.com/api/v1').replace(/^https?:\/\//, '').split('/')[0]
  const ql = auditQ.toLowerCase()
  const rows = routes.filter(
    (r) =>
      (auditF === 'all' || (auditF === 'ok' ? r.statut === 'ok' : auditF === 'ko' ? KO.includes(r.statut) : auditF === 'used' ? !!r.utilise : r.statut === 'non_teste')) &&
      (!ql || `${r.chemin} ${r.tag || ''}`.toLowerCase().includes(ql)),
  )
  const n = (k: string) => routes.filter((r) => (k === 'ko' ? KO.includes(r.statut) : r.statut === k)).length
  const fld = (k: string, label: string, type: string, ph: string, etatK?: string, ok?: boolean) => ({
    k,
    label,
    type,
    ph,
    value: tfb[k] != null ? tfb[k] : type === 'password' ? '' : (k === 'base' ? T.base : k === 'adminPhone' ? T.admin?.phone : T.consultant?.phone) || '',
    etat: etatK || '',
    ok: !!ok,
  })
  const champs = [
    fld('base', "Adresse de l'API", 'text', 'https://atelierby.tfbuddy.com/api/v1'),
    fld('adminPhone', 'Compte admin (ERP) · téléphone', 'text', '04…', T.admin?.configure ? '· configuré' : '· absent', T.admin?.configure),
    fld('adminPassword', 'Compte admin · mot de passe', 'password', 'inchangé si vide'),
    fld('consultantPhone', 'Compte consultant (panel) · téléphone', 'text', '04…', T.consultant?.configure ? '· configuré' : '· absent', T.consultant?.configure),
    fld('consultantPassword', 'Compte consultant · mot de passe', 'password', 'inchangé si vide'),
  ]
  const saveTfb = () => {
    setTfbTest('Test en cours…')
    P.enregistrerTfb(tfb)
      .then((r) => {
        setTfb({})
        setTfbTest(`Connexion admin : ${r.test.admin} · consultant : ${r.test.consultant}`)
        void charger()
      })
      .catch((e: unknown) => setTfbTest(`Échec : ${erreurDe(e)}`))
  }
  const runAudit = () => {
    if (auditing || A.enCours) return
    const avant = R ? R.le : null
    setAuditing(true)
    // L'audit tourne côté serveur ; on relit le résultat toutes les 8 s.
    const relire = (i: number) =>
      P.lireAudit().then((a) => {
        if (a.resume && a.resume.le !== avant) {
          setAudit(a)
          setAuditing(false)
          toast(`${a.resume.ok} routes fonctionnent sur ${a.resume.total}.`)
          return
        }
        if (i > 60) {
          setAuditing(false)
          toast('L’audit n’a pas rendu de résultat : voir /var/log/social-cron.log.')
          return
        }
        minuteur.current = window.setTimeout(() => void relire(i + 1), 8000)
      })
    P.lancerAudit()
      .then(() => {
        minuteur.current = window.setTimeout(() => void relire(0), 8000)
      })
      .catch((e: unknown) => {
        setAuditing(false)
        toast(`Audit impossible : ${erreurDe(e)}`)
      })
  }
  const reseau = etat.shops.filter((x) => !x.test) as (Boutique & Rec)[]
  const filtres: [string, string][] = [
    ['ko', `Ne fonctionnent pas · ${n('ko')}`],
    ['ok', `Fonctionnent · ${n('ok')}`],
    ['non_teste', `Non testées · ${n('non_teste')}`],
    ['used', 'Utilisées par le module'],
    ['all', `Toutes · ${routes.length}`],
  ]

  return (
    <>
      <section className="card par__carte">
        <div className="par__tete">
          <span>Compte de l'API TFBuddy</span>
          <span className="muted">
            Source principale des données du module · stocké en base (mar_variable / mar_keys) · swagger : <span className="par__mono">{T.swagger || ''}</span>
          </span>
        </div>
        <div className="par__grille par__grille--200">
          {champs.map((f) => (
            <label key={f.k} className="par__champ">
              <span>
                {f.label} <span className={f.ok ? 'is-bon' : 'is-alerte'}>{f.etat}</span>
              </span>
              <input className="par__mono" type={f.type} autoComplete="off" value={f.value} placeholder={f.ph} onChange={(e) => setTfb({ ...tfb, [f.k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="par__ligne">
          <button type="button" className="btn btn--primary" onClick={saveTfb}>
            Enregistrer et tester le compte
          </button>
          <span className="par__petit">{tfbTest}</span>
        </div>
      </section>

      <section className="card table-card par__table">
        <div className="par__tete par__tete--bord par__tete--centre">
          <span>
            Boutiques de l'API (shop) · {reseau.length} boutique{reseau.length > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              P.relireBoutiquesApi()
                .then(() => charger())
                .then(() => toast('Boutiques relues dans l’API.'))
                .catch((e: unknown) => toast(erreurDe(e)))
            }
          >
            Relire l'API
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>Boutique</th>
                <th>Adresse</th>
                <th>Horaires</th>
                <th>Contact</th>
                <th>TVA</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {reseau.map((b) => (
                <tr key={b.id}>
                  <td className="par__mono">{b.id}</td>
                  <td>
                    {b.name}
                    <br />
                    <span className="muted par__petit">{txt(b.fullName)}</span>
                  </td>
                  <td>{b.address || '—'}</td>
                  <td>{b.hours || '—'}</td>
                  <td className="par__petit">
                    {txt(b.email)}
                    <br />
                    {txt(b.phone)}
                  </td>
                  <td className="par__petit">{txt(b.vat)}</td>
                  <td className="muted par__petit">{((b.sources as string[] | undefined) ?? []).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card par__table">
        <div className="par__tete par__tete--bord par__tete--centre">
          <span className="par__titre">
            <span>Routes de l'API sur {host} · fonctionnent / ne fonctionnent pas</span>
            <span className="muted">
              {R
                ? `${R.ok} fonctionnent · ${R.refuse || 0} refusées · ${(R.erreur || 0) + (R.injoignable || 0)} en erreur · ${R.absent || 0} absentes · ${
                    R.parametre || 0
                  } paramètre requis · ${R.non_teste || 0} non testées — sur ${R.total} routes GET · audit du ${String(R.le).slice(8, 10)}/${String(R.le).slice(5, 7)} à ${String(
                    R.le,
                  ).slice(11, 16)} (${R.duree} s)`
                : 'Aucun audit encore : lancez-le (une à deux minutes).'}
            </span>
          </span>
          <button type="button" className="btn" disabled={auditing || !!A.enCours} onClick={runAudit}>
            {auditing || A.enCours ? 'Audit en cours… (2-3 min)' : 'Lancer l’audit'}
          </button>
        </div>
        <div className="par__ligne par__filtres">
          {filtres.map(([k, label]) => (
            <Puce key={k} on={auditF === k} onClick={() => setAuditF(k)}>
              {label}
            </Puce>
          ))}
          <input className="par__recherche" value={auditQ} onChange={(e) => setAuditQ(e.target.value)} placeholder="Filtrer (chemin, tag)…" />
        </div>
        {rows.slice(0, 400).map((r, i) => {
          const c = ST_AUDIT[r.statut] ?? ST_AUDIT.non_teste
          return (
            <div key={`${r.chemin}-${i}`} className="par__route">
              <span className="par__tag" style={{ background: c[1], color: c[2] }}>
                {c[0]}
              </span>
              <span className="par__mono par__chemin">
                GET {r.chemin}
                {r.utilise && <span className="par__tag par__tag--utilise">utilisée · {r.utilise}</span>}
              </span>
              <span className="muted par__petit">{r.tag || ''}</span>
              <span className="par__petit">{r.http || '—'}</span>
              <span className="muted par__petit">{r.ms != null ? `${r.ms} ms` : ''}</span>
              <span className="par__petit par__sec">{r.statut === 'ok' ? r.apercu || '' : r.resume || ''}</span>
            </div>
          )
        })}
        {rows.length === 0 && <div className="par__vide-texte">{routes.length ? 'Aucune route pour ce filtre.' : 'Aucun audit encore.'}</div>}
      </section>
    </>
  )
}
