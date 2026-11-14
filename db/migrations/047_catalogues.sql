-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 047 — Les catalogues produits (prix du webshop, gammes)
--
-- Un catalogue est un imprimé de plusieurs pages (A5, A4 en option) : une
-- couverture et une dernière page « commandez en ligne » fixées par la Charte
-- des catalogues de la marque (verrouillées), et des pages intérieures remplies
-- par catégorie du webshop, chacune dans l'une des trois mises en page.
--
-- Rien du catalogue du webshop n'est recopié ici : les produits, leurs photos
-- et leurs prix (prix du webshop de chaque boutique) se relisent dans TFBuddy
-- à chaque composition. Ce qui appartient au catalogue seul est gardé :
--   - qui le fait : la marque (`marque`) ou une boutique (`boutique`, shop_id) ;
--   - d'où partent ses produits : une gamme du webshop, une campagne du
--     Marketing, ou des produits choisis un par un ;
--   - ses réglages (JSON validé par l'API, liste blanche des clés) : langues,
--     boutiques des versions, produits cochés et leur ordre, pages intérieures
--     et leur mise en page.
--
-- Un catalogue d'une boutique (créé par le dashboard magasin, jeton de service)
-- ne porte que des produits que sa boutique vend, à ses prix : la contrainte
-- est appliquée par l'API, jamais par l'écran.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_catalogue (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title        VARCHAR(160)    NOT NULL,
  owner        VARCHAR(10)     NOT NULL COMMENT 'marque | boutique',
  shop_id      BIGINT UNSIGNED     NULL COMMENT 'mar_shop.id — la boutique d''un catalogue de franchisé',
  source_kind  VARCHAR(10)     NOT NULL COMMENT 'gamme | campagne | choix',
  source_ref   VARCHAR(40)         NULL COMMENT 'Identifiant de la gamme (TFBuddy) ou de la campagne (mar_campaign)',
  source_label VARCHAR(160)        NULL COMMENT 'Nom de la gamme ou de la campagne au moment du choix',
  format       VARCHAR(4)      NOT NULL DEFAULT 'A5' COMMENT 'A5 | A4',
  status       VARCHAR(12)     NOT NULL DEFAULT 'brouillon' COMMENT 'brouillon | pret | imprime',
  print_qty    INT UNSIGNED        NULL COMMENT 'Exemplaires imprimés, quand il l''est',
  settings     JSON            NOT NULL COMMENT 'Langues, boutiques des versions, produits, pages intérieures',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   BIGINT UNSIGNED     NULL,
  updated_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_catalogue_owner (owner, updated_at),
  KEY ix_mar_catalogue_shop (shop_id),
  CONSTRAINT fk_mar_catalogue_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les lectures de TFBuddy (catalogue du webshop d'une boutique, gammes,
-- coordonnées des boutiques), gardées quelques minutes : un catalogue de cinq
-- boutiques demande dix lectures de plusieurs centaines de produits, à chaque
-- aperçu. Un cache, pas une copie : une entrée périmée est relue.
CREATE TABLE IF NOT EXISTS mar_catalogue_cache (
  cle      VARCHAR(120) NOT NULL,
  payload  LONGTEXT     NOT NULL,
  read_at  DATETIME     NOT NULL,
  PRIMARY KEY (cle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
