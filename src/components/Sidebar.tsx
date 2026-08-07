import { navFor } from '../lib/navigation'
import type { Role, Route } from '../lib/navigation'
import type { Brand } from '../lib/api/module'

interface SidebarProps {
  role: Role
  route: Route
  brands: Brand[]
  brandId: number | 'all'
  onNavigate: (route: Route) => void
  onBrandChange: (brandId: number | 'all') => void
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

export default function Sidebar({
  role,
  route,
  brands,
  brandId,
  onNavigate,
  onBrandChange,
}: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__head">
        <img src="/img/logo.png" alt="L'Atelier By" className="sidebar__logo" />
        <div className="sidebar__kicker">Module Marketing</div>
      </div>

      <div className="sidebar__back">
        <a href="#" onClick={(event) => event.preventDefault()}>
          <Icon path="M19 12H5M12 19l-7-7 7-7" />
          Retour à l’ERP
        </a>
      </div>

      {/* Le sélecteur de marque n'a de sens qu'au niveau réseau : un franchisé
          n'appartient qu'à une enseigne. */}
      {role === 'BRAND_ADMIN' && brands.length > 0 ? (
        <div className="sidebar__brand">
          <select
            aria-label="Marque"
            value={String(brandId)}
            onChange={(event) =>
              onBrandChange(event.target.value === 'all' ? 'all' : Number(event.target.value))
            }
          >
            <option value="all">Toutes marques</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="sidebar__groups">
        {navFor(role).map((group) => (
          <div key={group.label} className="sidebar__group">
            <div className="sidebar__group-label">{group.label}</div>
            {group.items.map((entry) => (
              <a
                key={entry.route}
                href="#"
                className={`sidebar__item${route === entry.route ? ' is-active' : ''}`}
                aria-current={route === entry.route ? 'page' : undefined}
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
    </nav>
  )
}
