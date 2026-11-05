SET NAMES utf8mb4;

-- =============================================================================
-- 044 — Les bons d'une campagne vivent dans TFBuddy (05/11/2026 : « le webshop
-- doit venir de TFBuddy » ; un bon TFBuddy vaut en caisse et au webshop).
--
-- Un bon = une campagne de bons de l'ERP (/admin/voucher-campaigns : un code
-- pour tous, ou des codes uniques) rattachée à UNE promotion de l'ERP en mode
-- « bon seulement » (VOUCHER_ONLY), créée depuis une ligne de l'étape Prix.
-- L'ERP garde le bon, ses codes et ses utilisations ; le module ne garde que le
-- lien avec sa campagne (l'ERP n'a pas de champ pour elle) et de quoi le
-- retrouver. Les anciens bons du moteur du webshop restent lisibles, plus
-- modifiables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_campaign_erp_voucher (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id             BIGINT UNSIGNED NOT NULL,
  offer_item_id           BIGINT UNSIGNED     NULL COMMENT 'La ligne de l''étape Prix dont vient la remise',
  erp_voucher_campaign_id BIGINT UNSIGNED NOT NULL COMMENT 'Campagne de bons de l''ERP',
  erp_promotion_id        BIGINT UNSIGNED     NULL COMMENT 'Promotion de l''ERP en mode VOUCHER_ONLY',
  promotion_family        VARCHAR(30)     NOT NULL COMMENT 'scheduled-product-discount | buy-x-get-y',
  name                    VARCHAR(160)    NOT NULL,
  code_type               VARCHAR(10)     NOT NULL COMMENT 'SHARED | UNIQUE',
  shared_code             VARCHAR(40)         NULL,
  codes_requested         INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by              BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_cev_erp (erp_voucher_campaign_id),
  KEY ix_mar_cev_campaign (campaign_id),
  CONSTRAINT fk_mar_cev_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
