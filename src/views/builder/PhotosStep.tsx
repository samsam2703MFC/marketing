import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { describeError } from '../../state/auth'
import { seasonImage, seasonLabel } from './illustrations'
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
 *     montre pas tous ;
 *   • laquelle ? Celle du catalogue par défaut — la fiche produit de l'ERP —,
 *     ou une photo propre à la campagne ;
 *   • et sinon, on le voit tout de suite : un produit sans photo nulle part
 *     s'affiche comme tel, au lieu de laisser découvrir le trou sur l'épreuve
 *     de l'imprimeur.
 *
 * Une gamme n'est pas un produit. Elle entre dans l'offre au même titre — c'est
 * elle qui la nomme —, mais elle n'a ni prix, ni ligne sur le dépliant, et son
 * illustration est déjà dessinée. On la montre donc à part, pour mémoire, sans
 * lui réclamer une photo qu'elle a déjà.
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

  /**
   * Rangs des produits dans l'offre — les gammes en sont écartées.
   *
   * On garde le rang plutôt que l'élément : c'est lui qui sert à écrire dans
   * le brouillon, et une liste filtrée n'a plus les mêmes indices.
   */
  const produits = items
    .map((_, index) => index)
    .filter((index) => items[index].category !== 'saison')

  const gammes = items
    .map((_, index) => index)
    .filter((index) => items[index].category === 'saison')

  /** Photo du catalogue d'un produit, quand la reprise en a trouvé une. */
  const photoCatalogue = (offerItemId: number | null): string | null =>
    offerItemId === null
      ? null
      : (catalogue.data ?? []).find((entry) => entry.id === offerItemId)?.image_url ?? null

  /** Nom de la gamme au catalogue, à défaut son libellé dans l'offre. */
  const nomCatalogue = (index: number): string =>
    (catalogue.data ?? []).find((entry) => entry.id === items[index].offer_item_id)?.name ??
    items[index].label

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

  const blocGammes =
    gammes.length === 0 ? null : (
      <>
        <h3 className="photos__titre">
          {gammes.length > 1 ? 'Gammes retenues' : 'Gamme retenue'}
        </h3>
        <ul className="photos photos--gammes">
          {gammes.map((index) => {
            const nom       = nomCatalogue(index)
            const dessinee  = seasonImage(nom)

            return (
              <li key={`gamme-${index}`} className="photos__item">
                <div className={`photos__vignette${dessinee === null ? ' is-empty' : ''}`}>
                  {dessinee === null ? (
                    <span className="muted">illustration de gamme</span>
                  ) : (
                    <img src={dessinee} alt="" />
                  )}
                </div>

                <div className="photos__corps">
                  <strong className="photos__nom">{seasonLabel(nom)}</strong>
                  <span className="muted photos__source">
                    Gamme, pas un produit : elle nomme l’offre et porte son illustration de
                    marque. Rien à choisir ici — le dépliant n’en fait pas une ligne produit.
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </>
    )

  if (produits.length === 0) {
    return (
      <>
        <h2>Photos produits</h2>
        <p className="muted">
          Aucun produit dans l’offre : retournez à l’étape « Offre » pour en sélectionner — ce
          sont eux qui portent les photos.
        </p>
        {blocGammes}
      </>
    )
  }

  const avecPhoto = produits.filter(
    (index) =>
      items[index].show_photo &&
      (items[index].image_url !== '' || photoCatalogue(items[index].offer_item_id) !== null),
  ).length
  const sansAucune = produits.filter(
    (index) =>
      items[index].image_url === '' && photoCatalogue(items[index].offer_item_id) === null,
  ).length

  return (
    <>
      <h2>Photos produits</h2>
      <p className="muted">
        Ce qui part dans le dossier d’impression. La photo du catalogue sert par défaut ; une
        photo déposée ici ne vaut que pour cette campagne et ne change rien au catalogue.
      </p>

      <p className="photos__bilan">
        <strong>{avecPhoto}</strong> photo{avecPhoto > 1 ? 's' : ''} sur {produits.length} produit
        {produits.length > 1 ? 's' : ''}
        {sansAucune > 0 ? (
          <span className="muted">
            {' '}
            · {sansAucune} sans photo disponible
          </span>
        ) : null}
      </p>

      {erreur === null ? null : <p className="error">{erreur}</p>}

      <ul className="photos">
        {produits.map((index) => {
          const item       = items[index]
          const duCatalogue = photoCatalogue(item.offer_item_id)
          const propre      = item.image_url !== ''
          const affichee    = propre ? item.image_url : duCatalogue

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

      {blocGammes}
    </>
  )
}
