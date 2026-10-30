/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL de l'API TFBuddy. En dev, laisser vide pour passer par le proxy Vite (`/erp`). */
  readonly VITE_TFBUDDY_BASE_URL?: string
  /** `phone` = /admin/auth/login (E.164) · `legacy` = /admin/authenticate (login/password). */
  readonly VITE_TFBUDDY_AUTH_MODE?: 'phone' | 'legacy'
  /**
   * Préfixe des appels au module marketing, quand l'application n'est pas servie
   * à la racine du domaine. Ex. `/marketing` → `/marketing/api/v1/marketing/...`.
   * Vide en développement : le proxy Vite sert `/api`.
   */
  readonly VITE_API_BASE?: string
  /**
   * Périmètre de l'application, figé à la compilation.
   *
   * Réseau et Franchisé sont deux applications déployées séparément, chacune
   * dans son répertoire. Le rôle n'est donc plus un état que l'on bascule, mais
   * une propriété du build : il détermine la navigation et les libellés.
   * Le cloisonnement des données, lui, reste appliqué par l'API.
   */
  readonly VITE_ROLE?: 'BRAND_ADMIN' | 'FRANCHISEE'
  /**
   * Racine du module Social & Ads, dont les écrans sont affichés dans un cadre.
   * Par défaut `/marketing/social/`, sur le même serveur.
   */
  readonly VITE_SOCIAL_BASE?: string
  /** Espace franchisé du module Social (défaut /marketing/franchise/), affiché dans la version franchisé. */
  readonly VITE_SOCIAL_FRANCHISEE_BASE?: string
  /**
   * Racine de la régie d'affichage des écrans des magasins (« Marketing en magasin »), affichée
   * dans un cadre. Par défaut `/signage/`, sur le même serveur.
   */
  readonly VITE_SIGNAGE_BASE?: string
  /**
   * Racine du cockpit du BO (`/consulant_bo`), qui sert le KPI d'une période et les documents
   * joints d'une campagne. Par défaut la racine de l'API du module (installation dans le BO).
   */
  readonly VITE_COCKPIT_BASE?: string
  /**
   * Adresses des deux applications (`/marketing/`, `/marketingc/` sur le serveur), fixées au build
   * par le déploiement. Elles ne servent qu'à l'écran « Adresses et réglages ».
   */
  readonly VITE_RESEAU_BASE?: string
  readonly VITE_FRANCHISE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
