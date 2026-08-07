-- =============================================================================
-- 002 — Campagnes : référentiels, campagne, périmètre, objectifs, KPI
-- =============================================================================

-- Statuts de campagne. Ajouté au modèle : le DATA_MODEL porte `status` en clair
-- sur mar_campaign, mais la règle « les libellés visibles vivent en table de
-- référence » et les couleurs listées au README imposent une table dédiée —
-- sinon la palette de statuts reste codée en dur dans le front.
CREATE TABLE mar_campaign_status (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)     NOT NULL COMMENT 'draft | planned | live | done',
  label       VARCHAR(60)     NOT NULL,
  text_hex    CHAR(7)         NOT NULL,
  bg_rgba     VARCHAR(40)     NOT NULL,
  sort_order  SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_status_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les 9 types de campagne. Chaque type pré-remplit le levier et le KPI attendu
-- à l'étape 1 de l'assistant.
CREATE TABLE mar_campaign_type (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code               VARCHAR(40)     NOT NULL,
  label              VARCHAR(120)    NOT NULL,
  default_lever_code VARCHAR(60)         NULL COMMENT 'Libellé du levier proposé (peut combiner deux leviers : « Trafic / notoriété »)',
  default_kpi_label  VARCHAR(160)        NULL,
  icon_path          TEXT                NULL COMMENT 'Tracé SVG — la librairie d''icônes cible peut le remplacer',
  sort_order         SMALLINT        NOT NULL DEFAULT 0,
  is_active          TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_type_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campagne réseau ou locale.
-- `parent_campaign_id` porte le principe « réseau ⊕ locale » : une campagne
-- locale se greffe sur une campagne réseau sans jamais l'écraser.
CREATE TABLE mar_campaign (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id           BIGINT UNSIGNED NOT NULL,
  type_id            BIGINT UNSIGNED     NULL,
  parent_campaign_id BIGINT UNSIGNED     NULL,
  name               VARCHAR(200)    NOT NULL,
  scope              VARCHAR(10)     NOT NULL DEFAULT 'RESEAU' COMMENT 'RESEAU | LOCALE',
  status_code        VARCHAR(20)     NOT NULL DEFAULT 'draft',
  starts_on          DATE                NULL,
  ends_on            DATE                NULL,
  budget_amount      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  spent_amount       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  owner_user_id      BIGINT UNSIGNED     NULL,
  approval_status    VARCHAR(20)         NULL COMMENT 'pending | approved | rejected — nul si la campagne reste dans le cadre marque',
  create_crm_leads   TINYINT(1)      NOT NULL DEFAULT 1 COMMENT 'Étape ⑦ : génère les mar_crm_lead au lancement',
  image_url          VARCHAR(500)        NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_campaign_brand (brand_id),
  KEY ix_mar_campaign_status (status_code),
  KEY ix_mar_campaign_dates (starts_on, ends_on),
  KEY ix_mar_campaign_parent (parent_campaign_id),
  CONSTRAINT fk_mar_campaign_brand  FOREIGN KEY (brand_id)    REFERENCES mar_brand (id)             ON DELETE RESTRICT,
  CONSTRAINT fk_mar_campaign_type   FOREIGN KEY (type_id)     REFERENCES mar_campaign_type (id)     ON DELETE SET NULL,
  CONSTRAINT fk_mar_campaign_status FOREIGN KEY (status_code) REFERENCES mar_campaign_status (code) ON DELETE RESTRICT,
  CONSTRAINT fk_mar_campaign_parent FOREIGN KEY (parent_campaign_id) REFERENCES mar_campaign (id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Boutiques participantes à une campagne.
CREATE TABLE mar_campaign_shop (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id         BIGINT UNSIGNED NOT NULL,
  shop_id             BIGINT UNSIGNED NOT NULL,
  opt_in_at           DATETIME            NULL,
  local_budget_amount DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_shop (campaign_id, shop_id),
  KEY ix_mar_campaign_shop_shop (shop_id),
  CONSTRAINT fk_mar_campaign_shop_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_campaign_shop_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Objectifs chiffrés par levier (étape ③ de l'assistant).
CREATE TABLE mar_campaign_lever_target (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  lever_id     BIGINT UNSIGNED NOT NULL,
  target_value DECIMAL(14,2)       NULL,
  target_unit  VARCHAR(40)         NULL,
  actual_value DECIMAL(14,2)       NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_campaign_lever (campaign_id, lever_id),
  KEY ix_mar_campaign_lever_lever (lever_id),
  CONSTRAINT fk_mar_clt_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_clt_lever    FOREIGN KEY (lever_id)    REFERENCES mar_lever (id)    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Suivi en direct : tickets/jour, nouveaux clients, panier moyen, conformité XP.
-- `shop_id` nul = mesure au niveau réseau.
CREATE TABLE mar_campaign_kpi_snapshot (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  shop_id      BIGINT UNSIGNED     NULL,
  kpi_code     VARCHAR(40)     NOT NULL,
  kpi_label    VARCHAR(120)        NULL,
  value        DECIMAL(14,2)       NULL,
  target_value DECIMAL(14,2)       NULL,
  unit         VARCHAR(20)         NULL,
  measured_at  DATETIME        NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mar_kpi_campaign (campaign_id, kpi_code, measured_at),
  KEY ix_mar_kpi_shop (shop_id),
  CONSTRAINT fk_mar_kpi_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_kpi_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
