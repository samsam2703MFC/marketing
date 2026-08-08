-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 012 — Ce qu'il manquait à l'assistant de campagne
--
-- La maquette de référence capture, en sept étapes, davantage que ce que le
-- schéma savait stocker. Tout ce qui suit existait à l'écran et se serait
-- perdu à l'enregistrement — c'est-à-dire le pire des deux mondes : l'agence
-- croit avoir brieffé, personne ne retrouve le brief.
--
-- Les tables de jonction plutôt que des colonnes multivaluées : un secteur,
-- une tenue ou une demande d'agence se compte, se filtre et se recoupe. Une
-- liste dans une colonne texte ne se recoupe pas.
-- =============================================================================

-- --- Cadrage éditorial et commercial ----------------------------------------

ALTER TABLE mar_campaign
  ADD COLUMN tone VARCHAR(40) NULL
    COMMENT 'Ton éditorial (mar_tone.code) — oriente le brief agence'
    AFTER client_target,
  ADD COLUMN objective_coef_pct DECIMAL(5,2) NULL
    COMMENT 'Objectif exprimé en écart au N-1 : « N-1 + 12 % »'
    AFTER budget_amount,
  ADD COLUMN agency_note TEXT NULL
    COMMENT 'Complément libre au brief agence'
    AFTER objective_coef_pct,
  ADD COLUMN b2b_webshop_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Espace web-shop B2B personnalisé pour le grand compte'
    AFTER agency_note;

-- Tons éditoriaux. Référentiel et non énumération : le marketing en ajoute un
-- pour une saison sans qu'on redéploie.
CREATE TABLE mar_tone (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  label      VARCHAR(80)     NOT NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_tone_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- Demandes adressées à l'agence -------------------------------------------

CREATE TABLE mar_agency_ask (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  label      VARCHAR(160)    NOT NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_agency_ask_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_campaign_agency_ask (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  ask_id      BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_caa (campaign_id, ask_id),
  KEY ix_mar_caa_ask (ask_id),
  CONSTRAINT fk_mar_caa_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)   ON DELETE CASCADE,
  CONSTRAINT fk_mar_caa_ask      FOREIGN KEY (ask_id)      REFERENCES mar_agency_ask (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- Options du web-shop B2B --------------------------------------------------

CREATE TABLE mar_b2b_option (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)     NOT NULL,
  label       VARCHAR(160)    NOT NULL,
  description VARCHAR(400)        NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_b2b_option_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_campaign_b2b_option (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  option_id   BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_cbo (campaign_id, option_id),
  KEY ix_mar_cbo_option (option_id),
  CONSTRAINT fk_mar_cbo_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)  ON DELETE CASCADE,
  CONSTRAINT fk_mar_cbo_option   FOREIGN KEY (option_id)   REFERENCES mar_b2b_option (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- Tenues retenues pour une campagne ---------------------------------------
--
-- `mar_uniform.campaign_id` n'exprimait qu'un rattachement unique : une tenue
-- appartenait à une campagne et à une seule. Or l'assistant choisit plusieurs
-- tenues dans un catalogue commun, et le même tablier ressert chaque été. La
-- jonction dit ce que la colonne ne pouvait pas dire.
CREATE TABLE mar_campaign_uniform (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  uniform_id  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_cu (campaign_id, uniform_id),
  KEY ix_mar_cu_uniform (uniform_id),
  CONSTRAINT fk_mar_cu_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_cu_uniform  FOREIGN KEY (uniform_id)  REFERENCES mar_uniform (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reprise de l'existant : les tenues déjà rattachées par la colonne rejoignent
-- la jonction, pour que les deux lectures donnent le même résultat.
INSERT INTO mar_campaign_uniform (campaign_id, uniform_id)
SELECT campaign_id, id FROM mar_uniform WHERE campaign_id IS NOT NULL;

-- --- Rétroplanning type -------------------------------------------------------
--
-- Les cinq jalons que la maquette pré-remplit. Ils vivent en base parce qu'ils
-- se discutent : ce sont les délais d'un métier, pas une constante de code.
CREATE TABLE mar_retroplanning_default (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label              VARCHAR(200)    NOT NULL,
  days_before_launch SMALLINT        NOT NULL,
  position_id        BIGINT UNSIGNED     NULL,
  sort_order         SMALLINT        NOT NULL DEFAULT 0,
  is_active          TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY ix_mar_rd_position (position_id),
  CONSTRAINT fk_mar_rd_position FOREIGN KEY (position_id) REFERENCES mar_position (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
