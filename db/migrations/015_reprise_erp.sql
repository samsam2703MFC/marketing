-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 015 — Clé de rapprochement avec l'ERP
--
-- `mar_shop.erp_shop_id` existait mais n'était qu'un index. La reprise des
-- boutiques a besoin d'une clé unique : sans elle, l'écriture retombe sur
-- (brand_id, code), et le jour où l'ERP change le code d'une boutique, la
-- reprise en crée une seconde au lieu de mettre à jour la première. Deux lignes
-- pour la même boutique, chacune avec ses campagnes.
--
-- Plusieurs NULL restent permis dans un index unique MySQL : les boutiques
-- saisies à la main, sans identifiant ERP, ne se gênent pas entre elles.
-- =============================================================================

ALTER TABLE mar_shop
  DROP INDEX ix_mar_shop_erp,
  ADD UNIQUE KEY uq_mar_shop_erp (brand_id, erp_shop_id);
