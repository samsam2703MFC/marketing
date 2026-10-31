<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Support\ErpClient;
use Marketing\Support\Session;
use RuntimeException;

/**
 * Connexion au module par les identifiants de l'ERP (téléphone + mot de passe).
 *
 * Le module Marketing sert au pilotage de la marque : il s'ouvre avec un compte
 * réseau de l'ERP — le réalm `admin` — et avec lui seulement. Un compte de
 * boutique n'y a pas accès ; la boutique travaille dans ses propres espaces
 * (module Social, espace franchisé).
 *
 * Le module ne garde aucun mot de passe : il les présente à l'ERP, qui tranche.
 * Le jeton rendu par l'ERP n'est pas gardé non plus.
 */
final class LoginService
{
    public function __construct(
        private readonly ErpClient $erp = new ErpClient(),
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

        try {
            $admin = $this->erp->authenticate($phone, $password);
        } catch (RuntimeException $echec) {
            // Le client dit déjà ce qui s'est passé (« ERP injoignable : … »).
            throw new LoginError($echec->getMessage(), 502);
        }

        if ($admin['status'] === 200 && $admin['token'] !== null) {
            return ['user_id' => self::userId($admin['token']), 'role' => 'BRAND_ADMIN', 'shop_ids' => [], 'label' => self::label($phone)];
        }

        if ($admin['status'] === 401) {
            // Freine l'essai de mots de passe à la chaîne ; l'ERP a ses propres limites.
            usleep(400000);
            throw new LoginError('Téléphone ou mot de passe incorrect.', 401);
        }

        throw match ($admin['status']) {
            422      => new LoginError('Téléphone et mot de passe requis.', 422),
            // 403 : pas d'appartenance admin ; 409 : l'ERP ne sait pas laquelle retenir.
            403, 409 => new LoginError('Le module Marketing sert au pilotage de la marque : il s\'ouvre avec un compte réseau de l\'ERP. Ce compte n\'en est pas un.', 403),
            default => new LoginError(sprintf('L\'ERP a répondu %d à la connexion.', $admin['status']), 502),
        };
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
    private static function label(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';

        return ($digits === '' ? 'Compte' : '••• ' . substr($digits, -4)) . ' · réseau';
    }
}
