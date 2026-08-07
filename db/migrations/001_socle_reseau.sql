-- =============================================================================
-- 001 — Socle réseau : marques, boutiques, rattachements, leviers
-- Module marketing franchise — toutes les tables portent le préfixe `mar_`.
-- =============================================================================

-- Marques du groupe (L'Atelier By, L'Antica Roma, Capoue, Le Brazier).
CREATE TABLE mar_brand (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)     NOT NULL,
  name        VARCHAR(120)    NOT NULL,
  logo_url    VARCHAR(500)        NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by  BIGINT UNSIGNED     NULL COMMENT 'Utilisateur du SI hôte — pas de FK, la table users vit hors module',
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_brand_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Boutiques / points de vente.
-- `erp_shop_id` fait le lien avec la boutique côté ERP (TFBuddy) sans la dupliquer.
CREATE TABLE mar_shop (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id      BIGINT UNSIGNED NOT NULL,
  erp_shop_id   BIGINT UNSIGNED     NULL COMMENT 'Id de la boutique dans l''ERP — référence externe, pas de duplication',
  code          VARCHAR(40)     NOT NULL,
  name          VARCHAR(160)    NOT NULL,
  city          VARCHAR(120)        NULL,
  is_franchise  TINYINT(1)      NOT NULL DEFAULT 1,
  opened_at     DATE                NULL,
  gmb_place_id  VARCHAR(120)        NULL COMMENT 'Google Business Profile — sert la présence locale',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_shop_code (brand_id, code),
  KEY ix_mar_shop_brand (brand_id),
  KEY ix_mar_shop_erp (erp_shop_id),
  CONSTRAINT fk_mar_shop_brand FOREIGN KEY (brand_id) REFERENCES mar_brand (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rattachement utilisateur ↔ boutique. Porte le périmètre : un FRANCHISEE ne voit
-- que ses boutiques, un BRAND_ADMIN voit tout le réseau de sa marque.
CREATE TABLE mar_shop_user (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL COMMENT 'Utilisateur du SI hôte',
  shop_id     BIGINT UNSIGNED NOT NULL,
  role        VARCHAR(20)     NOT NULL COMMENT 'BRAND_ADMIN | FRANCHISEE | SHOP_STAFF',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_shop_user (user_id, shop_id),
  KEY ix_mar_shop_user_shop (shop_id),
  CONSTRAINT fk_mar_shop_user_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leviers business. Table de référence : les libellés et couleurs sont éditables
-- par le marketing, jamais codés en dur dans le front.
CREATE TABLE mar_lever (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)     NOT NULL COMMENT 'TRAFIC | RECUR | XP | FOOD | LABOUR | OVERHEAD | PANIER',
  label       VARCHAR(80)     NOT NULL,
  color_hex   CHAR(7)         NOT NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_lever_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
