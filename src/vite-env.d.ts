/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL de l'API TFBuddy. En dev, laisser vide pour passer par le proxy Vite (`/erp`). */
  readonly VITE_TFBUDDY_BASE_URL?: string
  /** `phone` = /admin/auth/login (E.164) · `legacy` = /admin/authenticate (login/password). */
  readonly VITE_TFBUDDY_AUTH_MODE?: 'phone' | 'legacy'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
