<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\SessionRepository;
use Marketing\Support\ErpClient;
use Marketing\Support\Session;
use RuntimeException;

/**
 * Connexion au module par les identifiants de l'ERP (téléphone + mot de passe).
 *
 * Le module ne garde aucun mot de passe : il les présente à l'ERP, qui tranche.
 *
 * - Réalm `admin` accepté : la personne travaille pour le réseau → BRAND_ADMIN.
 * - Refusé faute d'appartenance admin (403, ou 409 quand l'ERP ne sait pas quelle
 *   appartenance retenir) : réalm `owner`. Accepté, les boutiques du compte sont
 *   lues dans l'ERP avec son propre jeton (`GET /api/v1/owner/shops`), puis
 *   rapprochées des boutiques du module → FRANCHISEE, limité à celles-là.
 * - Mot de passe faux (401) : on s'arrête là, sans essayer l'autre réalm.
 *
 * Le périmètre est donc fixé par l'ERP et par le serveur, jamais par le client.
 */
final class LoginService
{
    public function __construct(
        private readonly ErpClient $erp = new ErpClient(),
        private readonly SessionRepository $sessions = new SessionRepository(),
    ) {
    }

    /**
     * @return array{user_id:int, role:string, shop_ids:list<int>, label:string}
     * @throws LoginError
     */
    public function open(string $phone, string $password): array
    {
        $phone = trim($phone);
        if ($phone === '' || $password === '') {
            throw new LoginError('Téléphone et mot de passe requis.', 422);
        }
        if (ErpClient::authBase() === '') {
            throw new LoginError('La connexion passe par l\'ERP, dont l\'adresse (MAR_ERP_AUTH_BASE) n\'est pas renseignée sur ce serveur.', 503);
        }
        if (Session::secret() === null) {
            throw new LoginError('MAR_SESSION_SECRET n\'est pas renseigné sur ce serveur : la session ne peut pas être signée.', 503);
        }

        $admin = $this->attempt('admin', $phone, $password);
        if ($admin['status'] === 200 && $admin['token'] !== null) {
            return ['user_id' => self::userId($admin['token']), 'role' => 'BRAND_ADMIN', 'shop_ids' => [], 'label' => self::label($phone, 'réseau')];
        }
        $this->refuseUnlessOtherRealm($admin['status']);

        $owner = $this->attempt('owner', $phone, $password);
        if ($owner['status'] === 200 && $owner['token'] !== null) {
            try {
                $rows = ErpClient::rows($this->erp->getAs($owner['token'], '/api/v1/owner/shops'), ['shops', 'items']);
            } catch (RuntimeException $echec) {
                throw new LoginError('Connecté à l\'ERP, mais ses boutiques n\'ont pas pu être lues : ' . $echec->getMessage(), 502);
            }
            $erpIds = [];
            foreach ($rows as $row) {
                foreach (['id', 'shop_id', 'shopId'] as $key) {
                    if (isset($row[$key]) && is_numeric($row[$key])) {
                        $erpIds[] = (int) $row[$key];
                        break;
                    }
                }
            }
            $shops = $this->sessions->shopsForErpIds($erpIds);
            if ($shops === []) {
                throw new LoginError(
                    $erpIds === []
                        ? 'L\'ERP n\'a rendu aucune boutique pour ce compte.'
                        : 'Les boutiques de ce compte (ERP : ' . implode(', ', array_slice($erpIds, 0, 10)) . ') ne sont pas encore connues du module : la reprise de l\'ERP les ajoute.',
                    403
                );
            }
            return ['user_id' => self::userId($owner['token']), 'role' => 'FRANCHISEE', 'shop_ids' => $shops, 'label' => self::label($phone, 'boutique')];
        }

        if ($owner['status'] === 401 || $owner['status'] === 422) {
            $this->refuseUnlessOtherRealm($owner['status']);
        }
        if ($owner['status'] === 403) {
            throw new LoginError('Ce compte n\'a accès ni au réseau ni à une boutique dans l\'ERP.', 403);
        }
        if ($owner['status'] === 409) {
            throw new LoginError('Ce compte est rattaché à plusieurs boutiques sans rôle réseau : l\'ERP ne sait pas laquelle ouvrir.', 409);
        }
        throw new LoginError(sprintf('L\'ERP a répondu %d à la connexion.', $owner['status']), 502);
    }

    /** @return array{status:int, token:?string, body:array<mixed>} */
    private function attempt(string $realm, string $phone, string $password): array
    {
        try {
            return $this->erp->authenticate($realm, $phone, $password);
        } catch (RuntimeException $echec) {
            // Le client dit déjà ce qui s'est passé (« ERP injoignable : … »).
            throw new LoginError($echec->getMessage(), 502);
        }
    }

    /** 401 et 422 tranchent ; 403 et 409 disent « pas ce réalm-là » ; le reste est une panne. */
    private function refuseUnlessOtherRealm(int $status): void
    {
        if ($status === 401) {
            // Freine l'essai de mots de passe à la chaîne ; l'ERP a ses propres limites.
            usleep(400000);
            throw new LoginError('Téléphone ou mot de passe incorrect.', 401);
        }
        if ($status === 422) {
            throw new LoginError('Téléphone et mot de passe requis.', 422);
        }
        if ($status !== 403 && $status !== 409) {
            throw new LoginError(sprintf('L\'ERP a répondu %d à la connexion.', $status), 502);
        }
    }

    /**
     * L'identifiant de la personne dans l'ERP, lu dans son jeton s'il le porte.
     *
     * La signature du jeton n'est pas vérifiée ici, et n'a pas à l'être : il
     * vient de l'ERP, en réponse à l'appel que ce serveur vient de lui faire.
     * Le swagger ne documente pas ses champs : faute de les trouver, 0.
     */
    private static function userId(string $token): int
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return 0;
        }
        $claims = json_decode((string) base64_decode(strtr($parts[1], '-_', '+/'), true), true);
        if (!is_array($claims)) {
            return 0;
        }
        foreach (['sub', 'user_id', 'userId', 'uid', 'user_account_id', 'id'] as $key) {
            if (isset($claims[$key]) && is_numeric($claims[$key])) {
                return (int) $claims[$key];
            }
        }

        return 0;
    }

    /** Ce que l'écran affiche de la personne connectée : son téléphone, masqué. */
    private static function label(string $phone, string $space): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';

        return ($digits === '' ? 'Compte' : '••• ' . substr($digits, -4)) . ' · ' . $space;
    }
}
