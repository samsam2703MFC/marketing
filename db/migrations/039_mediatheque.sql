-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 039 — La médiathèque commune du marketing
--
-- Une seule réserve de photos et de vidéos pour tout le marketing : les posts
-- et les publicités du module Social, les visuels de campagne, les brochures,
-- les bâches et les affiches. Jusqu'ici, la médiathèque de « Créer un post »
-- vivait dans le navigateur (IndexedDB) : chaque poste avait la sienne, une
-- photo déposée à Halle n'existait pas à Gosselies, et un navigateur vidé la
-- perdait.
--
-- Le fichier est gardé tel qu'il arrive (une bâche de 3 m a besoin de
-- l'original) ; une vignette de 480 px sert aux grilles, une version web de
-- 2 048 px aux posts (un post n'envoie pas l'original d'une bâche). Un même fichier
-- déposé deux fois n'est gardé qu'une fois (empreinte SHA-256).
--
-- Les catégories et les saisons reprennent celles de la médiathèque de Social,
-- pour que les deux modules classent de la même façon. Les libellés vivent en
-- table de référence, pas en enum SQL (règle du DATA_MODEL).
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_media_category (
  code        VARCHAR(40)  NOT NULL,
  label       VARCHAR(80)  NOT NULL,
  parent_code VARCHAR(40)      NULL COMMENT 'Nul pour une catégorie, renseigné pour une sous-catégorie',
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code),
  KEY ix_mar_media_category_parent (parent_code, sort_order),
  CONSTRAINT fk_mar_media_category_parent FOREIGN KEY (parent_code) REFERENCES mar_media_category (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_media_season (
  code       VARCHAR(40) NOT NULL,
  label      VARCHAR(80) NOT NULL,
  sort_order SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_media (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind             VARCHAR(10)     NOT NULL COMMENT 'image | video',
  file_path        VARCHAR(500)    NOT NULL COMMENT 'Chemin relatif sous le dossier public des envois',
  thumb_path       VARCHAR(500)        NULL COMMENT 'Vignette 480 px (image) ou image de couverture (vidéo)',
  web_path         VARCHAR(500)        NULL COMMENT 'Version web 2 048 px, quand l''original est plus grand ou plus lourd',
  mime             VARCHAR(60)     NOT NULL,
  bytes            INT UNSIGNED    NOT NULL,
  width            INT UNSIGNED        NULL,
  height           INT UNSIGNED        NULL,
  sha256           CHAR(64)        NOT NULL COMMENT 'Empreinte du fichier : un même fichier n''est gardé qu''une fois',
  name             VARCHAR(200)    NOT NULL,
  category_code    VARCHAR(40)         NULL,
  subcategory_code VARCHAR(40)         NULL,
  season_code      VARCHAR(40)         NULL,
  offer_item_id    BIGINT UNSIGNED     NULL COMMENT 'Le produit du catalogue que la photo montre',
  shop_id          BIGINT UNSIGNED     NULL COMMENT 'La boutique que la photo montre (vitrine, équipe) ; nul = réseau',
  cutout           TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = fond transparent (photo détourée)',
  source           VARCHAR(20)     NOT NULL DEFAULT 'marketing' COMMENT 'marketing | social — le module qui l''a déposée',
  created_by       BIGINT UNSIGNED     NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at      DATETIME            NULL COMMENT 'Retirée de la médiathèque ; le fichier reste servi pour ce qui l''utilise déjà',
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_media_sha256 (sha256),
  KEY ix_mar_media_list (archived_at, created_at),
  KEY ix_mar_media_category (category_code, subcategory_code),
  KEY ix_mar_media_season (season_code),
  KEY ix_mar_media_item (offer_item_id),
  KEY ix_mar_media_shop (shop_id),
  CONSTRAINT fk_mar_media_category    FOREIGN KEY (category_code)    REFERENCES mar_media_category (code) ON DELETE SET NULL,
  CONSTRAINT fk_mar_media_subcategory FOREIGN KEY (subcategory_code) REFERENCES mar_media_category (code) ON DELETE SET NULL,
  CONSTRAINT fk_mar_media_season      FOREIGN KEY (season_code)      REFERENCES mar_media_season (code)   ON DELETE SET NULL,
  CONSTRAINT fk_mar_media_item        FOREIGN KEY (offer_item_id)    REFERENCES mar_offer_item (id)       ON DELETE SET NULL,
  CONSTRAINT fk_mar_media_shop        FOREIGN KEY (shop_id)          REFERENCES mar_shop (id)             ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catégories de la médiathèque de Social (SA Post, Posts Facebook), à l'identique.
INSERT IGNORE INTO mar_media_category (code, label, parent_code, sort_order) VALUES
  ('viennoiseries',      'Viennoiseries',        NULL, 1),
  ('pains',              'Pains',                NULL, 2),
  ('patisseries',        'Pâtisseries',          NULL, 3),
  ('tartes',             'Tartes',               NULL, 4),
  ('sandwichs-sales',    'Sandwichs & salés',    NULL, 5),
  ('boissons',           'Boissons',             NULL, 6),
  ('ambiance-boutique',  'Ambiance & boutique',  NULL, 7),
  ('illustrations',      'Illustrations',        NULL, 8);

INSERT IGNORE INTO mar_media_category (code, label, parent_code, sort_order) VALUES
  ('croissants',          'Croissants',          'viennoiseries', 1),
  ('pains-au-chocolat',   'Pains au chocolat',   'viennoiseries', 2),
  ('brioches',            'Brioches',            'viennoiseries', 3),
  ('chaussons',           'Chaussons',           'viennoiseries', 4),
  ('baguettes',           'Baguettes',           'pains', 1),
  ('pains-speciaux',      'Pains spéciaux',      'pains', 2),
  ('pains-de-mie',        'Pains de mie',        'pains', 3),
  ('petits-pains',        'Petits pains',        'pains', 4),
  ('gateaux',             'Gâteaux',             'patisseries', 1),
  ('entremets',           'Entremets',           'patisseries', 2),
  ('cupcakes',            'Cupcakes',            'patisseries', 3),
  ('biscuits-cookies',    'Biscuits & cookies',  'patisseries', 4),
  ('tartes-sucrees',      'Tartes sucrées',      'tartes', 1),
  ('tartes-salees',       'Tartes salées',       'tartes', 2),
  ('quiches',             'Quiches',             'tartes', 3),
  ('sandwichs',           'Sandwichs',           'sandwichs-sales', 1),
  ('salades',             'Salades',             'sandwichs-sales', 2),
  ('plateaux',            'Plateaux',            'sandwichs-sales', 3),
  ('boissons-chaudes',    'Chaudes',             'boissons', 1),
  ('boissons-froides',    'Froides',             'boissons', 2),
  ('limonades',           'Limonades',           'boissons', 3),
  ('vitrine',             'Vitrine',             'ambiance-boutique', 1),
  ('equipe',              'Équipe',              'ambiance-boutique', 2),
  ('atelier',             'Atelier',             'ambiance-boutique', 3),
  ('illus-produits',      'Produits',            'illustrations', 1),
  ('illus-fruits',        'Fruits',              'illustrations', 2),
  ('illus-legumes',       'Légumes',             'illustrations', 3),
  ('illus-saisonnier',    'Saisonnier',          'illustrations', 4),
  ('illus-pictos',        'Pictos',              'illustrations', 5),
  ('illus-services',      'Services',            'illustrations', 6),
  ('illus-decoratif',     'Décoratif',           'illustrations', 7);

-- Saisons de la médiathèque de Social, dans son ordre.
INSERT IGNORE INTO mar_media_season (code, label, sort_order) VALUES
  ('toute-annee',    'Toute l''année',     1),
  ('printemps',      'Printemps',          2),
  ('ete',            'Été',                3),
  ('automne',        'Automne',            4),
  ('hiver',          'Hiver',              5),
  ('noel',           'Noël & Nouvel An',   6),
  ('epiphanie',      'Épiphanie',          7),
  ('saint-valentin', 'Saint-Valentin',     8),
  ('paques',         'Pâques',             9),
  ('fete-des-meres', 'Fête des mères',     10),
  ('saint-nicolas',  'Saint-Nicolas',      11);
