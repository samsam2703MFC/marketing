-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 028 — Période couverte par un mouvement de fonds
--
-- Un mouvement n'avait qu'une date : celle où il tombe dans le grand livre.
-- Elle suffit pour un achat de PLV, pas pour ce qui compose l'essentiel du
-- fonds — une redevance trimestrielle, une facture d'agence sur un semestre,
-- une contribution annuelle. « 12 000 € le 14 avril » ne dit pas si l'on paie
-- le premier trimestre ou l'année ; il faut ouvrir la pièce pour le savoir, et
-- deux personnes qui ne l'ouvrent pas comptent deux choses différentes.
--
-- Les deux bornes sont facultatives et vont ensemble : une période ouverte d'un
-- côté ne se totalise pas, et un mouvement ponctuel n'en a pas besoin — sa date
-- dit tout.
-- =============================================================================

ALTER TABLE mar_fund_movement
  ADD COLUMN period_from DATE NULL
    COMMENT 'Début de la période couverte ; NULL = mouvement ponctuel'
    AFTER movement_date,
  ADD COLUMN period_to DATE NULL
    COMMENT 'Fin de la période couverte ; va avec period_from'
    AFTER period_from;

-- La vue du grand livre les rend à son tour : sans cela, l'écran devrait
-- relire la table pour une colonne que la vue a déjà sous la main.
CREATE OR REPLACE VIEW mar_v_fund_ledger_by_period AS
SELECT
  fm.id,
  fm.movement_date,
  fm.period_from,
  fm.period_to,
  DATE_FORMAT(fm.movement_date, '%Y-%m-01')            AS period_month,
  CONCAT(YEAR(fm.movement_date), '-T', QUARTER(fm.movement_date)) AS period_quarter,
  YEAR(fm.movement_date)                                AS period_year,
  fm.direction,
  fm.label,
  fm.amount,
  CASE WHEN fm.direction = 'IN' THEN fm.amount ELSE -fm.amount END AS signed_amount,
  fm.source,
  fm.supplier_name,
  fm.document_ref,
  fm.shop_id,
  s.name                                                AS shop_name,
  fm.campaign_id,
  c.name                                                AS campaign_name,
  fm.lever_id,
  l.code                                                AS lever_code,
  l.label                                               AS lever_label,
  l.color_hex                                           AS lever_color_hex
FROM mar_fund_movement fm
LEFT JOIN mar_shop     s ON s.id = fm.shop_id
LEFT JOIN mar_campaign c ON c.id = fm.campaign_id
LEFT JOIN mar_lever    l ON l.id = fm.lever_id;
