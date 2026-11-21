-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 055 — La page « Le magasin » de chaque boutique, à la fin du catalogue (21/11/2026)
--
-- Client : « je dois créer un stopper spécifique pour chaque magasin : photo du magasin, logo du magasin, le code
-- QR (lien spécifique par magasin), heures d'ouverture et de fermeture, QR code avec l'adresse (Maps) — à mettre
-- dans les catalogues ». La dernière page prend un gabarit C « Le magasin » ; ce que l'ERP ne porte pas se saisit dans
-- l'assistant des pages de la marque, boutique par boutique, comme le second téléphone (051) :
--   - la photo du magasin (une image de la médiathèque, du réseau ou de la boutique) ;
--   - le lien Google Maps de la boutique (vide : il est fait de son adresse dans l'ERP) ;
--   - ses horaires d'ouverture, FR et NL (vides : ceux de l'ERP).
--
-- Rejouable : une colonne ou une contrainte déjà là n'est pas ajoutée une seconde fois.
-- =============================================================================

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'photo_media_id');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN photo_media_id BIGINT UNSIGNED NULL COMMENT ''mar_media.id : la photo du magasin (page « Le magasin »)'' AFTER logo_media_id',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND constraint_name = 'fk_mar_catalogue_shop_contact_photo');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD CONSTRAINT fk_mar_catalogue_shop_contact_photo FOREIGN KEY (photo_media_id) REFERENCES mar_media (id) ON DELETE SET NULL',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'maps_url');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN maps_url VARCHAR(500) NULL COMMENT ''Lien Google Maps de la boutique (le second QR) ; vide : fait de son adresse'' AFTER photo_media_id',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'hours_fr');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN hours_fr VARCHAR(600) NULL COMMENT ''Horaires d''''ouverture, tels qu''''ils s''''impriment ; vide : ceux de l''''ERP'' AFTER maps_url',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'hours_nl');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN hours_nl VARCHAR(600) NULL COMMENT ''Horaires d''''ouverture (NL) ; vide : le français'' AFTER hours_fr',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
