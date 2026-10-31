import qrcode from 'qrcode-generator'

/**
 * Un QR code en tracé vectoriel : net à toutes les tailles, à l'écran comme à
 * l'impression (300 dpi et plus), sans image à générer ni à héberger.
 *
 * Niveau de correction M : un pli, une rayure ou une impression un peu
 * grasse laissent le code lisible, sans le rendre trop dense pour 2 cm.
 */
export interface QrPath {
  /** Côté, en modules, marge comprise. */
  size: number
  /** Le tracé des modules foncés, en unités de module. */
  d: string
}

const MARGIN = 2

export function qrPath(text: string): QrPath {
  const code = qrcode(0, 'M')
  code.addData(text, 'Byte')
  code.make()

  const count = code.getModuleCount()
  const parts: string[] = []
  for (let row = 0; row < count; row++) {
    let col = 0
    while (col < count) {
      if (!code.isDark(row, col)) {
        col++
        continue
      }
      // Les modules foncés contigus d'une ligne en un seul rectangle : un tracé dix fois plus court.
      const start = col
      while (col < count && code.isDark(row, col)) col++
      parts.push(`M${start + MARGIN} ${row + MARGIN}h${col - start}v1h${start - col}z`)
    }
  }

  return { size: count + MARGIN * 2, d: parts.join('') }
}
