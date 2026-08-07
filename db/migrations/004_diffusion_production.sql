-- =============================================================================
-- 004 — Diffusion, création & production
-- =============================================================================

-- Canaux de diffusion : Meta Ads, Google Search local, email/SMS, PLV, affichage…
CREATE TABLE mar_channel (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  label      VARCHAR(120)    NOT NULL,
  family     VARCHAR(10)     NOT NULL COMMENT 'DIGITAL | PHYSIQUE',
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_channel_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agences & prestataires.
CREATE TABLE mar_agency (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(160)    NOT NULL,
  speciality      VARCHAR(160)        NULL,
  main_lever_id   BIGINT UNSIGNED     NULL,
  avg_roi         DECIMAL(8,2)        NULL,
  hit_rate_pct    DECIMAL(5,2)        NULL,
  avg_cost_amount DECIMAL(12,2)       NULL,
  campaigns_count INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_agency_lever (main_lever_id),
  CONSTRAINT fk_mar_agency_lever FOREIGN KEY (main_lever_id) REFERENCES mar_lever (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canaux activés par campagne, avec l'agence et le budget affectés (étape ④).
CREATE TABLE mar_campaign_channel (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  channel_id    BIGINT UNSIGNED NOT NULL,
  agency_id     BIGINT UNSIGNED     NULL,
  budget_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  is_enabled    TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_channel (campaign_id, channel_id),
  KEY ix_mar_cc_channel (channel_id),
  KEY ix_mar_cc_agency (agency_id),
  CONSTRAINT fk_mar_cc_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_cc_channel  FOREIGN KEY (channel_id)  REFERENCES mar_channel (id)  ON DELETE RESTRICT,
  CONSTRAINT fk_mar_cc_agency   FOREIGN KEY (agency_id)   REFERENCES mar_agency (id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interventions facturées d'une agence.
CREATE TABLE mar_agency_campaign (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id   BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  channel_id  BIGINT UNSIGNED     NULL,
  fee_amount  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  roi_value   DECIMAL(8,2)        NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_ac_agency (agency_id),
  KEY ix_mar_ac_campaign (campaign_id),
  CONSTRAINT fk_mar_ac_agency   FOREIGN KEY (agency_id)   REFERENCES mar_agency (id)   ON DELETE CASCADE,
  CONSTRAINT fk_mar_ac_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ac_channel  FOREIGN KEY (channel_id)  REFERENCES mar_channel (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Formats de déclinaison créa (landing 800×800, PWA 1080×1920, story, post…).
CREATE TABLE mar_format (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  name       VARCHAR(120)    NOT NULL,
  width_px   SMALLINT UNSIGNED NOT NULL,
  height_px  SMALLINT UNSIGNED NOT NULL,
  note       VARCHAR(200)        NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_format_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Visuel maître d'une campagne, avec son point focal vertical.
CREATE TABLE mar_campaign_asset (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id    BIGINT UNSIGNED NOT NULL,
  file_url       VARCHAR(500)    NOT NULL,
  focal_point_y  DECIMAL(5,2)        NULL COMMENT 'Position verticale du point focal en % (0–100)',
  is_master      TINYINT(1)      NOT NULL DEFAULT 1,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_ca_campaign (campaign_id),
  CONSTRAINT fk_mar_ca_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Déclinaison d'un visuel par format. `override_file_url` porte la surcharge
-- manuelle d'un format individuel.
CREATE TABLE mar_asset_render (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_asset_id BIGINT UNSIGNED NOT NULL,
  format_id         BIGINT UNSIGNED NOT NULL,
  file_url          VARCHAR(500)        NULL,
  override_file_url VARCHAR(500)        NULL,
  status            VARCHAR(20)     NOT NULL DEFAULT 'pending',
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_asset_render (campaign_asset_id, format_id),
  KEY ix_mar_ar_format (format_id),
  CONSTRAINT fk_mar_ar_asset  FOREIGN KEY (campaign_asset_id) REFERENCES mar_campaign_asset (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ar_format FOREIGN KEY (format_id)         REFERENCES mar_format (id)         ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenues & accessoires terrain (tablier, couronne, bonnet…).
-- `campaign_id` nul = accessoire du catalogue, réutilisable.
CREATE TABLE mar_uniform (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED     NULL,
  code        VARCHAR(40)     NOT NULL,
  name        VARCHAR(160)    NOT NULL,
  description VARCHAR(400)        NULL,
  icon_path   TEXT                NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_uniform_code (code),
  KEY ix_mar_uniform_campaign (campaign_id),
  CONSTRAINT fk_mar_uniform_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Postes du rétroplanning.
CREATE TABLE mar_position (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)     NOT NULL,
  label      VARCHAR(120)    NOT NULL,
  sort_order SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_position_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Intervenants internes.
CREATE TABLE mar_consultant (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name   VARCHAR(160)    NOT NULL,
  position_id BIGINT UNSIGNED     NULL,
  email       VARCHAR(190)        NULL,
  user_id     BIGINT UNSIGNED     NULL COMMENT 'Utilisateur du SI hôte, si l''intervenant a un compte',
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_consultant_position (position_id),
  CONSTRAINT fk_mar_consultant_position FOREIGN KEY (position_id) REFERENCES mar_position (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Étapes du rétroplanning : J−30 brief, J−21 BAT, J−15 prod, J−5 mise en ligne, J0 go live.
CREATE TABLE mar_retroplanning_step (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id        BIGINT UNSIGNED NOT NULL,
  label              VARCHAR(200)    NOT NULL,
  days_before_launch SMALLINT        NOT NULL DEFAULT 0,
  position_id        BIGINT UNSIGNED     NULL,
  assignee_user_id   BIGINT UNSIGNED     NULL,
  done_at            DATETIME            NULL,
  sort_order         SMALLINT        NOT NULL DEFAULT 0,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_rs_campaign (campaign_id, sort_order),
  KEY ix_mar_rs_position (position_id),
  CONSTRAINT fk_mar_rs_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_rs_position FOREIGN KEY (position_id) REFERENCES mar_position (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workflow de validation d'une campagne locale hors cadre marque.
CREATE TABLE mar_approval_request (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED     NULL,
  status       VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected',
  reason       TEXT                NULL,
  decided_by   BIGINT UNSIGNED     NULL,
  decided_at   DATETIME            NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_ar_campaign (campaign_id, status),
  CONSTRAINT fk_mar_approval_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
