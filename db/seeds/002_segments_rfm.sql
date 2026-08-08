-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 002 — Segments RFM
--
-- Fichier séparé, et non ajout au 001 : celui-ci est déjà appliqué en base et
-- son empreinte est enregistrée. Le modifier ne le rejouerait pas — il ferait
-- seulement échouer la migration suivante, à juste titre.
--
-- ⚠️ Le prototype ne fournit pas cette liste : elle reprend celle nommée dans le
-- schéma (006_crm_client.sql, « nouveaux, réguliers, VIP, dormants… »). Les
-- règles restent à écrire — `rule_json` NULL signifie « segment non calculé »,
-- et l'effectif affiché reste donc à zéro tant que le calcul n'existe pas.
-- =============================================================================

INSERT INTO mar_crm_segment (code, label, color_hex, sort_order) VALUES
  ('nouveaux',  'Nouveaux clients',  '#4A6D8C', 1),
  ('reguliers', 'Clients réguliers', '#6B8E5A', 2),
  ('vip',       'VIP',               '#8D1D2C', 3),
  ('dormants',  'Dormants',          '#b26a00', 4),
  ('perdus',    'Perdus',            '#8A847C', 5);
