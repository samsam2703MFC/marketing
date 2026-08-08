-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 022 — Objectif de vente en pièces, par boutique de la campagne
--
-- L'étape « Objectifs » fixe pour chaque boutique un objectif de quantités sur
-- les produits de l'offre. Il vit sur le rattachement campagne ↔ boutique :
-- c'est déjà lui qui dit qui participe, il dit maintenant pour combien de
-- pièces. NULL = aucun objectif posé — distinct d'un objectif à zéro.
-- =============================================================================

ALTER TABLE mar_campaign_shop
  ADD COLUMN target_pieces INT UNSIGNED NULL
    COMMENT 'Objectif de vente en pièces sur les produits de l''offre'
    AFTER shop_id;
