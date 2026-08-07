import { useState } from 'react'
import * as api from './lib/api/module'
import { useAsync } from './lib/useAsync'
import { titleFor } from './lib/navigation'
import type { Role, Route } from './lib/navigation'
import { useLogin, useSession } from './state/auth'
import Sidebar from './components/Sidebar'
import LoginView from './views/LoginView'
import DashboardView from './views/DashboardView'
import CampaignsView from './views/CampaignsView'
import CalendarView from './views/CalendarView'
import FundsView from './views/FundsView'
import CampaignMonitorView from './views/CampaignMonitorView'
import PendingView from './views/PendingView'

export default function App() {
  const session = useSession()

  if (!session) return <LoginView />

  return <Workspace />
}

/**
 * Coquille applicative : une seule route active à la fois, rendu conditionnel
 * par écran, comme le prototype.
 */
function Workspace() {
  const { signOut } = useLogin()
  const [role, setRole] = useState<Role>('BRAND_ADMIN')
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

          {/* Bascule de rôle : change la navigation, le périmètre et les libellés. */}
          <div className="topbar__actions">
            <div className="role-switch" role="group" aria-label="Rôle">
              <button
                type="button"
                className={role === 'BRAND_ADMIN' ? 'is-on' : ''}
                onClick={() => {
                  setRole('BRAND_ADMIN')
                  navigate('dashboard')
                }}
              >
                Réseau
              </button>
              <button
                type="button"
                className={role === 'FRANCHISEE' ? 'is-on' : ''}
                onClick={() => {
                  setRole('FRANCHISEE')
                  navigate('dashboard')
                }}
              >
                Franchisé
              </button>
            </div>
            <button type="button" className="ghost" onClick={() => void signOut()}>
              Déconnexion
            </button>
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
            />
          ) : null}

          {route === 'calendar' ? <CalendarView onOpen={openCampaign} /> : null}

          {route === 'funds' ? <FundsView /> : null}

          {route === 'campaign' && campaignId !== null ? (
            <CampaignMonitorView
              campaignId={campaignId}
              leadStatuses={refs.leadStatuses}
              onBack={() => navigate('campaigns')}
            />
          ) : null}

          {['promotions', 'bundles', 'vouchers', 'physical', 'digital', 'agencies', 'analysis', 'roi', 'crm', 'local', 'dam'].includes(
            route,
          ) ? (
            <PendingView title={titleFor(role, route)} />
          ) : null}
        </main>
      </div>
    </div>
  )
}
