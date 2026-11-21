-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 056 — Le catalogue « Bureaux » (21/11/2026)
--
-- Client : « faire la même chose avec le catalogue bureau » (maquettes Claude Design, export-bureaux) : la dernière
-- page porte un seul QR, « Commande entreprise », vers la page de commande entreprise de chaque boutique, et ses
-- jours et créneaux de livraison au bureau à la place des horaires des fêtes. Ce que l'ERP ne porte pas se saisit
-- dans l'assistant des pages de la marque, boutique par boutique, comme les horaires des fêtes (054) :
--   - le lien de commande entreprise de la boutique (vide : le QR mène à son webshop) ;
--   - la livraison au bureau, FR et NL (un texte libre, plusieurs lignes ; NL vide : le français).
--
-- Rejouable : une colonne déjà là n'est pas ajoutée une seconde fois.
-- =============================================================================

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'business_url');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN business_url VARCHAR(300) NULL COMMENT ''Lien de commande entreprise (le QR « Commande entreprise ») ; vide : le webshop'' AFTER webshop_url',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'delivery_hours_fr');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN delivery_hours_fr VARCHAR(600) NULL COMMENT ''Livraison au bureau : jours et créneaux, tels qu''''ils s''''impriment'' AFTER holiday_hours_nl',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'delivery_hours_nl');
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN delivery_hours_nl VARCHAR(600) NULL COMMENT ''Livraison au bureau (NL) ; vide : le français'' AFTER delivery_hours_fr',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
