-- =============================================================================
-- 005 — Fonds marketing & royalties
-- =============================================================================

-- Taux de contribution par marque / boutique / période.
-- `shop_id` nul = taux par défaut de la marque.
CREATE TABLE mar_royalty_rate (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id   BIGINT UNSIGNED NOT NULL,
  shop_id    BIGINT UNSIGNED     NULL,
  rate_pct   DECIMAL(5,2)    NOT NULL,
  valid_from DATE            NOT NULL,
  valid_to   DATE                NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_rr_brand (brand_id, valid_from),
  KEY ix_mar_rr_shop (shop_id),
  CONSTRAINT fk_mar_rr_brand FOREIGN KEY (brand_id) REFERENCES mar_brand (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_rr_shop  FOREIGN KEY (shop_id)  REFERENCES mar_shop (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CA déclaré par boutique et par mois — assiette des royalties.
CREATE TABLE mar_shop_revenue (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id        BIGINT UNSIGNED NOT NULL,
  period_month   DATE            NOT NULL COMMENT 'Premier jour du mois concerné',
  revenue_amount DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_shop_revenue (shop_id, period_month),
  CONSTRAINT fk_mar_sr_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Grand livre unique du fonds marketing : entrées ET sorties dans la même table.
-- Le tableau « Budget et royalties par période » est une seule requête ici,
-- groupée par mois / trimestre / année.
CREATE TABLE mar_fund_movement (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  direction     CHAR(3)         NOT NULL COMMENT 'IN | OUT',
  shop_id       BIGINT UNSIGNED     NULL,
  campaign_id   BIGINT UNSIGNED     NULL COMMENT 'Non nul = la ligne porte le badge ⛓ et la couleur du levier',
  lever_id      BIGINT UNSIGNED     NULL,
  movement_date DATE            NOT NULL,
  label         VARCHAR(300)    NOT NULL,
  amount        DECIMAL(12,2)   NOT NULL,
  source        VARCHAR(30)     NOT NULL COMMENT 'ROYALTY | REMISE_FOURNISSEUR | AGENCE | PRODUCTION | MEDIA | AUTRE',
  supplier_name VARCHAR(160)        NULL,
  document_ref  VARCHAR(120)        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_fm_date (movement_date, direction),
  KEY ix_mar_fm_shop (shop_id),
  KEY ix_mar_fm_campaign (campaign_id),
  KEY ix_mar_fm_lever (lever_id),
  CONSTRAINT fk_mar_fm_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)     ON DELETE SET NULL,
  CONSTRAINT fk_mar_fm_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL,
  CONSTRAINT fk_mar_fm_lever    FOREIGN KEY (lever_id)    REFERENCES mar_lever (id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Budget local propre à une boutique (vue franchisé « Ma contribution »).
CREATE TABLE mar_local_budget (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id          BIGINT UNSIGNED NOT NULL,
  period_year      SMALLINT        NOT NULL,
  allocated_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  spent_amount     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by       BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_local_budget (shop_id, period_year),
  CONSTRAINT fk_mar_lb_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Postes de coût d'une campagne, base du calcul de ROI.
CREATE TABLE mar_roi_cost (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  label        VARCHAR(200)    NOT NULL,
  source_label VARCHAR(300)        NULL COMMENT 'D''où vient le chiffre — affiché tel quel dans l''écran ROI',
  amount       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  cost_kind    VARCHAR(20)     NOT NULL COMMENT 'AGENCE | PRODUCTION | MEDIA | MARGE_DILUEE',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_rc_campaign (campaign_id, cost_kind),
  CONSTRAINT fk_mar_rc_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
