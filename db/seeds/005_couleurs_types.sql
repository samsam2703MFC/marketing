-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 005 — Couleur de départ des types de campagne
--
-- La colonne arrive vide (migration 031). Laisser les neuf types en gris aurait
-- fait régresser des cartes qui se distinguaient au moins par la couleur de leur
-- pastille : on reprend donc celle de leur levier, qui est déjà ce que l'écran
-- affiche à côté du nom.
--
-- Seuls les types sans couleur sont touchés : une couleur choisie à la main
-- dans l'éditeur ne doit pas être ramenée à celle du levier au déploiement
-- suivant.
-- =============================================================================

UPDATE mar_campaign_type t
   JOIN mar_lever l ON l.id = t.lever_id
    SET t.color_hex = l.color_hex
  WHERE t.color_hex IS NULL
    AND l.color_hex IS NOT NULL;
