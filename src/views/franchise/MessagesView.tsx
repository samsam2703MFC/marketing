import { useCallback, useEffect, useRef, useState } from 'react'
import '../social/social.css'
import './messages.css'
import { dateHeure, messageConversation, messageRepondre, messages, messageTraiter, texteErreur, useFranchise } from './_donnees'
import type { Boite, FilConversation } from './_donnees'

/**
 * Messages privés — la page « Messages » de l'espace franchisé (social/franchisee/Messages.dc.html), réécrite dans le
 * Marketing. Les conversations Instagram que le réseau confie à la boutique (api/social/src/messages.php) : quand un client
 * cite la boutique, la conversation lui est confiée automatiquement. Elle y répond (depuis l'Instagram du réseau, dans
 * les 24 h que Meta autorise) ou la marque traitée.
 *
 * Adresse : `?c=<id>` ouvre une conversation.
 */

export default function MessagesView() {
  const { etat, erreur } = useFranchise()
  const [boite, setBoite] = useState<Boite | null>(null)
  const [err, setErr] = useState('')
  const [selId, setSelId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('c'))
  const [conv, setConv] = useState<FilConversation | null>(null)
  const [reponse, setReponse] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [cErr, setCErr] = useState('')
  const [toast, setToast] = useState('')
  const minuterie = useRef<number | undefined>(undefined)
  const fil = useRef<HTMLDivElement>(null)

  const dire = (m: string) => {
    window.clearTimeout(minuterie.current)
    setToast(m)
    minuterie.current = window.setTimeout(() => setToast(''), 3600)
  }
  useEffect(() => () => window.clearTimeout(minuterie.current), [])

  const charger = useCallback(() => {
    messages()
      .then((b) => {
        setBoite(b)
        setErr('')
      })
      .catch((e: unknown) => {
        setBoite((b) => b ?? { conversations: [] })
        setErr(texteErreur(e))
      })
  }, [])
  const ouvert = useRef(selId)
  const ouvrir = useCallback((id: string) => {
    if (ouvert.current !== id) setReponse('')
    ouvert.current = id
    setSelId(id)
    setCErr('')
    messageConversation(id)
      .then((c) => setConv(c))
      .catch((e: unknown) => setCErr(texteErreur(e)))
  }, [])

  const pret = !!etat
  const depart = useRef(selId)
  useEffect(() => {
    if (!pret) return
    charger()
    if (depart.current) ouvrir(depart.current)
  }, [pret, charger, ouvrir])
  useEffect(() => {
    if (fil.current) fil.current.scrollTop = fil.current.scrollHeight
  }, [conv])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const quand = (t?: string | null) => (!t ? '' : t.slice(0, 10) === etat.today ? t.slice(11, 16) : dateHeure(t.slice(0, 10)))
  const peut = !!boite && boite.peutRepondre !== false
  const masque = !!boite?.masque || etat.rules?.voirMessages === false
  const convs = boite?.conversations ?? []
  const cv = conv && conv.conversation && conv.conversation.id === selId ? conv : null
  const c = selId ? (cv?.conversation ?? convs.find((x) => x.id === selId) ?? { id: selId, client: '…' }) : null

  const apres = (fc: FilConversation, m?: string) => {
    setConv(fc)
    setEnvoi(false)
    setCErr('')
    if (m) dire(m)
    charger()
  }
  const envoyer = () => {
    if (envoi || !reponse.trim() || !selId) return
    setEnvoi(true)
    setCErr('')
    messageRepondre(selId, reponse.trim())
      .then((fc) => {
        setReponse('')
        apres(fc, 'Réponse envoyée sur Instagram.')
      })
      .catch((e: unknown) => {
        setEnvoi(false)
        setCErr(texteErreur(e))
      })
  }
  const traiter = () => {
    const x = cv?.conversation
    if (!x) return
    messageTraiter(x.id, !!x.aRepondre)
      .then((fc) => apres(fc, x.aRepondre ? 'Conversation marquée traitée.' : 'Conversation rouverte.'))
      .catch((e: unknown) => setCErr(texteErreur(e)))
  }

  const note = !c?.attribue
    ? ''
    : c.attribuePar === 'Automatique'
      ? c.note || 'Confiée automatiquement : le client cite votre boutique.'
      : `Confiée par ${c.attribuePar || 'le réseau'}${c.note ? ` : « ${c.note} »` : ''}.`

  return (
    <div className="social-native fmsg">
      <div className="filters">
        <div className="filters__row">
          <span
            className="muted social-native__periode"
            title={`Quand un client écrit sur Instagram en citant votre boutique (une commande, un retrait, vos horaires…), la conversation vous est confiée automatiquement. ${
              peut ? 'Vous y répondez ici : la réponse part de l’Instagram du réseau, signée de votre nom dans l’outil.' : 'Le réseau y répond lui-même.'
            }`}
          >
            {`Messages privés Instagram de L’Atelier By ${etat.shop.name}`}
          </span>
        </div>
      </div>

      {err ? <p className="error">{`Les messages n’ont pas pu être lus : ${err}`}</p> : null}
      {masque ? <div className="card fmsg__vide">Le réseau ne partage pas les messages privés dans l’espace boutique.</div> : null}

      {!masque ? (
        <div className={`fmsg__corps${selId ? ' is-sel' : ''}`}>
          <section className="card fmsg__liste">
            {!boite ? <div className="fmsg__info">Lecture des conversations…</div> : null}
            {boite && !convs.length ? <div className="fmsg__info">Aucun message privé pour votre boutique ces 30 derniers jours.</div> : null}
            {convs.map((x) => (
              <button key={x.id} type="button" className={`fmsg__conv${x.id === selId ? ' is-on' : ''}`} onClick={() => ouvrir(x.id)}>
                <span className="fmsg__ini">{String(x.client || '?').replace(/^[^a-z0-9]+/i, '').slice(0, 1).toUpperCase() || '?'}</span>
                <span className="fmsg__conv-corps">
                  <span className="fmsg__conv-tete">
                    <span className="fmsg__client">{x.client}</span>
                    <span className="muted fmsg__quand">{quand(x.dernierLe)}</span>
                  </span>
                  <span className="fmsg__apercu">{(x.dernierSens === 'out' ? 'Réponse : ' : '') + (x.dernierTexte || '')}</span>
                  {x.aRepondre ? (
                    <span className={`fmsg__arep${x.fenetre ? ' is-ouvert' : ''}`}>{x.fenetre ? 'À répondre' : 'À répondre · plus de 24 h'}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </section>

          <section className="card fmsg__fil">
            {!c ? <div className="fmsg__info fmsg__info--centre">Aucune conversation ouverte.</div> : null}
            {c ? (
              <>
                <div className="fmsg__fil-tete">
                  <div className="fmsg__fil-nom">
                    <button type="button" className="btn btn--sm fmsg__retour" onClick={() => {
                        ouvert.current = null
                        setSelId(null)
                      }}
                      aria-label="Retour aux conversations">
                      ←
                    </button>
                    <span className="fmsg__fil-titre">
                      <span>{c.client}</span>
                      <span className="muted">
                        {'Instagram du réseau' + (c.dernierLe ? ` · dernier message ${quand(c.dernierLe)}` : '') + (c.reponduPar ? ` · répondu par ${c.reponduPar}` : '')}
                      </span>
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={traiter} disabled={!cv}>
                    {c.aRepondre ? 'Marquer traitée' : 'Rouvrir'}
                  </button>
                </div>
                {note ? <div className="fmsg__note">{note}</div> : null}
                <div className="fmsg__messages" ref={fil}>
                  {(cv?.messages ?? []).map((m) => (
                    <div key={m.id} className={`fmsg__bulle-bloc${m.sens === 'out' ? ' is-out' : ''}`}>
                      <div className="fmsg__bulle">{m.texte}</div>
                      {(m.pieces ?? []).map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="fmsg__piece">
                          {p.type === 'video' ? 'Vidéo ↗' : p.type === 'image' ? 'Photo ↗' : 'Pièce jointe ↗'}
                        </a>
                      ))}
                      <span className="muted fmsg__meta">{quand(m.le) + (m.sens === 'out' && m.par ? ` · ${m.par}` : '')}</span>
                    </div>
                  ))}
                </div>
                <div className="fmsg__pied">
                  {peut && !c.fenetre && cv ? (
                    <span className="fmsg__ferme">
                      Plus de 24 h depuis le dernier message du client : Meta n’autorise plus la réponse d’ici. Prévenez le réseau, il répondra depuis l’application Instagram.
                    </span>
                  ) : null}
                  {peut && c.fenetre ? (
                    <>
                      <textarea
                        className="fmsg__reponse"
                        rows={3}
                        value={reponse}
                        placeholder="Votre réponse (envoyée depuis l’Instagram du réseau)"
                        onChange={(e) => setReponse(e.target.value)}
                      />
                      <div className="fmsg__envoi">
                        <span className="muted fmsg__fenetre">
                          {c.fenetreFin ? `Possible jusqu’au ${dateHeure(c.fenetreFin).replace(' ', ' à ')}.` : 'Possible 24 h après son dernier message.'}
                        </span>
                        <button type="button" className={`btn btn--primary${envoi ? ' is-busy' : ''}`} onClick={envoyer} disabled={!reponse.trim()}>
                          {envoi ? 'Envoi…' : 'Envoyer'}
                        </button>
                      </div>
                    </>
                  ) : null}
                  {!peut ? <span className="muted fmsg__fenetre">Le réseau répond lui-même à ces messages : vous les voyez pour être au courant.</span> : null}
                  {cErr ? <span className="error fmsg__err">{cErr}</span> : null}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {toast ? <div className="fmsg__toast">{toast}</div> : null}
    </div>
  )
}
