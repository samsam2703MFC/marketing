<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\LoginError;
use Marketing\Service\LoginService;
use Marketing\Support\AuthContext;
use Marketing\Support\Identity;
use Marketing\Support\Request;
use Marketing\Support\Response;
use Marketing\Support\Scope;
use Marketing\Support\Session;

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
    public function __construct(
        private readonly LoginService $login = new LoginService(),
    ) {
    }

    /**
     * `POST …/session` : `{ "phone", "password" }` — connexion par les identifiants de l'ERP.
     *
     * Ouverte, elle pose le cookie signé de la session ; refusée, elle dit pourquoi
     * (identifiants, compte sans réseau ni boutique, ERP injoignable) sans rien poser.
     */
    public function open(Request $request): array
    {
        $phone    = $request->input('phone');
        $password = $request->input('password');
        if (!is_string($phone) || !is_string($password) || mb_strlen($phone) > 40 || strlen($password) > 200) {
            return Response::error('Téléphone et mot de passe requis.', 422);
        }

        try {
            $identity = $this->login->open($phone, $password);
        } catch (LoginError $refus) {
            return Response::error($refus->getMessage(), $refus->status);
        }

        $response = Response::data([
            'authenticated' => true,
            'via'           => 'erp',
            'role'          => $identity['role'],
            'shop_ids'      => $identity['shop_ids'],
            'label'         => $identity['label'],
        ]);
        $response['headers'] = [Session::header(Session::seal($identity), Session::isHttps($_SERVER))];

        return $response;
    }

    /** `DELETE …/session` : ferme la session (efface le cookie). Sans session, ne fait rien. */
    public function close(Request $request): array
    {
        unset($request);

        $response = Response::mutated('Session fermée.');
        $response['headers'] = [Session::header('', Session::isHttps($_SERVER))];

        return $response;
    }

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
                'login_ready'   => self::loginReady(),
            ]);
        }

        return Response::data([
            'authenticated' => true,
            'user_id'       => $auth->userId,
            'role'          => $auth->role,
            'brand_id'      => $auth->brandId,
            'shop_ids'      => Scope::shopIds($auth),
            // D'où vient cette identité : de l'ERP, ou de l'identité de développement
            // (MAR_DEV_AUTH). L'écran « Adresses et réglages » le montre, parce qu'un
            // serveur ouvert en mode développement doit se voir. Un état, aucune valeur.
            'dev_auth'      => \Marketing\Support\Env::get('MAR_DEV_AUTH') === '1',
            // `erp` : connexion par les identifiants de l'ERP ; `dev` : identité de développement ;
            // `service` : un autre module du serveur.
            'via'           => Identity::source(),
            'label'         => Identity::label($_COOKIE),
            'login_ready'   => self::loginReady(),
        ]);
    }

    /** La connexion par l'ERP peut-elle s'ouvrir : adresse de l'ERP et secret de session présents. Un état, aucune valeur. */
    private static function loginReady(): bool
    {
        return \Marketing\Support\ErpClient::authBase() !== '' && Session::secret() !== null;
    }
}
