-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 033 — Photo d'un produit dans le dossier d'impression
--
-- Le dossier d'impression annonce déjà, pour chaque produit, une option
-- `show_photo` — figée à « vrai », avec ce commentaire : « à construire : tant
-- que l'écran ne les propose pas, tout s'imprime ». C'est cet écran qui arrive,
-- et voici ce qu'il lui manquait en base.
--
-- Deux colonnes, et deux décisions distinctes :
--
-- — `show_photo` : cette photo part-elle à l'impression ? Un flyer de six
--   produits ne les montre pas tous ; une gamme entière se cite parfois sans
--   image. Le défaut reste « oui », parce que c'est ce que fait le module
--   aujourd'hui et qu'un dossier qui perdrait ses photos en silence serait une
--   régression.
-- — `image_url` : la photo retenue **pour cette campagne**. Vide, c'est celle du
--   catalogue qui sert. Elle ne remplace pas la photo du catalogue, elle la
--   couvre le temps d'une campagne — une opération de Noël peut vouloir son
--   propre visuel sans que le catalogue change pour tout le réseau.
-- =============================================================================

ALTER TABLE mar_campaign_offer_item
  ADD COLUMN show_photo TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = la photo part dans le dossier d''impression'
    AFTER label,
  ADD COLUMN image_url VARCHAR(500) NULL
    COMMENT 'Photo propre à cette campagne ; NULL = celle du catalogue'
    AFTER show_photo;
