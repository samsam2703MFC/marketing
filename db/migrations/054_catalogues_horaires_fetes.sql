-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 054 — Les horaires des fêtes de chaque boutique, à la dernière page du catalogue (21/11/2026)
--
-- Client (catalogue « Fêtes de fin d'année ») : « 24/12 : [horaire] · 25/12 : [horaire] · 31/12 : [horaire] ·
-- 01/01 : [horaire] » à la dernière page. Ces horaires changent d'une boutique à l'autre et l'ERP ne les porte pas :
-- ils se saisissent dans l'assistant des pages de la marque, boutique par boutique, comme le second téléphone (051),
-- en français et en néerlandais (vide : le français est imprimé). Un champ vide n'imprime rien.
--
-- Rejouable : une colonne déjà là n'est pas ajoutée une seconde fois.
-- =============================================================================

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'holiday_hours_fr'
);
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN holiday_hours_fr VARCHAR(600) NULL COMMENT ''Horaires des fêtes, tels qu''''ils s''''impriment (FR)'' AFTER logo_media_id',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_catalogue_shop_contact' AND column_name = 'holiday_hours_nl'
);
SET @ordre = IF(@manque,
  'ALTER TABLE mar_catalogue_shop_contact ADD COLUMN holiday_hours_nl VARCHAR(600) NULL COMMENT ''Horaires des fêtes (NL) ; vide : le français'' AFTER holiday_hours_fr',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
