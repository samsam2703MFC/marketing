-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 031 — Les types de campagne deviennent éditables
--
-- Les neuf types sont posés par un seed depuis le premier jour, et n'ont jamais
-- pu bouger : ouvrir une boulangerie salée, lancer une carte traiteur ou monter
-- une opération anniversaire ne rentre dans aucun des neuf, et il fallait
-- réécrire un fichier SQL pour en ajouter un. Le réseau change plus vite que ça.
--
-- Deux colonnes manquaient à la carte que l'écran dessine déjà :
--
-- — sa couleur. L'icône héritait de la couleur du texte, si bien que les neuf
--   cartes se ressemblaient et qu'il fallait lire pour distinguer « Fêtes » de
--   « Anti-gaspi ». Une couleur par type est ce qui permet de le reconnaître
--   avant de l'avoir lu.
-- — l'icône choisie. `icon_path` porte un tracé SVG, ce qui convient pour
--   dessiner mais pas pour se souvenir : rien ne dit quelle entrée de la
--   bibliothèque a été retenue, donc rien ne peut la remettre en évidence à la
--   réouverture. La clé s'ajoute à côté du tracé, sans le remplacer — tout ce
--   qui dessine aujourd'hui continue de lire `icon_path`, l'impression comprise.
-- =============================================================================

ALTER TABLE mar_campaign_type
  ADD COLUMN color_hex CHAR(7) NULL
    COMMENT 'Couleur de l''icône et de l''accent de la carte ; NULL = couleur du texte'
    AFTER label,
  ADD COLUMN icon_key VARCHAR(40) NULL
    COMMENT 'Entrée de la bibliothèque d''icônes retenue ; `icon_path` en garde le tracé'
    AFTER icon_path,
  ADD COLUMN description VARCHAR(300) NULL
    COMMENT 'Ce que le type recouvre, en une phrase ; distinct du KPI attendu'
    AFTER default_kpi_label;

-- La reprise des couleurs vit dans `seeds/005_couleurs_types.sql` et non ici :
-- sur une base neuve, les migrations passent avant les jeux de données, et
-- l'UPDATE ne trouverait aucun type à colorer. Sur une base en place, il n'y
-- verrait que du feu — le genre d'écart qui ne se découvre qu'au déploiement
-- suivant, sur l'installation qu'on n'avait pas sous la main.
