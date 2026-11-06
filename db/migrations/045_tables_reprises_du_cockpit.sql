-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 045 — Le Marketing devient le seul propriétaire de ses tables (docs/PORTAILS.md)
--
-- Le cockpit (consultant_BO) créait lui-même 23 tables mar_ : avis Google,
-- contrôle des posts (brand guard), posts sociaux et leurs publications, mesure
-- des campagnes, annexes, newsletter clients. Elles appartiennent au portail
-- Marketing : leur définition vit désormais ici, et le cockpit cesse de les créer.
--
-- En production elles existent déjà (créées par le cockpit) : CREATE TABLE IF
-- NOT EXISTS ne touche à rien, aucune donnée ne bouge. Sur une base neuve — celle
-- de l'ERP à la sortie du bac à sable — elles naissent ici, avec les colonnes
-- que le cockpit leur avait ajoutées depuis.
--
-- Les clés étrangères vers ceo_shop (une table du portail Pilotage) ne sont pas
-- reprises : un portail ne dépend pas des tables d'un autre. shop_id garde son
-- index ; l'intégrité se vérifie par l'API de Pilotage.
--
-- Même règle pour mar_agency : les quatre colonnes que le cockpit lui ajoutait
-- (email, site, logo, agence par défaut) entrent par cette migration, seulement
-- si elles manquent.
-- =============================================================================

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_avis (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  shop_id     VARCHAR(8)   NOT NULL,
  source      VARCHAR(20)  NOT NULL DEFAULT 'google',
  external_id VARCHAR(160) NULL,            -- id de l'avis chez la source
  author      VARCHAR(120) NULL,
  rating      TINYINT      NOT NULL,        -- 1..5
  comment     TEXT         NULL,
  reviewed_at DATETIME     NOT NULL,
  replied_at  DATETIME     NULL,            -- réponse du magasin, si elle existe
  UNIQUE KEY uq_review_source (source, external_id),
  KEY idx_review_shop (shop_id, reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_avis_fiche (
  shop_id      VARCHAR(8)   PRIMARY KEY,
  place_id     VARCHAR(120) NULL,           -- identifiant Google de la fiche
  profile_url  VARCHAR(400) NULL,           -- lien public, pour ouvrir la fiche
  rating_avg   DECIMAL(3,2) NULL,           -- note moyenne affichée par Google
  rating_count INT          NOT NULL DEFAULT 0,
  synced_at    DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_bg_regle (
  code        VARCHAR(40)  PRIMARY KEY,
  famille     VARCHAR(60)  NOT NULL,
  libelle     VARCHAR(160) NOT NULL,
  description TEXT         NOT NULL,
  gravite     ENUM('bloquant','majeur','mineur') NOT NULL DEFAULT 'majeur',
  actif       TINYINT(1)   NOT NULL DEFAULT 1,
  rang        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  maj_le      DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_bg_page (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id          VARCHAR(8)   NULL,
  boutique         VARCHAR(80)  NOT NULL,
  franchise        VARCHAR(120) NOT NULL DEFAULT '',
  page_url         VARCHAR(300) NOT NULL DEFAULT '',
  page_id          VARCHAR(40)  NULL,
  page_nom         VARCHAR(160) NULL,
  statut_connexion ENUM('a_connecter','connectee','erreur') NOT NULL DEFAULT 'a_connecter',
  derniere_erreur  VARCHAR(300) NULL,
  derniere_sync    DATETIME     NULL,
  webhook_abonne   TINYINT(1)   NOT NULL DEFAULT 0,
  actif            TINYINT(1)   NOT NULL DEFAULT 1,
  KEY idx_page (page_id),
  KEY idx_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_bg_controle (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id        VARCHAR(16)  NULL,           -- la demande (mar_social_post), flux « avant »
  fb_post_id     VARCHAR(64)  NULL,           -- le post Facebook, flux « après »
  shop_id        VARCHAR(8)   NULL,
  boutique       VARCHAR(80)  NULL,
  source         ENUM('avant','apres') NOT NULL,
  sauvage        TINYINT(1)   NOT NULL DEFAULT 0,
  statut         ENUM('conforme','a_corriger','bloque') NOT NULL,
  score          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ecarts_json    JSON         NULL,           -- [{regle, libelle, famille, gravite, constat, correction, moteur}]
  message        TEXT         NULL,           -- le message au franchisé
  charte_version CHAR(12)     NOT NULL,
  moteur         VARCHAR(20)  NOT NULL DEFAULT 'claude',  -- claude | regles
  modele         VARCHAR(60)  NULL,
  images_json    JSON         NULL,           -- liens directs des visuels contrôlés
  lien           VARCHAR(400) NULL,
  publie_le      DATETIME     NULL,
  texte          TEXT         NULL,
  notifie_le     DATETIME     NULL,
  created_at     DATETIME     NOT NULL,
  KEY idx_fb (fb_post_id),
  KEY idx_post (post_id),
  KEY idx_shop (shop_id, created_at),
  KEY idx_sauvage (sauvage, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_social_post (
  id               VARCHAR(16) PRIMARY KEY,
  shop_id          VARCHAR(8)   NULL,           -- NULL = post réseau (pas d'ancrage local exigé)
  author           VARCHAR(120) NOT NULL,       -- le franchisé ou le community manager qui soumet
  format           VARCHAR(20)  NOT NULL,       -- Photo | Carrousel | Vidéo | Texte | Lien | Événement
  message          TEXT         NOT NULL,
  link             VARCHAR(400) NULL,
  medias_json      JSON         NULL,           -- [{'nom','type','alt','largeur','hauteur'}]
  planned_at       DATETIME     NULL,           -- publication souhaitée
  submitted_at     DATETIME     NOT NULL,
  status           ENUM('brouillon','a_controler','a_valider','valide','refuse','publie') NOT NULL DEFAULT 'a_controler',
  agent_note       TINYINT      NULL,           -- 1..5, proposition de l'agent
  agent_summary    VARCHAR(400) NULL,
  agent_ran_at     DATETIME     NULL,
  agent_runs       SMALLINT     NOT NULL DEFAULT 0,
  note             TINYINT      NULL,           -- 1..5, décision humaine (peut diverger de l'agent)
  decision_famille VARCHAR(60)  NULL,           -- obligatoire sous le seuil / en cas de refus
  decision_type    VARCHAR(80)  NULL,
  decision_comment TEXT         NULL,
  decided_at       DATETIME     NULL,
  decided_by       VARCHAR(80)  NULL,
  published_at     DATETIME     NULL,
  fb_post_id       VARCHAR(64)  NULL,           -- id Facebook (publié par le portail, ou saisi à la main)
  reseaux          VARCHAR(40)  NOT NULL DEFAULT 'facebook',  -- facebook,instagram,linkedin (portail Marketing)
  campagne_id      INT          NULL,           -- mar_campaign.id : la campagne du post
  KEY idx_status (status, planned_at),
  KEY idx_shop (shop_id, planned_at),
  KEY k_campagne (campagne_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_social_ecart (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id    VARCHAR(16)  NOT NULL,
  rule_code  VARCHAR(40)  NOT NULL,
  rule_name  VARCHAR(120) NOT NULL,
  famille    VARCHAR(60)  NOT NULL,
  type       VARCHAR(80)  NOT NULL,
  gravite    TINYINT      NOT NULL,             -- 1 mineur | 2 majeur | 3 critique
  message    VARCHAR(400) NOT NULL,
  extrait    VARCHAR(200) NULL,                 -- le passage en cause, pour la relecture
  status     ENUM('ouvert','ignore','corrige') NOT NULL DEFAULT 'ouvert',
  created_at DATETIME     NOT NULL,
  KEY idx_post (post_id, gravite),
  CONSTRAINT fk_finding_post FOREIGN KEY (post_id) REFERENCES mar_social_post(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_social_publication (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id     VARCHAR(16)  NOT NULL,
  reseau      VARCHAR(12)  NOT NULL,                     -- facebook | instagram | linkedin
  statut      VARCHAR(10)  NOT NULL DEFAULT 'programme', -- programme | en_cours | publie | erreur | annule
  prevu_le    DATETIME     NOT NULL,
  publie_le   DATETIME     NULL,
  cible       VARCHAR(80)  NULL,                         -- la page, le compte, l'organisation
  externe_id  VARCHAR(120) NULL,                         -- l'identifiant rendu par le réseau
  lien        VARCHAR(400) NULL,
  erreur      VARCHAR(400) NULL,
  tentatives  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  cree_le     DATETIME     NOT NULL,
  maj_le      DATETIME     NULL,
  UNIQUE KEY u_post_reseau (post_id, reseau),
  KEY k_du (statut, prevu_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/mkt_annexes.php
CREATE TABLE IF NOT EXISTS mar_campagne_annexe_type (
        id INT AUTO_INCREMENT PRIMARY KEY,
        label VARCHAR(120) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY u_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/mkt_annexes.php
CREATE TABLE IF NOT EXISTS mar_campagne_annexe (
        id INT AUTO_INCREMENT PRIMARY KEY,
        campaign_id INT NOT NULL,
        type_id INT NULL,
        label VARCHAR(190) NOT NULL,
        file_name VARCHAR(190) NOT NULL,
        size_bytes INT NOT NULL DEFAULT 0,
        in_mail TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL,
        KEY k_campagne (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/mesure.php
CREATE TABLE IF NOT EXISTS mar_campagne_mesure (
  campagne_id INT NOT NULL,
  ref_debut DATE NULL,
  ref_fin DATE NULL,
  remanence_jours INT NOT NULL DEFAULT 14,
  temoins VARCHAR(160) NULL,
  n1 TINYINT(1) NOT NULL DEFAULT 1,
  cible_trafic DECIMAL(6,2) NULL,
  cible_panier DECIMAL(6,2) NULL,
  cible_ca DECIMAL(6,2) NULL,
  cible_promo DECIMAL(6,2) NULL,
  cible_fb INT NULL,
  produits TEXT NULL,
  cout DECIMAL(12,2) NULL,
  marge_pct DECIMAL(5,2) NULL,
  gele_le DATETIME NULL,
  maj DATETIME NULL,
  PRIMARY KEY (campagne_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/endpoints.php
CREATE TABLE IF NOT EXISTS mar_campagne_objectif (
  campagne_id INT NOT NULL,
  shop_id VARCHAR(32) NOT NULL,
  objectif DECIMAL(12,2) NULL,
  maj DATETIME NULL,
  PRIMARY KEY (campagne_id, shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_campagne_objectif_produit (
  campagne_id INT         NOT NULL,
  shop_id     VARCHAR(32) NOT NULL,
  pieces      INT         NULL,
  maj         DATETIME    NULL,
  PRIMARY KEY (campagne_id, shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/sql/schema.sql
CREATE TABLE IF NOT EXISTS mar_campagne_produit (
  campagne_id INT          NOT NULL,
  product_id  INT          NOT NULL,   -- identifiant de caisse (product.id, tickets du panel)
  nom         VARCHAR(200) NOT NULL DEFAULT '',
  categorie   VARCHAR(120) NULL,
  PRIMARY KEY (campagne_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/mesure.php
CREATE TABLE IF NOT EXISTS mar_campagne_releve (
  campagne_id INT NOT NULL,
  shop_id VARCHAR(32) NOT NULL,
  phase VARCHAR(8) NOT NULL,
  abonnes INT NULL,
  releve_le DATE NULL,
  maj DATETIME NULL,
  PRIMARY KEY (campagne_id, shop_id, phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/mesure.php
CREATE TABLE IF NOT EXISTS mar_campagne_snapshot (
  campagne_id INT NOT NULL,
  kpi VARCHAR(32) NOT NULL,
  shop_id VARCHAR(32) NOT NULL,
  valeur DECIMAL(16,3) NULL,
  mesure_le DATETIME NULL,
  PRIMARY KEY (campagne_id, kpi, shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter.php
CREATE TABLE IF NOT EXISTS mar_nl_source (
  id VARCHAR(16) PRIMARY KEY,
  table_ref VARCHAR(60) NOT NULL,
  nom_json TEXT NOT NULL,
  total INT NOT NULL DEFAULT 0,
  optin INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter.php
CREATE TABLE IF NOT EXISTS mar_nl_segment (
  id VARCHAR(40) PRIMARY KEY,
  source_id VARCHAR(16) NOT NULL,
  shop_id VARCHAR(16) NOT NULL DEFAULT '',
  nom_json TEXT NOT NULL,
  regle_json TEXT NOT NULL,
  rules_json TEXT NULL,
  total INT NOT NULL DEFAULT 0,
  split_fr INT NOT NULL DEFAULT 0,
  split_nl INT NOT NULL DEFAULT 0,
  split_en INT NOT NULL DEFAULT 0,
  created_by VARCHAR(16) NOT NULL DEFAULT 'brand',
  created_at DATETIME NULL,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter.php
CREATE TABLE IF NOT EXISTS mar_nl_magasin (
  shop_id VARCHAR(16) PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  sender_name VARCHAR(120) NOT NULL,
  sender_email VARCHAR(190) NOT NULL DEFAULT '',
  domain_status VARCHAR(12) NOT NULL DEFAULT 'unverified',
  can_send TINYINT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter.php
CREATE TABLE IF NOT EXISTS mar_nl_campagne (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(160) NOT NULL,
  source_id VARCHAR(16) NOT NULL,
  segment_id VARCHAR(40) NOT NULL,
  langues VARCHAR(12) NOT NULL DEFAULT 'fr',
  template_id VARCHAR(16) NOT NULL DEFAULT 'blank',
  channel VARCHAR(8) NOT NULL DEFAULT 'email',
  subjects_json TEXT NULL,
  bodies_json MEDIUMTEXT NULL,
  sms_json TEXT NULL,
  social_json TEXT NULL,
  send_mode VARCHAR(8) NOT NULL DEFAULT 'manual',
  trigger_rule VARCHAR(24) NULL,
  send_at DATETIME NULL,
  max_vouchers INT NULL,
  sender_shop_id VARCHAR(16) NOT NULL DEFAULT 'brand',
  statut VARCHAR(8) NOT NULL DEFAULT 'sched',
  test_sent TINYINT NOT NULL DEFAULT 0,
  stats_json TEXT NULL,
  exemple TINYINT NOT NULL DEFAULT 0,
  created_by VARCHAR(16) NOT NULL DEFAULT 'brand',
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  headlines_json TEXT NULL,
  ctas_json TEXT NULL,
  image VARCHAR(40) NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  auto_dernier DATE NULL,
  campagne_id INT NULL,
  lien VARCHAR(500) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter_envoi.php
CREATE TABLE IF NOT EXISTS mar_nl_contact (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_id VARCHAR(16) NOT NULL,
  shop_id VARCHAR(16) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL,
  telephone VARCHAR(32) NOT NULL DEFAULT '',
  prenom VARCHAR(80) NOT NULL DEFAULT '',
  nom VARCHAR(80) NOT NULL DEFAULT '',
  langue CHAR(2) NOT NULL DEFAULT 'fr',
  optin TINYINT NOT NULL DEFAULT 1,
  optin_sms TINYINT NOT NULL DEFAULT 0,
  dernier_achat DATE NULL,
  panier DECIMAL(8,2) NULL,
  produits VARCHAR(255) NOT NULL DEFAULT '',
  anniversaire DATE NULL,
  cree_le DATE NULL,
  desinscrit_le DATETIME NULL,
  token CHAR(32) NOT NULL,
  lot VARCHAR(40) NOT NULL DEFAULT '',
  importe_le DATETIME NOT NULL,
  UNIQUE KEY u_src_email (source_id, email),
  KEY k_token (token), KEY k_lot (lot), KEY k_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter_envoi.php
CREATE TABLE IF NOT EXISTS mar_nl_envoi (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campagne_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NOT NULL,
  langue CHAR(2) NOT NULL DEFAULT 'fr',
  token CHAR(32) NOT NULL,
  sent_at DATETIME NOT NULL,
  opened_at DATETIME NULL,
  clicked_at DATETIME NULL,
  voucher VARCHAR(12) NULL,
  erreur VARCHAR(200) NULL,
  UNIQUE KEY u_camp_contact (campagne_id, contact_id),
  KEY k_token (token), KEY k_contact_jour (contact_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- repris de consultant_BO/src/newsletter_envoi.php
CREATE TABLE IF NOT EXISTS mar_nl_voucher (
  code VARCHAR(12) PRIMARY KEY,
  campagne_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  utilise_le DATETIME NULL,
  shop_id VARCHAR(16) NULL,
  KEY k_camp (campagne_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_agency' AND column_name = 'email'
);
SET @ordre = IF(@manque, 'ALTER TABLE mar_agency ADD COLUMN `email` VARCHAR(190) NULL', 'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_agency' AND column_name = 'site'
);
SET @ordre = IF(@manque, 'ALTER TABLE mar_agency ADD COLUMN `site` VARCHAR(190) NULL', 'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_agency' AND column_name = 'logo_uri'
);
SET @ordre = IF(@manque, 'ALTER TABLE mar_agency ADD COLUMN `logo_uri` MEDIUMTEXT NULL', 'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;

SET @manque = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'mar_agency' AND column_name = 'is_default'
);
SET @ordre = IF(@manque, 'ALTER TABLE mar_agency ADD COLUMN `is_default` TINYINT(1) NOT NULL DEFAULT 0', 'DO 0');
PREPARE ajout FROM @ordre;
EXECUTE ajout;
DEALLOCATE PREPARE ajout;
