import { useCallback, useEffect, useState } from 'react'
import './social.css'
import * as api from '../../lib/api/module'
import type { BilanLigne, BilanPeriode, SocialBilan } from '../../lib/api/module'
import { ROOTS } from '../../lib/api/module'

const PERIODES: [BilanPeriode, string][] = [
  ['semaine', 'Semaine'],
  ['mois', 'Mois'],
  ['trimestre', 'Trimestre'],
  ['annee', 'Année'],
]
const LIBELLE_PERIODE: Record<BilanPeriode, string> = {
  semaine: 'Semaine',
  mois: '30 derniers jours',
  trimestre: '90 derniers jours',
  annee: '12 derniers mois',
}

const entier = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('fr-BE'))
const signe = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${entier(v)}`)
const jourCourt = (iso: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : '')

/**
 * Bilan des boutiques — l'écran « Bilan » du module Social, réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Mêmes données (API de Social, social/src/bilan.php) :
 * régularité, réactivité, avis Google, Meta et le classement, sur la semaine, le mois,
 * le trimestre ou l'année. Calculé par le cron ; « Recalculer » relit Meta tout de suite.
 */
export default function BilanView() {
  const [periode, setPeriode] = useState<BilanPeriode>('semaine')
  const [data, setData] = useState<SocialBilan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const charger = useCallback((p: BilanPeriode, forcer: boolean, annule: { v: boolean }) => {
    setError(null)
    setBusy(forcer)
    api
      .getSocialBilan(p, forcer)
      .then((d) => !annule.v && setData(d))
      .catch((cause: unknown) => !annule.v && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !annule.v && setBusy(false))
  }, [])

  useEffect(() => {
    const annule = { v: false }
    setData(null)
    charger(periode, false, annule)
    return () => {
      annule.v = true
    }
  }, [periode, charger])

  const d = data
  const semaine = !d || !d.periode || d.periode === 'semaine'
  const res = d?.reseau ?? {}
  const devise = d?.devise ?? 'EUR'
  const argent = (v: number | null | undefined) =>
    v == null ? '—' : new Intl.NumberFormat('fr-BE', { style: 'currency', currency: devise, maximumFractionDigits: 0 }).format(v)

  return (
    <div className="social-native">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">
            {d
              ? `${LIBELLE_PERIODE[d.periode ?? 'semaine']} · du ${jourCourt(d.du)} au ${jourCourt(d.au)} · calculé le ${jourCourt(d.le.slice(0, 10))} à ${d.le.slice(11, 16)}`
              : 'Régularité, réactivité, avis Google, Meta'}
          </span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période du bilan">
            {PERIODES.map(([cle, label]) => (
              <button key={cle} type="button" className={periode === cle ? 'is-on' : ''} aria-pressed={periode === cle} onClick={() => setPeriode(cle)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => charger(periode, true, { v: false })}>
            {busy ? 'Calcul…' : 'Recalculer'}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {!d && !error ? (
        <p className="muted">
          {periode === 'semaine' ? 'Calcul du bilan…' : 'Calcul du bilan sur la période… la première lecture chez Meta peut prendre une minute.'}
        </p>
      ) : null}
      {d?.erreurs?.length ? <p className="warning">Lu en partie chez Meta : {d.erreurs.join(' · ')}</p> : null}

      {d ? (
        <>
          <div className="kpi-row">
            <Kpi label="Posts publiés" value={entier(res.posts)} note={`sur les Pages, ${d.jours} jours, ${entier(res.boutiques)} boutiques`} />
            <Kpi
              label="À traiter"
              value={entier(res.aTraiter)}
              note={`${entier(res.enRetard)} en retard (> ${d.delaiReponseHeures ?? 24} h)`}
              alerte={!!res.enRetard}
            />
            <Kpi
              label="Avis Google gagnés"
              value={signe(res.avisGagnes)}
              note={d.avisDepuis ? `suivis depuis le ${jourCourt(d.avisDepuis)}` : 'sur la période'}
              bon={(res.avisGagnes ?? 0) > 0}
            />
            <Kpi
              label="Abonnés nets"
              value={signe(res.abonnesNet)}
              note={d.instagramPartiel ? 'Facebook ; Instagram sur 30 jours (limite de Meta)' : 'Pages Facebook et Instagram'}
            />
            <Kpi label="Pub dépensée" value={argent(res.depense)} note="toutes boutiques" />
          </div>

          <section className="card table-card">
            <div className="table-scroll">
              <table className="bilan">
                <thead>
                  <tr>
                    <th>Boutique</th>
                    <th>Régularité</th>
                    <th>Réactivité</th>
                    <th>Avis Google</th>
                    <th>Meta</th>
                    <th>{semaine ? 'Cette semaine' : 'À faire'}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lignes.map((l) => (
                    <Ligne key={l.id} l={l} d={d} n={d.lignes.length} semaine={semaine} argent={argent} />
                  ))}
                  {d.lignes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Aucune boutique dans le réseau.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <p className="muted bilan__legende">
            Classement sur la période choisie : trois critères — régularité (publications de la Page de la boutique, lues chez Meta, rapportées au
            rythme attendu : le quota de la semaine{semaine ? '' : ` × ${d.semaines ?? 1} semaines`}), réactivité (part des commentaires et avis
            traités dans le délai, moins 5 points par retard ; sans rien de traité, rien en retard vaut le meilleur score), avis Google gagnés ; le
            rang général additionne les trois. Chaque boutique voit son rang dans « Ma semaine » de l’espace franchisé.
          </p>
        </>
      ) : null}
    </div>
  )
}

function Kpi({ label, value, note, alerte, bon }: { label: string; value: string; note: string; alerte?: boolean; bon?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className={`kpi__value${alerte ? ' is-alerte' : ''}${bon ? ' is-bon' : ''}`}>{value}</div>
      <div className="kpi__note">{note}</div>
    </div>
  )
}

function Rang({ rang, n, quoi }: { rang: number | null | undefined; n: number; quoi: string }) {
  const ton = rang === 1 ? ' is-premier' : rang && rang === n && n > 1 ? ' is-dernier' : ''
  return <span className={`bilan__rang${ton}`}>{rang == null ? `${quoi} : —` : `${rang === 1 ? '1er' : `${rang}e`} · ${quoi}`}</span>
}

function Ligne({
  l,
  d,
  n,
  semaine,
  argent,
}: {
  l: BilanLigne
  d: SocialBilan
  n: number
  semaine: boolean
  argent: (v: number | null | undefined) => string
}) {
  const surPeriode = semaine ? 'cette semaine' : 'sur la période'
  const jours = d.reactJours ?? 30
  // Le conseil : ce qui pèse le plus, dans l'ordre (retards, rien publié, note sous la cible, sinon bravo).
  const conseil =
    l.enRetard > 0
      ? `${l.enRetard} commentaire${l.enRetard > 1 ? 's' : ''} ou avis en retard : à traiter aujourd’hui.`
      : l.posts === 0
        ? `Aucune publication sur la Page ${surPeriode} : proposer un modèle du réseau.`
        : (l.avis5Requis ?? 0) > 0
          ? `Note sous la cible : ${l.avis5Requis} avis 5★ à obtenir — affiche « Laissez-nous un avis ».`
          : 'Rien à signaler : bravo.'
  const espace = `${ROOTS.socialFranchise}calendrier?shop=${encodeURIComponent(l.id)}`
  const noteOk = l.note != null && d.cible != null && l.note >= d.cible

  return (
    <tr>
      <td>
        <span className="bilan__boutique">
          <span className={`bilan__place${l.rang === 1 ? ' is-premier' : ''}`}>{l.rang}</span>
          {l.nom}
        </span>
      </td>
      <td>
        <div className="bilan__chiffre">
          {entier(l.posts)} publié{l.posts > 1 ? 's' : ''}
        </div>
        <div className="muted bilan__sous">
          {l.postsSource === 'meta'
            ? `sur la Page, lus chez Meta · dont ${l.postsBoutique + l.postsReseau} par le module`
            : `${l.postsBoutique} par la boutique · ${l.postsReseau} par le réseau (module)`}{' '}
          · rythme attendu {l.quota}
        </div>
        <Rang rang={l.rangs?.regularite} n={n} quoi="régularité" />
      </td>
      <td>
        <div className={l.enRetard ? 'bilan__retard' : undefined}>
          {l.aTraiter ? `${l.aTraiter} à traiter${l.enRetard ? ` · ${l.enRetard} en retard` : ''}` : 'Rien à traiter'}
        </div>
        <div className="muted bilan__sous">
          {l.dansDelaiPct == null ? `aucun traité sur ${jours} j` : `${l.dansDelaiPct} % traités dans le délai (${jours} j)`}
          {l.delaiMedianH != null ? ` · médiane ${String(l.delaiMedianH).replace('.', ',')} h` : ''}
        </div>
        <Rang rang={l.rangs?.reactivite} n={n} quoi="réactivité" />
      </td>
      <td>
        <div className={`bilan__chiffre${l.note == null ? '' : noteOk ? ' is-bon' : ' is-alerte'}`}>
          {l.note == null ? '—' : `${l.note.toFixed(2).replace('.', ',')} ★`}
        </div>
        <div className="muted bilan__sous">
          {l.avisGagnes == null
            ? 'avis gagnés : suivi en cours'
            : `${signe(l.avisGagnes)} avis ${d.avisDepuis ? `depuis le ${jourCourt(d.avisDepuis)}` : `en ${d.jours} j`}`}
          {l.avis5Requis ? ` · objectif ${l.avis5Requis} avis 5★` : ''}
        </div>
        <Rang rang={l.rangs?.avis} n={n} quoi="avis gagnés" />
      </td>
      <td>
        <div className="bilan__chiffre">{l.abonnesNet == null ? '—' : `${signe(l.abonnesNet)} abonnés`}</div>
        <div className="muted bilan__sous">
          {l.abonnes != null ? `${entier(l.abonnes)} sur la Page · ` : ''}pub : {argent(l.depense)}
        </div>
      </td>
      <td>
        <div className="bilan__conseil">{conseil}</div>
        <a href={espace} target="_blank" rel="noreferrer">
          Voir l’espace de la boutique ↗
        </a>
      </td>
    </tr>
  )
}
