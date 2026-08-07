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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
