-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 040 — Les réglages et les secrets du module, en base
--
-- Le module doit pouvoir être déplacé dans un autre projet : tout ce qui lui
-- appartient vit sous le préfixe mar_, ses réglages compris. Jusqu'ici, ils
-- étaient dans un fichier .env propre à ce serveur ; ils vont dans deux tables :
--
-- • mar_variable — les réglages (adresses des API, délais, chemins), en clair ;
-- • mar_keys     — les secrets (jetons, mots de passe, secret de session),
--                  chiffrés : une copie de la base ne livre aucun jeton.
--
-- Une colonne `module` sépare les réglages du module Marketing (`marketing`) de
-- ceux du module Social & Ads (`social`), qui fait partie du même ensemble.
--
-- Ce qui ne peut pas y vivre reste hors de la base, par construction : l'accès
-- à la base elle-même (il faut l'avoir pour lire ces tables) et la clé maîtresse
-- qui déchiffre mar_keys (la garder à côté de ce qu'elle protège ne protégerait
-- rien). Voir docs/API_REGISTRY.md, « Variables et clés ».
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_variable (
  module      VARCHAR(20)     NOT NULL DEFAULT 'marketing' COMMENT 'marketing | social',
  name        VARCHAR(80)     NOT NULL,
  value       TEXT                NULL COMMENT 'Valeur encodée en JSON (chaîne, nombre, liste, objet)',
  description VARCHAR(300)        NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (module, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_keys (
  module      VARCHAR(20)     NOT NULL DEFAULT 'marketing' COMMENT 'marketing | social',
  name        VARCHAR(80)     NOT NULL,
  ciphertext  TEXT            NOT NULL COMMENT 'Valeur chiffrée (format « algo:base64 »), liée à son module et à son nom',
  hint        VARCHAR(12)         NULL COMMENT 'Les 4 derniers caractères, pour reconnaître une clé sans la montrer',
  description VARCHAR(300)        NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  BIGINT UNSIGNED     NULL,
  PRIMARY KEY (module, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
