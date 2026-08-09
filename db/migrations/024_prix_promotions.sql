-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 024 — Étape « Prix » : promotion chiffrée, produit par produit
--
-- L'étape simule ce qu'une promotion fait à la marge, et combien il faut vendre
-- pour la retrouver : Q1 = Q0 × M0 / M1. Cela demande des nombres, or la
-- promotion n'était jusqu'ici que du texte — `mar_campaign_offer.price_label`
-- porte « −20 % » comme libellé, pas comme valeur.
--
-- `mar_promotion` n'est pas touchée : elle vient de l'import catalogue et le
-- module ne l'écrit nulle part (voir PromotionsView). Les promotions de
-- l'assistant vivent donc sur la ligne produit de l'offre, qui est déjà le
-- couple campagne × produit — un pour un, sans table intermédiaire.
--
-- Le coût matière n'existe pas encore côté ERP (voir docs/FOOD-COST-A-CONSTRUIRE.md).
-- On stocke donc un **taux de marge**, dont le coût se déduit : C = P × (1 − m).
-- Le jour où le food cost arrive, `margin_pct` devient calculé au lieu d'être
-- saisi et pas une formule de l'écran ne change.
-- =============================================================================

ALTER TABLE mar_campaign_offer_item
  ADD COLUMN mechanic_type VARCHAR(20) NULL
    COMMENT 'Code de mar_promotion_mechanic ; NULL = ce produit n''est pas en promotion'
    AFTER label,
  ADD COLUMN discount_pct DECIMAL(5,2) NULL
    COMMENT 'Remise en %%, pour la mécanique PERCENT'
    AFTER mechanic_type,
  ADD COLUMN fixed_price DECIMAL(12,2) NULL
    COMMENT 'Prix TTC imposé, pour CROSSED_PRICE et BUNDLE_FIXED'
    AFTER discount_pct,
  ADD COLUMN buy_qty SMALLINT UNSIGNED NULL
    COMMENT 'Quantité achetée, pour BUY_X_GET_Y'
    AFTER fixed_price,
  ADD COLUMN get_qty SMALLINT UNSIGNED NULL
    COMMENT 'Quantité offerte, pour BUY_X_GET_Y'
    AFTER buy_qty,
  -- Le prix est figé à la saisie plutôt que relu du catalogue : une campagne
  -- validée en janvier ne doit pas voir ses marges changer parce que le prix
  -- de référence a bougé en mars. C'est la même raison qui fait garder le
  -- montant d'une facture plutôt que de le recalculer.
  ADD COLUMN baseline_price DECIMAL(12,2) NULL
    COMMENT 'Prix TTC de référence au moment de la saisie'
    AFTER get_qty,
  ADD COLUMN margin_pct DECIMAL(5,2) NULL
    COMMENT 'Taux de marge du produit ; NULL = suit le taux réseau de la campagne'
    AFTER baseline_price;

ALTER TABLE mar_campaign
  ADD COLUMN margin_pct_default DECIMAL(5,2) NULL
    COMMENT 'Taux de marge appliqué aux produits qui n''ont pas le leur'
    AFTER challenge_trigger_pct;

-- Conditions communes à toutes les promotions de l'offre. Les dates, jours et
-- heures existent déjà sur `mar_campaign_offer` ; il manquait de quoi borner
-- la casse — une promotion sans plafond ni règle de cumul se découvre à la
-- lecture du chiffre d'affaires.
ALTER TABLE mar_campaign_offer
  ADD COLUMN max_qty_per_ticket SMALLINT UNSIGNED NULL
    COMMENT 'Plafond par ticket ; NULL = sans limite'
    AFTER scope_label,
  ADD COLUMN is_cumulative TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'La promotion se cumule avec les autres avantages'
    AFTER max_qty_per_ticket;
