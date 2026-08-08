-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 017 — Questionnaire en caisse
--
-- Une campagne peut demander à la caisse de poser quelques questions au client
-- — « comment avez-vous connu l'offre ? », « êtes-vous déjà venu ? ». C'est le
-- seul point de mesure dont dispose une opération qui n'a ni voucher ni canal
-- digital traçable : sans lui, on sait ce qu'on a vendu, pas pourquoi.
--
-- Les questions vivent dans leur propre table plutôt que dans une colonne
-- texte : elles se comptent, se réordonnent, et surtout les réponses devront
-- s'y rattacher le jour où la caisse les remonte.
-- =============================================================================

ALTER TABLE mar_campaign
  ADD COLUMN pos_survey_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Un questionnaire est-il posé en caisse pendant la campagne'
    AFTER b2b_webshop_enabled;

-- Formes de réponse attendues. Référentiel et non énumération : la caisse
-- gagnera des types (photo, scan) sans qu'on redéploie le module.
CREATE TABLE mar_pos_answer_type (
  code       VARCHAR(20)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  hint       VARCHAR(200)     NULL COMMENT 'Ce que la caisse affiche au vendeur',
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mar_pos_answer_type (code, label, hint, sort_order) VALUES
  ('yes_no',  'Oui / Non',        'Réponse binaire, la plus rapide en caisse',      1),
  ('choice',  'Choix dans une liste', 'Les propositions se saisissent dans la question', 2),
  ('rating',  'Note sur 5',       'Échelle courte, comparable d''une campagne à l''autre', 3),
  ('number',  'Nombre',           'Quantité, âge, nombre de convives',                4),
  ('text',    'Réponse libre',    'À réserver aux questions ouvertes : long à saisir', 5);

CREATE TABLE mar_campaign_pos_question (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  label       VARCHAR(300)    NOT NULL,
  answer_type VARCHAR(20)     NOT NULL DEFAULT 'yes_no',
  -- Propositions d'un choix, une par ligne. Colonne texte assumée : ce sont
  -- des libellés propres à une question, sans existence hors d'elle.
  options     TEXT                NULL,
  is_required TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_cpq_campaign (campaign_id),
  CONSTRAINT fk_mar_cpq_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_cpq_type     FOREIGN KEY (answer_type) REFERENCES mar_pos_answer_type (code) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
