/**
 * Illustrations des gammes et des familles de produits.
 *
 * Ces images sont livrées avec l'application (`public/img/`) et se
 * reconnaissent au mot-clé du libellé : une gamme et une famille n'ont pas de
 * fiche à elles dans le catalogue de l'ERP, mais elles ont chacune leur visuel
 * de marque, dessiné une fois pour toutes.
 *
 * L'étape « Offre » s'en sert pour ses tuiles, l'étape « Photos produits » pour
 * ne pas réclamer une photo à une gamme qui a déjà la sienne.
 */

/** Libellé court d'une gamme : sans emoji de tête, préfixes ni parenthèses. */
export function seasonLabel(name: string): string {
  const cleaned = name
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^Icône\s*[-–]\s*/iu, '')
    .replace(/^Gamme\s+/iu, '')
    .replace(/\s*\(.*\)\s*$/u, '')
    .split(/\s+[–—]\s+/u)[0]
    .trim()

  if (/^B[.\s-]*2[.\s-]*B[.\s-]*$/iu.test(cleaned)) return 'B2B'

  return cleaned || name
}

/** Forme comparable d'un libellé : minuscule, sans accent ni ponctuation. */
export function compact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Illustration d'une gamme, reconnue au mot-clé de son nom. */
export function seasonImage(name: string): string | null {
  const flat = compact(name)
  const match = (
    [
      ['printan', 'printemps'],
      ['estival', 'ete'],
      ['automn', 'automne'],
      ['hivern', 'hiver'],
      ['noel', 'noel'],
      ['nicolas', 'saint-nicolas'],
      ['epiphanie', 'epiphanie'],
      ['mere', 'fete-des-meres'],
      ['pascal', 'paques'],
      ['paque', 'paques'],
      ['valentin', 'saint-valentin'],
      ['chandeleur', 'chandeleur'],
      ['glace', 'glace'],
      ['b2b', 'b2b'],
      ['standard', 'standard'],
    ] as const
  ).find(([key]) => flat.includes(key))

  return match ? `${import.meta.env.BASE_URL}img/seasons/${match[1]}.png` : null
}

/** Illustration d'une famille de produits, même principe. */
export function familyImage(family: string): string | null {
  const flat = compact(family)
  const match = (
    [
      ['tarte', 'sweet-tart-small'],
      ['patisserie', 'cake-slice'],
      ['viennoiserie', 'croissant'],
      ['pain', 'bread-1'],
      ['boulangerie', 'rolls'],
      ['salade', 'salads'],
      ['plat', 'salads'],
      ['traiteur', 'salads'],
      ['biscuit', 'cookies'],
      ['cookie', 'cookies'],
      ['quiche', 'savoury-tart'],
      ['snack', 'savoury-tart'],
    ] as const
  ).find(([key]) => flat.includes(key))

  return match ? `${import.meta.env.BASE_URL}img/${match[1]}.png` : null
}
