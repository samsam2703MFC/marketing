-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 049 — Un catalogue a 8, 12 ou 16 pages
--
-- Demande du client (novembre 2026) : « 8, 12 ou 16 pages, dont les pages 1-2,
-- l'avant-dernière et la dernière sont du template du catalogue fait par le
-- franchiseur ». Le nombre de pages vit dans les réglages JSON du catalogue
-- (`settings.pageCount`, validé par l'API) : pas de colonne.
--
-- Les catalogues d'avant n'en ont pas : on leur donne, une fois, le plus petit
-- format qui contient leurs pages intérieures + 4 (≤ 4 → 8, ≤ 8 → 12, sinon 16).
-- Aucune page n'est retirée : l'API complète une liste plus courte de pages
-- vides à la lecture, et dit (PAGES_OVER_FORMAT) un catalogue qui en aurait
-- plus de 12. Rejouable : seules les lignes sans `pageCount` sont touchées.
-- =============================================================================

UPDATE mar_catalogue
   SET settings = JSON_SET(settings, '$.pageCount',
         CASE
           WHEN COALESCE(JSON_LENGTH(settings, '$.pages'), 0) <= 4 THEN 8
           WHEN JSON_LENGTH(settings, '$.pages') <= 8 THEN 12
           ELSE 16
         END)
 WHERE JSON_EXTRACT(settings, '$.pageCount') IS NULL;
