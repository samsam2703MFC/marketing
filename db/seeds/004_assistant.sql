-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 004 — Référentiels de l'assistant de campagne
--
-- Valeurs reprises de la maquette (design/Reseau.dc.html), où elles étaient des
-- constantes JavaScript. Elles deviennent des lignes : c'est du contenu que le
-- marketing fait évoluer, pas de la structure.
-- =============================================================================

-- Tons éditoriaux.
INSERT INTO mar_tone (code, label, sort_order) VALUES
  ('gourmand',   'Gourmand',   1),
  ('festif',     'Festif',     2),
  ('premium',    'Premium',    3),
  ('convivial',  'Convivial',  4),
  ('chaleureux', 'Chaleureux', 5);

-- Demandes adressées à l'agence lors du brief.
INSERT INTO mar_agency_ask (code, label, sort_order) VALUES
  ('cobranding',  'Collaboration / co-branding',  1),
  ('influenceurs','Influenceurs locaux',          2),
  ('shooting',    'Shooting photo produits',      3),
  ('jeu',         'Jeu concours',                 4),
  ('presse',      'Relations presse locale',      5),
  ('video',       'Vidéo réseaux sociaux',        6);

-- Options de personnalisation du web-shop B2B pour un grand compte.
INSERT INTO mar_b2b_option (code, label, description, sort_order) VALUES
  ('page',        'Page boutique co-brandée',      'Logo du client + habillage campagne sur son espace WS', 1),
  ('catalogue',   'Catalogue restreint',           'Assortiment dédié (plateaux office, formules réunion)', 2),
  ('tarifs',      'Tarifs négociés',               'Grille B2B + remise volume appliquée automatiquement',  3),
  ('code',        'Code d''accès entreprise',      'Accès réservé aux collaborateurs (SSO / code)',         4),
  ('facturation', 'Facturation centralisée',       'Commande groupée, facture mensuelle unique',            5),
  ('livraison',   'Créneaux de livraison dédiés',  'Plages réservées au site du grand compte',              6);

-- Rétroplanning type. Les délais sont comptés en jours avant le lancement, et
-- le poste responsable vient du référentiel des postes.
INSERT INTO mar_retroplanning_default (label, days_before_launch, position_id, sort_order)
SELECT 'Brief agence', 30, p.id, 1 FROM mar_position p WHERE p.label = 'Chef de projet marketing';
INSERT INTO mar_retroplanning_default (label, days_before_launch, position_id, sort_order)
SELECT 'Validation créa (BAT)', 21, p.id, 2 FROM mar_position p WHERE p.label = 'Directeur artistique';
INSERT INTO mar_retroplanning_default (label, days_before_launch, position_id, sort_order)
SELECT 'Production physique', 15, p.id, 3 FROM mar_position p WHERE p.label = 'Chargé de production';
INSERT INTO mar_retroplanning_default (label, days_before_launch, position_id, sort_order)
SELECT 'Mise en ligne digitale', 5, p.id, 4 FROM mar_position p WHERE p.label = 'Consultant digital';
INSERT INTO mar_retroplanning_default (label, days_before_launch, position_id, sort_order)
SELECT 'Go live', 0, p.id, 5 FROM mar_position p WHERE p.label = 'Chef de projet marketing';
