<?php

declare(strict_types=1);

/**
 * Test de bout en bout du module marketing.
 *
 * Monte un jeu de données minimal, passe par le routeur réel et vérifie les
 * réponses. Le point le plus important n'est pas que les listes se remplissent,
 * mais que le périmètre tienne : un franchisé ne doit jamais voir les campagnes
 * ni les leads d'une autre boutique, même en appelant l'API directement.
 *
 * Exécution :
 *   MAR_DB_SOCKET=/tmp/mar.sock MAR_DB_NAME=marketing php api/tests/smoke.php
 */

use Marketing\Repository\PriceListRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Request;
use Marketing\Support\Router;

require __DIR__ . '/../src/autoload.php';

$passed = 0;
$failed = 0;

function check(string $label, bool $condition, string $detail = ''): void
{
    global $passed, $failed;

    if ($condition) {
        $passed++;
        printf("  ✓ %s\n", $label);
    } else {
        $failed++;
        printf("  ✗ %s%s\n", $label, $detail !== '' ? ' — ' . $detail : '');
    }
}

$router = new Router();
(require __DIR__ . '/../routes.php')($router);

function call(Router $router, string $method, string $path, array $query = [], array $body = []): array
{
    return $router->dispatch(new Request($method, $path, $query, $body));
}

$pdo = Database::connection();

/**
 * Garde-fou : ce test est destructeur.
 *
 * Il vide les tables `mar_` avant de monter son jeu de données. Les tables du
 * module vivant désormais dans `atelier_db`, aux côtés de celles de l'ERP, un
 * lancement distrait contre la base de production effacerait les campagnes, les
 * leads et le grand livre réels. Le préfixe `mar_` limite les dégâts au module,
 * il ne les empêche pas.
 *
 * On n'accepte donc qu'une base dont le nom se reconnaît comme jetable, sauf
 * autorisation explicite.
 */
$database = (string) $pdo->query('SELECT DATABASE()')->fetchColumn();
$looksDisposable = (bool) preg_match('/(^|_)(test|ci|dev|tmp)([0-9_]|$)/i', $database);

if (!$looksDisposable && getenv('MAR_ALLOW_DESTRUCTIVE_TESTS') !== '1') {
    fprintf(
        STDERR,
        "Refus d'exécution : « %s » ne ressemble pas à une base jetable.\n"
        . "Ce test vide les tables mar_ avant de commencer.\n\n"
        . "Utilisez une base dédiée (marketing_test, ci8…), ou forcez avec\n"
        . "MAR_ALLOW_DESTRUCTIVE_TESTS=1 si vous savez ce que vous faites.\n",
        $database
    );
    exit(4);
}

// --- Jeu de données -------------------------------------------------------
// La médiathèque d'abord : ses lignes pointent vers les boutiques et le catalogue purgés plus bas.
$pdo->exec('DELETE FROM mar_media');
$pdo->exec('DELETE FROM mar_crm_lead_event');
$pdo->exec('DELETE FROM mar_crm_lead');
$pdo->exec('DELETE FROM mar_campaign_kpi_snapshot');
$pdo->exec('DELETE FROM mar_fund_movement');
// Après les mouvements : la clé étrangère est en cascade, mais l'ordre inverse
// laisserait un deuxième lancement compter les échéances du premier — le modèle
// survit à la purge des lignes, et « 12 échéances » deviendrait « 24 ».
$pdo->exec('DELETE FROM mar_fund_recurrence');
$pdo->exec('DELETE FROM mar_roi_cost');
$pdo->exec('DELETE FROM mar_campaign_channel');
$pdo->exec('DELETE FROM mar_kit_activation');
$pdo->exec('DELETE FROM mar_kit');
$pdo->exec('DELETE FROM mar_review');
$pdo->exec('DELETE FROM mar_shop_presence');
$pdo->exec('DELETE FROM mar_agency_campaign');
$pdo->exec('DELETE FROM mar_agency');
$pdo->exec('DELETE FROM mar_campaign_shop_item_target');
$pdo->exec('DELETE FROM mar_campaign_shop');
$pdo->exec('DELETE FROM mar_campaign');
// Les références de catalogue que ce test insère portent une clé unique de SKU.
// Sans purge, un deuxième lancement sur la même base s'arrête sur un doublon —
// et le message parle de SKU, pas de nettoyage, ce qui envoie chercher loin.
$pdo->exec('DELETE FROM mar_offer_item_season');
$pdo->exec("DELETE FROM mar_offer_item WHERE sku_ref LIKE 'erp-%99%'");
$pdo->exec('DELETE FROM mar_shop_user');
$pdo->exec('DELETE FROM mar_shop');
$pdo->exec('DELETE FROM mar_brand');

$pdo->exec("INSERT INTO mar_brand (id, code, name) VALUES (1, 'atelier', \"L'Atelier By\")");
$pdo->exec("INSERT INTO mar_shop (id, brand_id, code, name, city) VALUES
    (1, 1, 'namur', 'Namur', 'Namur'),
    (2, 1, 'uccle', 'Uccle', 'Bruxelles')");
$pdo->exec("INSERT INTO mar_shop_user (user_id, shop_id, role) VALUES (77, 1, 'FRANCHISEE')");

$pdo->exec("INSERT INTO mar_campaign (id, brand_id, type_id, name, scope, status_code, starts_on, ends_on, budget_amount)
    VALUES
    (10, 1, 1, 'Barbecue été', 'RESEAU', 'live', '2026-07-01', '2026-08-31', 12000),
    -- Volontairement au quatrième trimestre : le ROI trimestriel doit produire
    -- deux lignes, sinon son regroupement n'est pas réellement exercé.
    (11, 1, 7, 'Portes ouvertes Uccle', 'LOCALE', 'planned', '2026-10-01', '2026-10-15', 2500)");
$pdo->exec('INSERT INTO mar_campaign_shop (campaign_id, shop_id) VALUES (11, 2)');

$pdo->exec("INSERT INTO mar_campaign_kpi_snapshot (campaign_id, shop_id, kpi_code, kpi_label, value, target_value, measured_at)
    VALUES
    (10, NULL, 'tickets_jour', 'Tickets / jour réseau', 412, 380, '2026-07-28 08:00:00'),
    (10, 1,    'tickets_jour', 'Tickets / jour',         96,  80, '2026-07-28 08:00:00')");

$pdo->exec("INSERT INTO mar_crm_lead (id, campaign_id, sector_id, shop_id, company_name, status_code) VALUES
    (100, 10, 1, 1, 'Office Dupont', 'todo'),
    (101, 10, 1, 2, 'Cabinet Legrand', 'todo')");

$pdo->exec("INSERT INTO mar_fund_movement (direction, shop_id, campaign_id, lever_id, movement_date, label, amount, source) VALUES
    ('IN',  1, NULL, NULL, '2026-07-05', 'Royalties juillet Namur', 4200, 'ROYALTY'),
    ('OUT', 1, 10,   1,    '2026-07-12', 'Honoraires agence',       3100, 'AGENCE')");

// Diffusion, agences, ROI et écrans réseau. Le jeu reste minimal : ce qui est
// vérifié ici, c'est que ces lectures — toutes agrégées — aboutissent, et que
// le périmètre du franchisé les traverse.
$pdo->exec("INSERT INTO mar_agency (id, name, speciality, main_lever_id, avg_roi, hit_rate_pct, avg_cost_amount, campaigns_count)
    VALUES (5, 'Studio Vertigo', 'Affichage & PLV', 1, 3.40, 62.00, 4800, 2)");
$pdo->exec("INSERT INTO mar_agency_campaign (agency_id, campaign_id, channel_id, fee_amount, roi_value)
    VALUES (5, 10, 1, 3100, 3.80)");

$pdo->exec("INSERT INTO mar_campaign_channel (campaign_id, channel_id, agency_id, budget_amount, is_enabled)
    SELECT 10, ch.id, 5, 1500, 1 FROM mar_channel ch");

$pdo->exec("INSERT INTO mar_roi_cost (campaign_id, label, source_label, amount, cost_kind) VALUES
    (10, 'Achat média', 'Grand livre — sorties', 3100, 'MEDIA'),
    (11, 'Impression PLV', 'Factures fournisseurs', 900, 'PRODUCTION')");

$pdo->exec("INSERT INTO mar_shop_presence (id, shop_id, platform, rating_avg, reviews_count, completeness_pct) VALUES
    (20, 1, 'GOOGLE', 4.60, 218, 92.00),
    (21, 2, 'GOOGLE', 4.20, 87,  71.00)");
$pdo->exec("INSERT INTO mar_review (shop_presence_id, author_name, rating, body, published_at, reply_status) VALUES
    (20, 'Claire D.', 5, 'Pain excellent.',  '2026-07-20 10:00:00', 'pending'),
    (21, 'Marc V.',   3, 'File d\'attente.', '2026-07-21 10:00:00', 'pending')");

$pdo->exec("INSERT INTO mar_kit (id, brand_id, campaign_type_id, name, description, default_budget_amount, is_published)
    VALUES (30, 1, 7, 'Portes ouvertes', 'Kit clé-en-main portes ouvertes', 1200, 1)");
$pdo->exec("INSERT INTO mar_kit_activation (kit_id, shop_id, campaign_id) VALUES (30, 1, 10), (30, 2, 11)");

// --- Fermeture par défaut -------------------------------------------------
echo "\nAuthentification\n";
AuthContext::clear();
$response = call($router, 'GET', '/api/v1/marketing/campaigns');
check('sans contexte, la route est refusée', $response['status'] === 401, 'statut ' . $response['status']);

// --- Vue Réseau -----------------------------------------------------------
echo "\nVue Réseau (BRAND_ADMIN)\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$response = call($router, 'GET', '/api/v1/marketing/references');
$refs     = $response['body'];
check('les référentiels répondent', $response['status'] === 200);
check('9 types de campagne', count($refs['campaignTypes']) === 9, count($refs['campaignTypes']) . ' reçus');
check('5 états de lead', count($refs['leadStatuses']) === 5);
check('les couleurs viennent de la base', ($refs['leadStatuses'][0]['color_hex'] ?? '') === '#8a6d0f');

// La maquette déduisait la pastille de levier par mots-clés sur un texte libre.
// C'est une relation désormais : si elle casse, la pastille disparaît en
// silence — d'où ces deux contrôles.
$types = array_column($refs['campaignTypes'], null, 'code');
check(
    'chaque type porte un levier',
    count(array_filter($refs['campaignTypes'], static fn (array $t): bool => $t['lever_id'] !== null)) === 9,
    count(array_filter($refs['campaignTypes'], static fn (array $t): bool => $t['lever_id'] !== null)) . '/9'
);
check(
    'la pastille garde la formulation propre au type',
    ($types['ouverture']['lever_label'] ?? '') === 'Trafic / notoriété',
    var_export($types['ouverture']['lever_label'] ?? null, true)
);
check(
    'la couleur de pastille vient du levier',
    ($types['anti_gaspi']['lever_color_hex'] ?? '') === '#10b981',
    var_export($types['anti_gaspi']['lever_color_hex'] ?? null, true)
);

$response  = call($router, 'GET', '/api/v1/marketing/campaigns');
$campaigns = $response['body'];
check('les deux campagnes sont visibles', count($campaigns) === 2, count($campaigns) . ' reçue(s)');
check('le statut porte son libellé et sa couleur', ($campaigns[0]['status_label'] ?? '') !== '' && ($campaigns[0]['status_text_hex'] ?? '') !== '');
check('les montants sont des nombres', is_float($campaigns[0]['budget_amount'] ?? null));

$response = call($router, 'GET', '/api/v1/marketing/campaigns/calendar', ['year' => 2026]);
$calendar = $response['body'];
check('le calendrier positionne les barres', ($calendar[0]['start_month'] ?? 0) === 7 && ($calendar[0]['span_months'] ?? 0) === 2);

$response = call($router, 'GET', '/api/v1/marketing/funds/ledger', ['granularity' => 'month']);
$ledger   = $response['body'];
$period   = $ledger['periods'][0] ?? [];
check('le grand livre sépare entrées et sorties', ($period['entries_total'] ?? null) === 4200.0 && ($period['exits_total'] ?? null) === 3100.0);
check('le solde courant cumule', ($ledger['closing_balance'] ?? null) === 1100.0, var_export($ledger['closing_balance'] ?? null, true));
check('la ligne de campagne porte le badge de liaison', ($period['exits'][0]['is_linked'] ?? false) === true);

$response = call($router, 'GET', '/api/v1/marketing/campaigns/10/leads');
$leads    = $response['body'];
check('les deux leads remontent', count($leads['leads']) === 2);
check('l\'entonnoir garde ses 5 états', count($leads['funnel']) === 5);
check('l\'entonnoir compte les leads à appeler', ($leads['funnel'][0]['leads_count'] ?? null) === 2);
check('les initiales sont calculées', ($leads['leads'][0]['initials'] ?? '') === 'CL');

$response = call($router, 'GET', '/api/v1/marketing/campaigns/10/monitor');
$kpi      = $response['body']['kpis'][0] ?? [];
// PDO renvoie les DECIMAL en chaîne. La colonne s'appelant simplement `value`,
// elle échappait aux règles de suffixe et remontait « 412.00 » jusqu'à l'écran.
check('les valeurs de KPI sont numériques', is_float($kpi['value'] ?? null), gettype($kpi['value'] ?? null));
check('les cibles de KPI sont numériques', is_float($kpi['target_value'] ?? null));

// --- Vue Franchisé --------------------------------------------------------
echo "\nVue Franchisé (FRANCHISEE, boutique 1 uniquement)\n";
AuthContext::set(77, 'FRANCHISEE', 1, [1]);

$response  = call($router, 'GET', '/api/v1/marketing/campaigns');
$campaigns = $response['body'];
check('la campagne réseau reste visible', count($campaigns) === 1, count($campaigns) . ' reçue(s)');
check('la campagne locale d\'Uccle est masquée', ($campaigns[0]['id'] ?? null) === 10);

$response = call($router, 'GET', '/api/v1/marketing/campaigns/11');
check('la fiche hors périmètre renvoie 404', $response['status'] === 404, 'statut ' . $response['status']);

$response = call($router, 'GET', '/api/v1/marketing/campaigns/10/leads');
$leads    = $response['body'];
check('seul le lead de sa boutique remonte', count($leads['leads']) === 1, count($leads['leads']) . ' reçu(s)');
check('c\'est bien le lead de Namur', ($leads['leads'][0]['company_name'] ?? '') === 'Office Dupont');

$response = call($router, 'POST', '/api/v1/marketing/funds/movements', [], [
    'direction' => 'OUT', 'movement_date' => '2026-07-20', 'label' => 'Flyers', 'amount' => 300, 'shop_id' => 2,
]);
check('imputer une dépense à une autre boutique est refusé', $response['status'] === 403, 'statut ' . $response['status']);

$response = call($router, 'PATCH', '/api/v1/marketing/leads/101/status', [], ['status_code' => 'called']);
check('changer l\'état d\'un lead hors périmètre est refusé', $response['status'] === 422, 'statut ' . $response['status']);

// --- Historique des leads -------------------------------------------------
echo "\nHistorique des leads\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$response = call($router, 'PATCH', '/api/v1/marketing/leads/100/status', [], ['status_code' => 'called', 'note' => 'Appelé le 20/07']);
check('le changement d\'état passe', $response['status'] === 200, 'statut ' . $response['status']);

$response = call($router, 'GET', '/api/v1/marketing/leads/100/history');
$history  = $response['body'];
check('une ligne d\'historique est écrite', count($history) === 1);
check('elle porte l\'état précédent et le nouveau', ($history[0]['from_status'] ?? '') === 'todo' && ($history[0]['to_status'] ?? '') === 'called');
check('le type d\'événement est déduit', ($history[0]['event_type'] ?? '') === 'CALL');

$response = call($router, 'PATCH', '/api/v1/marketing/leads/100/status', [], ['status_code' => 'inconnu']);
check('un état inconnu est rejeté', $response['status'] === 422, 'statut ' . $response['status']);

$response = call($router, 'GET', '/api/v1/marketing/campaigns/10/leads');
check('l\'entonnoir se recalcule après le changement', ($response['body']['funnel'][1]['leads_count'] ?? null) === 1);

// --- Diffusion, agences, performance, réseau ------------------------------
// Ces huit lectures sont toutes agrégées, et deux d'entre elles passent par des
// vues. C'est exactement la classe de requête que MySQL 8 refuse en
// ONLY_FULL_GROUP_BY là où MariaDB l'acceptait : mar_v_roi_quarterly rendait
// 500 en production sans qu'aucun test ne s'en aperçoive. On exige donc un 200
// sur chacune, sous les deux rôles.
echo "\nDiffusion, agences, performance, réseau\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

/** @var array<string, array<string,string>> */
$aggregateRoutes = [
    'pub physique'      => ['/api/v1/marketing/diffusion', ['family' => 'PHYSIQUE']],
    'pub digitale'      => ['/api/v1/marketing/diffusion', ['family' => 'DIGITAL']],
    'agences'           => ['/api/v1/marketing/agencies', []],
    'marketing analyse' => ['/api/v1/marketing/analysis', []],
    'roi & rentabilité' => ['/api/v1/marketing/roi', []],
    'fidélité & crm'    => ['/api/v1/marketing/crm', []],
    'présence locale'   => ['/api/v1/marketing/presence', []],
    'kit local & dam'   => ['/api/v1/marketing/kits', []],
];

foreach ($aggregateRoutes as $label => [$path, $query]) {
    $response = call($router, 'GET', $path, $query);
    check(sprintf('%s répond', $label), $response['status'] === 200, 'statut ' . $response['status']);
}

$response = call($router, 'GET', '/api/v1/marketing/roi');
$quarters = $response['body']['quarterly'] ?? [];
check('le ROI trimestriel sépare les deux trimestres', count($quarters) === 2, count($quarters) . ' trimestre(s)');
check(
    'les libellés de trimestre sont formés',
    array_column($quarters, 'period_label') === ['2026-T3', '2026-T4'],
    implode(', ', array_column($quarters, 'period_label'))
);
check('les coûts sont numériques', is_float($quarters[0]['total_cost_amount'] ?? null));
check('les postes de coût sont ventilés par nature', count($response['body']['costs'] ?? []) === 2);
check('chaque poste cite sa source', ($response['body']['costs'][0]['sources'] ?? '') !== '');

$response = call($router, 'GET', '/api/v1/marketing/agencies');
$agency   = $response['body'][0] ?? [];
check('l\'agence porte son levier', ($agency['lever_label'] ?? '') !== '');
check('les interventions sont comptées réellement', ($agency['interventions'] ?? null) === 1);

$response = call($router, 'GET', '/api/v1/marketing/agencies/5/campaigns');
check('la fiche agence liste ses interventions', count($response['body']) === 1, count($response['body']) . ' reçue(s)');

$response = call($router, 'GET', '/api/v1/marketing/diffusion', ['family' => 'PHYSIQUE']);
$physical = $response['body']['channels'] ?? [];
check('seuls les canaux physiques remontent', $physical !== [] && !array_filter($physical, static fn (array $c): bool => $c['family'] !== 'PHYSIQUE'));
check('le canal porte son agence', ($physical[0]['agency_name'] ?? '') === 'Studio Vertigo');

$response = call($router, 'GET', '/api/v1/marketing/diffusion', ['family' => 'INCONNUE']);
check('une famille inconnue retombe sur PHYSIQUE', ($response['body']['channels'][0]['family'] ?? '') === 'PHYSIQUE');

$response = call($router, 'GET', '/api/v1/marketing/presence');
check('les deux boutiques sont présentes', count($response['body']['shops']) === 2);
check('la note moyenne est numérique', is_float($response['body']['shops'][0]['rating_avg'] ?? null));
check('les avis en attente sont comptés', ($response['body']['shops'][0]['pending_replies'] ?? null) === 1);
check('les derniers avis remontent', count($response['body']['reviews']) === 2);

// --- Périmètre des écrans réseau ------------------------------------------
// Le cloisonnement doit tenir ici aussi : ces écrans sont ceux où un franchisé
// verrait le plus facilement les chiffres d'un confrère.
echo "\nPérimètre des écrans réseau (FRANCHISEE)\n";
AuthContext::set(77, 'FRANCHISEE', 1, [1]);

// Les agrégats de performance n'ont pas de boutique à laquelle se restreindre :
// ils couvrent tout le réseau, et un franchisé y lisait les chiffres de ses
// confrères (le « Performance par levier » de son tableau de bord). Refusés.
$performanceRoutes = [
    'performance par levier' => '/api/v1/marketing/funds/levers',
    'marketing analyse'      => '/api/v1/marketing/analysis',
    'roi & rentabilité'      => '/api/v1/marketing/roi',
    'roi trimestriel'        => '/api/v1/marketing/roi/quarterly',
    'coûts roi de campagne'  => '/api/v1/marketing/campaigns/10/roi-costs',
];

foreach ($aggregateRoutes as $label => [$path, $query]) {
    if (in_array($path, $performanceRoutes, true)) {
        continue;
    }
    $response = call($router, 'GET', $path, $query);
    check(sprintf('%s répond au franchisé', $label), $response['status'] === 200, 'statut ' . $response['status']);
}

foreach ($performanceRoutes as $label => $path) {
    $response = call($router, 'GET', $path);
    check(sprintf('%s est refusé au franchisé', $label), $response['status'] === 403, 'statut ' . $response['status']);
}

$response = call($router, 'GET', '/api/v1/marketing/presence');
check('seule sa boutique remonte', count($response['body']['shops']) === 1, count($response['body']['shops']) . ' reçue(s)');
check('c\'est bien Namur', ($response['body']['shops'][0]['shop_name'] ?? '') === 'Namur');
check('les avis d\'Uccle sont masqués', count($response['body']['reviews']) === 1);

$response = call($router, 'GET', '/api/v1/marketing/kits');
check('le kit reste visible', count($response['body']) === 1);
check('seule son activation est comptée', ($response['body'][0]['activations'] ?? null) === 1, var_export($response['body'][0]['activations'] ?? null, true));

$response = call($router, 'GET', '/api/v1/marketing/diffusion', ['family' => 'PHYSIQUE']);
$campaignIds = array_unique(array_column($response['body']['channels'], 'campaign_id'));
check('la diffusion ne montre que ses campagnes', $campaignIds === [10], implode(',', $campaignIds));

// --- Assistant de création -------------------------------------------------
// L'assistant envoie la campagne et ses rattachements en un seul appel. Deux
// choses comptent : que tout soit écrit, et qu'en cas d'échec rien ne le soit —
// une campagne budgétée sans périmètre ni canal est pire qu'aucune campagne.
echo "\nAssistant de création\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$response = call($router, 'GET', '/api/v1/marketing/session');
check('la session dit d\'où vient l\'identité', is_bool($response['body']['dev_auth'] ?? null), var_export($response['body']['dev_auth'] ?? null, true));
check('la session dit si la connexion par l\'ERP est prête (un état, aucune valeur)', is_bool($response['body']['login_ready'] ?? null));

$channelId = (int) $pdo->query("SELECT id FROM mar_channel WHERE code = 'plv'")->fetchColumn();

// Une référence de catalogue, comme la reprise ERP en écrit : l'étape « Offre »
// rattache ses éléments dessus, et le rattachement doit survivre à l'écriture.
$pdo->exec(
    "INSERT INTO mar_offer_item (category, sku_ref, name, detail, price_amount)
     VALUES ('produit', 'erp-9901', 'Tarte du jour', 'Tartes', 14.90)"
);
$catalogItemId = (int) $pdo->lastInsertId();

// Sa gamme saisonnière, et la disponibilité qui les relie : c'est elle qui
// permet à l'étape « Offre » de filtrer le catalogue par la gamme choisie.
$pdo->exec(
    "INSERT INTO mar_offer_item (category, sku_ref, name)
     VALUES ('saison', 'erp-saison-9901', 'Gamme Estivale (Juin à Août)')"
);
$seasonItemId = (int) $pdo->lastInsertId();
$pdo->exec(sprintf(
    'INSERT INTO mar_offer_item_season (item_id, season_item_id) VALUES (%d, %d)',
    $catalogItemId,
    $seasonItemId
));

$response  = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    // Volontairement sans brand_id : le back-office connaît sa marque, et une
    // seule est active. Le serveur doit la résoudre plutôt que refuser.
    'name'       => 'Campagne assistant',
    'type_id'    => 1,
    'scope'      => 'LOCALE',
    'client_target' => 'b2b',
    'starts_on'  => '2026-12-01',
    'ends_on'    => '2026-12-24',
    'budget_amount' => 5000,
    'shop_ids'   => [1, 2],
    // Objectifs de pièces (étape « Objectifs ») : un posé, un absent.
    'shop_targets' => [['shop_id' => 1, 'target_pieces' => 120]],
    // Budget nul volontairement : la colonne est NOT NULL, et activer un canal
    // sans montant est un geste courant de l'assistant.
    'channels'   => [['channel_id' => $channelId, 'budget_amount' => null]],
    'lever_targets' => [['lever_id' => 1, 'target_value' => 20000, 'target_unit' => 'EUR']],
    // Cadrage complet, tel que l'assistant le produit : ton, brief agence,
    // secteurs, tenues, web-shop B2B, offre, rétroplanning et déclinaisons.
    'tone'               => 'gourmand',
    'objective_coef_pct' => 12,
    'agency_note'        => 'Prévoir un shooting en boutique.',
    'b2b_webshop_enabled'=> true,
    'show_web_shop'      => true,
    'sector_ids'      => array_column($refs['b2bSectors'], 'id'),
    'agency_ask_ids'  => [(int) $refs['agencyAsks'][0]['id'], (int) $refs['agencyAsks'][2]['id']],
    'b2b_option_ids'  => [(int) $refs['b2bOptions'][0]['id']],
    'uniform_ids'     => [(int) $refs['uniforms'][0]['id']],
    'image_url'       => 'https://exemple.test/visuel.jpg',
    'focal_point_y'   => 42.5,
    'image_fit'       => 'contain',
    'format_ids'      => array_column($refs['formats'], 'id'),
    'offer'           => [
        'title'         => 'Menu Barbecue',
        'mechanic_text' => 'Plat + boisson + dessert',
        'starts_on'     => '2026-12-05',
        'ends_on'       => '2026-12-20',
        'all_day'       => false,
        'hour_from'     => '11:30:00',
        'hour_to'       => '14:00:00',
        // Les trois formes que le serveur doit accepter : la chaîne libre
        // historique, l'élément rattaché au catalogue, et une référence
        // périmée qui doit retomber sur le libellé seul plutôt qu'échouer.
        'items'         => [
            'Brochette maison',
            // Photo propre à la campagne : elle doit primer sur celle du
            // catalogue sans la remplacer.
            ['label' => 'Tarte du jour', 'offer_item_id' => $catalogItemId,
             'show_photo' => true, 'image_url' => '/img/campagnes/tarte.jpg'],
            '  ',
            ['label' => 'Référence disparue', 'offer_item_id' => 999999,
             'show_photo' => false],
        ],
    ],
    'pos_survey_enabled' => true,
    'pos_questions'   => [
        ['label' => 'Comment avez-vous connu l\'offre ?', 'answer_type' => 'choice',
         'options' => "Affiche\nRéseaux sociaux", 'is_required' => true],
        ['label' => 'Reviendrez-vous ?', 'answer_type' => 'yes_no'],
        ['label' => '  ', 'answer_type' => 'text'],
    ],
    'retroplanning'   => array_map(
        static fn (array $step): array => [
            'label'              => $step['label'],
            'days_before_launch' => $step['days_before_launch'],
            'position_id'        => $step['position_id'],
        ],
        $refs['retroplanningDefaults']
    ),
]);
check('la campagne complète est créée', $response['status'] === 201, 'statut ' . $response['status']);

$newId = (int) ($response['body']['inserted_id'] ?? 0);
$count = static fn (string $table): int => (int) $pdo->query(
    sprintf('SELECT COUNT(*) FROM %s WHERE campaign_id = %d', $table, $newId)
)->fetchColumn();

check('les deux boutiques sont rattachées', $count('mar_campaign_shop') === 2);
check(
    'l\'objectif de pièces est écrit sur sa boutique',
    (int) $pdo->query(sprintf(
        'SELECT target_pieces FROM mar_campaign_shop WHERE campaign_id = %d AND shop_id = 1',
        $newId
    ))->fetchColumn() === 120
);
check(
    'la boutique sans objectif reste à NULL',
    $pdo->query(sprintf(
        'SELECT target_pieces FROM mar_campaign_shop WHERE campaign_id = %d AND shop_id = 2',
        $newId
    ))->fetchColumn() === null
);

// L'historique des ventes répond même sans tables de caisse : des zéros
// expliqués, pas une erreur — l'étape doit rester utilisable partout.
$response = call($router, 'GET', '/api/v1/marketing/sales/quantities', [
    'item_ids' => (string) $catalogItemId,
    'from'     => '2026-01-01',
    'to'       => '2026-01-31',
    'compare'  => '1',
]);
check('les ventes répondent sans tables de caisse', is_array($response['body']['shops'] ?? null));
check(
    'chaque boutique porte ses tickets et sa pénétration',
    array_reduce(
        $response['body']['shops'] ?? [],
        static fn (bool $ok, array $shop): bool =>
            $ok && array_key_exists('tickets', $shop) && array_key_exists('tickets_by_product', $shop),
        true
    )
);
check(
    'l\'absence d\'historique est expliquée',
    is_string($response['body']['warning'] ?? null) && $response['body']['warning'] !== ''
);

// La famille du catalogue voyage avec le produit : c'est elle qui groupe le
// tableau de l'étape « Objectifs » et qui permet de régler une progression
// pour toute une catégorie d'un coup. Sans elle, l'écran ne pouvait pas
// grouper ce que la requête triait pourtant déjà.
check(
    'chaque produit porte sa famille de catalogue',
    array_reduce(
        $response['body']['products'] ?? [],
        static fn (bool $ok, array $product): bool => $ok && array_key_exists('family', $product),
        true
    ),
    json_encode($response['body']['products'] ?? null)
);
check('le canal est activé sans budget', $count('mar_campaign_channel') === 1);
check(
    'un canal sans budget vaut zéro',
    (float) $pdo->query(sprintf(
        'SELECT budget_amount FROM mar_campaign_channel WHERE campaign_id = %d',
        $newId
    ))->fetchColumn() === 0.0
);
check('l\'objectif de levier est écrit', $count('mar_campaign_lever_target') === 1);
check('les questions de caisse sont écrites', $count('mar_campaign_pos_question') === 2, (string) $count('mar_campaign_pos_question'));
check(
    'les propositions ne sont gardées que pour un choix',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_campaign_pos_question WHERE campaign_id = %d AND options IS NOT NULL',
        $newId
    ))->fetchColumn() === 1
);

// Une forme de réponse inconnue doit être refusée, pas écrite telle quelle :
// la caisse ne saurait pas quoi afficher.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Question douteuse', 'pos_survey_enabled' => true,
    'pos_questions' => [['label' => 'X', 'answer_type' => 'telepathie']],
]);
check('une forme de réponse inconnue est refusée', $response['status'] === 422, 'statut ' . $response['status']);
check(
    'et la campagne n\'est pas créée',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign WHERE name = 'Question douteuse'")->fetchColumn() === 0
);

// Questionnaire décoché : les questions ne partent pas en caisse.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Sans questionnaire', 'pos_survey_enabled' => false,
    'pos_questions' => [['label' => 'Ne doit pas être posée', 'answer_type' => 'yes_no']],
]);
check(
    'un questionnaire décoché n\'écrit aucune question',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign_pos_question q
                         JOIN mar_campaign c ON c.id = q.campaign_id
                        WHERE c.name = 'Sans questionnaire'")->fetchColumn() === 0
);
check(
    'la marque est déduite du réseau',
    (int) $pdo->query(sprintf('SELECT brand_id FROM mar_campaign WHERE id = %d', $newId))->fetchColumn() === 1
);
check(
    'la cible client est enregistrée',
    $pdo->query(sprintf('SELECT client_target FROM mar_campaign WHERE id = %d', $newId))->fetchColumn() === 'b2b'
);

$campaignRow = $pdo->query(sprintf(
    'SELECT tone, objective_coef_pct, agency_note, b2b_webshop_enabled, show_web_shop
       FROM mar_campaign WHERE id = %d',
    $newId
))->fetch();
check('le ton éditorial est enregistré', ($campaignRow['tone'] ?? '') === 'gourmand');
check('l\'objectif en écart au N-1 est enregistré', (float) ($campaignRow['objective_coef_pct'] ?? 0) === 12.0);
check('la note de brief est enregistrée', ($campaignRow['agency_note'] ?? '') !== '');
check('le web-shop B2B est activé', (int) ($campaignRow['b2b_webshop_enabled'] ?? 0) === 1);
// La vitrine grand public est une autre décision que la commande en ligne des
// professionnels : les deux drapeaux existent côte à côte et ne se déduisent
// pas l'un de l'autre.
check('l\'affichage en boutique en ligne est enregistré',
    (int) ($campaignRow['show_web_shop'] ?? 0) === 1);
check(
    'le brouillon relu le rend au même état',
    (call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $newId))['body']['show_web_shop'] ?? null)
        === true
);

// Publier vers l'extérieur se demande : sans mention, la campagne reste
// interne. Une case oubliée qui n'affiche rien se rattrape ; une offre interne
// parue en vitrine, beaucoup moins.
$sansMention = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Sans vitrine', 'scope' => 'RESEAU', 'client_target' => 'b2c',
    'starts_on' => '2026-05-01', 'ends_on' => '2026-05-31',
]);
check(
    'une campagne sans mention ne paraît pas en vitrine',
    (int) $pdo->query(sprintf(
        'SELECT show_web_shop FROM mar_campaign WHERE id = %d',
        (int) $sansMention['body']['inserted_id']
    ))->fetchColumn() === 0
);

// Et l'inverse : décocher après coup retire la campagne de la vitrine.
call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $newId), [], ['show_web_shop' => false]);
check(
    'décocher retire la campagne de la vitrine',
    (int) $pdo->query(sprintf('SELECT show_web_shop FROM mar_campaign WHERE id = %d', $newId))
        ->fetchColumn() === 0
);
call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $newId), [], ['show_web_shop' => true]);

check('les six secteurs B2B sont rattachés', $count('mar_campaign_b2b_sector') === 6, (string) $count('mar_campaign_b2b_sector'));
check('les deux demandes agence sont rattachées', $count('mar_campaign_agency_ask') === 2);
check('l\'option de web-shop est rattachée', $count('mar_campaign_b2b_option') === 1);
check('la tenue est rattachée', $count('mar_campaign_uniform') === 1);
check('les cinq jalons sont écrits', $count('mar_retroplanning_step') === 5, (string) $count('mar_retroplanning_step'));

$offerId = (int) $pdo->query(sprintf('SELECT id FROM mar_campaign_offer WHERE campaign_id = %d', $newId))->fetchColumn();
check('l\'offre est créée', $offerId > 0);
check(
    'les éléments vides de l\'offre sont écartés',
    (int) $pdo->query(sprintf('SELECT COUNT(*) FROM mar_campaign_offer_item WHERE campaign_offer_id = %d', $offerId))->fetchColumn() === 3
);
check(
    'l\'élément choisi au catalogue garde sa référence',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_campaign_offer_item WHERE campaign_offer_id = %d AND offer_item_id = %d',
        $offerId,
        $catalogItemId
    ))->fetchColumn() === 1
);
check(
    'la référence périmée retombe sur le libellé seul',
    $pdo->query(sprintf(
        'SELECT offer_item_id FROM mar_campaign_offer_item WHERE campaign_offer_id = %d AND label = \'Référence disparue\'',
        $offerId
    ))->fetchColumn() === null
);

// --- Photos produits --------------------------------------------------------
// Le dossier d'impression portait une option `show_photo` figée à « vrai »,
// faute d'écran pour la poser. L'étape « Photos produits » la pose ; ce qui
// suit vérifie qu'elle traverse la chaîne jusqu'au fichier imprimé.
$photos = $pdo->query(sprintf(
    'SELECT label, show_photo, image_url FROM mar_campaign_offer_item
      WHERE campaign_offer_id = %d ORDER BY sort_order',
    $offerId
))->fetchAll();
$parLabel = [];
foreach ($photos as $ligne) {
    $parLabel[$ligne['label']] = $ligne;
}

check(
    'une photo propre à la campagne est enregistrée',
    ($parLabel['Tarte du jour']['image_url'] ?? null) === '/img/campagnes/tarte.jpg'
);
check(
    'la case décochée est enregistrée',
    (int) ($parLabel['Référence disparue']['show_photo'] ?? 1) === 0
);
// Un appelant qui ne parle pas de photo ne doit pas en priver la campagne :
// c'est ce que faisait le module avant que la question soit posée.
check(
    'un produit sans mention garde sa photo',
    (int) ($parLabel['Brochette maison']['show_photo'] ?? 0) === 1
        // `??` rendrait « x » sur une valeur nulle, qui est justement la valeur
        // attendue : on regarde la clé, puis son contenu.
        && array_key_exists('image_url', $parLabel['Brochette maison'] ?? [])
        && $parLabel['Brochette maison']['image_url'] === null
);

$relu = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $newId))['body'];
$tarte = null;
foreach ($relu['offer']['items'] ?? [] as $ligne) {
    if ($ligne['label'] === 'Tarte du jour') {
        $tarte = $ligne;
    }
}
check(
    'le brouillon rend la photo et son catalogue',
    ($tarte['image_url'] ?? null) === '/img/campagnes/tarte.jpg'
        && array_key_exists('catalog_image_url', $tarte ?? []),
    json_encode($tarte)
);

$response = call($router, 'GET', '/api/v1/marketing/offer-items');
check(
    'le catalogue expose la référence active',
    in_array('Tarte du jour', array_column($response['body'], 'name'), true)
);

$tarteRow = null;
foreach ($response['body'] as $catalogRow) {
    if ($catalogRow['name'] === 'Tarte du jour') {
        $tarteRow = $catalogRow;
        break;
    }
}
check(
    'la référence porte ses gammes saisonnières',
    $tarteRow !== null && in_array($seasonItemId, $tarteRow['season_ids'] ?? [], true)
);
// Prix de vente : l'étape « Prix » part du tarif plutôt que d'une saisie.
$response = call($router, 'GET', '/api/v1/marketing/price-list', [
    'item_ids' => (string) $catalogItemId,
]);
$prixTarte = $response['body']['items'][0] ?? null;
check(
    'le prix catalogue sert de prix de départ',
    $prixTarte !== null && $prixTarte['price'] === 14.90 && $prixTarte['source'] === 'catalogue',
    json_encode($prixTarte)
);
check(
    'sans configuration ERP, l\'écran sait que le tarif boutique n\'a pas été lu',
    $response['body']['erp']['configured'] === false
        && $response['body']['erp']['shops_read'] === 0
);

// La forme du tarif rendu par l'ERP n'a pas pu être observée : la lecture
// cherche ses clés. Ces cas fixent ce qu'elle doit reconnaître — et une
// réponse qui ne parle pas de prix ne doit rien produire du tout.
$formes = [
    'liste nue'      => [['id_product' => 101, 'sale_price' => 2.90]],
    'enveloppe data' => ['data' => [['product_id' => 101, 'price' => 2.90]]],
    'document niché' => ['document' => ['lines' => [['sku' => 101, 'unit_price' => 2.90]]]],
    'produit imbriqué' => ['items' => [['product' => ['id' => 101], 'price_ttc' => 2.90]]],
];
foreach ($formes as $nom => $charge) {
    $lu = PriceListRepository::extract($charge);
    check(
        sprintf('le tarif se lit en forme « %s »', $nom),
        count($lu['rows']) === 1
            && $lu['rows'][0]['product'] === '101'
            && $lu['rows'][0]['price'] === 2.90,
        json_encode($lu)
    );
}
$vide = PriceListRepository::extract(['status' => 'success', 'shop' => ['id' => 3, 'name' => 'Corbais']]);
check(
    'une réponse sans ligne de tarif ne produit aucun prix',
    $vide['rows'] === [] && $vide['error'] !== null
);
$ttc = PriceListRepository::extract([['id_product' => 7, 'price' => 3.10, 'includes_tax' => true]]);
check(
    'le drapeau TTC est repris quand l\'ERP le donne',
    $ttc['rows'][0]['includes_tax'] === true
        && $ttc['keys'] === ['product' => 'id_product', 'price' => 'price']
);

check(
    'la fenêtre de l\'offre est distincte de la campagne',
    $pdo->query(sprintf('SELECT starts_on FROM mar_campaign_offer WHERE id = %d', $offerId))->fetchColumn() === '2026-12-05'
);
check(
    'la plage horaire est conservée',
    $pdo->query(sprintf('SELECT hour_from FROM mar_campaign_offer WHERE id = %d', $offerId))->fetchColumn() === '11:30:00'
);

$assetId = (int) $pdo->query(sprintf('SELECT id FROM mar_campaign_asset WHERE campaign_id = %d', $newId))->fetchColumn();
check('le visuel maître est créé', $assetId > 0);
check(
    'le point focal est conservé',
    (float) $pdo->query(sprintf('SELECT focal_point_y FROM mar_campaign_asset WHERE id = %d', $assetId))->fetchColumn() === 42.5
);
check(
    'le mode de cadrage est conservé',
    $pdo->query(sprintf('SELECT fit FROM mar_campaign_asset WHERE id = %d', $assetId))->fetchColumn() === 'contain'
);
check(
    'une déclinaison est attendue par format',
    (int) $pdo->query(sprintf('SELECT COUNT(*) FROM mar_asset_render WHERE campaign_asset_id = %d', $assetId))->fetchColumn()
        === count($refs['formats'])
);
check(
    'les déclinaisons restent à produire',
    $pdo->query(sprintf('SELECT DISTINCT status FROM mar_asset_render WHERE campaign_asset_id = %d', $assetId))->fetchColumn() === 'pending'
);

// « Toute la journée » n'est pas une plage 00:00–23:59 : les deux cas doivent
// rester distinguables, sinon on ne sait plus si l'horaire était contraint.
call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'  => 'Offre toute la journée',
    'offer' => ['title' => 'Tout le jour', 'all_day' => true, 'hour_from' => '09:00:00', 'hour_to' => '18:00:00'],
]);
check(
    'toute la journée n\'écrit pas de plage horaire',
    $pdo->query("SELECT o.hour_from FROM mar_campaign_offer o
                   JOIN mar_campaign c ON c.id = o.campaign_id
                  WHERE c.name = 'Offre toute la journée'")->fetchColumn() === null
);

// ── Étape « Prix » : promotion chiffrée par produit ────────────────────────
//
// La promotion n'était que du texte : « −20 % » se lisait, ne se calculait
// pas. Ces contrôles portent sur les nombres, parce que c'est d'eux que dépend
// le volume à vendre pour compenser.

$refProduit = (int) $pdo->query(
    "SELECT id FROM mar_offer_item WHERE category = 'produit' ORDER BY id LIMIT 1"
)->fetchColumn();

$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'               => 'Campagne avec prix',
    'margin_pct_default' => 68,
    'offer' => [
        'title'              => 'Offre chiffrée',
        'max_qty_per_ticket' => 4,
        'is_cumulative'      => true,
        'items' => [
            [
                'label' => 'Produit remisé', 'offer_item_id' => $refProduit,
                'mechanic_type' => 'PERCENT', 'discount_pct' => 20,
                'baseline_price' => 19.90, 'margin_pct' => 68, 'target_pieces' => 900,
            ],
            [
                'label' => 'Produit à prix barré',
                'mechanic_type' => 'CROSSED_PRICE', 'fixed_price' => 21.90,
                'baseline_price' => 24.90,
            ],
            ['label' => 'Produit sans promotion'],
        ],
    ],
]);
$avecPrix = (int) $response['body']['inserted_id'];
check('la campagne avec prix est créée', $response['status'] === 201, 'statut ' . $response['status']);

$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $avecPrix))['body'];
$lignes = $etat['offer']['items'] ?? [];

check(
    'la remise revient comme un nombre, pas comme un libellé',
    count($lignes) === 3
        && $lignes[0]['mechanic_type'] === 'PERCENT'
        && (float) $lignes[0]['discount_pct'] === 20.0
        && (float) $lignes[0]['baseline_price'] === 19.90,
    json_encode($lignes[0] ?? null)
);

// Une mécanique ne remplit que ses propres champs : garder la remise en
// passant au prix barré laisserait deux promotions sur la même ligne, et le
// calcul de marge en choisirait une sans le dire.
check(
    'un prix barré n\'écrit pas de pourcentage',
    $lignes[1]['mechanic_type'] === 'CROSSED_PRICE'
        && $lignes[1]['discount_pct'] === null
        && (float) $lignes[1]['fixed_price'] === 21.90,
    json_encode($lignes[1] ?? null)
);

// La famille vient du catalogue : l'étape « Prix » n'affiche que les produits,
// et une gamme saisonnière n'a ni prix unitaire ni volume à compenser. La
// déduire du libellé casserait au premier produit nommé « Gamme du chef ».
check(
    'la ligne d\'offre revient avec sa famille de catalogue',
    $lignes[0]['category'] === 'produit' && $lignes[2]['category'] === null,
    json_encode([
        'catalogue'   => $lignes[0]['category'] ?? 'absent',
        'saisie libre' => $lignes[2]['category'] ?? 'absent',
    ])
);

// L'objectif se pose aussi produit par produit, pas seulement par boutique :
// « 2 000 pièces » ne dit pas de quoi, et c'est la question du lundi matin.
check(
    'l\'objectif produit revient avec le brouillon',
    (int) $lignes[0]['target_pieces'] === 900 && $lignes[1]['target_pieces'] === null,
    json_encode([
        'posé'   => $lignes[0]['target_pieces'] ?? 'absent',
        'absent' => $lignes[1]['target_pieces'] ?? 'absent',
    ])
);

check(
    'un produit sans promotion reste sans mécanique',
    $lignes[2]['mechanic_type'] === null
        && $lignes[2]['discount_pct'] === null
        && $lignes[2]['fixed_price'] === null,
    json_encode($lignes[2] ?? null)
);

check(
    'le taux de marge réseau et les conditions reviennent',
    (float) $etat['margin_pct_default'] === 68.0
        && (int) $etat['offer']['max_qty_per_ticket'] === 4
        && $etat['offer']['is_cumulative'] === true,
    json_encode([
        'marge'   => $etat['margin_pct_default'] ?? null,
        'plafond' => $etat['offer']['max_qty_per_ticket'] ?? null,
        'cumul'   => $etat['offer']['is_cumulative'] ?? null,
    ])
);

// Le plafond vide n'est pas un plafond à zéro : sans limite d'un côté, aucune
// pièce en promotion de l'autre.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $avecPrix), [], [
    'name'  => 'Campagne avec prix',
    'offer' => [
        'title' => 'Offre chiffrée',
        'max_qty_per_ticket' => '',
        'items' => [['label' => 'Produit remisé', 'mechanic_type' => 'PERCENT', 'discount_pct' => 15]],
    ],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $avecPrix))['body'];
check(
    'un plafond vidé redevient nul, pas zéro',
    array_key_exists('max_qty_per_ticket', $etat['offer'])
        && $etat['offer']['max_qty_per_ticket'] === null,
    json_encode($etat['offer']['max_qty_per_ticket'] ?? 'absent')
);

$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $avecPrix), [], [
    'name'  => 'Campagne avec prix',
    'offer' => ['title' => 'Offre chiffrée', 'items' => [
        ['label' => 'Produit', 'mechanic_type' => 'AU_PIF'],
    ]],
]);
check(
    'une mécanique de promotion inconnue est refusée',
    $response['status'] === 422,
    'statut ' . $response['status']
);

// Une tenue choisie doit apparaître sur l'écran « Pub physique », sinon le
// choix de l'assistant ne va nulle part.
$response = call($router, 'GET', '/api/v1/marketing/diffusion', ['family' => 'PHYSIQUE']);
$attached = array_filter(
    $response['body']['uniforms'] ?? [],
    static fn (array $u): bool => $u['campaign_id'] !== null
);
check('la tenue choisie remonte en diffusion', $attached !== [], count($response['body']['uniforms'] ?? []) . ' tenue(s)');

// Une cible inconnue est refusée, et non ramenée en silence à b2c : une faute
// de frappe doit se voir, pas produire une campagne au périmètre inattendu.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Cible douteuse', 'client_target' => 'b2x',
]);
check('une cible inconnue est refusée', $response['status'] === 422, 'statut ' . $response['status']);
check(
    'et la campagne n\'est pas créée',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign WHERE name = 'Cible douteuse'")->fetchColumn() === 0
);

// Rattachement invalide : rien ne doit subsister, pas même l'en-tête.
$before   = (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign')->fetchColumn();
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'     => 'Doit être annulée',
    'channels' => [['channel_id' => 999999]],
]);
check('un rattachement invalide fait échouer la création', $response['status'] === 500, 'statut ' . $response['status']);
check(
    'la transaction est annulée en entier',
    (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign')->fetchColumn() === $before
);

// Un franchisé ne rattache pas la campagne d'un confrère.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'     => 'Tentative hors périmètre',
    'scope'    => 'LOCALE',
    'shop_ids' => [2],
]);
check('rattacher une boutique hors périmètre est refusé', $response['status'] === 422, 'statut ' . $response['status']);
check(
    'et la campagne n\'est pas créée',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign WHERE name = 'Tentative hors périmètre'")->fetchColumn() === 0
);

// Le périmètre s'applique aussi en lecture des boutiques.
$response = call($router, 'GET', '/api/v1/marketing/shops');
check('la liste des boutiques est cloisonnée', count($response['body']) === 1, count($response['body']) . ' reçue(s)');

// L'identifiant ERP de l'enseigne est servi : c'est par lui que le module
// traduit « ?brand=1 » en périmètre, le sélecteur de marque ayant disparu.
// Sans ce champ, l'adresse d'ouverture ne désigne plus rien.
$response = call($router, 'GET', '/api/v1/marketing/brands');
check(
    'les marques portent leur identifiant ERP',
    array_key_exists('erp_brand_id', $response['body'][0] ?? []),
    json_encode($response['body'][0] ?? null)
);

// --- Reprise d'un brouillon -------------------------------------------------
// Une campagne en brouillon est une campagne qu'on n'a pas fini d'écrire.
// Jusqu'ici elle ne pouvait pas l'être : `update()` ne touche que les colonnes,
// et les rattachements ne s'écrivaient qu'à la création. Un brouillon était un
// cul-de-sac — visible dans la liste, impossible à terminer.
echo "\nReprise d'un brouillon\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$secteurs = array_column($refs['b2bSectors'], 'id', 'code');

$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'           => 'Brouillon à reprendre',
    'status_code'    => 'draft',
    'scope'          => 'RESEAU',
    'client_target'  => 'b2b',
    'type_id'        => (int) $types['ouverture']['id'],
    'sector_ids'     => [(int) $secteurs['offices']],
    'agency_ask_ids' => array_slice(array_column($refs['agencyAsks'], 'id'), 0, 2),
    'uniform_ids'    => array_slice(array_column($refs['uniforms'], 'id'), 0, 1),
    'channels'       => [['channel_id' => (int) $refs['channels'][0]['id'], 'budget_amount' => 400]],
    'retroplanning'  => [['label' => 'Brief agence', 'days_before_launch' => 30]],
]);
$brouillon = (int) $response['body']['inserted_id'];

$response = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon));
$etat     = $response['body'];
check('le brouillon se relit par identifiants', $response['status'] === 200);
check(
    'les pastilles cochées reviennent en identifiants, pas en libellés',
    $etat['sector_ids'] === [(int) $secteurs['offices']] && count($etat['agency_ask_ids']) === 2,
    json_encode(['secteurs' => $etat['sector_ids'], 'agence' => $etat['agency_ask_ids']])
);
check('les canaux reviennent avec leur budget', ($etat['channels'][0]['budget_amount'] ?? null) == 400);
check('le rétroplanning enregistré revient', count($etat['retroplanning']) === 1);

// Repris de l'assistant du BO quand tout l'assistant est revenu ici : le filtre
// « bureaux à livrer » part avec la campagne, un canal peut être retenu sans être
// validé, et rouvrir l'assistant sur un brouillon identique ne l'empile pas.
$bureaux = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'             => 'Bureaux à livrer',
    'status_code'      => 'draft',
    'scope'            => 'RESEAU',
    'client_target'    => 'b2b',
    'type_id'          => (int) $types['ouverture']['id'],
    'starts_on'        => '2031-03-02',
    'ends_on'          => '2031-03-29',
    'b2b_offices_only' => true,
    'sector_ids'       => [(int) $secteurs['offices']],
    'channels'         => [
        ['channel_id' => (int) $refs['channels'][0]['id'], 'budget_amount' => 300, 'is_enabled' => false],
        ['channel_id' => (int) $refs['channels'][1]['id'], 'budget_amount' => 120],
    ],
]);
$idBureaux = (int) $bureaux['body']['inserted_id'];
$etatBureaux = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $idBureaux))['body'];
check('« bureaux à livrer » revient avec le brouillon', ($etatBureaux['b2b_offices_only'] ?? null) === true, json_encode($etatBureaux['b2b_offices_only'] ?? null));
$canaux = array_column($etatBureaux['channels'] ?? [], 'is_enabled', 'channel_id');
check(
    'un canal retenu n\'est pas validé ; sans précision, il l\'est (campagnes d\'avant)',
    isset($canaux[(int) $refs['channels'][0]['id']]) && !$canaux[(int) $refs['channels'][0]['id']]
        && !empty($canaux[(int) $refs['channels'][1]['id']]),
    json_encode($canaux)
);
$encore = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Bureaux à livrer', 'status_code' => 'draft', 'scope' => 'RESEAU', 'client_target' => 'b2b',
    'type_id' => (int) $types['ouverture']['id'], 'starts_on' => '2031-03-02', 'ends_on' => '2031-03-29',
]);
check('le même brouillon (nom et dates) n\'est pas créé deux fois', (int) ($encore['body']['inserted_id'] ?? 0) === $idBureaux);
call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $idBureaux));

echo "\nSuivi d'une campagne : action suivie, par boutique ou pour le réseau\n";
$actions = array_column($refs['trackingActions'] ?? [], null, 'code');
check(
    'les actions suivies viennent du référentiel, avec unité et source',
    isset($actions['trafic'], $actions['commandes_web'], $actions['clients_b2b'], $actions['panier'])
        && $actions['trafic']['cockpit_measure'] === 'trafic' && $actions['commandes_web']['cockpit_measure'] === null
        && $actions['trafic']['unit_label'] !== '',
    json_encode(array_keys($actions))
);
$suivi = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Suivi des commandes en ligne', 'status_code' => 'draft', 'scope' => 'RESEAU', 'client_target' => 'b2b',
    'type_id' => (int) $types['ouverture']['id'],
    'tracking_action_id' => (int) $actions['commandes_web']['id'], 'tracking_scope' => 'NETWORK',
    'tracking_target' => '120', 'tracking_baseline' => 'N1',
]);
$idSuivi = (int) ($suivi['body']['inserted_id'] ?? 0);
$etatSuivi = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $idSuivi))['body'];
check(
    'le suivi revient avec le brouillon (action, réseau, cible, l\'an dernier)',
    ($etatSuivi['tracking_action_id'] ?? null) === (int) $actions['commandes_web']['id'] && $etatSuivi['tracking_scope'] === 'NETWORK'
        && $etatSuivi['tracking_target'] === 120.0 && $etatSuivi['tracking_baseline'] === 'N1',
    json_encode(array_intersect_key($etatSuivi, array_flip(['tracking_action_id', 'tracking_scope', 'tracking_target', 'tracking_baseline'])))
);
$fiche = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body'];
check(
    'la fiche dit l\'action suivie en clair, son unité et où elle se lit',
    ($fiche['tracking_action_label'] ?? '') === 'Commandes en ligne (webshop)' && ($fiche['tracking_unit_label'] ?? '') === 'commandes'
        && ($fiche['tracking_source_label'] ?? '') === 'Webshop' && $fiche['tracking_cockpit_measure'] === null,
    json_encode(array_intersect_key($fiche, array_flip(['tracking_action_label', 'tracking_unit_label', 'tracking_source_label'])))
);
$maj = call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi), [], [
    'tracking_action_id' => (int) $actions['trafic']['id'], 'tracking_scope' => 'SHOP', 'tracking_target' => '', 'tracking_baseline' => 'AVANT',
]);
$fiche = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body'];
check(
    'le suivi se change : trafic en magasin, par boutique, sans cible, juste avant le lancement',
    $maj['status'] === 200 && ($fiche['tracking_action_code'] ?? '') === 'trafic' && $fiche['tracking_scope'] === 'SHOP'
        && $fiche['tracking_target'] === null && $fiche['tracking_baseline'] === 'AVANT' && $fiche['tracking_cockpit_measure'] === 'trafic',
    json_encode([$maj['status'], $fiche['tracking_action_code'] ?? null, $fiche['tracking_scope'] ?? null, $fiche['tracking_target'] ?? 'x'])
);
foreach ([
    'action inconnue'   => ['tracking_action_id' => 999999],
    'portée inconnue'   => ['tracking_scope' => 'MONDE'],
    'référence inconnue'=> ['tracking_baseline' => 'HIER'],
    'cible négative'    => ['tracking_target' => -5],
] as $cas => $corps) {
    $refus = call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi), [], $corps);
    check('suivi refusé (' . $cas . ') : 422, rien d\'écrit', $refus['status'] === 422
        && call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body']['tracking_scope'] === 'SHOP', 'statut ' . $refus['status']);
}
// L'assistant enregistre une campagne lancée en PATCH, colonnes seules : les couleurs en font partie.
call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi), [], ['status_code' => 'planned']);
$couleurs = call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi), [], ['color_primary_hex' => '#8D1D2C', 'name' => 'Suivi renommé']);
$fiche = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body'];
check('campagne lancée : couleurs et nom se changent en PATCH, sans toucher au reste', $couleurs['status'] === 200
    && strtoupper((string) ($fiche['color_primary_hex'] ?? '')) === '#8D1D2C' && $fiche['name'] === 'Suivi renommé' && $fiche['status_code'] === 'planned'
    && ($fiche['tracking_action_code'] ?? '') === 'trafic', json_encode([$couleurs['status'], $fiche['color_primary_hex'] ?? null, $fiche['name'] ?? null]));

// Les objectifs par levier se complètent sur une campagne lancée (PUT …/lever-targets) : seuls
// eux bougent, rejouer l'envoi ne double rien, un envoi fautif n'écrit rien.
$trafic    = (int) $pdo->query("SELECT id FROM mar_lever WHERE code = 'TRAFIC'")->fetchColumn();
$objectifs = sprintf('/api/v1/marketing/campaigns/%d/lever-targets', $idSuivi);
$objectifTrafic      = static function () use ($router, $idSuivi, $trafic): array {
    $fiche = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body'];

    return [array_values(array_filter($fiche['levers'] ?? [], static fn ($l) => (int) $l['lever_id'] === $trafic)), $fiche];
};
$pose   = call($router, 'PUT', $objectifs, [], ['lever_targets' => [['lever_id' => $trafic, 'target_value' => 3000]]]);
$encore = call($router, 'PUT', $objectifs, [], ['lever_targets' => [['lever_id' => $trafic, 'target_value' => 3000]]]);
[$lus, $fiche] = $objectifTrafic();
check('campagne lancée : l\'objectif par levier se complète, rejoué sans doublon, le reste intact',
    $pose['status'] === 200 && $encore['status'] === 200 && count($lus) === 1 && (float) $lus[0]['target_value'] === 3000.0
        && $fiche['status_code'] === 'planned' && $fiche['name'] === 'Suivi renommé',
    json_encode([$pose['status'], $encore['status'], $lus, $fiche['status_code'] ?? null]));
foreach ([
    'levier inconnu'  => [['lever_id' => 999999, 'target_value' => 10]],
    'montant négatif' => [['lever_id' => $trafic, 'target_value' => -1]],
    'pas une liste'   => 'tout',
] as $cas => $corps) {
    $refus = call($router, 'PUT', $objectifs, [], ['lever_targets' => $corps]);
    check('objectif refusé (' . $cas . ') : 422, rien d\'écrit', $refus['status'] === 422 && (float) ($objectifTrafic()[0][0]['target_value'] ?? 0) === 3000.0,
        'statut ' . $refus['status']);
}
check('objectif d\'une campagne inconnue : 404',
    call($router, 'PUT', '/api/v1/marketing/campaigns/999999/lever-targets', [], ['lever_targets' => []])['status'] === 404);
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$franchise = call($router, 'PUT', $objectifs, [], ['lever_targets' => [['lever_id' => $trafic, 'target_value' => 1]]]);
AuthContext::clear();
$anonyme = call($router, 'PUT', $objectifs, [], ['lever_targets' => [['lever_id' => $trafic, 'target_value' => 1]]]);
AuthContext::set(1, 'BRAND_ADMIN', 1);
check('l\'objectif d\'une campagne réseau ne se change ni par un franchisé, ni sans identité',
    in_array($franchise['status'], [403, 404, 422], true) && $anonyme['status'] === 401 && (float) ($objectifTrafic()[0][0]['target_value'] ?? 0) === 3000.0,
    json_encode([$franchise['status'], $anonyme['status']]));
$retire = call($router, 'PUT', $objectifs, [], ['lever_targets' => [['lever_id' => $trafic, 'target_value' => '']]]);
check('un montant vide détache le levier', $retire['status'] === 200 && $objectifTrafic()[0] === [], json_encode($objectifTrafic()[0]));

// Des produits s'ajoutent à l'offre d'une campagne lancée (POST …/offer-items) : ajout seul,
// une campagne sans offre en reçoit une, et rejouer l'envoi ne rajoute rien.
$produits    = sprintf('/api/v1/marketing/campaigns/%d/offer-items', $idSuivi);
$lignesOffre = static fn (): array => array_column(
    call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi))['body']['offer']['items'] ?? [],
    'label'
);
$ajout   = call($router, 'POST', $produits, [], ['offer_item_ids' => [$catalogItemId]]);
$rejoue  = call($router, 'POST', $produits, [], ['offer_item_ids' => [$catalogItemId, $seasonItemId]]);
check('campagne lancée : les produits s\'ajoutent à l\'offre, sans doublon au second envoi',
    $ajout['status'] === 200 && $rejoue['status'] === 200 && $lignesOffre() === ['Tarte du jour', 'Gamme Estivale (Juin à Août)'],
    json_encode([$ajout['status'], $rejoue['status'], $lignesOffre()]));
foreach (['produit inconnu' => [999999], 'liste vide' => [], 'pas une liste' => 'tout'] as $cas => $corps) {
    $refus = call($router, 'POST', $produits, [], ['offer_item_ids' => $corps]);
    check('produits refusés (' . $cas . ') : 422, rien d\'écrit', $refus['status'] === 422 && count($lignesOffre()) === 2, 'statut ' . $refus['status']);
}
check('produits d\'une campagne inconnue : 404',
    call($router, 'POST', '/api/v1/marketing/campaigns/999999/offer-items', [], ['offer_item_ids' => [$catalogItemId]])['status'] === 404);
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$franchise = call($router, 'POST', $produits, [], ['offer_item_ids' => [$catalogItemId]]);
AuthContext::clear();
$anonyme = call($router, 'POST', $produits, [], ['offer_item_ids' => [$catalogItemId]]);
AuthContext::set(1, 'BRAND_ADMIN', 1);
check('l\'offre d\'une campagne réseau ne se complète ni par un franchisé, ni sans identité',
    in_array($franchise['status'], [403, 404, 422], true) && $anonyme['status'] === 401 && count($lignesOffre()) === 2,
    json_encode([$franchise['status'], $anonyme['status']]));
// Brochures (leaflet A5, dépliant A4) : les réglages du générateur, un par format. Rejouer le même
// envoi ne crée rien de plus ; un envoi fautif n'écrit rien ; le périmètre est celui de la campagne.
$brochures = sprintf('/api/v1/marketing/campaigns/%d/brochures', $idSuivi);
$reglages  = [
    'template' => 'ruby',
    'texts'    => ['fr' => ['title' => 'Les bûches de fêtes', 'cta' => 'Réservez la vôtre'], 'nl' => ['title' => 'Onze kerststammen']],
    'products' => [['key' => 'erp-9901', 'on' => true, 'price' => 14.9]],
    'qr'       => ['mode' => 'category', 'category' => 41000, 'group' => 34],
    'excludedShops' => [2],
    'cropMarks' => true,
];
$vide   = call($router, 'GET', $brochures);
$pose   = call($router, 'PUT', $brochures . '/leaflet-a5', [], ['settings' => $reglages]);
$encore = call($router, 'PUT', $brochures . '/leaflet-a5', [], ['settings' => $reglages]);
$lues   = call($router, 'GET', $brochures);
$a5     = $lues['body'][0] ?? [];
check('brochure : vide au départ, enregistrée, rejouée sans doublon, relue telle quelle',
    $vide['status'] === 200 && $vide['body'] === [] && $pose['status'] === 200 && $encore['status'] === 200
        && count($lues['body']) === 1 && ($a5['format'] ?? '') === 'leaflet-a5' && ($a5['settings']['template'] ?? '') === 'ruby'
        && ($a5['settings']['texts']['nl']['title'] ?? '') === 'Onze kerststammen' && ($a5['settings']['products'][0]['price'] ?? null) === 14.9
        && ($a5['settings']['qr']['category'] ?? null) === 41000 && ($a5['settings']['excludedShops'] ?? null) === [2],
    json_encode([$vide['status'], $pose['status'], $encore['status'], $lues['body']], JSON_UNESCAPED_UNICODE));
foreach ([
    'format inconnu'   => ['/flyer-dl', $reglages],
    'modèle inconnu'   => ['/leaflet-a5', ['template' => 'fluo'] + $reglages],
    'clé inconnue'     => ['/leaflet-a5', $reglages + ['police' => 'Comic']],
    'texte trop long'  => ['/leaflet-a5', ['texts' => ['fr' => ['title' => str_repeat('a', 241)]]] + $reglages],
    'langue inconnue'  => ['/leaflet-a5', ['texts' => ['de' => ['title' => 'Baumkuchen']]] + $reglages],
    'prix négatif'     => ['/leaflet-a5', ['products' => [['key' => 'erp-9901', 'on' => true, 'price' => -1]]] + $reglages],
    'QR sans catégorie'=> ['/leaflet-a5', ['qr' => ['mode' => 'category']] + $reglages],
] as $cas => [$suffixe, $corps]) {
    $refus = call($router, 'PUT', $brochures . $suffixe, [], ['settings' => $corps]);
    $apres = call($router, 'GET', $brochures)['body'];
    check('brochure refusée (' . $cas . ') : 422, rien d\'écrit', $refus['status'] === 422 && count($apres) === 1
        && ($apres[0]['settings']['template'] ?? '') === 'ruby', 'statut ' . $refus['status']);
}
check('brochures d\'une campagne inconnue : 404 en lecture comme en écriture',
    call($router, 'GET', '/api/v1/marketing/campaigns/999999/brochures')['status'] === 404
        && call($router, 'PUT', '/api/v1/marketing/campaigns/999999/brochures/leaflet-a5', [], ['settings' => $reglages])['status'] === 404);
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$franchise = call($router, 'PUT', $brochures . '/depliant-a4', [], ['settings' => $reglages]);
AuthContext::clear();
$anonyme = call($router, 'GET', $brochures);
AuthContext::set(1, 'BRAND_ADMIN', 1);
check('la brochure d\'une campagne réseau ne se règle ni par un franchisé, ni sans identité',
    in_array($franchise['status'], [403, 404, 422], true) && $anonyme['status'] === 401 && count(call($router, 'GET', $brochures)['body']) === 1,
    json_encode([$franchise['status'], $anonyme['status']]));
call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $idSuivi));

// Réécriture en bloc : les rattachements sont remplacés, pas empilés. Les
// ajouter aux précédents laisserait les canaux d'avant à côté des nouveaux, et
// les budgets doubleraient sans que rien ne le signale.
$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'          => 'Brouillon repris',
    'status_code'   => 'draft',
    'scope'         => 'RESEAU',
    'client_target' => 'b2b',
    'type_id'       => (int) $types['ouverture']['id'],
    'sector_ids'    => [(int) $secteurs['horeca']],
    'channels'      => [['channel_id' => (int) $refs['channels'][1]['id'], 'budget_amount' => 250]],
    'retroplanning' => [['label' => 'Brief agence', 'days_before_launch' => 30]],
    // Une campagne réseau peut porter des objectifs : la boutique objectivée
    // est rattachée pour eux, sans faire de la campagne une campagne locale.
    'shop_targets'  => [['shop_id' => 2, 'target_pieces' => 75]],
]);
check('la reprise aboutit', $response['status'] === 200, 'statut ' . $response['status']);

$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check('le nom est repris', $etat['name'] === 'Brouillon repris');
check(
    'les objectifs de pièces reviennent avec le brouillon',
    ($etat['shop_targets'] ?? null) === [
        ['shop_id' => 2, 'target_pieces' => 75, 'challenge_trigger_pct' => null, 'staff_headcount' => null],
    ],
    json_encode($etat['shop_targets'] ?? null)
);
// Sans challenge, le seuil reste nul : c'est ce qui distingue « pas de seuil »
// d'un seuil à zéro, lequel qualifierait la boutique sans qu'elle vende rien.
check(
    'sans challenge, aucun seuil n\'est posé',
    $etat['challenge_enabled'] === false
        && $etat['challenge_metric'] === null
        && $etat['challenge_prizes'] === [],
    json_encode([
        'actif'   => $etat['challenge_enabled'] ?? null,
        'critere' => $etat['challenge_metric'] ?? null,
        'prix'    => $etat['challenge_prizes'] ?? null,
    ])
);

// ── Challenge : classement, seuil général, seuils par boutique ──────────────

call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'          => 'Brouillon repris',
    'status_code'   => 'draft',
    'scope'         => 'RESEAU',
    'client_target' => 'b2b',
    'challenge_enabled'     => true,
    'challenge_metric'      => 'attainment',
    'challenge_trigger_pct' => 100,
    'challenge_prizes'      => [['label' => '1 000 € + trophée'], ['label' => ''], ['label' => '300 €']],
    'shop_targets'  => [
        ['shop_id' => 2, 'target_pieces' => 75, 'challenge_trigger_pct' => 90],
        ['shop_id' => 1, 'target_pieces' => 40, 'challenge_trigger_pct' => null],
    ],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];

check(
    'le challenge revient avec son critère et son seuil général',
    $etat['challenge_enabled'] === true
        && $etat['challenge_metric'] === 'attainment'
        && (float) $etat['challenge_trigger_pct'] === 100.0,
    json_encode([
        'actif'   => $etat['challenge_enabled'] ?? null,
        'critere' => $etat['challenge_metric'] ?? null,
        'seuil'   => $etat['challenge_trigger_pct'] ?? null,
    ])
);

$seuils = [];
foreach ($etat['shop_targets'] ?? [] as $cible) {
    $seuils[$cible['shop_id']] = $cible['challenge_trigger_pct'];
}
check(
    'le seuil propre à une boutique revient, les autres restent nuls',
    (float) $seuils[2] === 90.0 && array_key_exists(1, $seuils) && $seuils[1] === null,
    json_encode($seuils)
);

// Le rang vient de la position, jamais d'un champ transmis : un prix vide ne
// fait pas remonter le suivant, sinon le troisième deviendrait deuxième et la
// dotation annoncée ne correspondrait plus au podium affiché.
check(
    'un rang sans dotation laisse sa place vide au lieu de décaler les suivants',
    ($etat['challenge_prizes'] ?? null) === [
        ['rank_position' => 1, 'label' => '1 000 € + trophée'],
        ['rank_position' => 3, 'label' => '300 €'],
    ],
    json_encode($etat['challenge_prizes'] ?? null)
);

// Réécriture : les prix se remplacent, ils ne s'ajoutent pas. Sans purge, la
// clé unique (campagne, rang) ferait échouer la seconde reprise — le défaut se
// serait vu à la deuxième sauvegarde, pas à la première.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'        => 'Brouillon repris',
    'status_code' => 'draft',
    'scope'       => 'RESEAU',
    'challenge_enabled' => true,
    'challenge_metric'  => 'pieces',
    'challenge_prizes'  => [['label' => 'Week-end équipe']],
    'shop_targets'      => [['shop_id' => 2, 'target_pieces' => 75]],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check(
    'les prix sont remplacés et non empilés',
    ($etat['challenge_prizes'] ?? null) === [['rank_position' => 1, 'label' => 'Week-end équipe']],
    json_encode($etat['challenge_prizes'] ?? null)
);
check(
    'un seuil retiré redevient nul',
    array_key_exists('challenge_trigger_pct', $etat['shop_targets'][0])
        && $etat['shop_targets'][0]['challenge_trigger_pct'] === null,
    json_encode($etat['shop_targets'] ?? null)
);

// ── Objectifs croisés boutique × produit ───────────────────────────────────
//
// « Gosselies : 256 pièces » ne dit pas de quoi, « 3 000 cougnous » ne dit pas
// par qui. Le croisement des deux est ce qu'un chef d'équipe peut suivre.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'        => 'Brouillon repris',
    'status_code' => 'draft',
    'scope'       => 'RESEAU',
    'shop_targets' => [
        ['shop_id' => 1, 'target_pieces' => 300],
        ['shop_id' => 2, 'target_pieces' => 120],
    ],
    'shop_item_targets' => [
        ['shop_id' => 1, 'offer_item_id' => $catalogItemId, 'target_pieces' => 180],
        ['shop_id' => 2, 'offer_item_id' => $catalogItemId, 'target_pieces' => 90],
        // Boutique hors campagne : elle n'a pas d'objectif de son côté, sa
        // ligne ne doit donc pas s'écrire — sinon le total réseau compterait
        // des pièces qu'aucun écran ne montre.
        ['shop_id' => 3, 'offer_item_id' => $catalogItemId, 'target_pieces' => 50],
        // Zéro est un objectif — « n'en vendez pas ». Le perdre ferait remonter
        // l'historique du produit à la relecture, et le total de la boutique
        // changerait sans que personne n'y ait touché.
        ['shop_id' => 1, 'offer_item_id' => $seasonItemId, 'target_pieces' => 0],
    ],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check(
    'l\'objectif croisé boutique × produit revient avec le brouillon',
    ($etat['shop_item_targets'] ?? null) === [
        ['shop_id' => 1, 'offer_item_id' => min($catalogItemId, $seasonItemId), 'target_pieces' => $catalogItemId < $seasonItemId ? 180 : 0],
        ['shop_id' => 1, 'offer_item_id' => max($catalogItemId, $seasonItemId), 'target_pieces' => $catalogItemId < $seasonItemId ? 0 : 180],
        ['shop_id' => 2, 'offer_item_id' => $catalogItemId, 'target_pieces' => 90],
    ],
    json_encode($etat['shop_item_targets'] ?? null)
);

// Réécriture : le détail se remplace, il ne s'empile pas. Sans purge, la clé
// primaire (campagne, boutique, produit) ferait échouer la seconde reprise.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'        => 'Brouillon repris',
    'status_code' => 'draft',
    'scope'       => 'RESEAU',
    'shop_targets' => [['shop_id' => 1, 'target_pieces' => 300]],
    'shop_item_targets' => [
        ['shop_id' => 1, 'offer_item_id' => $catalogItemId, 'target_pieces' => 200],
    ],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check(
    'le détail est remplacé et non empilé',
    ($etat['shop_item_targets'] ?? null) === [
        ['shop_id' => 1, 'offer_item_id' => $catalogItemId, 'target_pieces' => 200],
    ],
    json_encode($etat['shop_item_targets'] ?? null)
);

// Une référence disparue du catalogue ne doit pas faire tomber toute la
// campagne sur une contrainte de clé étrangère.
$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'        => 'Brouillon repris',
    'status_code' => 'draft',
    'scope'       => 'RESEAU',
    'shop_targets' => [['shop_id' => 1, 'target_pieces' => 300]],
    'shop_item_targets' => [
        ['shop_id' => 1, 'offer_item_id' => 999_999, 'target_pieces' => 40],
    ],
]);
check(
    'un objectif sur une référence disparue est ignoré, pas fatal',
    $response['status'] === 200,
    'statut ' . $response['status']
);

// Un critère inconnu se refuse avec un message, plutôt que d'écrire une valeur
// que le classement ne saurait pas interpréter.
$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'              => 'Brouillon repris',
    'status_code'       => 'draft',
    'scope'             => 'RESEAU',
    'challenge_enabled' => true,
    'challenge_metric'  => 'au-pif',
]);
check(
    'un critère de classement inconnu est refusé',
    $response['status'] === 422,
    'statut ' . $response['status']
);

// Remise en état pour la suite du scénario, qui reprend ce brouillon.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'          => 'Brouillon repris',
    'status_code'   => 'draft',
    'scope'         => 'RESEAU',
    'client_target' => 'b2b',
    'sector_ids'    => [(int) $secteurs['horeca']],
    'channels'      => [['channel_id' => (int) $refs['channels'][1]['id'], 'budget_amount' => 250]],
    'retroplanning' => [['label' => 'Brief agence', 'days_before_launch' => 30]],
    'shop_targets'  => [['shop_id' => 2, 'target_pieces' => 75]],
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check(
    'les rattachements sont remplacés et non empilés',
    $etat['sector_ids'] === [(int) $secteurs['horeca']] && count($etat['channels']) === 1,
    json_encode(['secteurs' => $etat['sector_ids'], 'canaux' => count($etat['channels'])])
);
check(
    'les jonctions vidées le restent',
    $etat['agency_ask_ids'] === [] && $etat['uniform_ids'] === [],
    json_encode(['agence' => $etat['agency_ask_ids'], 'tenues' => $etat['uniform_ids']])
);
check(
    'le rétroplanning n\'est pas dupliqué',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_retroplanning_step WHERE campaign_id = %d',
        $brouillon
    ))->fetchColumn() === 1
);

// L'étape où l'on s'arrête est enregistrée avec le brouillon. La déduire de ce
// qui manque ne marche pas : offre, budget et communication sont facultatifs,
// donc un brouillon quitté à l'étape 2 n'a rien d'incomplet — il rouvrait au
// récapitulatif, à la fin d'un travail à peine commencé.
// Les rattachements sont renvoyés tels quels : ce PUT remplace tout, et les
// omettre les effacerait — ce que la suite du scénario vérifie justement.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name'        => 'Brouillon repris',
    'status_code' => 'draft',
    'draft_step'  => 'offer',
    'scope'       => 'RESEAU',
    'sector_ids'  => [(int) $secteurs['horeca']],
    'channels'    => [['channel_id' => (int) $refs['channels'][1]['id'], 'budget_amount' => 250]],
    'image_url'   => 'https://exemple.test/affiche.png',
    'image_fit'   => 'contain',
    'format_ids'  => array_column($refs['formats'], 'id'),
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon))['body'];
check(
    'le brouillon retient l\'étape où on l\'a laissé',
    ($etat['draft_step'] ?? null) === 'offer',
    json_encode($etat['draft_step'] ?? null)
);
check(
    'le cadrage du visuel revient avec le brouillon',
    ($etat['image_fit'] ?? null) === 'contain',
    json_encode($etat['image_fit'] ?? null)
);

// Une campagne lancée porte des choses que l'assistant ne connaît pas —
// l'adhésion d'un franchisé, un jalon déjà coché. Les reconstruire à neuf les
// effacerait : la réécriture en bloc s'arrête au brouillon.
call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $brouillon), [], ['status_code' => 'live']);
$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name' => 'Tentative sur campagne lancée',
]);
check(
    'une campagne lancée ne se réécrit pas en bloc',
    $response['status'] === 422,
    'statut ' . $response['status']
);
check(
    'et son contenu est intact',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_campaign_channel WHERE campaign_id = %d',
        $brouillon
    ))->fetchColumn() === 1
);

// Le périmètre s'applique à la reprise comme au reste. Lire une campagne
// réseau est légitime pour un franchisé — il en dépend. La réécrire ne l'est
// pas : la lecture n'est pas une permission d'écriture, et c'est exactement la
// confusion qui rendait autrefois une campagne réseau modifiable depuis une
// boutique.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$brouillonLocal = (int) call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'        => 'Brouillon local',
    'status_code' => 'draft',
    'scope'       => 'LOCALE',
    'shop_ids'    => [1],
])['body']['inserted_id'];

$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillon), [], [
    'name' => 'Reprise par un franchisé',
]);
check(
    'un franchisé ne reprend pas un brouillon du réseau',
    $response['status'] === 422,
    'statut ' . $response['status']
);
check(
    'et le nom du brouillon réseau est intact',
    $pdo->query(sprintf('SELECT name FROM mar_campaign WHERE id = %d', $brouillon))->fetchColumn()
        !== 'Reprise par un franchisé'
);

$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillonLocal), [], [
    'name'     => 'Brouillon local repris',
    'scope'    => 'LOCALE',
    'shop_ids' => [1],
]);
check('mais il reprend le sien', $response['status'] === 200, 'statut ' . $response['status']);

$response = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $brouillonLocal), [], [
    'name'     => 'Chez le voisin',
    'scope'    => 'LOCALE',
    'shop_ids' => [2],
]);
check(
    'sans pouvoir le rattacher à la boutique d\'un confrère',
    $response['status'] === 422,
    'statut ' . $response['status']
);
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Contrôles à l'écriture ------------------------------------------------
// L'assistant impose déjà ces règles, mais il n'est qu'un client parmi
// d'autres. Deux d'entre elles comptent particulièrement : une portée refusée
// au franchisé — sinon il crée une campagne visible de tout le réseau — et une
// valeur inconnue rejetée plutôt que ramenée en silence à « RESEAU », qui est
// la plus permissive.
echo "\nContrôles à l'écriture\n";
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Réseau par un franchisé', 'scope' => 'RESEAU',
]);
check('un franchisé ne crée pas de campagne réseau', $response['status'] === 422, 'statut ' . $response['status']);

AuthContext::set(1, 'BRAND_ADMIN', 1);
foreach ([
    'portée inconnue'      => ['scope' => 'BIDON'],
    'cible inconnue'       => ['client_target' => 'b2x'],
    'période inversée'     => ['starts_on' => '2026-12-31', 'ends_on' => '2026-01-01'],
    'budget négatif'       => ['budget_amount' => -5000],
    'état inconnu'         => ['status_code' => 'zzz'],
    'écart au N-1 démesuré'=> ['objective_coef_pct' => 99999],
    'type inconnu'         => ['type_id' => 999999],
] as $label => $payload) {
    $response = call($router, 'POST', '/api/v1/marketing/campaigns', [], ['name' => 'Refus ' . $label] + $payload);
    check(sprintf('%s est refusée', $label), $response['status'] === 422, 'statut ' . $response['status']);
}

// Le message doit permettre de corriger, pas seulement de constater.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], ['name' => 'X', 'status_code' => 'zzz']);
check(
    'le refus nomme les états acceptés',
    str_contains((string) ($response['body']['description'] ?? ''), 'draft'),
    (string) ($response['body']['description'] ?? '')
);

check(
    'et rien n\'est écrit',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign WHERE name LIKE 'Refus %' OR name = 'X'")->fetchColumn() === 0
);

// --- Relecture du cadrage --------------------------------------------------
// Tout ce que l'assistant fait saisir doit ressortir de la fiche. Ces champs
// étaient enregistrés et relus par aucun écran : une fiche illisible ne vaut
// guère mieux qu'une fiche perdue.
echo "\nRelecture du cadrage\n";
$response = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $newId));
$detail   = $response['body'];

foreach ([
    'ton'              => fn (): bool => ($detail['tone_label'] ?? '') === 'Gourmand',
    'cible client'     => fn (): bool => ($detail['client_target'] ?? '') === 'b2b',
    'écart au N-1'     => fn (): bool => (float) ($detail['objective_coef_pct'] ?? 0) === 12.0,
    'note de brief'    => fn (): bool => ($detail['agency_note'] ?? '') !== '',
    'demandes agence'  => fn (): bool => count($detail['agency_asks'] ?? []) === 2,
    'options B2B'      => fn (): bool => count($detail['b2b_options'] ?? []) === 1,
    'tenues'           => fn (): bool => count($detail['uniforms'] ?? []) === 1,
    'canaux'           => fn (): bool => count($detail['channels'] ?? []) === 1,
    'secteurs'         => fn (): bool => count($detail['sectors'] ?? []) === 6,
    'rétroplanning'    => fn (): bool => count($detail['retroplanning'] ?? []) === 5,
    'offre'            => fn (): bool => ($detail['offer']['title'] ?? '') === 'Menu Barbecue',
    'visuel'           => fn (): bool => count($detail['assets'] ?? []) === 1,
    'questionnaire'    => fn (): bool => count($detail['pos_questions'] ?? []) === 2,
    'formes de réponse'=> fn (): bool => ($detail['pos_questions'][0]['answer_type_label'] ?? '') !== '',
] as $label => $assertion) {
    check(sprintf('la fiche restitue : %s', $label), $assertion());
}

check(
    'le point focal est un nombre, pas une chaîne',
    is_float($detail['assets'][0]['focal_point_y'] ?? null),
    gettype($detail['assets'][0]['focal_point_y'] ?? null)
);
check(
    'les déclinaisons attendues sont comptées',
    ($detail['assets'][0]['pending_count'] ?? null) === count($refs['formats'])
);

// --- Types de campagne ------------------------------------------------------
// Neuf types posés par un jeu de données, immuables : une carte traiteur ou une
// opération anniversaire demandait de réécrire un fichier SQL. Ils s'éditent
// maintenant — sous conditions, parce qu'un type structure le réseau entier.
echo "\nTypes de campagne\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$typesInitiaux = call($router, 'GET', '/api/v1/marketing/campaign-types')['body'];
check(
    'la liste rend les types et la bibliothèque d\'icônes',
    count($typesInitiaux['types']) >= 9 && count($typesInitiaux['icons']) >= 20
        && isset($typesInitiaux['icons'][0]['key'], $typesInitiaux['icons'][0]['path']),
    sprintf('%d types, %d icônes', count($typesInitiaux['types']), count($typesInitiaux['icons']))
);
check(
    'elle dit combien de campagnes utilisent chaque type',
    array_key_exists('campaigns', $typesInitiaux['types'][0])
);

$creation = static fn (array $corps): array => call($router, 'POST', '/api/v1/marketing/campaign-types', [], $corps);

check('un type sans nom est refusé', $creation(['label' => '  '])['status'] === 422);
check(
    'une icône hors bibliothèque est refusée',
    $creation(['label' => 'Test', 'icon_key' => '<svg onload=alert(1)>'])['status'] === 422
);
check(
    'une couleur mal formée est refusée',
    $creation(['label' => 'Test', 'color_hex' => 'rouge'])['status'] === 422
);
check(
    'un levier inexistant est refusé',
    $creation(['label' => 'Test', 'lever_id' => 999999])['status'] === 422
);

$nouveau = $creation([
    'label'             => 'Carte traiteur',
    'description'       => 'Commandes d’entreprise et plateaux',
    'color_hex'         => '#B0821A',
    'icon_key'          => 'plat',
    'default_kpi_label' => 'Commandes B2B, panier moyen',
]);
check('un type valide est créé', $nouveau['status'] === 201, json_encode($nouveau['body']));

$typeId = (int) $nouveau['body']['inserted_id'];
$relu = $pdo->query(sprintf(
    'SELECT code, label, color_hex, icon_key, icon_path, sort_order FROM mar_campaign_type WHERE id = %d',
    $typeId
))->fetch();

check('le code se dérive du nom, accents ramenés à leur lettre',
    $relu['code'] === 'carte_traiteur', $relu['code']);
check(
    'le tracé de l\'icône est recopié depuis la bibliothèque',
    $relu['icon_key'] === 'plat'
        && $relu['icon_path'] === \Marketing\Repository\CampaignTypeRepository::ICONS['plat']['path'],
    $relu['icon_path']
);
check('le nouveau type se range en fin de liste',
    (int) $relu['sort_order'] === (int) $pdo->query('SELECT MAX(sort_order) FROM mar_campaign_type')->fetchColumn());

check(
    'un code déjà pris est refusé',
    $creation(['label' => 'Carte traiteur'])['status'] === 422
);

// La couleur courte est développée plutôt que refusée : « #abc » est une
// écriture valide, et la refuser au motif qu'elle est brève serait pédant.
$court = $creation(['label' => 'Test couleur courte', 'color_hex' => '#ABC']);
check('une couleur en trois chiffres est développée',
    $pdo->query(sprintf('SELECT color_hex FROM mar_campaign_type WHERE id = %d',
        (int) $court['body']['inserted_id']))->fetchColumn() === '#aabbcc');

$modification = call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeId, [], [
    'label' => 'Traiteur & plateaux', 'icon_key' => 'camion', 'color_hex' => '#3f7a52',
]);
check('un type se modifie', $modification['status'] === 200, json_encode($modification['body']));
$apres = $pdo->query(sprintf(
    'SELECT label, code, icon_key, icon_path FROM mar_campaign_type WHERE id = %d',
    $typeId
))->fetch();
check(
    'le code ne bouge pas quand le nom change',
    $apres['code'] === 'carte_traiteur' && $apres['label'] === 'Traiteur & plateaux',
    json_encode($apres)
);
check(
    'changer d\'icône remplace aussi son tracé',
    $apres['icon_path'] === \Marketing\Repository\CampaignTypeRepository::ICONS['camion']['path']
);

// Une mise à jour partielle ne doit rien effacer au passage : un appel qui ne
// porte que le nom laissait la carte sans icône, sans couleur et sans levier,
// et rien ne le signalait.
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeId, [], ['label' => 'Traiteur']);
$partiel = $pdo->query(sprintf(
    'SELECT label, icon_key, color_hex, default_kpi_label FROM mar_campaign_type WHERE id = %d',
    $typeId
))->fetch();
check(
    'une mise à jour partielle garde ce qu\'elle ne mentionne pas',
    $partiel['label'] === 'Traiteur'
        && $partiel['icon_key'] === 'camion'
        && $partiel['color_hex'] === '#3f7a52'
        && $partiel['default_kpi_label'] === 'Commandes B2B, panier moyen',
    json_encode($partiel)
);

// Vider reste possible, mais explicitement : c'est la chaîne vide qui le dit.
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeId, [], ['icon_key' => '']);
check(
    'une valeur vide efface bien le champ',
    $pdo->query(sprintf('SELECT icon_key FROM mar_campaign_type WHERE id = %d', $typeId))
        ->fetchColumn() === null
);

// Un type inutilisé se supprime ; un type qui porte des campagnes ne se
// supprime pas — les délier rendrait muettes des campagnes qui existent.
check('un type inutilisé se supprime',
    call($router, 'DELETE', '/api/v1/marketing/campaign-types/'
        . (int) $court['body']['inserted_id'])['status'] === 200);

$typeUtilise = (int) $pdo->query(
    'SELECT type_id FROM mar_campaign WHERE type_id IS NOT NULL LIMIT 1'
)->fetchColumn();
// Son état d'origine, pour le rendre tel qu'il était : ce bloc va le renommer et
// le désactiver, et un test qui laisse un type livré sous un autre nom fait
// échouer les contrôles suivants sans rapport avec ce qu'il vérifiait.
$avantEssai = $pdo->query(sprintf(
    'SELECT label, icon_path FROM mar_campaign_type WHERE id = %d',
    $typeUtilise
))->fetch();
$refus = call($router, 'DELETE', '/api/v1/marketing/campaign-types/' . $typeUtilise);
check('un type utilisé ne se supprime pas', $refus['status'] === 409, json_encode($refus['body']));
check(
    'le refus dit combien de campagnes s\'y opposent',
    (bool) preg_match('/\d+ campagne/', (string) ($refus['body']['description'] ?? '')),
    (string) ($refus['body']['description'] ?? '')
);

// Désactiver retire des choix sans toucher à l'histoire.
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeUtilise, [], [
    'is_active' => false,
]);
$actifs = call($router, 'GET', '/api/v1/marketing/references')['body']['campaignTypes'];
check(
    'un type désactivé disparaît des choix mais reste en base',
    !in_array($typeUtilise, array_column($actifs, 'id'), true)
        && (int) $pdo->query(sprintf('SELECT COUNT(*) FROM mar_campaign_type WHERE id = %d', $typeUtilise))
            ->fetchColumn() === 1
);
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeUtilise, [], ['is_active' => true]);

// Un type livré porte un tracé sans clé : il est antérieur à la bibliothèque.
// Le renommer ne doit pas effacer son icône de la carte.
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeUtilise, [], [
    'label' => 'Ouverture (essai)',
]);
check(
    'renommer un type livré ne lui retire pas son icône',
    $pdo->query(sprintf('SELECT icon_path FROM mar_campaign_type WHERE id = %d', $typeUtilise))
        ->fetchColumn() === $avantEssai['icon_path']
);
call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeUtilise, [], [
    'label' => $avantEssai['label'],
]);

$ordre = array_reverse(array_column($typesInitiaux['types'], 'id'));
check('l\'ordre d\'affichage se réenregistre',
    call($router, 'PUT', '/api/v1/marketing/campaign-types/order', [], ['ids' => $ordre])['status'] === 200);
check(
    'le premier de la liste réordonnée est bien en tête',
    (int) $pdo->query('SELECT id FROM mar_campaign_type ORDER BY sort_order, id LIMIT 1')->fetchColumn()
        === $ordre[0]
);

// Remise en état : ce bloc a créé un type et bousculé l'ordre. Les autres
// contrôles comptent les neuf types livrés, et un deuxième lancement buterait
// sur le code déjà pris — un test qui ne se rejoue pas ne vaut qu'une fois.
call($router, 'DELETE', '/api/v1/marketing/campaign-types/' . $typeId);
call($router, 'PUT', '/api/v1/marketing/campaign-types/order', [], [
    'ids' => array_column($typesInitiaux['types'], 'id'),
]);
check(
    'le bloc se referme sur les types livrés',
    (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign_type')->fetchColumn()
        === count($typesInitiaux['types'])
);

// Un type structure le réseau : le franchisé le lit, il ne le change pas.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
check('un franchisé lit les types',
    call($router, 'GET', '/api/v1/marketing/campaign-types')['status'] === 200);
check('un franchisé n\'en crée pas',
    call($router, 'POST', '/api/v1/marketing/campaign-types', [], ['label' => 'Le mien'])['status'] === 403);
check('un franchisé n\'en modifie pas',
    call($router, 'PATCH', '/api/v1/marketing/campaign-types/' . $typeId, [], ['label' => 'X'])['status'] === 403);
check('un franchisé n\'en supprime pas',
    call($router, 'DELETE', '/api/v1/marketing/campaign-types/' . $typeId)['status'] === 403);
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Écritures hors assistant ----------------------------------------------
// Même audit que sur le constructeur, appliqué aux autres écrans. Deux points
// pesaient plus que les autres : le solde du fonds, qu'une saisie pouvait
// fausser sans rien signaler, et le droit d'écriture sur une campagne, qui
// était déduit du simple fait de la voir.
echo "\nÉcritures hors assistant\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

// `$extra` en premier : l'union de tableaux garde les clés de gauche, donc
// l'ordre inverse aurait ignoré chaque valeur que ce test cherche à éprouver.
$movement = static fn (array $extra): array => call($router, 'POST', '/api/v1/marketing/funds/movements', [], $extra + [
    'direction' => 'OUT', 'movement_date' => '2026-07-01', 'label' => 'Contrôle', 'amount' => 100,
]);

// Un sens inconnu était ramené à « OUT » : une faute de frappe sur « IN »
// retirait l'argent au lieu de l'ajouter.
check('un sens de mouvement inconnu est refusé', $movement(['direction' => 'LATERAL'])['status'] === 422);

// La vue tire le signe du sens, pas du montant : une sortie négative créditait.
check('un montant négatif est refusé', $movement(['amount' => -100])['status'] === 422);
check('un montant nul est refusé', $movement(['amount' => 0])['status'] === 422);
check('une date invalide est refusée', $movement(['movement_date' => '32/13/2026'])['status'] === 422);
check('un libellé vide est refusé', $movement(['label' => '   '])['status'] === 422);
check('une campagne inexistante est refusée', $movement(['campaign_id' => 999999])['status'] === 422);
check('un levier inexistant est refusé', $movement(['lever_id' => 999999])['status'] === 422);
check('un mouvement valide passe', $movement(['label' => 'Achat média'])['status'] === 201);

// La période couverte : les deux bornes, ou aucune. Une redevance
// trimestrielle et une contribution annuelle ne se distinguent pas d'une simple
// date d'écriture, et deux lecteurs qui n'ouvrent pas la pièce comptent deux
// choses différentes.
check(
    'une période incomplète est refusée',
    $movement(['period_from' => '2026-01-01'])['status'] === 422
);
check(
    'une période inversée est refusée',
    $movement(['period_from' => '2026-04-01', 'period_to' => '2026-01-01'])['status'] === 422
);

$reponse = $movement([
    'label'       => 'Redevance marketing T1',
    'direction'   => 'IN',
    'amount'      => 12000,
    'period_from' => '2026-01-01',
    'period_to'   => '2026-03-31',
    'lever_id'    => (int) $pdo->query("SELECT id FROM mar_lever WHERE code = 'TRAFIC'")->fetchColumn(),
    'supplier_name' => 'Franchisé Corbais',
]);
check('un mouvement avec période, levier et fournisseur passe', $reponse['status'] === 201,
    json_encode($reponse['body']));

$livre = call($router, 'GET', '/api/v1/marketing/funds/ledger', ['granularity' => 'quarter'])['body'];
$redevance = null;
foreach ($livre['periods'] as $periode) {
    foreach ([...$periode['entries'], ...$periode['exits']] as $ligne) {
        if ($ligne['label'] === 'Redevance marketing T1') {
            $redevance = $ligne;
        }
    }
}
check(
    'le grand livre rend la période, le levier et le fournisseur',
    $redevance !== null
        && $redevance['period_from'] === '2026-01-01'
        && $redevance['period_to'] === '2026-03-31'
        && $redevance['lever_label'] === 'Trafic'
        && $redevance['supplier_name'] === 'Franchisé Corbais'
        && $redevance['signed_amount'] === 12000.0,
    json_encode($redevance)
);

// Le solde ne doit contenir que des mouvements acceptés.
check(
    'aucun mouvement douteux n\'a été écrit',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_fund_movement WHERE label = 'Contrôle' OR amount <= 0")->fetchColumn() === 0
);

// --- Correction et suppression d'une écriture -------------------------------
// Une ligne du grand livre se corrige. La ressaisir changerait son identifiant,
// et ce qui pointe dessus le perdrait — d'où une mise à jour, soumise aux mêmes
// contrôles que la création : ce sont les mêmes euros dans le même solde.
$corrigible = (int) $pdo->query(
    "SELECT id FROM mar_fund_movement WHERE label = 'Redevance marketing T1' ORDER BY id DESC LIMIT 1"
)->fetchColumn();

$correction = static fn (array $extra): array => call(
    $router,
    'PATCH',
    sprintf('/api/v1/marketing/funds/movements/%d', $corrigible),
    [],
    $extra + [
        'direction' => 'IN', 'movement_date' => '2026-01-15',
        'label' => 'Redevance marketing T1', 'amount' => 12000,
    ]
);

check('une correction au sens inconnu est refusée', $correction(['direction' => 'DIAGONAL'])['status'] === 422);
check('une correction à montant négatif est refusée', $correction(['amount' => -1])['status'] === 422);
check('une correction à période inversée est refusée',
    $correction(['period_from' => '2026-06-01', 'period_to' => '2026-01-01'])['status'] === 422);
check('une correction sur une ligne inexistante est introuvable',
    call($router, 'PATCH', '/api/v1/marketing/funds/movements/999999', [], [
        'direction' => 'IN', 'movement_date' => '2026-01-15', 'label' => 'X', 'amount' => 1,
    ])['status'] === 404);

check('une correction valide passe', $correction(['amount' => 12500, 'supplier_name' => 'Franchisé Wavre'])['status'] === 200);

$relu = $pdo->query(sprintf(
    'SELECT amount, supplier_name, period_from FROM mar_fund_movement WHERE id = %d',
    $corrigible
))->fetch();
check(
    'la correction est écrite, et vide ce qui n\'est plus renseigné',
    (float) $relu['amount'] === 12500.0
        && $relu['supplier_name'] === 'Franchisé Wavre'
        // La période n'était pas dans le corps : la corriger sans elle la
        // retire, sinon on ne pourrait jamais détacher une période posée par
        // erreur.
        && $relu['period_from'] === null,
    json_encode($relu)
);

// --- Frais récurrents -------------------------------------------------------
// Un abonnement écrit de vraies échéances : le solde d'avril doit valoir la
// même chose qu'on l'ouvre en mai ou dans deux ans, et une ligne calculée à la
// lecture ne se corrigerait pas.
$recurrent = static fn (array $extra): array => call($router, 'POST', '/api/v1/marketing/funds/recurrences', [], $extra + [
    'direction' => 'OUT', 'frequency' => 'month', 'label' => 'Agence',
    'amount' => 2000, 'starts_on' => '2026-01-01', 'ends_on' => '2026-12-31',
]);

check('un rythme inconnu est refusé', $recurrent(['frequency' => 'fortnight'])['status'] === 422);
check('une fin avant le début est refusée', $recurrent(['ends_on' => '2025-01-01'])['status'] === 422);
check(
    'un rythme qui donnerait des milliers d\'échéances est refusé',
    $recurrent(['ends_on' => '2060-12-31'])['status'] === 422
);

$mensuel = $recurrent(['label' => 'Agence — honoraires']);
check('un frais mensuel sur douze mois écrit douze échéances',
    $mensuel['status'] === 201 && ($mensuel['body']['occurrences'] ?? null) === 12,
    json_encode($mensuel['body']));
check('le total annoncé est celui des échéances',
    ($mensuel['body']['total_amount'] ?? null) === 24000.0);

$echeances = $pdo->query(sprintf(
    'SELECT movement_date, period_from, period_to, amount FROM mar_fund_movement
      WHERE recurrence_id = %d ORDER BY movement_date',
    (int) $mensuel['body']['inserted_id']
))->fetchAll();

check(
    'chaque échéance couvre son mois, la dernière s\'arrêtant à la fin déclarée',
    count($echeances) === 12
        && $echeances[0]['period_from'] === '2026-01-01' && $echeances[0]['period_to'] === '2026-01-31'
        && $echeances[1]['period_from'] === '2026-02-01' && $echeances[1]['period_to'] === '2026-02-28'
        && $echeances[11]['period_from'] === '2026-12-01' && $echeances[11]['period_to'] === '2026-12-31',
    json_encode([$echeances[0] ?? null, $echeances[11] ?? null])
);

// Un 31 janvier répété ne doit pas déborder sur le 3 mars, ni glisser d'un jour
// à chaque mois court : chaque échéance se compte depuis le début.
$fin_de_mois = $recurrent([
    'label' => 'Loyer PLV', 'starts_on' => '2026-01-31', 'ends_on' => '2026-05-31',
]);
$jours = $pdo->query(sprintf(
    'SELECT movement_date FROM mar_fund_movement WHERE recurrence_id = %d ORDER BY movement_date',
    (int) $fin_de_mois['body']['inserted_id']
))->fetchAll(PDO::FETCH_COLUMN);
check(
    'un 31 répété tombe au dernier jour des mois courts, sans glisser',
    $jours === ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'],
    json_encode($jours)
);

$trimestriel = $recurrent([
    'label' => 'Redevance', 'direction' => 'IN', 'frequency' => 'quarter',
    'amount' => 5000, 'starts_on' => '2026-01-01', 'ends_on' => '2026-12-31',
]);
check('un rythme trimestriel écrit quatre échéances',
    ($trimestriel['body']['occurrences'] ?? null) === 4, json_encode($trimestriel['body']));

// Les échéances pèsent sur le solde comme n'importe quelle écriture — c'est
// tout l'intérêt de les écrire plutôt que de les calculer.
$avant = call($router, 'GET', '/api/v1/marketing/funds/ledger')['body']['closing_balance'];
$annuel = $recurrent(['label' => 'Hébergement', 'frequency' => 'year', 'amount' => 900,
    'starts_on' => '2026-03-01', 'ends_on' => '2028-03-01']);
$apres = call($router, 'GET', '/api/v1/marketing/funds/ledger')['body']['closing_balance'];
check('un rythme annuel couvre les bornes incluses',
    ($annuel['body']['occurrences'] ?? null) === 3, json_encode($annuel['body']));
check('les échéances pèsent sur le solde', round($avant - $apres, 2) === 2700.0,
    sprintf('%s → %s', $avant, $apres));

$liste = call($router, 'GET', '/api/v1/marketing/funds/recurrences')['body'];
$agence = null;
foreach ($liste as $entree) {
    if ($entree['label'] === 'Agence — honoraires') {
        $agence = $entree;
    }
}
check('la liste rend le rythme, le compte et le total',
    $agence !== null && $agence['frequency'] === 'month'
        && $agence['occurrences'] === 12 && $agence['total_amount'] === 24000.0,
    json_encode($agence));

// Corriger une échéance ne détache pas le mois de son abonnement : une facture
// d'agence arrive rarement à l'euro près sur douze mois.
$uneEcheance = (int) $pdo->query(sprintf(
    'SELECT id FROM mar_fund_movement WHERE recurrence_id = %d ORDER BY movement_date LIMIT 1',
    $agence['id']
))->fetchColumn();
call($router, 'PATCH', sprintf('/api/v1/marketing/funds/movements/%d', $uneEcheance), [], [
    'direction' => 'OUT', 'movement_date' => '2026-01-01', 'label' => 'Agence — honoraires', 'amount' => 2150,
]);
check(
    'une échéance corrigée reste rattachée à son frais récurrent',
    (int) $pdo->query(sprintf('SELECT recurrence_id FROM mar_fund_movement WHERE id = %d', $uneEcheance))->fetchColumn()
        === $agence['id']
);

// Supprimer l'abonnement emporte ses échéances : douze lignes laissées au grand
// livre continueraient de peser sur le solde d'un contrat résilié.
check('un frais récurrent se supprime',
    call($router, 'DELETE', sprintf('/api/v1/marketing/funds/recurrences/%d', $agence['id']))['status'] === 200);
check(
    'ses échéances partent avec lui',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_fund_movement WHERE recurrence_id = %d',
        $agence['id']
    ))->fetchColumn() === 0
);

// Le fonds commun se lit par tout le réseau — c'est le pot commun — mais il ne
// se corrige qu'au niveau de la marque : un franchisé qui rectifierait la
// redevance d'un autre déplacerait un solde qui n'est pas le sien.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
check(
    'un franchisé ne corrige pas une écriture du fonds commun',
    call($router, 'PATCH', sprintf('/api/v1/marketing/funds/movements/%d', $corrigible), [], [
        'direction' => 'IN', 'movement_date' => '2026-01-15', 'label' => 'Détournement', 'amount' => 1,
    ])['status'] === 422
);
check(
    'ni ne la supprime',
    call($router, 'DELETE', sprintf('/api/v1/marketing/funds/movements/%d', $corrigible))['status'] === 422
);
AuthContext::set(1, 'BRAND_ADMIN', 1);

check('une écriture se supprime',
    call($router, 'DELETE', sprintf('/api/v1/marketing/funds/movements/%d', $corrigible))['status'] === 200);
check('une écriture déjà supprimée est introuvable',
    call($router, 'DELETE', sprintf('/api/v1/marketing/funds/movements/%d', $corrigible))['status'] === 404);

// --- Vitrine publique -------------------------------------------------------
// La seule route sans authentification du module. Ce qu'elle montre importe
// moins que ce qu'elle ne montre pas : elle est ouverte à Internet, et une
// colonne ajoutée demain ne doit pas s'y retrouver par héritage.
echo "\nVitrine publique\n";

$vitrine = static fn (array $query = []): array => call($router, 'GET', '/api/v1/public/marketing/campaigns', $query);

// Sans identité : c'est tout l'objet d'une vitrine.
AuthContext::clear();
$ouverte = $vitrine();
check('la vitrine répond sans authentification', $ouverte['status'] === 200, 'statut ' . $ouverte['status']);
check(
    'elle rend l\'enveloppe du standard',
    ($ouverte['body']['success'] ?? null) === true
        && is_array($ouverte['body']['data'] ?? null)
        && isset($ouverte['body']['meta']['requestId'], $ouverte['body']['meta']['pagination']),
    json_encode(array_keys($ouverte['body']))
);
check(
    'la pagination annonce ses bornes',
    isset($ouverte['body']['meta']['pagination']['page'],
          $ouverte['body']['meta']['pagination']['perPage'],
          $ouverte['body']['meta']['pagination']['total'],
          $ouverte['body']['meta']['pagination']['totalPages'])
);
check(
    'une demande au-delà du maximum est ramenée, pas refusée',
    ($vitrine(['perPage' => 5000])['body']['meta']['pagination']['perPage'] ?? 0) === 100
);
check(
    'une date illisible est refusée avec un code machine',
    ($vitrine(['activeOn' => 'demain'])['status'] === 422)
        && ($vitrine(['activeOn' => 'demain'])['body']['error']['code'] ?? '') === 'VALIDATION_FAILED'
);

AuthContext::set(1, 'BRAND_ADMIN', 1);

// Une campagne qui ne demande rien ne paraît pas ; celle qui coche la case
// paraît, mais seulement pendant sa période et hors brouillon.
$vitrineId = (int) $pdo->query("SELECT id FROM mar_campaign WHERE status_code <> 'draft' ORDER BY id LIMIT 1")->fetchColumn();
// Son état d'origine : ce bloc va la publier et lui imposer des dates, et les
// contrôles suivants comptent les campagnes telles qu'ils les ont laissées.
$vitrineAvant = $pdo->query(sprintf(
    'SELECT status_code, show_web_shop, starts_on, ends_on FROM mar_campaign WHERE id = %d',
    $vitrineId
))->fetch();
$pdo->exec(sprintf(
    "UPDATE mar_campaign SET show_web_shop = 1, starts_on = '2026-01-01', ends_on = '2026-12-31' WHERE id = %d",
    $vitrineId
));

AuthContext::clear();
$paraissent = static fn (array $q = []): array => array_column($vitrine($q)['body']['data'] ?? [], 'name', 'id');

check(
    'une campagne publiée paraît pendant sa période',
    isset($paraissent(['activeOn' => '2026-06-15'])[(string) $vitrineId])
);
check(
    'elle ne paraît pas avant son début',
    !isset($paraissent(['activeOn' => '2025-06-15'])[(string) $vitrineId])
);
check(
    'ni après sa fin',
    !isset($paraissent(['activeOn' => '2027-06-15'])[(string) $vitrineId])
);

AuthContext::set(1, 'BRAND_ADMIN', 1);
$pdo->exec(sprintf("UPDATE mar_campaign SET status_code = 'draft' WHERE id = %d", $vitrineId));
AuthContext::clear();
check(
    'un brouillon ne paraît pas, même en cochant la case',
    !isset($paraissent(['activeOn' => '2026-06-15'])[(string) $vitrineId])
);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$pdo->exec(sprintf("UPDATE mar_campaign SET status_code = 'live' WHERE id = %d", $vitrineId));

AuthContext::clear();
$publiee = null;
foreach ($vitrine(['activeOn' => '2026-06-15'])['body']['data'] as $campagne) {
    if ($campagne['id'] === (string) $vitrineId) {
        $publiee = $campagne;
    }
}

check('la campagne publiée est bien rendue', $publiee !== null);
check(
    'son identifiant est une chaîne et ses dates des dates seules',
    is_string($publiee['id'] ?? null)
        && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($publiee['startsOn'] ?? '')) === 1
);

// Le point qui compte : rien d'interne ne sort. Le contrôle porte sur la
// campagne entière, sérialisée, plutôt que sur une liste de champs attendus —
// c'est le seul moyen d'attraper une colonne ajoutée plus tard.
$fuite = json_encode($publiee, JSON_UNESCAPED_UNICODE);
foreach ([
    'budget', 'spent', 'margin', 'marge', 'objective', 'target', 'coef',
    'lead', 'prospect', 'agency', 'owner', 'created_by', 'shop_id', 'shopId',
] as $interdit) {
    check(
        sprintf('la vitrine ne dit rien de « %s »', $interdit),
        stripos((string) $fuite, $interdit) === false,
        (string) $fuite
    );
}

check(
    'les boutiques sortent par leur nom, sans identifiant',
    !isset($publiee['shops'][0]['id']) || $publiee['shops'] === []
);

AuthContext::set(1, 'BRAND_ADMIN', 1);

// Remise en état : la campagne retrouve son statut, ses dates et sa visibilité.
$remise = $pdo->prepare(
    'UPDATE mar_campaign SET status_code = :statut, show_web_shop = :vitrine,
            starts_on = :debut, ends_on = :fin
      WHERE id = :id'
);
$remise->execute([
    'statut'  => $vitrineAvant['status_code'],
    'vitrine' => $vitrineAvant['show_web_shop'],
    'debut'   => $vitrineAvant['starts_on'],
    'fin'     => $vitrineAvant['ends_on'],
    'id'      => $vitrineId,
]);

// --- Client HTTP de l'ERP ---------------------------------------------------
// Ce qui est éprouvé ici est notre code, pas celui de l'ERP : composition de
// l'URL, en-têtes, traduction d'un statut en message, déballage d'une enveloppe.
// Le transport est remplacé par une fonction qui rend ce qu'on lui dit de
// rendre — aucune réponse de l'ERP n'est imitée, et rien n'est affirmé sur la
// forme réelle de ses factures.
echo "\nClient HTTP de l'ERP\n";

$avecErp = static function (callable $transport, callable $essai) {
    $baseAvant = getenv('MAR_ERP_API_BASE');
    \Marketing\Support\Env::set('MAR_ERP_API_BASE', 'https://erp.test/');

    try {
        return $essai(new \Marketing\Support\ErpClient($transport));
    } finally {
        \Marketing\Support\Env::set('MAR_ERP_API_BASE', $baseAvant === false ? null : $baseAvant);
    }
};

check(
    'sans adresse configurée, aucun appel n\'est tenté',
    \Marketing\Support\ErpClient::isConfigured() === false
);

$vueUrl = null;
$vusEntetes = [];
$avecErp(
    static function (string $url, array $entetes) use (&$vueUrl, &$vusEntetes): array {
        $vueUrl = $url;
        $vusEntetes = $entetes;

        return [200, '{"data":{"shops":[{"id":7}]}}'];
    },
    static fn ($client) => $client->get('/api/v1/shops', ['page' => 2, 'brandId' => null])
);

check(
    'l\'URL colle la base au chemin sans doubler la barre',
    $vueUrl === 'https://erp.test/api/v1/shops?page=2',
    (string) $vueUrl
);
check(
    'un paramètre nul ne part pas dans l\'URL',
    !str_contains((string) $vueUrl, 'brandId')
);
check(
    'l\'appel porte un identifiant de requête',
    count(array_filter($vusEntetes, static fn ($e) => str_starts_with($e, 'X-Request-Id: '))) === 1,
    json_encode($vusEntetes)
);

// Le déballage : l'ERP enveloppe tantôt sous `data`, tantôt sous `data.{clé}`,
// tantôt pas du tout. L'appelant reçoit une liste dans les trois cas.
check(
    'une enveloppe data.{clé} se déballe',
    \Marketing\Support\ErpClient::rows(['data' => ['shops' => [['id' => 1]]]], ['shops']) === [['id' => 1]]
);
check(
    'une enveloppe data seule se déballe',
    \Marketing\Support\ErpClient::rows(['data' => [['id' => 1]]], ['shops']) === [['id' => 1]]
);
check(
    'une liste nue se déballe',
    \Marketing\Support\ErpClient::rows([['id' => 1]], ['shops']) === [['id' => 1]]
);
check(
    'un objet seul devient une liste d\'un élément',
    \Marketing\Support\ErpClient::rows(['data' => ['id' => 1]], ['shops']) === [['id' => 1]]
);

// Les échecs : chacun doit dire quoi faire, pas seulement qu'il a échoué.
foreach ([
    [401, 'MAR_ERP_API_TOKEN'],
    [403, 'MAR_ERP_API_TOKEN'],
    [404, 'Chemin inconnu'],
    [500, 'a répondu 500'],
] as [$statut, $attendu]) {
    $message = '';
    try {
        $avecErp(
            static fn (): array => [$statut, 'Erreur'],
            static fn ($client) => $client->get('/api/v1/quelque-chose')
        );
    } catch (RuntimeException $echec) {
        $message = $echec->getMessage();
    }

    check(
        sprintf('un %d explique ce qu\'il faut regarder', $statut),
        str_contains($message, $attendu),
        $message
    );
}

$illisible = '';
try {
    $avecErp(
        static fn (): array => [200, '<html>maintenance</html>'],
        static fn ($client) => $client->get('/api/v1/quelque-chose')
    );
} catch (RuntimeException $echec) {
    $illisible = $echec->getMessage();
}
check(
    'une réponse non-JSON est refusée en le disant',
    str_contains($illisible, 'illisible') && str_contains($illisible, 'maintenance'),
    $illisible
);

// --- Palette de campagne ---------------------------------------------------
//
// Une campagne empruntait la couleur de son levier — un objectif commercial, pas
// une identité. Ces quatre couleurs sont les siennes, et ce sont elles que les
// supports imprimés reprennent.
echo "\nCouleurs de campagne\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$reponse = call($router, 'GET', '/api/v1/marketing/references');
check(
    'la palette par défaut voyage avec les référentiels',
    ($reponse['body']['campaignColors']['color_primary_hex'] ?? null) === '#8D1D2C'
        && count($reponse['body']['campaignColors'] ?? []) === 4,
    json_encode($reponse['body']['campaignColors'] ?? null)
);

$aPeindre = (int) call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'          => 'Épiphanie en bordeaux',
    'status_code'   => 'draft',
    'scope'         => 'RESEAU',
    'client_target' => 'b2c',
    'type_id'       => (int) $types['ouverture']['id'],
    // Forme courte, telle qu'un navigateur l'écrit, et casse mélangée.
    'color_primary_hex'   => '#abc',
    'color_secondary_hex' => '#E8D9C0',
])['body']['inserted_id'];

$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $aPeindre))['body'];
check(
    'la forme courte est développée et normalisée',
    ($etat['colors']['color_primary_hex'] ?? null) === '#AABBCC',
    json_encode($etat['colors'] ?? null)
);
check(
    'une couleur non choisie reste nulle',
    array_key_exists('color_accent_hex', $etat['colors'])
        && $etat['colors']['color_accent_hex'] === null,
    json_encode($etat['colors'] ?? null)
);
check(
    'mais l\'impression reçoit quand même les quatre',
    ($etat['colors_effective']['color_accent_hex'] ?? null) === '#B0821A'
        && ($etat['colors_effective']['color_primary_hex'] ?? null) === '#AABBCC',
    json_encode($etat['colors_effective'] ?? null)
);

// Une couleur mal écrite se refuse plutôt que de se rattraper en silence : elle
// ressortirait sur un tirage à deux mille exemplaires sans que personne ne
// sache d'où elle vient.
$reponse = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $aPeindre), [], [
    'name'              => 'Épiphanie en bordeaux',
    'status_code'       => 'draft',
    'scope'             => 'RESEAU',
    'color_primary_hex' => 'bordeaux',
]);
check(
    'une couleur mal écrite est refusée avec son nom',
    $reponse['status'] === 422
        && str_contains((string) ($reponse['body']['description'] ?? ''), 'color_primary_hex'),
    json_encode($reponse['body'] ?? null)
);

// Vider une couleur la rend à la palette par défaut, sans figer sa valeur.
call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $aPeindre), [], [
    'name'              => 'Épiphanie en bordeaux',
    'status_code'       => 'draft',
    'scope'             => 'RESEAU',
    'color_primary_hex' => '',
]);
$etat = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $aPeindre))['body'];
check(
    'vider une couleur la rend au défaut sans la figer',
    $etat['colors']['color_primary_hex'] === null
        && $etat['colors_effective']['color_primary_hex'] === '#8D1D2C',
    json_encode($etat['colors'] ?? null)
);

call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $aPeindre));

// --- Dossier d'impression --------------------------------------------------
//
// Un gabarit lisait trois routes et recollait lui-même le prix après promotion,
// que rien ne stocke. Deux gabarits écrivaient donc deux fois la même règle,
// sans garantie de tomber sur le même prix.
echo "\nDossier d'impression\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$aImprimer = (int) call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'          => 'Galettes 2027',
    'status_code'   => 'draft',
    'scope'         => 'LOCALE',
    'client_target' => 'b2c',
    'type_id'       => (int) $types['ouverture']['id'],
    'starts_on'     => '2027-01-02',
    'ends_on'       => '2027-01-31',
    'shop_ids'      => [1, 2],
    'color_primary_hex' => '#6E1023',
    'challenge_enabled' => true,
    'challenge_metric'  => 'attainment',
    'challenge_trigger_pct' => 100,
    'challenge_prizes'  => [['label' => 'Week-end équipe']],
    'shop_targets'  => [
        ['shop_id' => 1, 'target_pieces' => 500],
        ['shop_id' => 2, 'target_pieces' => 300, 'challenge_trigger_pct' => 90],
    ],
    'shop_item_targets' => [
        ['shop_id' => 1, 'offer_item_id' => $catalogItemId, 'target_pieces' => 500],
    ],
    'offer' => [
        'title'         => 'La galette des rois',
        'mechanic_text' => 'La deuxième à moitié prix',
        'max_qty_per_ticket' => 2,
        'is_cumulative' => false,
        'items' => [[
            'label'          => 'Tarte du jour',
            'offer_item_id'  => $catalogItemId,
            'mechanic_type'  => 'PERCENT',
            'discount_pct'   => 20,
            'baseline_price' => 20.00,
            'image_url'      => '/img/campagnes/galette.jpg',
        ], [
            // Même produit, photo refusée : c'est la case de l'étape « Photos »
            // que le dossier doit respecter, pas la présence d'une image.
            'label'          => 'Galette sans photo',
            'offer_item_id'  => $catalogItemId,
            'baseline_price' => 18.00,
            'show_photo'     => false,
            'image_url'      => '/img/campagnes/galette.jpg',
        ], [
            // Ni photo de campagne ni photo au catalogue : le dossier doit
            // rendre un vide franc plutôt qu'une image de remplacement.
            'label'          => 'Galette nature',
            'baseline_price' => 12.00,
        ]],
    ],
])['body']['inserted_id'];

$dossier = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer))['body'];

check(
    'le fichier général porte la campagne, sa palette et son offre',
    ($dossier['campaign']['name'] ?? null) === 'Galettes 2027'
        && ($dossier['campaign']['colors']['primary'] ?? null) === '#6E1023'
        // Couleur non choisie : le dossier reçoit quand même la valeur par défaut.
        && ($dossier['campaign']['colors']['accent'] ?? null) === '#B0821A'
        && ($dossier['offer']['title'] ?? null) === 'La galette des rois',
    json_encode($dossier['campaign'] ?? null)
);

// La photo suit ce que l'étape « Photos produits » a décidé : la même image
// s'imprime pour l'un et pas pour l'autre.
$parProduit = [];
foreach ($dossier['products'] ?? [] as $produit) {
    $parProduit[$produit['label']] = $produit;
}
check(
    'la photo de campagne arrive au dossier',
    ($parProduit['Tarte du jour']['image_url'] ?? null) === '/img/campagnes/galette.jpg'
        && ($parProduit['Tarte du jour']['options']['show_photo'] ?? false) === true,
    json_encode($parProduit['Tarte du jour']['options'] ?? null)
);
check(
    'une photo refusée ne s\'imprime pas, même si elle existe',
    ($parProduit['Galette sans photo']['options']['show_photo'] ?? true) === false,
    json_encode($parProduit['Galette sans photo']['options'] ?? null)
);


// Le prix après promotion se calcule ici, une fois pour tous les gabarits.
$produit = $dossier['products'][0] ?? [];
check(
    'le prix après promotion est calculé et rendu',
    ($produit['price_before'] ?? null) === 20.00
        && ($produit['price_after'] ?? null) === 16.00
        && ($produit['mechanic']['text'] ?? null) === '−20 %',
    json_encode($produit)
);
check(
    'la photo absente vaut null, pas une image de remplacement',
    array_key_exists('image_url', $parProduit['Galette nature'] ?? [])
        && $parProduit['Galette nature']['image_url'] === null
        && ($parProduit['Galette nature']['options']['show_photo'] ?? true) === false,
    json_encode($parProduit['Galette nature'] ?? null)
);
check(
    'les mentions de validité sont rédigées',
    ($dossier['legal']['period_text'] ?? null) === 'Du 2 janvier 2027 au 31 janvier 2027'
        && str_contains((string) ($dossier['legal']['conditions_text'] ?? ''), 'Non cumulable')
        && str_contains((string) ($dossier['legal']['conditions_text'] ?? ''), '2 par ticket'),
    json_encode($dossier['legal'] ?? null)
);
check(
    'la géométrie d\'impression accompagne le dossier',
    ($dossier['print']['width_px'] ?? null) === 1252
        && ($dossier['print']['height_px'] ?? null) === 1843
        && ($dossier['print']['bleed_mm'] ?? null) === 3,
    json_encode($dossier['print'] ?? null)
);
check(
    'le fichier général ne porte ni boutique ni objectif',
    !array_key_exists('shop', $dossier) && !array_key_exists('objective', $dossier)
);

// La géométrie est écrite à deux endroits — `ImageStore` réduit les fichiers,
// `PrintRepository` la déclare aux gabarits. Les deux doivent dire la même
// chose : un gabarit dessiné pour 1 252 px sur des images réduites à 1 000
// sortirait flou sans que rien ne le signale.
$reflet = new ReflectionClass(\Marketing\Support\ImageStore::class);
check(
    'la géométrie annoncée est celle que l\'envoi applique',
    $reflet->getConstant('PRINT_MAX_SHORT') === ($dossier['print']['width_px'] ?? null)
        && $reflet->getConstant('PRINT_MAX_LONG') === ($dossier['print']['height_px'] ?? null),
    sprintf(
        'ImageStore %s × %s, dossier %s × %s',
        $reflet->getConstant('PRINT_MAX_SHORT'),
        $reflet->getConstant('PRINT_MAX_LONG'),
        $dossier['print']['width_px'] ?? '—',
        $dossier['print']['height_px'] ?? '—'
    )
);

// La version d'une boutique : la même chose, plus sa page objectif.
$local = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer), [
    'shop_id' => '1',
])['body'];

check(
    'le fichier d\'une boutique ajoute son identité et son objectif',
    ($local['shop']['id'] ?? null) === 1
        && ($local['objective']['total_pieces'] ?? null) === 500
        && ($local['offer']['title'] ?? null) === 'La galette des rois',
    json_encode(['shop' => $local['shop'] ?? null, 'objectif' => $local['objective'] ?? null])
);
check(
    'l\'objectif descend jusqu\'au produit',
    ($local['objective']['by_category'][0]['products'][0]['target'] ?? null) === 500,
    json_encode($local['objective']['by_category'] ?? null)
);
check(
    'le seuil du challenge est traduit en pièces',
    ($local['objective']['challenge']['trigger_pct'] ?? null) === 100.0
        && ($local['objective']['challenge']['bar_pieces'] ?? null) === 500,
    json_encode($local['objective']['challenge'] ?? null)
);
check(
    'l\'adresse manquante est franche plutôt que devinée',
    array_key_exists('address', $local['shop']) && $local['shop']['address'] === null
);

// Le seuil propre à une boutique l'emporte sur celui de la campagne.
$autre = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer), [
    'shop_id' => '2',
])['body'];
check(
    'le seuil propre à la boutique prime sur le général',
    ($autre['objective']['challenge']['trigger_pct'] ?? null) === 90.0
        && ($autre['objective']['challenge']['bar_pieces'] ?? null) === 270,
    json_encode($autre['objective']['challenge'] ?? null)
);

// La série entière, pour générer les fichiers d'un coup.
$serie = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer), [
    'shop_id' => 'all',
])['body'];
check(
    'la série rend le général et un objet par boutique',
    array_key_exists('general', $serie)
        && count($serie['by_shop'] ?? []) === 2
        && !array_key_exists('shop', $serie['general']),
    json_encode(array_keys($serie))
);

// Une boutique hors campagne n'a pas de fichier : sa demander en produirait un
// avec l'offre d'une campagne à laquelle elle ne participe pas.
$reponse = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer), [
    'shop_id' => '3',
]);
check(
    'une boutique hors campagne n\'a pas de fichier',
    $reponse['status'] === 404,
    'statut ' . $reponse['status']
);

$reponse = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/print', $aImprimer), [
    'shop_id' => 'toutes',
]);
check(
    'un « shop_id » qui n\'est ni un identifiant ni « all » est refusé',
    $reponse['status'] === 422,
    'statut ' . $reponse['status']
);

call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $aImprimer));

// --- Suppression : ce qui pendait à la campagne part avec elle --------------
//
// Une campagne effacée qui laisserait ses objectifs derrière elle donnerait des
// lignes que plus aucun écran ne montre et qu'aucune requête ne pense à
// exclure. Le nettoyage tient aux cascades déclarées en base ; ce test le
// vérifie plutôt que de le supposer, parce qu'une table ajoutée plus tard sans
// cascade ne se signalerait autrement qu'au premier ménage.
echo "\nSuppression d'une campagne\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'          => 'Campagne à effacer',
    'status_code'   => 'draft',
    'scope'         => 'RESEAU',
    'client_target' => 'b2c',
    'type_id'       => (int) $types['ouverture']['id'],
    'shop_targets'  => [['shop_id' => 1, 'target_pieces' => 400]],
    'shop_item_targets' => [
        ['shop_id' => 1, 'offer_item_id' => $catalogItemId, 'target_pieces' => 400],
    ],
    'offer' => [
        'title' => 'Offre à effacer',
        'items' => [['label' => 'Tarte du jour', 'offer_item_id' => $catalogItemId]],
    ],
]);
$aEffacer = (int) ($response['body']['inserted_id'] ?? 0);
$compte = static fn (string $table): int => (int) $GLOBALS['pdo']->query(sprintf(
    'SELECT COUNT(*) FROM %s WHERE campaign_id = %d',
    $table,
    $GLOBALS['aEffacer']
))->fetchColumn();

check(
    'la campagne part avec ses objectifs croisés',
    $aEffacer > 0 && $compte('mar_campaign_shop_item_target') === 1,
    'lignes : ' . ($aEffacer > 0 ? $compte('mar_campaign_shop_item_target') : 'campagne non créée')
);

$response = call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $aEffacer));
check('la suppression aboutit', $response['status'] === 200, 'statut ' . $response['status']);

foreach ([
    'mar_campaign_shop_item_target' => 'les objectifs par boutique et par produit sont effacés',
    'mar_campaign_shop'             => 'les objectifs par boutique sont effacés',
    'mar_campaign_offer'            => 'l\'offre est effacée',
] as $table => $constat) {
    check($constat, $compte($table) === 0);
}

check(
    'et la campagne elle-même a disparu',
    (int) $pdo->query(sprintf('SELECT COUNT(*) FROM mar_campaign WHERE id = %d', $aEffacer))->fetchColumn() === 0
);

// Supprimer deux fois n'est pas une erreur serveur : c'est une campagne
// introuvable, et l'écran doit pouvoir le dire sans paniquer.
$response = call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $aEffacer));
check('une seconde suppression répond « introuvable »', $response['status'] === 404, 'statut ' . $response['status']);

// --- Offres de campagne visibles depuis « Promotions » ----------------------
// `mar_promotion` (import catalogue) et `mar_campaign_offer` (assistant) sont
// deux tables distinctes, et rien ne les reliait : une offre montée à l'étape 2
// n'apparaissait sur aucun écran de l'onglet où on va la chercher.
echo "\nOffres de campagne\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$response = call($router, 'GET', '/api/v1/marketing/campaign-offers');
$offers   = $response['body'];
check('les offres de campagne sont exposées', $response['status'] === 200);
check('l\'offre de l\'assistant y figure', count($offers) >= 1, count($offers) . ' offre(s)');
check(
    'elle porte sa campagne et son état',
    ($offers[0]['campaign_name'] ?? '') !== '' && ($offers[0]['campaign_status_label'] ?? '') !== ''
);
check('ses éléments sont comptés', ($offers[0]['items_count'] ?? null) !== null);

// Le périmètre s'applique comme partout ailleurs.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'GET', '/api/v1/marketing/campaign-offers');
check('les offres sont cloisonnées', $response['status'] === 200);
check(
    'aucune offre d\'une campagne hors périmètre',
    array_reduce(
        $response['body'],
        static fn (bool $ok, array $o): bool => $ok && $o['campaign_id'] !== 11,
        true
    )
);

// --- Vivier B2B et génération des leads -----------------------------------
// La génération ne fabrique pas de sociétés : elle puise dans un vivier
// importé. Ce qui compte ici, c'est qu'un vivier vide ne produise rien et le
// dise, qu'un import soit rejouable, et qu'une seconde génération ne crée pas
// de doublons — trois façons de se retrouver avec des leads que personne ne
// peut appeler, ou appelés deux fois.
echo "\nVivier B2B\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$pdo->exec('DELETE FROM mar_crm_lead_event');
$pdo->exec('DELETE FROM mar_crm_lead');
$pdo->exec('DELETE FROM mar_b2b_prospect');

$sectorIds = array_column($refs['b2bSectors'], 'id', 'code');

$response = call($router, 'GET', '/api/v1/marketing/b2b/sectors');
$summary  = $response['body'];
check('le vivier annonce son effectif réel', ($summary[0]['available'] ?? null) === 0);
check(
    'le chiffre de cadrage reste distinct de l\'effectif',
    ($summary[0]['estimated_leads_count'] ?? 0) > 0
);

// Campagne B2B de test, sur les deux boutiques.
$response   = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'          => 'Rentrée offices',
    'scope'         => 'LOCALE',
    'client_target' => 'b2b',
    'shop_ids'      => [1, 2],
    'sector_ids'    => [(int) $sectorIds['offices'], (int) $sectorIds['horeca']],
]);
$b2bCampaign = (int) $response['body']['inserted_id'];

// Vivier vide : rien ne doit être créé, et la raison doit être dite.
$response = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2bCampaign));
check('sans vivier, aucun lead n\'est créé', ($response['body']['created'] ?? null) === 0);
check('et la raison est explicite', str_contains((string) ($response['body']['reason'] ?? ''), 'vivier'));

// Import du vivier.
$response = call($router, 'POST', '/api/v1/marketing/b2b/prospects/import', [], [
    'source' => 'test',
    'rows'   => [
        ['external_ref' => 'A1', 'company_name' => 'Deloitte Diegem',  'sector' => 'offices', 'contact_name' => 'A. Verhoeven', 'potential_amount' => '1 250,50'],
        ['external_ref' => 'A2', 'company_name' => 'AXA Belgium',      'sector' => 'offices'],
        ['external_ref' => 'A3', 'company_name' => 'Brasserie Sablon', 'sector' => 'Horeca'],
        ['external_ref' => 'A4', 'company_name' => 'CHU Namur',        'sector' => 'sante'],
        ['external_ref' => 'A5', 'company_name' => '',                 'sector' => 'offices'],
        ['external_ref' => 'A6', 'company_name' => 'Société X',        'sector' => 'inexistant'],
    ],
]);
$import = $response['body'];
check('les lignes valides sont importées', ($import['imported'] ?? null) === 4, json_encode($import));
check('les lignes inexploitables sont écartées', ($import['skipped'] ?? 0) === 2);
check('les secteurs inconnus sont signalés', count($import['errors'] ?? []) === 2);
check(
    'le séparateur décimal européen est lu',
    (float) $pdo->query("SELECT potential_amount FROM mar_b2b_prospect WHERE external_ref = 'A1'")->fetchColumn() === 1250.50
);

// Rejouable : le même fichier met à jour, il ne duplique pas.
$response = call($router, 'POST', '/api/v1/marketing/b2b/prospects/import', [], [
    'rows' => [['external_ref' => 'A1', 'company_name' => 'Deloitte Diegem Belgium', 'sector' => 'offices']],
]);
check('réimporter met à jour', ($response['body']['updated'] ?? null) === 1);

// Rejoué à l'identique : rien ne change en base, et le rattachement au secteur
// doit malgré tout être en place. C'est le cas où `lastInsertId()` ne renvoie
// rien sans `id = LAST_INSERT_ID(id)` — le compte existerait alors sans secteur,
// et resterait invisible de toutes les campagnes.
call($router, 'POST', '/api/v1/marketing/b2b/prospects/import', [], [
    'rows' => [['external_ref' => 'A1', 'company_name' => 'Deloitte Diegem Belgium', 'sector' => 'offices']],
]);
check(
    'un réimport sans changement garde le secteur',
    (int) $pdo->query(
        "SELECT COUNT(*) FROM mar_b2b_prospect_sector ps
           JOIN mar_b2b_prospect p ON p.id = ps.prospect_id
          WHERE p.external_ref = 'A1'"
    )->fetchColumn() === 1
);
check(
    'et ne crée pas de doublon',
    (int) $pdo->query('SELECT COUNT(*) FROM mar_b2b_prospect')->fetchColumn() === 4
);

$response = call($router, 'GET', '/api/v1/marketing/b2b/sectors');
$offices  = array_values(array_filter($response['body'], static fn (array $s): bool => $s['code'] === 'offices'))[0];
check('l\'effectif du vivier suit l\'import', $offices['available'] === 2, (string) $offices['available']);

// Génération.
$response = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2bCampaign));
$run      = $response['body'];
check('seuls les secteurs retenus sont mobilisés', ($run['created'] ?? null) === 3, json_encode($run));
check('la répartition couvre les deux boutiques', ($run['shops'] ?? null) === 2);
check(
    'les comptes sont distribués et non entassés',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(DISTINCT shop_id) FROM mar_crm_lead WHERE campaign_id = %d',
        $b2bCampaign
    ))->fetchColumn() === 2
);
check(
    'chaque lead part à l\'état initial',
    $pdo->query(sprintf('SELECT DISTINCT status_code FROM mar_crm_lead WHERE campaign_id = %d', $b2bCampaign))->fetchColumn() === 'todo'
);
check(
    'la création est tracée dans l\'historique',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_crm_lead_event e JOIN mar_crm_lead l ON l.id = e.lead_id WHERE l.campaign_id = %d',
        $b2bCampaign
    ))->fetchColumn() === 3
);

// Relance : rien de neuf, et surtout pas de doublon.
$response = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2bCampaign));
check('relancer ne recrée rien', ($response['body']['created'] ?? null) === 0);
check('les comptes déjà traités sont comptés', ($response['body']['skipped_existing'] ?? null) === 3);
check(
    'le nombre de leads est inchangé',
    (int) $pdo->query(sprintf('SELECT COUNT(*) FROM mar_crm_lead WHERE campaign_id = %d', $b2bCampaign))->fetchColumn() === 3
);

// Un import complémentaire ne génère que les nouveaux — et la répartition
// tient compte de ce qui est déjà en place. Un curseur repartant de zéro
// enverrait chaque compte ajouté au fil de l'eau à la même boutique.
foreach (['A7' => 'Solvay Business School', 'A8' => 'Collège Saint-Michel'] as $ref => $name) {
    call($router, 'POST', '/api/v1/marketing/b2b/prospects/import', [], [
        'rows' => [['external_ref' => $ref, 'company_name' => $name, 'sector' => 'offices']],
    ]);
    $response = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2bCampaign));
    check(sprintf('un import complémentaire ajoute %s', $name), ($response['body']['created'] ?? null) === 1);
}

$spread = $pdo->query(sprintf(
    'SELECT COUNT(*) AS total FROM mar_crm_lead WHERE campaign_id = %d GROUP BY shop_id ORDER BY total DESC',
    $b2bCampaign
))->fetchAll(PDO::FETCH_COLUMN);
check(
    'les générations successives ne déséquilibrent pas la charge',
    count($spread) === 2 && ((int) $spread[0] - (int) $spread[1]) <= 1,
    implode(' / ', $spread)
);

// Une campagne B2C ne génère rien, même si on force l'appel.
$response  = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Promo B2C', 'client_target' => 'b2c', 'sector_ids' => [(int) $sectorIds['offices']],
]);
$b2cId     = (int) $response['body']['inserted_id'];
$response  = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2cId));
check('une campagne B2C ne génère pas de lead', ($response['body']['created'] ?? null) === 0);
check('et le dit', str_contains((string) ($response['body']['reason'] ?? ''), 'B2C'));

// Génération à la création : la case de l'assistant doit suffire.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'             => 'Offices automne',
    'client_target'    => 'b2b',
    'sector_ids'       => [(int) $sectorIds['offices']],
    'create_crm_leads' => true,
]);
check('l\'assistant génère à la création', ($response['body']['leads']['created'] ?? null) === 4, json_encode($response['body']['leads'] ?? null));

// Périmètre : un franchisé ne distribue pas chez le voisin.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'POST', '/api/v1/marketing/b2b/prospects/import', [], [
    'rows' => [['external_ref' => 'B1', 'company_name' => 'Test', 'sector' => 'offices']],
]);
check('un franchisé ne peut pas alimenter le vivier', $response['status'] === 403, 'statut ' . $response['status']);

$pdo->exec(sprintf('DELETE FROM mar_crm_lead WHERE campaign_id = %d', $b2bCampaign));
$response = call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $b2bCampaign));
check(
    'un franchisé ne distribue qu\'à sa boutique',
    ($response['body']['shops'] ?? null) === 1,
    json_encode($response['body'])
);
check(
    'et aucun lead ne part chez le voisin',
    (int) $pdo->query(sprintf(
        'SELECT COUNT(*) FROM mar_crm_lead WHERE campaign_id = %d AND shop_id <> 1',
        $b2bCampaign
    ))->fetchColumn() === 0
);

// --- Comptes visés par secteur ---------------------------------------------
// Le panneau de l'assistant montre les comptes réels du vivier. L'étape
// n'affichait qu'un chiffre de cadrage — « 184 comptes » — sans pouvoir en
// nommer un seul, et un chiffre qu'on ne peut pas ouvrir n'engage à rien.
echo "\nComptes visés par secteur\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$officesId = (int) array_column($refs['b2bSectors'], 'id', 'code')['offices'];
$horecaId  = (int) array_column($refs['b2bSectors'], 'id', 'code')['horeca'];

$pdo->exec(sprintf(
    'INSERT IGNORE INTO mar_b2b_prospect_sector (prospect_id, sector_id)
     SELECT p.id, %d FROM mar_b2b_prospect p
      WHERE NOT EXISTS (SELECT 1 FROM mar_b2b_prospect_sector ps WHERE ps.prospect_id = p.id)',
    $officesId
));

$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', ['sector_ids' => (string) $officesId]);
check('les comptes du secteur remontent', $response['status'] === 200 && $response['body'] !== []);
check('chacun porte sa boutique référente', array_key_exists('shop_name', $response['body'][0] ?? []));

// --- Un compte relève de plusieurs secteurs ---------------------------------
// Un traiteur est à la fois horeca et événementiel. Tant que le vivier n'en
// gardait qu'un, il n'existait que pour la moitié des campagnes qui le visent —
// et son absence de l'autre moitié ne se signalait nulle part.
$brasserie = (int) $pdo->query(
    "SELECT id FROM mar_b2b_prospect WHERE external_ref = 'A3'"
)->fetchColumn();
$pdo->exec(sprintf(
    'INSERT IGNORE INTO mar_b2b_prospect_sector (prospect_id, sector_id) VALUES (%d, %d)',
    $brasserie,
    $officesId
));

$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', [
    'sector_ids' => $officesId . ',' . $horecaId,
]);
$appearances = array_filter($response['body'], static fn (array $p): bool => $p['company_name'] === 'Brasserie Sablon');
check(
    'un compte de deux secteurs ne figure qu\'une fois',
    count($appearances) === 1,
    count($appearances) . ' occurrence(s)'
);
check(
    'et son libellé énumère ses secteurs',
    str_contains((string) (array_values($appearances)[0]['sector_label'] ?? ''), 'Horeca')
        && str_contains((string) (array_values($appearances)[0]['sector_label'] ?? ''), 'Offices'),
    (string) (array_values($appearances)[0]['sector_label'] ?? '')
);

$response  = call($router, 'GET', '/api/v1/marketing/references');
$refSector = array_values(array_filter(
    $response['body']['b2bSectors'],
    static fn (array $s): bool => (int) $s['id'] === $horecaId
))[0];
check(
    'le référentiel annonce l\'effectif réel du secteur',
    (int) $refSector['available_count'] === 1,
    json_encode($refSector)
);

// Le total annoncé avant génération doit être celui des comptes, pas celui des
// lignes : l'assistant promettait un lead de plus qu'il n'en créait.
$perSector = call($router, 'GET', '/api/v1/marketing/b2b/sectors')['body'];
$summed    = array_sum(array_map(
    static fn (array $s): int => in_array((int) $s['id'], [$officesId, $horecaId], true) ? (int) $s['available'] : 0,
    $perSector
));
$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects/count', [
    'sector_ids' => $officesId . ',' . $horecaId,
]);
$total = (int) ($response['body']['total'] ?? -1);
check('le total ne compte chaque compte qu\'une fois', $total === $summed - 1, "$total vs $summed");

// --- Le vivier suit les boutiques de la campagne ----------------------------
//
// `mar_b2b_prospect.shop_id` vient de la boutique préférée du client dans l'ERP
// (`client.id_main_shop`) : c'est là qu'il a l'habitude d'aller, et c'est elle
// qui l'appellera. Une campagne locale qui démarcherait un compte rattaché
// ailleurs enverrait quelqu'un travailler la clientèle d'une autre boutique.
$pdo->exec(sprintf(
    "UPDATE mar_b2b_prospect SET shop_id = 1 WHERE external_ref = 'A1'"
));
$pdo->exec(sprintf(
    "UPDATE mar_b2b_prospect SET shop_id = 2 WHERE external_ref = 'A2'"
));
$pdo->exec("UPDATE mar_b2b_prospect SET shop_id = NULL WHERE external_ref = 'A5'");

$reponse = call($router, 'GET', '/api/v1/marketing/b2b/prospects', [
    'sector_ids' => (string) $officesId,
    'shop_ids'   => '1',
]);
$noms = array_column($reponse['body'], 'company_name');
check(
    'les comptes affichés sont ceux rattachés à la boutique choisie',
    in_array('Deloitte Diegem Belgium', $noms, true) && !in_array('AXA Belgium', $noms, true),
    implode(', ', $noms)
);

$reponse = call($router, 'GET', '/api/v1/marketing/b2b/prospects/count', [
    'sector_ids' => (string) $officesId,
    'shop_ids'   => '1',
]);
$comptage = $reponse['body'];
check(
    'le compte dit ce que le périmètre retient, et ce qu\'il écarte',
    ($comptage['total'] ?? -1) < ($comptage['network'] ?? -1)
        && ($comptage['without_shop'] ?? 0) >= 1,
    json_encode($comptage)
);

// Deux boutiques : l'union, pas l'intersection.
$reponse = call($router, 'GET', '/api/v1/marketing/b2b/prospects', [
    'sector_ids' => (string) $officesId,
    'shop_ids'   => '1,2',
]);
$noms = array_column($reponse['body'], 'company_name');
check(
    'deux boutiques réunissent leurs comptes',
    in_array('Deloitte Diegem Belgium', $noms, true) && in_array('AXA Belgium', $noms, true),
    implode(', ', $noms)
);

// Sans boutique demandée — une campagne réseau — rien n'est restreint.
$reponse = call($router, 'GET', '/api/v1/marketing/b2b/prospects/count', [
    'sector_ids' => (string) $officesId,
]);
check(
    'une campagne réseau garde tout le vivier',
    ($reponse['body']['total'] ?? 0) === ($comptage['network'] ?? -1),
    json_encode($reponse['body'])
);

// Les pastilles de secteur suivent le même périmètre : afficher l'effectif
// réseau à côté d'une liste restreinte ferait cocher un secteur sur un chiffre
// qui ne le concerne pas.
$reseauParSecteur = call($router, 'GET', '/api/v1/marketing/b2b/sectors')['body'];
$localParSecteur  = call($router, 'GET', '/api/v1/marketing/b2b/sectors', ['shop_ids' => '1'])['body'];
$effectif = static function (array $lignes, int $id): int {
    foreach ($lignes as $ligne) {
        if ((int) $ligne['id'] === $id) {
            return (int) $ligne['available'];
        }
    }

    return -1;
};
check(
    'l\'effectif d\'un secteur se restreint aux boutiques demandées',
    $effectif($localParSecteur, $officesId) < $effectif($reseauParSecteur, $officesId)
        && $effectif($localParSecteur, $officesId) >= 1,
    sprintf(
        'local %d vs réseau %d',
        $effectif($localParSecteur, $officesId),
        $effectif($reseauParSecteur, $officesId)
    )
);

// La génération suit la même règle, à une nuance près et elle compte : un
// compte rattaché à une autre boutique est écarté, un compte sans rattachement
// reste pris et réparti — il n'appartient à personne, il n'est volé à personne.
$campagneLocale = (int) call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'             => 'Locale Halle',
    'scope'            => 'LOCALE',
    'client_target'    => 'b2b',
    'shop_ids'         => [1],
    'sector_ids'       => [$officesId],
    'create_crm_leads' => false,
])['body']['inserted_id'];

call($router, 'POST', sprintf('/api/v1/marketing/campaigns/%d/leads/generate', $campagneLocale));
$societes = array_column(
    $pdo->query(sprintf(
        'SELECT company_name FROM mar_crm_lead WHERE campaign_id = %d',
        $campagneLocale
    ))->fetchAll(),
    'company_name'
);
check(
    'la génération locale écarte les comptes d\'une autre boutique',
    !in_array('AXA Belgium', $societes, true),
    implode(', ', array_slice($societes, 0, 6))
);
check(
    'mais garde ceux que l\'ERP n\'a rattachés à personne',
    in_array('Deloitte Diegem Belgium', $societes, true)
        && count(array_filter(
            $pdo->query(sprintf(
                'SELECT p.shop_id FROM mar_crm_lead l
                   JOIN mar_b2b_prospect p ON p.id = l.prospect_id
                  WHERE l.campaign_id = %d',
                $campagneLocale
            ))->fetchAll(),
            static fn (array $r): bool => $r['shop_id'] === null
        )) > 0,
    implode(', ', array_slice($societes, 0, 6))
);

// Et la génération s'y tient : autant de leads que de comptes distincts.
$response = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'             => 'Traiteurs multi-secteurs',
    'client_target'    => 'b2b',
    'sector_ids'       => [$officesId, $horecaId],
    'create_crm_leads' => true,
]);
check(
    'la génération crée un lead par compte, pas par secteur',
    ($response['body']['leads']['created'] ?? null) === $total,
    json_encode($response['body']['leads'] ?? null)
);

$pdo->exec(sprintf(
    'DELETE FROM mar_b2b_prospect_sector WHERE prospect_id = %d AND sector_id = %d',
    $brasserie,
    $officesId
));

$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', ['sector_ids' => '']);
check('sans secteur, la liste est vide', $response['body'] === []);

$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', ['sector_ids' => '999999']);
check('un secteur inconnu ne renvoie rien', $response['body'] === []);

// Un vivier plus grand que la borne d'affichage. Elle était à deux cents, et le
// réseau en compte neuf cents : le panneau en montrait moins d'un quart sans
// que rien ne se contredise à l'écran. Deux cent cinquante comptes suffisent à
// faire échouer ce test si la borne redescend.
$pdo->exec(sprintf(
    "INSERT INTO mar_b2b_prospect (brand_id, external_ref, company_name, source)
     SELECT 1, CONCAT('vol-', seq.n), CONCAT('Société ', LPAD(seq.n, 4, '0')), 'test'
       FROM (%s) seq",
    implode(' UNION ALL ', array_map(
        static fn (int $n): string => sprintf('SELECT %d AS n', $n),
        range(1, 250)
    ))
));
$pdo->exec(sprintf(
    'INSERT IGNORE INTO mar_b2b_prospect_sector (prospect_id, sector_id)
     SELECT id, %d FROM mar_b2b_prospect WHERE source = \'test\'',
    $officesId
));

$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', ['sector_ids' => (string) $officesId]);
$total    = (int) (call($router, 'GET', '/api/v1/marketing/b2b/prospects/count', [
    'sector_ids' => (string) $officesId,
])['body']['total'] ?? 0);

check('le vivier est listé en entier, pas seulement ses deux cents premiers',
    count($response['body']) === $total && $total > 250,
    count($response['body']) . ' listés sur ' . $total
);

$pdo->exec("DELETE FROM mar_b2b_prospect WHERE source = 'test'");

// Le périmètre s'applique : un franchisé ne consulte pas les comptes du voisin.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'GET', '/api/v1/marketing/b2b/prospects', ['sector_ids' => (string) $officesId]);
$foreign  = array_filter(
    $response['body'],
    static fn (array $p): bool => $p['shop_id'] !== null && $p['shop_id'] !== 1
);
check('aucun compte d\'une autre boutique', $foreign === [], count($foreign) . ' fuite(s)');
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Reprise depuis l'ERP ---------------------------------------------------
// Les boutiques et les comptes professionnels appartiennent à l'ERP : on lit
// ses tables, on ne les double pas. Il n'y a donc pas de jeu d'essai à monter
// — et surtout pas de script qui recréerait `franchisee_shop` ou `client`, dont
// le moindre lancement contre la base réelle effacerait l'ERP.
//
// Conséquence assumée : ces contrôles ne s'exécutent que là où l'ERP est
// présent. Ailleurs, le test le dit au lieu de passer au vert sans rien avoir
// vérifié.
echo "\nReprise depuis l'ERP\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);

$erpAvailable = (int) $pdo->query(
    "SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN ('franchisee_shop', 'client')"
)->fetchColumn() === 2;

if (!$erpAvailable) {
    printf("  · tables ERP absentes de cette base — reprise non vérifiée ici\n");
} else {
    $before = (int) $pdo->query('SELECT COUNT(*) FROM mar_shop')->fetchColumn();

    $response = call($router, 'POST', '/api/v1/marketing/erp/sync');
    $sync     = $response['body'];
    check('la reprise aboutit', $response['status'] === 200, 'statut ' . $response['status']);
    check(
        'elle nomme sa source',
        str_ends_with((string) ($sync['shops']['source'] ?? ''), '.franchisee_shop'),
        (string) ($sync['shops']['source'] ?? '')
    );
    check(
        'elle nomme la table des clients',
        str_ends_with((string) ($sync['prospects']['source'] ?? ''), '.client'),
        (string) ($sync['prospects']['source'] ?? '')
    );
    check(
        'elle rapporte les colonnes retenues',
        ($sync['prospects']['columns']['postal_code'] ?? '') !== '',
        json_encode($sync['prospects']['columns'] ?? [])
    );

    // Une boutique inactive dans l'ERP ne doit pas rejoindre le périmètre.
    check('les boutiques fermées sont écartées', ($sync['shops']['skipped'] ?? 0) >= 1);
    // Trois types différents (1, 2, 3) : un « = 1 » naïf n'en ramènerait qu'un.
    check(
        'seuls les clients professionnels sont repris, tous types confondus',
        ($sync['prospects']['read'] ?? 0) === (int) $pdo->query(
            'SELECT COUNT(*) FROM client WHERE b2b_client_type IS NOT NULL'
        )->fetchColumn()
    );
    check('les accents traversent la reprise', (int) $pdo->query(
        "SELECT COUNT(*) FROM mar_shop WHERE name LIKE '%Châtelain%'"
    )->fetchColumn() === 1);

    // Rejouable : le rapprochement se fait sur l'identifiant ERP, donc un
    // second passage met à jour au lieu de dupliquer — y compris si l'ERP
    // renomme la boutique et son code.
    $pdo->exec("UPDATE franchisee_shop SET name = 'Châtelain (Fort Jaco)', code = 'chatelain-2' WHERE id_franchisee_shop = 1");
    $after = call($router, 'POST', '/api/v1/marketing/erp/sync')['body'];
    check('un second passage ne crée rien', ($after['shops']['created'] ?? null) === 0, json_encode($after['shops']));
    check(
        'une boutique renommée est mise à jour, pas dupliquée',
        (int) $pdo->query('SELECT COUNT(*) FROM mar_shop WHERE erp_shop_id = 1')->fetchColumn() === 1
    );
    $pdo->exec("UPDATE franchisee_shop SET name = 'Bruxelles — Châtelain', code = 'chatelain' WHERE id_franchisee_shop = 1");

    check('les comptes B2B sont rattachés à leur boutique', (int) $pdo->query(
        "SELECT COUNT(*) FROM mar_b2b_prospect WHERE source = 'ERP' AND shop_id IS NOT NULL"
    )->fetchColumn() >= 1);

    // Une boutique déjà présente sous le même code doit adopter l'identifiant
    // ERP. Sans cela elle reste hors du rapprochement, définitivement : les
    // comptes qui la désignent ne lui sont jamais rattachés, et rien ne le dit.
    check(
        'une boutique préexistante adopte son identifiant ERP',
        (int) $pdo->query(
            'SELECT COUNT(*) FROM mar_shop s
               JOIN franchisee_shop f ON f.code = s.code
              WHERE s.erp_shop_id IS NULL'
        )->fetchColumn() === 0
    );

    // Le rattachement se juge sur son résultat, pas sur l'intention : tout
    // compte désignant une boutique reprise doit être rattaché.
    check(
        'aucun compte ne reste orphelin d\'une boutique connue',
        (int) $pdo->query(
            "SELECT COUNT(*) FROM mar_b2b_prospect p
               JOIN client c ON CONCAT('erp-', c.id_client) = p.external_ref
               JOIN mar_shop s ON s.erp_shop_id = c.id_mainshop
              WHERE p.shop_id IS NULL"
        )->fetchColumn() === 0
    );
    check('la reprise a bien ajouté des boutiques', (int) $pdo->query('SELECT COUNT(*) FROM mar_shop')->fetchColumn() > $before);

    // Réservée au réseau.
    AuthContext::set(77, 'FRANCHISEE', 1, [1]);
    $response = call($router, 'POST', '/api/v1/marketing/erp/sync');
    check('un franchisé ne lance pas la reprise', $response['status'] === 403, 'statut ' . $response['status']);
    AuthContext::set(1, 'BRAND_ADMIN', 1);
}

// --- Référentiels de libellés ----------------------------------------------
// Cinq écrans traduisaient un code en libellé avec une table écrite en dur, un
// sixième affichait le code brut. Ajouter une valeur imposait un déploiement du
// front là où le reste du module se règle en base.
echo "\nRéférentiels de libellés\n";
$response = call($router, 'GET', '/api/v1/marketing/references');
$refs     = $response['body'];

foreach ([
    'clientTargets'      => ['b2c', 'B2C — particuliers'],
    'costKinds'          => ['MEDIA', 'Achat média'],
    'fundSources'        => ['ROYALTY', 'Royalties'],
    'reviewPlatforms'    => ['GOOGLE', 'Google Business'],
    'salesChannels'      => ['WS', 'Web shop'],
    'promotionMechanics' => ['PERCENT', 'Pourcentage'],
] as $key => [$code, $label]) {
    $entries = array_column($refs[$key] ?? [], 'label', 'code');
    check(sprintf('%s est servi par la base', $key), ($entries[$code] ?? '') === $label, json_encode($entries));
}

// --- Installation en sous-répertoire --------------------------------------
// Les routes sont absolues mais l'application est servie sous /marketing : sans
// retrait du préfixe, toute l'API répond 404 en production tout en passant en
// développement, où elle est servie à la racine.
echo "\nInstallation en sous-répertoire\n";
$strip = new ReflectionMethod(Request::class, 'stripBasePath');
$strip->setAccessible(true);

foreach ([
    '/api/v1/marketing/references'                          => '/api/v1/marketing/references',
    '/marketing/api/v1/marketing/references'                 => '/api/v1/marketing/references',
    '/webshop/marketing/api/v1/marketing/campaigns/10/leads' => '/api/v1/marketing/campaigns/10/leads',
    '/marketing/'                                            => '/marketing/',
] as $uri => $expected) {
    $got = $strip->invoke(null, $uri);
    check(sprintf('préfixe retiré — %s', $uri), $got === $expected, 'obtenu ' . $got);
}

// La lecture ne doit dépendre ni de putenv ni de getenv : beaucoup de
// configurations durcies neutralisent putenv via disable_functions, et son
// échec est muet — la configuration paraît absente alors qu'elle a été lue.
$file = sys_get_temp_dir() . '/mar_env_store.env';
file_put_contents($file, "MAR_TEST_STORE=\"depuis_le_fichier\"\n");
(new ReflectionProperty(\Marketing\Support\Env::class, 'loaded'))->setValue(null, false);
(new ReflectionProperty(\Marketing\Support\Env::class, 'values'))->setValue(null, []);
putenv('MAR_TEST_STORE');
unset($_ENV['MAR_TEST_STORE']);
\Marketing\Support\Env::load($file);
check('valeur lisible sans passer par getenv', \Marketing\Support\Env::get('MAR_TEST_STORE') === 'depuis_le_fichier');
check('le fichier chargé est rapporté', \Marketing\Support\Env::source() === $file);
unlink($file);

// --- Étanchéité des erreurs ----------------------------------------------
// PDOException hérite de RuntimeException : sans traitement séparé, un message
// SQL — qui cite tables et colonnes — repartirait au client dans une 422.
echo "\nÉtanchéité des erreurs\n";
$leaky = new Router();
$leaky->get('/boom', static function (): array {
    throw new PDOException('SQLSTATE[42S02]: Base table or view not found: mar_secret');
}, true);

$response = $leaky->dispatch(new Request('GET', '/boom'));
check('une erreur SQL renvoie 500', $response['status'] === 500, 'statut ' . $response['status']);
check(
    'le message SQL ne fuite pas',
    !str_contains(json_encode($response['body']) ?: '', 'mar_secret'),
    json_encode($response['body']) ?: ''
);

// --- Lecture du .env ------------------------------------------------------
// Le déploiement écrit ce fichier avec les identifiants de base. Une valeur mal
// relue ne lève rien : l'authentification MySQL échoue sans dire pourquoi.
echo "\nLecture du .env\n";

/** Écrit une valeur comme le fait le workflow, la relit, et compare. */
function roundTrip(string $value): bool
{
    $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $value);
    $file    = sys_get_temp_dir() . '/mar_env_' . md5($value) . '.env';
    file_put_contents($file, sprintf("MAR_TEST_VALUE=\"%s\"\n", $escaped));

    // Env ne charge qu'une fois : on remet le drapeau à zéro entre les cas.
    $flag = new ReflectionProperty(\Marketing\Support\Env::class, 'loaded');
    $flag->setValue(null, false);
    putenv('MAR_TEST_VALUE');
    unset($_ENV['MAR_TEST_VALUE']);

    \Marketing\Support\Env::load($file);
    $read = getenv('MAR_TEST_VALUE');
    unlink($file);

    return $read === $value;
}

foreach ([
    'simple'                  => 's3cret',
    'dièse'                   => 'p@ss#word',
    'signe égal'              => 'a=b=c',
    'espaces internes'        => 'two words',
    'guillemets internes'     => 'he said "hi"',
    'valeur déjà entre guillemets' => '"quoted"',
    'espaces en bordure'      => '  padded  ',
    'antislash'               => 'back\\slash',
] as $label => $value) {
    check(sprintf('mot de passe — %s', $label), roundTrip($value));
}

// L'environnement réel doit rester prioritaire sur le fichier, sinon un pool
// PHP-FPM correctement configuré serait écrasé par un .env oublié.
$file = sys_get_temp_dir() . '/mar_env_priority.env';
file_put_contents($file, "MAR_TEST_PRIORITY=depuis_le_fichier\n");
putenv('MAR_TEST_PRIORITY=depuis_l_environnement');
(new ReflectionProperty(\Marketing\Support\Env::class, 'loaded'))->setValue(null, false);
\Marketing\Support\Env::load($file);
check("l'environnement réel prime sur le fichier", getenv('MAR_TEST_PRIORITY') === 'depuis_l_environnement');
unlink($file);

// --- Visuels envoyés ------------------------------------------------------
// Ce qui compte ici n'est pas qu'un PNG passe, mais que le reste soit refusé :
// le dossier est servi par le serveur web, un fichier écrit sous un nom choisi
// par l'appelant y serait exécutable.
echo "\nVisuels\n";
$uploadDir = sys_get_temp_dir() . '/mar_uploads_' . getmypid();
putenv('MAR_UPLOAD_DIR=' . $uploadDir);

$png = base64_decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
);

$response = call($router, 'POST', '/api/v1/marketing/uploads', [], [
    'content' => 'data:image/png;base64,' . base64_encode($png),
]);
check('un PNG est accepté', $response['status'] === 200, 'statut ' . $response['status']);
check(
    'le chemin rendu est relatif et sous le dossier public',
    str_starts_with((string) ($response['body']['path'] ?? ''), 'uploads/'),
    (string) ($response['body']['path'] ?? '')
);
check(
    'le fichier est réellement écrit',
    is_file($uploadDir . '/' . basename((string) ($response['body']['path'] ?? 'absent')))
);
check(
    'l\'extension vient des octets lus',
    str_ends_with((string) ($response['body']['path'] ?? ''), '.png')
);

$response = call($router, 'POST', '/api/v1/marketing/uploads', [], [
    'content' => base64_encode('<?php system($_GET["c"]); ?>'),
]);
check('un script PHP est refusé', $response['status'] === 400, 'statut ' . $response['status']);

$response = call($router, 'POST', '/api/v1/marketing/uploads', [], [
    'content' => base64_encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
]);
check('un SVG est refusé — il peut porter du script', $response['status'] === 400);

$response = call($router, 'POST', '/api/v1/marketing/uploads', [], [
    'content' => base64_encode($png . str_repeat('x', 4 * 1024 * 1024)),
]);
check('un fichier trop lourd est refusé', $response['status'] === 400);

$response = call($router, 'POST', '/api/v1/marketing/uploads', [], ['content' => '']);
check('un corps vide est refusé', $response['status'] === 400);

// Réduction au format d'impression : 100 × 150 mm à 300 dpi, 3 mm de fond
// perdu — soit 1 252 × 1 843 px. Sans GD, l'image part telle quelle et il n'y
// a rien à vérifier : le serveur ne doit pas refuser l'envoi pour autant.
if (function_exists('imagecreatetruecolor')) {
    $canvas = imagecreatetruecolor(3000, 4500);
    imagefilledrectangle($canvas, 0, 0, 3000, 4500, imagecolorallocate($canvas, 200, 40, 60));
    ob_start();
    imagepng($canvas, null, 1);
    $large = (string) ob_get_clean();
    imagedestroy($canvas);

    $response = call($router, 'POST', '/api/v1/marketing/uploads', [], [
        'content' => base64_encode($large),
    ]);
    $image = $response['body'];

    check('une image trop grande est réduite', ($image['resized'] ?? false) === true);
    check(
        'le côté long tombe au format avec fond perdu',
        ($image['height'] ?? 0) === 1843,
        json_encode([$image['width'] ?? null, $image['height'] ?? null])
    );
    check('le côté court reste dans le format', ($image['width'] ?? 9999) <= 1252);
    check(
        'les proportions sont gardées',
        abs((($image['width'] ?? 0) / ($image['height'] ?? 1)) - (3000 / 4500)) < 0.01
    );
    check('le fichier écrit pèse moins que l\'original', ($image['bytes'] ?? PHP_INT_MAX) < strlen($large));

    // Une petite image n'est jamais agrandie : ajouter des pixels n'ajoute pas
    // de détail. Elle est signalée, pas refusée.
    $small = imagecreatetruecolor(600, 900);
    ob_start();
    imagepng($small, null, 1);
    $smallPng = (string) ob_get_clean();
    imagedestroy($small);

    $image = call($router, 'POST', '/api/v1/marketing/uploads', [], [
        'content' => base64_encode($smallPng),
    ])['body'];

    check('une petite image n\'est pas agrandie', ($image['resized'] ?? true) === false);
    check('elle est signalée sous le format d\'impression', ($image['below_print'] ?? false) === true);
}

array_map('unlink', glob($uploadDir . '/*') ?: []);
@rmdir($uploadDir);

// --- Médiathèque commune ----------------------------------------------------
// Écrite au standard : enveloppe, camelCase, pagination, filtres en liste
// blanche. Réservée au réseau. Un même fichier n'est gardé qu'une fois.
echo "\nMédiathèque commune\n";
$identiteAvant = AuthContext::current();
$mediaDir = sys_get_temp_dir() . '/mar_media_' . getmypid();
putenv('MAR_UPLOAD_DIR=' . $mediaDir);
putenv('MAR_PUBLIC_BASE_URL=https://media.test/marketing');

$media = static function (string $method, string $path, array $query = [], array $body = [], string $raw = '') use ($router): array {
    return $router->dispatch(new Request($method, '/api/v1/marketing' . $path, $query, $body, [], $raw));
};
$fichierDe = static function (?string $url) use ($mediaDir): string {
    return $mediaDir . substr((string) $url, strlen('https://media.test/marketing/uploads'));
};
$imagePng = static function (int $w, int $h, bool $transparent, array $rgb = [200, 40, 60]): string {
    $canvas = imagecreatetruecolor($w, $h);
    imagealphablending($canvas, false);
    imagesavealpha($canvas, true);
    $fond = $transparent ? imagecolorallocatealpha($canvas, 0, 0, 0, 127) : imagecolorallocate($canvas, ...$rgb);
    imagefilledrectangle($canvas, 0, 0, $w, $h, $fond);
    imagefilledrectangle($canvas, (int) ($w / 4), (int) ($h / 4), (int) ($w / 2), (int) ($h / 2), imagecolorallocate($canvas, ...$rgb));
    ob_start();
    imagepng($canvas, null, 6);
    imagedestroy($canvas);

    return (string) ob_get_clean();
};

AuthContext::clear();
check('médiathèque sans identité : 401', $media('GET', '/media-assets')['status'] === 401);

AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$refusFr = [
    $media('GET', '/media-assets')['status'],
    $media('GET', '/media-library')['status'],
    $media('POST', '/media-assets', [], ['content' => base64_encode($png)])['status'],
];
check('médiathèque : une identité de boutique reçoit 403 (lecture comme dépôt), code PERM_ROLE_REQUIRED',
    $refusFr === [403, 403, 403]
        && ($media('GET', '/media-assets')['body']['error']['code'] ?? null) === 'PERM_ROLE_REQUIRED',
    json_encode($refusFr));

AuthContext::set(1, 'BRAND_ADMIN', 1);
$lib = $media('GET', '/media-library');
$cats = $lib['body']['data']['categories'] ?? [];
$viennoiseries = array_values(array_filter($cats, static fn (array $c): bool => $c['code'] === 'viennoiseries'))[0] ?? [];
check('médiathèque : les catégories et les saisons de Social, avec leurs sous-catégories',
    $lib['status'] === 200 && ($lib['body']['success'] ?? false) === true && count($cats) === 8
        && count($viennoiseries['subcategories'] ?? []) === 4 && count($lib['body']['data']['seasons'] ?? []) === 11
        && is_string($lib['body']['meta']['requestId'] ?? null));

if (function_exists('imagecreatetruecolor')) {
    $photo = $imagePng(1600, 1000, false);
    $depot = $media('POST', '/media-assets', [], ['content' => 'data:image/png;base64,' . base64_encode($photo), 'name' => 'Croissant au beurre',
        'category' => 'viennoiseries', 'subcategory' => 'croissants', 'season' => 'toute-annee']);
    $fiche = $depot['body']['data'] ?? [];
    check('dépôt JSON : 201, fiche en camelCase, URL absolue, classements relus avec leurs libellés',
        $depot['status'] === 201 && ($fiche['name'] ?? '') === 'Croissant au beurre' && ($fiche['kind'] ?? '') === 'image'
            && str_starts_with((string) ($fiche['url'] ?? ''), 'https://media.test/marketing/uploads/media/')
            && ($fiche['category']['label'] ?? '') === 'Viennoiseries' && ($fiche['subcategory']['label'] ?? '') === 'Croissants'
            && ($fiche['season']['label'] ?? '') === "Toute l'année" && ($fiche['width'] ?? 0) === 1600 && ($fiche['height'] ?? 0) === 1000
            && ($depot['body']['meta']['duplicate'] ?? null) === false && preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', (string) ($fiche['createdAt'] ?? '')) === 1,
        json_encode([$depot['status'], $fiche['url'] ?? null, $depot['body']['error'] ?? null]));
    check('l\'original est gardé tel quel (aucune réduction) et la vignette fait 480 px en JPEG',
        is_file($fichierDe($fiche['url'] ?? null)) && filesize($fichierDe($fiche['url'] ?? null)) === strlen($photo)
            && str_ends_with((string) ($fiche['thumbnailUrl'] ?? ''), '.thumb.jpg')
            && (getimagesize($fichierDe($fiche['thumbnailUrl'] ?? null))[0] ?? 0) === 480);

    check('une photo déjà légère et sous 2 048 px n\'a pas de version web : webUrl est l\'original',
        ($fiche['webUrl'] ?? '') === ($fiche['url'] ?? 'x'));

    $grande = $media('POST', '/media-assets', ['name' => 'Grande photo'], [], $imagePng(3000, 2000, false, [30, 90, 160]));
    check('une grande photo reçoit une version web de 2 048 px (ce qu\'un post envoie), l\'original restant intact',
        $grande['status'] === 201 && str_ends_with((string) ($grande['body']['data']['webUrl'] ?? ''), '.web.jpg')
            && (getimagesize($fichierDe($grande['body']['data']['webUrl'] ?? null))[0] ?? 0) === 2048
            && ($grande['body']['data']['width'] ?? 0) === 3000,
        json_encode($grande['body']['data']['webUrl'] ?? $grande['body']));
    $pdo->exec("DELETE FROM mar_media WHERE name = 'Grande photo'");

    // Un en-tête PNG qui annonce 30 000 × 30 000 px : le décoder demanderait 4,5 Go. Le dépôt
    // passe, sans versions réduites, plutôt que de faire tomber PHP sur sa limite de mémoire.
    $ihdr = pack('NN', 30000, 30000) . "\x08\x06\x00\x00\x00";
    $geante = "\x89PNG\r\n\x1a\n" . pack('N', 13) . 'IHDR' . $ihdr . pack('N', crc32('IHDR' . $ihdr)) . str_repeat("\x00", 64);
    $geant = $media('POST', '/media-assets', ['name' => 'Géante'], [], $geante);
    check('une image trop grande pour la mémoire du serveur est déposée sans vignette, sans planter',
        $geant['status'] === 201 && ($geant['body']['data']['width'] ?? 0) === 30000
            && array_key_exists('thumbnailUrl', $geant['body']['data'] ?? []) && $geant['body']['data']['thumbnailUrl'] === null,
        json_encode([$geant['status'], $geant['body']['error'] ?? null]));
    $pdo->exec("DELETE FROM mar_media WHERE name = 'Géante'");

    $encore = $media('POST', '/media-assets', [], ['content' => base64_encode($photo), 'name' => 'Autre nom']);
    check('le même fichier redéposé : 200, même fiche, nom d\'origine gardé (dépôt idempotent)',
        $encore['status'] === 200 && ($encore['body']['meta']['duplicate'] ?? null) === true
            && ($encore['body']['data']['id'] ?? null) === ($fiche['id'] ?? 'x') && ($encore['body']['data']['name'] ?? '') === 'Croissant au beurre'
            && (int) $pdo->query('SELECT COUNT(*) FROM mar_media')->fetchColumn() === 1);

    $detoure = $imagePng(900, 1200, true, [40, 120, 60]);
    $brut = $media('POST', '/media-assets', ['name' => 'Tarte détourée', 'category' => 'tartes', 'cutout' => 'true', 'source' => 'social'], [], $detoure);
    check('dépôt en corps brut (sans base64), classements en query ; une photo détourée garde une vignette PNG transparente',
        $brut['status'] === 201 && ($brut['body']['data']['cutout'] ?? false) === true && ($brut['body']['data']['source'] ?? '') === 'social'
            && str_ends_with((string) ($brut['body']['data']['thumbnailUrl'] ?? ''), '.thumb.png')
            && (getimagesize($fichierDe($brut['body']['data']['thumbnailUrl'] ?? null))[1] ?? 0) === 480,
        json_encode($brut['body']['error'] ?? $brut['body']['data']['thumbnailUrl'] ?? null));

    $mp4 = "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" . str_repeat("\x00", 2048);
    $video = $media('POST', '/media-assets', ['name' => 'Vitrine de Noël'], [], $mp4);
    $idVideo = (string) ($video['body']['data']['id'] ?? '0');
    $couverture = $media('PUT', '/media-assets/' . $idVideo . '/thumbnail', [], [], $imagePng(1280, 720, false));
    check('une vidéo MP4 est acceptée sans vignette, puis reçoit la couverture que le navigateur a tirée',
        $video['status'] === 201 && ($video['body']['data']['kind'] ?? '') === 'video' && ($video['body']['data']['mimeType'] ?? '') === 'video/mp4'
            && array_key_exists('thumbnailUrl', $video['body']['data'] ?? []) && $video['body']['data']['thumbnailUrl'] === null
            && $couverture['status'] === 200 && str_ends_with((string) ($couverture['body']['data']['thumbnailUrl'] ?? ''), '.thumb.jpg'),
        json_encode([$video['status'], $couverture['status'], $couverture['body']['error'] ?? null]));

    $avant = (int) $pdo->query('SELECT COUNT(*) FROM mar_media')->fetchColumn();
    $refus = [
        'svg'              => $media('POST', '/media-assets', [], ['content' => base64_encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]),
        'php'              => $media('POST', '/media-assets', [], [], '<?php system($_GET["c"]); ?>'),
        'champ inconnu'    => $media('POST', '/media-assets', [], ['content' => base64_encode($png), 'path' => '/etc/passwd']),
        'sous-catégorie'   => $media('POST', '/media-assets', [], ['content' => base64_encode($png), 'category' => 'pains', 'subcategory' => 'croissants']),
        'saison'           => $media('POST', '/media-assets', [], ['content' => base64_encode($png), 'season' => 'carnaval']),
        'produit'          => $media('POST', '/media-assets', [], ['content' => base64_encode($png), 'offerItemId' => 999999]),
        'couverture'       => $media('POST', '/media-assets', [], ['content' => base64_encode($mp4), 'poster' => base64_encode($mp4)]),
        'vide'             => $media('POST', '/media-assets', [], ['content' => '']),
        'trop lourde'      => $media('POST', '/media-assets', [], [], "\x89PNG\r\n\x1a\n" . str_repeat('x', 20 * 1024 * 1024)),
    ];
    $statuts = array_map(static fn (array $r): int => $r['status'], $refus);
    check('dépôts refusés en 422 VALIDATION_FAILED, champ nommé, rien d\'écrit (SVG, PHP, champ inconnu, sous-catégorie d\'une autre catégorie, saison, produit inconnus, couverture qui n\'est pas une image, vide, trop lourde)',
        array_unique(array_values($statuts)) === [422]
            && count(array_filter($refus, static fn (array $r): bool => ($r['body']['error']['code'] ?? '') === 'VALIDATION_FAILED' && ($r['body']['error']['details'][0]['field'] ?? '') !== '')) === count($refus)
            && (int) $pdo->query('SELECT COUNT(*) FROM mar_media')->fetchColumn() === $avant,
        json_encode($statuts));

    // Liste : pagination, tri, filtres.
    $page2 = $media('GET', '/media-assets', ['perPage' => '2', 'page' => '2', 'sort' => 'name']);
    check('liste : page 2 de 2 par page, total et nombre de pages, tri par nom',
        $page2['status'] === 200 && count($page2['body']['data'] ?? []) === 1
            && ($page2['body']['meta']['pagination'] ?? null) === ['page' => 2, 'perPage' => 2, 'total' => 3, 'totalPages' => 2]
            && ($page2['body']['data'][0]['name'] ?? '') === 'Vitrine de Noël',
        json_encode($page2['body']['meta']['pagination'] ?? $page2['body']));
    check('liste : perPage au-delà de 100 ramené à 100',
        ($media('GET', '/media-assets', ['perPage' => '500'])['body']['meta']['pagination']['perPage'] ?? 0) === 100);
    $filtres = [
        'vidéos'              => [['filter' => ['kind' => ['eq' => 'video']]], 1],
        'catégorie'           => [['filter' => ['category' => ['eq' => 'viennoiseries']]], 1],
        'non classées'        => [['filter' => ['category' => ['isNull' => 'true']]], 1],
        'recherche par nom'   => [['filter' => ['name' => ['contains' => 'tarte']]], 1],
        'recherche par libellé de catégorie' => [['filter' => ['name' => ['contains' => 'viennois']]], 1],
        'source'              => [['filter' => ['source' => 'social']], 1],
    ];
    foreach ($filtres as $cas => [$query, $attendu]) {
        $r = $media('GET', '/media-assets', $query);
        check('liste filtrée (' . $cas . ')', $r['status'] === 200 && ($r['body']['meta']['pagination']['total'] ?? -1) === $attendu,
            json_encode([$r['status'], $r['body']['meta']['pagination']['total'] ?? $r['body']]));
    }
    $mauvais = [
        $media('GET', '/media-assets', ['page' => '0'])['status'],
        $media('GET', '/media-assets', ['tri' => 'name'])['status'],
        $media('GET', '/media-assets', ['sort' => 'sha256'])['status'],
        $media('GET', '/media-assets', ['filter' => ['sha256' => ['eq' => 'x']]])['status'],
        $media('GET', '/media-assets', ['filter' => ['kind' => ['in' => 'image']]])['status'],
        $media('GET', '/media-assets', ['filter' => ['kind' => ['eq' => 'pdf']]])['status'],
    ];
    check('liste : page 0, paramètre, tri, filtre, opérateur ou valeur hors liste → 422', array_unique($mauvais) === [422], json_encode($mauvais));

    // Modification, retrait, remise.
    $idPhoto = (string) ($fiche['id'] ?? '0');
    $patch = $media('PATCH', '/media-assets/' . $idPhoto, [], ['name' => 'Croissant', 'category' => 'patisseries']);
    check('modification : renommer et changer de catégorie efface la sous-catégorie qui n\'y appartient plus',
        $patch['status'] === 200 && ($patch['body']['data']['name'] ?? '') === 'Croissant'
            && ($patch['body']['data']['category']['code'] ?? '') === 'patisseries'
            && array_key_exists('subcategory', $patch['body']['data'] ?? []) && $patch['body']['data']['subcategory'] === null,
        json_encode($patch['body']['data'] ?? $patch['body']));
    $refusPatch = $media('PATCH', '/media-assets/' . $idPhoto, [], ['name' => 'Ne doit pas passer', 'subcategory' => 'croissants']);
    check('modification refusée (sous-catégorie d\'une autre catégorie) : 422, rien d\'écrit',
        $refusPatch['status'] === 422 && ($media('GET', '/media-assets/' . $idPhoto)['body']['data']['name'] ?? '') === 'Croissant');
    $idBoutique = (int) $pdo->query('SELECT id FROM mar_shop ORDER BY id LIMIT 1')->fetchColumn();
    $idProduit  = (int) $pdo->query('SELECT id FROM mar_offer_item ORDER BY id LIMIT 1')->fetchColumn();
    $lie = $media('PATCH', '/media-assets/' . $idPhoto, [], ['shopId' => $idBoutique, 'offerItemId' => $idProduit]);
    check('une photo se rattache à une boutique et à un produit du catalogue, relus par leur nom',
        $lie['status'] === 200 && ($lie['body']['data']['shop']['id'] ?? '') === (string) $idBoutique && ($lie['body']['data']['shop']['name'] ?? '') !== ''
            && ($lie['body']['data']['offerItem']['id'] ?? '') === (string) $idProduit
            && ($media('GET', '/media-assets', ['filter' => ['offerItem' => ['eq' => (string) $idProduit]]])['body']['meta']['pagination']['total'] ?? 0) === 1,
        json_encode($lie['body']));

    $retrait  = $media('DELETE', '/media-assets/' . $idPhoto);
    $retrait2 = $media('DELETE', '/media-assets/' . $idPhoto);
    $liste    = $media('GET', '/media-assets')['body']['meta']['pagination']['total'] ?? -1;
    $retires  = $media('GET', '/media-assets', ['filter' => ['archived' => ['eq' => 'true']]])['body']['meta']['pagination']['total'] ?? -1;
    check('retrait : 200 deux fois (idempotent), sorti de la liste, visible parmi les retirés, fichier toujours servi',
        $retrait['status'] === 200 && $retrait2['status'] === 200 && ($retrait2['body']['data']['archived'] ?? false) === true
            && $liste === 2 && $retires === 1 && is_file($fichierDe($fiche['url'] ?? null)));
    $remis = $media('POST', '/media-assets', [], ['content' => base64_encode($photo)]);
    check('redéposer un fichier retiré le remet dans la médiathèque, avec ses classements',
        $remis['status'] === 200 && ($remis['body']['data']['archived'] ?? true) === false && ($remis['body']['data']['name'] ?? '') === 'Croissant');

    check('fichier inconnu : 404 RESOURCE_NOT_FOUND en lecture, modification et retrait',
        $media('GET', '/media-assets/999999')['status'] === 404 && $media('PATCH', '/media-assets/999999', [], ['name' => 'x'])['status'] === 404
            && $media('DELETE', '/media-assets/999999')['status'] === 404
            && ($media('GET', '/media-assets/999999')['body']['error']['code'] ?? '') === 'RESOURCE_NOT_FOUND');

    AuthContext::set(77, 'FRANCHISEE', 1, [1]);
    check('une identité de boutique ne modifie ni ne retire un fichier du réseau (403)',
        $media('PATCH', '/media-assets/' . $idPhoto, [], ['name' => 'x'])['status'] === 403 && $media('DELETE', '/media-assets/' . $idPhoto)['status'] === 403
            && $media('GET', '/media-assets/' . $idPhoto)['status'] === 403);
}

$rmTree = static function (string $dir) use (&$rmTree): void {
    foreach (glob($dir . '/*') ?: [] as $entry) {
        is_dir($entry) ? $rmTree($entry) : unlink($entry);
    }
    @rmdir($dir);
};
$rmTree($mediaDir);
putenv('MAR_PUBLIC_BASE_URL');
if ($identiteAvant !== null) {
    AuthContext::set($identiteAvant->userId, $identiteAvant->role, $identiteAvant->brandId, $identiteAvant->shopIds);
} else {
    AuthContext::clear();
}

// --- Bons de campagne -----------------------------------------------------
// Les bons vivent dans le webshop ; le module n'en garde rien, pas même le
// lien. Le webshop est donc simulé ici, au contrat que documente son API.md
// (« Vouchers for the marketing module ») : rien de plus que ce qu'il promet.
echo "\nBons de campagne\n";

AuthContext::clear();
check('bons : sans contexte, refusé', call($router, 'GET', '/api/v1/marketing/campaigns/10/vouchers')['status'] === 401);

// Sans connexion au webshop configurée (le cas du routeur réel ici) : l'écran
// le dit — jamais une liste vide qui ferait croire qu'il n'y a pas de bon.
AuthContext::set(1, 'BRAND_ADMIN', 1);
$response = call($router, 'GET', '/api/v1/marketing/campaigns/10/vouchers');
check('bons : sans connexion, la lecture le dit', $response['status'] === 200
    && ($response['body']['configured'] ?? null) === false && is_string($response['body']['message'] ?? null));

$pdo->exec('UPDATE mar_shop SET erp_shop_id = 900 + id');
// Identifiant attribué par la base : les tests précédents créent déjà des
// campagnes, et un identifiant posé en dur entrerait en collision avec elles.
$pdo->exec("INSERT INTO mar_campaign (brand_id, type_id, name, scope, status_code, starts_on, ends_on, budget_amount)
    VALUES (1, 7, 'Rentrée Namur', 'LOCALE', 'planned', '2026-09-01', '2026-09-30', 300)");
$namur = (int) $pdo->lastInsertId();
$pdo->exec(sprintf('INSERT INTO mar_campaign_shop (campaign_id, shop_id) VALUES (%d, 1)', $namur));
$pdo->exec("INSERT INTO mar_offer_item (category, sku_ref, name, is_active) VALUES ('produit', 'erp-99501', 'Bûche d''essai', 1)");
$buche = (int) $pdo->lastInsertId();

// Le webshop simulé : ses bons, leurs commandes, et le dernier corps reçu.
$ws = [
    'vouchers' => [
        'BIENVENUE10' => ['type' => 'percent', 'value' => 10.0, 'shopId' => null, 'shopName' => null],
        'NAMUR5'      => ['type' => 'fixed', 'value' => 5.0, 'shopId' => 901, 'shopName' => 'Namur'],
    ],
    'orders' => [
        'BIENVENUE10' => [
            ['shopId' => 901, 'shopName' => 'Namur', 'orders' => 3, 'revenue' => 90.0, 'discount' => 9.0],
            ['shopId' => 902, 'shopName' => 'Uccle', 'orders' => 2, 'revenue' => 50.0, 'discount' => 5.0],
        ],
    ],
    'last' => null, 'calls' => [],
];
$wsRow = static function (string $code, array $v): array {
    return [
        'code' => $code, 'type' => $v['type'], 'value' => $v['value'], 'minOrder' => $v['min_order'] ?? 0.0,
        'scopeProductId' => $v['scope_product_id'] ?? null, 'scopeProductName' => isset($v['scope_product_id']) ? 'Bûche d\'essai' : null,
        'scopeMaxQty' => $v['scope_max_qty'] ?? null, 'shopId' => $v['shopId'] ?? null, 'shopName' => $v['shopName'] ?? null,
        'targetKind' => $v['target_kind'] ?? 'NETWORK', 'targetId' => $v['target_id'] ?? null, 'targetLabel' => null,
        'startsAt' => $v['starts_at'] ?? null, 'expiresAt' => $v['expires_at'] ?? null, 'usageCount' => 0,
        'usageLimit' => $v['max_uses'] ?? null, 'perCustomer' => $v['per_customer'] ?? null,
        'reasonKind' => null, 'reasonNote' => null, 'createdBy' => null,
        'marCampaignId' => $v['camp'] ?? null, 'marCampaignOrigin' => $v['origin'] ?? null, 'active' => $v['active'] ?? true,
    ] + (($v['type'] ?? '') === 'promos' ? [
        // Type « promos » (API.md, migration 0136) : la liste et le cumul.
        'value' => null, 'cumulative' => (bool) ($v['cumulative'] ?? false),
        'promos' => array_map(static fn (array $p): array => $p + [
            'productName' => 'Produit ' . $p['productId'], 'label' => 'Produit ' . $p['productId'] . ' : ' . $p['mechanic'],
        ], $v['promos'] ?? []),
    ] : []);
};
$fake = static function (string $method, string $url, array $headers, ?string $body, int $timeout) use (&$ws, $wsRow): array {
    unset($headers, $timeout);
    $path = (string) parse_url($url, PHP_URL_PATH);
    parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
    $in = $body !== null ? (array) json_decode($body, true) : [];
    $ws['calls'][] = $method . ' ' . $path;
    $json = static fn (int $status, $data): array => [$status, (string) json_encode($data)];

    if ($method === 'GET' && $path === '/franchisor/voucher-codes') {
        $codes = isset($q['codes']) ? explode(',', (string) $q['codes']) : null;
        $shops = isset($q['shops']) ? array_map('intval', explode(',', (string) $q['shops'])) : null;
        $out = [];
        foreach ($ws['vouchers'] as $code => $v) {
            if ($codes !== null && !in_array($code, $codes, true)) { continue; }
            if ($shops !== null && !in_array($v['shopId'] ?? -1, $shops, true)) { continue; }
            if (isset($q['campaign']) && ($v['camp'] ?? null) !== (int) $q['campaign']) { continue; }
            if (($q['q'] ?? '') !== '' && stripos($code, (string) $q['q']) === false) { continue; }
            $out[] = $wsRow($code, $v);
        }
        return $json(200, $out);
    }
    if ($method === 'GET' && $path === '/franchisor/voucher-usage') {
        return $json(200, array_map(static function (string $code) use ($ws): array {
            $rows = $ws['orders'][$code] ?? [];
            return ['code' => $code, 'exists' => isset($ws['vouchers'][$code]), 'usageCount' => 0, 'usageLimit' => null,
                    'orders' => array_sum(array_column($rows, 'orders')), 'revenue' => array_sum(array_column($rows, 'revenue')),
                    'discount' => array_sum(array_column($rows, 'discount')), 'byShop' => $rows];
        }, explode(',', (string) ($q['codes'] ?? ''))));
    }
    if ($method === 'GET' && $path === '/franchisor/offices') {
        return $json(200, [['id' => 7, 'name' => 'Bureau Dupont', 'city' => 'Namur']]);
    }
    if ($method === 'POST' && $path === '/franchisor/voucher') {
        $ws['last'] = $in;
        $code = $in['code'] !== '' ? $in['code'] : 'M-GENERE';
        $existed = isset($ws['vouchers'][$code]);
        if (!empty($in['create_only']) && $existed) {
            return $json(409, ['error' => 'code déjà utilisé : ' . $code, 'code' => $code]);
        }
        if (($in['type'] ?? '') === 'promos' && empty($in['promos'])) {
            return $json(400, ['error' => 'promos : au moins une promotion']);
        }
        $old = $ws['vouchers'][$code] ?? [];
        $ws['vouchers'][$code] = [
            'promos' => $in['promos'] ?? null, 'cumulative' => $in['cumulative'] ?? false,
            'type' => $in['type'], 'value' => $in['value'], 'min_order' => $in['min_order'],
            'scope_product_id' => $in['scope_product_id'], 'scope_max_qty' => $in['scope_max_qty'],
            'shopId' => $in['id_shop'], 'shopName' => $in['id_shop'] !== null ? 'Boutique ' . $in['id_shop'] : null,
            'target_kind' => $in['target_kind'], 'target_id' => $in['target_id'],
            'starts_at' => $in['starts_at'] !== '' ? $in['starts_at'] . ' 00:00:00' : null, 'expires_at' => $in['expires_at'],
            'max_uses' => $in['max_uses'] !== '' ? $in['max_uses'] : null, 'per_customer' => $in['per_customer'],
            'camp' => $existed ? ($old['camp'] ?? null) : ($in['campaign_id'] ?? null),
            'origin' => $existed ? ($old['origin'] ?? null) : (isset($in['campaign_id']) ? 'created' : null),
            'active' => (bool) $in['active'],
        ];
        return $json(200, ['ok' => true, 'code' => $code, 'created' => !$existed]);
    }
    if ($method === 'POST' && $path === '/franchisor/voucher-campaign') {
        $code = (string) $in['code'];
        if (!isset($ws['vouchers'][$code])) { return $json(404, ['error' => 'bon introuvable']); }
        $current = $ws['vouchers'][$code]['camp'] ?? null;
        if ($in['campaign_id'] !== null) {
            if ($current === $in['campaign_id']) { return $json(200, ['ok' => true, 'created' => false]); }
            if ($current !== null) { return $json(409, ['error' => 'bon déjà suivi par une autre campagne', 'campaignId' => $current]); }
            $ws['vouchers'][$code]['camp'] = $in['campaign_id'];
            $ws['vouchers'][$code]['origin'] = 'attached';
            return $json(200, ['ok' => true, 'created' => true]);
        }
        if ($current !== $in['from_campaign']) { return $json(409, ['error' => 'ce bon ne suit pas cette campagne']); }
        $ws['vouchers'][$code]['camp'] = null;
        $ws['vouchers'][$code]['origin'] = null;
        return $json(200, ['ok' => true]);
    }
    if ($method === 'POST' && $path === '/franchisor/voucher-active') {
        if (!isset($ws['vouchers'][$in['code']])) { return $json(404, ['error' => 'bon introuvable']); }
        $ws['vouchers'][$in['code']]['active'] = (bool) $in['active'];
        return $json(200, ['ok' => true]);
    }
    return $json(404, ['error' => 'Not found']);
};

$vouchersRouter = new Router();
$vc = new \Marketing\Controller\CampaignVoucherController(new \Marketing\Service\CampaignVoucherService(
    new \Marketing\Repository\CampaignVoucherRepository(),
    new \Marketing\Support\WebshopClient($fake)
));
$vouchersRouter->get('/api/v1/marketing/campaigns/{id}/vouchers', [$vc, 'index']);
$V = '/api/v1/marketing/campaigns/';

// Depuis le 05/11/2026 les bons se créent dans TFBuddy : ceux de l'ancien moteur
// du webshop se lisent encore (ce qu'ils ont donné), ne s'écrivent plus.
$ws['vouchers']['ETE10'] = ['type' => 'percent', 'value' => 10.0, 'shopId' => null, 'shopName' => null, 'camp' => 10, 'origin' => 'created'];
$ws['vouchers']['BIENVENUE10'] += ['camp' => 10, 'origin' => 'attached'];
$response = call($vouchersRouter, 'GET', $V . '10/vouchers');
$list = array_column($response['body']['vouchers'] ?? [], null, 'code');
check('bons du webshop : la campagne liste les siens, en lecture seule, l\'origine dite', $response['status'] === 200 && count($list) === 2
    && ($response['body']['can_edit'] ?? true) === false && ($list['ETE10']['origin'] ?? '') === 'created' && ($list['BIENVENUE10']['origin'] ?? '') === 'attached',
    implode(',', array_keys($list)));
check('bons du webshop : ce qu\'ils ont donné, tout le réseau pour la marque',
    ($list['BIENVENUE10']['results']['orders'] ?? 0) === 5 && ($response['body']['totals']['revenue'] ?? 0) == 140);
$ws['calls'] = [];
$absentes = [
    call($router, 'POST', $V . '10/vouchers', [], ['mechanic' => 'percent', 'value' => 10])['status'],
    call($router, 'PATCH', $V . '10/vouchers/ETE10', [], ['value' => 15])['status'],
    call($router, 'PUT', $V . '10/vouchers/NAMUR5')['status'],
    call($router, 'DELETE', $V . '10/vouchers/ETE10')['status'],
    call($router, 'GET', '/api/v1/marketing/webshop-vouchers')['status'],
    call($router, 'GET', '/api/v1/marketing/webshop-offices')['status'],
];
check('bons du webshop : plus aucune route d\'écriture (créer, modifier, rattacher, retirer, chercher), rien n\'est écrit au webshop',
    array_diff($absentes, [404, 405]) === [] && $ws['calls'] === [], json_encode([$absentes, $ws['calls']]));
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($vouchersRouter, 'GET', $V . '10/vouchers');
$list = array_column($response['body']['vouchers'] ?? [], null, 'code');
check('bons du webshop : franchisé, résultats de sa boutique seulement',
    ($list['BIENVENUE10']['results']['orders'] ?? 0) === 3 && count($list['BIENVENUE10']['results']['by_shop'] ?? []) === 1);
check('bons du webshop : franchisé, campagne d\'une autre boutique invisible (404)', call($vouchersRouter, 'GET', $V . '11/vouchers')['status'] === 404);
AuthContext::set(1, 'BRAND_ADMIN', 1);

// Un bon qui DÉCLENCHE les promotions de l'étape Prix. Une campagne réseau,
// son offre et quatre lignes en promotion : deux qui deviennent un bon de l'ERP
// (offre liée, pourcentage), un prix de formule et un produit hors ERP qui ne le peuvent pas.
$pdo->exec("INSERT INTO mar_campaign (brand_id, type_id, name, scope, status_code, starts_on, ends_on, budget_amount)
    VALUES (1, 7, 'Noël bûches', 'RESEAU', 'planned', '2026-12-01', '2026-12-31', 800)");
$noel = (int) $pdo->lastInsertId();
$pdo->exec(sprintf("INSERT INTO mar_campaign_offer (campaign_id, title, max_qty_per_ticket, is_cumulative) VALUES (%d, 'Offre Noël', 4, 0)", $noel));
$noelOffer = (int) $pdo->lastInsertId();
$item = static function (?string $sku, string $name) use ($pdo): int {
    $pdo->prepare("INSERT INTO mar_offer_item (category, sku_ref, name, is_active) VALUES ('produit', ?, ?, 1)")->execute([$sku, $name]);
    return (int) $pdo->lastInsertId();
};
$praline = $item('erp-99601', 'Bûche Praliné');
$choco   = $item('erp-99602', 'Bûche Chocolat');
$formule = $item('erp-99603', 'Formule Réveillon');
$libre   = $item(null, 'Bûche maison');   // saisie libre : aucune référence ERP
$ligne = $pdo->prepare('INSERT INTO mar_campaign_offer_item (campaign_offer_id, offer_item_id, label, sort_order, mechanic_type,
    discount_pct, fixed_price, buy_qty, get_qty, baseline_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
$ligne->execute([$noelOffer, $praline, 'Bûche Praliné', 1, 'BUY_X_GET_Y', null, null, 2, 1, 19.90]);
$ligne->execute([$noelOffer, $choco, 'Bûche Chocolat', 2, 'PERCENT', 15, null, null, null, 19.90]);
$ligne->execute([$noelOffer, $formule, 'Formule Réveillon', 3, 'BUNDLE_FIXED', null, 24.00, null, null, 29.00]);
$ligne->execute([$noelOffer, $libre, 'Bûche maison', 4, 'CROSSED_PRICE', null, 15.00, null, null, 18.00]);

// --- Bons dans TFBuddy (route erp-vouchers) -------------------------------
// Un bon = une campagne de bons de l'ERP rattachée à une promotion en mode
// « bon seulement », créée depuis une ligne de l'étape Prix. L'ERP est simulé :
// les formes sont celles de son swagger et de la fiche relue par le cockpit
// (src/promos_bons.php, essai du 24/10/2026).
echo "\nBons dans TFBuddy\n";
$erpV = ['promos' => [], 'vcs' => [], 'calls' => [], 'refusePromo' => false];
$erpFake = static function (string $url, array $headers, int $timeout, string $method = 'GET', ?string $payload = null) use (&$erpV): array {
    unset($headers, $timeout);
    $path = (string) parse_url($url, PHP_URL_PATH);
    parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
    $in = $payload !== null && $payload !== '' ? (array) json_decode($payload, true) : [];
    $erpV['calls'][] = [$method, $path, $in];
    $json = static fn (int $st, array $b): array => [$st, (string) json_encode($b)];
    if ($method === 'POST' && preg_match('#^/api/v1/admin/promotions/(buy-x-get-y|scheduled-product-discount)$#', $path, $m)) {
        if ($erpV['refusePromo']) { return $json(422, ['status' => 'error', 'description' => 'INVALID_PROMOTION_DATA', 'errors' => ['reward' => 'reward.product_ids is required.']]); }
        $id = 500 + count($erpV['promos']);
        $erpV['promos'][$id] = $in + ['family' => $m[1]];
        return $json(201, ['status' => 'success', 'message' => 'created', 'data' => ['id' => $id]]);
    }
    if ($method === 'PATCH' && preg_match('#^/api/v1/admin/promotions/[a-z-]+/(\d+)$#', $path, $m)) {
        $erpV['promos'][(int) $m[1]]['status'] = $in['status'] ?? null;
        return $json(200, ['data' => ['id' => (int) $m[1]]]);
    }
    if ($method === 'POST' && $path === '/api/v1/admin/voucher-campaigns') {
        $id = 700 + count($erpV['vcs']);
        $erpV['vcs'][$id] = ['campaign' => $in + ['id' => $id], 'codes' => []];
        return $json(201, ['status' => 'success', 'data' => ['campaign' => ['id' => $id]]]);
    }
    if (preg_match('#^/api/v1/admin/voucher-campaigns/(\d+)(/.*)?$#', $path, $m)) {
        $id = (int) $m[1]; $rest = $m[2] ?? '';
        if (!isset($erpV['vcs'][$id])) { return $json(404, ['status' => 'error', 'description' => 'NOT_FOUND']); }
        $vc = &$erpV['vcs'][$id];
        if ($method === 'POST' && $rest === '/codes/generate') {
            for ($i = 0; $i < (int) $in['count']; $i++) { $vc['codes'][] = ['id' => count($vc['codes']) + 1, 'code' => ($in['prefix'] ?? '') . sprintf('%08d', count($vc['codes']) + 1), 'status' => 'ACTIVE', 'usage_count' => 0, 'usage_limit' => 1]; }
            return $json(201, ['status' => 'success']);
        }
        if ($method === 'PUT' && $rest === '/promotion') { $vc['campaign']['id_promotion'] = $in['id_promotion']; return $json(200, ['status' => 'success']); }
        if ($method === 'PATCH' && $rest === '/status') {
            if (($vc['campaign']['code_type'] ?? '') === 'UNIQUE') { return $json(422, ['status' => 'error', 'description' => 'shared_code is not supported for UNIQUE campaigns']); }
            $vc['campaign']['status'] = $in['status']; return $json(200, ['status' => 'success']);
        }
        if ($method === 'PATCH' && $rest === '') { $vc['campaign']['status'] = $in['status'] ?? $vc['campaign']['status']; return $json(200, ['status' => 'success']); }
        if ($method === 'GET' && $rest === '') {
            $promo = $erpV['promos'][(int) ($vc['campaign']['id_promotion'] ?? 0)] ?? null;
            return $json(200, ['data' => ['campaign' => $vc['campaign'], 'shared_code' => $vc['campaign']['shared_code'] ?? null, 'redemptions_total' => 3,
                'configuration_complete' => $promo !== null, 'missing_requirements' => $promo === null ? ['promotion'] : []]]);
        }
        if ($method === 'GET' && $rest === '/codes') {
            $page = (int) ($q['page'] ?? 1); $limit = (int) ($q['limit'] ?? 25);
            return $json(200, ['items' => array_slice($vc['codes'], ($page - 1) * $limit, $limit),
                'pagination' => ['page' => $page, 'limit' => $limit, 'total' => count($vc['codes']), 'pages' => (int) ceil(count($vc['codes']) / max(1, $limit))]]);
        }
    }
    return $json(404, ['status' => 'error', 'description' => 'NOT_FOUND']);
};
$baseErpAvant = getenv('MAR_ERP_API_BASE');
\Marketing\Support\Env::set('MAR_ERP_API_BASE', 'https://erp.test');
$evRouter = new Router();
$evc = new \Marketing\Controller\ErpVoucherController(new \Marketing\Service\ErpVoucherService(
    new \Marketing\Repository\CampaignRepository(), new \Marketing\Repository\CampaignVoucherRepository(),
    new \Marketing\Repository\ErpVoucherRepository(), new \Marketing\Support\ErpClient($erpFake)
));
$evRouter->get('/api/v1/marketing/campaigns/{id}/erp-vouchers', [$evc, 'index']);
$evRouter->post('/api/v1/marketing/campaigns/{id}/erp-vouchers', [$evc, 'store']);
$evRouter->patch('/api/v1/marketing/campaigns/{id}/erp-vouchers/{voucherId}', [$evc, 'update']);
$EV = '/api/v1/marketing/campaigns/' . $noel . '/erp-vouchers';
AuthContext::clear();
check('bons TFBuddy : 401 sans identité', call($router, 'GET', $EV)['status'] === 401);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$lu = call($evRouter, 'GET', $EV);
$lignes = array_column($lu['body']['data']['lines'] ?? [], null, 'label');
check('bons TFBuddy : les lignes de l\'étape Prix, et lesquelles deviennent un bon (offre liée, pourcentage) ou pourquoi non',
    $lu['status'] === 200 && $lu['body']['data']['configured'] === true && $lu['body']['data']['vouchers'] === []
        && $lignes['Bûche Praliné']['eligible'] && $lignes['Bûche Chocolat']['eligible']
        && !$lignes['Formule Réveillon']['eligible'] && str_contains((string) $lignes['Formule Réveillon']['reason'], 'mécanique')
        && !$lignes['Bûche maison']['eligible'] && str_contains((string) $lignes['Bûche maison']['reason'], 'produit de l\'ERP'),
    json_encode($lu['body']['data']['lines'] ?? null));
$refusEv = [
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco, 'pirate' => 1])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco, 'codeType' => 'UNIQUE'])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco, 'sharedCode' => 'a b'])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco, 'validFrom' => '2026-12-10', 'validTo' => '2026-12-01'])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $formule])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $libre])['status'],
    call($evRouter, 'POST', $EV, [], ['offerItemId' => $buche])['status'],
];
check('bons TFBuddy : refusés (422) — champ inconnu, codes uniques sans nombre, code illisible, fin avant début, prix de formule, produit hors ERP, ligne d\'une autre campagne ; rien n\'est écrit dans l\'ERP',
    array_unique($refusEv) === [422] && $erpV['calls'] === [], json_encode($refusEv));
check('bons TFBuddy : campagne inconnue (404)', call($evRouter, 'GET', '/api/v1/marketing/campaigns/999999/erp-vouchers')['status'] === 404);
$cree = call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco, 'codeType' => 'SHARED', 'sharedCode' => 'noel15', 'usageLimitTotal' => 500, 'activate' => true]);
$ordre = array_map(static fn ($c) => $c[0] . ' ' . preg_replace('#\d+#', 'N', $c[1]), array_values(array_filter($erpV['calls'], static fn ($c) => $c[0] !== 'GET')));
$promoEnvoyee = $erpV['calls'][0][2] ?? [];
$campEnvoyee = $erpV['calls'][1][2] ?? [];
check('bons TFBuddy : un code pour tous — promotion inactive « bon seulement », campagne en brouillon, rattachement, puis activation (dans cet ordre)',
    $cree['status'] === 201 && $ordre === ['POST /api/vN/admin/promotions/scheduled-product-discount', 'POST /api/vN/admin/voucher-campaigns',
        'PUT /api/vN/admin/voucher-campaigns/N/promotion', 'PATCH /api/vN/admin/promotions/scheduled-product-discount/N', 'PATCH /api/vN/admin/voucher-campaigns/N'],
    json_encode([$cree['status'], $cree['body']['error'] ?? null, $ordre]));
check('bons TFBuddy : la promotion vient de la ligne Prix (produit ERP, −15 %, tout le réseau, plafond par ticket, fin de l\'offre)',
    ($promoEnvoyee['activation_mode'] ?? '') === 'VOUCHER_ONLY' && ($promoEnvoyee['status'] ?? '') === 'INACTIVE'
        && ($promoEnvoyee['reward_product_ids'] ?? []) === [99602] && ($promoEnvoyee['discount_type'] ?? '') === 'PERCENTAGE_DISCOUNT'
        && (float) ($promoEnvoyee['discount_value'] ?? 0) === 15.0 && ($promoEnvoyee['shop_scope_type'] ?? '') === 'ALL_SHOPS'
        && ($promoEnvoyee['max_applications_per_transaction'] ?? 0) === 4 && ($promoEnvoyee['valid_to'] ?? '') === '2026-12-31 23:59:00',
    json_encode($promoEnvoyee));
check('bons TFBuddy : la campagne de bons — code commun, sans date de début, limite totale',
    ($campEnvoyee['code_type'] ?? '') === 'SHARED' && ($campEnvoyee['shared_code'] ?? '') === 'NOEL15' && ($campEnvoyee['status'] ?? '') === 'DRAFT'
        && array_key_exists('valid_from', $campEnvoyee) && $campEnvoyee['valid_from'] === null && ($campEnvoyee['usage_limit_total'] ?? 0) === 500,
    json_encode($campEnvoyee));
check('bons TFBuddy : relu actif et complet, avec ses utilisations', ($cree['body']['data']['status'] ?? '') === 'ACTIVE' && ($cree['body']['data']['complete'] ?? false) === true
    && ($cree['body']['data']['sharedCode'] ?? '') === 'NOEL15' && ($cree['body']['data']['redemptions'] ?? 0) === 3, json_encode($cree['body']['data'] ?? null));
$erpV['calls'] = [];
$uniques = call($evRouter, 'POST', $EV, [], ['offerItemId' => $praline, 'codeType' => 'UNIQUE', 'count' => 250, 'prefix' => 'reve-']);
$gen = array_values(array_filter($erpV['calls'], static fn ($c) => str_ends_with($c[1], '/codes/generate')));
$bxgy = $erpV['calls'][0][2] ?? [];
check('bons TFBuddy : codes uniques — offre liée (2 achetés + 1 offert), 250 codes en lots de 100, laissé en brouillon',
    $uniques['status'] === 201 && array_column(array_column($gen, 2), 'count') === [100, 100, 50] && ($gen[0][2]['prefix'] ?? '') === 'REVE-'
        && ($bxgy['trigger']['quantity'] ?? 0) === 2 && ($bxgy['reward']['quantity'] ?? 0) === 1 && ($bxgy['reward']['type'] ?? '') === 'FREE'
        && ($uniques['body']['data']['status'] ?? '') === 'DRAFT' && ($uniques['body']['data']['codesTotal'] ?? 0) === 250,
    json_encode([$uniques['status'], $uniques['body']['error'] ?? null, $uniques['body']['data']['codesTotal'] ?? null]));
$idU = (int) ($uniques['body']['data']['id'] ?? 0);
$act = call($evRouter, 'PATCH', $EV . '/' . $idU, [], ['status' => 'ACTIVE']);
$sus = call($evRouter, 'PATCH', $EV . '/' . $idU, [], ['status' => 'INACTIVE']);
check('bons TFBuddy : activer puis suspendre un bon à codes uniques (l\'ERP refuse /status pour eux : repli sur la fiche)',
    $act['status'] === 200 && ($act['body']['data']['status'] ?? '') === 'ACTIVE' && $sus['status'] === 200 && ($sus['body']['data']['status'] ?? '') === 'INACTIVE',
    json_encode([$act['body']['error'] ?? null, $sus['body']['error'] ?? null]));
$sus2 = call($evRouter, 'PATCH', $EV . '/' . $idU, [], ['status' => 'INACTIVE']);
check('bons TFBuddy : suspendre deux fois revient au même (idempotent)',
    $sus2['status'] === 200 && ($sus2['body']['data']['status'] ?? '') === 'INACTIVE', json_encode($sus2['body']['error'] ?? null));
check('bons TFBuddy : statut inconnu (422), bon inconnu (404)', call($evRouter, 'PATCH', $EV . '/' . $idU, [], ['status' => 'SUPPRIME'])['status'] === 422
    && call($evRouter, 'PATCH', $EV . '/999999', [], ['status' => 'ACTIVE'])['status'] === 404);
$erpV['refusePromo'] = true; $avantRefus = count($erpV['vcs']);
$refuse = call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco]);
check('bons TFBuddy : l\'ERP refuse la promotion — 422 avec sa raison, pas de campagne de bons, rien de gardé',
    $refuse['status'] === 422 && str_contains((string) ($refuse['body']['error']['message'] ?? ''), 'INVALID_PROMOTION_DATA') && count($erpV['vcs']) === $avantRefus
        && (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign_erp_voucher WHERE campaign_id = ' . $noel)->fetchColumn() === 2,
    json_encode($refuse['body']));
$erpV['refusePromo'] = false;
$liste = call($evRouter, 'GET', $EV)['body']['data']['vouchers'] ?? [];
check('bons TFBuddy : la campagne relit ses deux bons dans l\'ERP', count($liste) === 2 && array_column($liste, 'codeType') === ['UNIQUE', 'SHARED']);
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
check('bons TFBuddy : franchisé, lecture sans écriture sur une campagne réseau (403)',
    (call($evRouter, 'GET', $EV)['body']['data']['canEdit'] ?? true) === false && call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco])['status'] === 403);
check('bons TFBuddy : franchisé, campagne locale d\'une autre boutique invisible (404)',
    call($evRouter, 'GET', '/api/v1/marketing/campaigns/11/erp-vouchers')['status'] === 404
        && call($evRouter, 'POST', '/api/v1/marketing/campaigns/11/erp-vouchers', [], ['offerItemId' => $choco])['status'] === 404);
AuthContext::set(1, 'BRAND_ADMIN', 1);
\Marketing\Support\Env::set('MAR_ERP_API_BASE', null);
$sansErp = call($evRouter, 'GET', $EV);
check('bons TFBuddy : sans ERP configuré, la lecture le dit et la création répond 503',
    ($sansErp['body']['data']['configured'] ?? true) === false && call($evRouter, 'POST', $EV, [], ['offerItemId' => $choco])['status'] === 503);
\Marketing\Support\Env::set('MAR_ERP_API_BASE', $baseErpAvant === false ? null : $baseErpAvant);
$pdo->exec('DELETE FROM mar_campaign_erp_voucher WHERE campaign_id = ' . $noel);

// --- Promotions de l'ERP (route erp-promotions) ---------------------------
// La lecture passe par l'API de l'ERP. Les corps rendus par le transport sont
// les exemples que le swagger de l'ERP documente lui-même (BundlePromotionWrite,
// QuantityPromotionWrite), dans l'enveloppe de liste qu'il décrit pour ces
// routes ({items, pagination}) : rien n'est inventé sur la forme d'une
// promotion. Les familles sans exemple documenté répondent une liste vide, ou
// le refus 403 que le swagger documente (« Requires MENU.BUNDLE.MANAGE »).
echo "\nPromotions de l'ERP\n";

$swaggerErp = json_decode((string) file_get_contents(__DIR__ . '/../../swagger'), true);
$exempleErp = static fn (string $schema): array => (array) ($swaggerErp['components']['schemas'][$schema]['example'] ?? []);
$bundleDoc   = $exempleErp('BundlePromotionWrite');
$quantiteDoc = $exempleErp('QuantityPromotionWrite');
check('le swagger de l\'ERP documente les deux exemples lus', $bundleDoc !== [] && $quantiteDoc !== []);

$appelsErp = [];
$transportPromos = static function (string $url, array $entetes, int $delai, string $methode = 'GET', ?string $corps = null) use (&$appelsErp, $bundleDoc, $quantiteDoc): array {
    $appelsErp[] = $methode . ' ' . $url;
    $chemin = (string) parse_url($url, PHP_URL_PATH);
    $liste  = static fn (array $items): array => [200, (string) json_encode([
        'items'      => $items,
        'pagination' => ['page' => 1, 'limit' => 100, 'total' => count($items), 'pages' => 1],
    ])];

    return match ($chemin) {
        '/api/v1/admin/promotions/bundles'           => $liste([['id' => 1] + $bundleDoc]),
        '/api/v1/admin/promotions/bundles/1'         => [200, (string) json_encode(['data' => ['id' => 1] + $bundleDoc])],
        '/api/v1/admin/promotions/quantity'          => $liste([['id' => 2] + $quantiteDoc]),
        '/api/v1/admin/promotions/quantity/2'        => [200, (string) json_encode(['data' => ['id' => 2] + $quantiteDoc])],
        '/api/v1/admin/promotions/buy-x-get-y',
        '/api/v1/admin/promotions/scheduled-product-discount' => $liste([]),
        '/api/v1/admin/voucher-campaigns'            => [403, (string) json_encode(['status' => 'error', 'description' => 'Requires MENU.BUNDLE.MANAGE'])],
        default                                      => [404, ''],
    };
};
$controleurPromos = new \Marketing\Controller\ErpPromotionController(new \Marketing\Service\ErpPromotionService(
    new \Marketing\Repository\ErpPromotionRepository(new \Marketing\Support\ErpClient($transportPromos))
));
$lirePromos = static fn (array $query = []): array => $avecErp(
    $transportPromos,
    static fn () => $controleurPromos->index(new Request('GET', '/api/v1/marketing/erp-promotions', $query))
);

AuthContext::set(1, 'BRAND_ADMIN', 1);
$response = $lirePromos();
$corps = $response['body'] ?? [];
$parId = array_column($corps['data'] ?? [], null, 'id');
check('erp-promotions : 200, enveloppe du standard', $response['status'] === 200 && ($corps['success'] ?? null) === true
    && isset($corps['meta']['requestId'], $corps['meta']['pagination'], $corps['meta']['sources']), json_encode($corps['meta'] ?? null));
check('erp-promotions : le bundle documenté, prix en centimes', ($parId['bundle-1']['mechanic']['priceCents'] ?? null) === 1290
    && ($parId['bundle-1']['mechanic']['currency'] ?? null) === 'EUR' && ($parId['bundle-1']['name'] ?? '') === 'Breakfast bundle',
    json_encode($parId['bundle-1'] ?? null));
check('erp-promotions : sa composition, produit ERP et quantité', ($parId['bundle-1']['products'][0]['erpProductId'] ?? null) === 11
    && ($parId['bundle-1']['products'][0]['quantity'] ?? null) == 1 && ($parId['bundle-1']['products'][0]['role'] ?? '') === 'item');
check('erp-promotions : la promotion de quantité documentée (3 pour 2)', ($parId['quantity-2']['mechanic']['mechanism'] ?? '') === 'BUY_X_GET_Y'
    && ($parId['quantity-2']['mechanic']['quantity'] ?? null) === 3 && ($parId['quantity-2']['mechanic']['freeQuantity'] ?? null) === 1,
    json_encode($parId['quantity-2']['mechanic'] ?? null));
check('erp-promotions : sans magasins désignés, la promotion vaut pour le réseau', ($parId['bundle-1']['shopScope'] ?? '') === 'all');
check('erp-promotions : camelCase, aucun champ brut de l\'ERP', !array_key_exists('shop_ids', $parId['bundle-1'] ?? [])
    && !array_key_exists('bundle_promotion', $parId['bundle-1'] ?? []) && array_key_exists('validFrom', $parId['bundle-1'] ?? []));
check('erp-promotions : le détail d\'une promotion est lu, pas celui d\'une campagne de bons',
    in_array('GET https://erp.test/api/v1/admin/promotions/bundles/1', $appelsErp, true)
    && count(array_filter($appelsErp, static fn ($a) => str_contains($a, 'voucher-campaigns/'))) === 0, json_encode($appelsErp));
$sources = $corps['meta']['sources'] ?? [];
check('erp-promotions : une famille refusée par l\'ERP est dite, les autres passent',
    ($sources['voucher']['ok'] ?? null) === false && str_contains((string) ($sources['voucher']['error'] ?? ''), 'MENU.BUNDLE.MANAGE')
    && ($sources['bundle']['ok'] ?? null) === true && ($sources['bundle']['count'] ?? null) === 1
    && ($sources['buyXGetY']['ok'] ?? null) === true && ($sources['buyXGetY']['count'] ?? null) === 0, json_encode($sources));

$response = $lirePromos(['perPage' => 1]);
check('erp-promotions : pagination (perPage = 1)', count($response['body']['data'] ?? []) === 1
    && ($response['body']['meta']['pagination']['total'] ?? null) === 2 && ($response['body']['meta']['pagination']['totalPages'] ?? null) === 2);
$response = $lirePromos(['perPage' => 1, 'page' => 2]);
check('erp-promotions : la deuxième page porte la promotion de quantité', ($response['body']['data'][0]['id'] ?? '') === 'quantity-2');
$response = $lirePromos(['perPage' => 500]);
check('erp-promotions : perPage ramené à 100', ($response['body']['meta']['pagination']['perPage'] ?? null) === 100);
$response = $lirePromos(['family' => 'quantity']);
check('erp-promotions : filtre par famille', array_column($response['body']['data'] ?? [], 'id') === ['quantity-2']
    && array_keys($response['body']['meta']['sources'] ?? []) === ['quantity']);
foreach ([['family' => 'remise'], ['tri' => 'nom'], ['page' => 0]] as $mauvais) {
    $response = $lirePromos($mauvais);
    check('erp-promotions : 422 sur ' . json_encode($mauvais), $response['status'] === 422
        && ($response['body']['error']['code'] ?? '') === 'VALIDATION_FAILED' && ($response['body']['success'] ?? null) === false);
}
$premiere = json_encode($lirePromos()['body']['data'] ?? null);
check('erp-promotions : deux lectures, la même réponse', $premiere === json_encode($lirePromos()['body']['data'] ?? null));

// Le périmètre : un franchisé voit le réseau et ses boutiques, pas celles des autres.
$pdo->exec('UPDATE mar_shop SET erp_shop_id = 4 WHERE id = 1');
$pdo->exec('UPDATE mar_shop SET erp_shop_id = 9 WHERE id = 2');
try {
    AuthContext::set(77, 'FRANCHISEE', 1, [1]);
    $visibles = (new \Marketing\Repository\ErpPromotionRepository())->visibleTo(AuthContext::current(), [
        ['id' => 'reseau', 'shopScope' => 'all', 'shops' => []],
        ['id' => 'namur', 'shopScope' => 'selected', 'shops' => [['erpShopId' => 4, 'name' => null]]],
        ['id' => 'uccle', 'shopScope' => 'selected', 'shops' => [['erpShopId' => 9, 'name' => null]]],
    ]);
    check('erp-promotions : un franchisé ne voit pas la promotion d\'une autre boutique', array_column($visibles, 'id') === ['reseau', 'namur'],
        json_encode(array_column($visibles, 'id')));
    check('erp-promotions : les promotions documentées (réseau) restent visibles au franchisé', count($lirePromos()['body']['data'] ?? []) === 2);
    AuthContext::set(1, 'BRAND_ADMIN', 1);
    check('erp-promotions : la marque voit tout', count((new \Marketing\Repository\ErpPromotionRepository())->visibleTo(AuthContext::current(), [
        ['id' => 'uccle', 'shopScope' => 'selected', 'shops' => [['erpShopId' => 9, 'name' => null]]],
    ])) === 1);
    $pdo->exec("INSERT INTO mar_offer_item (category, sku_ref, name, is_active) VALUES ('produit', 'erp-11', 'Croissant beurre', 1)");
    $response = $lirePromos();
    check('erp-promotions : le nom du produit vient du catalogue repris', (array_column($response['body']['data'] ?? [], null, 'id')['bundle-1']['products'][0]['name'] ?? '') === 'Croissant beurre');
} finally {
    $pdo->exec("DELETE FROM mar_offer_item WHERE sku_ref = 'erp-11'");
    $pdo->exec('UPDATE mar_shop SET erp_shop_id = NULL WHERE id IN (1, 2)');
    AuthContext::set(1, 'BRAND_ADMIN', 1);
}

// Par le routeur : sans adresse d'ERP, rien n'est tenté et chaque famille le dit ; sans identité, 401.
$response = call($router, 'GET', '/api/v1/marketing/erp-promotions');
check('erp-promotions : sans ERP configuré, 200 et la raison par famille', $response['status'] === 200
    && ($response['body']['data'] ?? null) === [] && ($response['body']['meta']['configured'] ?? null) === false
    && str_contains((string) ($response['body']['meta']['sources']['bundle']['error'] ?? ''), 'MAR_ERP_API_BASE'));
AuthContext::clear();
check('erp-promotions : 401 sans identité', call($router, 'GET', '/api/v1/marketing/erp-promotions')['status'] === 401);
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Connexion de l'ERP par téléphone et mot de passe -----------------------
// Le corps de connexion suit le schéma documenté (AuthUserLoginSuccess :
// access_token, refresh_token, token_type, session_id, expires_in).
$avecCompte = static function (callable $essai) {
    \Marketing\Support\Env::set('MAR_ERP_API_PHONE', '+32470000000');
    \Marketing\Support\Env::set('MAR_ERP_API_PASSWORD', 'secret-de-test');
    \Marketing\Support\ErpClient::forgetSession();
    try {
        return $essai();
    } finally {
        \Marketing\Support\Env::set('MAR_ERP_API_PHONE', null);
        \Marketing\Support\Env::set('MAR_ERP_API_PASSWORD', null);
        \Marketing\Support\ErpClient::forgetSession();
    }
};
$journal = [];
$jetons = 0;
$transportCompte = static function (string $url, array $entetes, int $delai, string $methode = 'GET', ?string $corps = null) use (&$journal, &$jetons): array {
    $auth = array_values(array_filter($entetes, static fn ($e) => str_starts_with($e, 'Authorization: ')))[0] ?? '';
    $journal[] = [$methode, (string) parse_url($url, PHP_URL_PATH), $auth, $corps];
    if ($methode === 'POST') {
        $jetons++;
        return [200, (string) json_encode(['access_token' => 'jeton-' . $jetons, 'refresh_token' => 'r', 'token_type' => 'Bearer', 'session_id' => 1, 'expires_in' => 1800])];
    }
    // Le premier jeton est refusé comme périmé : une seule reconnexion doit suivre.
    return $auth === 'Authorization: Bearer jeton-1' ? [401, ''] : [200, '{"items":[],"pagination":{"page":1,"limit":100,"total":0,"pages":1}}'];
};
$avecCompte(static fn () => $avecErp($transportCompte, static fn ($client) => $client->get('/api/v1/admin/promotions/bundles')));
check('connexion ERP : POST /api/v1/admin/auth/login avec le téléphone et le mot de passe',
    ($journal[0][0] ?? '') === 'POST' && ($journal[0][1] ?? '') === '/api/v1/admin/auth/login'
    && json_decode((string) ($journal[0][3] ?? ''), true) === ['phone' => '+32470000000', 'password' => 'secret-de-test'], json_encode($journal[0] ?? null));
check('connexion ERP : le jeton part en Bearer, un 401 relance UNE connexion',
    array_map(static fn ($l) => $l[0] . ' ' . $l[2], $journal) === ['POST ', 'GET Authorization: Bearer jeton-1', 'POST ', 'GET Authorization: Bearer jeton-2'],
    json_encode(array_map(static fn ($l) => $l[0] . ' ' . $l[2], $journal)));
$message = '';
try {
    $avecCompte(static fn () => $avecErp(static fn (): array => [401, '{"status":"error","description":"INVALID_CREDENTIALS"}'], static fn ($client) => $client->get('/api/v1/shops')));
} catch (RuntimeException $echec) {
    $message = $echec->getMessage();
}
check('connexion ERP : un compte refusé dit quoi vérifier', str_contains($message, 'MAR_ERP_API_PHONE'), $message);

// --- Connexion au module par les identifiants de l'ERP ----------------------
// Le module sert au pilotage de la marque : il s'ouvre avec un compte réseau
// de l'ERP (réalm admin), et avec lui seulement. La réponse de connexion suit le
// schéma documenté (AuthUserLoginSuccess). Le module ne garde ni mot de passe ni
// jeton de l'ERP.
echo "\nConnexion par l'ERP\n";
$envAvant = [];
foreach (['MAR_SESSION_SECRET', 'MAR_SERVICE_TOKEN', 'MAR_ERP_AUTH_BASE', 'MAR_DEV_AUTH', 'MAR_DEV_USER_ID'] as $cle) {
    $valeur = getenv($cle);
    $envAvant[$cle] = $valeur === false ? null : $valeur;
}
\Marketing\Support\Env::set('MAR_SESSION_SECRET', str_repeat('s', 40));
\Marketing\Support\Env::set('MAR_ERP_AUTH_BASE', 'https://erp.test/');
\Marketing\Support\Env::set('MAR_DEV_AUTH', null);

$jwt = 'en-tete.' . rtrim(strtr(base64_encode('{"sub":"321"}'), '+/', '-_'), '=') . '.signature';
$accepte = static fn (string $jeton): array => [200, (string) json_encode(['access_token' => $jeton, 'refresh_token' => 'r', 'token_type' => 'Bearer', 'session_id' => 1, 'expires_in' => 1800])];
$refuse = static fn (int $code): array => [$code, (string) json_encode(['status' => 'error', 'description' => 'refus'])];
$appelsErp = [];
$seConnecter = static function (callable $repondre, array $corps = ['phone' => '+32 470 12 34 56', 'password' => 'mot-de-passe']) use (&$appelsErp): array {
    $appelsErp = [];
    $transport = static function (string $url, array $entetes, int $delai, string $methode = 'GET', ?string $corps = null) use (&$appelsErp, $repondre): array {
        $appelsErp[] = $methode . ' ' . parse_url($url, PHP_URL_PATH);
        return $repondre($methode . ' ' . parse_url($url, PHP_URL_PATH));
    };
    $controleur = new \Marketing\Controller\SessionController(new \Marketing\Service\LoginService(new \Marketing\Support\ErpClient($transport)));
    return $controleur->open(new Request('POST', '/api/v1/marketing/session', [], $corps));
};
$cookieDe = static function (array $reponse): ?string {
    foreach ($reponse['headers'] ?? [] as $entete) {
        if (preg_match('/^Set-Cookie: mar_session=([^;]*)/', $entete, $trouve) === 1) {
            return $trouve[1];
        }
    }
    return null;
};

$reseau = $seConnecter(static fn (string $appel): array => $appel === 'POST /api/v1/admin/auth/login' ? $accepte($jwt) : [500, '']);
$cookieReseau = (string) $cookieDe($reseau);
$ouvert = \Marketing\Support\Session::open($cookieReseau);
check('connexion : un compte réseau de l\'ERP ouvre le module, cookie HttpOnly signé',
    $reseau['status'] === 200 && ($reseau['body']['role'] ?? '') === 'BRAND_ADMIN' && $cookieReseau !== ''
        && str_contains(implode('|', $reseau['headers'] ?? []), 'HttpOnly') && ($ouvert['role'] ?? '') === 'BRAND_ADMIN' && ($ouvert['user_id'] ?? 0) === 321
        && $appelsErp === ['POST /api/v1/admin/auth/login'],
    json_encode([$reseau['status'], $reseau['body'], $appelsErp]));
check('connexion : le libellé masque le téléphone', ($reseau['body']['label'] ?? '') === '••• 3456 · réseau', (string) ($reseau['body']['label'] ?? ''));

$faux = $seConnecter(static fn (string $appel): array => $refuse(401));
check('connexion : mot de passe faux → 401, sans cookie',
    $faux['status'] === 401 && $cookieDe($faux) === null && $appelsErp === ['POST /api/v1/admin/auth/login'], json_encode([$faux['status'], $appelsErp]));

foreach ([403 => 'sans appartenance réseau', 409 => 'appartenances ambiguës'] as $code => $cas) {
    $boutique = $seConnecter(static fn (string $appel): array => $refuse($code));
    check('connexion : un compte qui n\'est pas réseau (' . $cas . ') → 403, sans essayer le réalm des boutiques ni poser de cookie',
        $boutique['status'] === 403 && $cookieDe($boutique) === null && $appelsErp === ['POST /api/v1/admin/auth/login']
            && str_contains((string) ($boutique['body']['description'] ?? ''), 'pilotage de la marque'),
        json_encode([$boutique['status'], $boutique['body'], $appelsErp]));
}

$vide = $seConnecter(static fn (string $appel): array => $accepte($jwt), ['phone' => '+32470', 'password' => '']);
check('connexion : mot de passe vide → 422 sans appeler l\'ERP', $vide['status'] === 422 && $appelsErp === [], json_encode([$vide['status'], $appelsErp]));

\Marketing\Support\Env::set('MAR_SESSION_SECRET', null);
$sansSecret = $seConnecter(static fn (string $appel): array => $accepte($jwt));
check('connexion : sans MAR_SESSION_SECRET → 503, l\'ERP n\'est pas appelé', $sansSecret['status'] === 503 && $appelsErp === [], json_encode([$sansSecret['status'], $appelsErp]));
\Marketing\Support\Env::set('MAR_SESSION_SECRET', str_repeat('s', 40));

// L'identité de chaque requête : jeton de service, puis cookie, puis identité de développement.
$source = \Marketing\Support\Identity::resolve([], ['mar_session' => $cookieReseau]);
check('identité : le cookie d\'un compte réseau donne le réseau',
    $source === 'erp' && AuthContext::current()?->isBrandAdmin() === true && AuthContext::current()?->userId === 321, (string) $source);
[, $signature] = explode('.', $cookieReseau);
$signer = static fn (array $contenu): string => rtrim(strtr(base64_encode((string) json_encode($contenu)), '+/', '-_'), '=');
$falsifie = $signer(['u' => 1, 'r' => 'BRAND_ADMIN', 's' => [], 'l' => 'autre', 'e' => time() + 3600]) . '.' . $signature;
check('identité : un cookie réécrit ne vaut rien',
    \Marketing\Support\Identity::resolve([], ['mar_session' => $falsifie]) === null && AuthContext::current() === null);
$boutiqueSignee = $signer(['u' => 9, 'r' => 'FRANCHISEE', 's' => [1], 'l' => 'x', 'e' => time() + 3600]);
$boutiqueSignee .= '.' . rtrim(strtr(base64_encode(hash_hmac('sha256', $boutiqueSignee, str_repeat('s', 40), true)), '+/', '-_'), '=');
check('identité : même signé, un cookie de boutique n\'ouvre rien (le module est réservé au réseau)',
    \Marketing\Support\Identity::resolve([], ['mar_session' => $boutiqueSignee]) === null && AuthContext::current() === null);
check('identité : un cookie échu ne vaut rien', \Marketing\Support\Session::open($cookieReseau, time() + \Marketing\Support\Session::TTL + 5) === null);

\Marketing\Support\Env::set('MAR_SERVICE_TOKEN', str_repeat('t', 48));
check('identité : le jeton de service d\'un autre module donne le réseau',
    \Marketing\Support\Identity::resolve(['HTTP_X_MARKETING_SERVICE' => str_repeat('t', 48)], []) === 'service' && AuthContext::current()?->isBrandAdmin() === true);
\Marketing\Support\Env::set('MAR_DEV_AUTH', '1');
\Marketing\Support\Env::set('MAR_DEV_USER_ID', '5');
check('identité : un jeton de service faux ne retombe sur rien, même en développement',
    \Marketing\Support\Identity::resolve(['HTTP_X_MARKETING_SERVICE' => 'faux'], ['mar_session' => $cookieReseau]) === null && AuthContext::current() === null);
check('identité : en développement, une session ERP prime sur l\'identité de développement',
    \Marketing\Support\Identity::resolve([], ['mar_session' => $cookieReseau]) === 'erp' && AuthContext::current()?->userId === 321);
check('identité : sans cookie, l\'identité de développement ne vaut que si MAR_DEV_AUTH=1',
    \Marketing\Support\Identity::resolve([], []) === 'dev' && AuthContext::current()?->userId === 5);
\Marketing\Support\Env::set('MAR_DEV_AUTH', null);
check('identité : sans MAR_DEV_AUTH ni session, aucune identité', \Marketing\Support\Identity::resolve([], []) === null && AuthContext::current() === null);

// Par le routeur : ouvrir et fermer la session sont publics ; le reste reste fermé.
AuthContext::clear();
\Marketing\Support\Env::set('MAR_ERP_AUTH_BASE', null);
$parRouteur = call($router, 'POST', '/api/v1/marketing/session', [], ['phone' => '+32470', 'password' => 'x']);
$fermeture = call($router, 'DELETE', '/api/v1/marketing/session');
check('session : la connexion est publique (ici 503 : ERP non configuré), la fermeture efface le cookie',
    $parRouteur['status'] === 503 && $fermeture['status'] === 200 && str_contains(implode('|', $fermeture['headers'] ?? []), 'mar_session=; Path=/; Max-Age=0'),
    json_encode([$parRouteur['status'], $fermeture['headers'] ?? null]));
check('session : sans identité, les autres routes restent fermées', call($router, 'GET', '/api/v1/marketing/campaigns')['status'] === 401);

foreach ($envAvant as $cle => $valeur) {
    \Marketing\Support\Env::set($cle, $valeur);
}
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Assistant : supports, cible, message --------------------------------
// L'assistant réunit tous les supports (en boutique, extérieur, réseaux sociaux,
// Google, direct) : chaque support garde sa quantité et ses précisions ; la cible
// vise des segments du CRM ; le message (titre, accroche, offre, appel à l'action)
// s'écrit par langue.
echo "\nAssistant : supports, cible, message\n";
AuthContext::set(1, 'BRAND_ADMIN', 1);
$refsA = call($router, 'GET', '/api/v1/marketing/references')['body'];
$canaux = array_column($refsA['channels'], null, 'code');
check('référentiel : chaque support a sa famille dans l\'assistant ; les payants et leur délai sont dits',
    count(array_filter($refsA['channels'], static fn (array $c): bool => !in_array($c['grp'], ['boutique', 'exterieur', 'social', 'google', 'direct'], true))) === 0
        && (int) $canaux['meta_ads']['is_paid'] === 1 && (int) $canaux['posts_meta']['is_paid'] === 0
        && (int) $canaux['leaflet']['lead_days'] === 21 && $canaux['leaflet']['editor'] === 'brochures'
        && $canaux['affichage']['label'] === 'Bâches extérieures' && $canaux['affichage']['family'] === 'PHYSIQUE',
    json_encode(array_column($refsA['channels'], 'grp', 'code')));
$segments = array_column($refsA['crmSegments'] ?? [], 'id', 'code');
check('référentiel : les segments du CRM sont proposés à la cible', isset($segments['vip'], $segments['dormants']));

$assistant = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name'        => 'Assistant unifié',
    'status_code' => 'draft',
    'scope'       => 'RESEAU',
    'type_id'     => (int) $types['ouverture']['id'],
    'channels'    => [
        ['channel_id' => (int) $canaux['affiches']['id'], 'quantity' => 29, 'details' => '  A1 ×6 · A2 ×9 · A3 ×14 — pose J-3  ', 'is_enabled' => false],
        ['channel_id' => (int) $canaux['meta_ads']['id'], 'budget_amount' => 300, 'quantity' => 0, 'details' => ''],
    ],
    'segment_ids' => [(int) $segments['vip'], (int) $segments['dormants'], 999999],
    'messages'    => [
        ['lang' => 'fr', 'title' => 'Les bûches de fêtes', 'hook' => 'à partager, à offrir', 'offer_line' => '−10 % en précommande', 'cta' => 'Commander'],
        ['lang' => 'nl', 'title' => '', 'hook' => ' ', 'offer_line' => '', 'cta' => ''],
        ['lang' => 'de', 'title' => 'Weihnachten'],
    ],
]);
$idAssistant = (int) ($assistant['body']['inserted_id'] ?? 0);
$etatA = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $idAssistant))['body'];
$parCanal = array_column($etatA['channels'] ?? [], null, 'channel_id');
check('brouillon : un support garde sa quantité et ses précisions (nettoyées) ; une quantité nulle et des précisions vides restent vides',
    $idAssistant > 0 && (int) ($parCanal[(int) $canaux['affiches']['id']]['quantity'] ?? 0) === 29
        && ($parCanal[(int) $canaux['affiches']['id']]['details'] ?? '') === 'A1 ×6 · A2 ×9 · A3 ×14 — pose J-3'
        && array_key_exists('quantity', $parCanal[(int) $canaux['meta_ads']['id']] ?? []) && $parCanal[(int) $canaux['meta_ads']['id']]['quantity'] === null
        && $parCanal[(int) $canaux['meta_ads']['id']]['details'] === null,
    json_encode($etatA['channels'] ?? null));
check('brouillon : la cible vise les segments connus (un identifiant inconnu est ignoré, pas une erreur)',
    ($etatA['segment_ids'] ?? null) === array_values(array_map('intval', [$segments['vip'], $segments['dormants']])) || ($etatA['segment_ids'] ?? null) === array_values(array_map('intval', [$segments['dormants'], $segments['vip']])),
    json_encode($etatA['segment_ids'] ?? null));
check('brouillon : le message revient par langue ; une langue vide ou inconnue n\'est pas gardée',
    count($etatA['messages'] ?? []) === 1 && ($etatA['messages'][0]['lang'] ?? '') === 'fr' && ($etatA['messages'][0]['title'] ?? '') === 'Les bûches de fêtes'
        && ($etatA['messages'][0]['cta'] ?? '') === 'Commander',
    json_encode($etatA['messages'] ?? null));

$repris = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idAssistant), [], [
    'name'        => 'Assistant unifié',
    'channels'    => [['channel_id' => (int) $canaux['affiches']['id'], 'quantity' => 30, 'details' => 'A2 ×10']],
    'segment_ids' => [(int) $segments['vip']],
    'messages'    => [
        ['lang' => 'fr', 'title' => 'Bûches de fêtes', 'hook' => '', 'offer_line' => '', 'cta' => 'Je précommande'],
        ['lang' => 'nl', 'title' => 'Feestelijke stronken', 'hook' => '', 'offer_line' => '', 'cta' => 'Bestellen'],
    ],
]);
$deux = call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idAssistant), [], [
    'name'        => 'Assistant unifié',
    'channels'    => [['channel_id' => (int) $canaux['affiches']['id'], 'quantity' => 30, 'details' => 'A2 ×10']],
    'segment_ids' => [(int) $segments['vip']],
    'messages'    => [
        ['lang' => 'fr', 'title' => 'Bûches de fêtes', 'hook' => '', 'offer_line' => '', 'cta' => 'Je précommande'],
        ['lang' => 'nl', 'title' => 'Feestelijke stronken', 'hook' => '', 'offer_line' => '', 'cta' => 'Bestellen'],
    ],
]);
$etatB = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $idAssistant))['body'];
check('reprise : supports, segments et messages réécrits à l\'identique, rejouée sans doublon',
    in_array($repris['status'], [200, 204], true) && in_array($deux['status'], [200, 204], true)
        && count($etatB['channels'] ?? []) === 1 && (int) ($etatB['channels'][0]['quantity'] ?? 0) === 30
        && ($etatB['segment_ids'] ?? null) === [(int) $segments['vip']]
        && count($etatB['messages'] ?? []) === 2 && ($etatB['messages'][1]['title'] ?? '') === 'Feestelijke stronken'
        && (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign_message WHERE campaign_id = ' . $idAssistant)->fetchColumn() === 2,
    json_encode([$repris['status'], $etatB['messages'] ?? null, $etatB['segment_ids'] ?? null]));
call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $idAssistant));
check('supprimer la campagne emporte son message et sa cible',
    (int) $pdo->query('SELECT COUNT(*) FROM mar_campaign_message WHERE campaign_id = ' . $idAssistant)->fetchColumn() === 0
        && (int) $pdo->query('SELECT COUNT(*) FROM mar_crm_campaign_target WHERE campaign_id = ' . $idAssistant)->fetchColumn() === 0);

// --- Bâches et affiches des boutiques (mar_shop_support) ------------------------
echo "\nBâches et affiches des boutiques\n";
$pdo->exec('DELETE FROM mar_shop_support');
$boutiqueA = (int) $pdo->query('SELECT id FROM mar_shop ORDER BY id LIMIT 1')->fetchColumn();
$boutiqueB = (int) $pdo->query('SELECT id FROM mar_shop ORDER BY id LIMIT 1 OFFSET 1')->fetchColumn();
$declares = ['supports' => [
    ['kind' => 'bache', 'placement' => 'Façade', 'widthCm' => 300, 'heightCm' => 100, 'quantity' => 1, 'material' => 'pvc', 'fixing' => 'oeillets'],
    ['kind' => 'bache', 'placement' => 'Clôture du parking', 'widthCm' => 200, 'heightCm' => 80, 'quantity' => 2, 'material' => 'mesh'],
    ['kind' => 'affiche', 'paperFormat' => 'A2', 'quantity' => 3],
    ['kind' => 'affiche', 'paperFormat' => 'A3', 'quantity' => 4, 'note' => 'Vitrine côté rue'],
]];
AuthContext::clear();
check('supports des boutiques : 401 sans identité', call($router, 'GET', '/api/v1/marketing/shop-supports')['status'] === 401);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$pose  = call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], $declares);
$encore = call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], $declares);
$autre = call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueB, [], ['supports' => [['kind' => 'affiche', 'paperFormat' => 'A1', 'quantity' => 2]]]);
$liste = call($router, 'GET', '/api/v1/marketing/shop-supports');
check('déclaration des supports d\'une boutique : enregistrée, rejouée sans doublon, relue en camelCase avec la boutique',
    $pose['status'] === 200 && $encore['status'] === 200 && count($encore['body']['data'] ?? []) === 4
        && ($liste['body']['meta']['pagination']['total'] ?? 0) === 5
        && (array_values(array_filter($encore['body']['data'] ?? [], static fn (array $x): bool => $x['placement'] === 'Façade'))[0]['widthCm'] ?? null) === 300
        && ($encore['body']['data'][0]['shopName'] ?? '') !== ''
        && $autre['status'] === 200,
    json_encode([$pose['status'], $pose['body']['error'] ?? null, $liste['body']['meta'] ?? null]));
check('filtres : par boutique et par nature',
    (call($router, 'GET', '/api/v1/marketing/shop-supports', ['filter' => ['shop' => ['eq' => (string) $boutiqueB]]])['body']['meta']['pagination']['total'] ?? 0) === 1
        && (call($router, 'GET', '/api/v1/marketing/shop-supports', ['filter' => ['kind' => ['eq' => 'bache']]])['body']['meta']['pagination']['total'] ?? 0) === 2);
$refusS = [
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [['kind' => 'bache', 'widthCm' => 300]]])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [['kind' => 'affiche', 'paperFormat' => 'A0']]])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [['kind' => 'affiche', 'paperFormat' => 'A2', 'widthCm' => 40]]])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [['kind' => 'bache', 'widthCm' => 300, 'heightCm' => 100, 'material' => 'carton']]])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [['kind' => 'kakemono']]])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => 'tout'])['status'],
    call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueA, [], ['supports' => [], 'pirate' => 1])['status'],
    call($router, 'GET', '/api/v1/marketing/shop-supports', ['filter' => ['kind' => ['eq' => 'kakemono']]])['status'],
];
check('supports refusés (422), rien d\'écrit : hauteur manquante, format hors liste, dimension sur une affiche, matière inconnue, nature inconnue, liste attendue, champ inconnu, filtre hors liste',
    array_unique($refusS) === [422] && (int) $pdo->query('SELECT COUNT(*) FROM mar_shop_support WHERE shop_id = ' . $boutiqueA)->fetchColumn() === 4,
    json_encode($refusS));
check('boutique inconnue : 404', call($router, 'PUT', '/api/v1/marketing/shop-supports/999999', [], $declares)['status'] === 404);
AuthContext::set(77, 'FRANCHISEE', 1, [$boutiqueB]);
$vue = call($router, 'GET', '/api/v1/marketing/shop-supports');
check('une boutique ne voit que ses supports, et ne les modifie pas (403) ; ceux d\'une autre boutique ne lui sont pas montrés',
    ($vue['body']['meta']['pagination']['total'] ?? -1) === 1 && ($vue['body']['data'][0]['shopId'] ?? '') === (string) $boutiqueB
        && call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueB, [], $declares)['status'] === 403
        && (call($router, 'GET', '/api/v1/marketing/shop-supports', ['filter' => ['shop' => ['eq' => (string) $boutiqueA]]])['body']['meta']['pagination']['total'] ?? -1) === 0);
AuthContext::set(1, 'BRAND_ADMIN', 1);
check('pagination : perPage ramené à 100, page 2 vide',
    (call($router, 'GET', '/api/v1/marketing/shop-supports', ['perPage' => '500'])['body']['meta']['pagination']['perPage'] ?? 0) === 100
        && count(call($router, 'GET', '/api/v1/marketing/shop-supports', ['page' => '2'])['body']['data'] ?? [1]) === 0);
$vide = call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $boutiqueB, [], ['supports' => []]);
check('une liste vide retire les supports de la boutique', $vide['status'] === 200 && ($vide['body']['data'] ?? [1]) === []);
$pdo->exec('DELETE FROM mar_shop_support');

// --- Variables et clés du module (mar_variable, mar_keys) -------------------
// Le module se déplace avec ses réglages : ils vivent en base, les secrets chiffrés
// par une clé maîtresse gardée hors de la base. Le test ne touche qu'aux noms qu'il
// pose, et les retire en partant.
echo "\nVariables et clés\n";
$nomsTest = ['MAR_ERP_API_TIMEOUT', 'MAR_WEBSHOP_API_BASE', 'MAR_WEBSHOP_API_TOKEN', 'MAR_ERP_API_TOKEN', 'MAR_ERP_API_PASSWORD', 'MAR_SESSION_SECRET', 'MAR_TEST_LIBRE'];
$purgerReglages = static function () use ($pdo, &$nomsTest): void {
    $liste = implode(',', array_map([$pdo, 'quote'], $nomsTest));
    $pdo->exec("DELETE FROM mar_variable WHERE module = 'marketing' AND name IN ($liste)");
    $pdo->exec("DELETE FROM mar_keys WHERE module = 'marketing' AND name IN ($liste)");
    \Marketing\Support\Config::forget();
    \Marketing\Support\Keys::forget();
};
$purgerReglages();
$envReglages = [];
foreach (array_merge($nomsTest, ['MAR_KEYS_FILE']) as $cle) { $envReglages[$cle] = \Marketing\Support\Env::get($cle); }
$dossierCles = sys_get_temp_dir() . '/mar_keys_' . getmypid();
@mkdir($dossierCles, 0700, true);
\Marketing\Support\Env::set('MAR_KEYS_FILE', $dossierCles . '/master.key');
\Marketing\Support\Keys::forget();

\Marketing\Support\Keys::put('MAR_WEBSHOP_API_TOKEN', 'jeton-webshop-secret-123456');
$brut = (string) $pdo->query("SELECT ciphertext FROM mar_keys WHERE module = 'marketing' AND name = 'MAR_WEBSHOP_API_TOKEN'")->fetchColumn();
\Marketing\Support\Keys::forget();
check('une clé est chiffrée en base (rien du clair), la clé maîtresse créée hors de la base en 0640, et elle se relit',
    $brut !== '' && !str_contains($brut, 'jeton-webshop') && preg_match('/^(x1|g1):/', $brut) === 1
        && is_file($dossierCles . '/master.key') && (fileperms($dossierCles . '/master.key') & 0777) === 0640
        && \Marketing\Support\Keys::get('MAR_WEBSHOP_API_TOKEN') === 'jeton-webshop-secret-123456');
check('une valeur chiffrée recopiée sous un autre nom ne se déchiffre pas',
    \Marketing\Support\Keys::decrypt($brut, 'marketing', 'MAR_ERP_API_TOKEN') === null && \Marketing\Support\Keys::decrypt($brut, 'social', 'MAR_WEBSHOP_API_TOKEN') === null);

// Avec une autre clé maîtresse, la clé en base est illisible : l'environnement reprend, l'écran le dit.
\Marketing\Support\Env::set('MAR_WEBSHOP_API_TOKEN', 'jeton-du-fichier');
\Marketing\Support\Env::set('MAR_KEYS_FILE', $dossierCles . '/autre.key');
file_put_contents($dossierCles . '/autre.key', base64_encode(random_bytes(32)));
\Marketing\Support\Keys::forget();
$illisible = array_values(array_filter(\Marketing\Support\Keys::describe(), static fn (array $k): bool => $k['name'] === 'MAR_WEBSHOP_API_TOKEN'))[0] ?? [];
check('clé maîtresse différente : la clé en base est signalée illisible, et la valeur du fichier sert en repli',
    ($illisible['readable'] ?? true) === false && \Marketing\Support\Keys::get('MAR_WEBSHOP_API_TOKEN') === 'jeton-du-fichier');
\Marketing\Support\Env::set('MAR_KEYS_FILE', $dossierCles . '/master.key');
\Marketing\Support\Keys::forget();
check('… et redevient lisible avec la bonne clé maîtresse (la base l\'emporte sur le fichier)',
    \Marketing\Support\Keys::get('MAR_WEBSHOP_API_TOKEN') === 'jeton-webshop-secret-123456');

// Les réglages : la base l'emporte sur le fichier ; l'amorçage ne se règle jamais en base.
\Marketing\Support\Env::set('MAR_ERP_API_TIMEOUT', '5');
\Marketing\Support\Config::put('MAR_ERP_API_TIMEOUT', '9');
$enBase = \Marketing\Support\Config::get('MAR_ERP_API_TIMEOUT', '1');
\Marketing\Support\Config::delete('MAR_ERP_API_TIMEOUT');
$apres = \Marketing\Support\Config::get('MAR_ERP_API_TIMEOUT', '1');
$amorce = null;
try { \Marketing\Support\Config::put('MAR_DB_PASSWORD', 'x'); } catch (\RuntimeException $e) { $amorce = $e->getMessage(); }
$devRefuse = null;
try { \Marketing\Support\Config::put('MAR_DEV_AUTH', '1'); } catch (\RuntimeException $e) { $devRefuse = $e->getMessage(); }
check('réglage : la base l\'emporte sur le fichier, retiré le fichier reprend ; l\'accès à la base et l\'identité de développement ne se règlent jamais en base',
    $enBase === '9' && $apres === '5' && $amorce !== null && $devRefuse !== null && \Marketing\Support\Config::get('MAR_DB_NAME') === \Marketing\Support\Env::get('MAR_DB_NAME'));

// Par l'API.
AuthContext::clear();
check('variables et clés : 401 sans identité', call($router, 'GET', '/api/v1/marketing/variables')['status'] === 401 && call($router, 'GET', '/api/v1/marketing/keys')['status'] === 401);
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
check('variables et clés : 403 pour une boutique (lecture comme écriture)',
    call($router, 'GET', '/api/v1/marketing/variables')['status'] === 403 && call($router, 'PUT', '/api/v1/marketing/keys/MAR_ERP_API_TOKEN', [], ['value' => 'x'])['status'] === 403);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$pose = call($router, 'PUT', '/api/v1/marketing/variables/MAR_WEBSHOP_API_BASE', [], ['value' => ' https://webshop.test/api ']);
$ligne = array_values(array_filter($pose['body']['data'] ?? [], static fn (array $v): bool => $v['name'] === 'MAR_WEBSHOP_API_BASE'))[0] ?? [];
check('PUT variable : enregistrée en base (source « base »), valeur nettoyée, relue par le code',
    $pose['status'] === 200 && ($ligne['source'] ?? '') === 'base' && ($ligne['value'] ?? '') === 'https://webshop.test/api'
        && \Marketing\Support\Config::get('MAR_WEBSHOP_API_BASE') === 'https://webshop.test/api');
$refusVar = [
    call($router, 'PUT', '/api/v1/marketing/variables/MAR_DB_PASSWORD', [], ['value' => 'x'])['status'],
    call($router, 'PUT', '/api/v1/marketing/variables/MAR_ERP_API_TOKEN', [], ['value' => 'x'])['status'],
    call($router, 'PUT', '/api/v1/marketing/variables/MAR_TEST_LIBRE', [], ['valeur' => 'x'])['status'],
    call($router, 'PUT', '/api/v1/marketing/variables/MAR_TEST_LIBRE', [], ['value' => ['liste']])['status'],
];
check('PUT variable refusé (422) : accès à la base, secret, champ inconnu, valeur qui n\'est pas un texte', array_unique($refusVar) === [422], json_encode($refusVar));

$cle = call($router, 'PUT', '/api/v1/marketing/keys/MAR_ERP_API_TOKEN', [], ['value' => 'jeton-erp-tres-secret-9876']);
$lue = call($router, 'GET', '/api/v1/marketing/keys');
$tout = json_encode($lue['body']);
$ligneCle = array_values(array_filter($lue['body']['data'] ?? [], static fn (array $k): bool => $k['name'] === 'MAR_ERP_API_TOKEN'))[0] ?? [];
check('PUT clé : enregistrée chiffrée ; ni la réponse ni la lecture ne contiennent la valeur, seulement ses 4 derniers caractères',
    $cle['status'] === 200 && $lue['status'] === 200 && !str_contains((string) json_encode($cle['body']), 'tres-secret') && !str_contains((string) $tout, 'tres-secret')
        && ($ligneCle['hint'] ?? '') === '••••9876' && ($ligneCle['source'] ?? '') === 'base' && ($ligneCle['readable'] ?? false) === true
        && \Marketing\Support\Keys::get('MAR_ERP_API_TOKEN') === 'jeton-erp-tres-secret-9876');
$refusCle = [
    call($router, 'PUT', '/api/v1/marketing/keys/MAR_SESSION_SECRET', [], ['value' => str_repeat('z', 40)])['status'],
    call($router, 'PUT', '/api/v1/marketing/keys/MAR_SERVICE_TOKEN', [], ['value' => str_repeat('z', 40)])['status'],
    call($router, 'PUT', '/api/v1/marketing/keys/MAR_WEBSHOP_API_BASE', [], ['value' => 'x'])['status'],
    call($router, 'PUT', '/api/v1/marketing/keys/MAR_ERP_API_TOKEN', [], ['value' => '   '])['status'],
    call($router, 'DELETE', '/api/v1/marketing/keys/MAR_SERVICE_TOKEN')['status'],
];
check('clés refusées (422) : secret de session et jeton de service (entretenus par le déploiement), une variable, une valeur vide, le retrait d\'une clé du déploiement',
    array_unique($refusCle) === [422], json_encode($refusCle));
$retrait = call($router, 'DELETE', '/api/v1/marketing/keys/MAR_ERP_API_TOKEN');
check('DELETE clé : retirée de la base, le fichier reprend', $retrait['status'] === 200 && \Marketing\Support\Keys::get('MAR_ERP_API_TOKEN') === \Marketing\Support\Env::get('MAR_ERP_API_TOKEN'));

// Import du .env : ce qui n'est pas en base y est versé, rien n'est écrasé, une seconde fois ne change rien.
$purgerReglages();
\Marketing\Support\Env::set('MAR_WEBSHOP_API_BASE', 'https://depuis-le-fichier.test');
\Marketing\Support\Env::set('MAR_ERP_API_PASSWORD', 'mot-de-passe-du-fichier');
\Marketing\Support\Config::put('MAR_ERP_API_TIMEOUT', '7');
\Marketing\Support\Env::set('MAR_ERP_API_TIMEOUT', '3');
$premier = \Marketing\Support\Settings::importFromEnvironment();
$second  = \Marketing\Support\Settings::importFromEnvironment();
// L'import verse tout ce que l'environnement du test porte (dossiers temporaires compris) : tout est retiré en partant.
$nomsTest = array_values(array_unique(array_merge($nomsTest, $premier['variables'], $premier['keys'])));
check('import du .env : variables et clés absentes versées, la valeur déjà en base gardée, la seconde passe ne verse rien',
    in_array('MAR_WEBSHOP_API_BASE', $premier['variables'], true) && in_array('MAR_ERP_API_PASSWORD', $premier['keys'], true)
        && !in_array('MAR_ERP_API_TIMEOUT', $premier['variables'], true) && \Marketing\Support\Config::get('MAR_ERP_API_TIMEOUT') === '7'
        && $second['variables'] === [] && $second['keys'] === []
        && \Marketing\Support\Keys::get('MAR_ERP_API_PASSWORD') === 'mot-de-passe-du-fichier'
        && !str_contains((string) $pdo->query("SELECT ciphertext FROM mar_keys WHERE name = 'MAR_ERP_API_PASSWORD'")->fetchColumn(), 'mot-de-passe'),
    json_encode([$premier, $second]));

// Le secret de session lu en base : la session s'ouvre, et un cookie signé d'un autre secret, non.
\Marketing\Support\Keys::put('MAR_SESSION_SECRET', str_repeat('k', 40));
\Marketing\Support\Env::set('MAR_SESSION_SECRET', str_repeat('f', 40));
$cookie = \Marketing\Support\Session::seal(['user_id' => 5, 'role' => 'BRAND_ADMIN', 'shop_ids' => [], 'label' => 'test']);
$pdo->exec("DELETE FROM mar_keys WHERE name = 'MAR_SESSION_SECRET'");
\Marketing\Support\Keys::forget();
check('le secret de session se lit en base, avant le fichier : un cookie signé du secret en base ne s\'ouvre plus quand le fichier reprend',
    \Marketing\Support\Session::open($cookie) === null);

$purgerReglages();
foreach ($envReglages as $cle => $valeur) { \Marketing\Support\Env::set($cle, $valeur); }
array_map('unlink', glob($dossierCles . '/*') ?: []);
@rmdir($dossierCles);
\Marketing\Support\Keys::forget();
AuthContext::set(1, 'BRAND_ADMIN', 1);

// --- Fil de production et kit des franchisés -------------------------------
// Après la validation : une section par support coché (plus le message, les consignes,
// les tenues) ; les bâches et les affiches se valident boutique par boutique ; le kit
// s'envoie quand tout est validé, chaque boutique le lit par son lien personnel.
echo "\nFil de production et kit des franchisés\n";
\Marketing\Support\Env::set('MAR_SESSION_SECRET', str_repeat('p', 40));
\Marketing\Support\Keys::forget();
AuthContext::set(1, 'BRAND_ADMIN', 1);
$canauxP = array_column(call($router, 'GET', '/api/v1/marketing/references')['body']['channels'], null, 'code');
[$sA, $sB] = array_map('intval', $pdo->query('SELECT id FROM mar_shop WHERE brand_id = 1 ORDER BY id LIMIT 2')->fetchAll(PDO::FETCH_COLUMN));
$pdo->exec('DELETE FROM mar_shop_support WHERE shop_id IN (' . $sA . ',' . $sB . ')');
call($router, 'PUT', '/api/v1/marketing/shop-supports/' . $sA, [], ['supports' => [['kind' => 'bache', 'placement' => 'Façade', 'widthCm' => 300, 'heightCm' => 100, 'quantity' => 1]]]);
$prod = call($router, 'POST', '/api/v1/marketing/campaigns', [], [
    'name' => 'Production et kit', 'status_code' => 'draft', 'scope' => 'RESEAU', 'type_id' => (int) $types['ouverture']['id'],
    'starts_on' => '2026-12-01', 'ends_on' => '2026-12-31', 'shop_ids' => [$sA, $sB], 'uniform_ids' => [1],
    'pos_survey_enabled' => true, 'pos_questions' => [['label' => 'Vous avez réservé votre bûche ?', 'answer_type' => 'yes_no']],
    'channels' => [
        ['channel_id' => (int) $canauxP['affichage']['id'], 'quantity' => 2],
        ['channel_id' => (int) $canauxP['posts_meta']['id'], 'quantity' => 6],
        ['channel_id' => (int) $canauxP['goodies']['id'], 'quantity' => 300, 'details' => 'Sacs kraft'],
    ],
    'messages' => [['lang' => 'fr', 'title' => 'Les bûches de fêtes', 'hook' => 'à partager', 'offer_line' => '−10 %', 'cta' => 'Commander']],
    'shop_targets' => [['shop_id' => $sA, 'target_pieces' => 520, 'staff_headcount' => 5], ['shop_id' => $sB, 'target_pieces' => 430, 'staff_headcount' => 4]],
    'staff_bonus_enabled' => true, 'staff_bonus_who' => 'team', 'staff_bonus_rule' => 'attainment', 'staff_bonus_threshold_pct' => 100,
    'staff_bonus_amount' => 40, 'staff_bonus_extra_pct' => 120, 'staff_bonus_extra_amount' => 10, 'staff_bonus_cap_amount' => 200,
    'staff_bonus_form' => 'voucher', 'staff_bonus_paid_on' => '2027-01-15',
]);
$idP = (int) ($prod['body']['inserted_id'] ?? 0);
$brouillonP = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP))['body'];
check('prime du personnel : enregistrée et relue (règle, montants, forme, date, équipe par boutique)',
    ($brouillonP['staff_bonus_enabled'] ?? false) === true && ($brouillonP['staff_bonus_rule'] ?? '') === 'attainment'
        && (float) ($brouillonP['staff_bonus_amount'] ?? 0) === 40.0 && ($brouillonP['staff_bonus_paid_on'] ?? '') === '2027-01-15'
        && array_column($brouillonP['shop_targets'] ?? [], 'staff_headcount', 'shop_id') === [$sA => 5, $sB => 4],
    json_encode([$prod['status'], $prod['body'], $brouillonP['shop_targets'] ?? null]));
$refusPrime = [
    call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP), [], $brouillonP + ['staff_bonus_rule' => 'loterie'])['status'],
    call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP), [], ['staff_bonus_rule' => 'loterie'] + $brouillonP)['status'],
    call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP), [], ['staff_bonus_amount' => -5] + $brouillonP)['status'],
    call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP), [], ['staff_bonus_paid_on' => '2027-02-30'] + $brouillonP)['status'],
    call($router, 'PUT', sprintf('/api/v1/marketing/campaigns/%d/draft', $idP), [], ['staff_bonus_amount' => null] + $brouillonP)['status'],
];
check('prime du personnel : refusée si règle inconnue, montant négatif, date impossible, ou sans montant',
    $refusPrime[0] === 200 && array_unique(array_slice($refusPrime, 1)) === [422]
        && (string) $pdo->query("SELECT staff_bonus_rule FROM mar_campaign WHERE id = $idP")->fetchColumn() === 'attainment',
    json_encode($refusPrime));
$urlP = sprintf('/api/v1/marketing/campaigns/%d/production-sections', $idP);
check('production : une campagne en brouillon n\'a pas encore de fil (409)', call($router, 'GET', $urlP)['status'] === 409);
call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $idP), [], ['status_code' => 'planned']);
$filP = call($router, 'GET', $urlP);
$codesP = array_column($filP['body']['data']['sections'] ?? [], 'code');
$bachesP = array_values(array_filter($filP['body']['data']['sections'] ?? [], static fn ($x) => $x['code'] === 'affichage'))[0] ?? [];
check('production : les sections viennent de la campagne, dans l\'ordre du fil, avec leur échéance ; les bâches par boutique, avec leurs emplacements',
    $filP['status'] === 200 && $codesP === ['message', 'goodies', 'consignes', 'tenues', 'affichage', 'posts_meta', 'prime']
        && ($filP['body']['data']['total'] ?? 0) === 7 && ($filP['body']['data']['kitReady'] ?? true) === false
        && $bachesP['perShop'] === true && count($bachesP['shops']) === 2 && $bachesP['dueOn'] === '2026-11-24'
        && ($bachesP['shops'][0]['supports'][0]['widthCm'] ?? null) === 300,
    json_encode([$filP['status'], $codesP, $bachesP['dueOn'] ?? null]));
AuthContext::clear();
check('production : 401 sans identité', call($router, 'GET', $urlP)['status'] === 401);
AuthContext::set(77, 'FRANCHISEE', 1, [$sA]);
$filF = call($router, 'GET', $urlP);
$bachesF = array_values(array_filter($filF['body']['data']['sections'] ?? [], static fn ($x) => $x['code'] === 'affichage'))[0] ?? [];
check('production : le franchisé ne voit que sa boutique', $filF['status'] === 200 && array_column($bachesF['shops'] ?? [], 'shopId') === [$sA]);
check('production : le franchisé ne fait pas avancer une section (403)', call($router, 'PUT', $urlP . '/message', [], ['status' => 'validated'])['status'] === 403);
check('production : le franchisé ne touche pas au BAT d\'une autre boutique (404) ni ne l\'« envoie » (422)',
    call($router, 'PUT', $urlP . '/affichage/shops/' . $sB, [], ['status' => 'validated'])['status'] === 404
        && call($router, 'PUT', $urlP . '/affichage/shops/' . $sA, [], ['status' => 'sent'])['status'] === 422);
$redo = call($router, 'PUT', $urlP . '/affichage/shops/' . $sA, [], ['status' => 'redo', 'note' => 'La grille ne fait que 180 cm']);
check('production : le franchisé renvoie son BAT avec son retour', $redo['status'] === 200
    && (array_values(array_filter($redo['body']['data']['sections'], static fn ($x) => $x['code'] === 'affichage'))[0]['shops'][0]['note'] ?? '') === 'La grille ne fait que 180 cm');
AuthContext::set(1, 'BRAND_ADMIN', 1);
$refusP = [
    call($router, 'PUT', $urlP . '/message', [], ['status' => 'fini'])['status'],
    call($router, 'PUT', $urlP . '/message', [], ['status' => 'validated', 'pirate' => 1])['status'],
    call($router, 'PUT', $urlP . '/message', [], ['status' => 'validated', 'note' => str_repeat('x', 301)])['status'],
];
check('production : mise à jour invalide (422) — état hors liste, champ inconnu, note trop longue', array_unique($refusP) === [422], json_encode($refusP));
check('production : section ou campagne inconnue (404)', call($router, 'PUT', $urlP . '/fax', [], ['status' => 'validated'])['status'] === 404
    && call($router, 'GET', '/api/v1/marketing/campaigns/999999/production-sections')['status'] === 404
    && call($router, 'PUT', $urlP . '/message/shops/' . $sA, [], ['status' => 'validated'])['status'] === 404);
check('production : les bâches ne se ferment pas tant qu\'une boutique n\'a pas validé (409)', call($router, 'PUT', $urlP . '/affichage', [], ['status' => 'validated'])['status'] === 409);
foreach ([$sA, $sB] as $s) { call($router, 'PUT', $urlP . '/affichage/shops/' . $s, [], ['status' => 'validated']); }
foreach (['message', 'affichage', 'goodies', 'consignes', 'tenues'] as $code) { call($router, 'PUT', $urlP . '/' . $code, [], ['status' => 'validated']); }
$deux = [call($router, 'PUT', $urlP . '/message', [], ['status' => 'validated']), call($router, 'PUT', $urlP . '/message', [], ['status' => 'validated'])];
check('production : valider deux fois revient au même (idempotent)', $deux[0]['status'] === 200 && $deux[0]['body']['data']['validated'] === $deux[1]['body']['data']['validated']);
$kitUrl = sprintf('/api/v1/marketing/campaigns/%d/kit-versions', $idP);
$postsKit = ['posts' => [
    ['date' => '2026-12-01', 'time' => '07:30', 'title' => 'Lancement', 'networks' => ['fb', 'ig'], 'kind' => 'post', 'shops' => [], 'image' => 'https://exemple.test/a.jpg'],
    ['date' => '2026-12-03', 'time' => '16:00', 'title' => 'Story d\'une autre boutique', 'networks' => ['ig'], 'kind' => 'story', 'shops' => ['424242']],
]];
check('kit : pas d\'envoi tant qu\'une section reste à valider (409)', call($router, 'POST', $kitUrl, [], $postsKit)['status'] === 409);
call($router, 'PUT', $urlP . '/posts_meta', [], ['status' => 'validated']);
call($router, 'PUT', $urlP . '/prime', [], ['status' => 'validated']);
$refusK = [
    call($router, 'POST', $kitUrl, [], ['posts' => [['date' => '2026-13-01', 'title' => 'x']]])['status'],
    call($router, 'POST', $kitUrl, [], ['posts' => [['date' => '2026-12-01', 'title' => 'x', 'image' => 'javascript:alert(1)']]])['status'],
    call($router, 'POST', $kitUrl, [], ['posts' => 'tout'])['status'],
    call($router, 'POST', $kitUrl, [], ['pirate' => 1])['status'],
];
check('kit : envoi invalide (422) — date, image, liste, champ inconnu', array_unique($refusK) === [422], json_encode($refusK));
AuthContext::set(77, 'FRANCHISEE', 1, [$sA]);
check('kit : le franchisé n\'envoie pas le kit (403)', call($router, 'POST', $kitUrl, [], $postsKit)['status'] === 403);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$envoi = call($router, 'POST', $kitUrl, [], $postsKit);
$liens = array_column($envoi['body']['data']['shops'] ?? [], 'url', 'shopId');
$tokenA = (string) (explode('?kit=', (string) ($liens[$sA] ?? ''))[1] ?? '');
check('kit : envoyé — une version, un lien par boutique', $envoi['status'] === 201 && ($envoi['body']['data']['currentVersion'] ?? 0) === 1
    && strlen($tokenA) === 43 && count(array_filter($liens)) === 2 && $liens[$sA] !== $liens[$sB],
    json_encode([$envoi['status'], $envoi['body']['error'] ?? null]));
check('kit : la base ne garde pas le lien, seulement son empreinte',
    (int) $pdo->query("SELECT COUNT(*) FROM mar_campaign_kit_link WHERE campaign_id = $idP AND token_hash = '" . hash('sha256', $tokenA) . "'")->fetchColumn() === 1
        && !str_contains(json_encode($pdo->query("SELECT * FROM mar_campaign_kit_link WHERE campaign_id = $idP")->fetchAll()), $tokenA));
AuthContext::clear();
$lu = call($router, 'GET', '/api/v1/public/marketing/campaign-kits/' . $tokenA);
$kitA = $lu['body']['data'] ?? [];
check('kit : lu par son lien, sans session — la boutique, ses bâches, ses posts, ses tenues, ses consignes, ses dates',
    $lu['status'] === 200 && ($kitA['shop']['id'] ?? 0) === $sA && ($kitA['version'] ?? 0) === 1 && array_key_exists('readAt', $kitA) && $kitA['readAt'] === null
        && count($kitA['displays']['baches'] ?? []) === 1 && array_column($kitA['posts'] ?? [], 'title') === ['Lancement']
        && ($kitA['uniforms'] ?? []) !== [] && ($kitA['counter']['questions'][0] ?? '') === 'Vous avez réservé votre bûche ?'
        && ($kitA['messages']['fr']['title'] ?? '') === 'Les bûches de fêtes'
        && in_array('Pose des bâches', array_column($kitA['dates'] ?? [], 'label'), true)
        && ($kitA['bonus']['amountCents'] ?? 0) === 4000 && ($kitA['bonus']['headcount'] ?? 0) === 5
        && ($kitA['bonus']['atThresholdCents'] ?? 0) === 20000 && ($kitA['bonus']['atExtraCents'] ?? 0) === 20000 && ($kitA['bonus']['targetPieces'] ?? 0) === 520,
    json_encode([$lu['status'], $kitA['displays'] ?? null, $kitA['posts'] ?? null, $kitA['uniforms'] ?? null, $kitA['counter'] ?? null, $kitA['readAt'] ?? 'absent', array_column($kitA['dates'] ?? [], 'label')]));
$r1 = call($router, 'PUT', '/api/v1/public/marketing/campaign-kits/' . $tokenA . '/read-receipt');
$r2 = call($router, 'PUT', '/api/v1/public/marketing/campaign-kits/' . $tokenA . '/read-receipt');
check('kit : accusé de lecture idempotent — la première lecture reste', $r1['status'] === 200 && ($r1['body']['data']['readAt'] ?? null) !== null
    && $r1['body']['data']['readAt'] === ($r2['body']['data']['readAt'] ?? ''), json_encode([$r1, $r2]));
check('kit : lien inconnu ou mal formé (404)', call($router, 'GET', '/api/v1/public/marketing/campaign-kits/' . str_repeat('A', 43))['status'] === 404
    && call($router, 'GET', '/api/v1/public/marketing/campaign-kits/court')['status'] === 404);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$suivi = call($router, 'GET', $kitUrl)['body']['data']['shops'] ?? [];
check('kit : le réseau voit qui l\'a lu', ($suivi[array_search($sA, array_column($suivi, 'shopId'), true)]['readAt'] ?? null) !== null
    && ($suivi[array_search($sB, array_column($suivi, 'shopId'), true)]['readAt'] ?? null) === null
    && ($suivi[array_search($sB, array_column($suivi, 'shopId'), true)]['sent'] ?? false) === true);
$v2 = call($router, 'POST', $kitUrl, [], $postsKit);
$tokenA2 = (string) (explode('?kit=', (string) (array_column($v2['body']['data']['shops'] ?? [], 'url', 'shopId')[$sA] ?? ''))[1] ?? '');
AuthContext::clear();
$lu2 = call($router, 'GET', '/api/v1/public/marketing/campaign-kits/' . $tokenA);
check('kit : une nouvelle version garde le même lien, et sa lecture repart de zéro',
    $tokenA2 === $tokenA && ($lu2['body']['data']['version'] ?? 0) === 2 && array_key_exists('readAt', $lu2['body']['data'] ?? []) && $lu2['body']['data']['readAt'] === null);
AuthContext::set(77, 'FRANCHISEE', 1, [$sA]);
check('kit : aperçu — le franchisé voit le sien, pas celui d\'une autre boutique',
    call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/kit-previews/%d', $idP, $sA))['status'] === 200
        && call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d/kit-previews/%d', $idP, $sB))['status'] === 404);
AuthContext::set(1, 'BRAND_ADMIN', 1);
$pdo->exec('DELETE FROM mar_campaign WHERE id = ' . $idP);
$pdo->exec('DELETE FROM mar_shop_support WHERE shop_id IN (' . $sA . ',' . $sB . ')');
\Marketing\Support\Env::set('MAR_SESSION_SECRET', null);
\Marketing\Support\Keys::forget();

// --- Résultat -------------------------------------------------------------
printf("\n%d réussis, %d échoués\n", $passed, $failed);
exit($failed === 0 ? 0 : 1);
