-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 010 — Vues d'agrégat
--
-- Les écrans lisent des agrégats, pas des lignes brutes. Ces vues portent la
-- logique de regroupement côté base pour que le front n'ait rien à recalculer.
--
-- Note : ce sont des vues SQL simples, pas des vues matérialisées (MySQL n'en a
-- pas nativement). Si les volumes l'imposent, les basculer en tables de cache
-- rafraîchies par tâche planifiée — l'interface de lecture reste la même.
-- =============================================================================

-- Grand livre groupable mois / trimestre / année.
-- Le regroupement final se fait par la requête appelante sur period_month,
-- period_quarter ou period_year ; le solde courant se calcule en fenêtre.
CREATE OR REPLACE VIEW mar_v_fund_ledger_by_period AS
SELECT
  fm.id,
  fm.movement_date,
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

-- Dépense, ventes générées, ROI et pénétration par levier.
CREATE OR REPLACE VIEW mar_v_lever_performance AS
SELECT
  l.id                                    AS lever_id,
  l.code                                  AS lever_code,
  l.label                                 AS lever_label,
  l.color_hex,
  COALESCE(spend.spent_amount, 0)         AS spent_amount,
  COALESCE(target.target_value, 0)        AS target_value,
  COALESCE(target.actual_value, 0)        AS actual_value,
  CASE
    WHEN COALESCE(spend.spent_amount, 0) = 0 THEN NULL
    ELSE ROUND(COALESCE(target.actual_value, 0) / spend.spent_amount, 2)
  END                                     AS roi_value
FROM mar_lever l
LEFT JOIN (
  SELECT lever_id, SUM(amount) AS spent_amount
  FROM mar_fund_movement
  WHERE direction = 'OUT' AND lever_id IS NOT NULL
  GROUP BY lever_id
) spend ON spend.lever_id = l.id
LEFT JOIN (
  SELECT lever_id, SUM(target_value) AS target_value, SUM(actual_value) AS actual_value
  FROM mar_campaign_lever_target
  GROUP BY lever_id
) target ON target.lever_id = l.id;

-- KPI temps réel d'une campagne : dernière mesure connue par KPI et par boutique.
CREATE OR REPLACE VIEW mar_v_campaign_monitor AS
SELECT
  k.campaign_id,
  k.shop_id,
  s.name        AS shop_name,
  k.kpi_code,
  k.kpi_label,
  k.value,
  k.target_value,
  k.unit,
  k.measured_at,
  CASE
    WHEN k.target_value IS NULL OR k.target_value = 0 THEN NULL
    ELSE ROUND(k.value / k.target_value * 100, 1)
  END           AS attainment_pct
FROM mar_campaign_kpi_snapshot k
LEFT JOIN mar_shop s ON s.id = k.shop_id
WHERE k.measured_at = (
  SELECT MAX(k2.measured_at)
  FROM mar_campaign_kpi_snapshot k2
  WHERE k2.campaign_id = k.campaign_id
    AND k2.kpi_code    = k.kpi_code
    AND (k2.shop_id = k.shop_id OR (k2.shop_id IS NULL AND k.shop_id IS NULL))
);

-- Entonnoir des leads : le compte par état affiché en tête du tableau CRM.
--
-- Le produit cartésien campagnes × états est délibéré : l'entonnoir doit
-- afficher les cinq états en permanence, y compris ceux à zéro. Un simple
-- GROUP BY sur mar_crm_lead ferait disparaître les états vides, et les filtrer
-- par campagne les perdrait de toute façon (leur campaign_id serait NULL).
CREATE OR REPLACE VIEW mar_v_lead_funnel AS
SELECT
  c.id          AS campaign_id,
  st.code       AS status_code,
  st.label      AS status_label,
  st.color_hex,
  st.bg_hex,
  st.border_hex,
  st.sort_order,
  COUNT(ld.id)  AS leads_count
FROM mar_campaign c
CROSS JOIN mar_lead_status st
LEFT JOIN mar_crm_lead ld
       ON ld.campaign_id = c.id
      AND ld.status_code = st.code
GROUP BY c.id, st.code, st.label, st.color_hex, st.bg_hex, st.border_hex, st.sort_order;

-- Même entonnoir, ventilé par boutique référente. Séparé de la vue précédente :
-- ici le zéro-remplissage porte sur les boutiques réellement rattachées à la
-- campagne, pas sur toutes les boutiques du réseau.
CREATE OR REPLACE VIEW mar_v_lead_funnel_by_shop AS
SELECT
  cs.campaign_id,
  cs.shop_id,
  s.name        AS shop_name,
  st.code       AS status_code,
  st.label      AS status_label,
  st.color_hex,
  st.sort_order,
  COUNT(ld.id)  AS leads_count
FROM mar_campaign_shop cs
JOIN mar_shop s ON s.id = cs.shop_id
CROSS JOIN mar_lead_status st
LEFT JOIN mar_crm_lead ld
       ON ld.campaign_id = cs.campaign_id
      AND ld.shop_id     = cs.shop_id
      AND ld.status_code = st.code
GROUP BY cs.campaign_id, cs.shop_id, s.name, st.code, st.label, st.color_hex, st.sort_order;

-- Coût pour +1 000 € de CA, par trimestre.
-- Le sens de variation (▼ vert = coût en baisse) se dérive côté appelant en
-- comparant au trimestre précédent.
CREATE OR REPLACE VIEW mar_v_roi_quarterly AS
SELECT
  YEAR(c.starts_on)                                     AS period_year,
  QUARTER(c.starts_on)                                  AS period_quarter,
  CONCAT(YEAR(c.starts_on), '-T', QUARTER(c.starts_on)) AS period_label,
  SUM(rc.amount)                                        AS total_cost_amount,
  SUM(COALESCE(clt.actual_value, 0))                    AS generated_revenue,
  CASE
    WHEN SUM(COALESCE(clt.actual_value, 0)) = 0 THEN NULL
    ELSE ROUND(SUM(rc.amount) / (SUM(COALESCE(clt.actual_value, 0)) / 1000), 2)
  END                                                   AS cost_per_1000_revenue
FROM mar_roi_cost rc
JOIN mar_campaign c ON c.id = rc.campaign_id
LEFT JOIN (
  SELECT campaign_id, SUM(actual_value) AS actual_value
  FROM mar_campaign_lever_target
  GROUP BY campaign_id
) clt ON clt.campaign_id = c.id
WHERE c.starts_on IS NOT NULL
-- L'expression du libellé figure dans le GROUP BY : MySQL en mode
-- ONLY_FULL_GROUP_BY — actif par défaut depuis la 5.7 — ne reconnaît pas
-- qu'un CONCAT des mêmes fonctions dépend des colonnes groupées, et rejette
-- la vue à l'exécution. MariaDB l'acceptait, d'où un défaut invisible en
-- développement.
GROUP BY YEAR(c.starts_on), QUARTER(c.starts_on),
         CONCAT(YEAR(c.starts_on), '-T', QUARTER(c.starts_on));
