-- =============================================================================
-- 053 — Le fonds distingue les investissements (21/11/2026)
-- =============================================================================
-- Une dépense du fonds peut être un INVESTISSEMENT — un four, une enseigne — et
-- non un frais courant : le grand livre du cockpit les distingue et les
-- sous-totalise. Le cockpit (dépôt consultant_BO) avait posé la colonne lui-même,
-- par un ALTER au premier appel, quand le module avait disparu ; il écrivait alors
-- le fonds en direct. Le module revenu, c'est lui qui tient la table : la colonne
-- entre ici, et le cockpit n'écrit plus le fonds que par cette API.
--
-- Rejouable : sur la base où le cockpit l'a déjà ajoutée, rien ne change.
-- =============================================================================

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_fund_movement' AND column_name = 'is_investment'
);
SET @ordre = IF(@manque,
  'ALTER TABLE mar_fund_movement ADD COLUMN is_investment TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = dépense d’investissement (four, enseigne), 0 = frais courant'' AFTER is_public',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
