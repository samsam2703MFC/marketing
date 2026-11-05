-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- Deux supports de plus pour l'assistant (maquette du 05/11/2026) : les bons
-- imprimés, remis en boutique avec le code d'un bon de la campagne, et les
-- goodies (sacs, stickers, badges), qui partent dans le kit des franchisés.
-- =============================================================================

INSERT INTO mar_channel (code, label, family, grp, description, is_paid, lead_days, editor, sort_order)
SELECT * FROM (
  SELECT 'bons_imprimes' AS code, 'Bons imprimés' AS label, 'PHYSIQUE' AS family, 'boutique' AS grp,
         'Cartes remises en caisse, avec le code d’un bon de la campagne' AS description, 0 AS is_paid, 14 AS lead_days, NULL AS editor, 14 AS sort_order UNION ALL
  SELECT 'goodies', 'Goodies & emballages', 'PHYSIQUE', 'boutique', 'Sacs, stickers, badges… livrés aux boutiques', 0, 21, NULL, 15
) AS nouveaux
WHERE NOT EXISTS (SELECT 1 FROM mar_channel existant WHERE existant.code = nouveaux.code);
