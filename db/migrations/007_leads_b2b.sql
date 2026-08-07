-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 007 — Leads B2B (assistant étape ⑦)
-- =============================================================================

-- Secteurs cibles, avec le volume estimé qui alimente le compteur de l'étape ⑦.
CREATE TABLE mar_b2b_sector (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                   VARCHAR(40)     NOT NULL,
  label                  VARCHAR(120)    NOT NULL,
  estimated_leads_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  sort_order             SMALLINT        NOT NULL DEFAULT 0,
  is_active              TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_b2b_sector_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Secteurs cochés à l'étape ① d'une campagne.
-- Ajouté au modèle : le DATA_MODEL dérive le volume de leads « de la somme des
-- estimated_leads_count des secteurs cochés » sans nommer la table de liaison
-- qui porte ce choix. Sans elle, l'étape ① n'est pas persistable.
CREATE TABLE mar_campaign_b2b_sector (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  sector_id   BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_sector (campaign_id, sector_id),
  KEY ix_mar_cbs_sector (sector_id),
  CONSTRAINT fk_mar_cbs_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)   ON DELETE CASCADE,
  CONSTRAINT fk_mar_cbs_sector   FOREIGN KEY (sector_id)   REFERENCES mar_b2b_sector (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Référentiel d'états du suivi commercial. Porte les trois couleurs de la pilule
-- (texte, fond, bordure) pour que le front n'en code aucune en dur.
CREATE TABLE mar_lead_status (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)     NOT NULL COMMENT 'todo | called | sent | ordered | dropped',
  label       VARCHAR(80)     NOT NULL,
  color_hex   CHAR(7)         NOT NULL,
  bg_hex      VARCHAR(40)     NOT NULL COMMENT 'Valeur CSS complète (rgba) — la maquette utilise de la transparence',
  border_hex  VARCHAR(40)     NOT NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_lead_status_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Compte B2B à prospecter, créé au lancement de la campagne si
-- mar_campaign.create_crm_leads = 1.
CREATE TABLE mar_crm_lead (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id      BIGINT UNSIGNED NOT NULL,
  sector_id        BIGINT UNSIGNED     NULL,
  shop_id          BIGINT UNSIGNED     NULL COMMENT 'Boutique référente, responsable du contact',
  company_name     VARCHAR(200)    NOT NULL,
  contact_name     VARCHAR(160)        NULL,
  contact_email    VARCHAR(190)        NULL,
  contact_phone    VARCHAR(40)         NULL,
  size_label       VARCHAR(80)         NULL,
  potential_amount DECIMAL(12,2)       NULL,
  status_code      VARCHAR(20)     NOT NULL DEFAULT 'todo'
                   COMMENT 'État courant dénormalisé — l''historique vit dans mar_crm_lead_event',
  assigned_user_id BIGINT UNSIGNED     NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by       BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_lead_campaign (campaign_id, status_code),
  KEY ix_mar_lead_shop (shop_id),
  KEY ix_mar_lead_sector (sector_id),
  CONSTRAINT fk_mar_lead_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id)      ON DELETE CASCADE,
  CONSTRAINT fk_mar_lead_sector   FOREIGN KEY (sector_id)   REFERENCES mar_b2b_sector (id)    ON DELETE SET NULL,
  CONSTRAINT fk_mar_lead_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)          ON DELETE SET NULL,
  CONSTRAINT fk_mar_lead_status   FOREIGN KEY (status_code) REFERENCES mar_lead_status (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historique du suivi. Tout changement d'état depuis la liste déroulante écrit
-- une ligne ici, en plus de mettre à jour mar_crm_lead.status_code.
CREATE TABLE mar_crm_lead_event (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id     BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20)         NULL,
  to_status   VARCHAR(20)         NULL,
  event_type  VARCHAR(20)     NOT NULL COMMENT 'CALL | OFFER_SENT | ORDER | NOTE',
  note        TEXT                NULL,
  occurred_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_lead_event_lead (lead_id, occurred_at),
  CONSTRAINT fk_mar_cle_lead FOREIGN KEY (lead_id) REFERENCES mar_crm_lead (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
