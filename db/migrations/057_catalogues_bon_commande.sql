-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 057 — Le bon de commande des catalogues imprimés : les conditions de chaque boutique (25/11/2026)
--
-- Client : « A – E1 – conditions par magasin – contenu exact de ce qu'il y a dans le catalogue », puis « cadre vide à
-- remplir, délai boutique sous chaque catégorie ». Le bon de commande (une feuille A4) reprend le contenu de la version
-- du catalogue ; ce que le catalogue ne dit pas — délai minimum, acompte, dates limites des fêtes, retrait, livraison,
-- mention libre — chaque boutique le règle UNE fois, dans son dashboard, pour tous ses bons. Le Marketing le lit sans le
-- modifier. Une boutique sans ligne ici : le cadre « Conditions de la boutique » du bon s'imprime vide, à remplir.
--
-- Les dates limites des fêtes : une liste de paires [« pour le », « commandes jusqu'au »] en texte JSON — des listes,
-- pas des objets : leur ordre ne bouge pas, quel que soit le moteur.
--
-- Rejouable : CREATE TABLE IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_catalogue_order_conditions (
  shop_id            BIGINT UNSIGNED  NOT NULL COMMENT 'mar_shop.id',
  lead_value         SMALLINT UNSIGNED    NULL COMMENT 'Délai minimum de commande (avec lead_unit) ; null : pas réglé',
  lead_unit          ENUM('hours','days') NULL COMMENT 'Unité du délai minimum',
  deposit_pct        TINYINT UNSIGNED     NULL COMMENT 'Acompte à la commande, en % (0 : pas d''acompte) ; null : pas réglé',
  holiday_deadlines  TEXT                 NULL COMMENT 'Dates limites des fêtes : [["AAAA-MM-JJ pour le", "AAAA-MM-JJ jusqu''au"], …]',
  pickup             TINYINT(1)       NOT NULL DEFAULT 1 COMMENT 'Retrait en boutique',
  delivery           TINYINT(1)       NOT NULL DEFAULT 0 COMMENT 'Livraison',
  delivery_radius_km SMALLINT UNSIGNED    NULL COMMENT 'Rayon de livraison, en km',
  delivery_fee_cents INT UNSIGNED         NULL COMMENT 'Frais de livraison, en centimes',
  note_fr            VARCHAR(200)         NULL COMMENT 'Mention libre (une ligne)',
  note_nl            VARCHAR(200)         NULL COMMENT 'Mention libre en néerlandais ; vide : le français',
  created_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id),
  CONSTRAINT fk_mar_catalogue_order_conditions_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
