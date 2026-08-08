-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 019 — La marque porte son identifiant côté ERP
--
-- Le module s'ouvre désormais sur un périmètre nommé dans l'adresse :
-- `/marketing/?brand=1`. Ce 1 est celui de l'ERP — c'est lui qui ouvre le
-- module, et il ne connaît que ses propres identifiants.
--
-- `mar_brand` n'en gardait aucune trace. Les boutiques ont `erp_shop_id`, les
-- secteurs `erp_type_id` ; la marque, rien. Tant qu'il n'y a qu'une enseigne,
-- son identifiant local vaut 1 lui aussi et tout semble marcher : c'est une
-- coïncidence d'auto-incrément, et elle cesse à la deuxième enseigne — le
-- module ouvrirait alors le périmètre d'une autre marque, sans rien signaler.
-- =============================================================================

ALTER TABLE mar_brand
  ADD COLUMN erp_brand_id BIGINT UNSIGNED NULL
    COMMENT 'Identifiant de l''enseigne côté ERP'
    AFTER code,
  ADD UNIQUE KEY uq_mar_brand_erp (erp_brand_id);
