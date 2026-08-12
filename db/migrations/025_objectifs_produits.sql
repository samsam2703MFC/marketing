-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 025 — Objectif de vente par produit
--
-- L'objectif se posait par boutique et seulement par boutique : « Corbais,
-- 2 000 pièces ». Sur une offre de sept produits, cela répond à « combien la
-- boutique doit vendre » sans jamais dire de quoi — et c'est pourtant la
-- question qu'un chef d'équipe se pose le lundi matin.
--
-- L'objectif produit vit sur la ligne d'offre, qui est déjà le couple
-- campagne × produit. NULL = aucun objectif posé sur ce produit, ce qui reste
-- le cas courant : une campagne peut très bien n'objectiver que son réseau.
--
-- Pas de table pour les catégories : un objectif de catégorie se répartit sur
-- ses produits au prorata de leur historique, et c'est cette répartition qu'on
-- enregistre. Stocker les deux ferait deux vérités pour un même chiffre, et
-- la question « laquelle fait foi » se poserait au premier écart d'arrondi.
-- =============================================================================

ALTER TABLE mar_campaign_offer_item
  ADD COLUMN target_pieces INT UNSIGNED NULL
    COMMENT 'Objectif réseau de pièces sur ce produit ; NULL = aucun'
    AFTER margin_pct;
