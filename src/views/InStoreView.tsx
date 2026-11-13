import { useState } from 'react'
import { ROOTS } from '../lib/api/module'
import type { Role } from '../lib/navigation'
import ShopSupportsView from './ShopSupportsView'

/**
 * Le marketing en magasin.
 *
 * - « Écrans des magasins » : la régie d'affichage (dépôt signage), affichée dans un
 *   cadre — ses films, les promotions de l'ERP à l'écran, le planning, le réseau
 *   d'écrans. Elle n'est pas recopiée : elle vit à /signage, avec sa propre connexion.
 *   La version franchisé ouvre l'espace magasin de la régie, au compte du magasin.
 * - « Bâches & affiches » (réseau) : les supports de chaque boutique, que l'assistant
 *   de campagne reprend.
 */
export default function InStoreView({ role }: { role: Role }) {
  const [tab, setTab] = useState<'screens' | 'supports'>('screens')
  const src = role === 'FRANCHISEE' ? `${ROOTS.signage}magasin` : ROOTS.signage

  if (role === 'FRANCHISEE') {
    return (
      <div className="social-frame">
        <iframe className="social-frame__page" title="Marketing en magasin — régie d’affichage" src={src} />
      </div>
    )
  }

  return (
    <>
      <nav className="instore-tabs" aria-label="Marketing en magasin">
        <button type="button" className={`choice-pill${tab === 'screens' ? ' is-on' : ''}`} onClick={() => setTab('screens')}>
          Écrans des magasins
        </button>
        <button type="button" className={`choice-pill${tab === 'supports' ? ' is-on' : ''}`} onClick={() => setTab('supports')}>
          Bâches &amp; affiches
        </button>
      </nav>
      {tab === 'screens' ? (
        <div className="social-frame">
          <iframe className="social-frame__page" title="Marketing en magasin — régie d’affichage" src={src} />
        </div>
      ) : (
        <div className="instore-page">
          <ShopSupportsView />
        </div>
      )}
    </>
  )
}
