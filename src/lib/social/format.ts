/**
 * Formats et dates du module Social (repris de social/public/social-data.js, mêmes règles) :
 * nombres et montants à la belge, dates ISO « AAAA-MM-JJ » lues en heure locale.
 */
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
export const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

const fini = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)

export const fmt = (n: number | null | undefined, d = 0) =>
  fini(n) ? n.toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
export const eur = (n: number | null | undefined, d = 0) => (fini(n) ? `${fmt(n, d)} €` : '—')
/** Un montant dans la devise d'un compte publicitaire (Meta compte dans la devise du compte). */
export const argent = (n: number | null | undefined, dev?: string | null, d = 0) =>
  !dev || dev === 'EUR' ? eur(n, d) : fini(n) ? `${fmt(n, d)} ${dev}` : '—'
export const devSym = (dev?: string | null) => (!dev || dev === 'EUR' ? '€' : dev)
export const pct = (n: number | null | undefined, d = 0) => (fini(n) ? `${fmt(n * 100, d)} %` : '—')

const okDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}/.test(String(s ?? ''))
export function d2(s: string): Date {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
export function addDays(s: string, n: number): string {
  const dt = d2(s)
  dt.setDate(dt.getDate() + n)
  return iso(dt)
}
export const daysBetween = (a: string, b: string) => Math.round((d2(b).getTime() - d2(a).getTime()) / 86400000)
/** « mer. 21 oct. » */
export function dLabel(s: string | null | undefined): string {
  if (!okDate(s)) return '—'
  const dt = d2(String(s))
  const mois = MONTHS[dt.getMonth()]
  return `${DAYS[dt.getDay()]} ${dt.getDate()} ${mois.slice(0, 4).replace(/\.$/, '')}${mois.length > 4 ? '.' : ''}`
}
/** « 21/10 » */
export function dShort(s: string | null | undefined): string {
  if (!okDate(s)) return '—'
  const dt = d2(String(s))
  return `${dt.getDate()}/${String(dt.getMonth() + 1).padStart(2, '0')}`
}
