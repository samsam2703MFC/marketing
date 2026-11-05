import * as api from '../../lib/api/module'

/**
 * Les images que le marketing peut prendre, d'où qu'elles viennent — les mêmes que « Créer un post » :
 *
 *  - les fichiers de la médiathèque commune (déposés ici ou dans Social) ;
 *  - les photos du webshop, lues dans TFBuddy par le module Social : chaque produit, chaque rayon,
 *    chaque catégorie, chaque gamme ;
 *  - le design system de la marque, servi par Social (`ds-catalogue.js`) : illustrations et photos
 *    de produits détourées.
 *
 * Rien n'est copié pour les montrer : une image du webshop ou du design system reste où elle est,
 * et n'entre dans la médiathèque que par « Ajouter à la médiathèque ».
 */

export type ImageSource = 'mediatheque' | 'webshop' | 'design'

/** Une image choisie, d'où qu'elle vienne. `url` est absolue. */
export interface PickedImage {
  url: string
  name: string
  source: ImageSource
  width: number | null
  height: number | null
  cutout: boolean
}

/** Une image d'une source extérieure aux fichiers de la médiathèque. */
export interface SourceImage {
  key: string
  name: string
  url: string
  /** Le classement, pour filtrer : « Produits », « Rayons »… ou la catégorie du design system. */
  group: string
  /** La précision montrée sous le nom : catégorie du produit, sous-catégorie du design system. */
  detail: string
  cutout: boolean
}

export const SOURCE_LABEL: Record<ImageSource, string> = {
  mediatheque: 'Fichiers',
  webshop: 'Photos du webshop',
  design: 'Illustrations',
}

let webshop: Promise<SourceImage[]> | null = null

/** Les images du catalogue du webshop (une lecture par session d'écran ; Social garde 30 min de cache). */
export function webshopImages(): Promise<SourceImage[]> {
  webshop ??= api
    .getWebshopCatalogue()
    .then((c) => {
      const catName = new Map(c.categories.map((k) => [k.id, k.name]))
      const groupName = new Map(c.groupes.map((g) => [g.id, g.name]))
      const out: SourceImage[] = []
      for (const p of c.produits) {
        if (!p.image) continue
        const where = [p.groupe !== null ? groupName.get(p.groupe) : null, p.cat !== null ? catName.get(p.cat) : null].filter(Boolean)
        out.push({ key: `p${p.id}`, name: p.name, url: p.image, group: 'Produits', detail: where.join(' › '), cutout: false })
      }
      for (const g of c.groupes) {
        if (g.image) out.push({ key: `g${g.id}`, name: g.name, url: g.image, group: 'Rayons', detail: `${g.n} produit${g.n > 1 ? 's' : ''}`, cutout: false })
      }
      for (const k of c.categories) {
        if (!k.image) continue
        out.push({ key: `c${k.id}`, name: k.name, url: k.image, group: 'Catégories', detail: k.groupe !== null ? groupName.get(k.groupe) ?? '' : '', cutout: false })
      }
      for (const g of c.gammes) {
        if (g.image) out.push({ key: `r${g.id}`, name: g.name, url: g.image, group: 'Gammes', detail: `${g.n} produit${g.n > 1 ? 's' : ''}`, cutout: false })
      }
      return out
    })
    .catch((cause: unknown) => {
      webshop = null
      throw cause
    })
  return webshop
}

interface DsRow {
  id?: unknown
  src?: unknown
  name?: unknown
  cat?: unknown
  sub?: unknown
  cut?: unknown
}

declare global {
  interface Window {
    DS_ILLUS?: DsRow[]
  }
}

let design: Promise<SourceImage[]> | null = null

/** Le design system de la marque, tel que Social le charge pour sa médiathèque. */
export function designImages(): Promise<SourceImage[]> {
  design ??= new Promise<DsRow[]>((resolve, reject) => {
    if (Array.isArray(window.DS_ILLUS)) {
      resolve(window.DS_ILLUS)
      return
    }
    const script = document.createElement('script')
    script.src = api.socialAssetUrl('ds-catalogue.js')
    script.async = true
    script.onload = () => (Array.isArray(window.DS_ILLUS) ? resolve(window.DS_ILLUS) : reject(new Error('Le catalogue du design system est vide.')))
    script.onerror = () => reject(new Error('Le module Social ne sert pas le catalogue du design system (ds-catalogue.js).'))
    document.head.appendChild(script)
  })
    .then((rows) =>
      rows
        .filter((r) => typeof r.id === 'string' && typeof r.src === 'string')
        .map((r) => ({
          key: String(r.id),
          name: String(r.name ?? r.id),
          url: api.socialAssetUrl(String(r.src)),
          group: String(r.cat ?? ''),
          detail: String(r.sub ?? ''),
          cutout: r.cut === true,
        })),
    )
    .catch((cause: unknown) => {
      design = null
      throw cause
    })
  return design
}

/** Le fichier d'une image extérieure, pour la verser dans la médiathèque. */
export async function fetchSourceImage(source: Exclude<ImageSource, 'mediatheque'>, url: string): Promise<Blob> {
  const target = source === 'webshop' ? api.webshopImageProxyUrl(url) : url
  let response: Response
  try {
    response = await fetch(target, { credentials: 'same-origin' })
  } catch {
    throw new Error('le serveur de l’image n’a pas répondu')
  }
  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string | { message?: string } }
      reason = typeof body.error === 'string' ? body.error : body.error?.message ?? reason
    } catch {
      /* pas de corps lisible */
    }
    throw new Error(`image illisible : ${reason}`)
  }
  return response.blob()
}

/** Les dimensions d'une image, lues par le navigateur (nulles si elle ne se charge pas). */
export function imageSize(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null })
    img.onerror = () => resolve({ width: null, height: null })
    img.src = url
  })
}
