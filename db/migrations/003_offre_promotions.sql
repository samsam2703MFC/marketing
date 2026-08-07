-- =============================================================================
-- 003 — Offre & mécaniques promotionnelles
-- Ordre de création contraint par les FK : voucher avant campaign_offer.
-- =============================================================================

-- Catalogue marketing unifié : produit, bundle, assortiment saison, promo, voucher.
-- `sku_ref` pointe le produit côté ERP sans le dupliquer.
CREATE TABLE mar_offer_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category      VARCHAR(20)     NOT NULL COMMENT 'produit | bundle | saison | promo | voucher',
  sku_ref       VARCHAR(80)         NULL COMMENT 'Référence produit ERP',
  name          VARCHAR(200)    NOT NULL,
  detail        VARCHAR(400)        NULL,
  price_amount  DECIMAL(12,2)       NULL,
  cost_amount   DECIMAL(12,2)       NULL,
  image_url     VARCHAR(500)        NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_offer_item_cat (category),
  KEY ix_mar_offer_item_sku (sku_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Templates d'offre réutilisables : menu complet, prix barré, 2+1, plateau B2B…
CREATE TABLE mar_offer_template (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)     NOT NULL,
  label       VARCHAR(120)    NOT NULL,
  description VARCHAR(400)        NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_offer_template_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_offer_template_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id   BIGINT UNSIGNED NOT NULL,
  offer_item_id BIGINT UNSIGNED NOT NULL,
  quantity      SMALLINT        NOT NULL DEFAULT 1,
  sort_order    SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_oti (template_id, offer_item_id),
  KEY ix_mar_oti_item (offer_item_id),
  CONSTRAINT fk_mar_oti_template FOREIGN KEY (template_id)   REFERENCES mar_offer_template (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_oti_item     FOREIGN KEY (offer_item_id) REFERENCES mar_offer_item (id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bons et codes.
CREATE TABLE mar_voucher (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id       BIGINT UNSIGNED     NULL,
  code              VARCHAR(60)     NOT NULL,
  mechanic_label    VARCHAR(200)        NULL,
  scope_label       VARCHAR(120)        NULL,
  usage_limit_label VARCHAR(80)         NULL,
  status            VARCHAR(20)     NOT NULL DEFAULT 'Actif',
  source            VARCHAR(40)         NULL COMMENT 'partner | office_referral | …',
  partner_name      VARCHAR(160)        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_voucher_code (code),
  KEY ix_mar_voucher_campaign (campaign_id),
  CONSTRAINT fk_mar_voucher_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canaux d'un voucher : WS (web shop), POS (caisse), OFF (office), B2B.
CREATE TABLE mar_voucher_channel (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id   BIGINT UNSIGNED NOT NULL,
  channel_code VARCHAR(10)     NOT NULL COMMENT 'WS | POS | OFF | B2B',
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_voucher_channel (voucher_id, channel_code),
  CONSTRAINT fk_mar_vc_voucher FOREIGN KEY (voucher_id) REFERENCES mar_voucher (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Utilisations. Le compteur « redemptions » de la maquette est un COUNT ici,
-- jamais une colonne dénormalisée : le détail sert aussi le ROI.
CREATE TABLE mar_voucher_redemption (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id      BIGINT UNSIGNED NOT NULL,
  shop_id         BIGINT UNSIGNED     NULL,
  customer_id     BIGINT UNSIGNED     NULL,
  order_ref       VARCHAR(80)         NULL,
  redeemed_at     DATETIME        NOT NULL,
  discount_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_vr_voucher (voucher_id, redeemed_at),
  KEY ix_mar_vr_shop (shop_id),
  CONSTRAINT fk_mar_vr_voucher FOREIGN KEY (voucher_id) REFERENCES mar_voucher (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_vr_shop    FOREIGN KEY (shop_id)    REFERENCES mar_shop (id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- L'offre concrète attachée à une campagne — c'est ce que lit le « visualiseur »
-- du suivi en direct.
CREATE TABLE mar_campaign_offer (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id     BIGINT UNSIGNED NOT NULL,
  template_id     BIGINT UNSIGNED     NULL,
  voucher_id      BIGINT UNSIGNED     NULL,
  lever_id        BIGINT UNSIGNED     NULL,
  title           VARCHAR(200)    NOT NULL,
  mechanic_text   VARCHAR(400)        NULL,
  price_label     VARCHAR(60)         NULL,
  discount_label  VARCHAR(60)         NULL,
  image_url       VARCHAR(500)        NULL,
  starts_on       DATE                NULL,
  ends_on         DATE                NULL,
  weekdays_mask   TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT 'Bitmask lundi=1 … dimanche=64 ; 127 = tous les jours',
  hour_from       TIME                NULL,
  hour_to         TIME                NULL,
  scope_label     VARCHAR(200)        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_co_campaign (campaign_id),
  CONSTRAINT fk_mar_co_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)       ON DELETE CASCADE,
  CONSTRAINT fk_mar_co_template FOREIGN KEY (template_id) REFERENCES mar_offer_template (id) ON DELETE SET NULL,
  CONSTRAINT fk_mar_co_voucher  FOREIGN KEY (voucher_id)  REFERENCES mar_voucher (id)        ON DELETE SET NULL,
  CONSTRAINT fk_mar_co_lever    FOREIGN KEY (lever_id)    REFERENCES mar_lever (id)          ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lignes du plateau / bundle affichées dans le visualiseur.
CREATE TABLE mar_campaign_offer_item (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_offer_id BIGINT UNSIGNED NOT NULL,
  offer_item_id     BIGINT UNSIGNED     NULL,
  label             VARCHAR(200)    NOT NULL,
  sort_order        SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_mar_coi_offer (campaign_offer_id),
  KEY ix_mar_coi_item (offer_item_id),
  CONSTRAINT fk_mar_coi_offer FOREIGN KEY (campaign_offer_id) REFERENCES mar_campaign_offer (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_coi_item  FOREIGN KEY (offer_item_id)     REFERENCES mar_offer_item (id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mécaniques promo.
CREATE TABLE mar_promotion (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id        BIGINT UNSIGNED     NULL,
  name               VARCHAR(200)    NOT NULL,
  mechanic_type      VARCHAR(30)     NOT NULL COMMENT 'PERCENT | BUNDLE_FIXED | BUY_X_GET_Y | CROSSED_PRICE | FREE_DELIVERY',
  value_label        VARCHAR(80)         NULL,
  scope_label        VARCHAR(160)        NULL,
  availability_label VARCHAR(160)        NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_promotion_campaign (campaign_id),
  CONSTRAINT fk_mar_promotion_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menus / bundles.
CREATE TABLE mar_bundle (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(200)    NOT NULL,
  price_amount DECIMAL(12,2)       NULL,
  margin_pct   DECIMAL(5,2)        NULL,
  image_url    VARCHAR(500)        NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_bundle_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bundle_id     BIGINT UNSIGNED NOT NULL,
  offer_item_id BIGINT UNSIGNED NOT NULL,
  quantity      SMALLINT        NOT NULL DEFAULT 1,
  sort_order    SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_bundle_item (bundle_id, offer_item_id),
  KEY ix_mar_bundle_item_item (offer_item_id),
  CONSTRAINT fk_mar_bi_bundle FOREIGN KEY (bundle_id)     REFERENCES mar_bundle (id)     ON DELETE CASCADE,
  CONSTRAINT fk_mar_bi_item   FOREIGN KEY (offer_item_id) REFERENCES mar_offer_item (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
