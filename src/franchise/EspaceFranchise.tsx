import { useCallback, useEffect, useState } from 'react'
import CalendrierFranchiseView from '../views/franchise/CalendrierFranchiseView'
import CommentairesView from '../views/franchise/CommentairesView'
import GoogleFranchiseView from '../views/franchise/GoogleFranchiseView'
import InstagramView from '../views/franchise/InstagramView'
import MessagesView from '../views/franchise/MessagesView'
import OperationsView from '../views/franchise/OperationsView'
import PublierView from '../views/franchise/PublierView'
import {
  changerBoutique,
  charger,
  fermerApercu,
  libelleAcces,
  ligneRegles,
  pastilles,
  useFranchise,
} from '../lib/franchise/store'
import { adresseEspace, pageCourante, type PageEspace } from './routes'
import './espace.css'

/**
 * L'espace boutique (/marketing/franchise/) : les réseaux sociaux d'UNE boutique, ouverts depuis l'ERP
 * (session de l'ERP) ou en aperçu par le franchiseur. Il remplace l'ancien espace franchisé du module
 * Social (/social_franchisee, /marketing/franchise/*.dc.html), dont les adresses renvoient ici.
 *
 * La boutique est celle que le serveur ouvre ; une adresse qui en nomme une (`?shop=4`, liens de l'ERP et
 * de l'aperçu) la demande — le serveur la refuse si elle n'est pas de la session.
 */

type Page = Exclude<PageEspace, 'suivi'>

const TITRES: Record<Page, string> = {
  cal: 'Calendrier',
  pub: 'Créer un post',
  com: 'Commentaires',
  msg: 'Messages privés',
  google: 'Avis Google',
  camp: 'Publicités et opérations',
  ig: 'Grille Instagram',
}

const boutiqueDemandee = () => new URLSearchParams(window.location.search).get('shop') ?? ''

export default function EspaceFranchise() {
  const { chargement, erreur, etat } = useFranchise()
  const [page, setPage] = useState<Page>(pageCourante)
  // Change à chaque navigation : les pages relisent leurs paramètres d'adresse en se remontant.
  const [cle, setCle] = useState(() => window.location.pathname + window.location.search)
  const [tiroir, setTiroir] = useState(false)

  useEffect(() => {
    void charger(boutiqueDemandee() || undefined)
  }, [])

  useEffect(() => {
    const suivre = () => {
      setPage(pageCourante())
      setCle(window.location.pathname + window.location.search)
    }
    window.addEventListener('popstate', suivre)
    return () => window.removeEventListener('popstate', suivre)
  }, [])

  const aller = useCallback((p: PageEspace, query = '') => {
    const url = adresseEspace(p, query)
    window.history.pushState(null, '', url)
    setPage(pageCourante())
    setCle(window.location.pathname + window.location.search)
    setTiroir(false)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    document.title = `${TITRES[page]} · ${etat?.shop.name ?? 'Espace boutique'} — L'Atelier By`
  }, [page, etat?.shop.name])

  if (!etat) {
    return (
      <div className="esp-vide">
        <img src={`${import.meta.env.BASE_URL}img/logo.png`} alt="L'Atelier By" className="esp-logo" />
        <p className={chargement === 'erreur' ? 'esp-erreur' : 'esp-attente'}>
          {chargement === 'erreur' ? erreur || 'Espace indisponible.' : 'Ouverture de l’espace boutique…'}
        </p>
      </div>
    )
  }

  const r = etat.rules
  const p = pastilles(etat)
  const vue = page === 'cal' ? new URLSearchParams(window.location.search).get('vue') ?? '' : ''
  const entrees: { k: string; label: string; aller: () => void; actif: boolean; n?: number; groupe?: boolean }[] = [
    { k: 'cal', label: 'Calendrier', aller: () => aller('cal'), actif: page === 'cal' && vue !== 'analyse' && vue !== 'suivi', n: p.refuses + p.aValider },
    ...(r.voirAnalyse !== false ? [{ k: 'analyse', label: 'Vues et abonnés', aller: () => aller('cal', 'vue=analyse'), actif: page === 'cal' && vue === 'analyse' }] : []),
    ...(r.voirSuivi !== false ? [{ k: 'suivi', label: 'Suivi de ma boutique', aller: () => aller('suivi'), actif: page === 'cal' && vue === 'suivi' }] : []),
    ...(r.voirCommentaires !== false ? [{ k: 'com', label: 'Commentaires', aller: () => aller('com'), actif: page === 'com', n: p.commentaires }] : []),
    ...(r.voirMessages !== false ? [{ k: 'msg', label: 'Messages privés', aller: () => aller('msg'), actif: page === 'msg', n: p.messages }] : []),
    ...(r.voirAvisGoogle !== false ? [{ k: 'google', label: 'Avis Google', aller: () => aller('google'), actif: page === 'google', n: p.google }] : []),
    { k: 'pub', label: 'Créer un post', aller: () => aller('pub'), actif: page === 'pub' },
    ...(r.voirCampagnes !== false || r.voirPublicites !== false
      ? [{ k: 'camp', label: 'Publicités et opérations', aller: () => aller('camp'), actif: page === 'camp', groupe: true }]
      : []),
    ...(etat.grilleInstagram || etat.instagramUnique
      ? [{ k: 'ig', label: etat.instagramUnique ? 'Grille Instagram du réseau' : 'Grille Instagram', aller: () => aller('ig'), actif: page === 'ig', groupe: true }]
      : []),
  ]
  const q = etat.quota
  const boutiques = etat.me.shops ?? []
  const nom = etat.me.name || 'Gérant'

  return (
    <div className={`esp${tiroir ? ' esp--tiroir' : ''}`}>
      <aside className="esp-rail" aria-label="Menu de l’espace boutique">
        <div className="esp-tete">
          <img src={`${import.meta.env.BASE_URL}img/logo.png`} alt="L'Atelier By" className="esp-logo" />
          <div className="esp-titre">ESPACE BOUTIQUE</div>
          {boutiques.length > 1 ? (
            <select
              className="esp-boutique"
              value={etat.shop.id}
              aria-label="Boutique"
              onChange={(e) => void changerBoutique(e.target.value)}
            >
              {boutiques.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="esp-boutique-nom">{etat.shop.name}</div>
          )}
        </div>
        <nav className="esp-menu">
          <div className="esp-groupe">MES RÉSEAUX</div>
          {entrees.map((x) => (
            <div key={x.k}>
              {x.groupe && x.k === entrees.find((y) => y.groupe)?.k ? <div className="esp-groupe">ACTIONS DU RÉSEAU</div> : null}
              <a
                href="#"
                className={`esp-entree${x.actif ? ' is-actif' : ''}`}
                aria-current={x.actif ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  x.aller()
                }}
              >
                <span>{x.label}</span>
                {x.n ? <span className="esp-n">{x.n}</span> : null}
              </a>
            </div>
          ))}
        </nav>
        <div className="esp-pied">
          <div className="esp-quota" title={ligneRegles(r)}>
            <div className="esp-quota-l">
              Cette semaine · {q.used} / {q.max} post{q.max > 1 ? 's' : ''}
            </div>
            <div className="esp-quota-piste">
              <div
                className={`esp-quota-barre${q.used >= q.max ? ' is-plein' : ''}`}
                style={{ width: `${Math.min(100, q.max ? (q.used / q.max) * 100 : 100)}%` }}
              />
            </div>
          </div>
          <div className="esp-compte">
            <span className="esp-avatar">{nom.split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase()}</span>
            <span className="esp-compte-t">
              <span>{nom}</span>
              <span className="esp-via">{libelleAcces(etat.me.via)}</span>
            </span>
          </div>
          {etat.me.via === 'apercu' ? (
            <button type="button" className="esp-btn" onClick={() => void fermerApercu()}>
              Fermer l’aperçu
            </button>
          ) : null}
        </div>
      </aside>

      <header className="esp-barre">
        <button type="button" className="esp-btn esp-menu-btn" onClick={() => setTiroir(true)} aria-label="Ouvrir le menu">
          Menu
        </button>
        <span className="esp-barre-t">{TITRES[page]}</span>
        <span className="esp-barre-b">{etat.shop.name}</span>
      </header>
      {tiroir ? <div className="esp-voile" onClick={() => setTiroir(false)} /> : null}

      <main className="esp-corps" key={cle}>
        {erreur ? <div className="esp-erreur esp-erreur--ligne">{erreur}</div> : null}
        {page === 'cal' ? (
          <CalendrierFranchiseView
            onPublier={(query) => aller('pub', query ?? '')}
            onCommentaires={() => aller('com')}
            onGoogle={() => aller('google')}
            onOperations={() => aller('camp')}
          />
        ) : null}
        {page === 'pub' ? <PublierView onCalendrier={(query) => aller('cal', query)} /> : null}
        {page === 'com' ? <CommentairesView /> : null}
        {page === 'msg' ? <MessagesView /> : null}
        {page === 'google' ? <GoogleFranchiseView /> : null}
        {page === 'camp' ? <OperationsView onNaviguer={(pg, query) => aller(pg, query)} /> : null}
        {page === 'ig' ? <InstagramView onNaviguer={(pg, query) => aller(pg, query)} /> : null}
      </main>
    </div>
  )
}
