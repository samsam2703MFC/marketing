import { useCallback, useState } from 'react'
import * as api from './lib/api/module'
import { useAsync } from './lib/useAsync'
import { socialPageFor, socialRoute, tabsFor, titleFor } from './lib/navigation'
import type { Role, Route } from './lib/navigation'
import Sidebar from './components/Sidebar'
import DashboardView from './views/DashboardView'
import CampaignsView from './views/CampaignsView'
import CalendarView from './views/CalendarView'
import FundsView from './views/FundsView'
import CampaignMonitorView from './views/CampaignMonitorView'
import PromotionsView from './views/PromotionsView'
import BundlesView from './views/BundlesView'
import VouchersView from './views/VouchersView'
import AgenciesView from './views/AgenciesView'
import AnalysisView from './views/AnalysisView'
import CrmView from './views/CrmView'
import CampaignTypesView from './views/CampaignTypesView'
import AddressesView from './views/AddressesView'
import CampaignFixView from './views/CampaignFixView'
import LoginView from './views/LoginView'
import BrochureView from './views/brochure/BrochureView'
import CampaignBuilder from './views/builder/CampaignBuilder'
import SocialView from './views/SocialView'
import InStoreView from './views/InStoreView'
import { ReferencesProvider } from './state/references'

export default function App() {
  // L'identité vient du serveur : une session ouverte par les identifiants de
  // l'ERP, ou — en développement seulement — l'identité de développement.
  const [sessionKey, setSessionKey] = useState(0)
  const [loginOpen, setLoginOpen] = useState(false)
  const session = useAsync(() => api.getSession(), [sessionKey])
  const reload = () => setSessionKey((key) => key + 1)

  if (session.loading && !session.data) {
    return (
      <div className="app">
        <main className="app__body">
          <p className="muted">Ouverture du module…</p>
        </main>
      </div>
    )
  }

  if (session.error) {
    return (
      <div className="app">
        <main className="app__body">
          <p className="error">Module marketing injoignable : {session.error}</p>
          <p className="muted">
            L’API doit répondre à <code>/api/v1/marketing/session</code>.
          </p>
        </main>
      </div>
    )
  }

  const space = ROLE === 'FRANCHISEE' ? 'franchise' : 'reseau'
  const current = session.data

  if (!current?.authenticated || loginOpen) {
    return (
      <LoginView
        space={space}
        onDone={() => {
          setLoginOpen(false)
          reload()
        }}
        onCancel={current?.authenticated ? () => setLoginOpen(false) : undefined}
      />
    )
  }

  async function logout() {
    try {
      await api.closeSession()
    } finally {
      reload()
    }
  }

  // La version réseau est celle du réseau : un compte de boutique y est renvoyé vers son espace.
  if (ROLE === 'BRAND_ADMIN' && current.role !== 'BRAND_ADMIN') {
    const franchise = import.meta.env.VITE_FRANCHISE_BASE
    return (
      <div className="auth">
        <section className="auth__card login">
          <img src={`${import.meta.env.BASE_URL}img/logo.png`} alt="L'Atelier By" className="login__logo" />
          <h1 className="login__title">Compte de boutique</h1>
          <p className="muted login__sub">
            {current.label ? `${current.label} — ` : ''}ce compte ouvre l’espace de ses boutiques, pas la version réseau.
          </p>
          {franchise ? (
            <a className="btn btn--primary" href={franchise}>
              Ouvrir l’espace boutique
            </a>
          ) : null}
          <button type="button" className="ghost login__cancel" onClick={logout}>
            Se déconnecter
          </button>
        </section>
      </div>
    )
  }

  return <Workspace account={{ via: current.via ?? null, label: current.label ?? null }} onLogin={() => setLoginOpen(true)} onLogout={logout} />
}

/**
 * Coquille applicative : une seule route active à la fois, rendu conditionnel
 * par écran, comme le prototype.
 */
/**
 * Périmètre figé à la compilation : Réseau et Franchisé sont deux applications
 * déployées séparément. Ce n'est plus un état que l'utilisateur bascule.
 */
const ROLE: Role = import.meta.env.VITE_ROLE === 'FRANCHISEE' ? 'FRANCHISEE' : 'BRAND_ADMIN'

/**
 * Marque du périmètre, lue dans l'adresse : `/marketing/?brand=1`.
 *
 * Ce n'est plus un choix offert à l'écran. La marque vient de l'ERP, qui ouvre
 * le module sur la sienne ; un menu déroulant laissait croire qu'elle se
 * choisit, et permettait surtout de travailler une heure sur l'enseigne du
 * voisin sans s'en apercevoir.
 *
 * Sans paramètre, aucun filtre — c'est ce que faisait « Toutes marques », et
 * c'est le repli sûr pour un réseau mono-enseigne. Un paramètre illisible, en
 * revanche, n'est pas traité comme une absence : « ?brand=deux » viendrait
 * d'une adresse fabriquée à la main, et l'ignorer afficherait un périmètre que
 * personne n'a demandé.
 */
function brandFromUrl(): number | 'all' | 'invalide' {
  const raw = new URLSearchParams(window.location.search).get('brand')

  if (raw === null || raw.trim() === '') {
    return 'all'
  }

  const id = Number(raw)

  return Number.isInteger(id) && id > 0 ? id : 'invalide'
}

/**
 * Campagne désignée par l'adresse : c'est par elle que les autres écrans y
 * renvoient — le module Social (« Voir dans le Marketing »), le cockpit du BO,
 * un lien envoyé à un collègue. `?campagne=19` ouvre son suivi,
 * `?campagne=19&assistant=1` l'assistant sur elle (une campagne lancée n'y enregistre que ses
 * colonnes), `?nouvelle=1` l'assistant
 * sur une campagne neuve. Un numéro illisible est ignoré : on arrive alors sur
 * le tableau de bord, comme sans paramètre.
 */
function campaignFromUrl(): { route: Route; campaignId: number | null } | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('nouvelle') === '1') return { route: 'builder', campaignId: null }

  const id = Number(params.get('campagne') ?? '')
  // `?completer=1` : les campagnes à compléter, en commençant par `?campagne=` s'il est donné.
  if (params.get('completer') === '1') return { route: 'campaign-fix', campaignId: Number.isInteger(id) && id > 0 ? id : null }
  if (!Number.isInteger(id) || id <= 0) return null

  return { route: params.get('assistant') === '1' ? 'builder' : 'campaign', campaignId: id }
}

/**
 * Enseigne désignée par l'adresse.
 *
 * Le numéro reçu est celui de l'ERP : c'est lui qui ouvre le module, et il ne
 * connaît que ses propres identifiants. La traduction passe donc par
 * `erp_brand_id`.
 *
 * Le repli sur l'identifiant local ne vaut que si *aucune* enseigne ne porte
 * encore son numéro d'ERP — cas d'une base qui n'a pas revu la reprise depuis
 * l'ajout du champ. Dès qu'une seule le porte, la correspondance est établie et
 * on s'y tient : accepter les deux lectures reviendrait à ouvrir le périmètre
 * d'une autre enseigne dès que deux numérotations se croisent.
 */
function resolveBrand(brands: api.Brand[], requested: number): api.Brand | undefined {
  const byErp = brands.find((brand) => brand.erp_brand_id === requested)
  if (byErp !== undefined) {
    return byErp
  }

  return brands.some((brand) => brand.erp_brand_id !== null)
    ? undefined
    : brands.find((brand) => brand.id === requested)
}

interface Account {
  via: 'erp' | 'dev' | 'service' | null
  label: string | null
}

function Workspace({ account, onLogin, onLogout }: { account: Account; onLogin: () => void; onLogout: () => void }) {
  const role = ROLE
  const [route, setRoute] = useState<Route>(() => campaignFromUrl()?.route ?? 'dashboard')
  const [campaignId, setCampaignId] = useState<number | null>(() => campaignFromUrl()?.campaignId ?? null)
  const [postFor, setPostFor] = useState<number | null>(null)
  // L'étape où rouvrir l'assistant, quand « Compléter les campagnes » y renvoie.
  const [builderStep, setBuilderStep] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const requested = brandFromUrl()

  // Les référentiels sont chargés une fois et traversent tous les écrans :
  // libellés, couleurs et listes viennent de là, jamais du code.
  const references = useAsync(() => api.getReferences(), [])
  const brands = useAsync(() => api.listBrands(), [])

  const scope =
    typeof requested === 'number' && brands.data
      ? resolveBrand(brands.data, requested)
      : undefined
  const brandId: number | 'all' = scope?.id ?? 'all'

  function openCampaign(id: number) {
    setCampaignId(id)
    setRoute('campaign')
  }

  function navigate(next: Route) {
    setCampaignId(null)
    setPostFor(null)
    setBuilderStep(null)
    setFrameKey((key) => key + 1)
    setRoute(next)
  }

  /**
   * Navigation à l'intérieur du cadre du module Social : le menu suit l'écran
   * affiché, sans recharger le cadre (même instance, adresse inchangée).
   */
  const followSocial = useCallback((key: string) => {
    setRoute((current) => socialRoute(key, current) ?? current)
  }, [])

  /**
   * « Créer un post » du module Social depuis le suivi d'une campagne, qui est
   * présélectionnée comme opération liée. Ici comme depuis le menu, le cadre
   * est rechargé à chaque ouverture : on repart d'un post vierge, pas de
   * l'écran laissé la fois précédente.
   */
  function createPost(id: number) {
    openSocialFor(id, 'social-post')
  }

  /**
   * Le plan de posts de la campagne (durée, réseaux, mix → brouillons au
   * calendrier) : l'écran des opérations du module Social, ouvert sur elle.
   */
  function planPosts(id: number) {
    openSocialFor(id, 'social-camp')
  }

  function openSocialFor(id: number, next: Route) {
    setCampaignId(null)
    setPostFor(id)
    setFrameKey((key) => key + 1)
    setRoute(next)
  }

  /**
   * Reprise d'un brouillon : l'assistant, et non le suivi.
   *
   * Une campagne en brouillon n'a rien à piloter — pas de KPI, pas de lead, pas
   * de dépense. Ce qu'on veut d'elle, c'est la finir.
   */
  function resumeCampaign(id: number) {
    setCampaignId(id)
    setBuilderStep(null)
    setRoute('builder')
  }

  /** Les campagnes à compléter, en commençant par `id` s'il est donné (depuis son suivi). */
  function completeCampaigns(id: number | null) {
    setCampaignId(id)
    setRoute('campaign-fix')
  }

  if (references.error) {
    return (
      <div className="app">
        <main className="app__body">
          <p className="error">Module marketing injoignable : {references.error}</p>
        </main>
      </div>
    )
  }

  if (!references.data) {
    return (
      <div className="app">
        <main className="app__body">
          <p className="muted">Chargement des référentiels…</p>
        </main>
      </div>
    )
  }

  const refs = references.data
  const social = socialPageFor(role, route)
  // Un écran d'une autre application, dans un cadre : il porte son propre titre et prend toute la surface.
  const framed = social !== null || route === 'instore'
  const tabs = tabsFor(role, route)

  // Une adresse qui nomme une enseigne inconnue n'affiche pas « tout » : les
  // écrans se rempliraient d'un périmètre que personne n'a demandé, et
  // l'erreur ne se verrait qu'au moment de valider une campagne dessus.
  if (requested === 'invalide' || (typeof requested === 'number' && brands.data && !scope)) {
    return (
      <div className="app">
        <main className="app__body">
          <section className="card pending">
            <h2>Enseigne du périmètre introuvable</h2>
            <p className="muted">
              L’adresse porte l’identifiant de l’enseigne côté ERP :{' '}
              <code>?brand=1</code>. Reçu : <code>{String(requested)}</code>.
            </p>
            {brands.data && brands.data.length > 0 ? (
              <p className="muted">
                Enseignes connues du module :{' '}
                {brands.data
                  .map((brand) => `${brand.name} — ERP ${brand.erp_brand_id ?? '—'}`)
                  .join(', ')}
                . Une enseigne sans numéro d’ERP attend la prochaine reprise.
              </p>
            ) : (
              <p className="muted">
                Le module ne connaît aucune enseigne : lancez la reprise depuis l’ERP.
              </p>
            )}
          </section>
        </main>
      </div>
    )
  }

  return (
    <ReferencesProvider value={refs}>
    <div className="workspace">
      <Sidebar
        role={role}
        route={route}
        brandName={scope?.name ?? null}
        onNavigate={navigate}
        account={account}
        onLogin={onLogin}
        onLogout={onLogout}
      />

      <div className="workspace__main">
        {/* Un écran du module Social ou la régie portent leur propre titre : rien au-dessus du cadre. */}
        {framed ? null : (
          <header className="topbar">
            <div>
              <p className="topbar__kicker">
                {role === 'BRAND_ADMIN' ? 'Vue Réseau' : 'Vue Franchisé'}
              </p>
              <h1>{titleFor(role, route, campaignId !== null) || 'Suivi de campagne'}</h1>
            </div>
          </header>
        )}

        <main
          className={`app__body${route === 'builder' || route === 'brochures' ? ' app__body--wide' : ''}${framed ? ' app__body--frame' : ''}`}
        >
          {/* Une entrée à onglets : les écrans qui montraient la même donnée sous plusieurs entrées du menu. */}
          {tabs ? (
            <nav className="page-tabs" aria-label="Onglets">
              {tabs.map((tab) => (
                <button
                  key={tab.route}
                  type="button"
                  className={`page-tabs__tab${tab.route === route ? ' is-on' : ''}`}
                  aria-current={tab.route === route ? 'page' : undefined}
                  onClick={() => navigate(tab.route)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          ) : null}

          {route === 'dashboard' ? (
            <DashboardView
              statuses={refs.campaignStatuses}
              levers={refs.levers}
              brandId={brandId}
              network={role === 'BRAND_ADMIN'}
              onOpen={openCampaign}
              onPerformance={() => navigate('analysis')}
            />
          ) : null}

          {route === 'campaigns' ? (
            <CampaignsView
              statuses={refs.campaignStatuses}
              brandId={brandId}
              onOpen={openCampaign}
              onCreate={() => navigate('builder')}
              onResume={resumeCampaign}
              onComplete={() => completeCampaigns(null)}
            />
          ) : null}

          {route === 'calendar' ? <CalendarView onOpen={openCampaign} role={role} brandId={brandId} /> : null}

          {route === 'funds' ? <FundsView /> : null}

          {route === 'promotions' ? <PromotionsView /> : null}
          {route === 'bundles' ? <BundlesView /> : null}
          {route === 'vouchers' ? <VouchersView /> : null}
          {route === 'instore' ? <InStoreView role={role} /> : null}

          {route === 'agencies' ? <AgenciesView /> : null}
          {route === 'analysis' ? <AnalysisView /> : null}
          {route === 'crm' ? <CrmView /> : null}
          {route === 'campaign-types' ? <CampaignTypesView /> : null}
          {route === 'addresses' ? <AddressesView /> : null}
          {route === 'brochures' && role === 'BRAND_ADMIN' ? <BrochureView campaignId={campaignId} onOpenCampaign={openCampaign} /> : null}

          {route === 'campaign-fix' ? (
            <CampaignFixView
              startId={campaignId}
              brandAdmin={role === 'BRAND_ADMIN'}
              onOpenBuilder={(id, step) => {
                setCampaignId(id)
                setBuilderStep(step)
                setRoute('builder')
              }}
              onOpenCampaign={openCampaign}
              onClose={() => navigate('campaigns')}
            />
          ) : null}

          {social ? (
            <SocialView key={frameKey} file={social.file} query={social.query} space={social.space} campaignId={postFor} onPage={followSocial} />
          ) : null}

          {route === 'builder' ? (
            <CampaignBuilder
              refs={refs}
              role={role}
              brandId={brandId}
              campaignId={campaignId}
              startStep={builderStep}
              onCreated={openCampaign}
              onCancel={() => navigate('campaigns')}
            />
          ) : null}

          {route === 'campaign' && campaignId !== null ? (
            <CampaignMonitorView
              campaignId={campaignId}
              leadStatuses={refs.leadStatuses}
              onBack={() => navigate('campaigns')}
              onCreatePost={role === 'BRAND_ADMIN' ? () => createPost(campaignId) : undefined}
              onPlanPosts={role === 'BRAND_ADMIN' ? () => planPosts(campaignId) : undefined}
              onOpenAssistant={() => setRoute('builder')}
              onComplete={() => completeCampaigns(campaignId)}
              onBrochures={role === 'BRAND_ADMIN' ? () => setRoute('brochures') : undefined}
              brandAdmin={role === 'BRAND_ADMIN'}
            />
          ) : null}
        </main>
      </div>
    </div>
    </ReferencesProvider>
  )
}
