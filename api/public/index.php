<?php

declare(strict_types=1);

/**
 * Contrôleur frontal autonome.
 *
 * Sert aux tests et au développement local. Dans l'ERP, c'est le contrôleur
 * frontal existant qui prend le relais : il valide le JWT, renseigne
 * `AuthContext`, puis appelle les contrôleurs du module. Ce fichier n'est alors
 * pas déployé.
 */

use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;
use Marketing\Support\Router;

require __DIR__ . '/../src/autoload.php';

$router = new Router();
(require __DIR__ . '/../routes.php')($router);

/**
 * Résolution de l'identité.
 *
 * Ce module ne vérifie aucune signature — l'ERP le fait déjà. En autonome, on
 * accepte une identité passée par en-tête, mais **uniquement** si MAR_DEV_AUTH
 * est explicitement activé. Sans ce garde-fou, un déploiement accidentel de ce
 * fichier laisserait n'importe qui se déclarer BRAND_ADMIN.
 */
if (getenv('MAR_DEV_AUTH') === '1') {
    // Les en-têtes priment, ce qui permet de simuler plusieurs rôles depuis
    // curl ; à défaut, MAR_DEV_USER_ID sert d'identité par défaut pour ouvrir
    // l'interface dans un navigateur sans monter tout le flux d'authentification.
    $userId = (int) ($_SERVER['HTTP_X_DEV_USER_ID'] ?? getenv('MAR_DEV_USER_ID') ?: 0);
    $role   = (string) ($_SERVER['HTTP_X_DEV_ROLE'] ?? getenv('MAR_DEV_ROLE') ?: 'BRAND_ADMIN');
    $shops  = array_filter(explode(',', (string) ($_SERVER['HTTP_X_DEV_SHOPS'] ?? getenv('MAR_DEV_SHOPS') ?: '')));

    if ($userId > 0) {
        AuthContext::set($userId, $role, null, array_map('intval', $shops));
    }
}

Response::emit($router->dispatch(Request::fromGlobals()));
