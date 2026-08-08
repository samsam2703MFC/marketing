-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 003 — Couleurs de levier et rattachement des types
--
-- Les couleurs de `mar_lever` avaient été alignées sur la palette terre du
-- reste de l'interface. C'était une erreur : la maquette de référence utilise
-- une palette distincte et volontairement plus vive pour les pastilles de
-- levier, précisément pour qu'elles se détachent des libellés autour. On
-- reprend ses valeurs.
--
-- Fichier séparé du 001, déjà appliqué et dont l'empreinte est enregistrée :
-- le modifier ne le rejouerait pas, cela ferait seulement échouer la migration
-- suivante.
-- =============================================================================

UPDATE mar_lever SET color_hex = '#6366f1' WHERE code = 'TRAFIC';
UPDATE mar_lever SET color_hex = '#ec4899' WHERE code = 'RECUR';
UPDATE mar_lever SET color_hex = '#f59e0b' WHERE code = 'XP';
UPDATE mar_lever SET color_hex = '#10b981' WHERE code = 'FOOD';
UPDATE mar_lever SET color_hex = '#8b5cf6' WHERE code = 'LABOUR';
UPDATE mar_lever SET color_hex = '#8b5cf6' WHERE code = 'OVERHEAD';
UPDATE mar_lever SET color_hex = '#4A6D8C' WHERE code = 'PANIER';

-- Rattachement type → levier. `default_lever_code` reste en place : c'est la
-- formulation d'origine du handoff, utile pour retrouver l'intention.
UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.code = 'TRAFIC'
    SET t.lever_id = l.id
  WHERE t.code IN ('ouverture', 'evenementiel', 'acquisition', 'partenariat');

UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.code = 'XP'
    SET t.lever_id = l.id
  WHERE t.code = 'lancement';

UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.code = 'RECUR'
    SET t.lever_id = l.id
  WHERE t.code IN ('saisonnalite', 'retention');

UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.code = 'PANIER'
    SET t.lever_id = l.id
  WHERE t.code = 'fetes';

UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.code = 'FOOD'
    SET t.lever_id = l.id
  WHERE t.code = 'anti_gaspi';

-- Types dont la pastille nuance le libellé du levier.
-- « Food Cost » sans trait d'union : la pastille de la maquette l'écrit ainsi,
-- alors que le levier lui-même reste « Food-Cost » dans les écrans de coûts.
UPDATE mar_campaign_type SET lever_badge_label = 'Trafic / notoriété' WHERE code = 'ouverture';
UPDATE mar_campaign_type SET lever_badge_label = 'Trafic croisé'      WHERE code = 'partenariat';
UPDATE mar_campaign_type SET lever_badge_label = 'Food Cost'          WHERE code = 'anti_gaspi';
