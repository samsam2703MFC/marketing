<?php

declare(strict_types=1);

/**
 * Contrôleur frontal du module.
 *
 * C'est lui qui sert l'API en production (/marketing/api, /marketingc/api) : le
 * raccord prévu au contrôleur frontal de l'ERP n'existe pas. L'identité se
 * résout donc ici, par `Identity`.
 */

use Marketing\Support\Identity;
use Marketing\Support\Request;
use Marketing\Support\Response;
use Marketing\Support\Router;

require __DIR__ . '/../src/autoload.php';

$router = new Router();
(require __DIR__ . '/../routes.php')($router);

/**
 * Résolution de l'identité : jeton de service (un autre module du serveur), puis
 * session ouverte par les identifiants de l'ERP, puis — si et seulement si
 * MAR_DEV_AUTH=1 — identité de développement. Voir `Identity`.
 */
Identity::resolve($_SERVER, $_COOKIE);

Response::emit($router->dispatch(Request::fromGlobals()));
