-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 011 — Levier des types de campagne, et cible client
--
-- Trois manques constatés en confrontant l'application à la maquette de
-- référence (design_handoff_marketing_franchise/design/Reseau.dc.html) :
--
-- 1. La maquette affiche sur chaque type de campagne une pastille de levier
--    colorée. Elle la déduisait par correspondance de mots-clés sur le texte
--    libre `default_lever_code` (« si le libellé contient "food" alors vert »).
--    C'est exactement ce que ce projet remplace : la relation type → levier
--    devient une clé étrangère, et la couleur vient de `mar_lever`.
--
-- 2. Deux types portent une formulation propre — « Trafic / notoriété » et
--    « Trafic croisé » — là où le levier s'appelle simplement « Trafic ». La
--    maquette obtenait ce résultat par un effet de bord de son ordre de tests.
--    On le rend explicite : `lever_badge_label` prime quand il est renseigné.
--
-- 3. L'étape 1 de l'assistant propose une cible client (B2C, B2B, mixte) que
--    rien ne stockait. Elle conditionne la génération des leads B2B, donc elle
--    doit vivre sur la campagne et non dans l'état de l'écran.
-- =============================================================================

ALTER TABLE mar_campaign_type
  ADD COLUMN lever_id BIGINT UNSIGNED NULL
    COMMENT 'Levier porté par ce type — remplace la déduction sur default_lever_code'
    AFTER default_lever_code,
  ADD COLUMN lever_badge_label VARCHAR(60) NULL
    COMMENT 'Formulation propre au type (« Trafic / notoriété ») ; à défaut, le libellé du levier'
    AFTER lever_id,
  ADD CONSTRAINT fk_mar_campaign_type_lever
    FOREIGN KEY (lever_id) REFERENCES mar_lever (id) ON DELETE SET NULL;

-- La cible conditionne l'entonnoir B2B : une campagne B2C n'a pas de leads.
ALTER TABLE mar_campaign
  ADD COLUMN client_target VARCHAR(10) NOT NULL DEFAULT 'b2c'
    COMMENT 'b2c | b2b | mixte — pilote la génération des leads B2B'
    AFTER scope;
