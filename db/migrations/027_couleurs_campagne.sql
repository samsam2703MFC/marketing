-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 027 — Palette de la campagne
--
-- Une campagne n'avait aucune couleur à elle : les supports empruntaient celle
-- de son levier — `mar_lever.color_hex` — qui dit un objectif commercial et non
-- une identité visuelle. Deux campagnes « Trafic » sortaient donc du même
-- violet, et une opération Épiphanie ne pouvait être ni bordeaux ni or.
--
-- Quatre couleurs plutôt qu'une, parce qu'un imprimé en demande quatre : un
-- aplat de fond, un texte lisible dessus, une dominante, et un accent pour le
-- prix. Avec une seule, chaque gabarit dériverait les trois autres — et deux
-- gabarits n'en dériveraient pas les mêmes.
--
-- NULL = la campagne suit la palette par défaut de l'application, définie en un
-- seul endroit dans `CampaignRepository::COLORS`. Écrire ces valeurs par défaut
-- en base les figerait : une campagne créée aujourd'hui garderait l'ancienne
-- palette le jour où la marque change la sienne.
-- =============================================================================

ALTER TABLE mar_campaign
  ADD COLUMN color_primary_hex CHAR(7) NULL
    COMMENT 'Dominante — #RRGGBB ; NULL = palette par défaut'
    AFTER margin_pct_default,
  ADD COLUMN color_secondary_hex CHAR(7) NULL
    COMMENT 'Aplats et fonds — #RRGGBB'
    AFTER color_primary_hex,
  ADD COLUMN color_accent_hex CHAR(7) NULL
    COMMENT 'Prix, pastilles, appels — #RRGGBB'
    AFTER color_secondary_hex,
  ADD COLUMN color_ink_hex CHAR(7) NULL
    COMMENT 'Texte posé sur les aplats clairs — #RRGGBB'
    AFTER color_accent_hex;
