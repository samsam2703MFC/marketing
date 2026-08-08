-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 021 — Disponibilité des produits par gamme saisonnière
--
-- L'étape « Offre » filtre catégories et produits par la gamme choisie : il
-- faut donc savoir quels produits vivent dans quelle gamme. L'ERP le sait
-- (`product_availability_period_connection`) ; la reprise recopie ces liens
-- entre les deux familles du catalogue (`category = 'produit'` et `'saison'`).
--
-- Suppression en cascade : un élément retiré du catalogue emporte ses liens,
-- il n'y a rien à orpheliner.
-- =============================================================================

CREATE TABLE mar_offer_item_season (
  item_id        BIGINT UNSIGNED NOT NULL COMMENT 'Référence produit du catalogue',
  season_item_id BIGINT UNSIGNED NOT NULL COMMENT 'Gamme saisonnière du catalogue',
  PRIMARY KEY (item_id, season_item_id),
  KEY ix_mar_ois_season (season_item_id),
  CONSTRAINT fk_mar_ois_item   FOREIGN KEY (item_id)        REFERENCES mar_offer_item (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_ois_season FOREIGN KEY (season_item_id) REFERENCES mar_offer_item (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
