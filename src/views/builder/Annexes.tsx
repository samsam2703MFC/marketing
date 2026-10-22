import { useEffect, useRef, useState } from 'react'
import { module as api } from '../../lib/api'
import type { Annexe, AnnexeType, AnnexesEtat } from '../../lib/api/module'

/**
 * Les documents joints à une campagne.
 *
 * Une campagne réseaux sociaux ne tient pas dans des chiffres : le magasin
 * attend le plan de publication, la liste des produits mis en avant, le bon de
 * commande PLV. Ces fichiers existaient — dans une boîte mail, dans un dossier
 * partagé — mais pas AVEC la campagne, et jamais dans la note envoyée au
 * réseau.
 *
 * Ils se déposent donc ici. Chacun porte un type — une liste ouverte : on
 * écrit ce qu'on veut, ce qu'on a écrit est proposé la fois d'après, et un
 * type dont on ne veut plus se retire sans effacer ce qu'il classait. La case
 * « en annexe du mail » décide de ce qui part : tout n'est pas pour le
 * franchisé, et un bon de commande interne n'a rien à faire dans sa boîte.
 *
 * PDF seulement : c'est le seul format qu'un magasin ouvre et imprime partout,
 * de la tablette de la réserve au poste du comptable.
 */

/** `2,4 Mo` — pour dire à l'avance ce que le serveur refusera. */
function poids(octets: number): string {
  return octets >= 1048576
    ? `${(octets / 1048576).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`
}

export default function Annexes({ campaignId }: { campaignId: number | null }) {
  const [etat, setEtat] = useState<AnnexesEtat | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  /** Le type retenu pour le PROCHAIN dépôt : identifiant, ou libellé libre. */
  const [typeId, setTypeId] = useState<number | null>(null)
  const [typeLibre, setTypeLibre] = useState('')
  const champ = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (campaignId === null) return
    api
      .getAnnexes(campaignId)
      .then((d) => {
        setEtat(d)
        setTypeId((actuel) => actuel ?? (d.types[0]?.id ?? null))
      })
      .catch(() => setErreur('Les annexes n’ont pas pu être lues.'))
  }, [campaignId])

  if (campaignId === null) {
    return (
      <>
        <h3 className="section-label">Documents joints</h3>
        <p className="muted wizard__hint">
          La campagne n’est pas encore enregistrée : passez une étape, les annexes s’attacheront à
          elle.
        </p>
      </>
    )
  }

  const deposer = (fichier: File) => {
    if (etat !== null && fichier.size > etat.maxOctets) {
      setErreur(`« ${fichier.name} » pèse ${poids(fichier.size)} : ${poids(etat.maxOctets)} au plus.`)
      return
    }

    setOccupe(true)
    setErreur(null)
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const nom = fichier.name.replace(/\.pdf$/i, '')
      api
        .addAnnexe(campaignId, {
          nom,
          typeId: typeLibre.trim() === '' ? typeId : null,
          typeNom: typeLibre.trim(),
          fichier: String(lecteur.result),
        })
        .then((d) => {
          setOccupe(false)
          if ('error' in d && d.error) {
            setErreur(d.error)
            return
          }
          setEtat({ annexes: d.annexes, types: d.types, maxOctets: etat?.maxOctets ?? 8388608 })
          // Le type libre vient d'entrer dans la liste : on le sélectionne au
          // lieu de le laisser en double dans le champ.
          const cree = d.types.find((t) => t.nom.toLowerCase() === typeLibre.trim().toLowerCase())
          if (cree !== undefined) setTypeId(cree.id)
          setTypeLibre('')
          if (champ.current !== null) champ.current.value = ''
        })
        .catch(() => {
          setOccupe(false)
          setErreur('Le dépôt a échoué.')
        })
    }
    lecteur.onerror = () => {
      setOccupe(false)
      setErreur('Fichier illisible.')
    }
    lecteur.readAsDataURL(fichier)
  }

  const majEtat = (d: AnnexesEtat | { annexes: Annexe[]; types: AnnexeType[] }) =>
    setEtat({ annexes: d.annexes, types: d.types, maxOctets: etat?.maxOctets ?? 8388608 })

  const jointes = (etat?.annexes ?? []).filter((a) => a.enMail && a.existe)

  return (
    <>
      <h3 className="section-label">Documents joints</h3>
      <p className="muted">
        Le plan de publication, la liste des produits, le bon de commande… Les documents cochés
        partent en annexe de la note envoyée aux franchisés. PDF uniquement.
      </p>

      <div className="filters__row annexes__depot">
        {/* La liste est OUVERTE : on choisit un type, ou on en écrit un — il
            entre dans la liste et sera proposé aux campagnes suivantes. */}
        <label className="field">
          Type de document
          <select
            value={typeLibre.trim() === '' ? (typeId ?? '') : ''}
            onChange={(e) => {
              setTypeLibre('')
              setTypeId(e.target.value === '' ? null : Number(e.target.value))
            }}
          >
            <option value="">— sans type —</option>
            {(etat?.types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          … ou un nouveau type
          <input
            value={typeLibre}
            placeholder="Plan de publication"
            onChange={(e) => setTypeLibre(e.target.value)}
          />
        </label>
        <label className={`filter is-on annexes__bouton${occupe ? ' is-busy' : ''}`}>
          {occupe ? 'Dépôt…' : 'Déposer un PDF'}
          <input
            ref={champ}
            type="file"
            accept="application/pdf,.pdf"
            disabled={occupe}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f !== undefined) deposer(f)
            }}
          />
        </label>
      </div>

      {erreur === null ? null : <p className="error">{erreur}</p>}

      {(etat?.types ?? []).length === 0 ? null : (
        <p className="muted annexes__types">
          Types enregistrés :{' '}
          {(etat?.types ?? []).map((t) => (
            <span key={t.id} className="chip chip--lever annexes__type">
              {t.nom}
              <button
                type="button"
                title={
                  t.utilise > 0
                    ? `Retirer de la liste — les ${t.utilise} document(s) déjà classés le gardent`
                    : 'Retirer de la liste'
                }
                onClick={() =>
                  api
                    .removeAnnexeType(t.id)
                    .then((d) => setEtat((e) => (e === null ? e : { ...e, types: d.types })))
                    .catch(() => setErreur('Le type n’a pas pu être retiré.'))
                }
              >
                ✕
              </button>
            </span>
          ))}
        </p>
      )}

      {(etat?.annexes ?? []).length === 0 ? (
        <p className="muted wizard__hint">
          Aucun document pour l’instant. La note partira seule, avec le visuel de la campagne en
          annexe.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="annexes">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th className="num">Poids</th>
                <th className="num">En annexe du mail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(etat?.annexes ?? []).map((a) => (
                <tr key={a.id}>
                  <td>
                    <a href={api.annexeHref(a.id)} target="_blank" rel="noreferrer">
                      {a.nom}
                    </a>
                    {a.existe ? null : (
                      <div className="error annexes__perdu">
                        Fichier absent du serveur — redéposez-le, il ne partira pas.
                      </div>
                    )}
                  </td>
                  <td className="muted">{a.type === '' ? '—' : a.type}</td>
                  <td className="num muted">{a.tailleTxt}</td>
                  <td className="num">
                    <input
                      type="checkbox"
                      aria-label={`Joindre ${a.nom} au courriel`}
                      checked={a.enMail}
                      disabled={!a.existe}
                      onChange={(e) =>
                        api
                          .updateAnnexe(a.id, { enMail: e.target.checked })
                          .then(majEtat)
                          .catch(() => setErreur('La case n’a pas pu être enregistrée.'))
                      }
                    />
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="annexes__retirer"
                      title="Retirer ce document"
                      onClick={() => {
                        if (!window.confirm(`Retirer « ${a.nom} » ? Le fichier sera effacé.`)) return
                        api
                          .removeAnnexe(a.id)
                          .then(majEtat)
                          .catch(() => setErreur('Le document n’a pas pu être retiré.'))
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {jointes.length === 0 ? null : (
        <p className="muted wizard__hint">
          {jointes.length} document{jointes.length > 1 ? 's' : ''} partira
          {jointes.length > 1 ? 'ont' : ''} avec la note, en plus du PDF de la campagne.
        </p>
      )}
    </>
  )
}
