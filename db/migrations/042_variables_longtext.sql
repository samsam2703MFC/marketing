SET NAMES utf8mb4;

-- =============================================================================
-- 042 — mar_variable.value passe en LONGTEXT.
--
-- Social range désormais ses réglages dans mar_variable (module « social »), et
-- certains sont des caches volumineux : la liste des pages et des comptes
-- publicitaires Meta, le dernier relevé des fiches Google… Ils dépassent les
-- 64 Ko d'un TEXT. Les valeurs déjà enregistrées ne changent pas.
-- Rejouée deux fois, la migration ne fait rien de plus la seconde fois.
-- =============================================================================

ALTER TABLE mar_variable
  MODIFY value LONGTEXT NULL COMMENT 'Valeur encodée en JSON (chaîne, nombre, liste, objet)';
