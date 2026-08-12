-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 026 — Objectif par boutique ET par produit
--
-- Deux objectifs existaient, chacun borgne d'un côté :
--   • `mar_campaign_shop.target_pieces` — « Gosselies : 256 pièces », sans dire
--     de quoi ;
--   • `mar_campaign_offer_item.target_pieces` — « 3 000 cougnous », sans dire
--     par qui.
--
-- Le croisement des deux est pourtant la seule forme qu'un chef d'équipe peut
-- suivre le lundi matin : « ici, 900 cougnous ». Il vit dans cette table, et
-- devient la vérité : les deux colonnes ci-dessus en sont désormais des
-- sommes — par boutique pour l'une, par produit pour l'autre. Elles restent
-- écrites parce que tout le module les lit déjà (étape « Prix », récapitulatif,
-- suivi), mais plus rien ne s'y saisit directement quand un détail existe.
--
-- Un objectif de catégorie ne se stocke toujours pas : il se répartit sur les
-- produits de la boutique au prorata de leur historique, et c'est la
-- répartition qu'on enregistre. Deux vérités pour un même chiffre finiraient
-- par diverger d'un arrondi, et il faudrait alors trancher laquelle fait foi.
--
-- Pas de ligne pour un produit sans objectif : c'est l'absence qui dit « aucun
-- objectif », et le produit garde alors son historique dans le total du
-- magasin. Une ligne à zéro dit autre chose — « n'en vendez pas » — et se garde
-- telle quelle : la répartition d'un objectif de catégorie en produit un
-- naturellement, et l'effacer ferait remonter l'historique au rechargement,
-- donc changerait le total d'une boutique sans que personne n'y ait touché.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_campaign_shop_item_target (
  -- BIGINT et non INT : les clés du module le sont toutes, et une contrainte
  -- entre deux largeurs différentes est refusée à la création, pas plus tard.
  campaign_id   BIGINT UNSIGNED NOT NULL,
  shop_id       BIGINT UNSIGNED NOT NULL,
  offer_item_id BIGINT UNSIGNED NOT NULL,
  target_pieces INT UNSIGNED NOT NULL
                COMMENT 'Objectif de pièces de ce produit dans cette boutique',
  created_by    BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (campaign_id, shop_id, offer_item_id),
  KEY idx_mar_csit_shop (shop_id),
  KEY idx_mar_csit_item (offer_item_id),

  CONSTRAINT fk_mar_csit_campaign FOREIGN KEY (campaign_id)
    REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_csit_shop FOREIGN KEY (shop_id)
    REFERENCES mar_shop (id) ON DELETE CASCADE,
  -- Pas de cascade sur le produit : une référence retirée du catalogue ne doit
  -- pas emporter silencieusement les objectifs d'une campagne en cours.
  CONSTRAINT fk_mar_csit_item FOREIGN KEY (offer_item_id)
    REFERENCES mar_offer_item (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
