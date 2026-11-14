/**
 * Le moteur d'impression des imprimés du Marketing (brochures, catalogues) : une fenêtre à part
 * qui reçoit les pages déjà composées (même balisage, même feuille de style que l'aperçu), les
 * polices de la marque et la taille du papier, attend les polices et les images, puis ouvre la
 * boîte d'impression du navigateur — « Enregistrer au format PDF » donne le fichier.
 *
 * Un seul moteur : les brochures et les catalogues passent tous deux par ici.
 */

export interface PrintJob {
  /** Titre de la fenêtre : c'est le nom proposé pour le fichier PDF. */
  title: string
  /** Les pages, en HTML (rendues par React hors de l'écran). */
  markup: string
  /** Feuilles de style des pages (polices comprises). */
  css: string
  /** Taille d'une page, en millimètres. */
  size: { w: number; h: number }
  /** Classe qui sépare les pages (un saut de page après chacune). */
  pageClass: string
  /** Fenêtre déjà ouverte (dans le geste de l'utilisateur), sinon ouverte ici. */
  target?: Window | null
}

/** Rend `null` si la fenêtre s'est ouverte, sinon le message à afficher. */
export function openPrintWindow(job: PrintJob): string | null {
  const win = job.target ?? window.open('', '_blank')
  if (!win) return 'Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres pour ce site, puis recommencez.'

  const title = job.title.replace(/[<>&"]/g, '')
  win.document.open()
  win.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${job.css}\n` +
      `@page{size:${job.size.w}mm ${job.size.h}mm;margin:0}html,body{margin:0;padding:0;background:#fff}.${job.pageClass}{break-after:page}.${job.pageClass}:last-child{break-after:auto}` +
      `@media screen{body{background:#8a857e;display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}}</style></head><body>${job.markup}</body></html>`,
  )
  win.document.close()
  printWhenReady(win)
  return null
}

/** Attend les polices et les images d'une fenêtre, puis ouvre sa boîte d'impression. */
export function printWhenReady(win: Window): void {
  const loaded = (img: HTMLImageElement) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve())
          img.addEventListener('error', () => resolve())
        })
  void win.document.fonts.ready
    .then(() => Promise.all(Array.from(win.document.images).map(loaded)))
    .then(() => {
      win.focus()
      win.print()
    })
}
