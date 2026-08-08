-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- Doublure de l'ERP, pour l'intégration continue uniquement
--
-- La reprise lit les boutiques et les clients professionnels dans le schéma de
-- l'ERP, qui n'existe pas sur un poste de développement ni sur un runner. Sans
-- cette doublure, le test de reprise se contenterait de dire « source absente »
-- et ne vérifierait rien — c'est-à-dire qu'il passerait au vert sans rien
-- prouver.
--
-- Les noms de colonnes sont volontairement différents de ceux du module :
-- `zip` plutôt que `postal_code`, pour que la découverte des colonnes soit
-- réellement exercée et non contournée par une correspondance à l'identique.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS franchise CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP TABLE IF EXISTS franchise.shops;
CREATE TABLE franchise.shops (
  id        INT PRIMARY KEY,
  name      VARCHAR(120),
  city      VARCHAR(120),
  code      VARCHAR(40),
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO franchise.shops VALUES
  (1, 'Bruxelles — Châtelain', 'Bruxelles', 'chatelain', 1),
  (2, 'Uccle',                 'Bruxelles', 'uccle',     1),
  (3, 'Namur',                 'Namur',     'namur',     1),
  (4, 'Gand',                  'Gand',      'gand',      1),
  -- Fermée : elle ne doit pas rejoindre le périmètre des campagnes.
  (5, 'Liège',                 'Liège',     'liege',     0);

DROP TABLE IF EXISTS franchise.customers;
CREATE TABLE franchise.customers (
  id           INT PRIMARY KEY,
  company_name VARCHAR(200),
  email        VARCHAR(190),
  phone        VARCHAR(40),
  city         VARCHAR(120),
  zip          VARCHAR(20),
  shop_id      INT,
  is_b2b       TINYINT(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO franchise.customers VALUES
  (10, 'Deloitte Diegem',        'a@example.test', '010', 'Diegem',    '1831', 1, 1),
  (11, 'Solvay Business School', 'b@example.test', '011', 'Bruxelles', '1050', 2, 1),
  -- Particulier : la reprise ne doit pas le prendre pour un compte à démarcher.
  (12, 'Marie Dupont',           'c@example.test', '012', 'Namur',     '5000', 3, 0),
  (13, 'CHU Namur',              'd@example.test', '013', 'Namur',     '5000', 3, 1);
