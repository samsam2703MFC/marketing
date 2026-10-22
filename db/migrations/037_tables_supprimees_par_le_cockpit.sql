-- Les tables du module supprimées par le « nettoyage marketing » du cockpit.
--
-- La base est partagée avec le cockpit (BO consultant). Le 27/08/2026, son
-- action « nettoyage du module marketing » a supprimé toutes les tables mar_
-- qu'il ne servait pas lui-même, à une époque où le module autonome était
-- tenu pour abandonné. Le registre, lui, les donnait toujours pour créées :
-- aucun déploiement ne les a refaites, et les routes qui les lisent
-- répondaient 500 en production — promotions, bundles, bons, CRM, présence
-- locale, kits, analyse et ROI.
--
-- Ce fichier les recrée telles que leurs migrations d'origine les
-- définissent (003, 004, 005, 006, 008, 009), à l'identique, sous
-- IF NOT EXISTS : sur une base où elles existent — toute base neuve, la CI —
-- il ne fait rien. Les données d'avant le 27/08 ne reviennent pas ; les
-- tables repartent vides, et les écrans affichent un état vide au lieu d'une
-- erreur.
--
-- La vue mar_v_roi_quarterly (010_vues) n'est créée que si mar_roi_cost
-- existe : 010 passant avant ce fichier, elle se crée au déploiement suivant.

-- mar_voucher_channel — d'après 003_offre_promotions.sql
-- Canaux d'un voucher : WS (web shop), POS (caisse), OFF (office), B2B.
CREATE TABLE IF NOT EXISTS mar_voucher_channel (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id   BIGINT UNSIGNED NOT NULL,
  channel_code VARCHAR(10)     NOT NULL COMMENT 'WS | POS | OFF | B2B',
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_voucher_channel (voucher_id, channel_code),
  CONSTRAINT fk_mar_vc_voucher FOREIGN KEY (voucher_id) REFERENCES mar_voucher (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_voucher_redemption — d'après 003_offre_promotions.sql
-- Utilisations. Le compteur « redemptions » de la maquette est un COUNT ici,
-- jamais une colonne dénormalisée : le détail sert aussi le ROI.
CREATE TABLE IF NOT EXISTS mar_voucher_redemption (
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

-- mar_promotion — d'après 003_offre_promotions.sql
-- Mécaniques promo.
CREATE TABLE IF NOT EXISTS mar_promotion (
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

-- mar_bundle — d'après 003_offre_promotions.sql
-- Menus / bundles.
CREATE TABLE IF NOT EXISTS mar_bundle (
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

-- mar_bundle_item — d'après 003_offre_promotions.sql
CREATE TABLE IF NOT EXISTS mar_bundle_item (
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

-- mar_consultant — d'après 004_diffusion_production.sql
-- Intervenants internes.
CREATE TABLE IF NOT EXISTS mar_consultant (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name   VARCHAR(160)    NOT NULL,
  position_id BIGINT UNSIGNED     NULL,
  email       VARCHAR(190)        NULL,
  user_id     BIGINT UNSIGNED     NULL COMMENT 'Utilisateur du SI hôte, si l''intervenant a un compte',
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_consultant_position (position_id),
  CONSTRAINT fk_mar_consultant_position FOREIGN KEY (position_id) REFERENCES mar_position (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_approval_request — d'après 004_diffusion_production.sql
-- Workflow de validation d'une campagne locale hors cadre marque.
CREATE TABLE IF NOT EXISTS mar_approval_request (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED     NULL,
  status       VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected',
  reason       TEXT                NULL,
  decided_by   BIGINT UNSIGNED     NULL,
  decided_at   DATETIME            NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_ar_campaign (campaign_id, status),
  CONSTRAINT fk_mar_approval_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_local_budget — d'après 005_fonds_royalties.sql
-- Budget local propre à une boutique (vue franchisé « Ma contribution »).
CREATE TABLE IF NOT EXISTS mar_local_budget (
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

-- mar_roi_cost — d'après 005_fonds_royalties.sql
-- Postes de coût d'une campagne, base du calcul de ROI.
CREATE TABLE IF NOT EXISTS mar_roi_cost (
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

-- mar_crm_customer — d'après 006_crm_client.sql
-- Client unifié cross-canal (PWA fidélité, POS, web shop).
-- `external_customer_id` référence le client côté SI, sans le dupliquer.
CREATE TABLE IF NOT EXISTS mar_crm_customer (
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

-- mar_crm_customer_segment — d'après 006_crm_client.sql
-- Appartenance calculée, recalculée périodiquement.
CREATE TABLE IF NOT EXISTS mar_crm_customer_segment (
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

-- mar_crm_campaign_target — d'après 006_crm_client.sql
-- Ciblage d'une campagne sur des segments.
CREATE TABLE IF NOT EXISTS mar_crm_campaign_target (
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

-- mar_shop_presence — d'après 008_presence_locale.sql
-- Fiche locale par boutique et par plateforme.
CREATE TABLE IF NOT EXISTS mar_shop_presence (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id          BIGINT UNSIGNED NOT NULL,
  platform         VARCHAR(20)     NOT NULL COMMENT 'GOOGLE | FACEBOOK | TRIPADVISOR',
  external_place_id VARCHAR(160)       NULL,
  rating_avg       DECIMAL(3,2)        NULL,
  reviews_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  completeness_pct DECIMAL(5,2)        NULL,
  last_synced_at   DATETIME            NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_shop_presence (shop_id, platform),
  CONSTRAINT fk_mar_sp_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_review — d'après 008_presence_locale.sql
-- Avis collectés.
CREATE TABLE IF NOT EXISTS mar_review (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_presence_id   BIGINT UNSIGNED NOT NULL,
  external_review_id VARCHAR(160)        NULL,
  author_name        VARCHAR(160)        NULL,
  rating             TINYINT UNSIGNED    NULL,
  body               TEXT                NULL,
  published_at       DATETIME            NULL,
  reply_status       VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT 'pending | answered | ignored',
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_review_ext (shop_presence_id, external_review_id),
  KEY ix_mar_review_status (reply_status, published_at),
  CONSTRAINT fk_mar_review_presence FOREIGN KEY (shop_presence_id) REFERENCES mar_shop_presence (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_review_template — d'après 008_presence_locale.sql
-- Modèles de réponse validés par la marque.
CREATE TABLE IF NOT EXISTS mar_review_template (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label      VARCHAR(160)    NOT NULL,
  body       TEXT            NOT NULL,
  min_rating TINYINT UNSIGNED NOT NULL DEFAULT 1,
  max_rating TINYINT UNSIGNED NOT NULL DEFAULT 5,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_review_reply — d'après 008_presence_locale.sql
-- Réponses publiées.
CREATE TABLE IF NOT EXISTS mar_review_reply (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id    BIGINT UNSIGNED NOT NULL,
  template_id  BIGINT UNSIGNED     NULL,
  body         TEXT            NOT NULL,
  published_at DATETIME            NULL,
  user_id      BIGINT UNSIGNED     NULL,
  is_template  TINYINT(1)      NOT NULL DEFAULT 0,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_review_reply_review (review_id),
  CONSTRAINT fk_mar_rr_review   FOREIGN KEY (review_id)   REFERENCES mar_review (id)          ON DELETE CASCADE,
  CONSTRAINT fk_mar_rr_template FOREIGN KEY (template_id) REFERENCES mar_review_template (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mar_kit — d'après 009_kit_dam.sql
CREATE TABLE IF NOT EXISTS mar_kit (
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

-- mar_kit_asset — d'après 009_kit_dam.sql
-- Fichiers du kit : visuels, PLV, textes, posts.
CREATE TABLE IF NOT EXISTS mar_kit_asset (
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

-- mar_kit_activation — d'après 009_kit_dam.sql
-- Activation d'un kit par une boutique : crée la campagne locale correspondante.
CREATE TABLE IF NOT EXISTS mar_kit_activation (
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
