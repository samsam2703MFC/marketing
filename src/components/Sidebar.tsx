import { menuRoute, navFor } from '../lib/navigation'
import type { Role, Route } from '../lib/navigation'

interface SidebarProps {
  role: Role
  route: Route
  /** Enseigne du périmètre, lue dans l'adresse. Affichée, jamais choisie ici. */
  brandName: string | null
  onNavigate: (route: Route) => void
  /** D'où vient l'identité, et qui est connecté. */
  account?: { via: 'erp' | 'dev' | 'service' | null; label: string | null }
  onLogin?: () => void
  onLogout?: () => void
}

/** Icône linéaire 16 px, même famille visuelle que le prototype. */
function Icon({ path }: { path: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

export default function Sidebar({ role, route, brandName, onNavigate, account, onLogin, onLogout }: SidebarProps) {
  // Un onglet allume l'entrée qui le porte (« Par trimestre » → « Performance »).
  const current = menuRoute(role, route)

  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__head">
        {/* Chemin relatif à la racine d'installation : l'application est servie
            sous /marketing, où « /img/logo.png » désignerait la racine du
            domaine. Vite réécrit les URL des feuilles de style et de
            index.html, mais pas celles écrites dans le JSX — les polices et la
            favicone marchaient donc, et le logo était le seul cassé. */}
        <img
          src={`${import.meta.env.BASE_URL}img/logo.png`}
          alt="L'Atelier By"
          className="sidebar__logo"
        />
        <div className="sidebar__kicker">Module Marketing</div>
      </div>

      <div className="sidebar__back">
        <a href="#" onClick={(event) => event.preventDefault()}>
          <Icon path="M19 12H5M12 19l-7-7 7-7" />
          Retour à l’ERP
        </a>
      </div>

      {/* L'enseigne se lit, elle ne se choisit pas : elle vient de l'ERP par
          l'adresse (`?brand=1`). Elle reste affichée parce qu'on travaille sur
          un périmètre, et qu'un périmètre qu'aucun écran ne nomme finit par
          être oublié. */}
      {brandName !== null ? <div className="sidebar__brand">{brandName}</div> : null}

      <div className="sidebar__groups">
        {navFor(role).map((group) => (
          <div key={group.label} className="sidebar__group">
            <div className="sidebar__group-label">{group.label}</div>
            {group.action ? (
              <a
                href="#"
                className={`sidebar__action${route === group.action.route ? ' is-active' : ''}`}
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate(group.action!.route)
                }}
              >
                <Icon path="M12 5v14M5 12h14" />
                {group.action.label}
              </a>
            ) : null}
            {group.items.map((entry) => (
              <a
                key={entry.route}
                href="#"
                className={`sidebar__item${current === entry.route ? ' is-active' : ''}`}
                aria-current={current === entry.route ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate(entry.route)
                }}
              >
                <Icon path={entry.icon} />
                {entry.label}
              </a>
            ))}
          </div>
        ))}
      </div>

      {/* Qui est connecté, et comment. L'identité de développement se voit : elle ouvre le module à tout visiteur. */}
      {account ? (
        <div className={`sidebar__account${account.via === 'dev' ? ' is-dev' : ''}`}>
          {account.via === 'erp' ? (
            <>
              <span className="sidebar__account-who">{account.label ?? 'Connecté par l’ERP'}</span>
              {onLogout ? (
                <button type="button" className="linklike" onClick={onLogout}>
                  Se déconnecter
                </button>
              ) : null}
            </>
          ) : (
            <>
              <span className="sidebar__account-who">{account.via === 'dev' ? 'Identité de développement' : 'Accès sans connexion'}</span>
              {onLogin ? (
                <button type="button" className="linklike" onClick={onLogin}>
                  Se connecter avec l’ERP
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </nav>
  )
}
