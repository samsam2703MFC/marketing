-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 028 — Période couverte par un mouvement de fonds
--
-- Un mouvement n'avait qu'une date : celle où il tombe dans le grand livre.
-- Elle suffit pour un achat de PLV, pas pour ce qui compose l'essentiel du
-- fonds — une redevance trimestrielle, une facture d'agence sur un semestre,
-- une contribution annuelle. « 12 000 € le 14 avril » ne dit pas si l'on paie
-- le premier trimestre ou l'année ; il faut ouvrir la pièce pour le savoir, et
-- deux personnes qui ne l'ouvrent pas comptent deux choses différentes.
--
-- Les deux bornes sont facultatives et vont ensemble : une période ouverte d'un
-- côté ne se totalise pas, et un mouvement ponctuel n'en a pas besoin — sa date
-- dit tout.
-- =============================================================================

ALTER TABLE mar_fund_movement
  ADD COLUMN period_from DATE NULL
    COMMENT 'Début de la période couverte ; NULL = mouvement ponctuel'
    AFTER movement_date,
  ADD COLUMN period_to DATE NULL
    COMMENT 'Fin de la période couverte ; va avec period_from'
    AFTER period_from;

-- La vue `mar_v_fund_ledger_by_period` n'est pas touchée ici, et c'est
-- délibéré : `migrate.php` rejoue les fichiers `_vues` à chaque passage, donc
-- `010_vues.sql` repasserait après cette migration et restaurerait sa propre
-- définition. Deux définitions d'une même vue, la dernière rejouée l'emporte —
-- et un déploiement qui migre deux fois casse ce qui marchait au premier.
--
-- Le grand livre lit donc ces deux colonnes sur la table, jointe à la vue par
-- son identifiant.
