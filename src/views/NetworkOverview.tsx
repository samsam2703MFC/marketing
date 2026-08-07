import { useEffect, useState } from 'react'
import { marketing, network } from '../lib/api'
import { describeError } from '../state/auth'
import type { MarketingCampaign, MarketingMaterial, Shop } from '../lib/api/types'

interface NetworkData {
  campaigns: MarketingCampaign[]
  materials: MarketingMaterial[]
  shops: Shop[]
}

/**
 * Vue Réseau : campagnes et supports en cours, cadrés par le parc de boutiques.
 * Les trois appels sont indépendants et lancés en parallèle.
 */
export default function NetworkOverview() {
  const [data, setData] = useState<NetworkData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([marketing.listCampaigns(), marketing.listMaterials(), network.listShops()])
      .then(([campaigns, materials, shops]) => {
        if (controller.signal.aborted) return
        setData({ campaigns, materials, shops })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(describeError(cause))
      })

    return () => controller.abort()
  }, [])

  if (error) return <p className="error">Chargement impossible : {error}</p>
  if (!data) return <p className="muted">Chargement des données ERP…</p>

  return (
    <div className="grid">
      <section className="card">
        <h2>Campagnes</h2>
        <p className="metric">{data.campaigns.length}</p>
        <ul>
          {data.campaigns.slice(0, 8).map((campaign) => (
            <li key={campaign.id}>
              {campaign.name}
              {campaign.date_from ? <span className="muted"> — dès {campaign.date_from}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Supports</h2>
        <p className="metric">{data.materials.length}</p>
        <ul>
          {data.materials.slice(0, 8).map((material) => (
            <li key={material.id}>{material.title}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Boutiques</h2>
        <p className="metric">{data.shops.length}</p>
        <ul>
          {data.shops.slice(0, 8).map((shop) => (
            <li key={shop.id}>
              {shop.name}
              {shop.city ? <span className="muted"> — {shop.city}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
