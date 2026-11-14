-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 048 — Un catalogue peut partir de plusieurs gammes du webshop
--
-- `source_ref` porte alors les identifiants des gammes séparés par des virgules
-- (8 au plus) : 40 caractères ne suffisent plus. Rejouable : MODIFY donne le même
-- résultat à chaque passage.
-- =============================================================================

ALTER TABLE mar_catalogue
  MODIFY source_ref VARCHAR(200) NULL COMMENT 'Gamme(s) TFBuddy (ids séparés par des virgules) ou campagne (mar_campaign)';
