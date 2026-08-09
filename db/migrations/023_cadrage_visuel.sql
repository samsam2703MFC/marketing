-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 023 — Mode de cadrage du visuel
--
-- Le point focal réglait *où* couper une image qu'on recadre toujours. Certains
-- visuels ne se recadrent pas : une affiche déjà composée, un montage avec du
-- texte au bord — les rogner ampute le message. Le mode dit lequel des deux :
--
--   cover   : l'image remplit le cadre et déborde ; le point focal choisit ce
--             qui reste. C'est le comportement d'origine, donc la valeur par
--             défaut — les visuels déjà enregistrés ne changent pas d'aspect.
--   contain : l'image tient entière dans le cadre, marges comprises.
-- =============================================================================

ALTER TABLE mar_campaign_asset
  ADD COLUMN fit ENUM('cover', 'contain') NOT NULL DEFAULT 'cover'
    COMMENT 'cover : recadré au point focal — contain : image entière'
    AFTER focal_point_y;
