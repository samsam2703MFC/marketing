import { useEffect, useState } from 'react'
import { module as api } from '../../lib/api'
import type { Kit } from '../../lib/api/module'
import KitReader from './KitReader'

/**
 * Le kit ouvert par le lien personnel d'une boutique (`?kit=…`), sur sa tablette :
 * sans session du module, en lecture seule.
 */
export default function KitPublic({ token }: { token: string }) {
  const [kit, setKit] = useState<Kit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    document.title = 'Kit campagne'
    api.getPublicKit(token)
      .then((data) => { setKit(data); document.title = `Kit · ${data.campaign.name}` })
      .catch(() => setError('Ce lien ne mène à aucun kit, ou il a expiré. Demandez un nouveau lien à la marque.'))
  }, [token])

  async function read() {
    setReading(true)
    try {
      const done = await api.markKitRead(token)
      setKit((current) => (current ? { ...current, readAt: done.readAt } : current))
    } catch {
      setError('La lecture n’a pas pu être enregistrée. Réessayez dans un instant.')
    } finally {
      setReading(false)
    }
  }

  if (error && !kit) return <div className="kit-public"><p className="kit-public__msg">{error}</p></div>
  if (!kit) return <div className="kit-public"><p className="kit-public__msg">Ouverture du kit…</p></div>
  return (
    <div className="kit-public">
      {error ? <p className="kit-public__err">{error}</p> : null}
      <KitReader kit={kit} onRead={read} reading={reading} />
    </div>
  )
}
