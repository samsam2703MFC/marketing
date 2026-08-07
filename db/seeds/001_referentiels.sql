-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- Seeds — référentiels uniquement
--
-- Ce fichier ne contient QUE des données de référence : statuts, leviers,
-- types, formats, postes, secteurs, canaux, templates, accessoires. Ce sont les
-- valeurs que le front lisait en dur dans le prototype et qui doivent désormais
-- venir de la base.
--
-- Aucune donnée de démonstration ici : les campagnes, vouchers, leads, agences
-- et mouvements de fonds de la maquette illustrent des volumes, pas un contenu
-- à reprendre. Ils n'ont pas leur place en seed.
-- =============================================================================

-- Statuts de campagne — couleurs reprises du README de handoff.
INSERT INTO mar_campaign_status (code, label, text_hex, bg_rgba, sort_order) VALUES
  ('live',    'En cours',   '#8D1D2C', 'rgba(141,29,44,.10)',  1),
  ('planned', 'Planifiée',  '#b26a00', 'rgba(200,120,20,.13)', 2),
  ('draft',   'Brouillon',  '#8A847C', 'rgba(120,116,110,.12)',3),
  ('done',    'Terminée',   '#3f7a52', 'rgba(63,122,82,.13)',  4);

-- Leviers business.
-- ⚠️ Les couleurs viennent de LEVER_DEFS du prototype, qui pilote le grand livre
-- et l'analyse. OFFER_LEVERS (sélecteur de l'assistant) donne des couleurs
-- différentes pour RECUR et XP — divergence à trancher côté design, voir
-- db/README.md.
INSERT INTO mar_lever (code, label, color_hex, sort_order) VALUES
  ('TRAFIC',   'Trafic',            '#8D1D2C', 1),
  ('RECUR',    'Récurrence',        '#F2C9A0', 2),
  ('XP',       'Expérience Client', '#C8794A', 3),
  ('FOOD',     'Food-Cost',         '#6B8E5A', 4),
  ('LABOUR',   'Labour-Cost',       '#4A6D8C', 5),
  ('OVERHEAD', 'Overhead-Cost',     '#7A7A7A', 6),
  ('PANIER',   'Panier',            '#4A6D8C', 7);

-- Les 9 types de campagne, avec le levier et le KPI pré-remplis à l'étape ①.
INSERT INTO mar_campaign_type (code, label, default_lever_code, default_kpi_label, icon_path, sort_order) VALUES
  ('ouverture',    'Ouverture de boutique',        'Trafic / notoriété', 'Nouveaux clients, tickets/jour',      'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6', 1),
  ('lancement',    'Lancement / nouveauté',        'XP / panier',        '% tickets incluant le produit',       'M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.6 5.7 21l2.3-7.1-6-4.5h7.6z', 2),
  ('saisonnalite', 'Saisonnalité',                 'Récurrence / panier','CA gamme saisonnière',                'M12 3v18M3 12h18M6 6l12 12M18 6L6 18', 3),
  ('fetes',        'Fêtes (Noël, Épiphanie…)',     'Panier',             'Panier moyen, précommandes',          'M12 2l1.5 4.5H18l-3.7 2.7 1.4 4.3L12 11l-3.7 2.5 1.4-4.3L6 6.5h4.5z', 4),
  ('evenementiel', 'Événementiel local',           'Trafic',             'Fréquentation jour J',                'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 5),
  ('anti_gaspi',   'Anti-gaspi / invendus',        'Food-cost',          'Taux invendus, marge récupérée',      'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14', 6),
  ('acquisition',  'Acquisition',                  'Trafic',             'Nouveaux clients, coût par acquisition','M12 5v14M5 12h14', 7),
  ('retention',    'Rétention / réactivation',     'Récurrence',         'Taux de clients réactivés',           'M21 12a9 9 0 1 1-3-6.7M21 3v5h-5', 8),
  ('partenariat',  'Partenariat / synergie locale','Trafic croisé',      'Scans QR partenaire, trafic apporté', 'M9 3v18M15 3v18M3 9h18M3 15h18', 9);

-- États du suivi commercial des leads, avec les trois couleurs de la pilule.
INSERT INTO mar_lead_status (code, label, color_hex, bg_hex, border_hex, sort_order) VALUES
  ('todo',    'À appeler',       '#8a6d0f', 'rgba(216,170,30,.18)', 'rgba(216,170,30,.55)', 1),
  ('called',  'Contacté · reçu', '#2b6a8f', 'rgba(43,106,143,.13)', 'rgba(43,106,143,.4)',  2),
  ('sent',    'Offre envoyée',   '#b26a00', 'rgba(200,120,20,.15)', 'rgba(200,120,20,.45)', 3),
  ('ordered', 'Commande passée', '#3f7a52', 'rgba(63,122,82,.15)',  'rgba(63,122,82,.45)',  4),
  ('dropped', 'Sans suite',      '#8A847C', 'rgba(34,34,34,.06)',   'rgba(34,34,34,.16)',   5);

-- Secteurs cibles B2B. `estimated_leads_count` alimente le compteur de l'étape ⑦.
INSERT INTO mar_b2b_sector (code, label, estimated_leads_count, sort_order) VALUES
  ('offices',       'Offices & entreprises', 184, 1),
  ('ecoles',        'Écoles & universités',   62, 2),
  ('horeca',        'Horeca',                 97, 3),
  ('evenementiel',  'Événementiel',           41, 4),
  ('administrations','Administrations',       38, 5),
  ('sante',         'Santé & hôpitaux',       29, 6);

-- Formats de déclinaison créa.
-- ⚠️ Le prototype en définit 5 ; le README en annonce 6 (un format « story »
-- manque). À confirmer avant production — voir db/README.md.
INSERT INTO mar_format (code, name, width_px, height_px, note, sort_order) VALUES
  ('landing',   'Landing page',    800,  800, 'Carré site campagne', 1),
  ('pwa',       'PWA',            1080, 1920, 'Écran mobile plein',  2),
  ('fb_post',   'Post Facebook',  1200,  630, 'Fil d''actualité',    3),
  ('ig_post',   'Post Instagram', 1080, 1080, 'Carré feed',          4),
  ('fb_header', 'Header Facebook', 820,  312, 'Couverture de page',  5);

-- Postes du rétroplanning.
INSERT INTO mar_position (code, label, sort_order) VALUES
  ('chef_projet',  'Chef de projet marketing', 1),
  ('dir_artistique','Directeur artistique',    2),
  ('production',   'Chargé de production',     3),
  ('consultant_digital','Consultant digital',  4),
  ('community',    'Community manager',        5);

-- Templates d'offre réutilisables. Leur composition (mar_offer_template_item)
-- dépend du catalogue produit réel : elle se peuple à l'import, pas en seed.
INSERT INTO mar_offer_template (code, label, description, sort_order) VALUES
  ('menu',       'Menu complet',      'Bundle repas + boisson + dessert',        1),
  ('prixbarre',  'Prix barré',        'Produit phare à prix réduit',             2),
  ('decouverte', 'Bundle découverte', 'Nouveauté + best-seller',                 3),
  ('office',     'Offre office B2B',  'Plateau + livraison + voucher B2B',       4);

-- Accessoires et tenues terrain.
INSERT INTO mar_uniform (code, name, description, icon_path, sort_order) VALUES
  ('tablier',  'Tablier brandé été',       'Tablier lin coréen aux couleurs de la saison',    'M8 3h8l-1 4a4 4 0 0 1-6 0zM7 21v-7a5 5 0 0 1 10 0v7z', 1),
  ('couronne', 'Couronne Galette des Rois','Couronne carton dorée portée en boutique',        'M4 18h16l-1-9-4 4-3-6-3 6-4-4z', 2),
  ('chapeau',  'Chapeau de Noël',          'Bonnet rouge équipe pendant les fêtes',           'M4 20c2-7 5-11 8-15 5 3 7 9 8 15z', 3),
  ('tshirt',   'T-shirt événement',        'T-shirt co-brandé (partenariats, portes ouvertes)','M4 7l4-3 4 2 4-2 4 3-2 3-2-1v9H8v-9L6 10z', 4),
  ('badge',    'Badge / pin''s thématique','Épinglette message campagne sur la tenue',        'M12 3a4 4 0 0 1 4 4c0 3-4 8-4 8s-4-5-4-8a4 4 0 0 1 4-4z', 5);

-- Canaux de diffusion.
-- ⚠️ Le prototype ne porte pas de liste de canaux structurée : cette liste est
-- dérivée des écrans « Pub physique & PLV » et « Pub digitale » du README.
-- À valider avec le marketing avant production.
INSERT INTO mar_channel (code, label, family, sort_order) VALUES
  ('meta_ads',    'Meta Ads',            'DIGITAL',  1),
  ('google_local','Google Search local', 'DIGITAL',  2),
  ('email',       'Email',               'DIGITAL',  3),
  ('sms',         'SMS',                 'DIGITAL',  4),
  ('pwa_push',    'Notification PWA',    'DIGITAL',  5),
  ('plv',         'PLV boutique',        'PHYSIQUE', 6),
  ('affichage',   'Affichage extérieur', 'PHYSIQUE', 7),
  ('flyer',       'Flyer / toutes-boîtes','PHYSIQUE',8);
