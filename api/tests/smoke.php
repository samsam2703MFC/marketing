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

// --- Jeu de données -------------------------------------------------------
$pdo->exec('DELETE FROM mar_crm_lead_event');
$pdo->exec('DELETE FROM mar_crm_lead');
$pdo->exec('DELETE FROM mar_fund_movement');
$pdo->exec('DELETE FROM mar_campaign_shop');
$pdo->exec('DELETE FROM mar_campaign');
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
    (11, 1, 7, 'Portes ouvertes Uccle', 'LOCALE', 'planned', '2026-09-01', '2026-09-15', 2500)");
$pdo->exec('INSERT INTO mar_campaign_shop (campaign_id, shop_id) VALUES (11, 2)');

$pdo->exec("INSERT INTO mar_crm_lead (id, campaign_id, sector_id, shop_id, company_name, status_code) VALUES
    (100, 10, 1, 1, 'Office Dupont', 'todo'),
    (101, 10, 1, 2, 'Cabinet Legrand', 'todo')");

$pdo->exec("INSERT INTO mar_fund_movement (direction, shop_id, campaign_id, lever_id, movement_date, label, amount, source) VALUES
    ('IN',  1, NULL, NULL, '2026-07-05', 'Royalties juillet Namur', 4200, 'ROYALTY'),
    ('OUT', 1, 10,   1,    '2026-07-12', 'Honoraires agence',       3100, 'AGENCE')");

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

// --- Résultat -------------------------------------------------------------
printf("\n%d réussis, %d échoués\n", $passed, $failed);
exit($failed === 0 ? 0 : 1);
