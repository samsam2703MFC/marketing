import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import type { CampaignTypeAdmin, CampaignTypeDraft, IconChoice } from '../lib/api/module'
import { useReferences } from '../state/references'
import { describeError } from '../state/auth'

/**
 * Éditeur des types de campagne.
 *
 * Les neuf types étaient posés par un jeu de données et n'avaient jamais pu
 * bouger : une carte traiteur, une opération anniversaire, une ouverture de
 * corner ne rentrent dans aucun des neuf, et il fallait réécrire un fichier SQL
 * pour en ajouter un.
 *
 * L'écran montre les cartes telles qu'elles apparaîtront dans l'assistant. C'est
 * volontaire : régler une couleur et une icône dans un formulaire, puis
 * découvrir le résultat trois écrans plus loin, fait recommencer deux fois sur
 * trois.
 */
export default function CampaignTypesView() {
  const [tour, setTour] = useState(0)
  const [edite, setEdite] = useState<CampaignTypeAdmin | 'nouveau' | null>(null)

  const { data, error, loading } = useAsync(() => api.listCampaignTypes(), [tour])

  const types = data?.types ?? []
  const icones = data?.icons ?? []

  const relire = () => setTour((n) => n + 1)

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <button
            type="button"
            className={`action${edite === 'nouveau' ? ' is-open' : ''}`}
            onClick={() => setEdite(edite === 'nouveau' ? null : 'nouveau')}
          >
            {edite === 'nouveau' ? 'Fermer' : '+ Nouveau type'}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      {edite === null ? null : (
        <TypeForm
          key={edite === 'nouveau' ? 'nouveau' : edite.id}
          type={edite === 'nouveau' ? null : edite}
          icones={icones}
          onDone={() => {
            setEdite(null)
            relire()
          }}
          onCancel={() => setEdite(null)}
        />
      )}

      <p className="muted">
        Ces cartes sont celles de la première étape de l’assistant. Un type utilisé par des
        campagnes ne se supprime pas : il se désactive, ce qui le retire des choix sans toucher
        à leur historique.
      </p>

      <ul className="type-grid type-grid--admin">
        {types.map((type) => (
          <li key={type.id}>
            <button
              type="button"
              className={`type-card${type.is_active ? '' : ' is-off'}`}
              onClick={() => setEdite(type)}
            >
              {type.icon_path ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  style={{ color: type.color_hex ?? undefined }}
                >
                  <path
                    d={type.icon_path}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
              <strong className="type-card__name">{type.label}</strong>
              {type.lever_label ? (
                <span
                  className="lever-tag"
                  style={{ background: type.lever_color_hex ?? undefined }}
                >
                  {type.lever_label}
                </span>
              ) : null}
              {type.description ? (
                <span className="muted type-card__kpi">{type.description}</span>
              ) : null}
              {type.default_kpi_label ? (
                <span className="muted type-card__kpi">{type.default_kpi_label}</span>
              ) : null}

              <span className="type-card__etat muted">
                {type.is_active ? '' : 'Désactivé — '}
                {type.campaigns === 0
                  ? 'aucune campagne'
                  : `${type.campaigns} campagne${type.campaigns > 1 ? 's' : ''}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Création ou correction d'un type.
 *
 * L'aperçu est en haut, avant les champs : c'est la carte qu'on cherche à
 * obtenir, et elle réagit à chaque frappe.
 */
function TypeForm({
  type,
  icones,
  onDone,
  onCancel,
}: {
  type: CampaignTypeAdmin | null
  icones: IconChoice[]
  onDone: () => void
  onCancel: () => void
}) {
  const references = useReferences()

  const [nom, setNom] = useState(type?.label ?? '')
  const [description, setDescription] = useState(type?.description ?? '')
  const [kpi, setKpi] = useState(type?.default_kpi_label ?? '')
  const [couleur, setCouleur] = useState(type?.color_hex ?? '#8D1D2C')
  const [icone, setIcone] = useState(type?.icon_key ?? '')
  const [levier, setLevier] = useState(type?.lever_id === null ? '' : String(type?.lever_id ?? ''))
  const [pastille, setPastille] = useState(type?.lever_badge_label ?? '')
  const [actif, setActif] = useState(type?.is_active ?? true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [suppression, setSuppression] = useState(false)

  const trace = icones.find((entree) => entree.key === icone)?.path ?? null
  const levierChoisi = references.levers.find((entree) => String(entree.id) === levier)

  const enregistrer = async () => {
    setEnvoi(true)
    setErreur(null)

    const brouillon: CampaignTypeDraft = {
      label: nom.trim(),
      description: description.trim() || null,
      color_hex: couleur || null,
      icon_key: icone || null,
      lever_id: levier === '' ? null : Number(levier),
      lever_badge_label: pastille.trim() || null,
      default_kpi_label: kpi.trim() || null,
      is_active: actif,
    }

    try {
      if (type === null) {
        await api.addCampaignType(brouillon)
      } else {
        await api.updateCampaignType(type.id, brouillon)
      }
      onDone()
    } catch (echec) {
      setErreur(describeError(echec))
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async () => {
    if (type === null) return

    setEnvoi(true)
    setErreur(null)

    try {
      await api.deleteCampaignType(type.id)
      onDone()
    } catch (echec) {
      // Le serveur refuse quand des campagnes s'en réclament, et dit combien :
      // le message vaut mieux que « suppression impossible ».
      setErreur(describeError(echec))
      setSuppression(false)
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="card movement typeform">
      <h2 className="movement__title">
        {type === null ? 'Nouveau type de campagne' : `Modifier « ${type.label} »`}
      </h2>

      {/* L'aperçu d'abord : c'est la carte qu'on compose, et la régler à
          l'aveugle pour la découvrir trois écrans plus loin fait recommencer. */}
      <div className="typeform__apercu">
        <span className="type-card is-on" aria-hidden="true">
          {trace === null ? null : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: couleur }}
            >
              <path
                d={trace}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <strong className="type-card__name">{nom.trim() === '' ? 'Sans nom' : nom}</strong>
          {levierChoisi === undefined && pastille.trim() === '' ? null : (
            <span className="lever-tag" style={{ background: levierChoisi?.color_hex ?? undefined }}>
              {pastille.trim() === '' ? levierChoisi?.label : pastille}
            </span>
          )}
          {description.trim() === '' ? null : (
            <span className="muted type-card__kpi">{description}</span>
          )}
          {kpi.trim() === '' ? null : <span className="muted type-card__kpi">{kpi}</span>}
        </span>
      </div>

      <div className="movement__grid">
        <label className="field field--block">
          Nom
          <input
            value={nom}
            placeholder="Carte traiteur"
            onChange={(e) => setNom(e.target.value)}
          />
        </label>

        <label className="field field--block">
          Description
          <input
            value={description}
            placeholder="Ce que le type recouvre, en une phrase"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="field field--block">
          Indicateur attendu
          <input
            value={kpi}
            placeholder="Commandes B2B, panier moyen"
            onChange={(e) => setKpi(e.target.value)}
          />
        </label>

        <label className="field">
          Levier
          <select value={levier} onChange={(e) => setLevier(e.target.value)}>
            <option value="">Aucun</option>
            {references.levers.map((entree) => (
              <option key={entree.id} value={entree.id}>
                {entree.label}
              </option>
            ))}
          </select>
        </label>

        {/* La pastille peut nuancer le levier — « Trafic / notoriété » — sans
            créer un levier de plus, qui fausserait les totaux du pilotage. */}
        <label className="field">
          Texte de la pastille
          <input
            value={pastille}
            placeholder={levierChoisi?.label ?? 'Repris du levier'}
            onChange={(e) => setPastille(e.target.value)}
          />
        </label>

        <label className="field">
          Couleur
          <span className="typeform__couleur">
            <input type="color" value={couleur} onChange={(e) => setCouleur(e.target.value)} />
            <input
              value={couleur}
              spellCheck={false}
              onChange={(e) => setCouleur(e.target.value)}
            />
          </span>
        </label>

        <label className="field field--inline">
          <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
          <span>
            Proposé dans l’assistant
            <span className="muted"> — décochez pour le retirer des choix</span>
          </span>
        </label>
      </div>

      <div className="typeform__icones">
        <span className="field__legend">Icône</span>
        <div className="typeform__grille">
          {icones.map((entree) => (
            <button
              key={entree.key}
              type="button"
              className={`typeform__icone${icone === entree.key ? ' is-on' : ''}`}
              title={entree.label}
              aria-label={entree.label}
              aria-pressed={icone === entree.key}
              onClick={() => setIcone(icone === entree.key ? '' : entree.key)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={entree.path}
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {erreur === null ? null : <p className="error">{erreur}</p>}

      <div className="movement__actions">
        {type === null ? null : (
          <button
            type="button"
            className="filter confirm__danger movement__supprimer"
            disabled={envoi}
            onClick={() => setSuppression(true)}
          >
            Supprimer
          </button>
        )}

        <button type="button" className="filter" disabled={envoi} onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="filter is-on"
          disabled={envoi || nom.trim() === ''}
          onClick={enregistrer}
        >
          {envoi ? 'Enregistrement…' : type === null ? 'Créer le type' : 'Enregistrer'}
        </button>
      </div>

      {!suppression || type === null ? null : (
        <div
          className="confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-type"
          onClick={() => (envoi ? null : setSuppression(false))}
        >
          <div className="confirm__box card" onClick={(evenement) => evenement.stopPropagation()}>
            <h3 id="confirm-type">Supprimer « {type.label} » ?</h3>
            <p className="muted">
              {type.campaigns === 0
                ? 'Aucune campagne ne l’utilise : il disparaîtra des choix de l’assistant.'
                : `${type.campaigns} campagne${type.campaigns > 1 ? 's' : ''} l’utilise${type.campaigns > 1 ? 'nt' : ''} — la suppression sera refusée. Désactivez-le plutôt.`}
            </p>

            <div className="confirm__actions">
              <button
                type="button"
                className="filter"
                disabled={envoi}
                onClick={() => setSuppression(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="filter confirm__danger"
                disabled={envoi}
                onClick={supprimer}
              >
                {envoi ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
