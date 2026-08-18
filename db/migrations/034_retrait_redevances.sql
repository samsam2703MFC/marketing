-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 034 — Retrait des redevances, côté base
--
-- L'écran, les routes et les dépôts sont partis le 17 août. La base avait été
-- laissée en l'état ce jour-là, pour la raison écrite au registre : un `DROP`
-- est irréversible et n'a pas à être pris dans le même mouvement qu'un retrait
-- de fonctionnalité. Le retrait est redemandé, donc voici cette migration.
--
-- Elle ne détruit **aucune donnée saisie**. Chaque suppression est conditionnée
-- à l'absence de contenu : là où quelqu'un a réellement enregistré un taux ou
-- écrit une redevance au grand livre, l'objet reste, inerte et invisible, et
-- son sort se décide en le regardant plutôt qu'en le devinant d'ici.
--
-- Ce qui reste dans tous les cas :
--
--   • `mar_fund_source.ROYALTY` — origine du fonds depuis la migration 005,
--     antérieure aux redevances : c'est la ligne de recette du fonds marketing,
--     pas un reste de l'outil retiré ;
--   • `mar_shop_revenue` — le CA réseau, lu par la synthèse par levier pour la
--     pénétration ; elle n'a de « redevance » que son commentaire d'origine ;
--   • `mar_fund_movement.is_public` — la visibilité d'une écriture, demandée
--     pour elle-même.
-- =============================================================================

-- L'index posé en 030 ne servait qu'à la génération d'un mois de redevances,
-- qui relisait ce qu'elle avait déjà écrit pour ne pas facturer deux fois. Il
-- ne part pas pour autant : commençant par `source`, MySQL s'en est saisi pour
-- porter la clé étrangère vers `mar_fund_source`, et le supprimer laisserait
-- cette clé sans index. Il change donc de nom pour dire ce qu'il fait
-- désormais, et rien de plus.
SET @a_renommer = (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name   = 'mar_fund_movement'
     AND index_name   = 'ix_mar_fm_redevance'
);
SET @ordre = IF(@a_renommer > 0,
  'ALTER TABLE mar_fund_movement RENAME INDEX ix_mar_fm_redevance TO ix_mar_fm_source',
  'DO 0');
PREPARE retrait FROM @ordre;
EXECUTE retrait;
DEALLOCATE PREPARE retrait;

-- L'assiette et le taux d'une écriture calculée. Ils ne partent que si aucune
-- écriture n'en porte : « 1 240,50 € » sans sa base ni son taux ne se recalcule
-- pas, et un franchisé qui conteste n'aurait plus rien à examiner.
SET @ecritures_calculees = (
  SELECT COUNT(*) FROM mar_fund_movement
   WHERE base_amount IS NOT NULL OR rate_pct IS NOT NULL
);
SET @ordre = IF(@ecritures_calculees = 0,
  'ALTER TABLE mar_fund_movement DROP COLUMN base_amount, DROP COLUMN rate_pct',
  'DO 0');
PREPARE retrait FROM @ordre;
EXECUTE retrait;
DEALLOCATE PREPARE retrait;

-- Les trois natures de redevance comme origines de mouvement. Une origine
-- référencée par une écriture ne peut pas partir — la clé étrangère posée en
-- 014 le refuserait, et elle a raison : la ligne comptable perdrait son
-- libellé.
-- `NOT EXISTS` et non `NOT IN` : une seule écriture sans origine suffirait à
-- rendre `NOT IN` indécidable, et la suppression ne toucherait plus rien.
DELETE s FROM mar_fund_source s
 WHERE s.code IN ('ROYALTY_MARKETING', 'ROYALTY_ASSISTANCE', 'ROYALTY_MARQUE')
   AND NOT EXISTS (SELECT 1 FROM mar_fund_movement m WHERE m.source = s.code);

-- La grille des taux. Elle n'était lue par rien d'autre que l'outil retiré ;
-- vide, elle ne laisse rien derrière elle.
SET @taux_saisis = (SELECT COUNT(*) FROM mar_royalty_rate);
SET @ordre = IF(@taux_saisis = 0, 'DROP TABLE mar_royalty_rate', 'DO 0');
PREPARE retrait FROM @ordre;
EXECUTE retrait;
DEALLOCATE PREPARE retrait;
