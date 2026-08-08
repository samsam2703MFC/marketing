-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 020 — Un brouillon retient l'étape où on l'a laissé
--
-- La reprise déduisait l'étape de ce qui manquait : la première étape
-- incomplète. Le raisonnement ne tient pas — l'offre, le budget et la
-- communication sont facultatifs. Un brouillon quitté à l'étape 2 n'avait donc
-- rien d'« incomplet », et l'assistant le rouvrait au récapitulatif : on
-- revenait à la fin d'un travail qu'on n'avait pas commencé.
--
-- La clé de l'étape, et non son rang : ajouter une étape au milieu de
-- l'assistant décalerait tous les rangs enregistrés, et chaque brouillon
-- rouvrirait sur l'étape du voisin sans que rien ne le signale.
-- =============================================================================

ALTER TABLE mar_campaign
  ADD COLUMN draft_step VARCHAR(30) NULL
    COMMENT 'Clé de l''étape où l''assistant a été quitté'
    AFTER status_code;
