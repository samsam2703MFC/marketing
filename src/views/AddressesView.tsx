import { module as api } from '../lib/api'
import { API_BASE_URL as TFBUDDY_BASE, AUTH_MODE as TFBUDDY_AUTH_MODE, DEV_PROXY_PREFIX } from '../lib/api/config'
import { useAsync } from '../lib/useAsync'

/**
 * Adresses et réglages.
 *
 * Ce que ce module ouvre ou appelle, et les réglages avec lesquels cette version a
 * été construite — pour savoir où vit chaque écran sans ouvrir le dépôt ni le
 * serveur. Aucun secret ne passe ici : pas de mot de passe, pas de jeton, pas de
 * nom de base. Le serveur ne livre que des états (connexion ERP ou identité de
 * développement), jamais une valeur.
 */

interface Address {
  label: string
  /** Ce qu'on y trouve. */
  role: string
  /** Chemin tel que résolu par ce build ; null quand rien n'est réglé. */
  path: string | null
  /** La variable qui la règle, et d'où elle vient au déploiement. */
  setting: string
  /** Écran à ouvrir (lien), plutôt qu'une racine d'API. */
  screen: boolean
}

const env = import.meta.env
const ROLE = env.VITE_ROLE === 'FRANCHISEE' ? 'FRANCHISEE' : 'BRAND_ADMIN'
const absolute = (path: string) => new URL(path, window.location.origin).href

function addresses(): Address[] {
  const here = env.BASE_URL
  const reseau = env.VITE_RESEAU_BASE || (ROLE === 'BRAND_ADMIN' ? here : null)

  return [
    {
      label: 'Marketing — réseau',
      role: 'Cette application pour la marque : campagnes, calendrier, réglages',
      path: reseau,
      setting: 'VITE_RESEAU_BASE ← DEPLOY_DIR',
      screen: true,
    },
    {
      label: 'API du module',
      role: 'Campagnes, offres, fonds, boutiques — tables mar_ de la base de l’ERP',
      path: `${api.ROOTS.api}/`,
      setting: 'VITE_API_BASE',
      screen: false,
    },
    {
      label: 'Social & Ads — réseau',
      role: 'Posts, publicités Meta, avis et fiches Google, réglages des connexions',
      path: api.ROOTS.social,
      setting: 'VITE_SOCIAL_BASE',
      screen: true,
    },
    {
      label: 'Social & Ads — espace franchisé',
      role: 'Les réseaux sociaux de chaque boutique (version franchisé)',
      path: api.ROOTS.socialFranchise,
      setting: 'VITE_SOCIAL_FRANCHISEE_BASE',
      screen: true,
    },
    {
      label: 'Marketing en magasin — régie d’affichage',
      role: 'Les écrans des magasins : films, promotions de l’ERP à l’écran, planning, réseau d’écrans (dépôt signage)',
      path: api.ROOTS.signage,
      setting: 'VITE_SIGNAGE_BASE',
      screen: true,
    },
    {
      label: 'Cockpit du BO',
      role: 'Ventes et P&L des magasins, KPI d’une période, documents joints, newsletters',
      path: `${api.ROOTS.cockpit}/`,
      setting: 'VITE_COCKPIT_BASE ← COCKPIT_PATH',
      screen: true,
    },
    {
      label: 'ERP TFBuddy',
      role: `API de l’ERP (connexion ${TFBUDDY_AUTH_MODE === 'phone' ? 'par téléphone' : 'par identifiant'})`,
      path: TFBUDDY_BASE === DEV_PROXY_PREFIX ? null : TFBUDDY_BASE,
      setting: 'VITE_TFBUDDY_BASE_URL, VITE_TFBUDDY_AUTH_MODE',
      screen: false,
    },
  ]
}

/** Les réglages du build, tels que lus — le défaut appliqué quand une variable n'est pas fixée. */
function buildSettings(): Array<{ name: string; value: string | undefined; fallback: string; role: string }> {
  return [
    { name: 'VITE_ROLE', value: env.VITE_ROLE, fallback: 'BRAND_ADMIN', role: 'Version : réseau (BRAND_ADMIN) ou franchisé (FRANCHISEE)' },
    { name: 'VITE_BASE', value: env.BASE_URL, fallback: '/', role: 'Adresse de cette application' },
    { name: 'VITE_API_BASE', value: env.VITE_API_BASE, fallback: 'racine du domaine', role: 'Préfixe de l’API du module' },
    { name: 'VITE_COCKPIT_BASE', value: env.VITE_COCKPIT_BASE, fallback: 'celui de l’API du module', role: 'Racine du cockpit du BO' },
    { name: 'VITE_SOCIAL_BASE', value: env.VITE_SOCIAL_BASE, fallback: '/marketing/social/', role: 'Module Social & Ads, écrans du réseau' },
    { name: 'VITE_SOCIAL_FRANCHISEE_BASE', value: env.VITE_SOCIAL_FRANCHISEE_BASE, fallback: '/marketing/franchise/', role: 'Module Social & Ads, espace boutique' },
    { name: 'VITE_SIGNAGE_BASE', value: env.VITE_SIGNAGE_BASE, fallback: '/signage/', role: 'Régie d’affichage des écrans des magasins (Marketing en magasin)' },
    { name: 'VITE_RESEAU_BASE', value: env.VITE_RESEAU_BASE, fallback: 'non connue', role: 'Adresse de la version réseau' },
    { name: 'VITE_TFBUDDY_BASE_URL', value: env.VITE_TFBUDDY_BASE_URL, fallback: `${DEV_PROXY_PREFIX} (relais de développement)`, role: 'API de l’ERP TFBuddy' },
    { name: 'VITE_TFBUDDY_AUTH_MODE', value: env.VITE_TFBUDDY_AUTH_MODE, fallback: 'phone', role: 'Connexion à l’ERP : phone ou legacy' },
  ]
}

export default function AddressesView() {
  const session = useAsync(() => api.getSession(), [])
  const list = addresses()
  const s = session.data

  return (
    <div className="addresses">
      <section className="card">
        <h2>Connexion</h2>
        {session.loading ? <p className="muted">Lecture de la session…</p> : null}
        {session.error ? <p className="error">Session illisible : {session.error}</p> : null}
        {s ? (
          <div className="addresses__session">
            <p>
              {s.authenticated ? (
                <>
                  Utilisateur n° {s.user_id} · {s.role === 'BRAND_ADMIN' ? 'marque (réseau)' : 'franchisé'}
                  {s.shop_ids && s.shop_ids.length ? ` · boutiques ${s.shop_ids.join(', ')}` : ' · toutes les boutiques'}
                </>
              ) : (
                'Aucune identité'
              )}
            </p>
            {s.login_ready === false ? (
              <p>
                <span className="tag-stop">Connexion non prête</span> Il manque <code>MAR_ERP_AUTH_BASE</code> ou{' '}
                <code>MAR_SESSION_SECRET</code> dans la configuration du serveur : la connexion par l’ERP ne peut pas s’ouvrir.
              </p>
            ) : null}
            {s.via === 'erp' ? (
              <p>
                <span className="badge badge--mesure">ERP</span> Connecté par les identifiants de l’ERP{s.label ? ` (${s.label})` : ''}.
              </p>
            ) : null}
            {s.dev_auth ? (
              <p>
                <span className="tag-stop">Identité de développement</span> Le serveur tourne avec <code>MAR_DEV_AUTH=1</code> : tout
                visiteur {s.via === 'erp' ? 'non connecté ' : ''}entre sous l’identité réglée sur le serveur, sans passer par l’ERP, et
                peut en choisir une autre par en-tête. La connexion par l’ERP est en place (pied du menu) : une fois vérifiée, ce
                réglage se coupe.
              </p>
            ) : s.dev_auth === false && s.via !== 'erp' ? (
              <p>
                <span className="badge badge--mesure">ERP</span> L’identité vient de la connexion par l’ERP.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card table-card">
        <h2>Adresses</h2>
        <p className="muted">Sur ce serveur : {window.location.origin}. Les écrans s’ouvrent dans un nouvel onglet.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Espace</th>
                <th>Adresse</th>
                <th>Réglée par</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.label}>
                  <td>
                    <b>{a.label}</b>
                    <div className="muted">{a.role}</div>
                  </td>
                  <td>
                    {a.path === null ? (
                      <span className="muted">non réglée</span>
                    ) : a.screen ? (
                      <a href={absolute(a.path)} target="_blank" rel="noreferrer">
                        {absolute(a.path)} ↗
                      </a>
                    ) : (
                      <code>{absolute(a.path)}</code>
                    )}
                  </td>
                  <td>
                    <code>{a.setting}</code>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Retour à l’ERP</b>
                  <div className="muted">Le lien en haut du menu</div>
                </td>
                <td>
                  <span className="tag-warn">À raccorder</span> <span className="muted">aucune adresse : le lien est inactif</span>
                </td>
                <td>
                  <span className="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <h2>Réglages de cette version</h2>
        <p className="muted">
          Fixés à la construction du front (variables <code>VITE_*</code>, posées par le déploiement). Les réglages du serveur —
          base de données, API de l’ERP, tables lues, mode de connexion — vivent dans son fichier de configuration, hors de la
          racine web ; cet écran n’en montre que l’état ci-dessus.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Valeur</th>
                <th>Rôle</th>
              </tr>
            </thead>
            <tbody>
              {buildSettings().map((v) => (
                <tr key={v.name}>
                  <td>
                    <code>{v.name}</code>
                  </td>
                  <td>{v.value ? <code>{v.value}</code> : <span className="muted">non fixée — {v.fallback}</span>}</td>
                  <td className="muted">{v.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
