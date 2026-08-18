import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { describeError } from '../../state/auth'
import type { Draft } from './CampaignBuilder'

/**
 * Étape « Photos produits ».
 *
 * Le dossier d'impression prévoyait depuis le début une option `show_photo` par
 * produit, figée à « vrai » faute d'écran pour la poser. C'est cet écran.
 *
 * Trois choses s'y décident, produit par produit :
 *
 *   • la photo part-elle à l'impression ? Un dépliant de six produits ne les
 *     montre pas tous, et une gamme se cite parfois sans image ;
 *   • laquelle ? Celle du catalogue par défaut — la fiche produit de l'ERP —,
 *     ou une photo propre à la campagne ;
 *   • et sinon, on le voit tout de suite : un produit sans photo nulle part
 *     s'affiche comme tel, au lieu de laisser découvrir le trou sur l'épreuve
 *     de l'imprimeur.
 */
export default function PhotosStep({
  draft,
  patch,
}: {
  draft: Draft
  patch: (change: Partial<Draft>) => void
}) {
  const catalogue = useAsync(() => api.listOfferItems(), [])
  const [encours, setEncours] = useState<number | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const items = draft.offer_items

  /** Photo du catalogue d'un produit, quand la reprise en a trouvé une. */
  const photoCatalogue = (offerItemId: number | null): string | null =>
    offerItemId === null
      ? null
      : (catalogue.data ?? []).find((entry) => entry.id === offerItemId)?.image_url ?? null

  const majItem = (index: number, change: Partial<(typeof items)[number]>) =>
    patch({
      offer_items: items.map((item, rang) => (rang === index ? { ...item, ...change } : item)),
    })

  const televerser = async (index: number, file: File | null) => {
    if (file === null) return

    setEncours(index)
    setErreur(null)

    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Fichier illisible.'))
        reader.readAsDataURL(file)
      })

      const image = await api.uploadImage(content)

      // `BASE_URL` porte le sous-répertoire d'installation : le chemin rendu par
      // le serveur est relatif à la racine de l'application, pas à celle du
      // domaine.
      majItem(index, { image_url: `${import.meta.env.BASE_URL}${image.path}`, show_photo: true })
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEncours(null)
    }
  }

  if (items.length === 0) {
    return (
      <>
        <h2>Photos produits</h2>
        <p className="muted">
          Aucun produit dans l’offre : retournez à l’étape « Offre » pour en sélectionner — ce
          sont eux qui portent les photos.
        </p>
      </>
    )
  }

  const avecPhoto = items.filter(
    (item) => item.show_photo && (item.image_url !== '' || photoCatalogue(item.offer_item_id) !== null),
  ).length
  const sansAucune = items.filter(
    (item) => item.image_url === '' && photoCatalogue(item.offer_item_id) === null,
  ).length

  return (
    <>
      <h2>Photos produits</h2>
      <p className="muted">
        Ce qui part dans le dossier d’impression. La photo du catalogue sert par défaut ; une
        photo déposée ici ne vaut que pour cette campagne et ne change rien au catalogue.
      </p>

      <p className="photos__bilan">
        <strong>{avecPhoto}</strong> photo{avecPhoto > 1 ? 's' : ''} sur {items.length} produit
        {items.length > 1 ? 's' : ''}
        {sansAucune > 0 ? (
          <span className="muted">
            {' '}
            · {sansAucune} sans photo disponible
          </span>
        ) : null}
      </p>

      {erreur === null ? null : <p className="error">{erreur}</p>}

      <ul className="photos">
        {items.map((item, index) => {
          const duCatalogue = photoCatalogue(item.offer_item_id)
          const propre = item.image_url !== ''
          const affichee = propre ? item.image_url : duCatalogue

          return (
            <li key={`${item.offer_item_id ?? 'libre'}-${index}`} className="photos__item">
              <div className={`photos__vignette${affichee === null ? ' is-empty' : ''}`}>
                {affichee === null ? (
                  <span className="muted">aucune photo</span>
                ) : (
                  <img src={affichee} alt="" />
                )}
              </div>

              <div className="photos__corps">
                <strong className="photos__nom">{item.label}</strong>

                <span className="muted photos__source">
                  {propre
                    ? 'Photo de cette campagne'
                    : duCatalogue !== null
                      ? 'Photo du catalogue'
                      : item.offer_item_id === null
                        ? 'Saisie libre — hors catalogue, donc sans photo à reprendre'
                        : 'Le catalogue n’a pas de photo pour ce produit'}
                </span>

                <label className="photos__case">
                  <input
                    type="checkbox"
                    checked={item.show_photo}
                    disabled={affichee === null}
                    onChange={(e) => majItem(index, { show_photo: e.target.checked })}
                  />
                  <span>
                    {affichee === null
                      ? 'Rien à imprimer tant qu’aucune photo n’est disponible'
                      : 'Imprimer cette photo'}
                  </span>
                </label>

                <div className="photos__actions">
                  <label className="filter photos__envoi">
                    {encours === index ? 'Envoi…' : propre ? 'Remplacer' : 'Déposer une photo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => televerser(index, e.target.files?.[0] ?? null)}
                    />
                  </label>

                  {/* Revenir au catalogue plutôt qu'effacer : la photo de la
                      fiche produit reste la référence, celle-ci n'était qu'un
                      habillage de campagne. */}
                  {propre ? (
                    <button
                      type="button"
                      className="filter"
                      onClick={() => majItem(index, { image_url: '' })}
                    >
                      {duCatalogue === null ? 'Retirer la photo' : 'Reprendre celle du catalogue'}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
