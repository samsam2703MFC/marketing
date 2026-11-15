-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 050 — Les assistants des catalogues (15/11/2026)
--
-- Client : « les deux, garde les 3 gabarits, code-le » (maquettes A1-A4 : assistant des pages de la
-- marque ; B1-B4 : assistant du franchisé, Vérifier · Imprimer · Diffuser, catalogue de la marque reçu).
--
-- 1. La charte des catalogues a un BROUILLON et des VERSIONS PUBLIÉES. Le brouillon reste où il était
--    (`mar_variable` « catalogues.charte ») ; « Publier pour tous les catalogues » en fait une version,
--    rangée ici. Le rendu des catalogues lit la dernière version publiée ; un catalogue marqué imprimé
--    garde la version avec laquelle il l'a été (`mar_catalogue.charter_version`,
--    `mar_catalogue_shop.charter_version`). Le contenu est gardé en texte (LONGTEXT), pas en colonne JSON :
--    MySQL 8 réordonnerait ses clés, et l'API le relit dans un ordre fixe de toute façon.
--    Compatibilité : la charte en place devient la version publiée n° 1 (une fois : seulement si aucune
--    version n'existe), et les catalogues déjà imprimés sont rattachés à elle.
--
-- 2. Ce qu'une boutique fait d'un catalogue (`mar_catalogue_shop`, une ligne par catalogue et boutique) :
--    un catalogue de la MARQUE préparé pour elle (ses boutiques des versions) arrive dans son dashboard
--    « Nouveau · de la marque » ; elle le prend tel quel (`pris`) ou l'adapte (`adapte` : une copie à elle,
--    `adapted_id`). Pour tout catalogue qu'elle a sous la main (le sien ou celui de la marque) : les points
--    de vérification déjà vus, et son impression (quantité, date, version de la charte figée).
--
-- 3. Le lien permanent du catalogue en ligne (QR, affiche) : un jeton signé par catalogue (et boutique pour
--    un catalogue de la marque), rangé ici pour pouvoir être révoqué (« Nouveau lien »). La page publique
--    suit la dernière version du catalogue.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_catalogue_charter_version (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_no   INT UNSIGNED    NOT NULL,
  content      LONGTEXT        NOT NULL COMMENT 'La charte publiée (JSON), relue dans un ordre de clés fixe par l''API',
  note         VARCHAR(200)        NULL,
  published_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_mar_catalogue_charter_version (version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE mar_catalogue
  ADD COLUMN charter_version INT UNSIGNED NULL COMMENT 'Version de la charte figée au « Marquer imprimé » (null : la dernière publiée)' AFTER print_qty;

-- La charte en place devient la version publiée n° 1.
INSERT INTO mar_catalogue_charter_version (version_no, content, note, published_at)
SELECT 1, v.value, 'Charte en place avant l''assistant (reprise)', v.updated_at
  FROM mar_variable v
 WHERE v.module = 'marketing' AND v.name = 'catalogues.charte' AND v.value IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM mar_catalogue_charter_version);

UPDATE mar_catalogue
   SET charter_version = 1
 WHERE status = 'imprime' AND charter_version IS NULL
   AND EXISTS (SELECT 1 FROM mar_catalogue_charter_version WHERE version_no = 1);

CREATE TABLE IF NOT EXISTS mar_catalogue_shop (
  catalogue_id    BIGINT UNSIGNED NOT NULL,
  shop_id         BIGINT UNSIGNED NOT NULL COMMENT 'mar_shop.id',
  reception       VARCHAR(10)         NULL COMMENT 'Catalogue de la marque : nouveau | pris | adapte (null : le sien)',
  adapted_id      BIGINT UNSIGNED     NULL COMMENT 'La copie de la boutique (« L''adapter à ma boutique »)',
  checks_seen     TEXT                NULL COMMENT 'Codes des points de vérification déjà vus (JSON, liste)',
  print_qty       INT UNSIGNED        NULL,
  printed_at      DATETIME            NULL,
  charter_version INT UNSIGNED        NULL COMMENT 'Version de la charte figée à l''impression',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (catalogue_id, shop_id),
  KEY ix_mar_catalogue_shop_shop (shop_id),
  CONSTRAINT fk_mar_catalogue_shop_catalogue FOREIGN KEY (catalogue_id) REFERENCES mar_catalogue (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_catalogue_shop_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_catalogue_link (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalogue_id BIGINT UNSIGNED NOT NULL,
  shop_id      BIGINT UNSIGNED     NULL COMMENT 'La boutique de la version (catalogue de la marque) ; null : la version du catalogue',
  nonce        CHAR(22)        NOT NULL COMMENT 'Aléa du jeton ; le jeton est signé par MAR_SESSION_SECRET',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   DATETIME            NULL,
  PRIMARY KEY (id),
  KEY ix_mar_catalogue_link (catalogue_id, shop_id, revoked_at),
  CONSTRAINT fk_mar_catalogue_link_catalogue FOREIGN KEY (catalogue_id) REFERENCES mar_catalogue (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_catalogue_link_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
