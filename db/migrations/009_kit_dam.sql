-- =============================================================================
-- 009 — Kit local & DAM
-- Campagnes clé-en-main pré-validées, activables par un franchisé non marketeur.
-- =============================================================================

CREATE TABLE mar_kit (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id              BIGINT UNSIGNED NOT NULL,
  campaign_type_id      BIGINT UNSIGNED     NULL,
  name                  VARCHAR(200)    NOT NULL,
  description           TEXT                NULL,
  default_budget_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  is_published          TINYINT(1)      NOT NULL DEFAULT 0,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by            BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_kit_brand (brand_id, is_published),
  KEY ix_mar_kit_type (campaign_type_id),
  CONSTRAINT fk_mar_kit_brand FOREIGN KEY (brand_id)         REFERENCES mar_brand (id)         ON DELETE CASCADE,
  CONSTRAINT fk_mar_kit_type  FOREIGN KEY (campaign_type_id) REFERENCES mar_campaign_type (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fichiers du kit : visuels, PLV, textes, posts.
CREATE TABLE mar_kit_asset (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kit_id     BIGINT UNSIGNED NOT NULL,
  format_id  BIGINT UNSIGNED     NULL,
  file_url   VARCHAR(500)    NOT NULL,
  label      VARCHAR(200)        NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_kit_asset_kit (kit_id),
  KEY ix_mar_kit_asset_format (format_id),
  CONSTRAINT fk_mar_ka_kit    FOREIGN KEY (kit_id)    REFERENCES mar_kit (id)    ON DELETE CASCADE,
  CONSTRAINT fk_mar_ka_format FOREIGN KEY (format_id) REFERENCES mar_format (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activation d'un kit par une boutique : crée la campagne locale correspondante.
CREATE TABLE mar_kit_activation (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kit_id       BIGINT UNSIGNED NOT NULL,
  shop_id      BIGINT UNSIGNED NOT NULL,
  campaign_id  BIGINT UNSIGNED     NULL,
  activated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_ka_shop (shop_id),
  KEY ix_mar_kact_kit (kit_id),
  KEY ix_mar_kact_campaign (campaign_id),
  CONSTRAINT fk_mar_kact_kit      FOREIGN KEY (kit_id)      REFERENCES mar_kit (id)      ON DELETE CASCADE,
  CONSTRAINT fk_mar_kact_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)     ON DELETE CASCADE,
  CONSTRAINT fk_mar_kact_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
