-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 038 — Les brochures d'une campagne : leaflet A5, dépliant A4 3 volets
--
-- Le générateur compose un imprimé à partir du dossier d'impression de la
-- campagne (offre, produits, prix, conditions, palette) : rien de tout cela
-- n'est recopié ici. Ce qui s'y ajoute appartient à la brochure seule et
-- doit survivre à la session de celui qui l'a préparée : le modèle choisi,
-- les textes en français et en néerlandais, l'ordre et le choix des produits,
-- un prix saisi quand le catalogue n'en a pas de fiable, la destination du
-- QR code, les boutiques écartées.
--
-- Un réglage par campagne et par format : le leaflet et le dépliant n'ont ni
-- les mêmes textes ni toujours le même modèle. Les réglages sont un document
-- JSON validé par l'API (liste blanche des clés, longueurs bornées) : ce sont
-- des choix de mise en page, pas des données que d'autres écrans interrogent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_campaign_brochure (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  format      VARCHAR(20)     NOT NULL COMMENT 'leaflet-a5 | depliant-a4',
  settings    JSON            NOT NULL COMMENT 'Modèle, textes FR/NL, produits, QR code, boutiques écartées',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_brochure (campaign_id, format),
  CONSTRAINT fk_mar_cb_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
