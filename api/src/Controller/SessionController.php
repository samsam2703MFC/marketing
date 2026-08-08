<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;
use Marketing\Support\Scope;

/**
 * État de la session courante.
 *
 * Cette route est publique et ne divulgue rien : elle dit seulement si l'appelant
 * est authentifié, et sous quelle identité s'il l'est.
 *
 * Elle résout un problème d'architecture réel. Le module est conçu pour être
 * embarqué dans l'ERP, dont le middleware `bearerAuth` renseigne `AuthContext`.
 * Le front, lui, ne peut pas deviner s'il est embarqué — il affichait donc son
 * propre écran de connexion, inutile dans ce cas, et bloquant lorsque l'ERP n'est
 * pas joignable. Il interroge maintenant cette route au démarrage : identité déjà
 * établie, il entre directement ; sinon il demande à se connecter.
 */
final class SessionController
{
    public function show(Request $request): array
    {
        unset($request);

        $auth = AuthContext::current();

        if ($auth === null) {
            return Response::data([
                'authenticated' => false,
                // Indique au front s'il doit proposer sa propre connexion ou
                // renvoyer vers l'ERP.
                'login_hint'    => 'erp',
                // Deux booléens pour distinguer « pas d'identité » de « fichier
                // de configuration jamais trouvé ». Sans eux, les deux cas
                // rendent la même réponse et l'installation se diagnostique à
                // l'aveugle. Aucune valeur n'est divulguée, seulement des états.
                'config_found'  => \Marketing\Support\Env::source() !== null,
                'dev_auth'      => \Marketing\Support\Env::get('MAR_DEV_AUTH') === '1',
            ]);
        }

        return Response::data([
            'authenticated' => true,
            'user_id'       => $auth->userId,
            'role'          => $auth->role,
            'brand_id'      => $auth->brandId,
            'shop_ids'      => Scope::shopIds($auth),
        ]);
    }
}
