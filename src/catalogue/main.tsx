import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as api from '../lib/api/module'
import type { CatalogueDocument } from '../lib/api/module'
import { printWhenReady } from '../lib/print'
import { CatalogueSheet, catalogueCss, sheetSize } from '../views/catalogue/CataloguePages'

/**
 * La page d'impression d'un catalogue, ouverte par un lien signé (`?t=…`, 48 h) — celui que le
 * dashboard magasin du cockpit demande à l'API (`…/catalogues/{id}/print-links`). Elle compose les
 * pages avec les polices de la marque, par les mêmes composants et le même moteur que l'écran
 * « Catalogues » du Marketing, puis ouvre la boîte d'impression : « Enregistrer au format PDF ».
 * Aucune session : le lien seul ouvre CE catalogue, en lecture.
 */
function PrintPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? ''
  const [doc, setDoc] = useState<CatalogueDocument | null>(null)
  const [error, setError] = useState<string | null>(token ? null : 'Lien d’impression incomplet.')

  useEffect(() => {
    if (!token) return
    api.getCataloguePrint(token).then(
      (read) => {
        setDoc(read)
        document.title = `${read.catalogue.title} – ${read.catalogue.format}`
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }, [token])

  useEffect(() => {
    if (doc && new URLSearchParams(window.location.search).get('imprimer') !== '0') printWhenReady(window)
  }, [doc])

  if (error) return <p className="cat-print__msg">{error}</p>
  if (!doc) return <p className="cat-print__msg">Composition du catalogue…</p>

  const size = sheetSize(doc.catalogue.format, 'proof')
  return (
    <>
      <style>{`${catalogueCss()}\n@page{size:${size.w}mm ${size.h}mm;margin:0}html,body{margin:0;padding:0}.cat-sheet{break-after:page}.cat-sheet:last-child{break-after:auto}
@media screen{body{background:#8a857e}#root{display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}}
.cat-print__bar{position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:10px 16px;border-radius:0 0 12px 12px;background:#fff;font:13px system-ui,sans-serif}
.cat-print__bar button{padding:7px 16px;border:1px solid #8D1D2C;border-radius:8px;background:#8D1D2C;color:#fff;font:inherit;cursor:pointer}
.cat-print__msg{font:14px system-ui,sans-serif;padding:24px;color:#1c1a17;background:#fff}
@media print{.cat-print__bar{display:none}}`}</style>
      <div className="cat-print__bar">
        <span>
          {doc.catalogue.title} · {doc.catalogue.format} · {doc.version.lang.toUpperCase()}
        </span>
        <button type="button" onClick={() => window.print()}>
          Imprimer · Enregistrer en PDF
        </button>
      </div>
      {doc.pages.map((_, index) => (
        <CatalogueSheet key={index} doc={doc} index={index} mode="proof" />
      ))}
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PrintPage />
  </StrictMode>,
)
