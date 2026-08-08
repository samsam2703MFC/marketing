-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 016 — Largeurs des champs repris de l'ERP
--
-- La reprise a échoué sur « Data too long for column 'postal_code' » : la
-- colonne faisait 20 caractères, et l'ERP y met davantage. C'est courant — le
-- champ sert souvent de fourre-tout postal, « 1050 Bruxelles » plutôt que
-- « 1050 ».
--
-- On élargit plutôt qu'on ne tronque à l'aveugle, et le dépôt borne ensuite ce
-- qui dépasserait encore, en comptant les valeurs rognées : une reprise ne doit
-- pas s'arrêter sur un champ annexe, mais elle ne doit pas non plus raboter des
-- données sans le dire.
-- =============================================================================

ALTER TABLE mar_b2b_prospect
  MODIFY COLUMN postal_code VARCHAR(40) NULL,
  MODIFY COLUMN contact_phone VARCHAR(80) NULL,
  MODIFY COLUMN size_label VARCHAR(160) NULL;
