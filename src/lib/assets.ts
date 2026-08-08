/**
 * Préfixe un chemin de `public/` par la base de déploiement : `/` en dev et
 * sur un hébergement racine, `/marketing/` sur GitHub Pages (build lancé avec
 * `vite build --base=/marketing/`).
 */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '')
}
