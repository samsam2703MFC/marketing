import { useState } from 'react'
import * as api from './lib/api/module'
import { useAsync } from './lib/useAsync'
import { titleFor } from './lib/navigation'
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
import DiffusionView from './views/DiffusionView'
import AgenciesView from './views/AgenciesView'
import AnalysisView from './views/AnalysisView'
import RoiView from './views/RoiView'
import CrmView from './views/CrmView'
import LocalPresenceView from './views/LocalPresenceView'
import DamView from './views/DamView'
import CampaignBuilder from './views/builder/CampaignBuilder'

export default function App() {
  // Le module n'a pas d'écran de connexion : embarqué dans l'ERP, l'identité
  // vient de son middleware. On lui demande simplement si elle est établie.
  const session = useAsync(() => api.getSession(), [])

  if (session.loading) {
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

  // Pas de formulaire de connexion ici : ce serait un second chemin
  // d'authentification à maintenir, et il ne saurait pas parler à l'ERP. On dit
  // ce qui manque, plutôt que de proposer une porte qui n'ouvre sur rien.
  if (!session.data?.authenticated) {
    return (
      <div className="app">
        <main className="app__body">
          <section className="card pending">
            <h2>Session non établie</h2>
            <p className="muted">
              Ce module lit l’identité de l’ERP. Ouvrez-le depuis l’ERP, ou définissez
              <code> MAR_DEV_AUTH=1</code> et <code>MAR_DEV_USER_ID</code> dans le fichier
              de configuration du serveur pour y accéder directement.
            </p>
          </section>
        </main>
      </div>
    )
  }

  return <Workspace />
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

function Workspace() {
  const role = ROLE
  const [route, setRoute] = useState<Route>('dashboard')
  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [brandId, setBrandId] = useState<number | 'all'>('all')

  // Les référentiels sont chargés une fois et traversent tous les écrans :
  // libellés, couleurs et listes viennent de là, jamais du code.
  const references = useAsync(() => api.getReferences(), [])
  const brands = useAsync(() => api.listBrands(), [])

  function openCampaign(id: number) {
    setCampaignId(id)
    setRoute('campaign')
  }

  function navigate(next: Route) {
    setCampaignId(null)
    setRoute(next)
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

  return (
    <div className="workspace">
      <Sidebar
        role={role}
        route={route}
        brands={brands.data ?? []}
        brandId={brandId}
        onNavigate={navigate}
        onBrandChange={setBrandId}
      />

      <div className="workspace__main">
        <header className="topbar">
          <div>
            <p className="topbar__kicker">
              {role === 'BRAND_ADMIN' ? 'Vue Réseau' : 'Vue Franchisé'}
            </p>
            <h1>{titleFor(role, route) || 'Suivi de campagne'}</h1>
          </div>
        </header>

        <main className="app__body fb-scroll">
          {route === 'dashboard' ? (
            <DashboardView
              statuses={refs.campaignStatuses}
              levers={refs.levers}
              brandId={brandId}
              onOpen={openCampaign}
            />
          ) : null}

          {route === 'campaigns' ? (
            <CampaignsView
              statuses={refs.campaignStatuses}
              brandId={brandId}
              onOpen={openCampaign}
              onCreate={() => navigate('builder')}
            />
          ) : null}

          {route === 'calendar' ? <CalendarView onOpen={openCampaign} /> : null}

          {route === 'funds' ? <FundsView /> : null}

          {route === 'promotions' ? <PromotionsView /> : null}
          {route === 'bundles' ? <BundlesView /> : null}
          {route === 'vouchers' ? <VouchersView /> : null}

          {/* La famille de canal distingue les deux écrans de diffusion. */}
          {route === 'physical' ? <DiffusionView family="PHYSIQUE" /> : null}
          {route === 'digital' ? <DiffusionView family="DIGITAL" /> : null}

          {route === 'agencies' ? <AgenciesView /> : null}
          {route === 'analysis' ? <AnalysisView /> : null}
          {route === 'roi' ? <RoiView /> : null}
          {route === 'crm' ? <CrmView /> : null}
          {route === 'local' ? <LocalPresenceView /> : null}
          {route === 'dam' ? <DamView role={role} /> : null}

          {route === 'builder' ? (
            <CampaignBuilder
              refs={refs}
              role={role}
              onCreated={openCampaign}
              onCancel={() => navigate('campaigns')}
            />
          ) : null}

          {route === 'campaign' && campaignId !== null ? (
            <CampaignMonitorView
              campaignId={campaignId}
              leadStatuses={refs.leadStatuses}
              onBack={() => navigate('campaigns')}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
