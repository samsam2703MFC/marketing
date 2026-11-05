SET NAMES utf8mb4;

-- =============================================================================
-- 043 — Après la validation d'une campagne : son fil de production, le kit des
-- franchisés, et la prime de la marque pour le personnel (maquette validée le
-- 05/11/2026).
--
-- • mar_campaign_production : l'état de chaque section de la campagne (le
--   message, chaque support coché, les consignes, les tenues, la prime…), de
--   « à faire » à « validée ». Une section n'existe ici qu'une fois touchée :
--   sans ligne, elle est à faire.
-- • mar_campaign_production_shop : pour les supports propres à chaque boutique
--   (bâches, affiches), l'état du BAT boutique par boutique et le retour du
--   franchisé.
-- • mar_campaign_kit : chaque envoi du kit est une version, figée.
-- • mar_campaign_kit_shop : le kit d'une boutique dans une version (son contenu
--   figé, en JSON) et sa lecture.
-- • mar_campaign_kit_link : le lien personnel d'une boutique, stable d'une
--   version à l'autre. Le lien n'est pas gardé : il se recalcule (HMAC du
--   secret de session et d'un sel) ; la base ne garde que son empreinte, qui
--   sert à le retrouver. Changer le sel révoque le lien.
-- • mar_campaign : la prime du personnel (règle, montants, forme, date).
-- • mar_campaign_shop : l'effectif de vente de la boutique, saisi à la main
--   (l'ERP ne le donne pas).
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_campaign_production (
  campaign_id  BIGINT UNSIGNED NOT NULL,
  section      VARCHAR(30)     NOT NULL COMMENT 'message | code de mar_channel | consignes | tenues | vitrine | prime',
  status       VARCHAR(12)     NOT NULL DEFAULT 'todo' COMMENT 'todo | doing | ready | validated',
  note         VARCHAR(300)        NULL,
  validated_at DATETIME            NULL,
  validated_by BIGINT UNSIGNED     NULL,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (campaign_id, section),
  CONSTRAINT fk_mar_cprod_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_campaign_production_shop (
  campaign_id BIGINT UNSIGNED NOT NULL,
  section     VARCHAR(30)     NOT NULL,
  shop_id     BIGINT UNSIGNED NOT NULL,
  status      VARCHAR(12)     NOT NULL DEFAULT 'todo' COMMENT 'todo | sent | validated | redo',
  note        VARCHAR(300)        NULL COMMENT 'Retour du franchisé, ou consigne',
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (campaign_id, section, shop_id),
  KEY ix_mar_cprods_shop (shop_id),
  CONSTRAINT fk_mar_cprods_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_cprods_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_campaign_kit (
  campaign_id BIGINT UNSIGNED NOT NULL,
  version     SMALLINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (campaign_id, version),
  CONSTRAINT fk_mar_ckit_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_campaign_kit_shop (
  campaign_id BIGINT UNSIGNED   NOT NULL,
  version     SMALLINT UNSIGNED NOT NULL,
  shop_id     BIGINT UNSIGNED   NOT NULL,
  payload     LONGTEXT          NOT NULL COMMENT 'Le kit de la boutique, figé (JSON)',
  read_at     DATETIME              NULL,
  PRIMARY KEY (campaign_id, version, shop_id),
  KEY ix_mar_ckits_shop (shop_id),
  CONSTRAINT fk_mar_ckits_kit FOREIGN KEY (campaign_id, version) REFERENCES mar_campaign_kit (campaign_id, version) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ckits_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_campaign_kit_link (
  campaign_id BIGINT UNSIGNED NOT NULL,
  shop_id     BIGINT UNSIGNED NOT NULL,
  salt        CHAR(32)        NOT NULL,
  token_hash  CHAR(64)        NOT NULL COMMENT 'sha256 du lien, pour le retrouver',
  expires_on  DATE            NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, shop_id),
  UNIQUE KEY uq_mar_ckitl_token (token_hash),
  CONSTRAINT fk_mar_ckitl_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ckitl_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE mar_campaign
  ADD COLUMN staff_bonus_enabled       TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Une prime de la marque pour le personnel',
  ADD COLUMN staff_bonus_who           VARCHAR(10)       NULL COMMENT 'team | named',
  ADD COLUMN staff_bonus_rule          VARCHAR(12)       NULL COMMENT 'attainment | per_piece | ranking',
  ADD COLUMN staff_bonus_threshold_pct DECIMAL(5,2)      NULL COMMENT 'Seuil de l’objectif de la boutique (règle attainment / per_piece)',
  ADD COLUMN staff_bonus_amount        DECIMAL(10,2)     NULL COMMENT 'Par personne (attainment, ranking) ou par pièce (per_piece), en euros',
  ADD COLUMN staff_bonus_extra_pct     DECIMAL(5,2)      NULL COMMENT 'Palier supplémentaire, en % de l’objectif',
  ADD COLUMN staff_bonus_extra_amount  DECIMAL(10,2)     NULL COMMENT 'Ajouté par personne au palier',
  ADD COLUMN staff_bonus_cap_amount    DECIMAL(10,2)     NULL COMMENT 'Plafond par boutique',
  ADD COLUMN staff_bonus_form          VARCHAR(12)       NULL COMMENT 'voucher | gift_cheque | franchisee',
  ADD COLUMN staff_bonus_paid_on       DATE              NULL;

ALTER TABLE mar_campaign_shop
  ADD COLUMN staff_headcount SMALLINT UNSIGNED NULL COMMENT 'Équipe de vente de la boutique, pour la prime' AFTER target_pieces;
