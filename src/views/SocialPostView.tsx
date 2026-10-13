interface SocialPostProps {
  /**
   * Campagne à présélectionner comme « Opération liée » du post. Le module
   * Social lit les campagnes de ce module par l'API : l'opération `bo-19` est
   * la campagne 19 d'ici.
   */
  campaignId: number | null
}

/**
 * « Créer un post » du module Social & Ads, affiché dans un cadre.
 *
 * L'écran n'est pas recopié : il vit dans /social, qui détient les Pages, le
 * token Meta, la médiathèque et le calendrier des posts. Le paramètre `embed=1`
 * lui retire son propre menu, et chaque lien qu'on y suit le garde — on reste
 * dans le cadre jusqu'à ce qu'on l'ouvre en entier.
 */
export default function SocialPostView({ campaignId }: SocialPostProps) {
  const base = (import.meta.env.VITE_SOCIAL_BASE || '/social/').replace(/\/?$/, '/')
  const page = `${base}${encodeURIComponent('SA Post.dc.html')}`
  const op = campaignId !== null ? `op=${campaignId}` : ''

  return (
    <div className="social-frame">
      <div className="social-frame__bar">
        <span className="muted">
          Écran du module Social &amp; Ads
          {campaignId !== null ? ' — campagne présélectionnée comme opération liée' : ''}
        </span>
        <a href={op ? `${page}?${op}` : page} target="_blank" rel="noopener">
          Ouvrir dans le module Social &amp; Ads ↗
        </a>
      </div>
      <iframe
        className="social-frame__page"
        title="Créer un post — module Social & Ads"
        src={`${page}?embed=1${op ? `&${op}` : ''}`}
      />
    </div>
  )
}
