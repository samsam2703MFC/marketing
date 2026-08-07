-- =============================================================================
-- 008 — Présence locale & e-réputation
--
-- ⚠️ Module marqué « À développer » dans la maquette : cadrage à valider.
-- =============================================================================

-- Fiche locale par boutique et par plateforme.
CREATE TABLE mar_shop_presence (
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

-- Avis collectés.
CREATE TABLE mar_review (
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

-- Modèles de réponse validés par la marque.
CREATE TABLE mar_review_template (
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

-- Réponses publiées.
CREATE TABLE mar_review_reply (
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
