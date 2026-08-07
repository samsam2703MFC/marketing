-- =============================================================================
-- 006 — Fidélité & CRM client
--
-- ⚠️ Module marqué « À développer » dans la maquette. La structure ci-dessous
-- reprend le cadrage du DATA_MODEL et reste à valider avant spécification
-- détaillée — d'où l'absence volontaire de contraintes métier fines.
-- =============================================================================

-- Client unifié cross-canal (PWA fidélité, POS, web shop).
-- `external_customer_id` référence le client côté SI, sans le dupliquer.
CREATE TABLE mar_crm_customer (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_customer_id VARCHAR(80)         NULL,
  brand_id             BIGINT UNSIGNED NOT NULL,
  home_shop_id         BIGINT UNSIGNED     NULL,
  email                VARCHAR(190)        NULL,
  phone                VARCHAR(40)         NULL,
  opt_in_marketing     TINYINT(1)      NOT NULL DEFAULT 0,
  first_order_at       DATETIME            NULL,
  last_order_at        DATETIME            NULL,
  orders_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  total_spent_amount   DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by           BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_crm_customer_ext (brand_id, external_customer_id),
  KEY ix_mar_crm_customer_shop (home_shop_id),
  KEY ix_mar_crm_customer_email (email),
  CONSTRAINT fk_mar_cc_brand FOREIGN KEY (brand_id)     REFERENCES mar_brand (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_cc_shop  FOREIGN KEY (home_shop_id) REFERENCES mar_shop (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Segments RFM (nouveaux, réguliers, VIP, dormants…).
-- `rule_json` porte la règle de calcul, éditable sans migration.
CREATE TABLE mar_crm_segment (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  label      VARCHAR(120)    NOT NULL,
  color_hex  CHAR(7)         NOT NULL DEFAULT '#8A847C',
  rule_json  JSON                NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_crm_segment_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Appartenance calculée, recalculée périodiquement.
CREATE TABLE mar_crm_customer_segment (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  segment_id  BIGINT UNSIGNED NOT NULL,
  computed_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_crm_cs (customer_id, segment_id),
  KEY ix_mar_crm_cs_segment (segment_id),
  CONSTRAINT fk_mar_ccs_customer FOREIGN KEY (customer_id) REFERENCES mar_crm_customer (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ccs_segment  FOREIGN KEY (segment_id)  REFERENCES mar_crm_segment (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ciblage d'une campagne sur des segments.
CREATE TABLE mar_crm_campaign_target (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  segment_id  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_crm_ct (campaign_id, segment_id),
  KEY ix_mar_crm_ct_segment (segment_id),
  CONSTRAINT fk_mar_cct_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)    ON DELETE CASCADE,
  CONSTRAINT fk_mar_cct_segment  FOREIGN KEY (segment_id)  REFERENCES mar_crm_segment (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
