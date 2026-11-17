-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 052 — Les étiquettes des images de la médiathèque (17/11/2026)
--
-- Client : « la possibilité de taguer les images » ; retenu : « 1 et 2 » de la maquette
-- (`docs/maquettes/mediatheque/`) — 1, les étiquettes sur la fiche de l'image ; 2, les étiquettes
-- proposées, à valider — et « un assistant d'import en lot avec la proposition des tags ».
--
-- Pourquoi : la régie d'affichage (dépôt `signage`) tire au sort, pour l'élément « média ciblé »,
-- une image du moment courant (matin avant 11 h, midi, après-midi après 16 h) et d'une saison
-- active ; elle a besoin du produit montré (son prix, sa rupture) et du sens de l'image (portrait,
-- paysage). Sans ces étiquettes, les images du Marketing ne peuvent pas servir aux écrans.
--
-- Les familles à plusieurs valeurs vivent dans `mar_media_tag` : moment (`matin | midi | apres-midi` ;
-- aucun = toute la journée), usage (`ecrans | reseaux | catalogue | webshop | affiche`), produit (l'id
-- du produit du webshop, celui de l'ERP, et son nom tel que le webshop le donne) et libre. La saison
-- et la boutique restent des colonnes de `mar_media` (une seule chacune) ; le format (carré, portrait,
-- paysage) se lit dans la largeur et la hauteur, il n'est pas stocké. La fin de validité est une date.
--
-- Une proposition (`mar_media_tag_proposal`) n'est jamais une étiquette : elle attend un ✓ (elle est
-- alors appliquée) ou un ✕ (elle reste refusée, pour ne pas revenir). Rien n'est inventé : une
-- proposition dit d'après quoi elle est faite (le nom du webshop, le rayon, la transparence…).
-- =============================================================================

ALTER TABLE mar_media
  ADD COLUMN valid_until DATE NULL COMMENT 'Fin de validité (promo, saison) : après cette date, l''image ne sert plus aux écrans' AFTER shop_id,
  ADD KEY ix_mar_media_valid_until (valid_until);

CREATE TABLE IF NOT EXISTS mar_media_tag (
  media_id    BIGINT UNSIGNED NOT NULL COMMENT 'mar_media.id',
  family      VARCHAR(12)     NOT NULL COMMENT 'moment | usage | produit | libre',
  value       VARCHAR(60)     NOT NULL COMMENT 'matin… ; ecrans… ; id du produit du webshop (ERP) ; étiquette libre en minuscules',
  label       VARCHAR(200)        NULL COMMENT 'Nom du produit, tel que le webshop le donne',
  created_by  BIGINT UNSIGNED     NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (media_id, family, value),
  KEY ix_mar_media_tag_value (family, value),
  CONSTRAINT fk_mar_media_tag_media FOREIGN KEY (media_id) REFERENCES mar_media (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mar_media_tag_proposal (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  media_id    BIGINT UNSIGNED NOT NULL COMMENT 'mar_media.id',
  family      VARCHAR(12)     NOT NULL COMMENT 'moment | usage | produit | saison | detouree',
  value       VARCHAR(60)     NOT NULL COMMENT 'La valeur proposée (code de saison pour saison, 1 pour détourée)',
  label       VARCHAR(200)        NULL COMMENT 'Nom du produit proposé',
  reason      VARCHAR(200)    NOT NULL COMMENT 'D''après quoi : « rayon Viennoiserie → matin », « nom du webshop »…',
  status      VARCHAR(10)     NOT NULL DEFAULT 'proposed' COMMENT 'proposed | accepted | refused',
  created_by  BIGINT UNSIGNED     NULL,
  decided_by  BIGINT UNSIGNED     NULL,
  decided_at  DATETIME            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mar_media_tag_proposal (media_id, family, value),
  KEY ix_mar_media_tag_proposal_status (status, media_id),
  CONSTRAINT fk_mar_media_tag_proposal_media FOREIGN KEY (media_id) REFERENCES mar_media (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
