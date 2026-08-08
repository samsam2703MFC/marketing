-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 020 — Clé de rapprochement du catalogue avec l'ERP
--
-- La reprise des produits écrit dans `mar_offer_item` avec `sku_ref` pour clé
-- (« erp-<id> ») : sans unicité dessus, chaque reprise recréerait le catalogue
-- entier au lieu de le mettre à jour. Même raisonnement que
-- `mar_shop.erp_shop_id` (015).
--
-- Plusieurs NULL restent permis dans un index unique MySQL : les éléments créés
-- à la main, sans référence ERP, ne se gênent pas entre eux.
-- =============================================================================

ALTER TABLE mar_offer_item
  DROP INDEX ix_mar_offer_item_sku,
  ADD UNIQUE KEY uq_mar_offer_item_sku (sku_ref);
