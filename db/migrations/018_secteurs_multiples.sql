-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 018 — Un compte peut relever de plusieurs secteurs
--
-- Les secteurs du vivier viennent des types de compte B2B de l'ERP
-- (`b2b_client_type`), rattachés aux clients par une table de liaison
-- (`b2b_client_interest_connection`). Un client en a donc autant qu'il veut :
-- un traiteur peut relever de l'événementiel et de l'horeca à la fois.
--
-- `mar_b2b_prospect.sector_id` n'en gardait qu'un. Le compte n'apparaissait
-- alors que sous un seul secteur : invisible pour une campagne qui vise
-- l'autre, et absent de la génération de leads correspondante. Personne ne
-- l'aurait vu — un compte manquant ne se signale pas.
--
-- La colonne est reprise dans la jonction puis retirée : deux sources pour le
-- même lien finissent toujours par diverger.
-- =============================================================================

CREATE TABLE mar_b2b_prospect_sector (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id BIGINT UNSIGNED NOT NULL,
  sector_id   BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_bps (prospect_id, sector_id),
  KEY ix_mar_bps_sector (sector_id),
  CONSTRAINT fk_mar_bps_prospect FOREIGN KEY (prospect_id) REFERENCES mar_b2b_prospect (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_bps_sector   FOREIGN KEY (sector_id)   REFERENCES mar_b2b_sector (id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mar_b2b_prospect_sector (prospect_id, sector_id)
SELECT id, sector_id FROM mar_b2b_prospect WHERE sector_id IS NOT NULL;

ALTER TABLE mar_b2b_prospect
  DROP FOREIGN KEY fk_mar_bp_sector,
  DROP COLUMN sector_id;

-- Les secteurs importés de l'ERP portent son identifiant : c'est lui qui rend
-- la reprise rejouable, comme pour les boutiques.
ALTER TABLE mar_b2b_sector
  ADD COLUMN erp_type_id BIGINT UNSIGNED NULL
    COMMENT 'Type de compte B2B d''origine, côté ERP'
    AFTER code,
  ADD UNIQUE KEY uq_mar_b2b_sector_erp (erp_type_id);
