-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 036 — Le suivi d'une campagne : quelle action elle doit faire bouger, et où
--
-- Une campagne « Lancement webshop » vise des commandes en ligne ; une
-- ouverture de boutique, du passage en caisse. Rien ne le disait : le levier et
-- son KPI décrivent le type de campagne, pas ce que CETTE campagne a promis de
-- faire bouger, ni s'il se juge boutique par boutique ou pour tout le réseau.
--
-- La liste des actions suivies est un référentiel, comme les leviers : l'écran
-- n'en porte aucune en dur. Chaque action dit son unité et où elle se lit ;
-- celles qui se lisent en caisse donnent la mesure que le cockpit sait calculer
-- (`trafic`, `panier`, `ca` — la route « KPI d'une période »). Les autres
-- (webshop, CRM) disent leur source sans prétendre à un chiffre qu'aucune
-- connexion ne fournit encore.
-- =============================================================================

CREATE TABLE mar_tracking_action (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(32)     NOT NULL,
  label           VARCHAR(120)    NOT NULL,
  unit_label      VARCHAR(40)     NOT NULL COMMENT 'Unité de la cible : « tickets par jour », « commandes »…',
  source_label    VARCHAR(160)    NOT NULL COMMENT 'Où la mesure se lit',
  cockpit_measure VARCHAR(16)         NULL COMMENT 'trafic | panier | ca : mesure du cockpit (KPI d''une période) ; NULL = hors caisse',
  sort_order      SMALLINT        NOT NULL DEFAULT 0,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_tracking_action_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mar_tracking_action (code, label, unit_label, source_label, cockpit_measure, sort_order) VALUES
  ('trafic',        'Trafic en magasin (tickets de caisse)', 'tickets par jour', 'Caisse des boutiques',            'trafic', 1),
  ('commandes_web', 'Commandes en ligne (webshop)',          'commandes',        'Webshop',                         NULL,     2),
  ('clients_b2b',   'Nouveaux clients B2B',                  'clients',          'CRM du module (leads gagnés)',    NULL,     3),
  ('panier',        'Panier moyen',                          '€ par ticket',     'Caisse des boutiques',            'panier', 4);

-- Le choix de la campagne. Tout est facultatif : une campagne sans suivi reste
-- une campagne ; l'assistant le propose, il ne l'impose pas.
--
--   tracking_scope    SHOP = jugée boutique par boutique ; NETWORK = sur le total du réseau
--   tracking_target   la cible, dans l'unité de l'action
--   tracking_baseline N1 = mêmes dates l'an dernier ; AVANT = même durée juste avant le lancement
ALTER TABLE mar_campaign
  ADD COLUMN tracking_action_id BIGINT UNSIGNED NULL
    COMMENT 'Action suivie (mar_tracking_action)' AFTER objective_coef_pct,
  ADD COLUMN tracking_scope ENUM('SHOP', 'NETWORK') NULL
    COMMENT 'SHOP = par boutique ; NETWORK = pour le réseau' AFTER tracking_action_id,
  ADD COLUMN tracking_target DECIMAL(12,2) NULL
    COMMENT 'Cible, dans l''unité de l''action' AFTER tracking_scope,
  ADD COLUMN tracking_baseline ENUM('N1', 'AVANT') NULL
    COMMENT 'N1 = mêmes dates l''an dernier ; AVANT = même durée juste avant' AFTER tracking_target,
  ADD CONSTRAINT fk_mar_campaign_tracking_action
    FOREIGN KEY (tracking_action_id) REFERENCES mar_tracking_action (id) ON DELETE SET NULL;
