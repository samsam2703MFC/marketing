-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 023 — Challenge sur les objectifs : classement et seuils par magasin
--
-- L'étape « Objectifs » pose une cible en pièces par boutique. On peut y
-- attacher un challenge — facultatif : une campagne sans challenge reste une
-- campagne valide, et c'est le cas par défaut.
--
-- Deux notions distinctes, qu'il ne faut pas confondre :
--
--   • le **seuil de participation** dit à partir de quel pourcentage de son
--     propre objectif une boutique entre dans la course. Il vit sur le
--     rattachement campagne ↔ boutique, parce qu'il se règle boutique par
--     boutique : demander la même barre à qui doit progresser de 30 % et à qui
--     doit progresser de 47 % n'est pas le même effort. NULL = la boutique suit
--     le seuil général de la campagne, ce qui est le cas courant ;
--
--   • le **classement** départage ensuite celles qui ont franchi leur seuil.
--     Son critère (`challenge_metric`) et ses prix vivent sur la campagne.
--
-- `challenge_metric` reste une chaîne libre plutôt qu'un ENUM : ajouter un
-- critère ne doit pas demander de migration, et la valeur est validée côté
-- application où le message d'erreur peut être utile.
-- =============================================================================

ALTER TABLE mar_campaign
  ADD COLUMN challenge_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Un challenge est attaché aux objectifs'
    AFTER pos_survey_enabled,
  ADD COLUMN challenge_metric VARCHAR(20) NULL
    COMMENT 'Critère de classement : attainment | pieces | growth'
    AFTER challenge_enabled,
  ADD COLUMN challenge_trigger_pct DECIMAL(5,2) NULL
    COMMENT 'Seuil de participation général, en %% de l''objectif de la boutique'
    AFTER challenge_metric;

ALTER TABLE mar_campaign_shop
  ADD COLUMN challenge_trigger_pct DECIMAL(5,2) NULL
    COMMENT 'Seuil propre à la boutique ; NULL = suit le seuil général'
    AFTER target_pieces;

-- Les prix vivent dans leur table plutôt que dans trois colonnes : un réseau
-- qui veut récompenser les cinq premiers n'a alors pas besoin d'une migration.
-- `rank_position` et non `rank` : `RANK` est un mot réservé depuis MySQL 8.0.2.
CREATE TABLE mar_campaign_challenge_prize (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  rank_position TINYINT UNSIGNED NOT NULL COMMENT '1 = premier du classement',
  label         VARCHAR(120) NOT NULL COMMENT 'Ce que gagne ce rang, en clair',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_ccp_rank (campaign_id, rank_position),
  CONSTRAINT fk_mar_ccp_campaign FOREIGN KEY (campaign_id)
    REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
