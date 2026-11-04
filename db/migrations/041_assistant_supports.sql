-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 041 — L'assistant de campagne réunit tous les supports (maquette validée le
-- 04/11/2026) : en boutique, extérieur, réseaux sociaux, Google, direct.
--
-- • mar_channel gagne sa famille dans l'assistant (`grp`), une description, le
--   fait d'être payant (un budget publicitaire à valider), son délai type avant
--   le lancement (le rétroplanning le reprend) et l'écran qui le produit. Les
--   huit canaux existants gardent leur code et leur famille PHYSIQUE / DIGITAL
--   (Pub physique, Pub digitale les lisent) ; trois sont renommés comme dans la
--   maquette, sans changer de sens.
-- • mar_campaign_channel porte la quantité et les précisions de chaque support.
-- • mar_campaign_message : le message de la campagne, un par langue, que les
--   supports déclinent.
-- • mar_shop_support : les bâches et les cadres d'affiche de chaque boutique,
--   déclarés une fois, repris par chaque campagne.
-- =============================================================================

ALTER TABLE mar_channel
  ADD COLUMN grp         VARCHAR(20)  NULL COMMENT 'boutique | exterieur | social | google | direct' AFTER family,
  ADD COLUMN description VARCHAR(200) NULL AFTER grp,
  ADD COLUMN is_paid     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = budget publicitaire, à valider avant engagement' AFTER description,
  ADD COLUMN lead_days   SMALLINT     NULL COMMENT 'Délai type avant le lancement, en jours' AFTER is_paid,
  ADD COLUMN editor      VARCHAR(40)  NULL COMMENT 'Écran du module qui produit le support' AFTER lead_days;

-- Le rangement des canaux existants et les onze nouveaux supports sont des données
-- de référence : ils vivent dans db/seeds/006_supports_assistant.sql, appliqué après
-- les seeds qui créent les canaux (sur une base neuve, ils n'existent pas encore ici).

ALTER TABLE mar_campaign_channel
  ADD COLUMN quantity INT UNSIGNED  NULL COMMENT 'Exemplaires, posts, envois…' AFTER budget_amount,
  ADD COLUMN details  VARCHAR(300) NULL COMMENT 'Formats, dates, consignes du support' AFTER quantity;

CREATE TABLE IF NOT EXISTS mar_campaign_message (
  campaign_id BIGINT UNSIGNED NOT NULL,
  lang        CHAR(2)         NOT NULL COMMENT 'fr | nl',
  title       VARCHAR(80)         NULL COMMENT 'Titre : 6 mots au plus, lu de loin sur une bâche',
  hook        VARCHAR(160)        NULL COMMENT 'Accroche',
  offer_line  VARCHAR(160)        NULL COMMENT 'L’offre telle qu’elle s’imprime',
  cta         VARCHAR(80)         NULL COMMENT 'Appel à l’action',
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, lang),
  CONSTRAINT fk_mar_cmsg_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_shop_support (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id      BIGINT UNSIGNED NOT NULL,
  kind         VARCHAR(10)     NOT NULL COMMENT 'bache | affiche',
  placement    VARCHAR(120)        NULL COMMENT 'Façade, clôture du parking, vitrine…',
  width_cm     SMALLINT UNSIGNED   NULL COMMENT 'Bâche : largeur finie',
  height_cm    SMALLINT UNSIGNED   NULL COMMENT 'Bâche : hauteur finie',
  paper_format VARCHAR(4)          NULL COMMENT 'Affiche : A1 | A2 | A3',
  quantity     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  material     VARCHAR(20)         NULL COMMENT 'Bâche : pvc | mesh',
  fixing       VARCHAR(20)         NULL COMMENT 'Bâche : oeillets | fourreaux | sangles',
  note         VARCHAR(300)        NULL,
  sort_order   SMALLINT        NOT NULL DEFAULT 0,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_shop_support_shop (shop_id, kind, sort_order),
  CONSTRAINT fk_mar_shop_support_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
