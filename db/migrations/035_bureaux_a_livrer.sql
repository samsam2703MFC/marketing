-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 035 — « Bureaux à livrer » : ne viser que les comptes B2B livrés au bureau
--
-- L'assistant de campagne du BO, copie de celui-ci, a reçu ce filtre pendant que
-- les deux vivaient côte à côte : il a posé ses colonnes par son propre script de
-- référentiels. Tout l'assistant est désormais ici ; ses colonnes y entrent donc
-- par une migration du module, comme les autres.
--
-- En production, le BO les a déjà posées : chaque ajout ne se fait que si la
-- colonne manque, et ne touche jamais une valeur déjà saisie.
--
-- `mar_b2b_prospect.is_office` est repris de l'ERP à chaque synchronisation du
-- vivier : c'est la fiche client qui dit si elle se fait livrer au bureau, le
-- module ne le devine pas. Un vivier importé par fichier ne porte pas
-- l'information : ces comptes restent à 0 et le filtre les écarte.
--
-- `mar_campaign.b2b_offices_only` est le choix de la campagne : il ne filtre pas
-- seulement l'écran, il commande la génération des leads.
-- =============================================================================

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_b2b_prospect' AND column_name = 'is_office'
);
SET @ordre = IF(@manque,
  'ALTER TABLE mar_b2b_prospect ADD COLUMN is_office TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = la fiche client ERP porte la livraison au bureau'' AFTER shop_id',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_campaign' AND column_name = 'b2b_offices_only'
);
SET @ordre = IF(@manque,
  'ALTER TABLE mar_campaign ADD COLUMN b2b_offices_only TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = ne viser que les comptes marqués « bureau à livrer »'' AFTER client_target',
  'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
