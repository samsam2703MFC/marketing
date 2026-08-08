/**
 * Gammes saisonnières — miroir de la table ERP `product_availability_period`
 * (marque 1). Aucune route TFBuddy n'expose encore cette table ; le jour où
 * une route existe, ce module n'a plus qu'à devenir un appel API.
 *
 * Les bornes sont récurrentes : seules comptent les paires mois-jour (`MMDD`,
 * mêmes valeurs que les colonnes générées `from_md` / `to_md` de l'ERP),
 * l'année étant ignorée. Une plage peut passer le nouvel an
 * (ex. Noël : 1101 → 0115).
 */

export interface Season {
  /** `product_availability_period.id` dans l'ERP. */
  id: number
  /** Illustration du bouton — l'emoji porté par le nom en base. */
  emoji: string
  /** Libellé court du bouton. */
  label: string
  /** Nom complet tel qu'en base, montré en infobulle. */
  dbName: string
  /** Bornes récurrentes mois-jour (MMDD). */
  fromMd: number
  toMd: number
  /** Illustration image optionnelle, prioritaire sur l'emoji. */
  image?: string
}

/** Gammes actives, dans l'ordre du calendrier. */
export const SEASONS: Season[] = [
  { id: 14, emoji: '🥖', label: 'Standard', dbName: '🥖 Gamme Standard', fromMd: 101, toMd: 1231, image: '/img/seasons/standard.png' },
  { id: 17, emoji: '🍦', label: 'Glace', dbName: '🍦 Icône - Gamme Glace (Avril - Septembre)', fromMd: 104, toMd: 930, image: '/img/seasons/glace.png' },
  { id: 15, emoji: '🥞', label: 'Chandeleur', dbName: '🥞 Chandeleur – Fête des crêpes', fromMd: 124, toMd: 208, image: '/img/seasons/chandeleur.png' },
  { id: 13, emoji: '🎉', label: 'Saint-Valentin', dbName: '🎉 Gamme Saint-Valentin (14 Février)', fromMd: 214, toMd: 216, image: '/img/seasons/saint-valentin.png' },
  { id: 4, emoji: '🌸', label: 'Printanière', dbName: '🌸 Gamme Printanière (Mars à Mai)', fromMd: 301, toMd: 501, image: '/img/seasons/printemps.png' },
  { id: 12, emoji: '🐣', label: 'Pascale', dbName: '🐣 Gamme Pascale (Mars-Avril)', fromMd: 315, toMd: 415, image: '/img/seasons/paques.png' },
  { id: 16, emoji: '📦', label: 'B2B', dbName: '📦 Gamme B.-2-B.', fromMd: 317, toMd: 317, image: '/img/seasons/b2b.png' },
  { id: 11, emoji: '🌷', label: 'Fête des Mères', dbName: '🌷 Gamme Fête des Mères (2e dimanche de Mai)', fromMd: 507, toMd: 514, image: '/img/seasons/fete-des-meres.png' },
  { id: 5, emoji: '☀️', label: 'Estivale', dbName: '☀️ Gamme Estivale (Juin à Août)', fromMd: 601, toMd: 901, image: '/img/seasons/ete.png' },
  { id: 6, emoji: '🍂', label: 'Automnale', dbName: '🍂 Gamme Automnale (Septembre à Novembre)', fromMd: 901, toMd: 1101, image: '/img/seasons/automne.png' },
  { id: 8, emoji: '🎄', label: 'Noël & Nouvel An', dbName: '🎄 Gamme Noël & Nouvel An (Décembre-Janvier)', fromMd: 1101, toMd: 115, image: '/img/seasons/noel.png' },
  { id: 9, emoji: '🎅', label: 'Saint-Nicolas', dbName: '🎅 Gamme Saint-Nicolas (6 Décembre)', fromMd: 1115, toMd: 1206, image: '/img/seasons/saint-nicolas.png' },
  { id: 7, emoji: '❄️', label: 'Hivernale', dbName: '❄️ Gamme Hivernale (Décembre à Février)', fromMd: 1201, toMd: 201, image: '/img/seasons/hiver.png' },
  { id: 10, emoji: '👑', label: 'Épiphanie', dbName: '👑 Gamme Épiphanie (6 Janvier)', fromMd: 1231, toMd: 115, image: '/img/seasons/epiphanie.png' },
]

/** `MMDD` d'une date ISO (`YYYY-MM-DD…`), ou `null` si le format est inconnu. */
export function isoToMd(value: string | null | undefined): number | null {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value ?? '')
  return match ? Number(match[1]) * 100 + Number(match[2]) : null
}

/** Segments linéaires d'une plage mois-jour, découpée si elle passe le nouvel an. */
function segments(from: number, to: number): Array<[number, number]> {
  return from <= to
    ? [[from, to]]
    : [
        [from, 1231],
        [101, to],
      ]
}

/** Chevauchement de deux plages mois-jour récurrentes, bornes incluses. */
export function mdRangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return segments(aFrom, aTo).some(([startA, endA]) =>
    segments(bFrom, bTo).some(([startB, endB]) => startA <= endB && startB <= endA),
  )
}

/** `YYYY-MM-DD` à partir d'une année et d'une borne mois-jour (MMDD). */
function mdToIso(year: number, md: number): string {
  const month = String(Math.floor(md / 100)).padStart(2, '0')
  const day = String(md % 100).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Occurrence courante ou prochaine d'une gamme récurrente, en dates ISO.
 * Une plage passant le nouvel an garde son année de départ (ex. en janvier,
 * Noël court depuis décembre de l'année précédente).
 */
export function seasonOccurrence(
  season: Season,
  today = new Date(),
): { dateFrom: string; dateTo: string } {
  const year = today.getFullYear()
  const todayMd = (today.getMonth() + 1) * 100 + today.getDate()
  const wraps = season.toMd < season.fromMd
  let fromYear: number
  let toYear: number
  if (!wraps) {
    fromYear = todayMd > season.toMd ? year + 1 : year
    toYear = fromYear
  } else if (todayMd <= season.toMd) {
    fromYear = year - 1
    toYear = year
  } else {
    fromYear = year
    toYear = year + 1
  }
  return { dateFrom: mdToIso(fromYear, season.fromMd), dateTo: mdToIso(toYear, season.toMd) }
}

/**
 * Une plage datée (campagne, support…) tombe-t-elle dans la saison ?
 * Sans date exploitable la réponse est `true` : on ne masque pas ce qu'on ne
 * sait pas dater.
 */
export function rangeInSeason(
  season: Season,
  dateFrom?: string | null,
  dateTo?: string | null,
): boolean {
  const from = isoToMd(dateFrom)
  const to = isoToMd(dateTo)
  const start = from ?? to
  const end = to ?? from
  if (start === null || end === null) return true
  return mdRangesOverlap(season.fromMd, season.toMd, start, end)
}
