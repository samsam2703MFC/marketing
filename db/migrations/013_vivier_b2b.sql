-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 013 — Vivier de comptes B2B
--
-- « Générer les leads » suppose de savoir d'où ils viennent. Le schéma ne le
-- disait nulle part : `mar_b2b_sector.estimated_leads_count` est un chiffre de
-- cadrage — combien de comptes on pense pouvoir démarcher — et la maquette
-- affichait huit sociétés réelles codées en dur à titre d'illustration.
--
-- Aucun des deux n'est une source. Générer sans source reviendrait à inventer
-- des noms d'entreprises : des leads qui s'affichent, se comptent, alimentent
-- l'entonnoir et le ROI, et que personne ne pourra jamais appeler.
--
-- D'où ce vivier : des comptes réels, importés, que la génération distribue.
-- Tant qu'il est vide, la génération ne crée rien et le dit.
-- =============================================================================

CREATE TABLE mar_b2b_prospect (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id         BIGINT UNSIGNED NOT NULL,
  sector_id        BIGINT UNSIGNED     NULL,
  -- Référence d'origine : c'est elle qui rend l'import rejouable. Réimporter
  -- le même fichier met à jour les comptes au lieu de les dupliquer.
  external_ref     VARCHAR(120)        NULL,
  company_name     VARCHAR(200)    NOT NULL,
  contact_name     VARCHAR(160)        NULL,
  contact_email    VARCHAR(190)        NULL,
  contact_phone    VARCHAR(40)         NULL,
  size_label       VARCHAR(80)         NULL COMMENT 'Volumétrie estimée (« ~450 couverts/sem »)',
  potential_amount DECIMAL(12,2)       NULL,
  city             VARCHAR(120)        NULL,
  postal_code      VARCHAR(20)         NULL,
  -- Boutique référente si elle est connue à l'import ; sinon la génération
  -- répartit sur les boutiques de la campagne.
  shop_id          BIGINT UNSIGNED     NULL,
  source           VARCHAR(80)         NULL COMMENT 'Provenance du fichier ou du connecteur',
  is_active        TINYINT(1)      NOT NULL DEFAULT 1,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by       BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_b2b_prospect_ref (brand_id, external_ref),
  KEY ix_mar_b2b_prospect_sector (sector_id),
  KEY ix_mar_b2b_prospect_shop (shop_id),
  CONSTRAINT fk_mar_bp_brand  FOREIGN KEY (brand_id)  REFERENCES mar_brand (id)      ON DELETE CASCADE,
  CONSTRAINT fk_mar_bp_sector FOREIGN KEY (sector_id) REFERENCES mar_b2b_sector (id) ON DELETE SET NULL,
  CONSTRAINT fk_mar_bp_shop   FOREIGN KEY (shop_id)   REFERENCES mar_shop (id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le lead garde le compte dont il est issu.
--
-- Sans ce lien, relancer la génération recréerait les mêmes sociétés : la
-- comparaison sur le nom serait fragile (« CHU Namur » / « C.H.U. de Namur »)
-- et le doublon ne se verrait qu'au moment où deux boutiques appellent la même
-- entreprise. L'unicité par campagne le rend impossible.
ALTER TABLE mar_crm_lead
  ADD COLUMN prospect_id BIGINT UNSIGNED NULL
    COMMENT 'Compte du vivier à l''origine du lead'
    AFTER sector_id,
  ADD UNIQUE KEY uq_mar_crm_lead_prospect (campaign_id, prospect_id),
  ADD CONSTRAINT fk_mar_cl_prospect
    FOREIGN KEY (prospect_id) REFERENCES mar_b2b_prospect (id) ON DELETE SET NULL;
