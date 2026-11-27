-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 058 — Les gammes des catalogues imprimés : leur couleur et le modèle de leur page de présentation (27/11/2026)
--
-- Client (maquettes M1, M2, M3 de la construction « gamme par gamme ») : un catalogue se range en BLOCS, un par gamme du
-- webshop — sa page de présentation, puis les pages de ses catégories. Deux choses ne dépendent pas du catalogue :
--   - la COULEUR de la gamme, fixée une fois pour toutes (elle colore le bloc dans l'éditeur et peut servir de couleur
--     de texte ou de fond à la présentation) ; null : celle que la palette de la charte lui donne d'office ;
--   - le MODÈLE de sa page de présentation (photos de la médiathèque, disposition, titre, accroche, texte et leurs
--     styles, fond), qu'une nouvelle présentation reprend ; chaque catalogue en garde ensuite sa copie à lui.
-- Les gammes vivent au webshop (TFBuddy) : `gamme_id` est leur identifiant là-bas, sans clé étrangère.
--
-- Le modèle est un texte JSON (pas une colonne JSON : MySQL 8 réordonnerait ses clés ; le service le relit dans un
-- ordre fixe de toute façon).
--
-- Rejouable : CREATE TABLE IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_catalogue_gamme (
  gamme_id      INT UNSIGNED     NOT NULL COMMENT 'Identifiant de la gamme au webshop (période de disponibilité de TFBuddy)',
  color         CHAR(7)              NULL COMMENT 'Couleur de la gamme, #RRGGBB de la palette des gammes ; null : celle de la palette par défaut',
  presentation  MEDIUMTEXT           NULL COMMENT 'Modèle de la page de présentation (JSON) ; null : pas de modèle',
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    BIGINT UNSIGNED      NULL,
  PRIMARY KEY (gamme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
