-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 030 — Redevances : trois natures, un taux par magasin, un CA par mois
--
-- Ce qui alimente le fonds n'est pas saisi à la main : c'est un pourcentage du
-- chiffre d'affaires net de chaque magasin, et il y en a trois — assistance,
-- marque, marketing. Vingt magasins fois trois redevances fois douze mois font
-- sept cent vingt écritures par an ; personne ne les tape, et personne ne relit
-- l'année pour vérifier qu'aucune ne manque.
--
-- `mar_royalty_rate` existe depuis la migration 005 et n'était lue par rien. Elle
-- porte déjà ce qu'il faut — un taux, une boutique, une période de validité — à
-- une chose près : elle ne connaissait qu'une redevance. Elle en connaît trois.
--
-- Les périodes de validité ne sont pas un ornement : un taux se renégocie, et
-- s'il n'y avait qu'un taux courant, réviser un contrat en septembre
-- recalculerait les redevances de janvier au prochain affichage. Une révision
-- ferme donc la ligne précédente et en ouvre une nouvelle ; janvier continue de
-- lire le taux de janvier.
-- =============================================================================

ALTER TABLE mar_royalty_rate
  ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'MARKETING'
    COMMENT 'ASSISTANCE | MARQUE | MARKETING'
    AFTER shop_id,
  -- Deux taux d'une même nature ouverts le même jour pour un même magasin
  -- feraient dépendre la facture de l'ordre de lecture.
  ADD UNIQUE KEY uq_mar_rr_shop_kind_from (shop_id, kind, valid_from),
  ADD KEY ix_mar_rr_lecture (kind, valid_from, valid_to);

-- `mar_shop_revenue` (migration 005 : shop_id + period_month, unique) porte le
-- chiffre d'affaires net du mois. Elle n'était alimentée par rien : rien à
-- créer, tout à remplir.

-- Ce qui manquait à l'écriture pour être vérifiable, et pour se taire quand il
-- le faut.
ALTER TABLE mar_fund_movement
  -- Le fonds marketing se rend des comptes : ce qui l'alimente est lisible par
  -- le réseau. L'assistance et la marque, non — ce sont les revenus de la
  -- marque, et pas l'affaire des franchisés les uns des autres.
  ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '0 = réservé à la marque, 1 = lisible par le réseau'
    AFTER source,
  -- La base et le taux qui ont produit le montant. Sans eux, « 1 240,50 € » ne
  -- se recalcule pas, et un franchisé qui conteste n'a rien à examiner.
  ADD COLUMN base_amount DECIMAL(14,2) NULL
    COMMENT 'CA net ayant servi de base, quand le montant est calculé'
    AFTER amount,
  ADD COLUMN rate_pct DECIMAL(5,2) NULL
    COMMENT 'Taux appliqué à la base, figé au moment du calcul'
    AFTER base_amount,
  -- La génération d'un mois relit ce qu'elle a déjà écrit pour ne pas facturer
  -- deux fois ; sans cet index elle balaierait tout le grand livre.
  ADD KEY ix_mar_fm_redevance (source, period_from, shop_id);

-- Les trois natures deviennent des origines de mouvement à part entière.
-- `mar_fund_movement.source` porte une clé étrangère vers cette table depuis la
-- migration 014 : sans ces lignes, aucune redevance ne pourrait être écrite.
INSERT INTO mar_fund_source (code, label, sort_order) VALUES
  ('ROYALTY_MARKETING',  'Redevance marketing',     6),
  ('ROYALTY_ASSISTANCE', 'Redevance d''assistance', 7),
  ('ROYALTY_MARQUE',     'Redevance de marque',     8)
ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order);

-- Les vues ne sont pas redéfinies ici, pour la raison exposée en 028 et 029 :
-- `migrate.php` rejoue les fichiers `_vues` à chaque passage et écraserait toute
-- définition posée ailleurs. Le grand livre lit `is_public`, `base_amount` et
-- `rate_pct` sur la table, qu'il joint déjà à la vue par son identifiant.
