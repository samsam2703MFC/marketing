import type { MediaAsset } from '../../lib/api/module'
import SharedMediaPicker from '../media/MediaPicker'

/**
 * Choisir une image pour un catalogue (charte, logo d'une boutique, place libre, vignette d'offre) : LA médiathèque du
 * module (17/11/2026, Sam : « one médiathèque for all the marketing module ») — ses fichiers, les photos du webshop et
 * les illustrations, comme « Créer un post ». Une photo du webshop ou une illustration est versée dans la médiathèque
 * en la choisissant : le catalogue retient toujours une fiche de la médiathèque (`mediaId`), que le serveur vérifie.
 */
export function MediaPicker({ onPick, onClose, title = 'Médiathèque' }: { onPick: (asset: MediaAsset) => void; onClose: () => void; title?: string }) {
  return (
    <SharedMediaPicker
      title={title}
      onClose={onClose}
      onPick={(_image, note, asset) => {
        if (asset) {
          onPick(asset)
          return
        }
        window.alert(note ?? 'Cette image n’a pas pu entrer dans la médiathèque : choisissez-en une autre.')
      }}
    />
  )
}
