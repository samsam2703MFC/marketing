-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- Seed 006 — Les supports de l'assistant de campagne (maquette du 04/11/2026)
--
-- Après 001_referentiels, qui crée les huit canaux : ils sont rangés dans les
-- cinq familles de l'assistant (en boutique, extérieur, réseaux sociaux, Google,
-- direct), trois prennent le libellé de la maquette, et onze supports les
-- rejoignent. Les codes et la famille PHYSIQUE / DIGITAL des canaux existants ne
-- changent pas : « Pub physique » et « Pub digitale » les lisent.
-- =============================================================================

-- Les canaux existants, rangés (leur code ne change pas).
UPDATE mar_channel SET grp = 'social',    label = 'Publicité Meta',             description = 'Ciblage par boutique, langue de la pub',                 is_paid = 1, lead_days = 3,  editor = 'social-ads'  WHERE code = 'meta_ads';
UPDATE mar_channel SET grp = 'google',    label = 'Google Ads',                 description = 'Recherche locale — budget à valider avant engagement',    is_paid = 1, lead_days = 7,  editor = NULL          WHERE code = 'google_local';
UPDATE mar_channel SET grp = 'direct',    label = 'Newsletter',                 description = 'Segments du CRM, par boutique',                          is_paid = 0, lead_days = 10, editor = NULL          WHERE code = 'email';
UPDATE mar_channel SET grp = 'direct',                                          description = 'Clients ayant accepté les SMS',                          is_paid = 0, lead_days = 3,  editor = NULL          WHERE code = 'sms';
UPDATE mar_channel SET grp = 'direct',                                          description = 'Clients de l’application, ayant accepté les notifications', is_paid = 0, lead_days = 2,  editor = NULL       WHERE code = 'pwa_push';
UPDATE mar_channel SET grp = 'boutique',  label = 'PLV comptoir & stop-rayons', description = 'Chevalets, étiquettes produits',                         is_paid = 0, lead_days = 7,  editor = NULL          WHERE code = 'plv';
UPDATE mar_channel SET grp = 'exterieur', label = 'Bâches extérieures',         description = 'Façades, clôtures, pignons — déclarées par boutique',     is_paid = 0, lead_days = 7,  editor = 'instore'     WHERE code = 'affichage';
UPDATE mar_channel SET grp = 'exterieur', label = 'Distribution toutes-boîtes', description = 'Autour de chaque boutique, par un prestataire',          is_paid = 0, lead_days = 10, editor = NULL          WHERE code = 'flyer';

-- Les supports qui n'avaient pas de canal.
INSERT INTO mar_channel (code, label, family, grp, description, is_paid, lead_days, editor, sort_order)
SELECT * FROM (
  SELECT 'affiches'     AS code, 'Affiches'                   AS label, 'PHYSIQUE' AS family, 'boutique'  AS grp, 'Cadres A1 · A2 · A3 déclarés par boutique'            AS description, 0 AS is_paid, 3  AS lead_days, 'instore'       AS editor, 10 AS sort_order UNION ALL
  SELECT 'ecrans',        'Écrans des magasins',                      'PHYSIQUE',          'boutique',          'Régie d’affichage des boutiques',                                    0,              7,              'instore',                  11 UNION ALL
  SELECT 'animation',     'Animation en boutique',                    'PHYSIQUE',          'boutique',          'Dégustation, atelier, jeu',                                          0,              14,             NULL,                       12 UNION ALL
  SELECT 'leaflet',       'Leaflet A5',                               'PHYSIQUE',          'exterieur',         'Recto-verso, une version par boutique et par langue',                0,              21,             'brochures',                20 UNION ALL
  SELECT 'depliant',      'Dépliant A4 3 volets',                     'PHYSIQUE',          'exterieur',         'La carte de la gamme',                                               0,              21,             'brochures',                21 UNION ALL
  SELECT 'partenaires',   'Partenaires locaux',                       'PHYSIQUE',          'exterieur',         'Dépôt chez un commerce voisin, QR croisé',                           0,              14,             NULL,                       22 UNION ALL
  SELECT 'vehicules',     'Véhicules',                                'PHYSIQUE',          'exterieur',         'Lettrage, magnet',                                                   0,              21,             NULL,                       23 UNION ALL
  SELECT 'posts_meta',    'Posts Facebook & Instagram',               'DIGITAL',           'social',            'Calendrier éditorial, une boutique ou le réseau',                    0,              3,              'social-post',              30 UNION ALL
  SELECT 'stories',       'Stories & Reels',                          'DIGITAL',           'social',            'Format 9:16',                                                        0,              3,              'social-post',              31 UNION ALL
  SELECT 'gbp_post',      'Post sur la fiche Google',                 'DIGITAL',           'google',            'Nouveauté ou offre sur la fiche de chaque boutique — pas une publicité', 0,          2,              'social-google',            40 UNION ALL
  SELECT 'avis_google',   'Relance des avis Google',                  'DIGITAL',           'google',            'Carte QR « laissez un avis » en caisse',                             0,              7,              'social-google',            41
) AS nouveaux
WHERE NOT EXISTS (SELECT 1 FROM mar_channel existant WHERE existant.code = nouveaux.code);

-- L'ordre des cartes dans chaque famille, celui de la maquette.
UPDATE mar_channel SET sort_order = CASE code
  WHEN 'affiches' THEN 10 WHEN 'ecrans' THEN 11 WHEN 'plv' THEN 12 WHEN 'animation' THEN 13
  WHEN 'affichage' THEN 20 WHEN 'leaflet' THEN 21 WHEN 'depliant' THEN 22 WHEN 'flyer' THEN 23 WHEN 'partenaires' THEN 24 WHEN 'vehicules' THEN 25
  WHEN 'posts_meta' THEN 30 WHEN 'meta_ads' THEN 31 WHEN 'stories' THEN 32
  WHEN 'gbp_post' THEN 40 WHEN 'google_local' THEN 41 WHEN 'avis_google' THEN 42
  WHEN 'email' THEN 50 WHEN 'sms' THEN 51 WHEN 'pwa_push' THEN 52
  ELSE sort_order END
WHERE grp IS NOT NULL;

