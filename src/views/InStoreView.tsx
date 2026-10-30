import { ROOTS } from '../lib/api/module'
import type { Role } from '../lib/navigation'

/**
 * Le marketing en magasin : la régie d'affichage des écrans des magasins
 * (dépôt signage), affichée dans un cadre — ses films, les promotions de
 * l'ERP à l'écran, le planning, le réseau d'écrans.
 *
 * Elle n'est pas recopiée : elle vit à /signage, sur le même serveur, avec sa
 * propre connexion. La version franchisé ouvre l'espace magasin de la régie
 * (ruptures et écrans de la boutique), au compte du magasin.
 */
export default function InStoreView({ role }: { role: Role }) {
  const src = role === 'FRANCHISEE' ? `${ROOTS.signage}magasin` : ROOTS.signage

  return (
    <div className="social-frame">
      <iframe className="social-frame__page" title="Marketing en magasin — régie d’affichage" src={src} />
    </div>
  )
}
