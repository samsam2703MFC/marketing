-- =============================================================================
-- Requêtes de contrôle — module signage « L'Atelier By »
--
-- Deux sources :
--   A. Base PWA (MySQL/MariaDB)  → ce que l'import LIT
--   B. Régie (SQLite)           → ce qui a été STOCKÉ après un Rafraîchir
--
-- Lancement :
--   MySQL  : mysql <base_pwa> -e "…"          (ex. mysql pwa_consultant -e "…")
--   SQLite : sqlite3 /var/www/signage/data/signage.db "…"
--
-- NB : côté PWA les noms de colonnes sont AUTO-DÉTECTÉS par l'import (product
-- peut lier la catégorie par une FK nommée autrement, le prix être price_ttc,
-- etc.). Les requêtes ci-dessous utilisent les noms usuels — adapte si besoin.
-- =============================================================================


-- =============================================================================
-- A. CÔTÉ BASE PWA (MySQL) — ce que l'import va lire
-- =============================================================================

-- A1. Quelle base contient les 3 tables (c'est celle que l'import détecte) ?
SELECT table_schema AS base, GROUP_CONCAT(table_name ORDER BY table_name) AS tables
FROM information_schema.tables
WHERE table_name IN ('product','product_category','shop_product')
GROUP BY table_schema
HAVING COUNT(DISTINCT table_name) = 3;

-- A2. Colonnes réelles des tables (pour vérifier ce que l'auto-détection voit)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('product','product_category','shop_product','shops','language')
ORDER BY table_name, ordinal_position;

-- A3. Catégories
SELECT id, name FROM product_category ORDER BY id;

-- A4. Produits (id catégorie, prix, actif)
SELECT id, category_id, name, price, active FROM product ORDER BY category_id, id;

-- A5. Produits ACTIFS par catégorie (= ce que la grille montrera : seules les
--     catégories ayant au moins 1 produit actif apparaissent)
SELECT pc.id, pc.name,
       SUM(p.active = 1) AS produits_actifs,
       COUNT(p.id)       AS produits_total
FROM product_category pc
LEFT JOIN product p ON p.category_id = pc.id
GROUP BY pc.id, pc.name
ORDER BY pc.id;

-- A6. Boutiques : slug, actif, langue préférée (résolue via la table language)
SELECT s.id, s.slug, s.name, s.active,
       s.preferred_language_id,
       l.iso_code AS langue_pref
FROM shops s
LEFT JOIN language l ON l.id = s.preferred_language_id
ORDER BY s.id;
--   → boutique active = 0 : le magasin est marqué inactif (masqué de la grille
--     produits et du Planning). langue_pref : appliquée à mar_sig_stores.lang.

-- A7. Prix par boutique (shop_product) — mappés sur les magasins par slug
SELECT sp.shop_id, s.slug, sp.product_id, p.name AS produit, sp.price AS prix_boutique
FROM shop_product sp
JOIN shops s   ON s.id = sp.shop_id
JOIN product p ON p.id = sp.product_id
ORDER BY sp.shop_id, sp.product_id;

-- A8. Lignes en double (expliquent « N ligne(s) en double ignorée(s) »)
SELECT 'product' AS src, id, COUNT(*) AS n FROM product GROUP BY id HAVING n > 1
UNION ALL
SELECT 'product_category', id, COUNT(*) FROM product_category GROUP BY id HAVING COUNT(*) > 1;


-- =============================================================================
-- B. CÔTÉ RÉGIE (SQLite) — ce qui a été stocké
--    sqlite3 /var/www/signage/data/signage.db "…"
-- =============================================================================

-- B0. Toutes les tables sont préfixées sig_
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sig_%' ORDER BY name;

-- B1. Magasins : actif + langue + combo d'écrans (taille du film)
SELECT id, name, active, lang, screens, screen_size, screen_orient
FROM mar_sig_stores ORDER BY id;

-- B2. Catégories produits
SELECT id, name, active, sort_order FROM mar_sig_product_categories ORDER BY sort_order;

-- B3. Produits + nombre de prix par magasin
SELECT p.id, p.category_id, p.name, p.price, p.active,
       (SELECT COUNT(*) FROM mar_sig_product_prices pp WHERE pp.product_id = p.id) AS prix_magasin
FROM mar_sig_products p ORDER BY category_id, sort_order;

-- B4. Catégories réellement affichées (≥ 1 produit actif)
SELECT c.id, c.name,
       COUNT(CASE WHEN p.active = 1 THEN 1 END) AS produits_actifs
FROM mar_sig_product_categories c
LEFT JOIN mar_sig_products p ON p.category_id = c.id
GROUP BY c.id, c.name
HAVING produits_actifs > 0
ORDER BY c.sort_order;

-- B5. Prix par magasin
SELECT product_id, store_id, price FROM mar_sig_product_prices ORDER BY store_id, product_id;

-- B6. Alias de langue (nom d'un produit / d'une catégorie par langue)
SELECT kind, ref_id, lang, name FROM mar_sig_aliases ORDER BY kind, ref_id, lang;

-- B7. Éléments (modules) et leur lien vers le catalogue
--     cat_ref : lié à une catégorie ; product_ref : produit à la une ; video : film
SELECT id, type, name, lib_tag, cat_ref, product_ref,
       CASE WHEN video <> '' THEN 'oui' ELSE '' END AS video, dur
FROM mar_sig_modules ORDER BY sort_order;

-- B8. Films (playlists) : catégorie, tags, magasins ciblés, programmation
SELECT id, name, cat, tags, stores, sched_days, sched_from, sched_to
FROM mar_sig_playlists ORDER BY sort_order;

-- B9. Planning journalier : film(s) par magasin et par moment (dans l'ordre)
SELECT store_id, moment, position, film_id
FROM mar_sig_dayplans ORDER BY store_id, moment, position;

-- B10. Réglages clés (version publiée, données prix, import PWA, migrations)
SELECT key, value FROM mar_sig_settings
WHERE key IN ('version','data_ver','mig_clear_demo','plan_windows','pwa_import');


-- =============================================================================
-- C. CONTRÔLE RAPIDE PAR L'API (sans SQL) — depuis le serveur
--   TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/v1/login \
--     -H 'content-type: application/json' \
--     -d '{"username":"admin","password":"<mot de passe>"}' \
--     | sed 's/.*"token":"\([^"]*\)".*/\1/')
--   curl -s http://127.0.0.1:8080/api/v1/health
--   curl -s http://127.0.0.1:8080/api/v1/fleet   -H "authorization: Bearer $TOKEN"
--   curl -s http://127.0.0.1:8080/api/v1/catalog -H "authorization: Bearer $TOKEN"
--   curl -s http://127.0.0.1:8080/api/v1/plan    -H "authorization: Bearer $TOKEN"
-- =============================================================================
