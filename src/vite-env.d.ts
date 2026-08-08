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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
