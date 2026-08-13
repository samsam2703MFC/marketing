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
$pdo->exec('DELETE FROM mar_crm_lead_event');
$pdo->exec('DELETE FROM mar_crm_lead');
$pdo->exec('DELETE FROM mar_campaign_kpi_snapshot');
$pdo->exec('DELETE FROM mar_fund_movement');
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

foreach ($aggregateRoutes as $label => [$path, $query]) {
    $response = call($router, 'GET', $path, $query);
    check(sprintf('%s répond au franchisé', $label), $response['status'] === 200, 'statut ' . $response['status']);
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
            ['label' => 'Tarte du jour', 'offer_item_id' => $catalogItemId],
            '  ',
            ['label' => 'Référence disparue', 'offer_item_id' => 999999],
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
    'SELECT tone, objective_coef_pct, agency_note, b2b_webshop_enabled FROM mar_campaign WHERE id = %d',
    $newId
))->fetch();
check('le ton éditorial est enregistré', ($campaignRow['tone'] ?? '') === 'gourmand');
check('l\'objectif en écart au N-1 est enregistré', (float) ($campaignRow['objective_coef_pct'] ?? 0) === 12.0);
check('la note de brief est enregistrée', ($campaignRow['agency_note'] ?? '') !== '');
check('le web-shop B2B est activé', (int) ($campaignRow['b2b_webshop_enabled'] ?? 0) === 1);

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
        ['shop_id' => 2, 'target_pieces' => 75, 'challenge_trigger_pct' => null],
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

// Les contrôles de la création s'appliquent aussi à la mise à jour.
$target = (int) $pdo->query("SELECT id FROM mar_campaign WHERE scope = 'RESEAU' ORDER BY id LIMIT 1")->fetchColumn();
foreach ([
    'état inconnu'     => ['status_code' => 'zzz'],
    'portée inconnue'  => ['scope' => 'BIDON'],
    'cible inconnue'   => ['client_target' => 'b2x'],
    'période inversée' => ['starts_on' => '2026-12-31', 'ends_on' => '2026-01-01'],
] as $label => $payload) {
    $response = call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $target), [], $payload);
    check(sprintf('mise à jour — %s refusée', $label), $response['status'] === 422, 'statut ' . $response['status']);
}

// Une portée hors référentiel fait sortir la campagne du filtre de périmètre :
// elle disparaît de la vue de tout le monde, sans erreur nulle part.
check(
    'la campagne garde une portée valide',
    in_array($pdo->query(sprintf('SELECT scope FROM mar_campaign WHERE id = %d', $target))->fetchColumn(), ['RESEAU', 'LOCALE'], true)
);

// Voir une campagne réseau et pouvoir l'écrire sont deux choses distinctes.
AuthContext::set(77, 'FRANCHISEE', 1, [1]);
$response = call($router, 'GET', sprintf('/api/v1/marketing/campaigns/%d', $target));
check('un franchisé voit bien la campagne réseau', $response['status'] === 200);

$response = call($router, 'PATCH', sprintf('/api/v1/marketing/campaigns/%d', $target), [], ['name' => 'Détournée']);
check('mais ne peut pas la modifier', $response['status'] === 422, 'statut ' . $response['status']);

$response = call($router, 'DELETE', sprintf('/api/v1/marketing/campaigns/%d', $target));
check('ni la supprimer', $response['status'] === 422, 'statut ' . $response['status']);
check(
    'et elle est intacte',
    $pdo->query(sprintf('SELECT name FROM mar_campaign WHERE id = %d', $target))->fetchColumn() !== 'Détournée'
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
    array_key_exists('image_url', $produit) && $produit['image_url'] === null
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

// --- Résultat -------------------------------------------------------------
printf("\n%d réussis, %d échoués\n", $passed, $failed);
exit($failed === 0 ? 0 : 1);
